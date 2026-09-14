import { describe, expect, it } from "vitest";
import {
  rollUpByTopic,
  topicOf,
  totalTally,
  weakestFirst,
  type RollupCell,
  type SubtopicNode,
  type TopicRollup,
} from "@/lib/practice-topic-rollup";

/** The real shape of the 5.16 family: three spellings, one topic. */
const INDEX = new Map<string, SubtopicNode>([
  ["5.16", { code: "5.16", name: "Further integration", parentCode: null, parentName: null }],
  [
    "5.16 (parts)",
    { code: "5.16 (parts)", name: "Integration by parts", parentCode: "5.16", parentName: "Further integration" },
  ],
  [
    "5.16.4",
    { code: "5.16.4", name: "Repeated integration by parts", parentCode: "5.16", parentName: "Further integration" },
  ],
  ["5.11", { code: "5.11", name: "Definite integrals", parentCode: null, parentName: null }],
]);

function cell(overrides: Partial<RollupCell> & { studentName: string }): RollupCell {
  return { verdict: null, answered: true, subtopicCodes: ["5.16 (parts)"], ...overrides };
}

describe("topicOf", () => {
  it("sends a child to its parent", () => {
    expect(topicOf("5.16 (parts)", INDEX)).toEqual({ code: "5.16", name: "Further integration" });
    expect(topicOf("5.16.4", INDEX)).toEqual({ code: "5.16", name: "Further integration" });
  });

  it("makes a topic-level code its own topic", () => {
    expect(topicOf("5.11", INDEX)).toEqual({ code: "5.11", name: "Definite integrals" });
  });

  // A tag no longer in the taxonomy is a tagging problem to see, not to hide.
  it("keeps an unknown code rather than dropping it", () => {
    expect(topicOf("9.99", INDEX)).toEqual({ code: "9.99", name: "9.99" });
  });
});

describe("rollUpByTopic", () => {
  it("counts the three spellings of one topic together", () => {
    const rollups = rollUpByTopic(
      [
        cell({ studentName: "A", verdict: "correct", subtopicCodes: ["5.16 (parts)"] }),
        cell({ studentName: "B", verdict: "not_yet", subtopicCodes: ["5.16.4"] }),
        cell({ studentName: "C", verdict: "almost", subtopicCodes: ["5.16"] }),
      ],
      INDEX
    );
    expect(rollups).toHaveLength(1);
    expect(rollups[0].topicCode).toBe("5.16");
    expect(rollups[0].answered).toBe(3);
    expect(rollups[0].tally).toEqual({ correct: 1, almost: 1, not_yet: 1 });
    expect(rollups[0].childCodes).toEqual(["5.16", "5.16 (parts)", "5.16.4"]);
  });

  it("ignores answers the student never wrote", () => {
    const rollups = rollUpByTopic(
      [cell({ studentName: "A", answered: false, verdict: null })],
      INDEX
    );
    expect(rollups).toEqual([]);
  });

  it("counts a written but unread answer as answered, not marked", () => {
    const [r] = rollUpByTopic([cell({ studentName: "A", verdict: null })], INDEX);
    expect(r.answered).toBe(1);
    expect(r.marked).toBe(0);
    expect(r.tally).toEqual({ correct: 0, almost: 0, not_yet: 0 });
  });

  it("counts one answer under each topic it is evidence about", () => {
    const rollups = rollUpByTopic(
      [cell({ studentName: "A", verdict: "correct", subtopicCodes: ["5.16 (parts)", "5.11"] })],
      INDEX
    );
    expect(rollups.map((r) => r.topicCode).sort()).toEqual(["5.11", "5.16"]);
    for (const r of rollups) expect(r.answered).toBe(1);
  });

  // The reason topics are de-duplicated per cell.
  it("does not double-count a question tagged twice within one topic", () => {
    const [r] = rollUpByTopic(
      [cell({ studentName: "A", verdict: "not_yet", subtopicCodes: ["5.16 (parts)", "5.16.4"] })],
      INDEX
    );
    expect(r.answered).toBe(1);
    expect(r.tally.not_yet).toBe(1);
    expect(r.childCodes).toEqual(["5.16 (parts)", "5.16.4"]);
  });

  it("names each struggling student once, sorted", () => {
    const [r] = rollUpByTopic(
      [
        cell({ studentName: "Zoe", verdict: "not_yet" }),
        cell({ studentName: "Adam", verdict: "not_yet" }),
        cell({ studentName: "Zoe", verdict: "not_yet", subtopicCodes: ["5.16.4"] }),
        cell({ studentName: "Mia", verdict: "correct" }),
      ],
      INDEX
    );
    expect(r.notYetStudents).toEqual(["Adam", "Zoe"]);
  });
});

describe("weakestFirst", () => {
  function rollup(over: Partial<TopicRollup> & { topicCode: string }): TopicRollup {
    return {
      topicName: over.topicCode,
      childCodes: [],
      answered: 0,
      marked: 0,
      tally: { correct: 0, almost: 0, not_yet: 0 },
      notYetStudents: [],
      ...over,
    };
  }

  it("puts the highest share of not-yet first", () => {
    const order = weakestFirst([
      rollup({ topicCode: "easy", marked: 4, tally: { correct: 4, almost: 0, not_yet: 0 } }),
      rollup({ topicCode: "hard", marked: 4, tally: { correct: 1, almost: 0, not_yet: 3 } }),
      rollup({ topicCode: "mid", marked: 4, tally: { correct: 2, almost: 0, not_yet: 2 } }),
    ]).map((r) => r.topicCode);
    expect(order).toEqual(["hard", "mid", "easy"]);
  });

  // An unread topic has no evidence and must not outrank a real struggle.
  it("sinks a topic nobody has marked below every marked one", () => {
    const order = weakestFirst([
      rollup({ topicCode: "unread", answered: 9, marked: 0 }),
      rollup({ topicCode: "allcorrect", marked: 2, tally: { correct: 2, almost: 0, not_yet: 0 } }),
    ]).map((r) => r.topicCode);
    expect(order).toEqual(["allcorrect", "unread"]);
  });

  it("breaks an equal share on more evidence, then on name", () => {
    const order = weakestFirst([
      rollup({ topicCode: "b", topicName: "b", marked: 2, tally: { correct: 1, almost: 0, not_yet: 1 } }),
      rollup({ topicCode: "a", topicName: "a", marked: 2, tally: { correct: 1, almost: 0, not_yet: 1 } }),
      rollup({ topicCode: "big", topicName: "big", marked: 8, tally: { correct: 4, almost: 0, not_yet: 4 } }),
    ]).map((r) => r.topicCode);
    expect(order).toEqual(["big", "a", "b"]);
  });

  it("does not mutate its input", () => {
    const input = [rollup({ topicCode: "x" }), rollup({ topicCode: "y" })];
    const before = input.map((r) => r.topicCode);
    weakestFirst(input);
    expect(input.map((r) => r.topicCode)).toEqual(before);
  });
});

describe("totalTally", () => {
  it("sums every topic", () => {
    const rollups = rollUpByTopic(
      [
        cell({ studentName: "A", verdict: "correct", subtopicCodes: ["5.16 (parts)"] }),
        cell({ studentName: "B", verdict: "not_yet", subtopicCodes: ["5.11"] }),
      ],
      INDEX
    );
    expect(totalTally(rollups)).toEqual({ correct: 1, almost: 0, not_yet: 1 });
  });

  it("is all zeroes for nothing", () => {
    expect(totalTally([])).toEqual({ correct: 0, almost: 0, not_yet: 0 });
  });
});
