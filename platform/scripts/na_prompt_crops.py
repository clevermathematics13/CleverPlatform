"""
Renders and uploads a packet version's "question, as printed" crops.

Companion to na_derive_anchors.py, run AFTER that migration is applied, because
it needs the anchors' real database ids. One crop per anchor -- not per student,
since the printed content is identical for everyone -- showing the printed
prompt that sits above the anchor's own box.

WHY THESE EXIST (from A.1's teacher request, HANDOFF.md open item 4d):
the review UI's "why this mark" panel showed question_text, the plain text
extracted once at anchor-authoring time, but not what was actually printed on
the page. The student's own answer crop does not reliably include it either --
some anchor boxes start right where the prompt is, others start well below it,
and nothing on screen told a teacher which case they were looking at. These
crops answer that, and they sit between the plain-text question and the
student's crop in the panel.

THE RULE, AND THE TWO WAYS IT GOES WRONG:
The crop runs from the bottom of the previous printed element on the page down
to the anchor's own top edge, across the content column. "Previous printed
element" is doing real work in that sentence, and both refinements below came
from looking at the output rather than from reasoning about it:

  - Narrow inset boxes are NOT separators. The broken-math quote and the "a
    frame you may use" scaffold are printed parts of the question, not the
    section before it. Treating them as separators cost A.2's Q21 its prompt
    entirely (the frame sits between the prompt and the answer box, leaving a
    15pt gap that fell under the floor) and cut the quote out of Q5's and
    Q17's -- the quote being the exact thing those questions ask about.
  - The anchors themselves ARE separators. Not every anchor is a fill-rect:
    A.2's Q19 is a hand-drawn box over a ruled table, so without counting
    anchors, Q20's crop opened with the five empty rows of that table.

There is deliberately NO cap on how far back the crop reaches. A.1's backfill
tried one (260pt), and it looked right on Q1 and landed mid-paragraph inside an
unrelated worked-example block on Q30 -- actively misleading rather than merely
untidy. This codebase's established principle (see the reverted "ruled-paper
gap" expansion in HANDOFF.md) is that a too-generous crop is a tidiness problem
a teacher can see past, while a wrong one is invisible and worse.

Anchors whose gap falls under MIN_GAP_PT get no crop rather than a near-empty
sliver. Those are sub-part boxes whose prompt is printed in the shared block
above their question's FIRST box, and is therefore already in that anchor's
crop. A.1 skipped 9 of 40 this way, A.2 10 of 32.

USAGE (from platform/):
  python3 scripts/na_prompt_crops.py --pdf master.pdf --config na_packet_a2.json \\
      --out-dir /tmp/prompts
      Renders the crops locally. LOOK AT THEM -- both refinements above were
      found this way, and they are cheap to check.
  python3 scripts/na_prompt_crops.py --pdf master.pdf --config na_packet_a2.json \\
      --out-dir /tmp/prompts --upload --sql out.sql
      Uploads them to the exam-scans bucket and writes the migration that
      records the paths. Needs SUPABASE_SERVICE_ROLE_KEY.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any

import pymupdf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from inspect_fillrects import inspect_fillrects  # noqa: E402

BUCKET = "exam-scans"
CONTENT_X0, CONTENT_X1 = 50.83, 544.50
# Below the running header (y ~24-26) for a first-on-page anchor.
PAGE_TOP_PT = 40.0
# Under this the prompt is inside the box itself; a sliver helps nobody.
MIN_GAP_PT = 25.0
DPI = 300
# Full-width boxes separate sections; the narrow insets belong to the question.
SEPARATOR_MAX_X0 = 60.0
MIN_BOX_W, MIN_BOX_H = 100.0, 30.0


def _dedupe(rects: list[dict[str, Any]]) -> list[dict[str, float]]:
    out: list[dict[str, float]] = []
    for r in sorted(rects, key=lambda r: (r["y0_pt"], r["x0_pt"])):
        hit = next(
            (b for b in out if abs(b["y0"] - r["y0_pt"]) < 1.2 and abs(b["y1"] - r["y1_pt"]) < 1.2),
            None,
        )
        if hit:
            hit["x0"] = min(hit["x0"], r["x0_pt"])
            hit["x1"] = max(hit["x1"], r["x1_pt"])
        else:
            out.append({"x0": r["x0_pt"], "y0": r["y0_pt"], "x1": r["x1_pt"], "y1": r["y1_pt"]})
    return out


def fetch_anchors(config: dict[str, Any], key: str) -> list[dict[str, Any]]:
    url = (
        f"{config['supabase_url'].rstrip('/')}/rest/v1/na_anchors"
        f"?packet_version_id=eq.{config['packet_version_id']}"
        "&select=id,qid,page_index,y0_pt,y1_pt,sort_order&order=sort_order"
    )
    req = urllib.request.Request(url, headers={"apikey": key, "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req) as resp:
        return json.load(resp)


def upload(config: dict[str, Any], key: str, anchor_id: str, data: bytes) -> None:
    path = f"na-crops/{config['packet_version_id']}/prompts/{anchor_id}.png"
    url = f"{config['supabase_url'].rstrip('/')}/storage/v1/object/{BUCKET}/{path}"
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "image/png",
            "x-upsert": "true",
        },
    )
    with urllib.request.urlopen(req) as resp:
        if resp.status != 200:
            raise SystemExit(f"upload of {anchor_id} failed: HTTP {resp.status}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--pdf", required=True, help="the packet's printed master PDF")
    parser.add_argument("--config", required=True, help="packet config JSON")
    parser.add_argument("--out-dir", required=True, help="where to write the PNGs")
    parser.add_argument("--upload", action="store_true", help="also upload them to Storage")
    parser.add_argument("--sql", metavar="OUT.sql", help="write the path-recording migration here")
    args = parser.parse_args()

    config = json.load(open(args.config))
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not key:
        raise SystemExit("SUPABASE_SERVICE_ROLE_KEY is needed to read the anchors' ids.")
    anchors = fetch_anchors(config, key)
    if not anchors:
        raise SystemExit("No anchors for that packet version -- apply the anchor migration first.")

    pdf_bytes = open(args.pdf, "rb").read()
    doc = pymupdf.open(args.pdf)
    boxes: dict[int, list[dict[str, float]]] = {}
    for i in range(doc.page_count):
        found = inspect_fillrects(pdf_bytes, i).get("filled", [])
        boxes[i] = _dedupe([
            r for r in found
            if (r["x1_pt"] - r["x0_pt"]) >= MIN_BOX_W and (r["y1_pt"] - r["y0_pt"]) >= MIN_BOX_H
        ])

    os.makedirs(args.out_dir, exist_ok=True)
    made: list[dict[str, Any]] = []
    skipped: list[str] = []
    for a in anchors:
        page, y0 = a["page_index"], float(a["y0_pt"])
        above = [b["y1"] for b in boxes[page] if b["y1"] <= y0 + 0.5 and b["x0"] < SEPARATOR_MAX_X0]
        above += [
            float(o["y1_pt"]) for o in anchors
            if o["page_index"] == page and float(o["y1_pt"]) <= y0 + 0.5
        ]
        top = max(above) if above else PAGE_TOP_PT
        gap = y0 - top
        if gap < MIN_GAP_PT:
            skipped.append(a["qid"])
            continue
        pix = doc[page].get_pixmap(dpi=DPI, clip=pymupdf.Rect(CONTENT_X0, top, CONTENT_X1, y0))
        path = os.path.join(args.out_dir, f"{a['id']}.png")
        pix.save(path)
        made.append({"id": a["id"], "qid": a["qid"], "gap": round(gap, 1), "path": path})

    print(f"crops: {len(made)}   skipped (gap under {MIN_GAP_PT}pt): {len(skipped)} -> {skipped}")
    for m in made:
        print(f"   {m['qid']:<12} gap={m['gap']:>7}pt  {os.path.getsize(m['path']) // 1024}kB")

    if args.upload:
        for m in made:
            upload(config, key, m["id"], open(m["path"], "rb").read())
        print(f"uploaded {len(made)} crops to {BUCKET}/na-crops/{config['packet_version_id']}/prompts/")

    if args.sql:
        pv = config["packet_version_id"]
        excluded = ", ".join("'" + q.replace("'", "''") + "'" for q in skipped)
        with open(args.sql, "w") as fh:
            fh.write(
                "update na_anchors\n"
                f"set prompt_crop_storage_path =\n"
                f"      'na-crops/{pv}/prompts/' || id || '.png'\n"
                f"where packet_version_id = '{pv}'\n"
                f"  and qid not in ({excluded});\n"
            )
        print(f"wrote {args.sql}")


if __name__ == "__main__":
    main()
