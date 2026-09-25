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
 * the M/A/R/FT shorthand put into words and none of the teacher-only
 * sections.
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

/** The kinds of mark a teacher's scheme awards, in the words the Formative
 *  Assessment marking principles use for them
 *  (grading_policies/g9_formative_assessment_marking_principles.md) -- and
 *  the words the schemes' own prose already uses ("the answer mark", "the
 *  second method mark"), so the translated codes and the prose around them
 *  agree. */
type MarkKind = "M" | "A" | "R";
const MARK_KIND_WORD: Record<MarkKind, string> = { M: "method", A: "answer", R: "reasoning" };
const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"];

/** The shorthand a teacher's scheme is written in: a run of chained M/A/R
 *  codes (M1, A1, R1, M0A0, M1M0A0, M0M0A1R1, "M1 A1"; "M1s" as a plural),
 *  or FT for follow-through. */
const MARK_TOKEN = /\b(?:([MAR]\d(?: ?[MAR]\d){0,7})(s?)|(FT))\b/g;

/** A kind of mark named by its letter alone: "the second M", "the A mark",
 *  "an M mark". After an ordinal the letter is always a mark; after an
 *  article only when "mark" follows, since "A" also opens sentences and
 *  names points and variables. */
const BARE_KIND = /\b(an?|the|any|each|every|no|first|second|third|fourth|final|last)\s+([MAR])(?![\w'])(\s+marks?\b)?/gi;
const ORDINAL_WORD = /^(?:first|second|third|fourth|final|last)$/i;

/** A word that comes before a code used as a noun: "the R1", "no A1". */
const DETERMINER_BEFORE = /\b(?:the|a|an|this|that|each|every|no|its|their|any|both|either|one)\s*$/i;

/** A code standing alone as a label, with what ends it: "A1." / "R1:" /
 *  "A1 -- the whole expression ..." / a bare "A1" ending the note. */
const STANDALONE_AFTER = /^(?:\s*[.,:](?=\s|$)|\s*(?:--|\u2014)(?=\s)|\s*$)/;

/** A plain word, safe to capitalise where a dropped label opened a sentence:
 *  two or more letters with a vowel, followed by more words. Never a
 *  variable -- "x =", "u^2", "px - rx" all stay as written. */
const PLAIN_WORD_AHEAD = /^(?=[a-z]{2,}\s+[A-Za-z'"(])(?=[a-z]*[aeiou])/;

type MarkCode = { kind: MarkKind; n: number };

function parseCodes(run: string): MarkCode[] {
  return [...run.matchAll(/([MAR])(\d)/g)].map((m) => ({ kind: m[1] as MarkKind, n: Number(m[2]) }));
}

/** Where a code sits: opening a sentence, opening a clause inside one (after
 *  ";", ":", "(" or a dash), or inside running text as a noun ("earns M1A0"). */
function codePosition(before: string): "sentence" | "clause" | "inline" {
  const t = before.trimEnd();
  if (t === "" || /[.!?]['")\]]*$/.test(t)) return "sentence";
  if (/(?:[;:(]|--|\u2014)$/.test(t)) return "clause";
  return "inline";
}

/** The codes of each kind in a run, in the order the run first names them. */
function codesByKind(codes: MarkCode[]): [MarkKind, MarkCode[]][] {
  const byKind = new Map<MarkKind, MarkCode[]>();
  for (const code of codes) byKind.set(code.kind, [...(byKind.get(code.kind) ?? []), code]);
  return [...byKind];
}

/** "M1 for ..." opening a sentence names what a mark is for: "method mark",
 *  "method mark and answer mark", "2 method marks". */
function labelWords(codes: MarkCode[]): string {
  return codesByKind(codes)
    .map(([kind, list]) => {
      const total = list.reduce((sum, c) => sum + c.n, 0);
      return total === 1 ? `${MARK_KIND_WORD[kind]} mark` : `${total} ${MARK_KIND_WORD[kind]} marks`;
    })
    .join(" and ");
}

/** A code used as a noun, in running text: "earns M1A0" is "earns the method
 *  mark only", "earns M0A0" is "earns no marks", "the R1 is" is "the
 *  reasoning mark is". */
function nounWords(
  codes: MarkCode[],
  plural: boolean,
  before: string,
  after: string,
  labelled: Map<MarkKind, number>,
): string {
  if (codes.length === 1) {
    const { kind, n } = codes[0];
    const word = MARK_KIND_WORD[kind];
    if (DETERMINER_BEFORE.test(before)) {
      if (/^\s+marks?\b/.test(after)) return word;
      return n > 1 ? `${n} ${word} marks` : plural ? `${word} marks` : `${word} mark`;
    }
    if (n === 0) return `no ${word} mark`;
    if (n > 1) return `${n} ${word} marks`;
    if (plural) return `${word} marks`;
    // "the answer mark" when the note has one; "a method mark" when it
    // labels two and this sentence could mean either.
    const article = (labelled.get(kind) ?? 0) > 1 ? (kind === "A" ? "an" : "a") : "the";
    return `${article} ${word} mark`;
  }

  if (DETERMINER_BEFORE.test(before)) return labelWords(codes);
  if (codes.every((c) => c.n === 0)) return "no marks";
  const awarded = codesByKind(codes).flatMap(([kind, list]) => {
    const word = MARK_KIND_WORD[kind];
    const got = list.flatMap((c, i) => (c.n > 0 ? [i] : []));
    if (got.length === 0) return [];
    if (list.length === 1) return [list[0].n === 1 ? `the ${word} mark` : `${list[0].n} ${word} marks`];
    if (got.length === list.length) return [list.length === 2 ? `both ${word} marks` : `all ${list.length} ${word} marks`];
    return got.map((i) => `the ${ORDINALS[i] ?? `${i + 1}th`} ${word} mark`);
  });
  const partial = codes.some((c) => c.n === 0) && !/^\s*only\b/.test(after);
  return awarded.join(" and ") + (partial ? " only" : "");
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Puts the M/A/R/FT marking-code shorthand of a teacher's markScheme note
 *  into plain words, so a student can read it on its own and no internal
 *  notation survives.
 *
 *  Each code becomes the words it stands for, in the teacher's own
 *  vocabulary, rather than being deleted: a deleted code left sentences with
 *  a hole where their object was ("three of four earns M1A0." read "three of
 *  four earns"). A code that only labels the part ("A1." opening a one-mark
 *  note) is dropped, since it adds nothing a student needs.
 *
 *  The teacher's own text is never recapitalised: that turned variables into
 *  different ones ("A1 for x = ..." read "X = ...") and capitalised after
 *  "e.g.". Only the words put in here are capitalised, where they open a
 *  sentence. */
export function stripMarkCodes(source: string): string {
  const text = source.replace(BARE_KIND, (whole, det: string, letter: string, mark: string | undefined) => {
    if (!/^[MAR]$/.test(letter) || (!mark && !ORDINAL_WORD.test(det))) return whole;
    const word = MARK_KIND_WORD[letter as MarkKind];
    // "an M mark" is "a method mark", keeping a capital that opened a sentence.
    let article = det;
    if (/^an?$/i.test(det)) {
      article = letter === "A" ? "an" : "a";
      if (det[0] === det[0].toUpperCase()) article = capitalise(article);
    }
    return `${article} ${word}${mark ?? " mark"}`;
  });

  // How many marks of each kind the note labels, so a lone code can be "the
  // answer mark" when there is one and "a method mark" when there are two.
  const labelled = new Map<MarkKind, number>();
  for (const m of text.matchAll(MARK_TOKEN)) {
    if (!m[1] || codePosition(text.slice(0, m.index)) === "inline") continue;
    for (const code of parseCodes(m[1])) labelled.set(code.kind, (labelled.get(code.kind) ?? 0) + 1);
  }

  let out = "";
  let cursor = 0;
  for (const m of text.matchAll(MARK_TOKEN)) {
    const start = m.index;
    if (start < cursor) continue;
    const before = text.slice(0, start);
    const after = text.slice(start + m[0].length);
    const position = codePosition(before);
    let end = start + m[0].length;
    let words: string;

    if (m[3]) {
      // "but FT through (b)" -- follow-through as a verb.
      const through = /^\s+through\b/.exec(after);
      if (through) end += through[0].length;
      words = through ? "follow-through applies to" : "follow-through";
    } else {
      const codes = parseCodes(m[1]);
      const standalone = position === "inline" ? null : STANDALONE_AFTER.exec(after);
      if (standalone) {
        out += text.slice(cursor, start);
        end += standalone[0].length;
        end += /^\s*/.exec(text.slice(end))![0].length;
        cursor = end;
        // "A1 -- the whole expression ..." carries on the sentence the label
        // opened, in the teacher's words; "A1. The sign ..." starts a new one.
        if (position === "sentence" && !standalone[0].includes(".") && PLAIN_WORD_AHEAD.test(text.slice(cursor))) {
          out += text.charAt(cursor).toUpperCase();
          cursor += 1;
        }
        continue;
      }
      words =
        position !== "inline" && /^\s+for\b/i.test(after) && codes.every((c) => c.n > 0)
          ? labelWords(codes)
          : nounWords(codes, m[2] === "s", before, after, labelled);
    }

    // "an M1" is "a method mark": the article agrees with the words put in.
    const lead = text.slice(cursor, start).replace(/\b(an?)(\s+)$/i, (_w, art: string, space: string) => {
      const agreed = /^[aeiou]/i.test(words) ? "an" : "a";
      return (art[0] === art[0].toUpperCase() ? capitalise(agreed) : agreed) + space;
    });
    out += lead + (position === "sentence" ? capitalise(words) : words);
    cursor = end;
  }
  out += text.slice(cursor);
  return out.replace(/\s{2,}/g, " ").trim();
}

/** Where the platform serves a test's student mark scheme. A test whose
 *  tests.mark_scheme_url is exactly this has released THIS page (migrations
 *  20260922182232 and 20260923152709 set it), which is what lets the
 *  self-grade form show the same content part by part. */
export function studentMarkSchemePath(testId: string): string {
  return `/api/tests/${testId}/mark-scheme`;
}

/** Whether a test's students are shown this platform's mark scheme: the full
 *  page, and each part's scheme on its row of the self-grade form
 *  (attachStudentMarkScheme in lib/exam-service.ts). A test whose scheme was
 *  released as a link somewhere else, or not released at all, shows them
 *  none of it. The teacher's Re-mark Requests page asks the same question,
 *  so it never says a student saw a scheme they were not shown. */
export function releasesStudentMarkScheme(test: { id: string; mark_scheme_url: string | null }): boolean {
  return test.mark_scheme_url === studentMarkSchemePath(test.id);
}

/** One part's mark scheme as display HTML: the answer, and the note with its
 *  marking codes in words, each escaped and then typeset. The single renderer
 *  behind both the full page and the copy shown beside each self-grade box,
 *  so the two cannot say different things. Null when the part has neither --
 *  including a note that was only a label ("A1."), which would otherwise be
 *  an empty box. */
export function renderStudentMarkSchemePart(source: {
  answer?: string | null;
  markScheme?: string | null;
}): ReflectionMarkScheme | null {
  const answer = source.answer?.trim();
  const note = source.markScheme?.trim() ? stripMarkCodes(source.markScheme) : "";
  if (!answer && !note) return null;
  return {
    answer_html: answer ? renderMath(escapeHtml(answer)) : null,
    how_marked_html: note ? renderMath(escapeHtml(note)) : null,
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
