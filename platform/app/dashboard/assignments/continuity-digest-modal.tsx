"use client";

/**
 * ContinuityDigestModal
 * --------------------
 * Review-and-confirm step between generating a packet and saving it.
 *
 * The digest is what the NEXT packet's generation prompt reads. If it is wrong,
 * the error does not surface as an error — it surfaces months later as a
 * repeated TOK question or a re-taught definition in a printed packet a class
 * is already holding. So the digest is never written straight from the
 * generator: it is auto-drafted, shown here, and committed only once the
 * teacher has looked at it.
 *
 * One field is required. `whereItLeftOff` has to say where the packet ended AND
 * what it deliberately did not do, because "did not do" is the part that stops
 * the next packet from pre-empting a skill the sequence reserves for it. No
 * amount of parsing the draft JSON can infer that — it is a teaching decision.
 */

import { useEffect, useState } from "react";
import type { PacketDigest } from "@/lib/na-continuity";

type Props = {
  open: boolean;
  /** Auto-drafted starting point from draftDigestFromDraft(). */
  initial: PacketDigest | null;
  sectionCode: string;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (digest: PacketDigest) => void;
};

/** Textarea whose value is a newline-separated list. */
function ListField({
  label,
  hint,
  value,
  onChange,
  rows = 3,
}: {
  label: string;
  hint?: string;
  value: string[];
  onChange: (next: string[]) => void;
  rows?: number;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-da-text">{label}</span>
      {hint && <span className="text-[11px] text-da-muted">{hint}</span>}
      <textarea
        rows={rows}
        value={value.join("\n")}
        onChange={(e) =>
          onChange(
            e.target.value
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean),
          )
        }
        className="rounded-lg border border-da-border/60 bg-da-bg/30 px-2 py-1.5 text-xs text-da-text focus:border-da-accent focus:outline-none"
        placeholder="One per line"
      />
    </label>
  );
}

export function ContinuityDigestModal({
  open,
  initial,
  sectionCode,
  saving,
  error,
  onCancel,
  onConfirm,
}: Props) {
  const [digest, setDigest] = useState<PacketDigest | null>(initial);
  const [touched, setTouched] = useState(false);

  // Re-seed whenever a new draft is opened for confirmation. Without this the
  // modal would show the digest of whichever packet was confirmed first.
  useEffect(() => {
    setDigest(initial);
    setTouched(false);
  }, [initial]);

  if (!open || !digest) return null;

  const set = <K extends keyof PacketDigest>(key: K, value: PacketDigest[K]) =>
    setDigest((d) => (d ? { ...d, [key]: value } : d));

  const handoffMissing = !digest.whereItLeftOff.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className="my-8 w-full max-w-2xl rounded-xl border border-da-border bg-da-bg shadow-xl">
        <div className="border-b border-da-border px-5 py-3">
          <h2 className="text-sm font-semibold text-da-text">
            Confirm continuity record — {sectionCode}
          </h2>
          <p className="mt-1 text-xs text-da-muted">
            This is what the next packet&apos;s generator will read. Check it before saving.
          </p>
        </div>

        <div className="flex flex-col gap-4 px-5 py-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-da-text">
              Where it left off <span className="text-red-400">*</span>
            </span>
            <span className="text-[11px] text-da-muted">
              What this packet established — and just as importantly, what it deliberately did
              <em> not</em> do, so the next section isn&apos;t pre-empted.
            </span>
            <textarea
              rows={5}
              value={digest.whereItLeftOff}
              onChange={(e) => {
                setTouched(true);
                set("whereItLeftOff", e.target.value);
              }}
              className={`rounded-lg border bg-da-bg/30 px-2 py-1.5 text-xs text-da-text focus:outline-none ${
                touched && handoffMissing
                  ? "border-red-400 focus:border-red-400"
                  : "border-da-border/60 focus:border-da-accent"
              }`}
              placeholder="Ends having… Did NOT yet…"
            />
            {touched && handoffMissing && (
              <span className="text-[11px] text-red-400">
                Required — a blank handoff looks like continuity while conveying nothing.
              </span>
            )}
          </label>

          <ListField
            label="Vocabulary formally introduced"
            hint="Only terms this packet defined for the first time. Not the whole glossary."
            value={digest.vocabularyIntroduced}
            onChange={(v) => set("vocabularyIntroduced", v)}
          />

          <ListField
            label="Notation and conventions established"
            value={digest.notationConventions}
            onChange={(v) => set("notationConventions", v)}
            rows={4}
          />

          <ListField
            label="TOK provocations used"
            hint="These become off-limits for every later packet in this course."
            value={digest.tokProvocationsUsed}
            onChange={(v) => set("tokProvocationsUsed", v)}
          />

          <ListField
            label="Misconceptions planted"
            value={digest.misconceptionsPlanted}
            onChange={(v) => set("misconceptionsPlanted", v)}
          />

          <ListField
            label="Mathematicians credited"
            hint="Also off-limits later — repetition is the most common continuity failure."
            value={digest.internationalMindednessUsed}
            onChange={(v) => set("internationalMindednessUsed", v)}
          />

          <ListField
            label="Contexts and source problems now spent"
            hint="Scenarios a later packet must not reuse, even if the textbook prints them again."
            value={digest.contentSpent ?? []}
            onChange={(v) => set("contentSpent", v)}
          />

          {error && (
            <div className="rounded-lg border border-red-400/50 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-da-border px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-lg border border-da-border px-3 py-1.5 text-xs font-semibold text-da-muted transition-colors hover:bg-da-bg/60 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              setTouched(true);
              if (handoffMissing) return;
              onConfirm(digest);
            }}
            disabled={saving}
            className="rounded-lg border border-da-accent/70 bg-da-accent/20 px-3 py-1.5 text-xs font-semibold text-da-text transition-colors hover:bg-da-accent/30 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save packet & commit continuity"}
          </button>
        </div>
      </div>
    </div>
  );
}
