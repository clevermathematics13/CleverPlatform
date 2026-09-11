"use client";

/**
 * The answer boxes under one practice question.
 *
 * One box per part, because the question states its tariff per part. Where the
 * question has no parts -- and every scanned bank question does not -- there is
 * a single box. answerSlots() makes that decision; this file only draws it.
 *
 * Saving is per box and debounced. A student working through algebra generates
 * a keystroke every few hundred milliseconds and each one changes the LaTeX, so
 * saving on change would be a request per character. The trade is that the last
 * few seconds of typing are unsaved, which is why the box also flushes on blur.
 *
 * The palette is mounted only under the box that has focus. Mounting one under
 * all twenty-six would render a hundred KaTeX previews twenty-six times over,
 * and give the student a wall of buttons belonging to boxes they are not in.
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MathfieldElement } from "mathlive";
import NotationPalette from "@/components/math/NotationPalette";
import { ANSWER_EVENT, isAnswered, type AnswerEventDetail } from "@/lib/practice-answers";

// MathLive touches `window` at import time, so it can never be part of the
// server render.
const MathAnswerField = dynamic(() => import("@/components/math/MathAnswerField"), {
  ssr: false,
  loading: () => (
    <div className="h-11 animate-pulse rounded-md border border-da-border bg-da-bg/60" />
  ),
});

const SAVE_DEBOUNCE_MS = 900;

type SaveState = "idle" | "saving" | "saved" | "error";

export interface AnswerSlotState {
  partLabel: string;
  answerLatex: string;
}

/**
 * Who is at the keyboard, and what that means for this box.
 *
 *   "answer"   the student whose page this is: types, and every change saves.
 *   "readonly" a teacher previewing a student with ?viewAs=: reads their work
 *              and cannot alter it. The RLS says the same -- teachers have
 *              SELECT on practice_answers and no write policy at all -- so
 *              this is the honest presentation of a real boundary, not a
 *              disabled button hiding a request that would fail anyway.
 *   "demo"     a teacher browsing the set as themselves: the editor works so
 *              they can see exactly what they are handing a class, and
 *              nothing is written, because these answers belong to nobody.
 */
export type AnswerMode = "answer" | "readonly" | "demo";

function SaveBadge({ state, answered }: { state: SaveState; answered: boolean }) {
  if (state === "saving") return <span className="text-da-muted">Saving&hellip;</span>;
  if (state === "error")
    return <span className="text-da-danger">Not saved &mdash; check your connection</span>;
  if (state === "saved") return <span className="text-da-success">Saved</span>;
  return answered ? (
    <span className="text-da-success">Answered</span>
  ) : (
    <span className="text-da-warning">Not answered yet</span>
  );
}

function AnswerBox({
  itemId,
  position,
  partLabel,
  initialLatex,
  mode,
}: {
  itemId: string;
  position: number;
  partLabel: string;
  initialLatex: string;
  mode: AnswerMode;
}) {
  const readOnly = mode === "readonly";
  const persists = mode === "answer";
  const [latex, setLatex] = useState(initialLatex);
  const [state, setState] = useState<SaveState>("idle");
  const [focused, setFocused] = useState(false);
  const fieldRef = useRef<MathfieldElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // What the server is known to hold, so a blur with nothing new does not
  // fire a request and a failed save is retried by the next edit.
  const savedLatex = useRef(initialLatex);

  const save = useCallback(
    async (next: string) => {
      if (!persists || next === savedLatex.current) return;
      setState("saving");
      try {
        const res = await fetch("/api/practice-answers", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ itemId, partLabel, answerLatex: next }),
        });
        if (!res.ok) throw new Error(await res.text());
        savedLatex.current = next;
        setState("saved");
      } catch {
        setState("error");
      }
    },
    [itemId, partLabel, persists]
  );

  const handleChange = useCallback(
    (next: string) => {
      setLatex(next);
      // A window event rather than a callback prop: the page that owns the
      // progress line is a server component and cannot hand one down.
      const detail: AnswerEventDetail = {
        key: `${itemId}::${partLabel}`,
        answered: isAnswered(next),
      };
      window.dispatchEvent(new CustomEvent(ANSWER_EVENT, { detail }));
      if (!persists) return;
      setState("idle");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(next), SAVE_DEBOUNCE_MS);
    },
    [itemId, partLabel, persists, save]
  );

  // insert() and the unmount flush are created once but must reach the
  // CURRENT handler and text, so both go through a ref that is refreshed on
  // every render.
  const latest = useRef({ handleChange, save, latex });
  useEffect(() => {
    latest.current = { handleChange, save, latex };
  });

  // A student who closes the tab or follows a link mid-debounce would
  // otherwise lose the last second of typing. Blur usually fires first, but
  // "usually" is not a guarantee a route change makes.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      void latest.current.save(latest.current.latex);
    };
  }, []);

  const handleBlur = useCallback(() => {
    setFocused(false);
    if (timer.current) clearTimeout(timer.current);
    void save(latex);
  }, [latex, save]);

  const insert = useCallback((snippet: string) => {
    const mf = fieldRef.current;
    if (!mf) return;
    mf.insert(snippet, { focus: true, selectionMode: "placeholder" });
    // MathLive raises "input" for typing, but not reliably for a programmatic
    // insert, so the change is pushed through by hand.
    latest.current.handleChange(mf.value);
  }, []);

  return (
    <div className="rounded-lg border border-da-border/70 bg-da-bg/40 p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="font-mono text-xs tracking-wide text-da-muted">
          {partLabel ? `Your answer to ${partLabel}` : "Your answer"}
        </span>
        <span className="font-mono text-[11px]">
          {persists ? (
            <SaveBadge state={state} answered={isAnswered(latex)} />
          ) : (
            <span className="text-da-muted/70">{readOnly ? "Student's work" : "Not saved"}</span>
          )}
        </span>
      </div>

      <MathAnswerField
        value={latex}
        onChange={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={handleBlur}
        onReady={(mf) => {
          fieldRef.current = mf;
        }}
        readOnly={readOnly}
        ariaLabel={
          partLabel
            ? `Answer to question ${position} part ${partLabel}`
            : `Answer to question ${position}`
        }
      />

      {focused && !readOnly && <NotationPalette onInsert={insert} />}
    </div>
  );
}

export default function AnswerEditor({
  itemId,
  position,
  slots,
  mode,
}: {
  itemId: string;
  position: number;
  slots: AnswerSlotState[];
  mode: AnswerMode;
}) {
  return (
    <div className="mt-4 space-y-3">
      {mode === "readonly" && (
        <p className="rounded-md border border-da-info/40 bg-da-info/10 px-3 py-2 text-xs text-da-text">
          This is the student&rsquo;s own work. A preview can read it and cannot change it.
        </p>
      )}
      {mode === "demo" && (
        <p className="rounded-md border border-da-border bg-da-bg/60 px-3 py-2 text-xs text-da-muted">
          The answer editor your class will see. Type in it to try the notation &mdash; nothing
          here is saved.
        </p>
      )}
      {slots.map((slot) => (
        <AnswerBox
          key={slot.partLabel}
          itemId={itemId}
          position={position}
          partLabel={slot.partLabel}
          initialLatex={slot.answerLatex}
          mode={mode}
        />
      ))}
    </div>
  );
}
