"""
Convert a NIfTI CT image to a DICOM series using SimpleITK.

Usage:
    python nifti_ct_to_dicom.py \
        --input  sub-gl003_dir-ax_ct.nii \
        --output sub-gl003_ct_dicom

Output: one .dcm file per slice inside the output directory.
"""

import argparse
import sys
import time
from pathlib import Path

import SimpleITK as sitk


def nifti_to_dicom_series(nifti_path: Path, output_dir: Path, patient_id: str) -> None:
    print(f"Reading: {nifti_path}")
    image = sitk.ReadImage(str(nifti_path))

    output_dir.mkdir(parents=True, exist_ok=True)

    # Shared UIDs and identifiers for the whole series
    study_uid  = sitk.ImageSeriesReader.GetGDCMSeriesIDs  # not used directly
    study_uid  = "1.2.826.0.1.3680043.0." + str(int(time.time()))
    series_uid = study_uid + ".1"

    n_slices = image.GetDepth()
    if n_slices == 0:
        sys.exit("ERROR: Image has no depth — is this a 3-D volume?")

    print(f"Writing {n_slices} slices to: {output_dir}")

    writer = sitk.ImageFileWriter()
    writer.KeepOriginalImageUIDOn()

    modification_date = time.strftime("%Y%m%d")
    modification_time = time.strftime("%H%M%S")

    for i in range(n_slices):
        slice_img = image[:, :, i]

        # ── Required DICOM tags ─────────────────────────────────────────────
        slice_img.SetMetaData("0008|0031", modification_time)   # Series Time
        slice_img.SetMetaData("0008|0021", modification_date)   # Series Date
        slice_img.SetMetaData("0008|0008", "DERIVED\\SECONDARY") # Image Type
        slice_img.SetMetaData("0020|000d", study_uid)            # Study Instance UID
        slice_img.SetMetaData("0020|000e", series_uid)           # Series Instance UID
        slice_img.SetMetaData("0020|0037",                       # Image Orientation Patient
            "\\".join(["1", "0", "0", "0", "1", "0"]))
        slice_img.SetMetaData("0008|103e", "CT from NIfTI")      # Series Description
        slice_img.SetMetaData("0010|0020", patient_id)           # Patient ID
        slice_img.SetMetaData("0010|0010", patient_id)           # Patient Name
        slice_img.SetMetaData("0020|0013", str(i + 1))           # Instance Number
        slice_img.SetMetaData("0020|0032",                       # Image Position Patient
            "\\".join(str(v) for v in image.TransformIndexToPhysicalPoint([0, 0, i])))

        # SOP Instance UID — unique per slice
        slice_img.SetMetaData("0008|0018", series_uid + f".{i + 1}")
        slice_img.SetMetaData("0002|0003", series_uid + f".{i + 1}")

        out_path = output_dir / f"slice_{i+1:04d}.dcm"
        writer.SetFileName(str(out_path))
        writer.Execute(slice_img)

    print(f"\nDone. {n_slices} DICOM slices written to: {output_dir.resolve()}")
    print(f"Study  UID : {study_uid}")
    print(f"Series UID : {series_uid}")
    print(f"\nNext step — run itkimage2segimage:")
    print(f"  itkimage2segimage \\")
    print(f"    --inputImageList sub-gl003_dir-ax_seg-vert_msk.nii \\")
    print(f"    --inputDICOMDirectory {output_dir} \\")
    print(f"    --outputDICOM sub-gl003_seg.dcm \\")
    print(f"    --inputMetadata seg_meta.json")


def main() -> None:
    parser = argparse.ArgumentParser(description="NIfTI CT → DICOM series")
    parser.add_argument("--input",  required=True, help="Input NIfTI file (.nii or .nii.gz)")
    parser.add_argument("--output", default="ct_dicom", help="Output directory (default: ct_dicom)")
    parser.add_argument("--patient-id", default="patient1", help="Patient ID tag (default: patient1)")
    args = parser.parse_args()

    nifti_to_dicom_series(
        nifti_path=Path(args.input),
        output_dir=Path(args.output),
        patient_id=args.patient_id,
    )


if __name__ == "__main__":
    main()
