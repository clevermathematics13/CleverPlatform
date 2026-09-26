/**
 * IB mark codes in a PPQ mark scheme, read the way an examiner reads them.
 *
 * The bank stores each part's scheme as LaTeX with every code right-aligned
 * after `\hfill` (IB_LATEX_STYLE_GUIDE in lib/latex-utils.ts): `\hfill M1`,
 * `\hfill (A1)(A1)`, `\hfill A1 N2`, `\hfill AG`. This module values those
 * codes so a transcribed scheme can be checked against its printed
 * `[N marks]`, and so the grader can total a breakdown without assuming
 * that every token is one mark.
 *
 * Deliberately NOT parseMSTokens (lib/latex-utils.ts): that parser misses the
 * middle code of `\hfill M1 A1 A1` and picks up codes at the end of Note
 * lines ("... award A1"). It stays what it is, the mark-attribution parser
 * whose ordinals LatexRenderer numbers by; changing it would re-point the
 * stored mark_attributions keys.
 *
 * What each code is worth, per the IB markscheme instructions:
 * - M, A, R carry the digit they show (A2 is two marks awarded as a unit).
 *   A bracketed code, (M1), is an implied mark; it is worth the same.
 * - AG ("answer given") is worth nothing: the answer is printed in the
 *   question.
 * - N marks are the total for a correct answer with NO working. They are an
 *   alternative to the M/A/R marks of the same part, never added to them.
 * - FT (follow through) is a note, not a mark.
 */

export type MarkCodeKind = "M" | "A" | "R" | "N" | "AG" | "FT";

export interface MarkCode {
  /** As written, parentheses included: "(A1)", "M1", "A2", "AG", "N2". */
  token: string;
  kind: MarkCodeKind;
  /** Marks the code carries. 0 for AG and FT. For N, its no-working value. */
  value: number;
  /** A bracketed code: may be implied by later correct working. */
  implied: boolean;
}

/**
 * One code, or AG / FT. No \b anchors: codes run together ("M1A1",
 * "(M1)A1"), and between "1" and "A" there is no word boundary. Whether a
 * match is really a code is decided by its neighbours in parseMarkCodeGroup.
 */
const CODE_RE = /\(([MARN])(\d)\)|([MARN])(\d)|AG|FT|ft/g;

/**
 * Strip the LaTeX a code group may be wrapped in: \textbf{A1}, \textit{},
 * \mathbf{}, \text{}, spacing commands and tildes. Codes are plain
 * capitals in the canonical form; this only tolerates the variants a
 * transcription sometimes produces.
 */
function unwrapCodeText(text: string): string {
  return text
    .replace(/\\(?:textbf|textit|textrm|textsf|mathbf|mathrm|text|emph)\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\(?:quad|qquad|,|;|:|!|enspace|hspace\*?\{[^}]*\})/g, " ")
    .replace(/[~$]/g, " ")
    .replace(/[{}]/g, " ");
}

/** Every code in one group of text, in order: "M1A1", "(A1)(A1)", "A1 N2". */
export function parseMarkCodeGroup(text: string): MarkCode[] {
  const codes: MarkCode[] = [];
  const clean = unwrapCodeText(text);
  for (const m of clean.matchAll(CODE_RE)) {
    const whole = m[0];
    const start = m.index ?? 0;
    const end = start + whole.length;
    const before = start > 0 ? clean[start - 1] : " ";
    const after = end < clean.length ? clean[end] : " ";
    const isWordCode = whole === "AG" || whole === "FT" || whole === "ft";
    // A code glued to letters before it is part of a word ("RMA1", "left").
    // A digit or ")" before it is fine: that is a run of codes, "M1A1".
    if (/[A-Za-z]/.test(before)) continue;
    // Nor may a word run on after it ("AGAIN", "A1b"), except the "ft"
    // some schemes glue to a code ("A1ft"); a following capital starts the
    // next code, which is fine for M/A/R/N but not for AG or FT.
    if (/[a-z]/.test(after) && clean.slice(end, end + 2) !== "ft") continue;
    if (/[0-9]/.test(after)) continue;
    if (isWordCode && /[A-Z]/.test(after)) continue;
    if (m[1]) {
      codes.push(makeCode(`(${m[1]}${m[2]})`, m[1] as "M" | "A" | "R" | "N", Number(m[2]), true));
    } else if (m[3]) {
      codes.push(makeCode(`${m[3]}${m[4]}`, m[3] as "M" | "A" | "R" | "N", Number(m[4]), false));
    } else if (whole === "AG") {
      codes.push({ token: "AG", kind: "AG", value: 0, implied: false });
    } else {
      codes.push({ token: whole, kind: "FT", value: 0, implied: false });
    }
  }
  return codes;
}

function makeCode(token: string, kind: "M" | "A" | "R" | "N", digit: number, implied: boolean): MarkCode {
  return { token, kind, value: digit, implied };
}

/**
 * What one awarded markBreakdown token is worth, for the grader. A token may
 * be a single code ("A2" -> 2, "(M1)" -> 1), a combined one ("M1A1" -> 2),
 * AG or FT (0), or an N mark (its digit; the caller decides whether N marks
 * may count). Anything unrecognised keeps the grader's old rule of one
 * mark per token, so a teacher-written scheme with its own labels scores
 * exactly as it did.
 */
export function markTokenValue(token: string): number {
  const codes = parseMarkCodeGroup(token);
  if (codes.length === 0) return 1;
  return codes.reduce((sum, c) => sum + c.value, 0);
}

export interface AwardedTotal {
  /** What the awarded entries are worth under the IB rules. */
  marks: number;
  /** M, A or R marks were awarded alongside N marks, which the IB never combines. */
  mixedN: boolean;
}

/**
 * What a grader's markBreakdown is worth when its tokens are IB codes: each
 * code carries its digit (A2 is two marks), AG and FT carry none, and N
 * marks count only when no M, A or R mark is awarded, since they are the
 * no-working alternative to them. A token with no recognisable code is one
 * mark, as the grader always counted it. For a mixed award the N marks are
 * left out and mixedN says so, for the caller to flag.
 */
export function totalAwardedMarks(entries: readonly { token: string; awarded: boolean }[]): AwardedTotal {
  let scored = 0;
  let nScored = 0;
  for (const e of entries) {
    if (!e.awarded) continue;
    const codes = parseMarkCodeGroup(e.token);
    if (codes.length === 0) {
      scored += 1;
      continue;
    }
    for (const c of codes) {
      if (c.kind === "N") nScored += c.value;
      else scored += c.value;
    }
  }
  return { marks: scored > 0 ? scored : nScored, mixedN: scored > 0 && nScored > 0 };
}

/** True when every code in the token is an N mark ("N2", "(N1)"). */
export function isNMarkToken(token: string): boolean {
  const codes = parseMarkCodeGroup(token);
  return codes.length > 0 && codes.every((c) => c.kind === "N");
}

/** True when the token is AG or FT and nothing else: it carries no mark. */
export function isZeroValueToken(token: string): boolean {
  const codes = parseMarkCodeGroup(token);
  return codes.length > 0 && codes.every((c) => c.kind === "AG" || c.kind === "FT");
}

// ---- whole-scheme summary ---------------------------------------------------

export interface SchemeMarkSummary {
  /**
   * Every total the M/A/R codes can add up to, one per route through the
   * scheme's alternatives (METHOD 1 / METHOD 2, EITHER / OR branches),
   * sorted ascending. A scheme with no alternatives has exactly one.
   */
  possibleTotals: number[];
  /** Sum of the N codes: the part's no-working total. 0 when there are none. */
  nTotal: number;
  /** Every code found after \hfill, in order. */
  codes: MarkCode[];
  /**
   * Code-shaped text at the end of a line with no \hfill before it. Not
   * counted (the grader reads only what the scheme presents as awards), but
   * a sign the transcription drifted from the canonical layout.
   */
  strayCodes: string[];
  /** Every "[N marks]" the text states, in order. */
  statedMarks: number[];
  /** "Total [N marks]", when the text states one. */
  statedTotal: number | null;
  hasAlternatives: boolean;
}

const MAX_ROUTES = 64;

type Region =
  | { kind: "common"; lines: string[] }
  | { kind: "branches"; branches: string[][] };

/** A line reduced to what decides its role: formatting stripped, trimmed. */
function bareLine(line: string): string {
  return unwrapCodeText(line.replace(/\\\\\s*$/, "")).replace(/\s+/g, " ").trim();
}

const METHOD_RE = /^(?:\(?[a-z]{1,4}\)?\s*)?METHOD\s*(\d+)\b/;
const EITHER_RE = /^EITHER\b/;
const OR_RE = /^OR\b/;
const THEN_RE = /^THEN\b/;

function codesOnLine(line: string): MarkCode[] {
  const out: MarkCode[] = [];
  const pieces = line.split(/\\hfill/);
  for (let i = 1; i < pieces.length; i++) {
    // A marks statement ("[2 marks]") shares the \hfill slot with nothing.
    const piece = pieces[i].replace(/\[\s*\d+\s*marks?\s*\]/gi, " ");
    out.push(...parseMarkCodeGroup(piece));
  }
  return out;
}

const STRAY_TAIL_RE = /(?:^|\s)((?:\(?[MAR]\d\)?)+(?:\s+N\d)?)\s*$/;
const REFERENCE_WORDS_RE = /\b(?:note|award|accept|do not|allow|if|for|deduct|penali[sz]e|max|condone|withhold)\b/i;

function strayOnLine(line: string): string | null {
  if (/\\hfill/.test(line)) return null;
  const bare = bareLine(line);
  if (REFERENCE_WORDS_RE.test(bare)) return null;
  const m = bare.match(STRAY_TAIL_RE);
  return m ? m[1] : null;
}

function sumLines(lines: string[]): { mar: number; n: number } {
  let mar = 0;
  let n = 0;
  for (const line of lines) {
    for (const c of codesOnLine(line)) {
      if (c.kind === "N") n += c.value;
      else mar += c.value;
    }
  }
  return { mar, n };
}

/** Split a run of lines into common stretches and EITHER/OR/THEN branch groups. */
function regionsOf(lines: string[]): Region[] {
  const regions: Region[] = [];
  let common: string[] = [];
  let branches: string[][] | null = null;
  for (const line of lines) {
    const bare = bareLine(line);
    if (EITHER_RE.test(bare)) {
      if (branches) regions.push({ kind: "branches", branches });
      else if (common.length) regions.push({ kind: "common", lines: common });
      common = [];
      branches = [[line.replace(/EITHER/, "")]];
      continue;
    }
    if (branches && OR_RE.test(bare)) {
      branches.push([line.replace(/\bOR\b/, "")]);
      continue;
    }
    if (branches && THEN_RE.test(bare)) {
      regions.push({ kind: "branches", branches });
      branches = null;
      common = [line.replace(/\bTHEN\b/, "")];
      continue;
    }
    if (branches) branches[branches.length - 1].push(line);
    else common.push(line);
  }
  if (branches) regions.push({ kind: "branches", branches });
  else if (common.length) regions.push({ kind: "common", lines: common });
  return regions;
}

function totalsOf(lines: string[]): { totals: Set<number>; n: number; branched: boolean } {
  let totals = new Set<number>([0]);
  let n = 0;
  let branched = false;
  for (const region of regionsOf(lines)) {
    if (region.kind === "common") {
      const s = sumLines(region.lines);
      n += s.n;
      totals = new Set([...totals].map((t) => t + s.mar));
    } else {
      branched = true;
      const sums = region.branches.map((b) => sumLines(b));
      n += Math.max(...sums.map((s) => s.n));
      const next = new Set<number>();
      for (const t of totals) for (const s of sums) if (next.size < MAX_ROUTES) next.add(t + s.mar);
      totals = next;
    }
  }
  return { totals, n, branched };
}

/**
 * Total the codes of one part's scheme. The first METHOD heading splits the
 * text into a shared stretch (everything before it, usually empty) and one
 * block per method; each route through the scheme is shared + one method,
 * with EITHER/OR branches inside any stretch expanding into further routes.
 */
export function summarizeSchemeMarks(latex: string): SchemeMarkSummary {
  const lines = latex.replace(/\r\n?/g, "\n").split("\n");

  const shared: string[] = [];
  const methods: string[][] = [];
  for (const line of lines) {
    if (METHOD_RE.test(bareLine(line))) {
      methods.push([line.replace(/METHOD\s*\d+/, "")]);
      continue;
    }
    if (methods.length) methods[methods.length - 1].push(line);
    else shared.push(line);
  }

  const sharedTotals = totalsOf(shared);
  let totals: Set<number>;
  let nTotal = sharedTotals.n;
  let hasAlternatives = sharedTotals.branched;
  if (methods.length === 0) {
    totals = sharedTotals.totals;
  } else {
    hasAlternatives = true;
    totals = new Set<number>();
    let methodN = 0;
    for (const block of methods) {
      const blockTotals = totalsOf(block);
      methodN = Math.max(methodN, blockTotals.n);
      for (const s of sharedTotals.totals) {
        for (const b of blockTotals.totals) if (totals.size < MAX_ROUTES) totals.add(s + b);
      }
    }
    nTotal += methodN;
  }

  const codes = lines.flatMap(codesOnLine);
  const strayCodes = lines.map(strayOnLine).filter((s): s is string => s !== null);
  const statedMarks = [...latex.matchAll(/\[\s*(\d+)\s*marks?\s*\]/gi)]
    .filter((m) => !/total\s*$/i.test(latex.slice(Math.max(0, (m.index ?? 0) - 12), m.index)))
    .map((m) => Number(m[1]));
  const totalMatch = latex.match(/total\s*\[\s*(\d+)\s*marks?\s*\]/i);

  return {
    possibleTotals: [...totals].sort((a, b) => a - b),
    nTotal,
    codes,
    strayCodes,
    statedMarks,
    statedTotal: totalMatch ? Number(totalMatch[1]) : null,
    hasAlternatives,
  };
}
