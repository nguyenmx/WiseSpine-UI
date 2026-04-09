"""
Generate a spine segmentation mask for a local DICOM series using TotalSegmentator (nnU-Net).

Usage:
    python generate_mask.py [--series SE000009] [--out data/SE000009_seg.nii.gz]

Output: a single multi-label NIfTI where each integer corresponds to one
spine structure (vertebrae, sacrum, spinal cord).  Upload this file via
the WiseSpine frontend mask uploader.
"""

import argparse
import shutil
import tempfile
from pathlib import Path

import numpy as np
import nibabel as nib

# ── Label mapping ──────────────────────────────────────────────────────────────
# Matches the order in segmentor.SPINE_ROI; label 0 is background.
from segmentor import SPINE_ROI, run_totalsegmentator

LABEL_MAP: dict[str, int] = {name: idx + 1 for idx, name in enumerate(SPINE_ROI)}


# ── Helpers ────────────────────────────────────────────────────────────────────

def _merge_niftis(masks: dict[str, Path], ref_path: Path) -> nib.Nifti1Image:
    """
    Stack per-structure binary NIfTIs into a single integer-label volume.

    Priority: lower label index wins if two structures overlap.
    """
    ref = nib.load(str(ref_path))
    combined = np.zeros(ref.shape, dtype=np.int16)

    # Iterate in reverse so lower indices overwrite higher ones
    for name, path in reversed(list(masks.items())):
        data = np.asarray(nib.load(str(path)).dataobj, dtype=np.uint8)
        combined[data > 0] = LABEL_MAP[name]

    return nib.Nifti1Image(combined, ref.affine, ref.header)


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Generate spine segmentation mask (nnU-Net / TotalSegmentator)")
    parser.add_argument(
        "--series",
        default="SE000009",
        help="Series folder name inside data/SpineDicom/ST000001/ (default: SE000009)",
    )
    parser.add_argument(
        "--out",
        default=None,
        help="Output NIfTI path (default: data/<series>_seg.nii.gz)",
    )
    args = parser.parse_args()

    root = Path(__file__).parent
    dicom_dir = root / "data" / "SpineDicom" / "ST000001" / args.series
    out_path = Path(args.out) if args.out else root / "data" / f"{args.series}_seg.nii.gz"

    if not dicom_dir.exists():
        raise SystemExit(f"DICOM directory not found: {dicom_dir}")

    out_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"Input  : {dicom_dir}  ({len(list(dicom_dir.glob('*.dcm')))} slices)")
    print(f"Output : {out_path}")
    print()

    with tempfile.TemporaryDirectory(prefix="wisespine_seg_") as tmpdir:
        seg_dir = Path(tmpdir) / "segs"
        seg_dir.mkdir()

        # SE000009 (and other scouts/localizers) can have inconsistent slice
        # spacing. Disable dicom2nifti's strict validation so TotalSegmentator
        # can still convert and segment the series.
        import dicom2nifti.settings as d2n_settings
        d2n_settings.disable_validate_slice_increment()

        print("Running TotalSegmentator (nnU-Net)…  this may take a few minutes on CPU.")
        masks = run_totalsegmentator(dicom_dir, seg_dir)

        if not masks:
            raise SystemExit("TotalSegmentator produced no output masks. Check the DICOM series.")

        found = ", ".join(masks.keys())
        print(f"Segmented {len(masks)} structure(s): {found}")
        print("Merging into single label volume…")

        ref_path = next(iter(masks.values()))
        merged = _merge_niftis(masks, ref_path)

    nib.save(merged, str(out_path))
    print(f"\nDone. Mask saved to: {out_path}")
    print()
    print("Label index → structure:")
    for name, idx in LABEL_MAP.items():
        if name in masks:
            print(f"  {idx:3d}  {name}")


if __name__ == "__main__":
    main()
