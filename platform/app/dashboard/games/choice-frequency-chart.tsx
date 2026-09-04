"use client";

import { CHOICE_COLORS, type ActiveQuestionChoice } from "@/lib/game-types";
import type { ChoiceFrequency } from "@/lib/game-summary";

// Literal class strings, one per choice, so Tailwind sees and emits them.
// (Deriving them from CHOICE_COLORS at runtime would leave them unbuilt.)
const BAR_FILL = ["bg-da-danger/70", "bg-da-info/70", "bg-da-success/70", "bg-da-warning/70"] as const;

/**
 * How the room answered: one horizontal bar per choice, longest first by
 * position (they stay in A-D order so the bars line up with the choice
 * cards above), plus a muted row for players who never answered.
 *
 * Each bar wears the colour its choice card already wears on every screen
 * -- that colour IS the choice's identity in this game, so re-using it here
 * is what lets the teacher glance from card to bar. Identity is never colour
 * alone: every bar carries its letter, and the correct one is marked with a
 * ring and the word, the way the correct card is. Values sit in text ink,
 * not in the bar colour, and the bar is a share of PLAYERS so the rows plus
 * "no answer" account for everyone in the room.
 */
export function ChoiceFrequencyChart({
  choices,
  frequency,
}: {
  choices: ActiveQuestionChoice[];
  frequency: ChoiceFrequency;
}) {
  const max = Math.max(1, ...frequency.choices.map((c) => c.count), frequency.noAnswer);
  const noAnswerPct = frequency.players > 0 ? Math.round((frequency.noAnswer / frequency.players) * 100) : 0;

  return (
    <figure aria-label="How the class answered">
      <figcaption className="flex items-baseline justify-between">
        <span className="font-serif text-lg font-bold text-da-text">How the class answered</span>
        <span className="text-xs text-da-muted">
          {frequency.answered} of {frequency.players} answered
        </span>
      </figcaption>

      <ol className="mt-3 space-y-2">
        {frequency.choices.map((tally) => {
          const choice = choices[tally.index];
          const color = CHOICE_COLORS[tally.index % CHOICE_COLORS.length];
          const isCorrect = !!choice?.isCorrect;
          const width = `${(tally.count / max) * 100}%`;
          return (
            <li
              key={tally.index}
              className="grid grid-cols-[2rem_1fr_5.5rem] items-center gap-3"
              title={`${color.label}: ${tally.count} player${tally.count === 1 ? "" : "s"} (${tally.pct}%)`}
            >
              <span className={`text-center font-bold ${color.text}`}>{color.label}</span>
              <div className="h-7 rounded bg-da-hover">
                <div
                  className={`h-full rounded transition-[width] duration-500 ease-out ${BAR_FILL[tally.index % BAR_FILL.length]} ${
                    isCorrect ? "ring-2 ring-da-success ring-offset-2 ring-offset-da-surface" : ""
                  }`}
                  style={{ width: tally.count > 0 ? width : "0.25rem", minWidth: "0.25rem" }}
                />
              </div>
              <span className="text-right text-sm tabular-nums text-da-text">
                {tally.count}
                <span className="ml-1 text-xs text-da-muted">{tally.pct}%</span>
                {isCorrect && (
                  <span className="ml-1.5 text-xs font-semibold text-da-success" aria-label="correct answer">
                    ✓
                  </span>
                )}
              </span>
            </li>
          );
        })}

        {frequency.noAnswer > 0 && (
          <li
            className="grid grid-cols-[2rem_1fr_5.5rem] items-center gap-3"
            title={`No answer: ${frequency.noAnswer} player${frequency.noAnswer === 1 ? "" : "s"} (${noAnswerPct}%)`}
          >
            <span className="text-center text-xs text-da-muted">–</span>
            <div className="h-7 rounded bg-da-hover">
              <div
                className="h-full rounded border border-dashed border-da-border bg-da-surface"
                style={{ width: `${(frequency.noAnswer / max) * 100}%`, minWidth: "0.25rem" }}
              />
            </div>
            <span className="text-right text-sm tabular-nums text-da-muted">
              {frequency.noAnswer}
              <span className="ml-1 text-xs">no answer</span>
            </span>
          </li>
        )}
      </ol>
    </figure>
  );
}
