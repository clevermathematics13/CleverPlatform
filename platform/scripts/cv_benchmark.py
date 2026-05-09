#!/usr/bin/env python3
"""CV benchmark harness with quality gate support.

Usage:
  python scripts/cv_benchmark.py
  python scripts/cv_benchmark.py --min-pass-rate 1.0 --fail-on-case
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from cv_graph_extract import extract_graph_cv  # type: ignore  # noqa: E402


def _read_b64_image(image_path: Path) -> str:
    data = image_path.read_bytes()
    return base64.b64encode(data).decode("ascii")


def _extract_actual(result: dict[str, Any]) -> dict[str, Any]:
    graph_meta = result.get("graphMeta") or {}
    metadata = result.get("metadata") or {}

    key_points_raw = graph_meta.get("keyPoints") or []
    key_points: list[list[float]] = []
    for p in key_points_raw:
        x = p.get("x") if isinstance(p, dict) else None
        y = p.get("y") if isinstance(p, dict) else None
        if isinstance(x, (int, float)) and isinstance(y, (int, float)):
            key_points.append([float(x), float(y)])

    domain_raw = graph_meta.get("domain") or []
    domain: list[float] | None = None
    if isinstance(domain_raw, list) and len(domain_raw) == 2:
        if isinstance(domain_raw[0], (int, float)) and isinstance(domain_raw[1], (int, float)):
            domain = [float(domain_raw[0]), float(domain_raw[1])]

    warnings = metadata.get("warnings") or []
    return {
        "ok": bool(result.get("ok")),
        "method": metadata.get("method"),
        "domain": domain,
        "keyPoints": key_points,
        "warnings": warnings if isinstance(warnings, list) else [],
    }


def _float_close(a: float, b: float, tol: float) -> bool:
    return abs(a - b) <= tol


def _compare_case(actual: dict[str, Any], expected: dict[str, Any], tol_domain: float, tol_point: float) -> tuple[bool, list[str]]:
    failures: list[str] = []

    expected_method = expected.get("method")
    if expected_method and actual.get("method") != expected_method:
        failures.append(f"method mismatch: expected {expected_method}, got {actual.get('method')}")

    expected_domain = expected.get("domain")
    if isinstance(expected_domain, list) and len(expected_domain) == 2:
        actual_domain = actual.get("domain")
        if not isinstance(actual_domain, list) or len(actual_domain) != 2:
            failures.append("domain missing in actual result")
        else:
            if not _float_close(float(expected_domain[0]), float(actual_domain[0]), tol_domain):
                failures.append(
                    f"domain min mismatch: expected {expected_domain[0]}, got {actual_domain[0]} (tol={tol_domain})"
                )
            if not _float_close(float(expected_domain[1]), float(actual_domain[1]), tol_domain):
                failures.append(
                    f"domain max mismatch: expected {expected_domain[1]}, got {actual_domain[1]} (tol={tol_domain})"
                )

    expected_points = expected.get("keyPoints")
    if isinstance(expected_points, list):
        actual_points = actual.get("keyPoints") or []
        if len(actual_points) != len(expected_points):
            failures.append(f"keyPoints length mismatch: expected {len(expected_points)}, got {len(actual_points)}")
        else:
            for idx, (exp, got) in enumerate(zip(expected_points, actual_points)):
                if not isinstance(exp, list) or len(exp) != 2:
                    failures.append(f"invalid expected keyPoint at index {idx}")
                    continue
                ex, ey = float(exp[0]), float(exp[1])
                gx, gy = float(got[0]), float(got[1])
                if not _float_close(ex, gx, tol_point) or not _float_close(ey, gy, tol_point):
                    failures.append(
                        f"keyPoint[{idx}] mismatch: expected ({ex},{ey}), got ({gx},{gy}) (tol={tol_point})"
                    )

    expected_warnings = expected.get("warningsContain")
    if isinstance(expected_warnings, list) and expected_warnings:
        warnings = [str(w) for w in (actual.get("warnings") or [])]
        for fragment in expected_warnings:
            if not any(str(fragment) in w for w in warnings):
                failures.append(f"missing warning fragment: {fragment}")

    return (len(failures) == 0), failures


def run_benchmark(fixtures_path: Path) -> dict[str, Any]:
    payload = json.loads(fixtures_path.read_text(encoding="utf-8"))
    cases = payload.get("cases") or []
    if not isinstance(cases, list) or not cases:
        raise ValueError("fixtures file has no cases")

    results: list[dict[str, Any]] = []
    required_total = 0
    required_passed = 0
    passed = 0

    for case in cases:
        if not isinstance(case, dict):
            continue
        case_id = str(case.get("id") or "unknown")
        required = bool(case.get("required", True))
        image_path_raw = case.get("imagePath")
        if not isinstance(image_path_raw, str) or not image_path_raw:
            results.append(
                {
                    "id": case_id,
                    "required": required,
                    "passed": False,
                    "failures": ["imagePath missing"],
                }
            )
            continue

        image_path = (fixtures_path.parent / image_path_raw).resolve()
        if not image_path.exists():
            results.append(
                {
                    "id": case_id,
                    "required": required,
                    "passed": False,
                    "failures": [f"image not found: {image_path}"],
                }
            )
            continue

        b64 = _read_b64_image(image_path)
        extract = extract_graph_cv(b64)
        actual = _extract_actual(extract)

        expected = case.get("expected") or {}
        tolerance = case.get("tolerance") or {}
        tol_domain = float(tolerance.get("domain", 0.05))
        tol_point = float(tolerance.get("point", 0.10))

        case_passed, failures = _compare_case(actual, expected, tol_domain, tol_point)

        if case_passed:
            passed += 1
        if required:
            required_total += 1
            if case_passed:
                required_passed += 1

        results.append(
            {
                "id": case_id,
                "required": required,
                "passed": case_passed,
                "tolerance": {"domain": tol_domain, "point": tol_point},
                "expected": expected,
                "actual": actual,
                "failures": failures,
            }
        )

    total = len(results)
    pass_rate = float(passed / max(1, total))
    required_pass_rate = float(required_passed / max(1, required_total)) if required_total else 1.0

    return {
        "ok": True,
        "fixtures": str(fixtures_path),
        "totalCases": total,
        "passedCases": passed,
        "passRate": pass_rate,
        "requiredCases": required_total,
        "requiredPassed": required_passed,
        "requiredPassRate": required_pass_rate,
        "results": results,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run CV extraction benchmarks and quality gate checks")
    parser.add_argument(
        "--fixtures",
        default=str(SCRIPT_DIR / "cv_benchmark_fixtures.json"),
        help="Path to benchmark fixtures JSON",
    )
    parser.add_argument("--report", default="", help="Optional output report JSON path")
    parser.add_argument("--min-pass-rate", type=float, default=1.0, help="Minimum total pass rate required")
    parser.add_argument(
        "--min-required-pass-rate",
        type=float,
        default=1.0,
        help="Minimum pass rate for required cases",
    )
    parser.add_argument(
        "--fail-on-case",
        action="store_true",
        help="Fail if any required benchmark case fails",
    )
    args = parser.parse_args()

    fixtures_path = Path(args.fixtures).resolve()
    summary = run_benchmark(fixtures_path)

    out = json.dumps(summary, indent=2)
    if args.report:
        Path(args.report).write_text(out, encoding="utf-8")
    print(out)

    fail_reasons: list[str] = []
    if summary["passRate"] < args.min_pass_rate:
        fail_reasons.append(
            f"pass rate {summary['passRate']:.3f} is below required {args.min_pass_rate:.3f}"
        )
    if summary["requiredPassRate"] < args.min_required_pass_rate:
        fail_reasons.append(
            f"required pass rate {summary['requiredPassRate']:.3f} is below required {args.min_required_pass_rate:.3f}"
        )
    if args.fail_on_case:
        required_failures = [r for r in summary["results"] if r.get("required") and not r.get("passed")]
        if required_failures:
            fail_reasons.append(f"{len(required_failures)} required case(s) failed")

    if fail_reasons:
        for reason in fail_reasons:
            print(f"QUALITY GATE FAILED: {reason}", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
