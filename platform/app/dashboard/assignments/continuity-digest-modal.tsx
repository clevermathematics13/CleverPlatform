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
 * `whereItLeftOff` is auto-drafted with a mechanical summary (see
 * draftDigestFromDraft in lib/na-continuity.ts) rather than left blank, and
 * saving no longer BLOCKS on it (2026-08-19) — it previously had to be typed
 * from an empty box before a save was possible, which meant re-typing "what
 * this packet covered" from scratch every single time even though that half
 * of the field is mechanically knowable. What still cannot be inferred — what
 * the packet deliberately held BACK — stays an explicit bracketed prompt in
 * the auto-drafted text, and an unedited placeholder is a materially better
 * failure mode than a required field standing between the teacher and a save
 * they already decided to make.
 *
 * `vocabularyIntroduced` is similarly auto-drafted, but as a genuine DIFF
 * rather than a fixed list: draftDigestFromDraft() only pre-checks terms this
 * packet's questions tag that do not already appear anywhere in the course's
 * recorded continuity. Terms that DO already appear are shown too, unchecked,
 * so the teacher can see (and correct, if the auto-classification is wrong)
 * rather than have them silently vanish from view.
 *
 * BACKDROP OPACITY (2026-08-20): a teacher reported the whole panel
 * "impossible to read" — page content behind it (tab labels, other cards)
 * was bleeding straight through both the black scrim and the panel itself.
 * Root cause: dashboard-shell.tsx's decorative MandelbrotBg layer is
 * `position: absolute` inside a `min-h-screen` container, so it only covers
 * the first viewport of page height. This modal is `position: fixed`,
 * which is correct for a modal, but the teacher had scrolled well past that
 * first viewport to reach the Save button that opens it — so the area this
 * modal renders over was raw, un-backgrounded body content, and a 50%-alpha
 * black scrim over uncontrolled content is not reliably legible. A modal's
 * backdrop must not depend on what happens to be painted behind it at
 * whatever scroll position the page is in: the scrim is bumped to bg-black/80
 * (opaque enough to read through almost anything) and the panel itself now
 * pins an explicit solid background colour rather than the bg-da-bg utility
 * class alone, so both layers are correct regardless of scroll position or
 * what CSS custom properties happen to resolve to at runtime.
 */

import { useEffect, useState } from "react";
import type { PacketDigest, VocabularyCandidate } from "@/lib/na-continuity";

type Props = {
  open: boolean;
  /** Auto-drafted starting point from draftDigestFromDraft(). */
  initial: PacketDigest | null;
  /**
   * Every vocabulary term this packet's questions tagged, each already
   * classified against continuity history. `initial.vocabularyIntroduced`
   * is the pre-checked subset (alreadySeen === false); this is the full
   * candidate list, needed so the modal can also show — unchecked, for
   * awareness — the terms that were excluded because they already appeared
   * in an earlier packet.
   */
  vocabularyCandidates: VocabularyCandidate[];
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
  vocabularyCandidates,
  sectionCode,
  saving,
  error,
  onCancel,
  onConfirm,
}: Props) {
  const [digest, setDigest] = useState<PacketDigest | null>(initial);

  // Re-seed whenever a new draft is opened for confirmation. Without this the
  // modal would show the digest of whichever packet was confirmed first.
  useEffect(() => {
    setDigest(initial);
  }, [initial]);

  if (!open || !digest) return null;

  const set = <K extends keyof PacketDigest>(key: K, value: PacketDigest[K]) =>
    setDigest((d) => (d ? { ...d, [key]: value } : d));

  const checkedVocab = new Set(digest.vocabularyIntroduced.map((t) => t.trim().toLowerCase()));

  function toggleVocabTerm(term: string, checked: boolean) {
    const key = term.trim().toLowerCase();
    const current = digest?.vocabularyIntroduced ?? [];
    if (checked) {
      if (!current.some((t) => t.trim().toLowerCase() === key)) {
        set("vocabularyIntroduced", [...current, term]);
      }
    } else {
      set(
        "vocabularyIntroduced",
        current.filter((t) => t.trim().toLowerCase() !== key),
      );
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.8)" }}
    >
      <div
        className="my-8 w-full max-w-2xl rounded-xl border border-da-border shadow-xl"
        style={{ backgroundColor: "var(--color-da-bg)" }}
      >
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
            <span className="text-xs font-semibold text-da-text">Where it left off</span>
            <span className="text-[11px] text-da-muted">
              What this packet established — and just as importantly, what it deliberately did
              <em> not</em> do, so the next section isn&apos;t pre-empted. Auto-drafted below —
              edit freely.
            </span>
            <textarea
              rows={5}
              value={digest.whereItLeftOff}
              onChange={(e) => set("whereItLeftOff", e.target.value)}
              className="rounded-lg border border-da-border/60 bg-da-bg/30 px-2 py-1.5 text-xs text-da-text focus:border-da-accent focus:outline-none"
              placeholder="Ends having… Did NOT yet…"
            />
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-da-text">Vocabulary formally introduced</span>
            <span className="text-[11px] text-da-muted">
              Pre-checked terms are new to this course. Unchecked terms already appeared in an
              earlier packet — leave them unchecked unless this packet genuinely re-introduces
              the definition, not just the name.
            </span>
            {vocabularyCandidates.length === 0 ? (
              <p className="rounded-lg border border-da-border/40 bg-da-bg/20 px-2 py-1.5 text-[11px] text-da-muted">
                No tagged content/skill terms found on this packet&apos;s questions.
              </p>
            ) : (
              <div className="flex flex-col gap-1 rounded-lg border border-da-border/60 bg-da-bg/30 px-2 py-1.5">
                {vocabularyCandidates.map((c) => {
                  const key = c.term.trim().toLowerCase();
                  const checked = checkedVocab.has(key);
                  return (
                    <label key={c.term} className="flex items-start gap-2 text-xs text-da-text">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => toggleVocabTerm(c.term, e.target.checked)}
                        className="mt-0.5 rounded"
                      />
                      <span>
                        {c.term}
                        {c.alreadySeen && (
                          <span className="ml-1.5 text-[10px] text-da-muted">
                            (already introduced in {c.firstSeenIn})
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

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
            onClick={() => onConfirm(digest)}
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
