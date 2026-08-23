import { z } from "zod";

/**
 * NA scan pipeline -- stage 5: AI assessment of cropped student responses.
 *
 * One model call per crop, deliberately. An earlier pilot validated this
 * shape against 117 real crops, and the design principle it came from is
 * worth restating because it constrains everything here: geometry is
 * deterministic, assessment is probabilistic, and the two must never mix.
 * The model never sees a whole page and never decides which region belongs
 * to whom -- stages 0-4 already established that. It sees exactly one
 * pre-cropped answer region and answers one narrow question about it.
 *
 * Why not batch several students' answers to the same question into one
 * call (which would be roughly 8x cheaper): considered and rejected for
 * now. The failure mode is qualitatively worse -- a misaligned response
 * array attaches one student's marks to a different student, which is far
 * harder to notice than a simply-wrong verdict and lands real marks on the
 * wrong child. Batching also invites implicit norm-referencing (grading an
 * answer relative to the other 19 in the request) when IB marking is
 * criterion-referenced. Cost is instead reduced two safer ways: blank
 * crops are skipped without an API call at all, and the rubric block is
 * marked for prompt caching since it repeats identically across every
 * student for a given question.
 */

/** Sonnet, not Haiku. Unlike the cover-page name read (simple extraction,
 *  see na-scanning.ts), this is genuine mathematical judgement against a
 *  rubric -- reading handwritten working, deciding whether a method is
 *  sound, and allocating partial marks. */
export const ASSESSMENT_MODEL = "claude-sonnet-4-6";

export const AssessmentSchema = z.object({
  /** What the model actually reads in the student's handwriting. Stored
   *  even when the verdict is "unclear" -- a partial or garbled
   *  transcription is exactly what a teacher needs to see to decide
   *  whether the AI misread or the student genuinely wrote that. */
  transcription: z.string(),
  verdict: z.enum(["correct", "partial", "incorrect", "unclear"]),
  /** Marks for THIS crop only, never the whole question when the crop is
   *  one sub-part. Validated against the anchor's own marks_available by
   *  validateAssessment below, not trusted from the model. */
  marksAwarded: z.number().min(0),
  /** Short tags naming the specific error, ideally matching the anchor's
   *  misconception_context when that applies. Empty array when the answer
   *  is correct or the error doesn't match a known misconception. */
  misconceptionTags: z.array(z.string()).default([]),
  /** One or two sentences written TO the student, in the margin of their
   *  own work. */
  marginComment: z.string(),
  /** One concrete thing to do next. */
  nextStep: z.string(),
  /** The model's own confidence in this assessment, 0-1. Low confidence
   *  on a legible answer is a signal the rubric may not fit what the
   *  student did -- worth teacher attention even when the verdict looks
   *  reasonable. */
  confidence: z.number().min(0).max(1),
  /** Anything the teacher should know that shouldn't go to the student --
   *  e.g. "the printed box appears to cut off mid-sentence", "this looks
   *  like a different question's work". Empty string when there's
   *  nothing. */
  teacherNote: z.string().default(""),
});

export type Assessment = z.infer<typeof AssessmentSchema>;

export interface AnchorContext {
  qid: string;
  baseQid: string;
  marksAvailable: number | null;
  commandTerm: string | null;
  answerSketch: string | null;
  openRubric: string | null;
  misconceptionContext: string | null;
}

/**
 * True when this anchor is genuinely ungraded -- no marks, no answer
 * sketch, no open rubric. In A.1 that's the Desmos "noticings from the
 * sandbox" box: a thinking space with no correct answer, which the pilot
 * found would otherwise be indistinguishable from a question whose rubric
 * failed to load. Skipping these costs nothing and avoids inventing a
 * verdict for something that was never meant to be marked.
 */
export function isUngradedAnchor(a: AnchorContext): boolean {
  return (
    a.marksAvailable == null &&
    !a.answerSketch?.trim() &&
    !a.openRubric?.trim()
  );
}

export const ASSESSMENT_SYSTEM_PROMPT = `You are marking one handwritten answer from a Grade 9 IB MYP mathematics packet, against the teacher's own answer key.

You will be shown ONE cropped image: a single answer box from a student's scanned worksheet, containing their handwriting. You will also be given the teacher's rubric for that specific question.

Mark against the teacher's rubric, not against your own sense of what a good answer looks like. If the rubric says the answer is 420 and the student wrote 420, that is correct even if their working is unconventional. If the rubric describes a required method and the student reached the right number by a method the rubric excludes, say so in the teacher note rather than silently accepting it.

Marking rules:
- Award marks for THIS crop only. If the crop is one sub-part of a larger question, the marks available given to you are already that sub-part's share -- do not award the whole question's marks.
- Partial credit is normal and expected. A student who sets up correctly but arithmetic-slips has earned most of the marks; say so.
- "unclear" is a real verdict, not a failure. If the handwriting is genuinely illegible, or the box is empty, or what's written doesn't appear to answer this question at all, return "unclear" with marksAwarded 0 and explain why in teacherNote. NEVER guess at a verdict you cannot support from what you can actually see -- a wrong confident mark on a real student's work is worse than an honest "a teacher needs to look at this".
- Mathematical correctness is judged on the mathematics, not on handwriting neatness, spelling, or whether the student showed more working than required.

If a MISCONCEPTION note is supplied, it describes a specific error this question was designed to catch. If the student's work shows that error, name it in misconceptionTags. If they avoided it, do not invent a tag.

marginComment is written TO the student, in their own margin: warm, specific, and short. Name what they did well before what went wrong. Never sarcastic, never discouraging. This is a 14-15 year old reading a comment on their own work.

nextStep is one concrete action, not a platitude. "Re-read the question and check which number comes first when it says 'fewer than'" -- not "review this topic".

teacherNote is for the teacher only and never shown to the student. Use it for anything that affects trust in this mark: a crop that looks cut off, work that seems to belong to a different question, an answer that's right by a method the rubric didn't anticipate, or your reason for an "unclear" verdict. Leave it as an empty string when there is genuinely nothing to flag.

Return ONLY a JSON object, no markdown fences, no commentary:

{
  "transcription": "what the student actually wrote, as best you can read it",
  "verdict": "correct" | "partial" | "incorrect" | "unclear",
  "marksAwarded": 0,
  "misconceptionTags": [],
  "marginComment": "...",
  "nextStep": "...",
  "confidence": 0.0,
  "teacherNote": ""
}`;

/**
 * Builds the per-question rubric block. Kept as its own function (and its
 * own content block at the call site) because it is IDENTICAL for every
 * student answering the same question -- which is exactly what makes it
 * worth marking for prompt caching.
 */
export function buildRubricBlock(a: AnchorContext): string {
  const lines: string[] = [];
  lines.push(`QUESTION: ${a.qid}`);
  if (a.qid !== a.baseQid) {
    lines.push(
      `This crop is sub-part ${a.qid} of question ${a.baseQid}. The answer key below may cover the whole of ${a.baseQid}; mark ONLY the part that belongs to ${a.qid}.`
    );
  }
  if (a.commandTerm) lines.push(`COMMAND TERM: ${a.commandTerm}`);
  lines.push(
    `MARKS AVAILABLE FOR THIS CROP: ${a.marksAvailable ?? "unspecified"}${
      a.marksAvailable != null ? " (this is already this crop's own share -- do not exceed it)" : ""
    }`
  );

  if (a.answerSketch?.trim()) {
    lines.push(`\nTEACHER'S ANSWER KEY:\n${a.answerSketch.trim()}`);
  }
  if (a.openRubric?.trim()) {
    // An open-response question with criteria instead of a fixed answer
    // (e.g. A.1's Q28 reflection table). Marking against a missing
    // "correct answer" here would be a category error, so say plainly
    // what the standard actually is.
    lines.push(
      `\nOPEN-RESPONSE RUBRIC (there is no single correct answer -- mark against these criteria):\n${a.openRubric.trim()}`
    );
  }
  if (a.misconceptionContext?.trim()) {
    lines.push(`\nMISCONCEPTION THIS QUESTION TESTS FOR:\n${a.misconceptionContext.trim()}`);
  }

  return lines.join("\n");
}

export function buildAssessmentUserPrompt(): string {
  return "Mark the handwritten answer in the image above against the rubric. Return the JSON object now.";
}

/** Extracts a JSON object from a model response that may or may not be
 *  wrapped in markdown fences or prose. */
function extractJsonBlock(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

export type AssessmentValidation =
  | { ok: true; assessment: Assessment; warnings: string[] }
  | { ok: false; error: string };

/**
 * Validates a raw assessment response. Deliberately strict: an invalid
 * response is recorded as a validation error against the crop (see
 * na_feedback.ai_validation_error) and routed to teacher review, rather
 * than being coerced into something that looks like a real mark.
 *
 * marksAwarded is clamped and checked against the anchor's own
 * marksAvailable rather than trusted -- the pilot's schema tests caught
 * out-of-range marks as a real failure mode, and a mark above the maximum
 * would silently corrupt a student's total.
 */
export function validateAssessment(
  rawText: string,
  marksAvailable: number | null
): AssessmentValidation {
  const json = extractJsonBlock(rawText);
  if (!json) return { ok: false, error: "No JSON object found in assessment response" };

  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(json);
  } catch (e) {
    return {
      ok: false,
      error: `Assessment response was not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const parsed = AssessmentSchema.safeParse(parsedUnknown);
  if (!parsed.success) {
    return { ok: false, error: `Assessment failed schema validation: ${parsed.error.message}` };
  }

  const warnings: string[] = [];
  const a = { ...parsed.data };

  if (marksAvailable != null && a.marksAwarded > marksAvailable) {
    warnings.push(
      `Model awarded ${a.marksAwarded} marks but only ${marksAvailable} are available for this crop -- clamped to ${marksAvailable}.`
    );
    a.marksAwarded = marksAvailable;
  }

  // An "unclear" verdict carrying marks is contradictory: the model is
  // saying it couldn't determine what the student did, yet crediting them
  // for it. Treat the verdict as authoritative and zero the marks, so a
  // human decides rather than an unexplained partial mark landing in a
  // student's total.
  if (a.verdict === "unclear" && a.marksAwarded > 0) {
    warnings.push(
      `Verdict was "unclear" but ${a.marksAwarded} marks were awarded -- marks zeroed pending teacher review.`
    );
    a.marksAwarded = 0;
  }

  return { ok: true, assessment: a, warnings };
}
