/**
 * Pure helpers for what the live-game screens show about standings.
 *
 * Both are deliberately free of Supabase so the host and player clients can
 * share them and the arithmetic can be unit-tested (lib/game-summary.test.ts).
 */

export interface RankablePlayer {
  id: string;
  total_score: number;
}

/**
 * Competition ranking ("1224"): players on equal points share a rank, and
 * the next distinct score skips the tied places. Two students on 1800 are
 * both #1, and the next is #3 -- telling one of them they are #2 because of
 * join order would be wrong, and a tie for first should feel like one.
 */
export function rankPlayers<T extends RankablePlayer>(players: T[]): Map<string, number> {
  const sorted = [...players].sort((a, b) => b.total_score - a.total_score);
  const ranks = new Map<string, number>();
  let rank = 0;
  let prevScore: number | null = null;
  sorted.forEach((p, i) => {
    if (prevScore === null || p.total_score !== prevScore) {
      rank = i + 1;
      prevScore = p.total_score;
    }
    ranks.set(p.id, rank);
  });
  return ranks;
}

export interface ChoiceTally {
  index: number;
  count: number;
  /** Share of PLAYERS (not of answers), so the bars plus "no answer" sum to 100. */
  pct: number;
}

export interface ChoiceFrequency {
  choices: ChoiceTally[];
  noAnswer: number;
  answered: number;
  players: number;
}

/**
 * Count how many players picked each choice for one question. Answers with a
 * choice index outside the choice list (a question edited mid-game) are
 * counted as answered but attributed to no bar, so the totals stay honest.
 */
export function tallyChoices(
  answers: { choice_index: number }[],
  choiceCount: number,
  playerCount: number
): ChoiceFrequency {
  const counts = new Array<number>(Math.max(0, choiceCount)).fill(0);
  for (const a of answers) {
    if (a.choice_index >= 0 && a.choice_index < counts.length) counts[a.choice_index] += 1;
  }
  const players = Math.max(playerCount, answers.length);
  const pctOf = (n: number) => (players > 0 ? Math.round((n / players) * 100) : 0);
  return {
    choices: counts.map((count, index) => ({ index, count, pct: pctOf(count) })),
    noAnswer: Math.max(0, players - answers.length),
    answered: answers.length,
    players,
  };
}

/**
 * How many questions are "done" from the player's point of view: a question
 * counts once its answer has been revealed, so during the question itself
 * the marker for it is still awake, and the reveal is the moment it dozes
 * off. In the lobby nothing is done; when the game is finished everything is.
 */
export function completedQuestionCount(
  status: "lobby" | "question" | "reveal" | "finished",
  currentIndex: number,
  total: number
): number {
  if (total <= 0) return 0;
  if (status === "lobby") return 0;
  if (status === "finished") return total;
  const done = status === "reveal" ? currentIndex + 1 : currentIndex;
  return Math.max(0, Math.min(total, done));
}
