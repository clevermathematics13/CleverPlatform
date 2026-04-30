"use client";

import { useState, useRef, useTransition } from "react";
import { updateDisplayName, updateInvitedFullName } from "./actions";

interface NameCellProps {
  profileId?: string | null;
  invitedId?: string | null;
  name: string | null;
}

export function NameCell({ profileId, invitedId, name }: NameCellProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name ?? "");
  const [saved, setSaved] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();

  function startEditing() {
    setValue(saved ?? "");
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function submit() {
    const trimmed = value.trim();
    if (!trimmed) {
      cancel();
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      if (profileId) {
        fd.append("profile_id", profileId);
        fd.append("display_name", trimmed);
        await updateDisplayName(fd);
      } else if (invitedId) {
        fd.append("invited_id", invitedId);
        fd.append("full_name", trimmed);
        await updateInvitedFullName(fd);
      }
      setSaved(trimmed);
      setEditing(false);
    });
  }

  function cancel() {
    setValue(saved ?? "");
    setEditing(false);
  }

  if (editing) {
    return (
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
        placeholder="Enter name"
        className="w-40 rounded border border-blue-300 px-2 py-0.5 text-sm font-medium text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={startEditing}
      title="Click to edit name"
      className="group flex items-center gap-1 text-left"
    >
      <span className="text-sm font-medium text-gray-900 group-hover:underline">
        {saved ?? "Unknown"}
      </span>
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
