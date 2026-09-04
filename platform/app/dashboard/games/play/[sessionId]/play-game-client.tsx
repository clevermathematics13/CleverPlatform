"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import LatexRenderer from "@/components/LatexRenderer";
import {
  CHOICE_COLORS,
  type ActiveQuestion,
  type GamePlayerRow,
  type GameSessionRow,
  type SubmitAnswerResult,
} from "@/lib/game-types";

export function PlayGameClient({
  sessionId,
  bankTitle,
  profileId,
}: {
  sessionId: string;
  bankTitle: string;
  profileId: string;
}) {
  const supabase = useRef(createClient()).current;
  const [session, setSession] = useState<GameSessionRow | null>(null);
  const [players, setPlayers] = useState<GamePlayerRow[]>([]);
  const [question, setQuestion] = useState<ActiveQuestion | null>(null);
  const [myAnswer, setMyAnswer] = useState<SubmitAnswerResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const sessionRef = useRef<GameSessionRow | null>(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  async function refreshQuestion() {
    const { data } = await supabase.rpc("get_active_question", { p_session_id: sessionId });
    setQuestion(data as ActiveQuestion | null);
  }

  async function refreshPlayers() {
    const { data } = await supabase
      .from("game_players")
      .select("*")
      .eq("session_id", sessionId)
      .order("total_score", { ascending: false });
    setPlayers((data as GamePlayerRow[]) ?? []);
  }

  // Shared by the realtime handler and the poll fallback below, so a missed
  // or delayed websocket event and a routine poll tick converge on the same
  // state instead of applying the phase transition differently.
  function applySessionRow(next: GameSessionRow) {
    const prev = sessionRef.current;
    setSession(next);
    if (!prev || prev.status !== next.status || prev.current_question_index !== next.current_question_index) {
      if (prev?.current_question_index !== next.current_question_index) setMyAnswer(null);
      if (next.status !== "lobby") refreshQuestion();
    }
    if (next.status === "reveal" || next.status === "finished") refreshPlayers();
  }

  async function refreshSession() {
    const { data } = await supabase.from("game_sessions").select("*").eq("id", sessionId).single();
    if (data) applySessionRow(data as GameSessionRow);
  }

  useEffect(() => {
    (async () => {
      const { data: sessionRow } = await supabase
        .from("game_sessions")
        .select("*")
        .eq("id", sessionId)
        .single();
      setSession(sessionRow as GameSessionRow);
      await refreshPlayers();
      if (sessionRow && sessionRow.status !== "lobby") await refreshQuestion();
    })();

    const channel = supabase
      .channel(`play-game-${sessionId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "game_sessions", filter: `id=eq.${sessionId}` },
        (payload) => applySessionRow(payload.new as GameSessionRow)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "game_players", filter: `session_id=eq.${sessionId}` },
        () => refreshPlayers()
      )
      .subscribe();

    // Realtime websocket subscriptions can silently drop (flaky networks,
    // proxies that time out idle connections, a backgrounded tab) with no
    // visible error, so this screen must not depend on them exclusively --
    // a plain poll keeps it live either way.
    const pollId = setInterval(() => {
      refreshSession();
      refreshPlayers();
    }, 3000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(pollId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    if (session?.status !== "question" || !question || myAnswer) return;
    const startedMs = new Date(question.questionStartedAt).getTime();
    const id = setInterval(() => {
      const remainingMs = question.timeLimitSeconds * 1000 - (Date.now() - startedMs);
      setSecondsLeft(Math.max(0, Math.ceil(remainingMs / 1000)));
    }, 250);
    return () => clearInterval(id);
  }, [session?.status, question, myAnswer]);

  async function pickChoice(index: number) {
    if (submitting || myAnswer || session?.status !== "question") return;
    setSubmitting(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc("submit_game_answer", {
      p_session_id: sessionId,
      p_choice_index: index,
    });
    if (rpcError) {
      setError(rpcError.message);
    } else {
      setMyAnswer({ ...(data as SubmitAnswerResult), chosenIndex: index } as SubmitAnswerResult & {
        chosenIndex: number;
      });
    }
    setSubmitting(false);
  }

  if (!session) return <p className="text-sm text-da-muted">Loading...</p>;

  const leaderboard = [...players].sort((a, b) => b.total_score - a.total_score);
  const myRank = leaderboard.findIndex((p) => p.profile_id === profileId) + 1;
  const chosenIndex = (myAnswer as (SubmitAnswerResult & { chosenIndex: number }) | null)
    ?.chosenIndex;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header className="rounded-2xl border border-da-border bg-da-surface/90 p-4 shadow-lg shadow-black/30 wood-surface">
        <p className="text-xs font-semibold tracking-wide text-da-muted uppercase">{bankTitle}</p>
      </header>

      {error && (
        <div className="rounded-lg border border-da-danger/40 bg-da-danger/10 px-3 py-2 text-xs text-da-danger">
          {error}
        </div>
      )}

      {session.status === "lobby" && (
        <div className="rounded-2xl border border-da-border bg-da-surface/90 p-6 text-center shadow-lg shadow-black/30 wood-surface">
          <h2 className="font-serif text-xl font-bold text-da-text">
            Waiting for the host to start...
          </h2>
          <p className="mt-2 text-sm text-da-muted">
            {players.length} player{players.length === 1 ? "" : "s"} in the lobby
          </p>
        </div>
      )}

      {session.status === "question" && question && (
        <div className="rounded-2xl border border-da-border bg-da-surface/90 p-5 shadow-lg shadow-black/30 wood-surface">
          <div className="flex items-center justify-between text-xs font-semibold text-da-muted uppercase">
            <span>
              Question {question.questionIndex + 1} / {question.totalQuestions}
            </span>
            {!myAnswer && (
              <span className={secondsLeft === 0 ? "text-da-danger" : "text-da-accent"}>
                {secondsLeft ?? question.timeLimitSeconds}s
              </span>
            )}
          </div>
          <div className="mt-3 text-center">
            <LatexRenderer latex={`$$${question.promptLatex}$$`} className="text-da-text" />
          </div>
          <p className="mt-2 text-center text-sm text-da-muted">{question.questionText}</p>

          {!myAnswer ? (
            <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {question.choices.map((c) => {
                const color = CHOICE_COLORS[c.index % CHOICE_COLORS.length];
                return (
                  <button
                    key={c.index}
                    type="button"
                    disabled={submitting}
                    onClick={() => pickChoice(c.index)}
                    className={`rounded-lg border p-4 text-left text-sm text-da-text transition-opacity hover:opacity-80 disabled:opacity-50 ${color.bg} ${color.border}`}
                  >
                    <span className={`mr-2 font-bold ${color.text}`}>{color.label}</span>
                    <LatexRenderer latex={c.text} className="inline" />
                  </button>
                );
              })}
            </div>
          ) : (
            <div
              className={`mt-5 rounded-lg border p-4 text-center ${
                myAnswer.isCorrect
                  ? "border-da-success bg-da-success/10"
                  : "border-da-danger bg-da-danger/10"
              }`}
            >
              <p className="text-lg font-bold text-da-text">
                {myAnswer.isCorrect ? "Correct!" : myAnswer.withinTimeLimit ? "Not quite." : "Too slow!"}
              </p>
              {myAnswer.pointsAwarded > 0 && (
                <p className="mt-1 text-sm text-da-muted">
                  +{myAnswer.pointsAwarded} points
                  {myAnswer.correctRank === 2 && " -- 2nd fastest, the best spot!"}
                  {myAnswer.correctRank === 1 && " -- 1st in, but 2nd earns more next time!"}
                </p>
              )}
              <p className="mt-2 text-xs text-da-muted">Waiting for the host to reveal...</p>
            </div>
          )}
        </div>
      )}

      {session.status === "reveal" && question && (
        <div className="rounded-2xl border border-da-border bg-da-surface/90 p-5 shadow-lg shadow-black/30 wood-surface">
          <div className="text-center">
            <LatexRenderer latex={`$$${question.promptLatex}$$`} className="text-da-text" />
          </div>
          <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {question.choices.map((c) => {
              const color = CHOICE_COLORS[c.index % CHOICE_COLORS.length];
              return (
                <div
                  key={c.index}
                  className={`rounded-lg border p-3 text-sm text-da-text ${color.bg} ${
                    c.isCorrect
                      ? "border-da-success ring-2 ring-da-success"
                      : c.index === chosenIndex
                        ? "border-da-danger"
                        : color.border
                  }`}
                >
                  <span className={`mr-2 font-bold ${color.text}`}>{color.label}</span>
                  <LatexRenderer latex={c.text} className="inline" />
                  {c.isCorrect && <span className="ml-2 text-da-success">correct</span>}
                </div>
              );
            })}
          </div>
          {question.explanation && (
            <div className="mt-4 rounded-lg border border-da-border bg-da-hover px-4 py-3 text-sm text-da-text">
              <LatexRenderer latex={question.explanation} />
            </div>
          )}

          <h3 className="mt-6 font-serif text-lg font-bold text-da-text">
            Leaderboard {myRank > 0 && `-- you're #${myRank}`}
          </h3>
          <ol className="mt-2 space-y-1">
            {leaderboard.slice(0, 5).map((p, i) => (
              <li
                key={p.id}
                className={`flex items-center justify-between text-sm ${
                  p.profile_id === profileId ? "font-bold text-da-accent" : "text-da-text"
                }`}
              >
                <span>
                  {i + 1}. {p.nickname}
                  {p.current_streak >= 2 && (
                    <span className="ml-2 text-da-warning">🔥{p.current_streak}</span>
                  )}
                </span>
                <span className="font-mono">{p.total_score}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {session.status === "finished" && (
        <div className="rounded-2xl border border-da-border bg-da-surface/90 p-5 shadow-lg shadow-black/30 wood-surface">
          <h2 className="font-serif text-2xl font-bold text-da-text">Final Results</h2>
          <ol className="mt-4 space-y-2">
            {leaderboard.map((p, i) => (
              <li
                key={p.id}
                className={`flex items-center justify-between rounded-lg border px-4 py-2 ${
                  p.profile_id === profileId
                    ? "border-da-accent bg-da-accent/10 text-da-accent"
                    : "border-da-border bg-da-hover text-da-text"
                }`}
              >
                <span className="font-semibold">
                  {["🥇", "🥈", "🥉"][i] ?? `${i + 1}.`} {p.nickname}
                  {p.best_streak >= 3 && (
                    <span className="ml-2 text-xs text-da-warning">
                      best streak 🔥{p.best_streak}
                    </span>
                  )}
                </span>
                <span className="font-mono">{p.total_score}</span>
              </li>
            ))}
          </ol>
          <Link href="/dashboard/games" className="da-btn-link mt-5 inline-block">
            Back to Live Game
          </Link>
        </div>
      )}
    </div>
  );
}
