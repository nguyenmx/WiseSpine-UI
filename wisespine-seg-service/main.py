"""
WiseSpine Segmentation Service — FastAPI app.

Endpoints:
  GET  /health                  Health check
  POST /upload                  Upload a segmentation mask (.nii/.nii.gz/.dcm)
  GET  /upload/{job_id}         Poll upload job status

Start: python -m uvicorn main:app --port 8001
"""

import json
import logging
import shutil
import tempfile
import time
import traceback
import uuid
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from dicom_utils import (
    fetch_series_dicom,
    store_dicom_seg,
    store_dicom_seg_bytes,
    label_nifti_to_dicom_seg,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="WiseSpine Segmentation Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Persistent job store ─────────────────────────────────────────────────────
# Jobs are written to a JSON file so they survive service restarts.

JOBS_FILE = Path(tempfile.gettempdir()) / "wisespine_jobs.json"


def _load_jobs() -> dict:
    if JOBS_FILE.exists():
        try:
            return json.loads(JOBS_FILE.read_text())
        except Exception:
            pass
    return {}


def _save_jobs(jobs: dict) -> None:
    try:
        JOBS_FILE.write_text(json.dumps(jobs, indent=2))
    except Exception as e:
        logger.warning("Could not persist jobs file: %s", e)


# Load existing jobs on startup (survives --reload / restarts)
jobs: dict[str, dict] = _load_jobs()


# ─── Models ──────────────────────────────────────────────────────────────────

class JobStatus(BaseModel):
    job_id: str
    status: str          # queued | running | completed | error
    message: str = ""
    stage: str = ""      # fetch | segment | convert | upload | done
    elapsed_seconds: int = 0          # seconds since job started
    segments: list[str] = []          # human-readable segment labels when done
    seriesInstanceUID: str = ""       # new DICOM SEG series UID when done


# ─── Background task ─────────────────────────────────────────────────────────

def _update_job(job_id: str, **kwargs) -> None:
    """Update job state in memory and persist to disk."""
    jobs[job_id].update(kwargs)
    _save_jobs(jobs)


# ─── Routes ──────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "service": "wisespine-seg-service"}


# ─── Mask upload pipeline ─────────────────────────────────────────────────────

def _run_upload_job(
    job_id: str,
    file_path: str,
    filename: str,
    study_uid: str,
    series_uid: str,
) -> None:
    """Upload pipeline for a user-supplied mask file.

    .dcm  → upload directly to Orthanc (no conversion needed)
    .nii / .nii.gz → fetch reference DICOMs → convert to DICOM SEG → upload
    """
    start_time = time.time()
    tmp_file = Path(file_path)

    try:
        is_nifti = filename.endswith(".nii.gz") or filename.endswith(".nii")
        is_dicom = filename.endswith(".dcm")

        if not is_nifti and not is_dicom:
            raise ValueError(f"Unsupported file type: {filename}. Use .nii, .nii.gz, or .dcm")

        if is_dicom:
            # Direct upload — no conversion needed
            _update_job(job_id, status="running", stage="upload",
                        message="Uploading DICOM SEG to Orthanc…",
                        started_at=start_time)
            new_series_uid = store_dicom_seg_bytes(tmp_file.read_bytes())
            _update_job(job_id, status="completed", stage="done",
                        elapsed_seconds=int(time.time() - start_time),
                        message="Mask uploaded successfully.",
                        seriesInstanceUID=new_series_uid,
                        segments=[])

        else:
            # NIfTI → fetch refs → convert → upload
            with tempfile.TemporaryDirectory(prefix="wisespine_upload_") as tmpdir:
                tmp = Path(tmpdir)
                dicom_dir = tmp / "dicom"
                dicom_dir.mkdir()

                _update_job(job_id, status="running", stage="fetch",
                            message="Fetching reference DICOM series from Orthanc…",
                            started_at=start_time)
                ref_dcms = fetch_series_dicom(study_uid, series_uid, dicom_dir)
                logger.info("[%s] Fetched %d reference slices", job_id, len(ref_dcms))

                _update_job(job_id, stage="convert",
                            elapsed_seconds=int(time.time() - start_time),
                            message=f"Converting NIfTI mask to DICOM SEG ({len(ref_dcms)} slices)…")
                seg = label_nifti_to_dicom_seg(ref_dcms, tmp_file)

                shutil.rmtree(dicom_dir, ignore_errors=True)

                _update_job(job_id, stage="upload",
                            elapsed_seconds=int(time.time() - start_time),
                            message="Uploading DICOM SEG to Orthanc…")
                new_series_uid = store_dicom_seg(seg)
                logger.info("[%s] Uploaded mask, series UID: %s", job_id, new_series_uid)

            segment_labels = [desc.segment_label for desc in seg.SegmentSequence]
            _update_job(job_id, status="completed", stage="done",
                        elapsed_seconds=int(time.time() - start_time),
                        message="Mask uploaded successfully.",
                        seriesInstanceUID=new_series_uid,
                        segments=segment_labels)

    except Exception as exc:
        logger.error("[%s] Upload job failed: %s", job_id, exc)
        logger.error(traceback.format_exc())
        _update_job(job_id, status="error",
                    elapsed_seconds=int(time.time() - start_time),
                    message=str(exc))
    finally:
        tmp_file.unlink(missing_ok=True)


@app.post("/upload", response_model=JobStatus, status_code=202)
async def upload_mask(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    studyInstanceUID: str = Form(...),
    seriesInstanceUID: str = Form(...),
):
    """Accept a segmentation mask upload (.nii, .nii.gz, or .dcm) and process it."""
    # Save the uploaded file to a temp path that persists past the request
    suffix = "".join(Path(file.filename or "mask.nii.gz").suffixes[-2:])
    tmp_fd, tmp_path = tempfile.mkstemp(prefix="wisespine_mask_", suffix=suffix)
    try:
        contents = await file.read()
        with open(tmp_fd, "wb") as f:
            f.write(contents)
    except Exception:
        import os; os.close(tmp_fd)
        raise

    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "stage": "queued",
        "message": "Upload queued…",
        "elapsed_seconds": 0,
        "segments": [],
        "seriesInstanceUID": "",
    }
    _save_jobs(jobs)
    background_tasks.add_task(
        _run_upload_job,
        job_id,
        tmp_path,
        file.filename or "mask.nii.gz",
        studyInstanceUID,
        seriesInstanceUID,
    )
    logger.info("Queued upload job %s for file %s", job_id, file.filename)
    return jobs[job_id]


@app.get("/upload/{job_id}", response_model=JobStatus)
def get_upload_status(job_id: str):
    """Poll the status of a mask upload job."""
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    return jobs[job_id]
