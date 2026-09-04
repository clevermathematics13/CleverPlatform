import { describe, it, expect } from "vitest";
import { computeGamePoints, DEFAULT_GAME_TIME_LIMIT_SECONDS } from "./game-scoring";

const DEFAULT_TIME_LIMIT_MS = DEFAULT_GAME_TIME_LIMIT_SECONDS * 1000;

const base = {
  isCorrect: true,
  elapsedMs: 3000,
  timeLimitMs: DEFAULT_TIME_LIMIT_MS,
  correctRank: 1,
  streakBeforeAnswer: 0,
  playerRankBeforeQuestion: 1,
  totalPlayers: 4,
};

describe("computeGamePoints", () => {
  it("awards zero points for a wrong answer", () => {
    const result = computeGamePoints({ ...base, isCorrect: false, correctRank: null });
    expect(result.scored).toBe(false);
    expect(result.totalPoints).toBe(0);
    expect(result.newStreak).toBe(0);
  });

  it("awards zero points once the time limit is exceeded, even if correct", () => {
    const result = computeGamePoints({ ...base, elapsedMs: DEFAULT_TIME_LIMIT_MS + 1 });
    expect(result.withinTimeLimit).toBe(false);
    expect(result.scored).toBe(false);
    expect(result.totalPoints).toBe(0);
  });

  it("still scores an answer landing exactly on the time limit", () => {
    const result = computeGamePoints({ ...base, elapsedMs: DEFAULT_TIME_LIMIT_MS });
    expect(result.withinTimeLimit).toBe(true);
    expect(result.scored).toBe(true);
  });

  it("honors a teacher-adjusted time limit, not a fixed constant", () => {
    const shortLimit = computeGamePoints({ ...base, elapsedMs: 12_000, timeLimitMs: 10_000 });
    const longLimit = computeGamePoints({ ...base, elapsedMs: 12_000, timeLimitMs: 30_000 });
    expect(shortLimit.scored).toBe(false);
    expect(longLimit.scored).toBe(true);
  });

  it("makes the second correct answer worth more than the first", () => {
    const first = computeGamePoints({ ...base, correctRank: 1 });
    const second = computeGamePoints({ ...base, correctRank: 2 });
    expect(second.basePoints).toBeGreaterThan(first.basePoints);
  });

  it("tapers points for later ranks, with a floor", () => {
    const ranks = [1, 2, 3, 4, 5, 6, 20];
    const points = ranks.map((r) => computeGamePoints({ ...base, correctRank: r }).basePoints);
    // rank 2 is the peak; from rank 3 onward it strictly decreases toward the floor
    expect(points[1]).toBe(Math.max(...points));
    for (let i = 2; i < points.length; i++) {
      expect(points[i]).toBeLessThanOrEqual(points[i - 1]);
    }
    expect(points[points.length - 1]).toBeGreaterThanOrEqual(300);
  });

  it("throws if a scored answer has no rank", () => {
    expect(() => computeGamePoints({ ...base, correctRank: null })).toThrow();
  });

  it("increases points with a longer streak, up to the cap", () => {
    const noStreak = computeGamePoints({ ...base, streakBeforeAnswer: 0 });
    const midStreak = computeGamePoints({ ...base, streakBeforeAnswer: 3 });
    const cappedStreak = computeGamePoints({ ...base, streakBeforeAnswer: 5 });
    const pastCap = computeGamePoints({ ...base, streakBeforeAnswer: 9 });
    expect(midStreak.totalPoints).toBeGreaterThan(noStreak.totalPoints);
    expect(cappedStreak.totalPoints).toBeGreaterThan(midStreak.totalPoints);
    expect(pastCap.totalPoints).toBe(cappedStreak.totalPoints);
  });

  it("resets streak to zero on a miss", () => {
    const result = computeGamePoints({ ...base, isCorrect: false, correctRank: null, streakBeforeAnswer: 4 });
    expect(result.newStreak).toBe(0);
  });

  it("bumps points for a trailing player but not a leading one", () => {
    const leader = computeGamePoints({ ...base, playerRankBeforeQuestion: 1, totalPlayers: 6 });
    const trailing = computeGamePoints({ ...base, playerRankBeforeQuestion: 6, totalPlayers: 6 });
    expect(trailing.underdogBonus).toBeGreaterThan(0);
    expect(leader.underdogBonus).toBe(0);
    expect(trailing.totalPoints).toBeGreaterThan(leader.totalPoints);
  });

  it("gives no underdog bonus in a solo game", () => {
    const result = computeGamePoints({ ...base, playerRankBeforeQuestion: 1, totalPlayers: 1 });
    expect(result.underdogBonus).toBe(0);
  });
});
