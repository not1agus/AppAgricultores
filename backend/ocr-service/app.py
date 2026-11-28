"""OCR sidecar for the AppAgricultores backend.

Exposes a single endpoint the Node/TS backend calls:

    POST /ocr   { "imageUrl": "<url>" }
    -> 200      { "engine", "text", "avgConfidence", "lines": [...] }

This service is stateless; authentication and authorization happen in the
Node backend before the image URL is forwarded. Keep it on a private
network or behind the same gateway.

OCR engine
----------
We use RapidOCR (`rapidocr-onnxruntime`). It runs the very same detection /
recognition models as PaddleOCR, but on ONNX Runtime instead of the
`paddlepaddle` framework. That matters in practice because `paddlepaddle`
ships precompiled wheels only for a lagging subset of Python versions and
platforms — on a fresh Windows box with Python 3.12+ the install simply
fails. RapidOCR is pure-pip, has wheels everywhere, and the recognition
quality for printed receipts (our use case: tickets de almazara) is
equivalent. The HTTP contract below is unchanged, so the Node side does
not care which engine produced the text.
"""
from __future__ import annotations

import io
import logging
import os
from typing import List, Optional

import httpx
import numpy as np
from fastapi import FastAPI, HTTPException
from PIL import Image
from pydantic import BaseModel, HttpUrl
from rapidocr_onnxruntime import RapidOCR

# Register the HEIC/HEIF opener so Pillow can decode iPhone photos. iOS
# cameras save to HEIC by default; without this, Image.open() raises on
# every photo a user takes on an iPhone and the whole ticket OCR fails.
try:
    from pillow_heif import register_heif_opener

    register_heif_opener()
except ImportError:  # pragma: no cover - optional dependency
    logging.getLogger("ocr-service").warning(
        "pillow-heif not installed; HEIC/HEIF images will not decode"
    )

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ocr-service")

FETCH_TIMEOUT_S = float(os.getenv("OCR_FETCH_TIMEOUT_S", "20"))
MAX_IMAGE_BYTES = int(os.getenv("OCR_MAX_IMAGE_BYTES", str(15 * 1024 * 1024)))

app = FastAPI(title="AppAgricultores OCR")

# RapidOCR loads ~15 MB of ONNX models on first use; keep one instance per
# process so subsequent requests are warm.
_ocr: Optional[RapidOCR] = None


def get_ocr() -> RapidOCR:
    global _ocr
    if _ocr is None:
        logger.info("Initializing RapidOCR")
        _ocr = RapidOCR()
    return _ocr


class OcrRequest(BaseModel):
    imageUrl: HttpUrl


class OcrLine(BaseModel):
    text: str
    confidence: float
    # Axis-aligned bounding box [xMin, yMin, xMax, yMax] in pixels. The Node
    # backend uses it to associate labels with their values spatially — a
    # receipt is a table, and without geometry "Rendimiento:" and its number
    # are just two unrelated lines of flat text.
    box: Optional[List[float]] = None


class OcrResponse(BaseModel):
    engine: str = "rapidocr"
    text: str
    avgConfidence: Optional[float] = None
    lines: List[OcrLine] = []


def fetch_image(url: str) -> bytes:
    try:
        with httpx.Client(timeout=FETCH_TIMEOUT_S, follow_redirects=True) as client:
            resp = client.get(url)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch image: {e}")
    if resp.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=f"Image URL returned status {resp.status_code}",
        )
    if len(resp.content) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image too large")
    return resp.content


def decode_image(image_bytes: bytes) -> np.ndarray:
    """Decode arbitrary image bytes (JPEG/PNG/HEIC-as-JPEG/etc.) into an RGB
    ndarray RapidOCR can consume. We go through Pillow rather than cv2 so
    EXIF orientation is respected — phone photos of receipts are often
    rotated, and a sideways image tanks recognition accuracy."""
    try:
        img = Image.open(io.BytesIO(image_bytes))
        img = img.convert("RGB")
        return np.asarray(img)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Could not decode image: {e}")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/ocr", response_model=OcrResponse)
def ocr(req: OcrRequest) -> OcrResponse:
    image_bytes = fetch_image(str(req.imageUrl))
    img = decode_image(image_bytes)

    try:
        # RapidOCR returns (result, elapse). `result` is a list of
        # [box, text, score] or None when nothing is detected.
        result, _elapse = get_ocr()(img)
    except Exception as e:  # noqa: BLE001
        logger.exception("RapidOCR failed")
        raise HTTPException(status_code=500, detail=f"OCR failed: {e}")

    lines: List[OcrLine] = []
    for entry in result or []:
        try:
            box, text, score = entry
        except (TypeError, ValueError):
            continue
        text = (text or "").strip()
        if not text:
            continue
        try:
            conf = float(score)
        except (TypeError, ValueError):
            conf = 0.0
        # box is a list/array of 4 [x, y] corner points. Reduce to an
        # axis-aligned [xMin, yMin, xMax, yMax]. Defensive: tolerate a
        # malformed box by emitting None rather than failing the whole OCR.
        bbox: Optional[List[float]] = None
        try:
            xs = [float(p[0]) for p in box]
            ys = [float(p[1]) for p in box]
            bbox = [min(xs), min(ys), max(xs), max(ys)]
        except (TypeError, ValueError, IndexError):
            bbox = None
        lines.append(OcrLine(text=text, confidence=conf, box=bbox))

    if not lines:
        return OcrResponse(text="", avgConfidence=None, lines=[])

    avg = sum(l.confidence for l in lines) / len(lines)
    return OcrResponse(
        text="\n".join(l.text for l in lines),
        avgConfidence=round(avg, 4),
        lines=lines,
    )
