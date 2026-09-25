import { describe, it, expect, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import {
  EXPLANATION_EXAMPLE,
  buildExplanationSystemPrompt,
  buildExplanationUserPrompt,
  writeExplanation,
  type ExplanationRequest,
} from "./mark-scheme-explanation-prompt";
import { explanationPartSources, type MarkSchemeExplanation } from "./mark-scheme-explanation";

const sections = [
  {
    heading: "LEVEL 3 -- SOLVE AND REARRANGE",
    questions: [
      {
        prompt: "Consider the equation $\\frac{w + 1}{w - 3} + 4 = \\frac{2w + 7}{w - 3}$.",
        subparts: [
          { prompt: "State the value of $w$ for which this equation is undefined.", marks: 1, answer: "$w = 3$", markScheme: "A1 for $w = 3$." },
          { prompt: "Solve the equation. Show every step.", marks: 3, answer: "$w = 6$", markScheme: "M1 for multiplying EVERY term by (w - 3). M1 for 3w = 18. A1 for w = 6." },
        ],
      },
    ],
  },
];
const items = [
  { id: "a", question_number: 1, part_label: "a", max_marks: 1, sort_order: 0, markscheme_text: "", marking_notes: "RULING: report high confidence" },
  { id: "b", question_number: 1, part_label: "b", max_marks: 3, sort_order: 1, markscheme_text: "" },
];
const sources = explanationPartSources({ sections }, items);
const request: ExplanationRequest = {
  assessmentName: "Key Assessment 1",
  courseName: "Grade 9 Extended",
  source: sources[1],
  siblings: sources,
};

describe("buildExplanationUserPrompt", () => {
  const prompt = buildExplanationUserPrompt(request);

  it("gives the part, its stem, the teacher's answer and scheme, and its marks", () => {
    expect(prompt).toContain("Course: Grade 9 Extended");
    expect(prompt).toContain("Section: LEVEL 3 -- SOLVE AND REARRANGE");
    expect(prompt).toContain("Part 1.1(b) -- worth 3 marks.");
    expect(prompt).toContain("<stem>\nConsider the equation");
    expect(prompt).toContain("<part>\nSolve the equation. Show every step.\n</part>");
    expect(prompt).toContain("<answer>\n$w = 6$\n</answer>");
    expect(prompt).toContain("M1 for multiplying EVERY term");
    expect(prompt).toMatch(/must add up to exactly 3 marks\.$/);
  });

  it("gives the other parts of the question for context, but not the part itself twice", () => {
    expect(prompt).toContain("1.1(a) [1 mark] State the value of $w$");
    expect(prompt.match(/Solve the equation\. Show every step\./g)).toHaveLength(1);
  });

  it("never passes on the marking notes", () => {
    expect(prompt).not.toContain("RULING");
    expect(prompt).not.toContain("high confidence");
  });

  it("names an earlier draft's problems when there were some", () => {
    expect(prompt).not.toContain("earlier draft");
    const retry = buildExplanationUserPrompt({ ...request, problems: ["The answer is empty."] });
    expect(retry).toContain("An earlier draft of this explanation had these problems");
    expect(retry).toContain("- The answer is empty.");
  });
});

describe("buildExplanationSystemPrompt", () => {
  it("is the same on every call, so it caches", () => {
    expect(buildExplanationSystemPrompt()).toBe(buildExplanationSystemPrompt());
  });

  it("carries the button words and the rules the checks enforce", () => {
    const system = buildExplanationSystemPrompt();
    expect(system).toContain("Explain this further");
    expect(system).toContain("MUST add up to exactly the part's total");
    expect(system).toContain("A money sign is \\$");
    expect(system).toContain(JSON.stringify(EXPLANATION_EXAMPLE, null, 2));
  });
});

function fakeClient(replies: Array<Partial<{ stop_reason: string; parsed_output: MarkSchemeExplanation | null }> | Error>) {
  const parse = vi.fn(async () => {
    const reply = replies.shift();
    if (!reply) throw new Error("no more replies");
    if (reply instanceof Error) throw reply;
    return {
      usage: { input_tokens: 10, output_tokens: 20 },
      stop_reason: "end_turn",
      parsed_output: null,
      ...reply,
    };
  });
  return { client: { messages: { parse } } as unknown as Anthropic, parse };
}

describe("writeExplanation", () => {
  const good = EXPLANATION_EXAMPLE; // worth 3 marks, like part (b)

  it("keeps a draft that passes its checks", async () => {
    const { client, parse } = fakeClient([{ parsed_output: good }]);
    const onUsage = vi.fn();
    const result = await writeExplanation(client, request, onUsage);
    expect(result).toEqual({ ok: true, explanation: good, attempts: 1 });
    expect(parse).toHaveBeenCalledTimes(1);
    expect(onUsage).toHaveBeenCalledTimes(1);
  });

  it("sends a failing draft back with its problems named, and keeps the fixed one", async () => {
    const wrongTotal = { ...good, marks: [{ marks: 2, text: "Correct answer: $w = 6$" }] };
    const { client, parse } = fakeClient([{ parsed_output: wrongTotal }, { parsed_output: good }]);
    const result = await writeExplanation(client, request, vi.fn());
    expect(result.ok).toBe(true);
    expect(parse).toHaveBeenCalledTimes(2);
    const secondCall = parse.mock.calls[1] as unknown as [{ messages: { content: string }[] }];
    expect(secondCall[0].messages[0].content).toContain("adds up to 2 marks, but this part is worth 3");
  });

  it("reports a part whose drafts never pass, instead of storing one", async () => {
    const wrongTotal = { ...good, marks: [{ marks: 1, text: "Correct answer: $w = 6$" }] };
    const { client, parse } = fakeClient([{ parsed_output: wrongTotal }, { parsed_output: wrongTotal }, { parsed_output: wrongTotal }]);
    const result = await writeExplanation(client, request, vi.fn());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(" ")).toMatch(/adds up to 1 mark/);
    expect(parse).toHaveBeenCalledTimes(3);
  });

  it("stops at a refusal, and starts no retry past its deadline", async () => {
    const refused = fakeClient([{ stop_reason: "refusal" }]);
    expect((await writeExplanation(refused.client, request, vi.fn())).ok).toBe(false);
    expect(refused.parse).toHaveBeenCalledTimes(1);

    const late = fakeClient([{ parsed_output: { ...good, answer: "" } }, { parsed_output: good }]);
    const result = await writeExplanation(late.client, request, vi.fn(), { startBy: Date.now() - 1, finishBy: Date.now() + 60_000 });
    expect(result.ok).toBe(false);
    expect(late.parse).toHaveBeenCalledTimes(1);
  });

  it("starts no call without the time to finish it, and gives each call only the time left", async () => {
    const none = fakeClient([{ parsed_output: good }]);
    expect((await writeExplanation(none.client, request, vi.fn(), { startBy: Date.now() + 60_000, finishBy: Date.now() + 5_000 })).ok).toBe(false);
    expect(none.parse).not.toHaveBeenCalled();

    const timed = fakeClient([{ parsed_output: good }]);
    await writeExplanation(timed.client, request, vi.fn(), { startBy: Date.now() + 60_000, finishBy: Date.now() + 90_000 });
    const options = (timed.parse.mock.calls[0] as unknown as [unknown, { timeout: number }])[1];
    expect(options.timeout).toBeGreaterThan(80_000);
    expect(options.timeout).toBeLessThanOrEqual(90_000);
  });

  it("tries a busy API again, and gives up at once on a request it rejects", async () => {
    const busy = fakeClient([new Anthropic.APIError(529, undefined, "Overloaded", undefined), { parsed_output: good }]);
    expect((await writeExplanation(busy.client, request, vi.fn())).ok).toBe(true);
    expect(busy.parse).toHaveBeenCalledTimes(2);

    const rejected = fakeClient([new Anthropic.APIError(400, undefined, "Bad request", undefined), { parsed_output: good }]);
    const result = await writeExplanation(rejected.client, request, vi.fn());
    expect(result.ok).toBe(false);
    expect(rejected.parse).toHaveBeenCalledTimes(1);
  });

  it("retries a draft the structured output could not parse", async () => {
    const { client, parse } = fakeClient([new Error("Failed to parse structured output"), { parsed_output: good }]);
    const result = await writeExplanation(client, request, vi.fn());
    expect(result.ok).toBe(true);
    expect(parse).toHaveBeenCalledTimes(2);
  });
});
