/**
 * The student-facing mark scheme: what a student reads beside each part of
 * the self-grade form and the comparison table, on the full mark-scheme page
 * (app/mark-scheme/[id]), and what the teacher's Re-mark Requests page shows
 * as "the mark scheme as the student sees it".
 *
 * Deliberately NOT the teacher archive (tests.mark_scheme_pdf_storage_path /
 * lib/document-orchestrator.ts generateMarkSchemeHtml). That document is the
 * teacher's working copy -- internal M1/A1/R1 marking-code shorthand, the
 * course's marking principles, and the reteach guide -- and its own storage
 * bucket is teacher-only by RLS policy, deliberately (see the comment on
 * tests.mark_scheme_pdf_storage_path and the incident fixed by migration
 * 20260911142419_restrict_student_markscheme_images.sql, which closed
 * exactly this kind of leak for question-bank mark schemes). This module
 * builds a second, separate document from the same source content.
 *
 * Each part is a card that leads with the answer. When the part has a
 * current written explanation (lib/mark-scheme-explanation.ts) the card is
 * that explanation -- the answer, how the marks work, a few watch-out notes
 * and the "Explain more" slides -- with the teacher's own answer and note,
 * marking codes put into words, one click away. Without one, the card is
 * the teacher's answer and note, as it always was.
 *
 * Two sources, one card. A paper written in the Formative Assessment creator
 * has its draft in tests.custom_content; a paper that arrived as PDFs -- a
 * Grade 9 Standard Level paper through lib/standards-import.ts -- has none,
 * and its mark scheme is each part's test_items.markscheme_text.
 * explanationPartSources reads both the same way.
 */

import { renderMath } from "./document-orchestrator";
import { escapeHtml } from "./assignments";
import { renderMathTextHtml } from "./tex-render";
import {
  currentExplanations,
  explanationPartSources,
  type ExplanationPartItem,
  type MarkSchemeExplanation,
  type StoredExplanation,
} from "./mark-scheme-explanation";
import type { ReflectionMarkGuide, ReflectionMarkScheme } from "./reflection-types";

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

// The release paths live in their own module so a client component (the
// test page's release button) can use them without this module's KaTeX.
export { releasesStudentMarkScheme, studentMarkSchemePagePath, studentMarkSchemePath } from "./student-mark-scheme-paths";

/** One part's mark scheme as display HTML: the answer, and the note with its
 *  marking codes in words, each escaped and then typeset -- and, when the
 *  part has a current written explanation, that explanation as the card's
 *  lead (renderMarkGuide). The single renderer behind the self-grade form,
 *  the comparison table, the full mark-scheme page and the teacher's
 *  Re-mark Requests page, so none of them can say something different. Null
 *  when the part has nothing to show -- including a note that was only a
 *  label ("A1."), which would otherwise be an empty box. */
export function renderStudentMarkSchemePart(
  source: { answer?: string | null; markScheme?: string | null },
  explanation?: MarkSchemeExplanation | null,
): ReflectionMarkScheme | null {
  const answer = source.answer?.trim();
  const note = source.markScheme?.trim() ? stripMarkCodes(source.markScheme) : "";
  if (!answer && !note && !explanation) return null;
  return {
    answer_html: answer ? renderMath(escapeHtml(answer)) : null,
    how_marked_html: note ? renderMath(escapeHtml(note)) : null,
    guide: explanation ? renderMarkGuide(explanation) : null,
  };
}

/** A written explanation as the card shows it: what is always visible
 *  typeset here, the "Explain more" steps left as source for the browser to
 *  typeset when a student opens them (ReflectionMarkGuide). */
export function renderMarkGuide(explanation: MarkSchemeExplanation): ReflectionMarkGuide {
  return {
    answer_html: renderMathTextHtml(explanation.answer),
    marks: explanation.marks.map((m) => ({ marks: m.marks, html: renderMathTextHtml(m.text) })),
    watch_html: explanation.watch.map((w) => renderMathTextHtml(w)),
    steps: explanation.steps,
  };
}

/** What studentMarkSchemeParts and studentMarkSchemeRows read from each
 *  test_items row. Deliberately no marking_notes: those are the teacher's
 *  rulings written to the AI marker, in its vocabulary, and never a mark
 *  scheme for a student. */
export type StudentMarkSchemeItem = ExplanationPartItem;

/**
 * Every part's mark scheme, keyed by test_items.id, from the same source
 * the full page uses: the creator draft when the test has one, else each
 * item's own markscheme_text (explanationPartSources in
 * lib/mark-scheme-explanation.ts, which matches a draft to its items by
 * sort_order the way buildTestItemsFromSections assigned it). `stored` is
 * the test's written explanations; each part gets its own only while it is
 * current -- written from the part as it stands now. A part with nothing to
 * show is left out.
 */
export function studentMarkSchemeParts(
  customContent: unknown,
  items: ReadonlyArray<StudentMarkSchemeItem>,
  stored: ReadonlyMap<string, StoredExplanation> = new Map(),
): Map<string, ReflectionMarkScheme> {
  const sources = explanationPartSources(customContent, items);
  const explanations = currentExplanations(sources, stored);
  const parts = new Map<string, ReflectionMarkScheme>();
  for (const source of sources) {
    const part = renderStudentMarkSchemePart(source, explanations.get(source.itemId));
    if (part) parts.set(source.itemId, part);
  }
  return parts;
}

/** One row of the full mark-scheme page. */
export interface StudentMarkSchemeRow {
  itemId: string;
  /** As the self-grade form labels the part: "2.1(a)", "5", "2(d)". */
  label: string;
  maxMarks: number;
  scheme: ReflectionMarkScheme | null;
}

/**
 * The full mark-scheme page, row for row with the self-grade form: every
 * item in sort_order under the form's own label -- the printed paper's
 * "<section>.<question>" numbering on a creator paper (paperQuestionPrefixes
 * gives the form the same prefixes), else question_number -- then the part
 * letter. A part with no scheme keeps its row, so the page and the form
 * never disagree about which part is which.
 */
export function studentMarkSchemeRows(
  customContent: unknown,
  items: ReadonlyArray<StudentMarkSchemeItem>,
  stored: ReadonlyMap<string, StoredExplanation> = new Map(),
): StudentMarkSchemeRow[] {
  const sources = new Map(explanationPartSources(customContent, items).map((s) => [s.itemId, s]));
  const schemes = studentMarkSchemeParts(customContent, items, stored);
  return [...items]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((item) => ({
      itemId: item.id,
      label:
        sources.get(item.id)?.label ??
        (item.part_label ? `${item.question_number}(${item.part_label})` : String(item.question_number)),
      maxMarks: item.max_marks,
      scheme: schemes.get(item.id) ?? null,
    }));
}
