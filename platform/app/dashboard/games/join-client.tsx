"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function JoinGameClient() {
  const router = useRouter();
  const [roomCode, setRoomCode] = useState("");
  const [nickname, setNickname] = useState("");
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    if (!roomCode.trim()) return;
    setJoining(true);
    setError(null);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("join_game_session", {
      p_room_code: roomCode.trim(),
      p_nickname: nickname.trim(),
    });

    if (rpcError || !data) {
      setError(rpcError?.message ?? "Could not join the game");
      setJoining(false);
      return;
    }
    router.push(`/dashboard/games/play/${data.session_id}`);
  }

  return (
    <div className="rounded-2xl border border-da-border bg-da-surface/90 p-5 shadow-lg shadow-black/30 wood-surface">
      {error && (
        <div className="mb-3 rounded-lg border border-da-danger/40 bg-da-danger/10 px-3 py-2 text-xs text-da-danger">
          {error}
        </div>
      )}
      <label className="block text-xs font-semibold text-da-muted">Room code</label>
      <input
        value={roomCode}
        onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
        onKeyDown={(e) => e.key === "Enter" && join()}
        placeholder="ABC123"
        maxLength={6}
        className="mt-1 w-full rounded-lg border border-da-border bg-da-hover px-3 py-2 text-center font-mono text-2xl tracking-[0.3em] text-da-text uppercase outline-none focus:border-da-accent"
      />
      <label className="mt-4 block text-xs font-semibold text-da-muted">
        Nickname (optional)
      </label>
      <input
        value={nickname}
        onChange={(e) => setNickname(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && join()}
        placeholder="How you'll appear on the leaderboard"
        maxLength={40}
        className="mt-1 w-full rounded-lg border border-da-border bg-da-hover px-3 py-2 text-sm text-da-text outline-none focus:border-da-accent"
      />
      <button
        type="button"
        className="da-btn mt-4 w-full"
        disabled={joining || !roomCode.trim()}
        onClick={join}
      >
        {joining ? "Joining..." : "Join Game"}
      </button>
    </div>
  );
}
