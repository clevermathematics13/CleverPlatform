#!/usr/bin/env python3
"""
Batch CV extraction runner for all question images in Supabase.

What it does:
- Reads rows from `question_images`
- Downloads image bytes from `question-images` storage bucket
- Runs deterministic `extract_graph_cv` on each image
- Upserts results into `graph_extraction_queue`
- Flags low-confidence/failed results as `pending_review` or `processing_error`

Usage examples:
  python scripts/cv_batch_extract_db.py --page-size 200
  python scripts/cv_batch_extract_db.py --limit 500 --dry-run
  python scripts/cv_batch_extract_db.py --limit 0 --only-missing
"""

from __future__ import annotations

import argparse
import base64
import importlib.util
import json
import os
import sys
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path
from typing import Any, Optional


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())


ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env.local")

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

if not SUPABASE_URL or not SERVICE_KEY:
    print(
        "ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (via .env.local or env vars)",
        file=sys.stderr,
    )
    raise SystemExit(1)


_script_dir = Path(__file__).parent
_cv_path = _script_dir / "cv_graph_extract.py"
_spec = importlib.util.spec_from_file_location("cv_graph_extract", _cv_path)
_cv_mod = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(_cv_mod)
extract_graph_cv = _cv_mod.extract_graph_cv


def sb_request(
    method: str,
    path: str,
    params: Optional[dict[str, str]] = None,
    body: Optional[Any] = None,
    extra_headers: Optional[dict[str, str]] = None,
    timeout: int = 45,
) -> Any:
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)

    headers = {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Accept": "application/json",
    }
    if extra_headers:
        headers.update(extra_headers)

    data_bytes = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data_bytes = json.dumps(body).encode("utf-8")

    req = urllib.request.Request(url, method=method, headers=headers, data=data_bytes)
    with urllib.request.urlopen(req, timeout=timeout) as res:
        raw = res.read()
        if not raw:
            return None
        return json.loads(raw)


def sb_download_storage(storage_path: str) -> Optional[bytes]:
    url = f"{SUPABASE_URL}/storage/v1/object/question-images/{urllib.parse.quote(storage_path)}"
    req = urllib.request.Request(
        url,
        headers={
            "apikey": SERVICE_KEY,
            "Authorization": f"Bearer {SERVICE_KEY}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as res:
            return res.read()
    except Exception:
        return None


def fetch_existing_queue_image_ids(page_size: int = 1000) -> set[str]:
    seen: set[str] = set()
    offset = 0
    while True:
        try:
            rows = sb_request(
                "GET",
                "graph_extraction_queue",
                params={
                    "select": "question_image_id",
                    "order": "question_image_id.asc",
                    "limit": str(page_size),
                    "offset": str(offset),
                },
            )
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                print(
                    "WARN: graph_extraction_queue table not found. "
                    "Run migration 034_cv_graph_extraction_queue.sql, then rerun with --only-missing."
                )
                return set()
            raise
        if not rows:
            break
        for row in rows:
            qid = row.get("question_image_id")
            if isinstance(qid, str):
                seen.add(qid)
        if len(rows) < page_size:
            break
        offset += page_size
    return seen


def fetch_question_images(limit: int, page_size: int) -> list[dict[str, Any]]:
    rows_all: list[dict[str, Any]] = []
    offset = 0
    remaining = limit

    while True:
        this_limit = page_size if remaining <= 0 else min(page_size, remaining)
        if this_limit <= 0:
            break

        rows = sb_request(
            "GET",
            "question_images",
            params={
                "select": "id,question_id,part_id,image_type,storage_path,sort_order",
                "order": "created_at.asc",
                "limit": str(this_limit),
                "offset": str(offset),
            },
        )

        if not rows:
            break

        rows_all.extend(rows)
        got = len(rows)
        if got < this_limit:
            break

        offset += got
        if remaining > 0:
            remaining -= got
            if remaining <= 0:
                break

    return rows_all


def decide_queue_status(result: dict[str, Any]) -> tuple[str, str, bool]:
    if not result.get("ok"):
        return ("processing_error", "error", True)

    meta = result.get("metadata") if isinstance(result.get("metadata"), dict) else {}
    qa = meta.get("qa") if isinstance(meta.get("qa"), dict) else {}
    method = str(meta.get("method") or "")

    manual = bool(qa.get("manual_review_required"))
    confidence_level = str(qa.get("confidence_level") or ("low" if manual else "normal"))

    # Backstop for older payloads that may not have qa but are fallback-based.
    if not qa and method == "cv_piecewise_fallback_v1":
        manual = True
        confidence_level = "low"

    status = "pending_review" if manual else "auto_accepted"
    return (status, confidence_level, manual)


def upsert_queue_row(row: dict[str, Any], result: dict[str, Any], dry_run: bool) -> None:
    status, confidence_level, manual = decide_queue_status(result)

    payload = {
        "question_image_id": row["id"],
        "question_id": row["question_id"],
        "part_id": row.get("part_id"),
        "image_type": row["image_type"],
        "storage_path": row["storage_path"],
        "status": status,
        "confidence_level": confidence_level,
        "manual_review_required": manual,
        "extractor": "cv_batch_v1",
        "graph_spec": result.get("graphSpec"),
        "graph_meta": result.get("graphMeta"),
        "metadata": result.get("metadata"),
        "warnings": result.get("warnings")
        if isinstance(result.get("warnings"), list)
        else ((result.get("metadata") or {}).get("warnings") if isinstance(result.get("metadata"), dict) else []),
        "feedback": result.get("feedback") if isinstance(result.get("feedback"), list) else [],
        "error": result.get("error"),
    }

    if dry_run:
        return

    try:
        sb_request(
            "POST",
            "graph_extraction_queue",
            params={"on_conflict": "question_image_id"},
            body=[payload],
            extra_headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
        )
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            raise RuntimeError(
                "graph_extraction_queue table was not found. "
                "Apply migration 034_cv_graph_extraction_queue.sql in Supabase before non-dry-run batch writes."
            ) from exc
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description="Batch CV extraction runner with automatic review queueing")
    parser.add_argument("--limit", type=int, default=0, help="Max images to process (0 = all)")
    parser.add_argument("--page-size", type=int, default=200, help="Page size for DB reads")
    parser.add_argument("--only-missing", action="store_true", help="Skip images that already have queue rows")
    parser.add_argument("--dry-run", action="store_true", help="Process but do not write queue rows")
    parser.add_argument("--output", default="cv_batch_queue_results.json", help="Summary output JSON file")
    args = parser.parse_args()

    print(f"Loading question_images (limit={args.limit or 'ALL'}, page-size={args.page_size}) ...")
    images = fetch_question_images(limit=args.limit, page_size=args.page_size)
    print(f"Fetched {len(images)} image rows")

    existing_ids: set[str] = set()
    if args.only_missing:
        print("Fetching existing queue rows to skip already-processed images ...")
        existing_ids = fetch_existing_queue_image_ids(page_size=max(500, args.page_size))
        print(f"Existing queue rows: {len(existing_ids)}")

    stats = {
        "total_images": len(images),
        "processed": 0,
        "skipped_existing": 0,
        "download_failed": 0,
        "ok": 0,
        "auto_accepted": 0,
        "pending_review": 0,
        "processing_error": 0,
        "exceptions": 0,
    }
    results: list[dict[str, Any]] = []

    for idx, row in enumerate(images, start=1):
        image_id = row["id"]
        storage_path = row.get("storage_path") or ""

        if args.only_missing and image_id in existing_ids:
            stats["skipped_existing"] += 1
            continue

        print(f"[{idx}/{len(images)}] {storage_path}")

        img_bytes = sb_download_storage(storage_path)
        if img_bytes is None:
            stats["download_failed"] += 1
            result = {
                "ok": False,
                "error": "download_failed",
                "metadata": {
                    "method": "cv_batch_v1",
                    "warnings": ["Failed to download image from storage"],
                },
                "feedback": [],
            }
            try:
                upsert_queue_row(row, result, dry_run=args.dry_run)
            except Exception:
                stats["exceptions"] += 1
            results.append(
                {
                    "question_image_id": image_id,
                    "storage_path": storage_path,
                    "status": "processing_error",
                    "error": "download_failed",
                }
            )
            continue

        b64 = base64.b64encode(img_bytes).decode("ascii")

        try:
            extract_result = extract_graph_cv(b64)
            status, _, _ = decide_queue_status(extract_result)
            upsert_queue_row(row, extract_result, dry_run=args.dry_run)

            stats["processed"] += 1
            if extract_result.get("ok"):
                stats["ok"] += 1
            if status == "auto_accepted":
                stats["auto_accepted"] += 1
            elif status == "pending_review":
                stats["pending_review"] += 1
            elif status == "processing_error":
                stats["processing_error"] += 1

            results.append(
                {
                    "question_image_id": image_id,
                    "storage_path": storage_path,
                    "status": status,
                    "ok": bool(extract_result.get("ok")),
                    "domain": (extract_result.get("graphMeta") or {}).get("domain")
                    if isinstance(extract_result.get("graphMeta"), dict)
                    else None,
                    "warnings": (extract_result.get("metadata") or {}).get("warnings")
                    if isinstance(extract_result.get("metadata"), dict)
                    else None,
                }
            )

        except Exception as exc:
            stats["exceptions"] += 1
            err = str(exc)
            result = {
                "ok": False,
                "error": err,
                "metadata": {
                    "method": "cv_batch_v1",
                    "warnings": [f"Exception during extraction: {err}"],
                },
                "feedback": [],
            }
            try:
                upsert_queue_row(row, result, dry_run=args.dry_run)
            except Exception:
                stats["exceptions"] += 1

            results.append(
                {
                    "question_image_id": image_id,
                    "storage_path": storage_path,
                    "status": "processing_error",
                    "error": err,
                }
            )

    summary = {"stats": stats, "results": results}
    Path(args.output).write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print("\n" + "=" * 68)
    print("CV BATCH EXTRACTION SUMMARY")
    print("=" * 68)
    for key in [
        "total_images",
        "skipped_existing",
        "processed",
        "download_failed",
        "ok",
        "auto_accepted",
        "pending_review",
        "processing_error",
        "exceptions",
    ]:
        print(f"{key:>18}: {stats[key]}")
    print(f"{'output':>18}: {args.output}")
    print("=" * 68)


if __name__ == "__main__":
    main()
