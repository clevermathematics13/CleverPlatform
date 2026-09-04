/**
 * Scoring rules for live Kahoot-style games (see app/dashboard/games).
 *
 * This module is the executable spec for the scoring math -- the actual
 * awarding of points happens atomically in the `submit_game_answer` and
 * `advance_game_session` SQL functions (platform/supabase/migrations), which
 * implement the same formula under a row lock so concurrent submissions rank
 * correctly. Keep the two in sync if either changes.
 *
 * The headline rule, by design, is NOT "fastest wins biggest": the second
 * correct answer is worth more than the first. That rewards a player who
 * reads the question fully rather than mashing the first option, while still
 * rewarding speed overall (rank 3+ tapers off). Anything answered after the
 * time limit earns zero credit, correct or not.
 */

export const GAME_TIME_LIMIT_MS = 15_000;
export const LUCKY_BONUS_POINTS = 50;

// Base points by 1-based rank among correct, on-time answers for a question.
// Rank 2 deliberately outscores rank 1.
const RANK_BASE_POINTS = [800, 1000, 700, 600, 500];
const RANK_FLOOR_POINTS = 300;
const RANK_FLOOR_STEP = 50;

function basePointsForRank(rank: number): number {
  if (rank <= RANK_BASE_POINTS.length) return RANK_BASE_POINTS[rank - 1];
  const stepsPastTable = rank - RANK_BASE_POINTS.length;
  return Math.max(
    RANK_FLOOR_POINTS,
    RANK_BASE_POINTS[RANK_BASE_POINTS.length - 1] - stepsPastTable * RANK_FLOOR_STEP
  );
}

export interface GameScoreInput {
  isCorrect: boolean;
  elapsedMs: number;
  /** 1-based rank among correct, on-time answers for this question. Required when the answer is correct and within the time limit. */
  correctRank: number | null;
  /** Consecutive correct-and-scored answers immediately before this one. */
  streakBeforeAnswer: number;
  /** 1 = current leaderboard leader. */
  playerRankBeforeQuestion: number;
  totalPlayers: number;
}

export interface GameScoreBreakdown {
  withinTimeLimit: boolean;
  /** True only if this answer earned any points. */
  scored: boolean;
  basePoints: number;
  streakBonus: number;
  underdogBonus: number;
  totalPoints: number;
  newStreak: number;
}

/**
 * Rubber-band bonus for players trailing at or below the leaderboard median
 * going into this question, so a bad start doesn't decide the whole game.
 */
function computeUnderdogBonus(
  base: number,
  playerRankBeforeQuestion: number,
  totalPlayers: number
): number {
  const isTrailing =
    totalPlayers > 1 && playerRankBeforeQuestion > Math.ceil(totalPlayers / 2);
  return isTrailing ? Math.round(base * 0.2) : 0;
}

export function computeGamePoints(input: GameScoreInput): GameScoreBreakdown {
  const withinTimeLimit = input.elapsedMs <= GAME_TIME_LIMIT_MS;
  const scored = input.isCorrect && withinTimeLimit;

  if (!scored) {
    return {
      withinTimeLimit,
      scored: false,
      basePoints: 0,
      streakBonus: 0,
      underdogBonus: 0,
      totalPoints: 0,
      newStreak: 0,
    };
  }

  if (!input.correctRank || input.correctRank < 1) {
    throw new Error("correctRank is required for a scored answer");
  }

  const basePoints = basePointsForRank(input.correctRank);
  const streakMultiplier = Math.min(input.streakBeforeAnswer, 5) * 0.1;
  const streakBonus = Math.round(basePoints * streakMultiplier);
  const underdogBonus = computeUnderdogBonus(
    basePoints + streakBonus,
    input.playerRankBeforeQuestion,
    input.totalPlayers
  );

  return {
    withinTimeLimit,
    scored: true,
    basePoints,
    streakBonus,
    underdogBonus,
    totalPoints: basePoints + streakBonus + underdogBonus,
    newStreak: input.streakBeforeAnswer + 1,
  };
}
