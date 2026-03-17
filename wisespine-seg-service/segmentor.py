"""
TotalSegmentator wrapper for spine segmentation.

Runs the 'total' task with --fast and --roi_subset limited to spine
structures so only relevant structures are computed, reducing CPU time.
"""

import os
from pathlib import Path

# Use all available CPU cores for PyTorch / OpenMP inference
_CPU_CORES = os.cpu_count() or 4
os.environ.setdefault("OMP_NUM_THREADS", str(_CPU_CORES))
os.environ.setdefault("MKL_NUM_THREADS", str(_CPU_CORES))

# Spine structures supported by TotalSegmentator v2 'total' task
SPINE_ROI = [
    "vertebrae_C1", "vertebrae_C2", "vertebrae_C3", "vertebrae_C4",
    "vertebrae_C5", "vertebrae_C6", "vertebrae_C7",
    "vertebrae_T1", "vertebrae_T2", "vertebrae_T3", "vertebrae_T4",
    "vertebrae_T5", "vertebrae_T6", "vertebrae_T7", "vertebrae_T8",
    "vertebrae_T9", "vertebrae_T10", "vertebrae_T11", "vertebrae_T12",
    "vertebrae_L1", "vertebrae_L2", "vertebrae_L3", "vertebrae_L4",
    "vertebrae_L5",
    "sacrum",
    "spinal_cord",
]

# Human-readable labels used in the DICOM SEG
STRUCTURE_LABELS = {
    "vertebrae_C1": "C1 Vertebra", "vertebrae_C2": "C2 Vertebra",
    "vertebrae_C3": "C3 Vertebra", "vertebrae_C4": "C4 Vertebra",
    "vertebrae_C5": "C5 Vertebra", "vertebrae_C6": "C6 Vertebra",
    "vertebrae_C7": "C7 Vertebra",
    "vertebrae_T1": "T1 Vertebra", "vertebrae_T2": "T2 Vertebra",
    "vertebrae_T3": "T3 Vertebra", "vertebrae_T4": "T4 Vertebra",
    "vertebrae_T5": "T5 Vertebra", "vertebrae_T6": "T6 Vertebra",
    "vertebrae_T7": "T7 Vertebra", "vertebrae_T8": "T8 Vertebra",
    "vertebrae_T9": "T9 Vertebra", "vertebrae_T10": "T10 Vertebra",
    "vertebrae_T11": "T11 Vertebra", "vertebrae_T12": "T12 Vertebra",
    "vertebrae_L1": "L1 Vertebra", "vertebrae_L2": "L2 Vertebra",
    "vertebrae_L3": "L3 Vertebra", "vertebrae_L4": "L4 Vertebra",
    "vertebrae_L5": "L5 Vertebra",
    "sacrum": "Sacrum",
    "spinal_cord": "Spinal Cord",
}


def run_totalsegmentator(dicom_dir: Path, output_dir: Path) -> dict:
    """
    Run TotalSegmentator on a directory of DICOM files.

    Args:
        dicom_dir: Directory containing the input DICOM series.
        output_dir: Directory where NIfTI segmentation masks will be written.

    Returns:
        dict mapping structure name → Path of the output NIfTI mask file,
        for every structure that was successfully segmented.
    """
    import torch
    from totalsegmentator.python_api import totalsegmentator

    torch.set_num_threads(_CPU_CORES)

    totalsegmentator(
        input=dicom_dir,
        output=output_dir,
        task="total",
        roi_subset=SPINE_ROI,
        fast=True,            # low-resolution nnU-Net model — faster on CPU
        device="cpu",
        nr_thr_resamp=_CPU_CORES,
        nr_thr_saving=_CPU_CORES,
        quiet=True,
        verbose=False,
    )

    found = {}
    for name in SPINE_ROI:
        path = output_dir / f"{name}.nii.gz"
        if path.exists():
            found[name] = path

    return found


def get_label(structure_name: str) -> str:
    """Return a human-readable label for a TotalSegmentator structure name."""
    return STRUCTURE_LABELS.get(structure_name, structure_name.replace("_", " ").title())
