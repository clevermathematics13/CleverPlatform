"use client";

/**
 * The student's school-defined student number, editable in place.
 *
 * PowerTeacher Pro matches imported scores on this and nothing else, so a
 * missing one is not cosmetic: that student's row silently fails to import.
 * "Not set" is therefore styled as a warning rather than as absent data.
 */

import { useState, useRef, useTransition } from "react";
import { setStudentNumber, setInvitedStudentNumber } from "./actions";

export function StudentNumberCell({
  studentId,
  invitedId,
  studentNumber,
}: {
  studentId?: string | null;
  invitedId?: string | null;
  studentNumber: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(studentNumber ?? "");
  const [saved, setSaved] = useState(studentNumber);
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
      fd.append("student_number", trimmed);
      if (studentId) {
        fd.append("student_id", studentId);
        await setStudentNumber(fd);
      } else if (invitedId) {
        fd.append("invited_id", invitedId);
        await setInvitedStudentNumber(fd);
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
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") cancel();
        }}
        onBlur={submit}
        disabled={isPending}
        placeholder="e.g. 120451"
        className="w-28 rounded border border-blue-400/40 px-2 py-0.5 font-mono text-sm text-da-text focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={startEditing}
      title="Click to edit the PowerSchool student number"
      className="group flex items-center gap-1 text-left"
    >
      {saved ? (
        <span className="font-mono text-sm text-da-text group-hover:underline">{saved}</span>
      ) : (
        <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-300 group-hover:bg-amber-500/25">
          Not set
        </span>
      )}
    </button>
  );
}
