/** Shapes returned by the game RPCs (platform/supabase/migrations/*_game_live_kahoot.sql).
 *  Shared between the host and player client components. */

export type GameSessionStatus = "lobby" | "question" | "reveal" | "finished";

export interface GameSessionRow {
  id: string;
  bank_id: string;
  host_id: string;
  room_code: string;
  status: GameSessionStatus;
  current_question_index: number;
  current_question_started_at: string | null;
  question_order: string[];
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
}

export interface GamePlayerRow {
  id: string;
  session_id: string;
  profile_id: string;
  nickname: string;
  joined_at: string;
  total_score: number;
  current_streak: number;
  best_streak: number;
}

export interface ActiveQuestionChoice {
  index: number;
  text: string;
  isCorrect?: boolean;
}

/** Return shape of get_active_question(). Answer-key fields are only present
 *  once status is 'reveal' or 'finished' -- never while status is 'question'. */
export interface ActiveQuestion {
  status: GameSessionStatus;
  questionIndex: number;
  totalQuestions: number;
  promptLatex: string;
  questionText: string;
  hint: string | null;
  timeLimitSeconds: number;
  questionStartedAt: string;
  choices: ActiveQuestionChoice[];
  explanation?: string;
  feedbackCorrect?: string | null;
  feedbackIncorrect?: string | null;
  tags?: string[];
}

/** Return shape of submit_game_answer(). */
export interface SubmitAnswerResult {
  alreadyAnswered: boolean;
  isCorrect: boolean;
  withinTimeLimit: boolean;
  pointsAwarded: number;
  correctRank: number | null;
  newStreak?: number;
}

export const CHOICE_COLORS = [
  { bg: "bg-da-danger/15", border: "border-da-danger", text: "text-da-danger", label: "A" },
  { bg: "bg-da-info/15", border: "border-da-info", text: "text-da-info", label: "B" },
  { bg: "bg-da-success/15", border: "border-da-success", text: "text-da-success", label: "C" },
  { bg: "bg-da-warning/15", border: "border-da-warning", text: "text-da-warning", label: "D" },
] as const;
