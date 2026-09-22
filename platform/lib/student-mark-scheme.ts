/**
 * Student-facing mark scheme, rendered as a standalone HTML page for the
 * CleverReflection self-assess flow (app/api/tests/[id]/mark-scheme).
 *
 * Deliberately NOT the teacher archive (tests.mark_scheme_pdf_storage_path /
 * lib/document-orchestrator.ts generateMarkSchemeHtml). That document is the
 * teacher's working copy -- internal M1/A1/R1 marking-code shorthand, the
 * course's marking principles, and the reteach guide -- and its own storage
 * bucket is teacher-only by RLS policy, deliberately (see the comment on
 * tests.mark_scheme_pdf_storage_path and the incident fixed by migration
 * 20260911142419_restrict_student_markscheme_images.sql, which closed
 * exactly this kind of leak for question-bank mark schemes). This module
 * builds a second, separate document from the same source content: the
 * answer and the marking note for each question, in plain language, with
 * the M/A/R shorthand stripped and none of the teacher-only sections.
 */

import { renderMath } from "./document-orchestrator";
import { escapeHtml } from "./assignments";

export interface StudentMarkSchemeSubpart {
  prompt: string;
  marks?: number;
  answer?: string;
  markScheme?: string;
}

export interface StudentMarkSchemeQuestion {
  prompt: string;
  marks?: number;
  answer?: string;
  markScheme?: string;
  subparts?: StudentMarkSchemeSubpart[];
}

export interface StudentMarkSchemeSection {
  heading: string;
  questions: StudentMarkSchemeQuestion[];
}

export interface StudentMarkSchemeRequest {
  title: string;
  subtitle?: string;
  sections: StudentMarkSchemeSection[];
}

/** A run of one to four chained M/A/R marking codes (M1, A1, R1, M0A0,
 *  M1M0A0, M0M0A1R1, ...), the internal shorthand a teacher's mark scheme
 *  is written in. Matched greedily with the following "for" so "A1 for 3"
 *  reduces to "3" rather than "for 3". */
const MARK_CODE_WITH_FOR = /\b(?:[MAR]\d){1,4}\s+for\s+/gi;
const MARK_CODE_BARE = /\b(?:[MAR]\d){1,4}\b\.?/g;

/** Strips M/A/R marking-code shorthand from a teacher's markScheme note,
 *  leaving the plain-language explanation a student can read on its own.
 *  Not a full rewrite -- the remaining prose was written to follow the
 *  codes, so the result reads a little tersely -- but no internal notation
 *  survives, which is the property that matters here. */
export function stripMarkCodes(text: string): string {
  let out = text.replace(MARK_CODE_WITH_FOR, "");
  out = out.replace(MARK_CODE_BARE, "");
  out = out.replace(/\s{2,}/g, " ").trim();
  out = out.replace(/^[.,;:\s]+/, "");
  out = out.replace(/(^|[.!?]\s+)([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
  return out;
}

function questionBlockHtml(label: string, q: { prompt: string; marks?: number; answer?: string; markScheme?: string }): string {
  const marksHtml = q.marks !== undefined ? `<span class="sms-marks">[${q.marks} mark${q.marks === 1 ? "" : "s"}]</span>` : "";
  const answerHtml = q.answer
    ? `<div class="sms-answer"><span class="sms-tag">Answer</span>${renderMath(escapeHtml(q.answer))}</div>` : "";
  const noteHtml = q.markScheme
    ? `<div class="sms-note"><span class="sms-tag">How it's marked</span>${renderMath(escapeHtml(stripMarkCodes(q.markScheme)))}</div>` : "";
  return `<div class="sms-row">
    <div class="sms-head"><span class="sms-label">${escapeHtml(label)}</span>${marksHtml}</div>
    ${answerHtml}
    ${noteHtml}
  </div>`;
}

/** Renders the full student mark-scheme page. Question numbering mirrors
 *  the paper's own (Q1, Q2(a), Q2(b), ...) via the same global-counter
 *  scheme lib/document-orchestrator.ts uses for the teacher version. */
export function buildStudentMarkSchemeHtml(req: StudentMarkSchemeRequest): string {
  let globalQ = 0;

  const sectionsHtml = req.sections.map((section) => {
    const questionsHtml = section.questions.map((q) => {
      globalQ++;
      const label = String(globalQ);
      const own = q.subparts && q.subparts.length > 0 ? "" : questionBlockHtml(label, q);
      const subpartsHtml = (q.subparts ?? [])
        .map((sp, i) => questionBlockHtml(`${label}(${String.fromCharCode(97 + i)})`, sp))
        .join("");
      return own + subpartsHtml;
    }).join("");
    return `<section class="sms-section"><h2>${escapeHtml(section.heading)}</h2>${questionsHtml}</section>`;
  }).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Mark Scheme — ${escapeHtml(req.title)}</title>
<link rel="stylesheet" href="/katex/katex.min.css"/>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 860px; margin: 0 auto; padding: 24px 20px 64px; color: #1a1a1a; background: #fff; }
  h1 { font-size: 1.4rem; margin-bottom: 0; }
  h2 { font-size: 1.05rem; margin: 28px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #e5b800; }
  .sms-subtitle { color: #555; margin-top: 2px; margin-bottom: 8px; }
  .sms-banner { background: #fff7d6; border: 1px solid #e5b800; border-radius: 8px; padding: 10px 14px; margin: 14px 0 24px; font-size: 0.92rem; }
  .sms-row { border: 1px solid #e2e2e2; border-radius: 8px; padding: 10px 14px; margin-bottom: 10px; }
  .sms-head { display: flex; justify-content: space-between; align-items: baseline; }
  .sms-label { font-weight: 700; }
  .sms-marks { color: #666; font-size: 0.9rem; }
  .sms-tag { display: block; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase; color: #8a6d00; margin-top: 8px; }
  .sms-answer, .sms-note { margin-top: 2px; }
</style>
</head>
<body>
  <h1>${escapeHtml(req.title)}</h1>
  ${req.subtitle ? `<div class="sms-subtitle">${escapeHtml(req.subtitle)}</div>` : ""}
  <div class="sms-banner">Use this to self-grade: check your working against the answer and marking note for each question, then enter the marks you earned on the self-assess page.</div>
  ${sectionsHtml}
</body>
</html>`;
}
