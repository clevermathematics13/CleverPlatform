"use client";

import { useState, useRef, useTransition } from "react";
import { updateNickname, updateInvitedNickname } from "./actions";

interface NicknameCellProps {
  profileId?: string | null;
  invitedId?: string | null;
  nickname: string | null;
}

export function NicknameCell({ profileId, invitedId, nickname }: NicknameCellProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(nickname ?? "");
  const [saved, setSaved] = useState(nickname);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();

  function startEditing() {
    setValue(saved ?? "");
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function submit() {
    const trimmed = value.trim();
    startTransition(async () => {
      const fd = new FormData();
      fd.append("nickname", trimmed);
      if (profileId) {
        fd.append("profile_id", profileId);
        await updateNickname(fd);
      } else if (invitedId) {
        fd.append("invited_id", invitedId);
        await updateInvitedNickname(fd);
      }
      setSaved(trimmed || null);
      setEditing(false);
    });
  }

  function cancel() {
    setValue(saved ?? "");
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") cancel();
          }}
          onBlur={submit}
          disabled={isPending}
          placeholder="Enter nickname"
          className="w-32 rounded border border-blue-300 px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={startEditing}
      title="Click to edit nickname"
      className="group flex items-center gap-1 text-left"
    >
      {saved ? (
        <span className="text-sm text-gray-700 group-hover:underline">{saved}</span>
      ) : (
        <span className="inline-flex items-center rounded-full bg-yellow-50 px-2 py-0.5 text-xs font-medium text-yellow-700 group-hover:bg-yellow-100">
          Not set
        </span>
      )}
      <svg
        className="h-3 w-3 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 11l6-6 3 3-6 6H9v-3z" />
      </svg>
    </button>
  );
}
