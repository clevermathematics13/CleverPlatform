#!/usr/bin/env python3
"""
cv_train_on_db.py — Run the CV graph extractor against all question images
in the Supabase database, classify which ones contain graphs, and report results.

Usage:
    python scripts/cv_train_on_db.py [--limit N] [--output results.json]

Environment variables (read from .env.local automatically):
    NEXT_PUBLIC_SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
"""

import sys
import os
import json
import base64
import argparse
import importlib.util
import time
import tempfile
import logging
from pathlib import Path
from io import BytesIO
from typing import Optional

import numpy as np
from PIL import Image

# ── Load .env.local ────────────────────────────────────────────────────────────
def load_dotenv(path: str) -> None:
    try:
        for line in open(path):
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())
    except FileNotFoundError:
        pass

load_dotenv(str(Path(__file__).parents[1] / ".env.local"))

# ── Supabase REST client (no external library needed) ─────────────────────────
import urllib.request
import urllib.parse

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SERVICE_KEY  = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

def sb_get(path: str, params: Optional[dict] = None) -> dict | list:
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

def sb_download_storage(storage_path: str) -> Optional[bytes]:
    """Download a file from the question-images storage bucket."""
    url = f"{SUPABASE_URL}/storage/v1/object/question-images/{urllib.parse.quote(storage_path)}"
    req = urllib.request.Request(url, headers={
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
    })
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.read()
    except Exception as e:
        return None

# ── Load the CV extractor module ───────────────────────────────────────────────
_script_dir = Path(__file__).parent
_cv_path = _script_dir / "cv_graph_extract.py"
_spec = importlib.util.spec_from_file_location("cv_graph_extract", _cv_path)
_cv_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_cv_mod)

extract_graph_cv = _cv_mod.extract_graph_cv

# ── Graph classifier ───────────────────────────────────────────────────────────
def classify_image(img_bytes: bytes) -> dict:
    """
    Lightweight heuristic classifier: is this image likely a coordinate graph?

    Criteria:
    - Image has a reasonable aspect ratio (not extremely tall/wide)
    - Contains a significant proportion of white/light pixels (background)
    - Contains dark thin lines consistent with axes/grid
    - Has at least one colored region (graph line) OR dark diagonal runs

    Returns: { is_graph: bool, confidence: float, reason: str }
    """
    img = Image.open(BytesIO(img_bytes)).convert("RGB")
    w, h = img.size

    # Reject tiny images
    if w < 80 or h < 80:
        return {"is_graph": False, "confidence": 0.9, "reason": "too small"}

    # Reject very extreme aspect ratios (e.g. thin equations row)
    ratio = max(w, h) / min(w, h)
    if ratio > 8:
        return {"is_graph": False, "confidence": 0.85, "reason": f"extreme aspect ratio {ratio:.1f}"}

    arr = np.array(img)
    r, g, b = arr[:, :, 0].astype(float), arr[:, :, 1].astype(float), arr[:, :, 2].astype(float)

    # White/near-white background fraction
    light_mask = (r > 220) & (g > 220) & (b > 220)
    light_frac = light_mask.mean()
    if light_frac < 0.3:
        return {"is_graph": False, "confidence": 0.8, "reason": f"low white fraction {light_frac:.2f}"}

    # Dark pixels (potential axes/lines)
    dark_mask = (r < 80) & (g < 80) & (b < 80)
    dark_frac = dark_mask.mean()

    # Chroma (coloured graph line)
    chroma = np.max(arr, axis=2).astype(float) - np.min(arr, axis=2).astype(float)
    chroma_frac = (chroma > 40).mean()

    # Heuristic: graph = enough white background + some dark lines + chrominance or enough dark
    score = 0.0
    reasons = []

    if light_frac > 0.5:
        score += 0.3
        reasons.append(f"light_bg={light_frac:.2f}")
    if dark_frac > 0.005:
        score += 0.25
        reasons.append(f"dark_lines={dark_frac:.3f}")
    if chroma_frac > 0.005:
        score += 0.35
        reasons.append(f"color={chroma_frac:.3f}")
    # Bonus for roughly square-ish images (graphs tend to be squarish)
    if ratio < 2.0:
        score += 0.1
        reasons.append("square-ish")

    is_graph  = score >= 0.55
    return {"is_graph": is_graph, "confidence": round(score, 3), "reason": ", ".join(reasons)}


# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Run CV extractor against DB question images")
    parser.add_argument("--limit", type=int, default=200, help="Max images to process (default 200)")
    parser.add_argument("--output", default="cv_train_results.json", help="Output JSON results file")
    parser.add_argument("--graphs-only", action="store_true", help="Only process images classified as graphs")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    log = logging.getLogger("cv_train")

    if not SUPABASE_URL or not SERVICE_KEY:
        print("ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set", file=sys.stderr)
        sys.exit(1)

    # ── Fetch image records ──────────────────────────────────────────────────
    log.info(f"Fetching up to {args.limit} image records from question_images …")
    try:
        rows = sb_get("question_images", {
            "select": "id,question_id,image_type,storage_path,sort_order",
            "order": "created_at.desc",
            "limit": str(args.limit),
        })
    except Exception as e:
        print(f"ERROR fetching question_images: {e}", file=sys.stderr)
        sys.exit(1)

    log.info(f"  → {len(rows)} records fetched")

    stats = {
        "total_fetched": len(rows),
        "downloaded": 0,
        "download_failed": 0,
        "classified_graph": 0,
        "classified_not_graph": 0,
        "cv_ok": 0,
        "cv_error": 0,
        "cv_too_few_vertices": 0,
        "errors": [],
    }
    results = []

    for i, row in enumerate(rows):
        storage_path = row.get("storage_path", "")
        if not storage_path:
            continue

        log.info(f"[{i+1}/{len(rows)}] {storage_path}")

        # ── Download ─────────────────────────────────────────────────────────
        img_bytes = sb_download_storage(storage_path)
        if img_bytes is None:
            log.warning(f"  Download failed: {storage_path}")
            stats["download_failed"] += 1
            stats["errors"].append({"path": storage_path, "error": "download_failed"})
            continue
        stats["downloaded"] += 1

        # ── Classify ─────────────────────────────────────────────────────────
        try:
            classification = classify_image(img_bytes)
        except Exception as e:
            classification = {"is_graph": False, "confidence": 0.0, "reason": str(e)}

        is_graph = classification["is_graph"]
        if is_graph:
            stats["classified_graph"] += 1
        else:
            stats["classified_not_graph"] += 1

        record = {
            "storage_path": storage_path,
            "question_id": row.get("question_id"),
            "image_type": row.get("image_type"),
            "classification": classification,
            "cv_result": None,
        }

        # ── CV extraction (only on graph images) ─────────────────────────────
        if is_graph or not args.graphs_only:
            if is_graph:
                b64 = base64.b64encode(img_bytes).decode("ascii")
                t0 = time.time()
                try:
                    result = extract_graph_cv(b64)
                    elapsed = round(time.time() - t0, 2)
                    if result.get("ok"):
                        n_verts = result.get("metadata", {}).get("vertices_detected", 0)
                        n_segs  = result.get("metadata", {}).get("segments_extracted", 0)
                        method = result.get("metadata", {}).get("method")
                        selected_family = result.get("metadata", {}).get("selected_family")
                        fit_confidence = result.get("metadata", {}).get("fit_confidence")
                        stats["cv_ok"] += 1
                        record["cv_result"] = {
                            "status": "ok",
                            "vertices": n_verts,
                            "segments": n_segs,
                            "domain": result.get("graphMeta", {}).get("domain"),
                            "method": method,
                            "selected_family": selected_family,
                            "fit_confidence": fit_confidence,
                            "elapsed_s": elapsed,
                        }
                        if selected_family:
                            log.info(f"  ✓ CV ok: family={selected_family}, conf={fit_confidence}, {n_verts} vertices in {elapsed}s")
                        else:
                            log.info(f"  ✓ CV ok: {n_verts} vertices, {n_segs} segs in {elapsed}s")
                    else:
                        err = result.get("error", "unknown")
                        if "fewer than 2 vertices" in err.lower():
                            stats["cv_too_few_vertices"] += 1
                        else:
                            stats["cv_error"] += 1
                        record["cv_result"] = {
                            "status": "error",
                            "error": err,
                            "elapsed_s": elapsed,
                            "method": result.get("metadata", {}).get("method"),
                            "warnings": result.get("metadata", {}).get("warnings"),
                            "selected_family": result.get("metadata", {}).get("selected_family"),
                            "fit_confidence": result.get("metadata", {}).get("fit_confidence"),
                        }
                        log.info(f"  ✗ CV error: {err}")
                except Exception as e:
                    stats["cv_error"] += 1
                    record["cv_result"] = {"status": "exception", "error": str(e)}
                    log.warning(f"  ✗ CV exception: {e}")
            else:
                record["cv_result"] = {"status": "skipped", "reason": "not_classified_as_graph"}

        results.append(record)

    # ── Summary ───────────────────────────────────────────────────────────────
    cv_attempted = stats["cv_ok"] + stats["cv_error"] + stats["cv_too_few_vertices"]
    summary = {
        "stats": stats,
        "cv_success_rate": round(stats["cv_ok"] / cv_attempted, 3) if cv_attempted > 0 else None,
        "results": results,
    }

    out_path = Path(args.output)
    out_path.write_text(json.dumps(summary, indent=2))
    log.info(f"\nResults written to {out_path}")

    print("\n" + "="*60)
    print("TRAINING RUN SUMMARY")
    print("="*60)
    print(f"  Images fetched      : {stats['total_fetched']}")
    print(f"  Downloaded OK       : {stats['downloaded']}")
    print(f"  Download failures   : {stats['download_failed']}")
    print(f"  Classified as graph : {stats['classified_graph']}")
    print(f"  Not graph           : {stats['classified_not_graph']}")
    print(f"  CV extraction OK    : {stats['cv_ok']}")
    print(f"  CV < 2 vertices     : {stats['cv_too_few_vertices']}")
    print(f"  CV errors           : {stats['cv_error']}")
    if cv_attempted > 0:
        print(f"  CV success rate     : {100*stats['cv_ok']/cv_attempted:.1f}%")
    print("="*60)


if __name__ == "__main__":
    main()
