"""
WiseSpine Segmentation Service — FastAPI app.

Endpoints:
  GET  /health                  Health check
  POST /segment                 Start a segmentation job (returns job_id immediately)
  GET  /segment/{job_id}        Poll job status

The service:
  1. Fetches a DICOM CT series from Orthanc via DICOMweb
  2. Runs TotalSegmentator (spine structures, fast CPU mode)
  3. Converts NIfTI output → DICOM SEG (highdicom)
  4. Uploads the DICOM SEG back to Orthanc via STOW-RS
  5. Returns the new SeriesInstanceUID

Start: python -m uvicorn main:app --port 8001
"""

import json
import logging
import tempfile
import time
import traceback
import uuid
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from dicom_utils import fetch_series_dicom, masks_to_dicom_seg, store_dicom_seg
from segmentor import STRUCTURE_LABELS, run_totalsegmentator

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

class SegmentRequest(BaseModel):
    studyInstanceUID: str
    seriesInstanceUID: str


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


def _run_job(job_id: str, study_uid: str, series_uid: str) -> None:
    """Full pipeline: fetch → segment → convert → upload."""
    start_time = time.time()
    _update_job(job_id, status="running", stage="fetch",
                message="Fetching DICOM series from Orthanc…",
                started_at=start_time)

    try:
        with tempfile.TemporaryDirectory(prefix="wisespine_seg_") as tmpdir:
            tmp = Path(tmpdir)
            dicom_dir = tmp / "dicom"
            dicom_dir.mkdir()
            seg_output_dir = tmp / "seg"
            seg_output_dir.mkdir()

            # 1. Download DICOM series
            logger.info("[%s] Fetching series %s", job_id, series_uid)
            ref_dcms = fetch_series_dicom(study_uid, series_uid, dicom_dir)
            logger.info("[%s] Running TotalSegmentator on %d slices", job_id, len(ref_dcms))
            _update_job(
                job_id,
                stage="segment",
                elapsed_seconds=int(time.time() - start_time),
                message=f"Running TotalSegmentator on {len(ref_dcms)} slices (CPU ~15 min)…",
            )

            # 2. Run TotalSegmentator
            masks = run_totalsegmentator(dicom_dir, seg_output_dir)
            if not masks:
                raise RuntimeError("TotalSegmentator produced no output masks.")
            logger.info("[%s] Got %d segments: %s", job_id, len(masks), list(masks.keys()))
            _update_job(
                job_id,
                stage="convert",
                elapsed_seconds=int(time.time() - start_time),
                message=f"Creating DICOM SEG for {len(masks)} structures…",
            )

            # 3. Convert NIfTI masks → DICOM SEG
            seg = masks_to_dicom_seg(ref_dcms, masks, STRUCTURE_LABELS)

            # 4. Upload to Orthanc
            _update_job(
                job_id,
                stage="upload",
                elapsed_seconds=int(time.time() - start_time),
                message="Uploading DICOM SEG to Orthanc…",
            )
            new_series_uid = store_dicom_seg(seg)
            logger.info("[%s] Uploaded DICOM SEG, series UID: %s", job_id, new_series_uid)

        _update_job(
            job_id,
            status="completed",
            stage="done",
            elapsed_seconds=int(time.time() - start_time),
            message="Segmentation complete.",
            seriesInstanceUID=new_series_uid,
            segments=[
                STRUCTURE_LABELS.get(n, n.replace("_", " ").title())
                for n in sorted(masks.keys())
            ],
        )

    except Exception as exc:
        logger.error("[%s] Job failed: %s", job_id, exc)
        logger.error(traceback.format_exc())
        _update_job(job_id, status="error",
                    elapsed_seconds=int(time.time() - start_time),
                    message=str(exc))


# ─── Routes ──────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "service": "wisespine-seg-service"}


@app.post("/segment", response_model=JobStatus, status_code=202)
def start_segment(body: SegmentRequest, background_tasks: BackgroundTasks):
    """Start a segmentation job and return immediately with a job_id."""
    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "stage": "queued",
        "message": "Job queued, waiting to start…",
        "elapsed_seconds": 0,
        "segments": [],
        "seriesInstanceUID": "",
    }
    _save_jobs(jobs)
    background_tasks.add_task(
        _run_job, job_id, body.studyInstanceUID, body.seriesInstanceUID
    )
    logger.info("Queued job %s for series %s", job_id, body.seriesInstanceUID)
    return jobs[job_id]


@app.get("/segment/{job_id}", response_model=JobStatus)
def get_job_status(job_id: str):
    """Poll the status of a segmentation job."""
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    return jobs[job_id]
