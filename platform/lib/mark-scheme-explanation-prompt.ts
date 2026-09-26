import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  MarkSchemeExplanationSchema,
  checkExplanation,
  type ExplanationPartSource,
  type MarkSchemeExplanation,
} from "./mark-scheme-explanation";

/**
 * Writing the student version of one part of a mark scheme
 * (lib/mark-scheme-explanation.ts): the answer first, how the marks work, and
 * the "Explain more" slides.
 *
 * Opus 5 at high effort, one call per part, at the teacher's desk -- like the
 * grader feedback and boundary suggestions. A part costs a few cents, and a
 * wrong line of working in front of a student costs far more. Every draft is
 * checked before it is kept (checkExplanation: the marks add up to the part,
 * every formula typesets, no marking codes, nothing about how it was
 * written); a draft that fails is sent back once or twice with the problems
 * named, and a part that still fails is reported rather than stored.
 *
 * What the model is given is the teacher's own answer and mark scheme and
 * the question as printed -- never the marking notes, which are rulings for
 * the marker and never shown to a student.
 */
export const EXPLANATION_MODEL = "claude-opus-5";

/** Bumped when the prompt changes in a way worth knowing which rows predate. */
export const EXPLANATION_PROMPT_VERSION = 1;

const MAX_ATTEMPTS = 3;

const EXAMPLE_INPUT = `Part 2.3 -- worth 3 marks.

This part:
<part>
Solve $\\frac{x + 4}{3} = 2x - 7$. Show every step.
</part>

The teacher's answer:
<answer>
$x = 5$
</answer>

The teacher's mark scheme for this part:
<mark_scheme>
M1 for multiplying both sides by 3: x + 4 = 6x - 21. M1 for collecting terms: 25 = 5x (or -5x = -25). A1 for x = 5. A bare answer with no working earns A1 only.
</mark_scheme>`;

/** The worked example in the system prompt. Exported so a test holds it to
 *  the same checks as a real draft: an example that fails them would teach
 *  the model to fail them too. */
export const EXPLANATION_EXAMPLE: MarkSchemeExplanation = {
  answer: "$x = 5$",
  marks: [
    { marks: 1, text: "Multiply both sides by $3$: $x + 4 = 6x - 21$" },
    { marks: 1, text: "Collect the $x$ terms on one side: $25 = 5x$" },
    { marks: 1, text: "Correct answer: $x = 5$" },
  ],
  watch: [
    "An answer with no working earns only 1 of the 3 marks.",
    "Multiply the **whole** right side by $3$, including the $-7$.",
  ],
  steps: [
    {
      title: "Get rid of the fraction",
      body: "The left side is divided by $3$. Multiply **both** sides by $3$ to undo it. $$x + 4 = 3(2x - 7)$$",
      diagram: null,
      more: "Dividing by $3$ and multiplying by $3$ undo each other, so the fraction disappears. Whatever you do to one side, you do to the other side. That keeps the two sides equal. For example, $\\frac{6}{3} = 2$ is true, and multiplying both sides by $3$ gives $6 = 6$, which is still true.",
    },
    {
      title: "Expand the bracket",
      body: "Multiply **each** term inside the bracket by $3$. $$x + 4 = 6x - 21$$",
      diagram: null,
      more: "There are two terms inside the bracket: $2x$ and $-7$. Multiply each one by $3$. $3 \\times 2x = 6x$ and $3 \\times (-7) = -21$. A common slip is to multiply only the first term and write $6x - 7$.",
    },
    {
      title: "Collect the $x$ terms",
      body: "Get all the $x$ terms on one side and the numbers on the other. Then divide.",
      diagram: {
        kind: "working",
        lines: [
          { math: "x + 4 = 6x - 21", note: "" },
          { math: "4 = \\blue{5x} - 21", note: "subtract $x$ from both sides" },
          { math: "25 = 5x", note: "add $21$ to both sides" },
          { math: "5 = x", note: "divide both sides by $5$" },
        ],
        caption: "Four lines of working that go from x + 4 = 6x - 21 to x = 5, with the move made at each line.",
      },
      more: "Move the $x$ terms to the side that has more $x$. Here that is the right side, with $6x$, so the $x$ term stays positive. Subtracting $x$ from $6x$ leaves $5x$, shown in blue. Then add $21$ to both sides to leave $5x$ on its own. Last, $5x$ means $5 \\times x$, so divide by $5$.",
    },
    {
      title: "Check your answer",
      body: "Put $x = 5$ into both sides of the question. $$\\frac{5 + 4}{3} = 3 \\qquad 2(5) - 7 = 3$$ Both sides equal $3$, so $x = 5$ is right.",
      diagram: null,
      more: "Checking does not earn a mark, but it catches slips. If the two sides do not match, look back for a sign error. The most common place is when a negative number is multiplied or moved across the equals sign.",
    },
  ],
};

const SYSTEM_PROMPT = `You write the student version of one part of a mathematics mark scheme.

WHO READS IT
Secondary-school students, from Grade 9 up to the IB Diploma, read it straight after a test while they give themselves marks for their own answers. Many are neurodivergent: ADHD, dyslexia, autism, dyscalculia, anxiety. Write so that every one of them can find the answer in two seconds, count their marks without guessing, and -- only if they choose to -- open a short, calm explanation.

WHAT YOU ARE GIVEN
The question as printed, the part's marks, and the teacher's answer and mark scheme. The mark scheme is written for the marker and may use marking codes: M1 is a method mark, A1 an answer mark (usually it depends on the method mark before it), R1 a reasoning mark, FT follow-through (a later mark can still be earned from an earlier wrong answer, used correctly), AG answer given.
The teacher's answer and mark scheme are the truth. Never change the answer. Never add, drop, loosen or tighten a marking rule.
Text in square brackets addressed to the marker (for example a note describing a figure printed on the paper) is background for you. Use it to understand the question; never quote it and never mention the marker.

WHAT YOU WRITE
1. answer -- the final answer, as short as possible: "$x = 10$", "$28(2y - 3)$", "No: $-52$ is not a term of the sequence." For an "explain", "justify" or "prove" part, one or two short sentences a student could have written. It must agree exactly with the teacher's answer.
2. marks -- "How the marks work". One entry per mark, or per group of marks earned together, in the order they are earned. Each text says in at most about 15 words what earns it, starting with the action or the thing: "Multiply every term by $10$ to clear the fractions", "Correct answer: $x = 10$". The marks MUST add up to exactly the part's total. Where a part is not marked on its mathematics and everyone gets its marks, say that in one entry.
3. watch -- up to three "watch out" notes, one short sentence each: the rules and mistakes that decide marks most often. For example: "An answer with no working earns only 1 of the 3 marks." "Leave $-\\sqrt{7}$ exact: a decimal loses the mark." "Follow-through: if your (a) was wrong, you can still earn this mark by using it correctly." Leave it empty when nothing needs a warning.
4. steps -- the "Explain more" slides a student opens if they want to understand. 2 to 5 slides, ONE idea each, in the order a student would think it through: usually what the question is asking, then the key move or moves, then the answer (and a quick check where one exists). Each slide has:
   - title: 2 to 6 words, e.g. "Clear the fractions".
   - body: 1 to 3 short sentences, at most about 60 words. Put the key line of maths on its own as display maths $$...$$.
   - diagram: only when a picture shows the idea better than words (see DIAGRAMS), otherwise null. Use diagrams on 1 to 3 slides, not on every slide.
   - more: "Explain this further", for a student still stuck on THIS slide. Go slower: break the move into smaller steps, show it on simpler numbers, or say why it works. 2 to 5 short sentences, at most about 110 words. Never just repeat the body.

HOW TO WRITE -- this matters as much as the maths
- Talk to the student as "you". Calm, friendly and direct. Never "simply", "just", "obviously", "easy" or "clearly".
- Short sentences: one idea each, at most about 20 words. Plain words. When a maths word matters, explain it the first time, in brackets: "coefficient (the number in front of the letter)".
- Be literal. No idioms, jokes, sarcasm, metaphors or rhetorical questions.
- Use the same word for the same thing every time.
- Bold (**like this**) at most one key phrase per slide. Never write in capitals for emphasis.
- No marking codes (M1, A1, R1, FT, AG) and no marker language ("award", "candidate", "accept"). Say what a student does and what they get: "You get this mark if ...", "This earns 0 marks."
- Never mention AI, a model, or how this text was written.
- Every number, sign and line of working must be correct. Check each step before you write the next, and check that your explanation reaches the teacher's answer.

MATHEMATICS
- All maths is LaTeX: inline $...$ or display $$...$$. Never \\(...\\) or \\[...\\]. Never leave maths as plain text: "x^2", "sqrt(7)" and "3/4" are wrong; $x^2$, $\\sqrt{7}$ and $\\frac{3}{4}$ are right.
- A money sign is \\$ (for example \\$32). A $ without a backslash always starts maths.
- KaTeX only: \\frac, \\sqrt, \\times, \\div, \\neq, \\leq, \\geq, \\pm, \\cdot, \\left( \\right), \\text{...}, \\underbrace{...}_{\\text{...}}, \\overbrace, \\cancel{...}, \\boxed{...}, and \\begin{aligned}...\\end{aligned} inside $$...$$. No \\begin{align}, no \\newcommand, no packages.
- Four highlight colours: \\blue{...}, \\orange{...}, \\green{...}, \\pink{...}. Use one to show what changes from one line to the next, and always say it in words too: colour is never the only signal.
- Keep the paper's notation and letters. Multiplication of numbers is \\times; if the question writes $\\div$, so do you.
- Vectors are \\boldsymbol{a}, column vectors use pmatrix, a dot product is \\boldsymbol{\\cdot}; scalars such as \\lambda are not bold.

DIAGRAMS
Choose the kind that fits the idea, and fill every field.
- working: a short chain of equivalent lines (solving, simplifying, expanding, substituting). Each line is LaTeX without $. Its note is the move that produced it, e.g. "divide both sides by $7$"; the first line's note is "".
- area_model: a grid for multiplying brackets or for factorising. The headings are the terms of each factor; each cell is their product.
- number_line: values marked on a line (a hollow circle is an excluded value), jumps (counting in equal steps), shaded ranges (inequalities).
- bar_model: bars drawn to the same scale, for percentages, ratios and parts of a whole.
- table: values in rows and columns (term number and term, week and total, input and output).
- sequence: the terms of a sequence in boxes, with the change between neighbours.
- graph: curves y = f(x) and points on axes, in a window that shows the important features. Curves use calculator syntax: x^2 - 4, 2*sin(x), (x+1)/(x-2).
- tiles: the figures of a pattern made of unit squares, with the tiles added since the previous figure marked isNew.
Keep every diagram small and uncluttered: at most 6 lines of working, a 4 by 4 grid, 10 terms or 8 points. Each caption is one plain sentence describing the diagram for a student who cannot see it.

EXAMPLE
For this input:

${EXAMPLE_INPUT}

a good answer is:

${JSON.stringify(EXPLANATION_EXAMPLE, null, 2)}`;

/** The system prompt: identical on every call, so it caches. */
export function buildExplanationSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

export interface ExplanationRequest {
  assessmentName: string;
  courseName: string | null;
  source: ExplanationPartSource;
  /** The other parts of the same question, for context. */
  siblings: ExplanationPartSource[];
  /** Problems found in an earlier draft of this same part. */
  problems?: string[];
}

function marksWord(n: number): string {
  return `${n} mark${n === 1 ? "" : "s"}`;
}

function block(tag: string, text: string): string {
  return `<${tag}>\n${text.trim()}\n</${tag}>`;
}

export function buildExplanationUserPrompt(req: ExplanationRequest): string {
  const { source } = req;
  const lines: string[] = [];
  if (req.courseName) lines.push(`Course: ${req.courseName}`);
  lines.push(`Assessment: ${req.assessmentName}`);
  if (source.sectionHeading.trim()) lines.push(`Section: ${source.sectionHeading.trim()}`);
  lines.push("", `Part ${source.label} -- worth ${marksWord(source.maxMarks)}.`, "");

  if (source.stem.trim()) {
    lines.push("The question (shared by all its parts):", block("stem", source.stem), "");
  }
  lines.push("This part:", block("part", source.prompt.trim() || "(the question text is not recorded)"), "");
  if (source.answer.trim()) lines.push("The teacher's answer:", block("answer", source.answer), "");
  lines.push("The teacher's mark scheme for this part:", block("mark_scheme", source.markScheme.trim() || "(none)"), "");

  const others = req.siblings.filter((s) => s.key !== source.key);
  if (others.length > 0) {
    const described = others.map((s) => {
      const answer = s.answer.trim() ? ` Answer: ${s.answer.trim()}` : "";
      return `${s.label} [${marksWord(s.maxMarks)}] ${s.prompt.trim()}${answer}`;
    });
    lines.push("Other parts of this question, for context only (do not explain them):", block("other_parts", described.join("\n")), "");
  }

  if (req.problems && req.problems.length > 0) {
    lines.push(
      "An earlier draft of this explanation had these problems. Write it again with every one of them fixed:",
      ...req.problems.map((p) => `- ${p}`),
      "",
    );
  }

  lines.push(
    `Write the student version of part ${source.label}. "How the marks work" must add up to exactly ${marksWord(source.maxMarks)}.`,
  );
  return lines.join("\n");
}

export type ExplanationResult =
  | { ok: true; explanation: MarkSchemeExplanation; attempts: number }
  | { ok: false; error: string; problems: string[] };

/** When writeExplanation must stop: no new attempt starts after `startBy`,
 *  and no call runs past `finishBy` (epoch ms). A route has a time limit,
 *  and a part reported as failed can be tried again, where one killed
 *  mid-call leaves the teacher with nothing. */
export interface ExplanationBudget {
  startBy: number;
  finishBy: number;
}

const NO_LIMIT: ExplanationBudget = { startBy: Number.POSITIVE_INFINITY, finishBy: Number.POSITIVE_INFINITY };

/** The least time worth starting a call with. */
const MIN_CALL_MS = 20_000;

/**
 * Writes and checks one part's explanation, sending a failing draft back
 * with its problems named, at most MAX_ATTEMPTS times in all. `onUsage` is
 * called after every model call that returns, so spend is recorded even for
 * a draft that is thrown away. An overloaded or timed-out call is tried
 * again like a failing draft, within the same budget; any other API error
 * ends the part.
 */
export async function writeExplanation(
  anthropic: Anthropic,
  req: ExplanationRequest,
  onUsage: (usage: Anthropic.Messages.Usage) => Promise<void> | void,
  budget: ExplanationBudget = NO_LIMIT,
): Promise<ExplanationResult> {
  let problems: string[] = [];
  let lastError = "The explanation could not be written.";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const now = Date.now();
    if (attempt > 1 && now > budget.startBy) break;
    const timeLeft = budget.finishBy - now;
    if (timeLeft < MIN_CALL_MS) break;
    let message;
    try {
      message = await anthropic.messages.parse(
        {
          model: EXPLANATION_MODEL,
          max_tokens: 16000,
          thinking: { type: "adaptive" },
          output_config: { effort: "high", format: zodOutputFormat(MarkSchemeExplanationSchema) },
          system: [{ type: "text", text: buildExplanationSystemPrompt(), cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: buildExplanationUserPrompt({ ...req, problems }) }],
        },
        Number.isFinite(timeLeft) ? { timeout: timeLeft } : undefined,
      );
    } catch (e) {
      if (e instanceof Anthropic.APIError) {
        // No status: the connection failed or timed out. 429 and 5xx: busy.
        const transient = e.status === undefined || e.status === 429 || e.status >= 500;
        lastError = `The model call failed: ${e.message}`;
        if (!transient) return { ok: false, error: lastError, problems };
        continue;
      }
      // A draft that does not match the schema throws from parse(); treat it
      // like any other failed draft.
      lastError = e instanceof Error ? e.message : String(e);
      problems = ["The previous draft did not match the required structure. Fill every field, using null only where it is allowed."];
      continue;
    }
    await onUsage(message.usage);

    if (message.stop_reason === "refusal") {
      return { ok: false, error: "The model declined to write this explanation.", problems };
    }
    if (message.stop_reason === "max_tokens" || !message.parsed_output) {
      lastError = "The draft was cut off before it was finished.";
      problems = ["The previous draft was too long and was cut off. Keep every text within its limit."];
      continue;
    }

    const explanation = message.parsed_output;
    problems = checkExplanation(explanation, req.source.maxMarks);
    if (problems.length === 0) return { ok: true, explanation, attempts: attempt };
    lastError = `The draft still had ${problems.length} problem${problems.length === 1 ? "" : "s"} after ${attempt} attempt${attempt === 1 ? "" : "s"}.`;
  }
  return { ok: false, error: lastError, problems };
}
