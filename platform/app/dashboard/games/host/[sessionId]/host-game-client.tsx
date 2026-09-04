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
} from "@/lib/game-types";

interface LuckyWinner {
  playerId: string;
  nickname: string;
}

export function HostGameClient({
  sessionId,
  roomCode,
  bankTitle,
}: {
  sessionId: string;
  roomCode: string;
  bankTitle: string;
}) {
  const supabase = useRef(createClient()).current;
  const [session, setSession] = useState<GameSessionRow | null>(null);
  const [players, setPlayers] = useState<GamePlayerRow[]>([]);
  const [question, setQuestion] = useState<ActiveQuestion | null>(null);
  const [answeredIds, setAnsweredIds] = useState<Set<string>>(new Set());
  const [luckyWinner, setLuckyWinner] = useState<LuckyWinner | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  // Realtime callbacks close over stale state; a ref keeps the latest
  // session visible to them without resubscribing on every change.
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

  async function checkLuckyWinner(questionIndex: number) {
    const { data } = await supabase
      .from("game_answers")
      .select("player_id")
      .eq("session_id", sessionId)
      .eq("question_index", questionIndex)
      .gt("lucky_bonus", 0)
      .maybeSingle();
    if (!data) {
      setLuckyWinner(null);
      return;
    }
    const player = players.find((p) => p.id === data.player_id);
    setLuckyWinner({ playerId: data.player_id, nickname: player?.nickname ?? "A player" });
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
      .channel(`host-game-${sessionId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "game_sessions", filter: `id=eq.${sessionId}` },
        (payload) => {
          const next = payload.new as GameSessionRow;
          const prev = sessionRef.current;
          setSession(next);
          if (
            !prev ||
            prev.status !== next.status ||
            prev.current_question_index !== next.current_question_index
          ) {
            setAnsweredIds(new Set());
            setLuckyWinner(null);
            if (next.status !== "lobby") refreshQuestion();
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "game_players", filter: `session_id=eq.${sessionId}` },
        () => refreshPlayers()
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "game_answers", filter: `session_id=eq.${sessionId}` },
        (payload) => {
          const row = payload.new as { player_id: string; question_index: number };
          if (row.question_index === sessionRef.current?.current_question_index) {
            setAnsweredIds((prev) => new Set(prev).add(row.player_id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    if (session?.status === "reveal") checkLuckyWinner(session.current_question_index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.status, session?.current_question_index]);

  useEffect(() => {
    if (session?.status !== "question" || !question) return;
    const startedMs = new Date(question.questionStartedAt).getTime();
    const id = setInterval(() => {
      const remainingMs = question.timeLimitSeconds * 1000 - (Date.now() - startedMs);
      setSecondsLeft(Math.max(0, Math.ceil(remainingMs / 1000)));
    }, 250);
    return () => clearInterval(id);
  }, [session?.status, question]);

  async function advance(action: "start" | "reveal" | "next") {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc("advance_game_session", {
      p_session_id: sessionId,
      p_action: action,
    });
    if (rpcError) setError(rpcError.message);
    setBusy(false);
  }

  if (!session) {
    return <p className="text-sm text-da-muted">Loading...</p>;
  }

  const leaderboard = [...players].sort((a, b) => b.total_score - a.total_score);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-da-border bg-da-surface/90 p-5 shadow-lg shadow-black/30 wood-surface">
        <div>
          <p className="text-xs font-semibold tracking-wide text-da-muted uppercase">
            {bankTitle}
          </p>
          <p className="font-mono text-3xl font-bold tracking-[0.3em] text-da-accent">
            {roomCode}
          </p>
        </div>
        <p className="text-sm text-da-muted">
          {players.length} player{players.length === 1 ? "" : "s"} joined
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-da-danger/40 bg-da-danger/10 px-3 py-2 text-xs text-da-danger">
          {error}
        </div>
      )}

      {session.status === "lobby" && (
        <div className="rounded-2xl border border-da-border bg-da-surface/90 p-5 shadow-lg shadow-black/30 wood-surface">
          <h2 className="font-serif text-xl font-bold text-da-text">
            Waiting for players to join...
          </h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {players.map((p) => (
              <span
                key={p.id}
                className="rounded-full border border-da-border bg-da-hover px-3 py-1 text-sm text-da-text"
              >
                {p.nickname}
              </span>
            ))}
          </div>
          <button
            type="button"
            className="da-btn mt-5"
            disabled={busy || players.length === 0}
            onClick={() => advance("start")}
          >
            Start Game
          </button>
        </div>
      )}

      {session.status === "question" && question && (
        <div className="rounded-2xl border border-da-border bg-da-surface/90 p-5 shadow-lg shadow-black/30 wood-surface">
          <div className="flex items-center justify-between text-xs font-semibold text-da-muted uppercase">
            <span>
              Question {question.questionIndex + 1} / {question.totalQuestions}
            </span>
            <span className={secondsLeft === 0 ? "text-da-danger" : "text-da-accent"}>
              {secondsLeft ?? question.timeLimitSeconds}s
            </span>
          </div>
          <div className="mt-3 text-center">
            <LatexRenderer latex={`$$${question.promptLatex}$$`} className="text-da-text" />
          </div>
          <p className="mt-2 text-center text-sm text-da-muted">{question.questionText}</p>
          <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {question.choices.map((c) => {
              const color = CHOICE_COLORS[c.index % CHOICE_COLORS.length];
              return (
                <div
                  key={c.index}
                  className={`rounded-lg border p-3 text-sm text-da-text ${color.bg} ${color.border}`}
                >
                  <span className={`mr-2 font-bold ${color.text}`}>{color.label}</span>
                  <LatexRenderer latex={c.text} className="inline" />
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-da-muted">
              {answeredIds.size} / {players.length} answered
            </p>
            <button type="button" className="da-btn" disabled={busy} onClick={() => advance("reveal")}>
              Reveal Answer
            </button>
          </div>
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
                    c.isCorrect ? "border-da-success ring-2 ring-da-success" : color.border
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
          {luckyWinner && (
            <p className="mt-3 text-sm font-semibold text-da-warning">
              Lightning Bonus! {luckyWinner.nickname} picked up a surprise +50.
            </p>
          )}

          <h3 className="mt-6 font-serif text-lg font-bold text-da-text">Leaderboard</h3>
          <ol className="mt-2 space-y-1">
            {leaderboard.slice(0, 5).map((p, i) => (
              <li key={p.id} className="flex items-center justify-between text-sm text-da-text">
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

          <button type="button" className="da-btn mt-5" disabled={busy} onClick={() => advance("next")}>
            {question.questionIndex + 1 >= question.totalQuestions
              ? "See Final Results"
              : "Next Question"}
          </button>
        </div>
      )}

      {session.status === "finished" && (
        <div className="rounded-2xl border border-da-border bg-da-surface/90 p-5 shadow-lg shadow-black/30 wood-surface">
          <h2 className="font-serif text-2xl font-bold text-da-text">Final Results</h2>
          <ol className="mt-4 space-y-2">
            {leaderboard.map((p, i) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded-lg border border-da-border bg-da-hover px-4 py-2 text-da-text"
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
