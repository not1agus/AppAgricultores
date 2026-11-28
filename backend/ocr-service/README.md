# OCR sidecar (RapidOCR)

Python FastAPI service that wraps RapidOCR for ticket scanning. The Node
backend talks to it over HTTP (`OCR_SERVICE_URL`). It exists as a sidecar
because the OCR engine has no Node binding.

RapidOCR runs the same detection/recognition models as PaddleOCR but on
ONNX Runtime instead of the `paddlepaddle` framework. This is a pure-pip
install with wheels for every modern Python (3.8–3.12+) and platform —
`paddlepaddle` ships wheels only for a lagging subset and fails to install
on recent Python versions.

## Run locally

Requires **Python 3.10–3.12** (not 3.13/3.14 — onnxruntime wheels lag the
newest releases). On Windows, if your default `python` is 3.13+, install
3.12 from python.org and create the venv with `py -3.12`.

    cd backend/ocr-service
    py -3.12 -m venv .venv          # or: python -m venv .venv
    .venv\Scripts\activate          # Windows; on Unix: . .venv/bin/activate
    pip install -r requirements.txt
    uvicorn app:app --host 0.0.0.0 --port 8001

Then set in the backend env:

    OCR_SERVICE_URL=http://localhost:8001
    OCR_SERVICE_TIMEOUT_MS=30000

## Endpoints

- `GET /health` – liveness probe.
- `POST /ocr` – body: `{ "imageUrl": "<https url>" }`. Returns
  `{ engine, text, avgConfidence, lines: [{text, confidence}] }`.

## Env

- `OCR_LANG` (default `es`) – PaddleOCR language model.
- `OCR_FETCH_TIMEOUT_S` (default `20`) – timeout when downloading the image.
- `OCR_MAX_IMAGE_BYTES` (default `15 MiB`) – reject larger images with 413.

## Security

No auth of its own — run on a private network or behind the same gateway
as the Node backend. The Node side enforces user/role checks before
forwarding the image URL.
