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
  /** True when the work actually inside this crop is crossed out AND an
   *  arrow leaves the crop toward a replacement answer written elsewhere
   *  on the page (a margin, blank space, even a different box) -- a real
   *  case found on Giulia Bernal's Q3: the crop alone showed only the
   *  crossed-out original, with an arrow entering from outside the crop
   *  boundary, so the model had no way to see what it pointed to. When
   *  true, the caller re-assesses this crop with the full page in view
   *  (see the assess route's second pass) and that result supersedes this
   *  one -- so it's fine to answer this call's verdict/marksAwarded from
   *  only the crossed-out content, as a fallback in case the second pass
   *  can't resolve it either. */
  redirectedElsewhere: z.boolean().default(false),
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
  /** The actual question prompt as authored. Until this was added, the
   *  model was shown an answer key with NO idea what had been asked --
   *  a real handicap on any question where appropriateness of the
   *  response matters as much as its content. The clearest case found:
   *  A.1's Q1(e) asks "Write down one thing you notice about your
   *  answers to (c) and (d)", and a student's observation could not be
   *  properly judged without knowing that was the task. */
  questionText?: string | null;
  /** The richer authored answer key (nuanced_analyses.parts[].answer,
   *  stored on na_anchors.question_answer). PREFERRED over answerSketch,
   *  which comes from the terser teacher_companion.answerSketches and was
   *  written as a teacher's quick-reference sheet rather than a marking
   *  key. The difference is material: for A.1 Q1(e) the sketch says
   *  "they agree" (reads as a required phrase) while this says "Accept
   *  any observation that (c) and (d) agree" (explicitly permissive) --
   *  a real student was marked down against the former who should have
   *  passed against the latter. */
  questionAnswer?: string | null;
  /** Mark total for the WHOLE base question, as distinct from
   *  marksAvailable (this one anchor's share). Used only to tell the
   *  model how its slice relates to the whole, never to award marks. */
  questionMarks?: number | null;
  /** Whether stage 4's adaptive boundary expansion grew this crop beyond
   *  its base bleed -- i.e. whether the automated ink-density check found
   *  evidence of writing actually touching the crop's edge. Passed
   *  through so the model has a real signal to weigh a "this looks cut
   *  off" impression against, rather than reasoning about truncation
   *  from the image alone. See buildRubricBlock for how this is framed.
   *  Optional/undefined when the caller doesn't have this information
   *  (e.g. older crops from before na_response_crops.boundary_expanded
   *  was queried here). */
  boundaryExpanded?: boolean;
  /** True when stage 4's adaptive expansion stopped only because it hit
   *  the anchor's expand_max_x1_pt/expand_max_y1_pt cap while ink was
   *  still touching that edge -- i.e. boundaryExpanded=true does NOT mean
   *  the whole answer was captured. Real case: A.1 Q1(d)/Q1(e), where a
   *  student's boxed final answer ran into the printed boundary of the
   *  next question, so even full expansion couldn't reach the rest of it.
   *  Distinct from boundaryExpanded because "expanded, but still cut off
   *  at the new edge" is a materially different situation from "expanded,
   *  and now contains everything" -- the model (and the teacher review
   *  UI) needs to tell them apart rather than treating any expansion as
   *  proof of completeness. */
  possiblyTruncated?: boolean;
}

/**
 * True when this anchor is genuinely ungraded -- no marks, and no key of
 * any kind (neither authored answer, nor companion sketch, nor open
 * rubric). In A.1 that's the Desmos "noticings from the sandbox" box: a
 * thinking space with no correct answer, which the pilot found would
 * otherwise be indistinguishable from a question whose rubric failed to
 * load. Skipping these costs nothing and avoids inventing a verdict for
 * something that was never meant to be marked.
 */
export function isUngradedAnchor(a: AnchorContext): boolean {
  return (
    a.marksAvailable == null &&
    !a.questionAnswer?.trim() &&
    !a.answerSketch?.trim() &&
    !a.openRubric?.trim()
  );
}

export const ASSESSMENT_SYSTEM_PROMPT = `You are marking one handwritten answer from a Grade 9 IB MYP mathematics packet, against the teacher's own answer key.

You will be shown ONE cropped image: a single answer box from a student's scanned worksheet, containing their handwriting. You will also be given the question that was asked and the teacher's answer key for it.

Judge the student's work against BOTH: does it actually respond to what the question asked, and is it mathematically right? A response can be true but off-task (answering a different question than the one posed), or on-task but wrong. Say which in the teacher note.

Mark against the teacher's key, not against your own sense of what a good answer looks like. If the key says the answer is 420 and the student wrote 420, that is correct even if their working is unconventional. If the key describes a required method and the student reached the right number by a method the key excludes, say so in the teacher note rather than silently accepting it.

Read the key's wording carefully and honour how permissive it is. A key that says "accept any observation that X" means exactly that -- any answer conveying X earns the mark, however the student phrased it. Do NOT require a student to use the key's own words when the key does not demand them. Marking a correct idea wrong because it was worded differently is a real error.

Marking rules:
- Award marks for THIS crop only. If the crop is one sub-part of a larger question, the marks available given to you are already that sub-part's share -- do not award the whole question's marks.
- You can only see ONE part of this question. Other parts have their OWN separate crops and their OWN separate marks, assessed independently. NEVER withhold or reduce marks because a part you cannot see appears missing or unanswered -- that part is not yours to judge, and penalising it here would double-penalise the student. If the answer key mentions parts that aren't visible in your crop, ignore those parts entirely.
- Partial credit is normal and expected. A student who sets up correctly but arithmetic-slips has earned most of the marks; say so.
- "unclear" is a real verdict, not a failure. If the handwriting is genuinely illegible, or the box is empty, or what's written doesn't appear to answer this question at all, return "unclear" with marksAwarded 0 and explain why in teacherNote. NEVER guess at a verdict you cannot support from what you can actually see -- a wrong confident mark on a real student's work is worse than an honest "a teacher needs to look at this".
- Mathematical correctness is judged on the mathematics, not on handwriting neatness, spelling, or whether the student showed more working than required.
- Before concluding that content is cut off or missing at a crop's edge, look carefully: small, faint, or compressed handwriting near an edge is NOT the same as content that was actually truncated. Only report something as "cut off" if you can see the crop boundary genuinely intersecting a character mid-stroke, or a printed box/line that is visibly incomplete. If the crop notes say the boundary was NOT automatically expanded, that means an automated check already looked for ink touching the edge and found none -- treat that as evidence AGAINST truncation, and look again at what's actually there before assuming something is missing. A confident "cut off, marks withheld" on content that is actually fully present and legible is a real error, not a safe default.
- Treat a constant term as separate from the coefficients of variable terms. In 3x^2 - 5x + 7, the coefficients are 3 and -5; the constant term is 7. A constant can technically be described as "the coefficient of x^0", but do NOT mark a student wrong for keeping it separate unless the question itself explicitly defines coefficients that way. When a question asks for "the coefficients and the constant term", expect the constant listed on its own, not folded into the coefficient list.

If a MISCONCEPTION note is supplied, it describes a specific error this question was designed to catch. If the student's work shows that error, name it in misconceptionTags. If they avoided it, do not invent a tag.

marginComment is written TO the student, in their own margin: warm, specific, and SHORT -- one sentence, rarely two. Say what they did well and what to fix in as few words as that takes, not a full explanation of the concept. Never sarcastic, never discouraging. This is a margin note a 14-15 year old glances at, not a paragraph to read.

nextStep is one concrete action in one short sentence, not a platitude. "Re-read the question and check which number comes first when it says 'fewer than'" -- not "review this topic".

teacherNote is for the teacher only and never shown to the student. Use it for anything that affects trust in this mark: a crop that looks cut off, work that seems to belong to a different question, an answer that's right by a method the key didn't anticipate, or your reason for an "unclear" verdict. Leave it as an empty string when there is genuinely nothing to flag. Keep it as brief as the reasoning allows -- one or two short sentences, not a paragraph.

redirectedElsewhere: set this true whenever an arrow crosses this crop's boundary -- in EITHER direction -- and the answer visible inside the box is not itself a complete answer to the question. The arrow means the student's real work for this question lives somewhere else on the page, outside what you can see. Two patterns both count:
- An arrow LEAVING the box, next to work that is crossed out (an X, a scribble-out, a strike-through): the student rejected what's in the box and pointed to a replacement written elsewhere.
- An arrow ENTERING the box, pointing in from outside: the student ran out of room, or answered in the margin, and drew the arrow to connect that work back to this box. Nothing here needs to be crossed out for this to apply. In this case what's inside the box is often not an answer at all -- an apology ("Sorry"), a note ("see below", "over"), a doodle, a placeholder, or almost nothing. Content like that, sitting next to an arrow pointing in, is exactly the signal to set this true: the real answer is at the other end of that arrow.
This crop alone cannot show you the work at the other end; you're only being asked to notice the pattern, not find the answer. Do NOT set this for a crossed-out answer with no arrow (that's just an abandoned attempt -- mark whatever legible content remains, or award 0 if none does), for ordinary crossed-out scratch work alongside a clean final answer still visible in the same crop (mark the clean answer normally), or for a complete answer that happens to have an arrow used INSIDE it as ordinary mathematical notation (a mapping, a "therefore", a labelled diagram). When you do set this true, still fill in your best-effort verdict/marksAwarded/transcription from whatever IS visible in the box as a fallback, exactly as you would for any other crop.

teacherNote must state your reasoning ONCE, not narrate you changing your mind. Never write "wait", "actually, reconsidering", "on second thought", or any similar mid-explanation reversal -- if you catch yourself about to write one, that means you have not actually finished reasoning yet. Resolve the uncertainty first, THEN write teacherNote as a single, final account of why you landed on the verdict and marksAwarded you are about to submit. A teacherNote whose own stated conclusion doesn't match marksAwarded is a real error -- worse than an honest "unclear" -- because it looks confident while being wrong, and a teacher skimming past the number would never catch it. If you genuinely remain torn between two readings after reasoning it through, that is what "unclear" is for, not a hedged teacherNote paired with a picked-at-random number.

Do your reasoning silently. Do NOT write out your analysis, working, or reasoning as prose before the JSON -- go straight to the JSON object with no preamble. Every part of your reasoning that matters belongs INSIDE the JSON fields themselves (transcription, teacherNote, marginComment, nextStep), not before them. A response that reasons in prose first risks being cut off before the JSON ever appears, which throws away the entire assessment -- so the JSON object must always come first and immediately, not last.

Return ONLY the JSON object below. No markdown fences, no commentary, no analysis before or after it -- your entire response must be this JSON object and nothing else:

{
  "transcription": "what the student actually wrote, as best you can read it",
  "verdict": "correct" | "partial" | "incorrect" | "unclear",
  "marksAwarded": 0,
  "misconceptionTags": [],
  "marginComment": "...",
  "nextStep": "...",
  "confidence": 0.0,
  "teacherNote": "",
  "redirectedElsewhere": false
}`;

/**
 * Second-pass system prompt, used only when a first pass (against the
 * tight crop, ASSESSMENT_SYSTEM_PROMPT above) set redirectedElsewhere --
 * an arrow crossed the crop boundary in either direction: leaving the box
 * beside crossed-out work, or pointing INTO the box from work the student
 * wrote outside it (found on Giulia Bernal's Q6(f), where the box held
 * only "Sorry" and a crying face while an arrow pointed in from the real
 * answer written elsewhere). This pass is shown the FULL page instead,
 * with that question's own box highlighted in red (drawn by the CV
 * service's /page-image endpoint from the anchor's own authored
 * coordinates, not the expanded crop bounds), so the model can actually
 * follow the arrow to whichever end holds the student's real work and
 * grade that instead.
 *
 * Reuses AssessmentSchema/buildRubricBlock/validateAssessment unchanged --
 * same output contract as the first pass, just a different image and a
 * narrower job (this call already knows there's a redirect; it isn't
 * re-deciding whether one exists).
 */
export const WIDE_CONTEXT_SYSTEM_PROMPT = `You are marking one handwritten answer from a Grade 9 IB MYP mathematics packet, against the teacher's own answer key -- the same task as always, but this time you're shown the FULL scanned page instead of a single cropped box, because a first pass already found an arrow crossing this question's answer box, meaning the student's real work for it is written somewhere else on the page.

The question's own answer box is outlined in RED on the page image. That red outline is the ORIGINAL box location -- whatever is inside it is not the answer you are marking (it is crossed out, or it is only a note, apology or doodle standing in for work written elsewhere). Your job is to follow the arrow to the student's actual work. Find where a line meets the red box's edge, then trace that line to its OTHER end, in whichever direction it runs:
- If the arrow LEAVES the box (its tail is at the box, its head points away), follow it forwards to where it points.
- If the arrow ENTERS the box (its head is at the box, pointing in), follow it BACKWARDS along its tail, away from the box, to where the line starts. The student wrote their answer at that starting end and drew the arrow to connect it back to this question.
The work may be in a margin, in blank space anywhere on the page, above or below the box, or even inside a different printed box. Read whatever is written at the far end of the arrow -- that is the student's real answer to THIS question, and it is what you mark.

If you genuinely cannot find any arrow or any work at either end of one after looking carefully at the whole page, fall back to marking the content inside the red box as it stands (partial credit if it's legible and gets partway there, 0 if there's truly nothing gradable), and say plainly in teacherNote that no redirect could be located so a teacher should check the original page.

Every other marking rule is unchanged from a normal crop: mark against the teacher's key and this specific question's own marks share, partial credit is normal, "unclear" is a real verdict, and every text field (marginComment especially) stays exactly as short as it would for a single-crop assessment. redirectedElsewhere in your response should be false here regardless of what you find -- this pass IS the resolution, not another signal to chase further.

Do your reasoning silently and return ONLY the same JSON object shape as a normal assessment, immediately, with no preamble:

{
  "transcription": "what the student actually wrote in the replacement location, as best you can read it",
  "verdict": "correct" | "partial" | "incorrect" | "unclear",
  "marksAwarded": 0,
  "misconceptionTags": [],
  "marginComment": "...",
  "nextStep": "...",
  "confidence": 0.0,
  "teacherNote": "",
  "redirectedElsewhere": false
}`;

export function buildWideContextUserPrompt(): string {
  return "The red-outlined box's own answer was crossed out with an arrow leaving it. Find the replacement work elsewhere on this page by following the arrow, and mark that. Return the JSON object now -- go straight to the JSON, no reasoning or analysis beforehand.";
}

/**
 * Builds the per-question rubric block: the question that was asked, the
 * answer key, and the scoping/marks context for this specific crop.
 *
 * NOTE: boundaryExpanded is deliberately per-student, not per-question,
 * so including it here means this block is no longer byte-identical
 * across every student answering a given question -- it varies with
 * whether THIS student's crop got expanded. That's an intentional
 * tradeoff: prompt caching benefit is reduced slightly, but the model
 * gets a real per-crop signal directly alongside the rubric it's already
 * reading, rather than needing a second content block that would fragment
 * the cache boundary anyway.
 */
export function buildRubricBlock(a: AnchorContext): string {
  const lines: string[] = [];
  lines.push(`QUESTION: ${a.qid}`);

  // The question itself, first -- the model needs to know the task before
  // the answer key means anything.
  if (a.questionText?.trim()) {
    lines.push(`\nTHE QUESTION THE STUDENT WAS ASKED:\n${a.questionText.trim()}`);
  }

  if (a.qid !== a.baseQid) {
    lines.push(
      `\nSCOPE: this crop is sub-part ${a.qid} of question ${a.baseQid}. The question text and answer key above/below cover ALL of ${a.baseQid}. Mark ONLY the part belonging to ${a.qid}. Every other part has its own crop and its own marks and is being assessed separately -- do not withhold marks here for anything outside ${a.qid}.`
    );
  } else if (a.questionMarks != null && a.marksAvailable != null && a.questionMarks !== a.marksAvailable) {
    // The base anchor doesn't cover the whole question: some sub-part(s)
    // have their own separate crops. Without saying so, the model sees a
    // key describing parts its crop doesn't contain and penalises for
    // them -- exactly what happened on A.1 Q1, where the key mentions (e)
    // but (e) lives in a different crop entirely.
    lines.push(
      `\nSCOPE: question ${a.baseQid} is worth ${a.questionMarks} marks in total, but only ${a.marksAvailable} of them belong to THIS crop. One or more later parts of this question have their own separate crops and are assessed separately. If the answer key below mentions parts that are not visible in your image, those belong to another crop -- ignore them completely and do not withhold marks for them.`
    );
  }

  if (a.commandTerm) lines.push(`\nCOMMAND TERM: ${a.commandTerm}`);
  lines.push(
    `MARKS AVAILABLE FOR THIS CROP: ${a.marksAvailable ?? "unspecified"}${
      a.marksAvailable != null ? " (this is already this crop's own share -- do not exceed it)" : ""
    }`
  );

  if (a.possiblyTruncated) {
    // Checked first and stated unconditionally when true: this is a
    // stronger, opposite-direction signal from boundaryExpanded below, so
    // it must not be shadowed by that more common (and usually reassuring)
    // message.
    lines.push(
      "CROP BOUNDARY: this crop's image may be INCOMPLETE. An automated check found ink still touching the crop's edge even after growing it as far as this question's layout allows -- the student's answer may continue beyond what you can see. Do not penalise the student for content that may simply be missing from this image. If what you can see is already unambiguous, mark it normally; otherwise say so plainly in teacherNote so a teacher checks the original page."
    );
  } else if (a.boundaryExpanded !== undefined) {
    lines.push(
      a.boundaryExpanded
        ? "CROP BOUNDARY: automatically expanded -- ink was detected touching the original edge, so this crop was grown to include more content. Some content near the new edge may still be tight; use judgement."
        : "CROP BOUNDARY: NOT expanded -- no ink was detected touching the edge, meaning genuine truncation of this student's answer is unlikely. Treat an apparent 'cut off' impression with real skepticism."
    );
  }

  // Prefer the richer authored key over the terse companion sketch. Both
  // are the teacher's own writing, but the sketch was written as a quick
  // reference and reads as prescriptive where the authored key is often
  // explicitly permissive -- see AnchorContext.questionAnswer for the
  // real case where that difference decided a student's mark.
  const key = a.questionAnswer?.trim() || a.answerSketch?.trim();
  if (key) {
    lines.push(`\nTEACHER'S ANSWER KEY:\n${key}`);
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
  return "Mark the handwritten answer in the image above against the question and answer key. Return the JSON object now -- go straight to the JSON, no reasoning or analysis beforehand.";
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

  // Real failure mode found in production: on A.1 Q1 for Kaito Fujii, the
  // model's own teacherNote reasoned through to "I should award 3/3" --
  // twice -- while the marksAwarded field it submitted in that same
  // response was 2. The schema has no way to catch this because both
  // fields individually validate fine; only the prose and the number
  // disagree with each other. Can't reliably parse "the number the note
  // concluded with" out of free text, so instead of trying to auto-correct
  // it, detect the tell-tale sign that the model backtracked mid-note
  // (which is when this mismatch happens) and surface it loudly rather
  // than silently trusting a number the model's own reasoning may have
  // already abandoned. The system prompt now also tells the model not to
  // do this at all -- this is the safety net for when it does anyway.
  const BACKTRACK_PATTERN =
    /\bwait[\s,.—-]|\bactually,?\s+(re-?examining|reconsidering|wait)\b|\bon second thought\b|\blet me\s+re-?(examine|consider)\b|\bre-?examining\b|\breconsidering\b/i;
  if (BACKTRACK_PATTERN.test(a.teacherNote)) {
    warnings.push(
      `teacherNote shows the model changing its mind mid-explanation -- verify marksAwarded (${a.marksAwarded}) actually matches what the note concludes before trusting this mark.`
    );
  }

  return { ok: true, assessment: a, warnings };
}
