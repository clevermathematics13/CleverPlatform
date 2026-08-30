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
from cv_crop_extract import (  # type: ignore  # noqa: E402
    Anchor,
    crop_page_count_mismatch,
    extract_crops,
    render_page_image,
)
from inspect_fillrects import inspect_fillrects  # type: ignore  # noqa: E402


class ExtractRequest(BaseModel):
    images: list[str]
    mediaType: str | None = None


class AnchorIn(BaseModel):
    qid: str
    pageIndex: int
    x0Pt: float
    y0Pt: float
    x1Pt: float
    y1Pt: float
    expandMaxX1Pt: float | None = None
    expandMaxY1Pt: float | None = None


class CropRequest(BaseModel):
    studentPdfBase64: str
    anchors: list[AnchorIn]
    expectedPageCount: int
    rotationHint: int = 0


class InspectFillrectsRequest(BaseModel):
    studentPdfBase64: str
    pageIndex: int


class HighlightBoxIn(BaseModel):
    x0Pt: float
    y0Pt: float
    x1Pt: float
    y1Pt: float


class PageImageRequest(BaseModel):
    studentPdfBase64: str
    pageIndex: int
    rotationHint: int = 0
    highlightBox: HighlightBoxIn | None = None


app = FastAPI(title="Graph Lab CV Service", version="1.4.0")


def _check_secret(request: Request) -> JSONResponse | None:
    if CV_SERVICE_SECRET:
        incoming = request.headers.get("X-CV-Secret", "")
        if incoming != CV_SERVICE_SECRET:
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
    return None


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/extract")
async def extract(request: Request, req: ExtractRequest) -> JSONResponse:
    request_id = request.headers.get("X-Request-Id", "")
    upstream_input_sha256 = request.headers.get("X-Input-Sha256", "")

    auth_err = _check_secret(request)
    if auth_err:
        return auth_err
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


@app.post("/crop")
async def crop(request: Request, req: CropRequest) -> JSONResponse:
    """
    NA scan pipeline stage 4. Extracts one image crop per anchor from a
    student's split packet PDF.

    Page mapping is deterministic (anchor.pageIndex -> the same 0-indexed
    page of the student's PDF), not AI-driven -- see cv_crop_extract.py's
    module docstring for the reasoning (98% of scans are clean/sequential,
    confirmed with the platform owner; page-identity matching exists as a
    validated fallback but is not run by default).

    Request carries the anchors directly rather than a packetVersionId,
    because this service has no database access -- the Next.js caller is
    responsible for fetching the locked na_anchors rows and passing them
    through.

    expectedPageCount lets the caller check for a page-count mismatch
    BEFORE calling this endpoint (via a separate lightweight check, or by
    inspecting the response's pageCountMismatch field here) -- a mismatch
    means the deterministic mapping assumption may not hold for this
    student and the pages should be reviewed rather than trusted blindly.
    """
    auth_err = _check_secret(request)
    if auth_err:
        return auth_err
    if not req.studentPdfBase64:
        return JSONResponse({"error": "studentPdfBase64 is required"}, status_code=400)
    if not req.anchors:
        return JSONResponse({"error": "At least one anchor is required"}, status_code=400)

    import base64 as _base64

    try:
        pdf_bytes = _base64.b64decode(req.studentPdfBase64)
    except Exception as exc:
        return JSONResponse(
            {"error": f"studentPdfBase64 could not be decoded: {exc}"}, status_code=400
        )

    try:
        actual_page_count = crop_page_count_mismatch(pdf_bytes, req.expectedPageCount)
    except Exception as exc:
        return JSONResponse(
            {"error": f"Could not read student PDF: {exc}"}, status_code=422
        )

    anchors = [
        Anchor(
            qid=a.qid,
            page_index=a.pageIndex,
            x0_pt=a.x0Pt,
            y0_pt=a.y0Pt,
            x1_pt=a.x1Pt,
            y1_pt=a.y1Pt,
            expand_max_x1_pt=a.expandMaxX1Pt,
            expand_max_y1_pt=a.expandMaxY1Pt,
        )
        for a in req.anchors
    ]

    try:
        results = extract_crops(pdf_bytes, anchors, rotation_hint=req.rotationHint)
    except Exception as exc:  # pragma: no cover - defensive runtime guard
        return JSONResponse(
            {"error": f"Crop extraction failed: {exc}"}, status_code=500
        )

    return JSONResponse(
        {
            "pageCountMismatch": actual_page_count,  # None if it matched
            "crops": [
                {
                    "qid": r.qid,
                    "pageIndex": r.page_index,
                    "imageBase64": r.image_base64,
                    "expanded": r.expanded,
                    "possiblyTruncated": r.possibly_truncated,
                    "warnings": r.warnings,
                }
                for r in results
            ],
        },
        status_code=200,
    )


@app.post("/page-image")
async def page_image(request: Request, req: PageImageRequest) -> JSONResponse:
    """
    Renders one full page of a student's split PDF, optionally with one
    box outlined in red -- the assess route's second pass, used only when
    a first pass (on the normal tight crop) reports a crossed-out answer
    with an arrow leaving the box. That crop by definition cannot show
    where the arrow points, so the model needs the whole page instead;
    see cv_crop_extract.render_page_image's docstring and
    na-assessment.ts's WIDE_CONTEXT_SYSTEM_PROMPT for the full reasoning.

    Not part of the normal stage 1-5 pipeline -- called on demand, per
    crop, only for the rare case that needs it.
    """
    auth_err = _check_secret(request)
    if auth_err:
        return auth_err
    if not req.studentPdfBase64:
        return JSONResponse({"error": "studentPdfBase64 is required"}, status_code=400)

    import base64 as _base64

    try:
        pdf_bytes = _base64.b64decode(req.studentPdfBase64)
    except Exception as exc:
        return JSONResponse(
            {"error": f"studentPdfBase64 could not be decoded: {exc}"}, status_code=400
        )

    highlight = (
        (req.highlightBox.x0Pt, req.highlightBox.y0Pt, req.highlightBox.x1Pt, req.highlightBox.y1Pt)
        if req.highlightBox is not None
        else None
    )

    try:
        png_bytes = render_page_image(
            pdf_bytes, req.pageIndex, rotation_hint=req.rotationHint, highlight_box=highlight
        )
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=422)
    except Exception as exc:  # pragma: no cover - defensive runtime guard
        return JSONResponse({"error": f"Page render failed: {exc}"}, status_code=500)

    return JSONResponse(
        {"imageBase64": _base64.b64encode(png_bytes).decode("ascii")},
        status_code=200,
    )


@app.post("/inspect-fillrects")
async def inspect_fillrects_endpoint(request: Request, req: InspectFillrectsRequest) -> JSONResponse:
    """
    Debug/authoring tool, NOT part of the stage 1-5 pipeline. Lists
    candidate answer-region rectangles on one page of a student's split
    PDF -- filled shapes (what the original auto_fillrect anchor
    extraction detects) and clustered stroke-only regions like ruled
    grids (what it would miss). Used to find real coordinates for a
    question whose anchor was never created, e.g. A.1's Q26(a) plotting
    grid. See inspect_fillrects.py's module docstring for the full
    reasoning and how the two candidate categories were verified.

    Read-only: returns candidates for a human to choose from, does not
    write to na_anchors.
    """
    auth_err = _check_secret(request)
    if auth_err:
        return auth_err
    if not req.studentPdfBase64:
        return JSONResponse({"error": "studentPdfBase64 is required"}, status_code=400)

    import base64 as _base64

    try:
        pdf_bytes = _base64.b64decode(req.studentPdfBase64)
    except Exception as exc:
        return JSONResponse({"error": f"studentPdfBase64 could not be decoded: {exc}"}, status_code=400)

    try:
        result = inspect_fillrects(pdf_bytes, req.pageIndex)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    except Exception as exc:  # pragma: no cover - defensive runtime guard
        return JSONResponse({"error": f"Inspection failed: {exc}"}, status_code=500)

    return JSONResponse(result, status_code=200)
