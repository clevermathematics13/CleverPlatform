/**
 * numbering-validator.ts
 * -------------------------------------------------------------------------
 * Numbering-integrity check for generated Nuanced Analysis drafts.
 *
 * WHY THIS EXISTS: a generated packet ("The Anatomy of a Dataset") printed
 * question numbers with large silent gaps — 1, [skip 2–4], 5, 6,
 * [skip 7–9], 10, 11, ... — consistent with whole question objects being
 * dropped between the two generation passes. The layer that assigns
 * numbers structurally (document-orchestrator-nuanced.ts's globalCounter,
 * and formatQuestionLabel's index-derived labels) is gap-free by
 * construction, so visible gaps can only come from numbers the MODEL
 * embedded inside its own prompt text or section headings. This validator
 * inspects exactly those embedded numbers on the sanitized draft and
 * fails loud — a flagged draft still renders, but the teacher sees the
 * warning before downloading a packet that silently skips from 6 to 10.
 *
 * IMPLEMENTATION NOTE — deliberately written with ZERO backslash escape
 * sequences (no "backslash-d", no "backslash-s", no escaped quotes), the
 * same defensive style as command-term-validator.ts. Character classes are
 * spelled out ([0-9], [ ] etc.) so this file cannot be corrupted by the
 * known double-backslash collapse when pushed through the GitHub tools.
 */

// The AssignmentDraft shape (structurally typed here, same approach as
// command-term-validator.ts, to avoid a hard import cycle with
// lib/assignments.ts).
type DraftQuestion = {
  prompt: string;
  subparts?: DraftQuestion[];
};

type DraftSection = {
  heading: string;
  questions: DraftQuestion[];
};

type DraftLike = {
  sections: DraftSection[];
  // Prose the model writes ABOUT the questions, which is where it cites them
  // by number. Optional because not every draft carries them.
  compulsoryCore?: string;
  plantedErrorIntro?: string;
  reflectionQuestions?: string[];
};

export type NumberingIssueKind =
  | "question-gap"
  | "question-duplicate"
  | "question-out-of-order"
  | "part-gap"
  | "part-duplicate"
  | "cross-reference-out-of-range";

export type NumberingIssue = {
  kind: NumberingIssueKind;
  /** Human-readable location, e.g. "Part 2, question 3" or "Section headings". */
  location: string;
  /** Human-readable description of the problem, ready for direct UI display. */
  detail: string;
};

/**
 * Extracts a question number the model embedded at the START of a prompt,
 * or null if the prompt doesn't begin with one. Recognized shapes (with
 * optional leading whitespace and optional markdown bold markers):
 *
 *   "12. Find ..."      "12) Find ..."      "12: Find ..."
 *   "Q12. Find ..."     "Q 12) Find ..."
 *   "Question 12. ..."  "**12.** Find ..."
 *
 * A number followed directly by more digits-and-dot (e.g. "3.2 Find...")
 * is treated as a dotted label and its FIRST component is ignored — dotted
 * labels are section-relative, not the global sequence this check targets,
 * so prompts like "1.4 State..." simply don't participate.
 */
export function extractLeadingQuestionNumber(prompt: string): number | null {
  if (typeof prompt !== "string") return null;
  // Strip leading whitespace and markdown bold/italic markers.
  const trimmed = prompt.replace(/^[ 	*_#]+/, "");
  const m = trimmed.match(/^(?:Question[ ]+|Q[ ]?)?([0-9]{1,3})([.):])/i);
  if (!m) return null;
  // Reject dotted labels like "3.2 ..." — a "." separator followed
  // immediately by another digit means section-relative numbering.
  const afterSep = trimmed.slice(m[0].length);
  if (m[2] === "." && /^[0-9]/.test(afterSep)) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Extracts the number from a "Part N" style section heading, or null. */
export function extractPartNumber(heading: string): number | null {
  if (typeof heading !== "string") return null;
  const m = heading.match(/(?:^|[^A-Za-z])Part[ ]+([0-9]{1,2})(?![0-9])/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Extracts every question number the prose CITES, e.g. the "Q1, Q9, Q17"
 * in a compulsory-core list. Understands single citations ("Q12", "Q 12")
 * and ranges ("Q1-Q7", "Q1–7"), returning both endpoints of a range: the
 * interior of an ascending range cannot be out of bounds when its top is
 * in bounds, so the endpoints are all this check needs.
 *
 * A leading "Q" is REQUIRED, and that is the point rather than an
 * oversight. This prose is full of ordinary numbers -- "8 minutes with a
 * slider", "5 fewer than p", "$1,200 before tax" -- and a check that read
 * those as question references would cry wolf on every packet. Only an
 * explicit Q-citation is unambiguous enough to act on.
 */
export function extractQuestionCitations(prose: string): number[] {
  if (typeof prose !== "string") return [];
  const found = new Set<number>();
  const re = /(?<![A-Za-z0-9])Q[ ]?([0-9]{1,3})(?:[ ]*[-–—][ ]*(?:Q[ ]?)?([0-9]{1,3}))?/gi;
  let m = re.exec(prose);
  while (m !== null) {
    for (const raw of [m[1], m[2]]) {
      if (raw === undefined) continue;
      const n = Number(raw);
      if (Number.isFinite(n)) found.add(n);
    }
    m = re.exec(prose);
  }
  return Array.from(found).sort((a, b) => a - b);
}

/**
 * Reports any question number the prose cites that the packet cannot have.
 *
 * WHY ONLY THE UPPER BOUND: the check is deliberately one-sided. A citation
 * above the question count is provably wrong -- there is no such question --
 * so it never produces a false positive. A citation INSIDE the range may
 * still be off by one (A.2's list was), but proving that would mean
 * reproducing every decision the renderer makes about which questions get a
 * printed number, and a validator that guesses wrong is worse than no
 * validator. One out-of-range citation is enough to tell a teacher the whole
 * list needs re-reading, which is what this is for.
 *
 * REAL CASE: A.2 ("What Undoing Really Means") shipped with a compulsory
 * core reading "Q1-Q7, Q9-Q15, Q17-Q20, Q22, Q23, Q25, Q26" on a packet
 * whose printed questions stop at Q21. Students were handed a list telling
 * them to complete questions that do not exist. Nothing caught it, because
 * this validator only ever inspected question prompts and section headings
 * -- the numbers the model wrote ABOUT the questions went unchecked.
 */
function validateCitations(
  prose: string | undefined,
  questionCount: number,
  location: string
): NumberingIssue[] {
  if (!prose || questionCount < 1) return [];
  return extractQuestionCitations(prose)
    .filter((n) => n < 1 || n > questionCount)
    .map((n) => ({
      kind: "cross-reference-out-of-range" as const,
      location,
      detail: `Cites Q${n}, but this packet numbers only ${questionCount} question${questionCount === 1 ? "" : "s"} — check every number in this list against the questions actually in the packet.`,
    }));
}

/**
 * Validates the numbering integrity of a sanitized draft. Returns [] when
 * everything is consistent (including when the model embedded no numbers
 * at all — index-derived labels can't have gaps, so nothing to check).
 *
 * Question check: collects every embedded leading number across all
 * sections' top-level questions and subparts, in visible order. If fewer
 * than two questions carry embedded numbers, the check is skipped (one
 * stray "1." tells us nothing about sequence integrity). Otherwise the
 * embedded sequence must be strictly increasing by exactly 1 from its
 * starting value — every gap, duplicate, and backwards jump is reported.
 *
 * Part check: same idea for "Part N" section headings, except a Part 0
 * start is allowed (the Nuanced Analysis arc opens with Part 0).
 */
export function validateDraftNumbering(draft: DraftLike): NumberingIssue[] {
  const issues: NumberingIssue[] = [];
  if (!draft || !Array.isArray(draft.sections)) return issues;

  // -- Embedded question-number sequence --------------------------------
  const numbered: { n: number; location: string }[] = [];

  draft.sections.forEach((section, sIdx) => {
    if (!section || !Array.isArray(section.questions)) return;
    const sectionName =
      typeof section.heading === "string" && section.heading.trim()
        ? section.heading.trim().slice(0, 60)
        : `Section ${sIdx + 1}`;

    section.questions.forEach((q, qIdx) => {
      if (!q) return;
      const qLoc = `${sectionName}, question ${qIdx + 1}`;
      const n = extractLeadingQuestionNumber(q.prompt);
      if (n !== null) numbered.push({ n, location: qLoc });

      if (Array.isArray(q.subparts)) {
        q.subparts.forEach((sp, spIdx) => {
          if (!sp) return;
          const spN = extractLeadingQuestionNumber(sp.prompt);
          if (spN !== null) {
            numbered.push({ n: spN, location: `${qLoc}, subpart ${spIdx + 1}` });
          }
        });
      }
    });
  });

  if (numbered.length >= 2) {
    for (let i = 1; i < numbered.length; i++) {
      const prev = numbered[i - 1];
      const cur = numbered[i];
      const step = cur.n - prev.n;
      if (step === 1) continue;
      if (step === 0) {
        issues.push({
          kind: "question-duplicate",
          location: cur.location,
          detail: `Question number ${cur.n} appears twice in a row (also at ${prev.location}).`,
        });
      } else if (step > 1) {
        const missing = step - 1;
        issues.push({
          kind: "question-gap",
          location: cur.location,
          detail: `Numbering jumps from ${prev.n} to ${cur.n} — ${missing} question${missing === 1 ? "" : "s"} appear${missing === 1 ? "s" : ""} to be missing between ${prev.location} and here.`,
        });
      } else {
        issues.push({
          kind: "question-out-of-order",
          location: cur.location,
          detail: `Question number ${cur.n} appears after ${prev.n} (${prev.location}) — the sequence goes backwards.`,
        });
      }
    }
  }

  // -- "Part N" heading sequence ----------------------------------------
  const parts: { n: number; heading: string }[] = [];
  draft.sections.forEach((section) => {
    if (!section) return;
    const n = extractPartNumber(section.heading);
    if (n !== null) parts.push({ n, heading: section.heading.trim().slice(0, 60) });
  });

  if (parts.length >= 2) {
    for (let i = 1; i < parts.length; i++) {
      const prev = parts[i - 1];
      const cur = parts[i];
      const step = cur.n - prev.n;
      if (step === 1) continue;
      if (step === 0) {
        issues.push({
          kind: "part-duplicate",
          location: `"${cur.heading}"`,
          detail: `Part ${cur.n} appears twice ("${prev.heading}" and "${cur.heading}").`,
        });
      } else {
        issues.push({
          kind: "part-gap",
          location: `"${cur.heading}"`,
          detail: `Part headings jump from ${prev.n} ("${prev.heading}") to ${cur.n} — the sequence should advance by exactly 1.`,
        });
      }
    }
  }

  // -- Question numbers cited in the surrounding prose -------------------
  // The bound is every question the draft contains, top-level and subparts,
  // which is exactly what document-orchestrator-nuanced.ts's globalCounter
  // walks when it assigns numbers. Counting it here rather than trusting the
  // model's own arithmetic is the whole point: the two disagreeing is the
  // bug being caught.
  let questionCount = 0;
  draft.sections.forEach((section) => {
    if (!section || !Array.isArray(section.questions)) return;
    section.questions.forEach((q) => {
      if (!q) return;
      questionCount += 1;
      if (Array.isArray(q.subparts)) questionCount += q.subparts.length;
    });
  });

  issues.push(...validateCitations(draft.compulsoryCore, questionCount, "Compulsory core"));
  issues.push(...validateCitations(draft.plantedErrorIntro, questionCount, "Planted error intro"));
  if (Array.isArray(draft.reflectionQuestions)) {
    draft.reflectionQuestions.forEach((rq, i) => {
      issues.push(...validateCitations(rq, questionCount, `Reflection question ${i + 1}`));
    });
  }

  return issues;
}
