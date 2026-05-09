from __future__ import annotations

from pathlib import Path
from typing import Any
import os
import sys

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

CV_SERVICE_SECRET = os.environ.get("CV_SERVICE_SECRET", "")

# Reuse the existing deterministic CV extractor implementation.
ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from cv_graph_extract import extract_graph_cv  # type: ignore  # noqa: E402


class ExtractRequest(BaseModel):
    images: list[str]
    mediaType: str | None = None


app = FastAPI(title="Graph Lab CV Service", version="1.0.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/extract")
async def extract(request: Request, req: ExtractRequest) -> JSONResponse:
    request_id = request.headers.get("X-Request-Id", "")
    upstream_input_sha256 = request.headers.get("X-Input-Sha256", "")

    if CV_SERVICE_SECRET:
        incoming = request.headers.get("X-CV-Secret", "")
        if incoming != CV_SERVICE_SECRET:
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
    if not req.images:
        return JSONResponse({"error": "At least one image is required"}, status_code=400)

    try:
        result: dict[str, Any] = extract_graph_cv(req.images[0])
    except Exception as exc:  # pragma: no cover - defensive runtime guard
        return JSONResponse(
            {
                "error": f"CV extraction failed: {exc}",
                "warnings": ["Python extractor raised an exception"],
                "feedback": [],
            },
            status_code=500,
        )

    if result.get("error"):
        metadata = (result.get("metadata") or {})
        if isinstance(metadata, dict):
            metadata = {
                **metadata,
                "requestTrace": {
                    "requestId": request_id,
                    "upstreamInputSha256": upstream_input_sha256,
                },
            }
        return JSONResponse(
            {
                "error": result.get("error"),
                "graphSpec": result.get("graphSpec"),
                "graphMeta": result.get("graphMeta"),
                "warnings": ((result.get("metadata") or {}).get("warnings") or []),
                "feedback": result.get("feedback")
                or ["Manual review required before accepting extraction output."],
                "metadata": metadata,
            },
            status_code=422,
        )

    metadata = (result.get("metadata") or {})
    if isinstance(metadata, dict):
        metadata = {
            **metadata,
            "requestTrace": {
                "requestId": request_id,
                "upstreamInputSha256": upstream_input_sha256,
            },
        }

    return JSONResponse(
        {
            "graphSpec": result.get("graphSpec"),
            "graphMeta": result.get("graphMeta"),
            "warnings": ((result.get("metadata") or {}).get("warnings") or []),
            "feedback": result.get("feedback")
            or [
                "CV extraction is deterministic and based on actual image data.",
                "Review the selected curve family, confidence, and domain bounds.",
                "Fallback piecewise output is used only when family-fit confidence is insufficient.",
            ],
            "metadata": metadata,
        },
        status_code=200,
    )
