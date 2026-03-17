# WiseSpine Segmentation Service

FastAPI microservice that runs TotalSegmentator on CT spine series and uploads the result back to Orthanc as DICOM SEG.

## What it does

1. Receives a `studyInstanceUID` + `seriesInstanceUID` from OHIF
2. Downloads the CT series from Orthanc via DICOMweb WADO-RS
3. Runs TotalSegmentator (spine structures: vertebrae C1–S5, spinal cord)
4. Converts output NIfTI masks → DICOM SEG (highdicom)
5. Uploads the DICOM SEG back to Orthanc via STOW-RS
6. Returns the new SeriesInstanceUID to OHIF

## Requirements

- Python 3.11+
- Orthanc running (Docker Compose stack at `localhost:80`)
- ~4 GB free RAM, ~2 GB disk for model weights

## Local development setup

```bash
cd wisespine-seg-service

# Create a virtual environment (recommended)
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Start the service
python -m uvicorn main:app --port 8001
```

The first segmentation job will download TotalSegmentator model weights (~1.2 GB) and cache them in `~/.totalsegmentator/`. Subsequent runs use the cache.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `ORTHANC_BASE_URL` | `http://localhost/orthanc-container` | Orthanc DICOMweb base URL |

## API

### `GET /health`
Returns `{"status": "ok"}` if the service is running.

### `POST /segment`
Start a segmentation job.

**Request body:**
```json
{
  "studyInstanceUID": "1.2.3.4...",
  "seriesInstanceUID": "1.2.3.5..."
}
```

**Response (202):**
```json
{
  "job_id": "550e8400-...",
  "status": "queued",
  "message": "Job queued, waiting to start…"
}
```

### `GET /segment/{job_id}`
Poll job status.

**Response:**
```json
{
  "job_id": "550e8400-...",
  "status": "completed",          // queued | running | completed | error
  "message": "Segmentation complete.",
  "segments": ["L1 Vertebra", "L2 Vertebra", "Spinal Cord", ...],
  "seriesInstanceUID": "1.2.3.999..."
}
```

## Expected processing time (CPU)

TotalSegmentator runs in `--fast` mode with `--roi_subset` limited to spine structures:

| Scan type | Approximate time |
|---|---|
| Lumbar spine (50–80 slices) | ~5–8 min |
| Full spine CT (200+ slices) | ~15–20 min |

A GPU reduces this to ~30–90 seconds. Set `device="gpu"` in `segmentor.py` to enable.

## Docker (optional)

To run as part of the Docker Compose stack, add this to `orthanc-setup-samples/docker/ohif/docker-compose.yml`:

```yaml
  wisespine-seg:
    build: ../../../../wisespine-seg-service
    ports:
      - "8001:8001"
    environment:
      ORTHANC_BASE_URL: http://nginx/orthanc-container
    depends_on:
      - nginx
```
