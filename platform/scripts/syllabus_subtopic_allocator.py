#!/usr/bin/env python3
"""Build and query syllabus-derived subtopic references for AA/AI.

This script parses the OCR text extracted from syllabus PDFs and creates a
machine-readable subtopic dataset that can be used to ground Claude's
subtopic-code allocation.

Usage:
  python scripts/syllabus_subtopic_allocator.py build
  python scripts/syllabus_subtopic_allocator.py suggest --course aa --text "..."
  python scripts/syllabus_subtopic_allocator.py suggest --course ai --text-file /path/to/question.txt
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass, asdict
from datetime import datetime, UTC
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parents[1]
SYLLABUS_OCR = {
    "aa": ROOT / "docs/syllabus/aa/AA_guide_for_2021_sections/02_syllabus_ocr.txt",
    "ai": ROOT / "docs/syllabus/ai/AI guide_for_2021_sections/02_syllabus_ocr.txt",
}
OUT_DIR = ROOT / "docs/syllabus/subtopic_reference"

HEADER_RE = re.compile(r"^(SL|AHL)\s+(\d+\.\d+(?:\.\d+)?)\s*$")
TOKEN_RE = re.compile(r"[a-z0-9]+")
FORMULA_RE = re.compile(r"(?:y\s*=\s*[^\n]+|\|[^\n]{1,80}\||f\s*\([^\)]+\))", re.IGNORECASE)

STOPWORDS = {
    "the", "and", "for", "with", "that", "from", "this", "are", "use", "using", "students",
    "should", "could", "including", "where", "link", "links", "content", "guidance", "clarification",
    "syllabus", "connections", "example", "examples", "applications", "download", "template",
    "required", "not", "other", "subjects", "tok", "international", "mindedness", "guide",
    "mathematics", "analysis", "approaches", "applications", "interpretation", "topic", "sl", "ahl",
}


@dataclass
class Subtopic:
    course: str
    level: str
    code: str
    title: str
    content: str
    formulas: list[str]
    links: list[str]
    keywords: list[str]


def normalize_space(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def extract_keywords(text: str, cap: int = 30) -> list[str]:
    counts: dict[str, int] = {}
    for tok in TOKEN_RE.findall(text.lower()):
        if len(tok) < 3 or tok in STOPWORDS:
            continue
        counts[tok] = counts.get(tok, 0) + 1
    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    return [w for w, _ in ranked[:cap]]


def derive_title(block_lines: list[str]) -> str:
    for line in block_lines:
        t = normalize_space(line)
        if not t:
            continue
        if t.lower().startswith("content guidance"):
            continue
        if t.lower().startswith("connections"):
            continue
        return t[:140]
    return ""


def split_blocks(lines: list[str]) -> list[tuple[str, str, int, int]]:
    headers: list[tuple[int, str, str]] = []
    for i, line in enumerate(lines):
        m = HEADER_RE.match(line.strip())
        if m:
            headers.append((i, m.group(1), m.group(2)))

    blocks: list[tuple[str, str, int, int]] = []
    for idx, (start_idx, level, code) in enumerate(headers):
        end_idx = headers[idx + 1][0] if idx + 1 < len(headers) else len(lines)
        blocks.append((level, code, start_idx + 1, end_idx))
    return blocks


def parse_subtopics(course: str, text: str) -> list[Subtopic]:
    lines = text.splitlines()
    subtopics: list[Subtopic] = []

    for level, code, body_start, body_end in split_blocks(lines):
        block_lines = lines[body_start:body_end]
        block_text = "\n".join(block_lines)

        # Keep the technical section before "Connections" as core content.
        pre_connections = block_text.split("Connections", 1)[0]
        core_content = normalize_space(pre_connections)

        links = []
        for ln in block_lines:
            if "Link to:" in ln:
                links.append(normalize_space(ln))

        formulas = [normalize_space(m.group(0)) for m in FORMULA_RE.finditer(block_text)]
        uniq_formulas = []
        seen = set()
        for f in formulas:
            k = f.lower()
            if k in seen:
                continue
            seen.add(k)
            uniq_formulas.append(f)

        title = derive_title(block_lines)
        keywords = extract_keywords(f"{title} {core_content}")

        subtopics.append(
            Subtopic(
                course=course,
                level=level,
                code=f"{level.lower()} {code}",
                title=title,
                content=core_content,
                formulas=uniq_formulas[:20],
                links=links[:10],
                keywords=keywords,
            )
        )

    return subtopics


def build_reference() -> dict:
    result = {
        "generated_at": datetime.now(UTC).isoformat(),
        "sources": {k: str(v) for k, v in SYLLABUS_OCR.items()},
        "courses": {},
    }

    for course, path in SYLLABUS_OCR.items():
        if not path.exists():
            raise FileNotFoundError(f"Missing OCR source: {path}")
        text = path.read_text(encoding="utf-8")
        subs = parse_subtopics(course, text)
        result["courses"][course] = [asdict(s) for s in subs]

    return result


def write_outputs(reference: dict) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    json_path = OUT_DIR / "subtopic_reference.json"
    json_path.write_text(json.dumps(reference, indent=2, ensure_ascii=False), encoding="utf-8")

    md_lines = [
        "# Claude Subtopic Allocation Context",
        "",
        "Grounding context generated from official syllabus OCR extracts.",
        "Use this as retrieval context before assigning subtopic codes.",
        "",
        f"Generated: {reference['generated_at']}",
        "",
    ]

    for course in ("aa", "ai"):
        md_lines.append(f"## {course.upper()}")
        md_lines.append("")
        for s in reference["courses"].get(course, []):
            md_lines.append(f"### {s['code']} - {s['title']}")
            md_lines.append(f"- Keywords: {', '.join(s['keywords'][:12])}")
            if s["formulas"]:
                md_lines.append(f"- Formula cues: {', '.join(s['formulas'][:6])}")
            if s["links"]:
                md_lines.append(f"- Syllabus links: {' | '.join(s['links'][:3])}")
            md_lines.append(f"- Core guidance: {s['content'][:700]}")
            md_lines.append("")

    md_path = OUT_DIR / "claude_subtopic_allocation_context.md"
    md_path.write_text("\n".join(md_lines), encoding="utf-8")

    print(f"Wrote {json_path}")
    print(f"Wrote {md_path}")


def token_set(text: str) -> set[str]:
    return {t for t in TOKEN_RE.findall(text.lower()) if len(t) >= 3 and t not in STOPWORDS}


def score_subtopic(sub: dict, query: str) -> tuple[float, list[str]]:
    q_tokens = token_set(query)
    s_tokens = set(sub.get("keywords", []))

    token_overlap = q_tokens & s_tokens
    score = float(len(token_overlap))
    evidence = sorted(token_overlap)[:12]

    # Bonus for formula cue matches.
    q_lower = query.lower()
    for f in sub.get("formulas", []):
        f_norm = normalize_space(f.lower())
        if len(f_norm) >= 4 and f_norm in q_lower:
            score += 2.5
            evidence.append(f"formula:{f}")

    # Phrase cue bonus for title-level intent.
    title = (sub.get("title") or "").lower()
    for phrase in ["transform", "modulus", "inverse", "composite", "rational", "calculus", "probability"]:
        if phrase in title and phrase in q_lower:
            score += 1.0
            evidence.append(f"title:{phrase}")

    return score, evidence[:12]


def suggest(reference: dict, course: str, query: str, level_filter: str, top_k: int) -> list[dict]:
    candidates = reference["courses"].get(course, [])
    if level_filter in {"sl", "ahl"}:
        candidates = [c for c in candidates if str(c.get("level", "")).lower() == level_filter]

    ranked = []
    for sub in candidates:
        score, evidence = score_subtopic(sub, query)
        if score <= 0:
            continue
        ranked.append({
            "code": sub["code"],
            "title": sub["title"],
            "score": round(score, 3),
            "evidence": evidence,
            "snippet": sub["content"][:280],
        })

    ranked.sort(key=lambda r: r["score"], reverse=True)
    return ranked[:top_k]


def load_or_build_reference() -> dict:
    json_path = OUT_DIR / "subtopic_reference.json"
    if json_path.exists():
        return json.loads(json_path.read_text(encoding="utf-8"))
    ref = build_reference()
    write_outputs(ref)
    return ref


def main() -> None:
    parser = argparse.ArgumentParser(description="Syllabus-based subtopic allocator helper")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_build = sub.add_parser("build", help="Build AA/AI subtopic reference and Claude context files")
    p_build.add_argument("--course", choices=["aa", "ai", "both"], default="both")

    p_suggest = sub.add_parser("suggest", help="Suggest likely subtopic codes for question text")
    p_suggest.add_argument("--course", choices=["aa", "ai"], required=True)
    p_suggest.add_argument("--text", default="")
    p_suggest.add_argument("--text-file", default="")
    p_suggest.add_argument("--level", choices=["sl", "ahl", "both"], default="both")
    p_suggest.add_argument("--top-k", type=int, default=8)

    args = parser.parse_args()

    if args.cmd == "build":
        ref = build_reference()
        if args.course in {"aa", "ai"}:
            ref["courses"] = {args.course: ref["courses"][args.course]}
        write_outputs(ref)
        print("Build complete.")
        return

    if args.cmd == "suggest":
        text = args.text.strip()
        if args.text_file:
            text = Path(args.text_file).read_text(encoding="utf-8").strip()
        if not text:
            raise SystemExit("Provide --text or --text-file.")

        ref = load_or_build_reference()
        top = suggest(ref, args.course, text, args.level, args.top_k)
        print(json.dumps({
            "course": args.course,
            "level": args.level,
            "top_matches": top,
        }, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
