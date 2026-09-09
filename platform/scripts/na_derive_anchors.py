"""
Derives a packet version's anchor rows from its printed master PDF.

Generalizes the by-hand A.2 setup (HANDOFF.md ss15) into a repeatable tool, so
the next packet does not start by rediscovering the method. It automates the
mechanical half -- find the answer boxes, name them, work out expansion caps,
scope each box's question text -- and deliberately does NOT automate the half
that needs a person: which candidate is really an answer box, how a question's
marks divide across its sub-part boxes, and whether the printed numbering means
what you think it means. Those arrive as an explicit config file, and the tool
refuses to emit SQL when the config disagrees with the page.

READ THIS BEFORE USING IT ON A NEW PACKET:

1. GEOMETRY MUST COME FROM THE DISTRIBUTED PRINT MASTER, NEVER A RE-RENDER.
   The Typst template changes (d1ff83b, 8 Sep 2026, changed what the header
   prints). A packet rendered today does not lay out like the one the students
   were handed, so anchors derived from a fresh render sit at the wrong offset
   on every page -- silently, because nothing downstream can tell a
   well-formed wrong box from a right one. Feed this the PDF that was printed.
   For A.2 that PDF is kept at na-masters/<packet_version_id>/master.pdf in the
   exam-scans bucket; do the same for every packet from now on.

2. PRINTED QUESTION NUMBERS ARE NOT THE parts[] ORDINAL. Anything in parts[]
   that prints unnumbered (A.2's Part 0 Desmos activity) still occupies a slot,
   so the two run out of step from that point on. The config states the mapping
   outright, and --sql verifies every entry against the printed "Clev's Marks:
   N" label before writing anything. Do not skip that check: it is the whole
   reason A.2's mapping is trustworthy (21 of 21 agreed).

3. page_count IS THE PRINTED LENGTH, NOT THE DOCUMENT'S OWN PAGE TOTAL. Both
   packets so far print short of what the generator produced (A.1: 26 pages
   under a footer reading "of 32"; A.2: 20 under "of 23") because the Extension
   section is generated but not printed. page_count is the stride the batch
   segmenter uses to find where each student's copy begins, so it has to match
   what a student physically hands in. --candidates prints both numbers so the
   discrepancy is visible rather than assumed away.

HOW THE BOXES ARE TOLD APART:
Answer boxes and information boxes are both filled rectangles; what separates
them is horizontal inset. On the current NA template answer boxes span the full
content column (x0 50.83, x1 544.50), information boxes (WHAT YOU NEED, TOK,
ATL, the command-term spotlights) sit at the inset 51.02/544.25, and quote
boxes (broken-math critiques, "a frame you may use") at 87.87/466.93. On A.2
that rule picks 32 boxes out of 57 candidates. --candidates prints a census of
every x-signature it found, so a template change shows up as an unfamiliar
signature instead of as missing anchors.

WHAT IT CANNOT SEE:
Only filled rectangles. A ruled table (A.2's Q19 reflection grid) registers as
its header row alone, and a coordinate grid (A.1's Q26(a)) not at all -- the
same blind spot inspect_fillrects.py exists to work around. Those go in the
config's "manual_anchors", drawn by a human against the rendered page.

USAGE (from platform/):
  python3 scripts/na_derive_anchors.py --pdf master.pdf --layout
      Per-page text with box boundaries interleaved. This is the read you do
      first, to work out which printed question owns which box.
  python3 scripts/na_derive_anchors.py --pdf master.pdf --candidates
      Detected answer boxes with proposed qids, marks and expansion caps.
  python3 scripts/na_derive_anchors.py --pdf master.pdf --annotate out.pdf
      The same anchors drawn over the master. LOOK AT THIS. Every A.2 anchor
      was eyeballed here before a row was written, and it is what caught the
      two prompt-crop bugs in na_prompt_crops.py.
  python3 scripts/na_derive_anchors.py --pdf master.pdf --config a2.json \
      --sql out.sql --notes header.txt
      The migration body, written to a file rather than stdout because
      inspect_fillrects imports the legacy `fitz` alias, which prints a
      deprecation banner to stdout at import time and would land in the middle
      of your SQL. Apply it with MCP apply_migration, then rename the file to
      the ledger version per supabase/migrations/README.md. --notes prepends an
      authored comment block; write one, since the packet-specific reasoning is
      the part of a migration nobody can reconstruct later.

scripts/na_packet_a2.json is A.2's config, kept as the worked example.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.request
import uuid
from dataclasses import dataclass, field
from typing import Any

import pymupdf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from inspect_fillrects import inspect_fillrects  # noqa: E402

# Full content column on the current NA template. Answer boxes only.
ANSWER_X0, ANSWER_X1 = 50.83, 544.50
X_TOLERANCE = 0.05
# Below this a filled rect is a rule, a table row or a marks pill, not a box.
MIN_BOX_W, MIN_BOX_H = 100.0, 30.0
# A4 minus the footer band; A.1 uses this as its last-box-on-page cap.
PAGE_BOTTOM_CAP = 811.89
EXPAND_X1 = 580.28
# Clear space left between a crop's cap and the next printed box.
CAP_GAP_PT = 4.0

COMMAND_TERMS = [
    "Compare and contrast", "Hence or otherwise", "Write down", "Write an expression",
    "Calculate", "Comment", "Compare", "Construct", "Contrast", "Deduce", "Demonstrate",
    "Describe", "Determine", "Distinguish", "Draw", "Estimate", "Explain", "Find",
    "Hence", "Identify", "Interpret", "Investigate", "Justify", "Label", "List", "Plot",
    "Predict", "Prove", "Show that", "Show", "Simplify", "Sketch", "Solve", "State",
    "Suggest", "Translate", "Verify", "Write",
]


@dataclass
class Box:
    x0: float
    y0: float
    x1: float
    y1: float

    @property
    def is_answer(self) -> bool:
        return (
            abs(self.x0 - ANSWER_X0) < X_TOLERANCE and abs(self.x1 - ANSWER_X1) < X_TOLERANCE
        )

    @property
    def signature(self) -> str:
        return f"{self.x0:.2f}/{self.x1:.2f}"


@dataclass
class Anchor:
    page: int
    box: Box
    printed_q: int | None
    hint: str | None
    source: str
    qid: str = ""
    base_qid: str = ""
    part_label: str | None = None
    expand_y1: float = PAGE_BOTTOM_CAP
    sort_order: int = 0
    letters: list[str] = field(default_factory=list)


def _dedupe(rects: list[dict[str, Any]]) -> list[Box]:
    """Collapses the two rects a single printed box produces.

    Each box is drawn as an interior fill plus a border stroke offset by about
    0.2pt, and some carry a 2.6pt left accent bar as a third. Same y-range, so
    matching on that and keeping the outermost x is enough.
    """
    out: list[Box] = []
    for r in sorted(rects, key=lambda r: (r["y0_pt"], r["x0_pt"])):
        hit = next(
            (b for b in out if abs(b.y0 - r["y0_pt"]) < 1.2 and abs(b.y1 - r["y1_pt"]) < 1.2),
            None,
        )
        if hit:
            hit.x0 = min(hit.x0, r["x0_pt"])
            hit.x1 = max(hit.x1, r["x1_pt"])
        else:
            out.append(Box(r["x0_pt"], r["y0_pt"], r["x1_pt"], r["y1_pt"]))
    return out


def read_boxes(pdf_bytes: bytes, page_count: int) -> dict[int, list[Box]]:
    pages: dict[int, list[Box]] = {}
    for i in range(page_count):
        found = inspect_fillrects(pdf_bytes, i).get("filled", [])
        wide = [
            r for r in found
            if (r["x1_pt"] - r["x0_pt"]) >= MIN_BOX_W and (r["y1_pt"] - r["y0_pt"]) >= MIN_BOX_H
        ]
        pages[i] = _dedupe(wide)
    return pages


def read_labels(doc: pymupdf.Document) -> tuple[list[tuple[int, float, int]], list[tuple[int, float, str]], dict[int, int]]:
    """Printed question labels, Part headings, and each question's printed marks.

    All three are read off the left margin (question numbers and Part headings
    at x~51) or the marks pill at the right (x~478-497).
    """
    qlabel = re.compile(r"^Q(\d{1,2})$")
    # \u00b7 is the middle dot the template prints between a Part's number
    # and its title ("Part 0 - Warming the Engine"); written as an escape so
    # this file stays pure ASCII.
    part = re.compile("^Part (\\d)\\s*[\u00b7.]")
    marks_pill = re.compile(r"Clev.s Marks:\s*(\d+)")
    labels: list[tuple[int, float, int]] = []
    parts: list[tuple[int, float, str]] = []
    pills: list[tuple[int, float, int]] = []
    for i in range(doc.page_count):
        for blk in doc[i].get_text("dict")["blocks"]:
            for ln in blk.get("lines", []):
                text = "".join(s["text"] for s in ln["spans"]).strip()
                x, y = ln["bbox"][0], ln["bbox"][1]
                if x < 60 and qlabel.match(text):
                    labels.append((i, y, int(qlabel.match(text).group(1))))
                if x < 60 and part.match(text):
                    parts.append((i, y, f"Part {part.match(text).group(1)}"))
                m = marks_pill.search(text)
                if m:
                    pills.append((i, y, int(m.group(1))))
    labels.sort()
    parts.sort()
    # Pair each pill with the question label printed on its own line.
    printed_marks: dict[int, int] = {}
    for pi, py, value in pills:
        near = [(abs(py - ly), n) for (p, ly, n) in labels if p == pi and abs(py - ly) < 12]
        if near:
            printed_marks[min(near)[1]] = value
    return labels, parts, printed_marks


def hint_letter(doc: pymupdf.Document, page: int, box: Box) -> str | None:
    """The '(x)' cue printed inside an answer box, at the box's own left inset."""
    for blk in doc[page].get_text("dict")["blocks"]:
        for ln in blk.get("lines", []):
            text = "".join(s["text"] for s in ln["spans"]).strip()
            x, y = ln["bbox"][0], ln["bbox"][1]
            if box.y0 <= y <= box.y1 and 58 < x < 70:
                m = re.match(r"^\((\w)\)", text)
                if m:
                    return m.group(1)
    return None


def build_anchors(doc: pymupdf.Document, pages: dict[int, list[Box]], config: dict[str, Any]) -> list[Anchor]:
    labels, parts, _ = read_labels(doc)
    overrides = {
        (o["page"], round(float(o["y0"]), 2)): o for o in config.get("overrides", [])
    }

    def owner(page: int, y0: float) -> int | None:
        prior = [n for (p, ly, n) in labels if p < page or (p == page and ly < y0)]
        return prior[-1] if prior else None

    anchors: list[Anchor] = []
    for page in sorted(pages):
        for box in pages[page]:
            if not box.is_answer:
                continue
            anchors.append(
                Anchor(page, box, owner(page, box.y0), hint_letter(doc, page, box), "auto_fillrect")
            )
    for manual in config.get("manual_anchors", []):
        anchors.append(
            Anchor(
                manual["page"],
                Box(manual["x0"], manual["y0"], manual["x1"], manual["y1"]),
                manual.get("printed_q"),
                None,
                manual.get("source", "manual"),
            )
        )
    anchors.sort(key=lambda a: (a.page, a.box.y0))

    for a in anchors:
        ov = overrides.get((a.page, round(a.box.y0, 2)))
        if ov and ov.get("activity_label"):
            a.printed_q = None
            a.qid = a.base_qid = f"ACTIVITY[{ov['activity_label']}]"

    seen: dict[int, int] = {}
    for idx, a in enumerate(anchors):
        if not a.qid:
            seen[a.printed_q] = seen.get(a.printed_q, 0) + 1
            a.base_qid = f"Q{a.printed_q}"
            a.qid = a.base_qid if seen[a.printed_q] == 1 else f"Q{a.printed_q}({a.hint})"
        a.sort_order = idx
        # Stop the crop just short of the next printed box on the page -- any
        # box, information ones included, since expanding into one buys nothing
        # and risks swallowing printed text.
        below = [b.y0 for b in pages[a.page] if b.y0 > a.box.y1 - 0.5]
        below += [o.box.y0 for o in anchors if o.page == a.page and o.box.y0 > a.box.y1 - 0.5]
        a.expand_y1 = round(min(below) - CAP_GAP_PT, 2) if below else PAGE_BOTTOM_CAP
        prior = [p for p in parts if p[0] < a.page or (p[0] == a.page and p[1] < a.box.y0)]
        a.part_label = prior[-1][2] if prior else None

    # part_label marks the FIRST anchor of each Part only (A.1's convention).
    previous: Any = object()
    for a in anchors:
        a.part_label, previous = (a.part_label if a.part_label != previous else None), a.part_label

    # Which printed sub-parts each box covers: later sibling boxes claim their
    # own letter, the first box takes everything before the earliest of those.
    groups: dict[str, list[Anchor]] = {}
    for a in anchors:
        groups.setdefault(a.base_qid, []).append(a)
    for members in groups.values():
        members.sort(key=lambda a: a.sort_order)
        later = [m.hint for m in members[1:] if m.hint]
        for i, m in enumerate(members):
            if m.base_qid.startswith("ACTIVITY"):
                m.letters = []
            elif i == 0:
                m.letters = [c for c in "abcdef" if not later or c < min(later)]
            else:
                m.letters = [m.hint]
    return anchors


def split_parts(text: str) -> tuple[str, dict[str, str]]:
    """stem + {letter: text}, walking (a), (b), (c) ... in order.

    Sequential rather than "every (x) in the string" because these prompts also
    refer back to their own parts: A.2's Q1(e) ends "comparing (a) to (b), and
    (c) to (d)", which a global scan reads as four more sub-parts and scrambles
    the split. Searching for the next expected letter after the previous match
    leaves those back-references inside the part that owns them. The lookbehind
    keeps "Part 2 (b)" and "Q9(b)" from opening a part.
    """
    if not text:
        return "", {}
    marks: list[tuple[str, re.Match[str]]] = []
    pos = 0
    for letter in "abcdef":
        m = re.compile(r"(?<![A-Za-z0-9])\(" + letter + r"\)\s").search(text, pos)
        if not m:
            break
        marks.append((letter, m))
        pos = m.end()
    if not marks:
        return text.strip(), {}
    stem = text[: marks[0][1].start()].strip()
    out: dict[str, str] = {}
    for i, (letter, m) in enumerate(marks):
        end = marks[i + 1][1].start() if i + 1 < len(marks) else len(text)
        out[letter] = text[m.end() : end].strip()
    return stem, out


def scoped(text: str | None, letters: list[str], multi: bool) -> str | None:
    """Whole prompt for a question printed with ONE answer box; only a
    multi-box question needs its text cut down to the box in hand.

    That distinction is the A.1 Q1/Q1(e) lesson (HANDOFF.md open item 4c): both
    boxes carried byte-identical text covering every sub-part, so the assessor
    had to read and consciously discard the neighbouring box's prompt on every
    single crop -- which is what produced its documented backtracking. Cutting
    the text at the data layer means there is nothing left to discard. Single-box
    questions are left verbatim, because splitting them can only introduce error
    (A.2's Q16 prompt contains the literal string "Part 2 (b)").
    """
    if not text:
        return None
    if not multi:
        return text.strip()
    stem, subs = split_parts(text)
    if not subs:
        return text.strip()
    keep = [f"({letter}) {subs[letter]}" for letter in letters if letter in subs]
    if not keep:
        return stem or text.strip()
    return (stem + " " + " ".join(keep)).strip() if stem else " ".join(keep)


def command_term(text: str | None) -> str | None:
    if not text:
        return None
    for term in COMMAND_TERMS:
        if re.search(r"\b" + re.escape(term) + r"\b", text):
            return term
    return None


def load_parts(config: dict[str, Any], parts_file: str | None) -> list[dict[str, Any]]:
    """The packet's authored questions, flattened across parts[] in order."""
    if parts_file:
        raw = json.load(open(parts_file))
    else:
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        if not key:
            raise SystemExit("Need --parts FILE, or SUPABASE_SERVICE_ROLE_KEY to fetch them.")
        url = (
            f"{config['supabase_url'].rstrip('/')}/rest/v1/nuanced_analyses"
            f"?id=eq.{config['nuanced_analysis_id']}&select=parts"
        )
        req = urllib.request.Request(url, headers={"apikey": key, "Authorization": f"Bearer {key}"})
        with urllib.request.urlopen(req) as resp:
            raw = json.load(resp)[0]["parts"]
    flat: list[dict[str, Any]] = []
    for section in raw:
        flat.extend(section.get("questions", []) or [])
    return flat


def sql_str(value: Any) -> str:
    if value is None:
        return "null"
    return "'" + str(value).replace("'", "''") + "'"


def emit_sql(anchors: list[Anchor], config: dict[str, Any], flat: list[dict[str, Any]], notes: str | None) -> str:
    pv, na = config["packet_version_id"], config["nuanced_analysis_id"]
    namespace = uuid.UUID(config["uuid_namespace"])
    qmap = {int(k): v for k, v in config["question_map"].items()}
    splits = {int(k): v for k, v in config.get("mark_splits", {}).items()}
    open_rubric = {int(k): v for k, v in config.get("open_rubric", {}).items()}
    activity_text = {o["activity_label"]: o["question_text"] for o in config.get("overrides", []) if o.get("activity_label")}

    groups: dict[str, list[Anchor]] = {}
    for a in anchors:
        groups.setdefault(a.base_qid, []).append(a)

    rubric_rows, anchor_rows = [], []
    for a in anchors:
        rubric_id = str(uuid.uuid5(namespace, "rubric:" + a.qid))
        if a.base_qid.startswith("ACTIVITY"):
            label = a.base_qid[len("ACTIVITY[") : -1]
            qtext, qans, oru = activity_text[label], None, None
            marks, qmarks, term = None, 0, None
        else:
            src = flat[qmap[a.printed_q] - 1]
            multi = len(groups[a.base_qid]) > 1
            qtext = scoped(src.get("prompt"), a.letters, multi)
            qans = scoped(src.get("answer"), a.letters, multi)
            oru = open_rubric.get(a.printed_q)
            qmarks = src.get("marks")
            marks = splits[a.printed_q][groups[a.base_qid].index(a)] if a.printed_q in splits else qmarks
            term = command_term(qtext)
        marks_sql = "null" if marks is None else str(marks)
        rubric_rows.append(
            f"  ({sql_str(rubric_id)}, {sql_str(na)}, {sql_str(a.qid)}, {sql_str(a.base_qid)}, "
            f"{a.printed_q or 0}, {sql_str(qtext)}, {sql_str(qans)}, {sql_str(term)}, {marks_sql}, "
            f"{qmarks}, {sql_str(oru)}, {sql_str(config['rubric_source'])})"
        )
        anchor_rows.append(
            f"  ({sql_str(pv)}, {sql_str(a.qid)}, {sql_str(a.base_qid)}, {sql_str(a.part_label)}, "
            f"{a.page}, {a.box.x0:.2f}, {a.box.y0:.2f}, {a.box.x1:.2f}, {a.box.y1:.2f}, "
            f"{EXPAND_X1:.2f}, {a.expand_y1:.2f}, {sql_str(term)}, {marks_sql}, {sql_str(qtext)}, "
            f"{sql_str(qans)}, {sql_str(oru)}, {qmarks}, {sql_str(a.source)}, {a.sort_order}, {sql_str(rubric_id)})"
        )

    out = []
    if notes:
        out.append(notes.rstrip("\n"))
        out.append("")
    out.append(
        f"insert into na_packet_versions (id, nuanced_analysis_id, version_label, page_count, anchor_source, anchors_locked)\n"
        f"values ({sql_str(pv)}, {sql_str(na)}, {sql_str(config['version_label'])}, "
        f"{config['page_count']}, {sql_str(config['anchor_source'])}, true);\n"
    )
    out.append(
        "insert into na_rubric_items (id, nuanced_analysis_id, qid, base_qid, question_number, "
        "question_text, answer_key, command_term, marks, question_marks, open_rubric, source)\nvalues"
    )
    out.append(",\n".join(rubric_rows) + ";\n")
    out.append(
        "insert into na_anchors (packet_version_id, qid, base_qid, part_label, page_index, x0_pt, "
        "y0_pt, x1_pt, y1_pt, expand_max_x1_pt, expand_max_y1_pt, command_term, marks_available, "
        "question_text, question_answer, open_rubric, question_marks, source, sort_order, rubric_item_id)\nvalues"
    )
    out.append(",\n".join(anchor_rows) + ";")
    return "\n".join(out) + "\n"


def verify(anchors: list[Anchor], config: dict[str, Any], flat: list[dict[str, Any]], printed_marks: dict[int, int]) -> list[str]:
    """Every check that must hold before this SQL is worth applying.

    The marks cross-check is the important one: it is what proved A.2's
    off-by-one printed-to-parts mapping rather than assuming it.
    """
    problems: list[str] = []
    qmap = {int(k): v for k, v in config["question_map"].items()}
    splits = {int(k): v for k, v in config.get("mark_splits", {}).items()}

    for printed_q, ordinal in sorted(qmap.items()):
        if not 1 <= ordinal <= len(flat):
            problems.append(f"Q{printed_q}: parts[] ordinal {ordinal} is out of range (1..{len(flat)})")
            continue
        authored = flat[ordinal - 1].get("marks")
        printed = printed_marks.get(printed_q)
        if printed is None:
            problems.append(f"Q{printed_q}: no printed marks pill found to check the mapping against")
        elif printed != authored:
            problems.append(
                f"Q{printed_q}: printed {printed} marks but parts[{ordinal}] says {authored} -- mapping is wrong"
            )

    groups: dict[str, list[Anchor]] = {}
    for a in anchors:
        groups.setdefault(a.base_qid, []).append(a)
    for base, members in groups.items():
        if base.startswith("ACTIVITY"):
            continue
        printed_q = members[0].printed_q
        if printed_q not in qmap:
            problems.append(f"{base}: no question_map entry for printed Q{printed_q}")
            continue
        total = flat[qmap[printed_q] - 1].get("marks")
        if printed_q in splits:
            if len(splits[printed_q]) != len(members):
                problems.append(
                    f"{base}: {len(members)} boxes but mark_splits has {len(splits[printed_q])} entries"
                )
            elif sum(splits[printed_q]) != total:
                problems.append(
                    f"{base}: split {splits[printed_q]} sums to {sum(splits[printed_q])}, not {total}"
                )
        elif len(members) > 1:
            problems.append(f"{base}: {len(members)} boxes but no mark_splits entry")

    if len({a.qid for a in anchors}) != len(anchors):
        problems.append("duplicate qid among the derived anchors")
    for a in anchors:
        if a.expand_y1 < a.box.y1:
            problems.append(f"{a.qid}: expansion cap {a.expand_y1} is above the box bottom {a.box.y1}")
    return problems


def dump_layout(doc: pymupdf.Document, pages: dict[int, list[Box]]) -> None:
    for i in range(doc.page_count):
        print(f"\n########## PAGE {i} ##########")
        events: list[tuple[float, str]] = []
        for b in pages[i]:
            kind = "ANSWER" if b.is_answer else "box"
            events.append((b.y0, f">>> {kind} TOP [{b.x0:.2f},{b.y0:.2f},{b.x1:.2f},{b.y1:.2f}]"))
            events.append((b.y1, f"<<< {kind} END  y1={b.y1:.2f}"))
        for blk in doc[i].get_text("dict")["blocks"]:
            for ln in blk.get("lines", []):
                text = "".join(s["text"] for s in ln["spans"]).strip()
                if text:
                    events.append((ln["bbox"][1], f"  y={ln['bbox'][1]:7.2f} x={ln['bbox'][0]:6.1f} | {text[:110]}"))
        for _, line in sorted(events, key=lambda e: e[0]):
            print(line)


def annotate(doc: pymupdf.Document, anchors: list[Anchor], out_path: str) -> None:
    for a in anchors:
        page = doc[a.page]
        page.draw_rect(pymupdf.Rect(a.box.x0, a.box.y0, a.box.x1, a.box.y1), color=(1, 0, 0), width=1.6)
        page.draw_line(
            pymupdf.Point(a.box.x0, a.expand_y1), pymupdf.Point(a.box.x1, a.expand_y1),
            color=(0, 0.5, 1), width=1.0, dashes="[3] 0",
        )
        page.insert_text(pymupdf.Point(a.box.x0 + 3, a.box.y0 + 11), a.qid, fontsize=9, color=(1, 0, 0))
    doc.save(out_path)


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--pdf", required=True, help="the packet's printed master PDF")
    parser.add_argument("--config", help="packet config JSON (see na_packet_a2.json)")
    parser.add_argument("--parts", help="parts[] JSON; omit to fetch it via the Supabase REST API")
    parser.add_argument("--notes", help="file whose contents are prepended to --sql as a comment block")
    parser.add_argument("--layout", action="store_true", help="per-page text with box boundaries")
    parser.add_argument("--candidates", action="store_true", help="proposed anchors, with an x-signature census")
    parser.add_argument("--annotate", metavar="OUT.pdf", help="draw the anchors over the master")
    parser.add_argument("--sql", metavar="OUT.sql", help="write the migration body to this file")
    args = parser.parse_args()

    pdf_bytes = open(args.pdf, "rb").read()
    doc = pymupdf.open(args.pdf)
    pages = read_boxes(pdf_bytes, doc.page_count)
    config = json.load(open(args.config)) if args.config else {}

    if args.layout:
        dump_layout(doc, pages)
        return

    anchors = build_anchors(doc, pages, config)

    if args.candidates:
        census: dict[str, int] = {}
        for boxes in pages.values():
            for b in boxes:
                census[b.signature] = census.get(b.signature, 0) + 1
        print("x-signature census (x0/x1 -> count); answer boxes are "
              f"{ANSWER_X0:.2f}/{ANSWER_X1:.2f}:")
        for sig, n in sorted(census.items(), key=lambda kv: -kv[1]):
            mark = "  <- answer boxes" if sig == f"{ANSWER_X0:.2f}/{ANSWER_X1:.2f}" else ""
            print(f"   {sig:>16}  x{n}{mark}")
        footer = re.search(r"Page \d+ of (\d+)", doc[0].get_text())
        print(f"\npages in this PDF: {doc.page_count}"
              f"   document's own total: {footer.group(1) if footer else 'unknown'}"
              "   (page_count must be the former)")
        print(f"\n{len(anchors)} anchors:")
        for a in anchors:
            print(
                f"  {a.sort_order:2d} p{a.page:2d} {a.qid:<12} part={a.part_label or '-':<7} "
                f"[{a.box.x0:.2f},{a.box.y0:.2f},{a.box.x1:.2f},{a.box.y1:.2f}] "
                f"cap={a.expand_y1:.2f} letters={''.join(a.letters) or '-':<6} {a.source}"
            )

    if args.annotate:
        annotate(pymupdf.open(args.pdf), anchors, args.annotate)
        print(f"wrote {args.annotate} -- look at it before trusting any of this")

    if args.sql:
        if not args.config:
            raise SystemExit("--sql needs --config")
        flat = load_parts(config, args.parts)
        _, _, printed_marks = read_labels(doc)
        problems = verify(anchors, config, flat, printed_marks)
        if problems:
            print("REFUSING TO EMIT SQL:", file=sys.stderr)
            for p in problems:
                print(f"  - {p}", file=sys.stderr)
            raise SystemExit(1)
        notes = open(args.notes).read() if args.notes else None
        with open(args.sql, "w") as fh:
            fh.write(emit_sql(anchors, config, flat, notes))
        print(f"wrote {args.sql}")


if __name__ == "__main__":
    main()
