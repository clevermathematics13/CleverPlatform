"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Bank {
  id: string;
  slug: string;
  title: string;
}

// Avoids visually ambiguous characters (0/O, 1/I) so a room code is easy to
// read off a projector and type on a phone.
const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomRoomCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

export function HostLobbyClient({ banks, hostId }: { banks: Bank[]; hostId: string }) {
  const router = useRouter();
  const [startingBankId, setStartingBankId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function hostGame(bankId: string) {
    setStartingBankId(bankId);
    setError(null);
    const supabase = createClient();

    for (let attempt = 0; attempt < 5; attempt++) {
      const { data, error: insertError } = await supabase
        .from("game_sessions")
        .insert({ bank_id: bankId, host_id: hostId, room_code: randomRoomCode() })
        .select("id")
        .single();

      if (!insertError && data) {
        router.push(`/dashboard/games/host/${data.id}`);
        return;
      }
      // Postgres unique_violation -- try a fresh room code.
      if (insertError?.code !== "23505") {
        setError(insertError?.message ?? "Could not start the game");
        setStartingBankId(null);
        return;
      }
    }
    setError("Could not find a free room code -- try again");
    setStartingBankId(null);
  }

  if (banks.length === 0) {
    return (
      <p className="rounded-xl border border-da-border bg-da-surface/90 p-5 text-sm text-da-muted">
        No question banks exist yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-lg border border-da-danger/40 bg-da-danger/10 px-3 py-2 text-xs text-da-danger">
          {error}
        </div>
      )}
      {banks.map((bank) => (
        <div
          key={bank.id}
          className="flex items-center justify-between rounded-2xl border border-da-border bg-da-surface/90 p-5 shadow-lg shadow-black/30 wood-surface"
        >
          <div>
            <p className="font-serif text-xl font-bold text-da-text">{bank.title}</p>
            <p className="text-xs text-da-muted">{bank.slug}</p>
          </div>
          <button
            type="button"
            className="da-btn"
            disabled={startingBankId !== null}
            onClick={() => hostGame(bank.id)}
          >
            {startingBankId === bank.id ? "Starting..." : "Host a game"}
          </button>
        </div>
      ))}
    </div>
  );
}
