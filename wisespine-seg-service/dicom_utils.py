"""
DICOMweb utilities for the WiseSpine segmentation service.

Handles:
  - Fetching a DICOM series from Orthanc via DICOMweb WADO-RS
  - Converting TotalSegmentator NIfTI masks to a DICOM SEG object (highdicom)
  - Uploading the DICOM SEG back to Orthanc via STOW-RS
"""

import os
import io
import re
import uuid
import logging
from pathlib import Path

import httpx
import numpy as np
import pydicom
import nibabel as nib
import SimpleITK as sitk
import highdicom as hd
from highdicom.seg import SegmentDescription, Segmentation, SegmentationTypeValues
from highdicom.sr.coding import CodedConcept

logger = logging.getLogger(__name__)

# Orthanc DICOMweb base URL — override via env var for Docker deployment
ORTHANC_BASE_URL = os.environ.get(
    "ORTHANC_BASE_URL", "http://localhost/orthanc-container"
)
DICOMWEB_BASE = f"{ORTHANC_BASE_URL}/dicom-web"


# ─── QIDO / WADO helpers ──────────────────────────────────────────────────────

def _qido_instances(study_uid: str, series_uid: str) -> list[dict]:
    """Return a list of instance metadata dicts for a given series."""
    url = f"{DICOMWEB_BASE}/studies/{study_uid}/series/{series_uid}/instances"
    r = httpx.get(url, headers={"Accept": "application/json"}, timeout=30)
    r.raise_for_status()
    return r.json()


def _extract_dicom_from_multipart(content: bytes, boundary: str) -> bytes:
    """Extract the first DICOM payload from a multipart/related response body."""
    sep = f"--{boundary}".encode()
    parts = content.split(sep)
    for part in parts[1:]:          # skip the preamble before the first boundary
        if part.startswith(b"--"):  # end boundary
            break
        header_end = part.find(b"\r\n\r\n")
        if header_end != -1:
            return part[header_end + 4:].rstrip(b"\r\n-")
    return content


def fetch_series_dicom(study_uid: str, series_uid: str, dest_dir: Path) -> list[pydicom.Dataset]:
    """
    Download all DICOM instances for a series from Orthanc and save to dest_dir.

    Orthanc's DICOMweb plugin requires Accept: multipart/related; type="application/dicom"
    for WADO-RS instance retrieval — plain application/dicom returns HTTP 400.

    Returns a list of pydicom Datasets sorted by InstanceNumber.
    """
    instances = _qido_instances(study_uid, series_uid)
    if not instances:
        raise ValueError(f"No instances found for series {series_uid}")

    datasets = []
    for inst in instances:
        sop_uid = inst.get("00080018", {}).get("Value", [None])[0]
        if not sop_uid:
            continue

        url = (
            f"{DICOMWEB_BASE}/studies/{study_uid}"
            f"/series/{series_uid}/instances/{sop_uid}"
        )
        r = httpx.get(
            url,
            headers={"Accept": 'multipart/related; type="application/dicom"'},
            timeout=60,
        )
        r.raise_for_status()

        # Parse the multipart response to extract the raw DICOM bytes
        content_type = r.headers.get("content-type", "")
        boundary_match = re.search(r'boundary=(["\']?)([^\s;",]+)\1', content_type)
        if boundary_match and "multipart" in content_type:
            dicom_bytes = _extract_dicom_from_multipart(r.content, boundary_match.group(2))
        else:
            # Some Orthanc configs may return a bare DICOM file
            dicom_bytes = r.content

        filepath = dest_dir / f"{sop_uid}.dcm"
        filepath.write_bytes(dicom_bytes)
        datasets.append(pydicom.dcmread(str(filepath)))

    # Sort by InstanceNumber for correct slice ordering
    datasets.sort(key=lambda ds: int(getattr(ds, "InstanceNumber", 0)))
    return datasets


# ─── NIfTI → DICOM SEG ───────────────────────────────────────────────────────

# Vertebral level colours (RGB 0–255) cycling through a rainbow palette
_VERTEBRA_COLORS = [
    (220, 60,  60),   # red
    (230, 110, 40),   # orange-red
    (240, 160, 30),   # orange
    (220, 200, 40),   # yellow
    (130, 200, 60),   # yellow-green
    (50,  180, 80),   # green
    (40,  170, 160),  # teal
    (40,  130, 200),  # light blue
    (60,   80, 200),  # blue
    (100,  50, 200),  # indigo
    (160,  40, 200),  # violet
    (200,  40, 140),  # magenta
]

_SPINAL_CORD_COLOR = (255, 255, 100)   # bright yellow
_SACRUM_COLOR      = (180, 100, 220)   # purple


def _get_color(structure_name: str, index: int) -> tuple[int, int, int]:
    if structure_name == "spinal_cord":
        return _SPINAL_CORD_COLOR
    if structure_name == "sacrum":
        return _SACRUM_COLOR
    return _VERTEBRA_COLORS[index % len(_VERTEBRA_COLORS)]


def masks_to_dicom_seg(
    ref_dcms: list[pydicom.Dataset],
    masks: dict,   # { structure_name: Path(nii.gz) }
    structure_labels: dict,  # { structure_name: human_label }
) -> Segmentation:
    """
    Convert a dict of NIfTI segmentation masks to a single DICOM SEG object.

    Args:
        ref_dcms: List of reference DICOM datasets (the original CT series),
                  sorted by InstanceNumber / slice position.
        masks: Mapping from TotalSegmentator structure name to its NIfTI path.
        structure_labels: Mapping from structure name to human-readable label.

    Returns:
        A highdicom Segmentation object ready to be serialised.
    """
    if not masks:
        raise ValueError("No segmentation masks provided")

    # Determine image dimensions from the reference DICOMs
    rows = int(ref_dcms[0].Rows)
    cols = int(ref_dcms[0].Columns)
    n_slices = len(ref_dcms)

    # Build a combined pixel array: shape (n_segments, n_slices, rows, cols)
    sorted_names = sorted(masks.keys())
    seg_pixel_array = np.zeros((len(sorted_names), n_slices, rows, cols), dtype=np.uint8)

    for seg_idx, name in enumerate(sorted_names):
        nifti_path = masks[name]
        nii = nib.load(str(nifti_path))
        data = nib.as_closest_canonical(nii).get_fdata().astype(np.uint8)

        # TotalSegmentator output is (X, Y, Z); DICOM is (slices, rows, cols)
        # Resample to match DICOM dimensions if needed
        if data.shape != (cols, rows, n_slices):
            # Use SimpleITK for resampling
            sitk_mask = sitk.GetImageFromArray(data.transpose(2, 1, 0))
            ref_size = (n_slices, rows, cols)
            resampler = sitk.ResampleImageFilter()
            resampler.SetSize([n_slices, cols, rows])
            resampler.SetInterpolator(sitk.sitkNearestNeighbor)
            sitk_resampled = resampler.Execute(sitk_mask)
            data = sitk.GetArrayFromImage(sitk_resampled).astype(np.uint8)
        else:
            data = data.transpose(2, 1, 0)  # → (slices, rows, cols)

        seg_pixel_array[seg_idx] = (data > 0).astype(np.uint8)

    # Build SegmentDescription list
    segment_descriptions = []
    for seg_idx, name in enumerate(sorted_names):
        label = structure_labels.get(name, name.replace("_", " ").title())
        color = _get_color(name, seg_idx)

        desc = SegmentDescription(
            segment_number=seg_idx + 1,
            segment_label=label,
            segmented_property_category=CodedConcept(
                value="123037004",
                scheme_designator="SCT",
                meaning="Body Structure",
            ),
            segmented_property_type=CodedConcept(
                value="113225006",
                scheme_designator="SCT",
                meaning=label,
            ),
            algorithm_type=hd.seg.SegmentAlgorithmTypeValues.AUTOMATIC,
            algorithm_identification=hd.AlgorithmIdentificationSequence(
                name="TotalSegmentator",
                version="2.x",
                family=CodedConcept("123109006", "SCT", "Segmentation Algorithm"),
            ),
            recommended_display_rgb_value=color,
        )
        segment_descriptions.append(desc)

    seg = Segmentation(
        source_images=ref_dcms,
        pixel_array=seg_pixel_array,
        segmentation_type=SegmentationTypeValues.BINARY,
        segment_descriptions=segment_descriptions,
        series_instance_uid=hd.UID(),
        sop_instance_uid=hd.UID(),
        series_number=900,
        instance_number=1,
        manufacturer="WiseSpine",
        manufacturer_model_name="TotalSegmentator",
        software_versions="2.x",
        device_serial_number="WS-001",
    )

    return seg


# ─── STOW-RS upload ───────────────────────────────────────────────────────────

def store_dicom_seg(seg: Segmentation) -> str:
    """
    Upload a DICOM SEG to Orthanc via STOW-RS.

    Returns the SeriesInstanceUID of the uploaded segmentation.
    """
    boundary = uuid.uuid4().hex
    dicom_bytes = seg.to_bytes()

    body = (
        f"--{boundary}\r\n"
        f"Content-Type: application/dicom\r\n\r\n"
    ).encode() + dicom_bytes + f"\r\n--{boundary}--\r\n".encode()

    headers = {
        "Content-Type": f"multipart/related; type=\"application/dicom\"; boundary={boundary}",
        "Accept": "application/json",
    }

    url = f"{DICOMWEB_BASE}/studies"
    r = httpx.post(url, content=body, headers=headers, timeout=120)
    r.raise_for_status()

    return str(seg.SeriesInstanceUID)
