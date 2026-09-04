import { describe, it, expect } from "vitest";
import { rankPlayers, tallyChoices } from "./game-summary";

describe("rankPlayers", () => {
  it("ranks by score descending", () => {
    const ranks = rankPlayers([
      { id: "a", total_score: 500 },
      { id: "b", total_score: 1800 },
      { id: "c", total_score: 900 },
    ]);
    expect(ranks.get("b")).toBe(1);
    expect(ranks.get("c")).toBe(2);
    expect(ranks.get("a")).toBe(3);
  });

  it("gives tied players the same rank and skips the tied places", () => {
    const ranks = rankPlayers([
      { id: "a", total_score: 1800 },
      { id: "b", total_score: 1800 },
      { id: "c", total_score: 700 },
      { id: "d", total_score: 700 },
      { id: "e", total_score: 0 },
    ]);
    expect(ranks.get("a")).toBe(1);
    expect(ranks.get("b")).toBe(1);
    expect(ranks.get("c")).toBe(3);
    expect(ranks.get("d")).toBe(3);
    expect(ranks.get("e")).toBe(5);
  });

  it("does not mutate the input order", () => {
    const players = [
      { id: "a", total_score: 1 },
      { id: "b", total_score: 2 },
    ];
    rankPlayers(players);
    expect(players.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("handles an empty lobby", () => {
    expect(rankPlayers([]).size).toBe(0);
  });
});

describe("tallyChoices", () => {
  const answers = [
    { choice_index: 0 },
    { choice_index: 2 },
    { choice_index: 2 },
    { choice_index: 3 },
  ];

  it("counts each choice and the players who did not answer", () => {
    const t = tallyChoices(answers, 4, 6);
    expect(t.choices.map((c) => c.count)).toEqual([1, 0, 2, 1]);
    expect(t.answered).toBe(4);
    expect(t.noAnswer).toBe(2);
    expect(t.players).toBe(6);
  });

  it("expresses percentages as a share of players, so bars and no-answer sum to 100", () => {
    const t = tallyChoices(answers, 4, 8);
    expect(t.choices.map((c) => c.pct)).toEqual([13, 0, 25, 13]);
    const noAnswerPct = Math.round((t.noAnswer / t.players) * 100);
    expect(t.choices.reduce((s, c) => s + c.pct, 0) + noAnswerPct).toBeGreaterThanOrEqual(99);
  });

  it("never reports negative no-answer if more answers than known players arrive", () => {
    const t = tallyChoices(answers, 4, 2);
    expect(t.noAnswer).toBe(0);
    expect(t.players).toBe(4);
  });

  it("ignores out-of-range choice indices without losing them from the answered count", () => {
    const t = tallyChoices([{ choice_index: 7 }, { choice_index: 1 }], 4, 3);
    expect(t.choices.map((c) => c.count)).toEqual([0, 1, 0, 0]);
    expect(t.answered).toBe(2);
    expect(t.noAnswer).toBe(1);
  });

  it("returns zeros with no players", () => {
    const t = tallyChoices([], 4, 0);
    expect(t.choices.every((c) => c.count === 0 && c.pct === 0)).toBe(true);
    expect(t.noAnswer).toBe(0);
  });
});
