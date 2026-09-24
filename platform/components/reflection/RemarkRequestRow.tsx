"use client";

import { useState } from "react";
import type { ReflectionRemark } from "@/lib/reflection-types";
import { REMARK_TEXT_MAX, REMARK_TEXT_MIN, remarkOutcomeText } from "@/lib/remark-requests";

/**
 * How the re-mark row behaves in the table it sits in:
 *
 * - "interactive": the student's own Compare step -- they can ask, reword
 *   and withdraw.
 * - "preview": the teacher's ?viewAs= preview. It must show exactly what the
 *   student sees, so the button is there, but disabled.
 * - "readonly": everywhere else (the Upload step's table, the teacher's
 *   ?viewStudent= view) -- a request's status and answer, nothing to press.
 */
export type RemarkRowMode = "interactive" | "preview" | "readonly";

interface RemarkRequestRowProps {
  testItemId: string;
  remark: ReflectionRemark | null;
  /** remarkEligibility said "ok": this part may be asked about. */
  canAsk: boolean;
  mode: RemarkRowMode;
  /** False once corrections are uploaded: a waiting request then stays. */
  canWithdraw: boolean;
  /** The student's saved mark now equals the part's ClevMark. */
  savedMarkAgrees: boolean;
  onChange?: (testItemId: string, remark: ReflectionRemark | null) => void;
}

/**
 * One part's re-mark request on the comparison table: the button that
 * starts one, the form, and the request once sent -- waiting, or answered
 * with the teacher's note.
 *
 * Kept to the width the screen shows, like MarkSchemePart: the table is
 * wider than a phone and scrolls sideways inside its own box, and 5.5rem is
 * <main>'s p-8 on both sides plus the cell's px-3.
 */
export function RemarkRequestRow({
  testItemId,
  remark,
  canAsk,
  mode,
  canWithdraw,
  savedMarkAgrees,
  onChange,
}: RemarkRequestRowProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const interactive = mode === "interactive" && !!onChange;

  const send = async () => {
    if (draft === null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/remark-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ testItemId, explanation: draft }),
      });
      const data = (await res.json().catch(() => ({}))) as { remark?: ReflectionRemark; error?: string };
      if (!res.ok || !data.remark) throw new Error(data.error ?? "Your request could not be sent. Please try again.");
      onChange?.(testItemId, data.remark);
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Your request could not be sent. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    if (!confirm("Withdraw this re-mark request? This part will count towards your disagreement again.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/remark-requests", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ testItemId }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Your request could not be withdrawn. Please try again.");
      onChange?.(testItemId, null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Your request could not be withdrawn. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const box =
    "mt-1.5 max-w-[min(65ch,calc(100vw_-_5.5rem))] space-y-1.5 break-words rounded-md border px-2.5 py-2 text-sm leading-relaxed";

  // The form: a new request, or rewording one that waits.
  if (draft !== null) {
    const length = draft.trim().length;
    const tooShort = length < REMARK_TEXT_MIN;
    return (
      <div className={`${box} border-da-border/60 bg-da-bg/40`}>
        <label htmlFor={`remark-${testItemId}`} className="block text-[11px] font-bold uppercase tracking-wide text-da-amber">
          Why should this part be re-marked?
        </label>
        <textarea
          id={`remark-${testItemId}`}
          autoFocus
          rows={3}
          maxLength={REMARK_TEXT_MAX}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Say which marks you think you earned and where they are in your working. Use the mark scheme."
          className="w-full rounded border border-da-border bg-da-surface px-2 py-1.5 text-sm text-da-text focus:ring-1 focus:ring-da-accent"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy || tooShort}
            onClick={() => void send()}
            className="rounded bg-da-accent px-3 py-1 text-xs font-bold text-da-bg hover:bg-da-amber disabled:opacity-50"
          >
            {busy ? "Sending…" : remark ? "Save" : "Send to your teacher"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setDraft(null);
              setError(null);
            }}
            className="text-xs text-da-muted hover:underline"
          >
            Cancel
          </button>
          <span className="ml-auto text-[11px] text-da-muted">
            {tooShort ? `At least ${REMARK_TEXT_MIN} characters` : `${length} / ${REMARK_TEXT_MAX}`}
          </span>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    );
  }

  if (!remark) {
    if (!canAsk || mode === "readonly") return null;
    return (
      <div className="mt-1.5">
        <button
          type="button"
          disabled={!interactive}
          title={interactive ? undefined : "Only the student can send a re-mark request."}
          onClick={() => setDraft("")}
          className="text-xs text-da-muted hover:underline disabled:cursor-not-allowed disabled:no-underline disabled:opacity-60"
        >
          ✍️ Ask for a re-mark
        </button>
      </div>
    );
  }

  const pending = remark.status === "pending";
  const tone = pending
    ? "border-amber-400/40 bg-amber-500/10"
    : remark.status === "changed"
      ? "border-green-700/50 bg-green-900/15"
      : "border-da-border/60 bg-da-bg/40";

  return (
    <div className={`${box} ${tone}`}>
      <p className={`font-semibold ${pending ? "text-amber-200" : remark.status === "changed" ? "text-green-300" : "text-da-text"}`}>
        {pending ? "⏳ " : ""}
        {remarkOutcomeText(remark)}
      </p>
      <p className="whitespace-pre-wrap text-da-muted">
        <span className="mr-1 text-[11px] font-bold uppercase tracking-wide text-da-amber">You wrote</span>
        {remark.explanation}
      </p>
      {remark.teacher_note && (
        <p className="whitespace-pre-wrap text-da-text">
          <span className="mr-1 text-[11px] font-bold uppercase tracking-wide text-da-amber">Your teacher&apos;s note</span>
          {remark.teacher_note}
        </p>
      )}
      {pending && (
        <p className="text-xs text-da-muted">
          This part isn&apos;t counted in your disagreement while it waits.
          {savedMarkAgrees && canWithdraw ? " Your mark now matches ClevMarks, so you can withdraw it." : ""}
        </p>
      )}
      {!pending && remark.status === "stands" && !savedMarkAgrees && mode !== "readonly" && (
        <p className="text-xs text-da-muted">Change your Self mark to settle this part.</p>
      )}
      {pending && interactive && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => setDraft(remark.explanation)}
            className="text-xs text-da-accent hover:underline disabled:opacity-50"
          >
            Edit
          </button>
          {canWithdraw && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void withdraw()}
              className="text-xs text-da-muted hover:underline disabled:opacity-50"
            >
              {busy ? "Withdrawing…" : "Withdraw"}
            </button>
          )}
        </div>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
