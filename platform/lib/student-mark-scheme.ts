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
 *
 * Two sources, one page. A paper written in the Formative Assessment creator
 * has its draft in tests.custom_content (buildStudentMarkSchemeHtml). A paper
 * that arrived as PDFs -- a Grade 9 Standard Level paper through
 * lib/standards-import.ts -- has no draft, and its mark scheme is each
 * part's test_items.markscheme_text (buildStudentMarkSchemeHtmlFromItems).
 */

import { renderMath } from "./document-orchestrator";
import { escapeHtml, formatQuestionLabel, subpartLetter } from "./assignments";
import type { ReflectionMarkScheme } from "./reflection-types";

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

/** One test_items row, as much of it as a student may see. Deliberately no
 *  marking_notes: those are the teacher's rulings written to the AI marker
 *  (buildUnitBlock in lib/ai-grading.ts), in its vocabulary -- confidence
 *  labels, tokens, the markBreakdown -- and not a mark scheme for a student. */
export interface StudentMarkSchemeItem {
  question_number: number;
  part_label: string | null;
  max_marks: number;
  markscheme_text: string | null;
}

export interface StudentMarkSchemeFromItemsRequest {
  title: string;
  subtitle?: string;
  /** In test_items.sort_order, the order the self-grade form lists them. */
  items: StudentMarkSchemeItem[];
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

/** Where the platform serves a test's student mark scheme. A test whose
 *  tests.mark_scheme_url is exactly this has released THIS page (migrations
 *  20260922182232 and 20260923152709 set it), which is what lets the
 *  self-grade form show the same content part by part. */
export function studentMarkSchemePath(testId: string): string {
  return `/api/tests/${testId}/mark-scheme`;
}

/** One part's mark scheme as display HTML: the answer, and the note with its
 *  marking codes stripped, each escaped and then typeset. The single renderer
 *  behind both the full page and the copy shown beside each self-grade box,
 *  so the two cannot say different things. Null when the part has neither. */
export function renderStudentMarkSchemePart(source: {
  answer?: string | null;
  markScheme?: string | null;
}): ReflectionMarkScheme | null {
  const answer = source.answer?.trim();
  const markScheme = source.markScheme?.trim();
  if (!answer && !markScheme) return null;
  return {
    answer_html: answer ? renderMath(escapeHtml(answer)) : null,
    how_marked_html: markScheme ? renderMath(escapeHtml(stripMarkCodes(markScheme))) : null,
  };
}

/** Every part's mark scheme, keyed by test_items.id, from the same source
 *  the full page uses: the creator draft when the test has one, else each
 *  item's own markscheme_text. A draft is matched to its items by
 *  sort_order, which buildTestItemsFromSections
 *  (lib/formative-assessment-bridge.ts) assigns walking the draft in exactly
 *  this order -- a question's subparts, or the question itself when it has
 *  none -- and which paperQuestionPrefixes relies on the same way. A part
 *  with nothing to show is left out. */
export function studentMarkSchemeParts(
  customContent: unknown,
  items: ReadonlyArray<{ id: string; sort_order: number; markscheme_text: string | null }>,
): Map<string, ReflectionMarkScheme> {
  const sections = (customContent as { sections?: StudentMarkSchemeSection[] } | null | undefined)?.sections;
  const draftParts =
    Array.isArray(sections) && sections.length > 0
      ? sections.flatMap((section) =>
          (section.questions ?? []).flatMap((q) => (q.subparts && q.subparts.length > 0 ? q.subparts : [q])),
        )
      : null;

  const parts = new Map<string, ReflectionMarkScheme>();
  for (const item of items) {
    const source = draftParts ? draftParts[item.sort_order] : { markScheme: item.markscheme_text };
    const part = source ? renderStudentMarkSchemePart(source) : null;
    if (part) parts.set(item.id, part);
  }
  return parts;
}

function questionBlockHtml(label: string, q: { marks?: number; answer?: string; markScheme?: string }): string {
  const marksHtml = q.marks !== undefined ? `<span class="sms-marks">[${q.marks} mark${q.marks === 1 ? "" : "s"}]</span>` : "";
  const part = renderStudentMarkSchemePart(q);
  const answerHtml = part?.answer_html
    ? `<div class="sms-answer"><span class="sms-tag">Answer</span>${part.answer_html}</div>` : "";
  const noteHtml = part?.how_marked_html
    ? `<div class="sms-note"><span class="sms-tag">How it's marked</span>${part.how_marked_html}</div>` : "";
  return `<div class="sms-row">
    <div class="sms-head"><span class="sms-label">${escapeHtml(label)}</span>${marksHtml}</div>
    ${answerHtml}
    ${noteHtml}
  </div>`;
}

/** Renders the full student mark-scheme page. Questions are numbered the way
 *  the printed paper numbers them ("1.2", "2.1(a)"): formatQuestionLabel,
 *  numeric, which is also what paperQuestionPrefixes (lib/assignments.ts)
 *  gives the self-grade form's rows. A student reads this page beside that
 *  form, so the two have to agree row for row. It used to count questions
 *  across the whole paper instead, as the teacher mark scheme
 *  (generateMarkSchemeHtml) still does, so the form's "2.1(a)" was "4(a)"
 *  here. */
export function buildStudentMarkSchemeHtml(req: StudentMarkSchemeRequest): string {
  const sectionsHtml = req.sections.map((section, sIdx) => {
    const questionsHtml = section.questions.map((q, qIdx) => {
      const label = formatQuestionLabel(sIdx, qIdx, "numeric");
      const own = q.subparts && q.subparts.length > 0 ? "" : questionBlockHtml(label, q);
      const subpartsHtml = (q.subparts ?? [])
        .map((sp, i) => questionBlockHtml(`${label}(${subpartLetter(i)})`, sp))
        .join("");
      return own + subpartsHtml;
    }).join("");
    return `<section class="sms-section"><h2>${escapeHtml(section.heading)}</h2>${questionsHtml}</section>`;
  }).join("");

  return pageHtml(req.title, req.subtitle, sectionsHtml);
}

/** How the self-grade form labels an item when the test has no draft to
 *  read the paper's own numbering from (components/reflection/NativeForm:
 *  paper_label ?? question_number, then the part in brackets): "2(d)", "5". */
function itemLabel(item: Pick<StudentMarkSchemeItem, "question_number" | "part_label">): string {
  return item.part_label ? `${item.question_number}(${item.part_label})` : String(item.question_number);
}

/** The same page for a paper with no creator draft, built from its
 *  test_items: one row per part, in the self-grade form's order and under
 *  its labels, each carrying the part's markscheme_text -- for a Standard
 *  Level paper the rubric's "a full-mark response shows ..." line with the
 *  answer in it. A part with no mark scheme text still gets its row, so the
 *  page and the form keep the same rows. */
export function buildStudentMarkSchemeHtmlFromItems(req: StudentMarkSchemeFromItemsRequest): string {
  const rowsHtml = req.items
    .map((item) =>
      questionBlockHtml(itemLabel(item), {
        marks: item.max_marks,
        markScheme: item.markscheme_text?.trim() || undefined,
      }),
    )
    .join("");
  return pageHtml(req.title, req.subtitle, `<section class="sms-section">${rowsHtml}</section>`);
}

function pageHtml(title: string, subtitle: string | undefined, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Mark Scheme — ${escapeHtml(title)}</title>
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
  <h1>${escapeHtml(title)}</h1>
  ${subtitle ? `<div class="sms-subtitle">${escapeHtml(subtitle)}</div>` : ""}
  <div class="sms-banner">Use this to self-grade: check your working against the answer and marking note for each question, then enter the marks you earned on the self-assess page.</div>
  ${bodyHtml}
</body>
</html>`;
}
