"use client";

/**
 * The answers-only view of a marked packet: what the answer was, in a hand,
 * and nothing about how it was marked.
 *
 * Written on paper rather than on the dark page. A joined script face needs
 * contrast and space to stay legible, and ink on paper is also the honest
 * metaphor -- this is the sheet a teacher would hand back beside the packet.
 * The .answer-sheet class in app/globals.css carries the KaTeX colour for that
 * surface, alongside the app's other light-surface overrides.
 *
 * Long answers are clamped to three lines with a control to open them, never
 * trimmed. Half of A.1's entries are a paragraph, because that packet's
 * answers were authored as notes to the marker; where the answer really is one
 * line ("(a) 420 (b) 330 (c) 750 (d) 750") the list is scannable, and where it
 * is not, a student can still read the whole thing. Guessing at a shorter
 * version of someone's answer is the one thing this view must not do.
 */

import { useState } from "react";
import type { StudentAnswerLine } from "@/lib/na-answer-service";

/** Longer than this and the answer opens clamped. Set from the live data:
 *  the crisp entries run to about 70 characters and the authored-as-prose
 *  ones to several hundred, with very little in between. */
const CLAMP_OVER = 150;

export function AnswersView({
  lines,
  packetTitle,
}: {
  lines: StudentAnswerLine[];
  packetTitle: string;
}) {
  const [opened, setOpened] = useState<Set<string>>(new Set());

  const toggle = (label: string) =>
    setOpened((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  // A box with no answer and no marks is thinking space -- A.1's Desmos
  // sandbox -- and listing it as an answer that is missing says the wrong
  // thing. A box with marks and no answer is a real question whose answer is
  // the student's own, and has to be accounted for or the list looks short.
  const shown = lines.filter((l) => l.answerHtml !== null || (l.marks ?? 0) > 0);

  return (
    <div className="answer-sheet rounded-xl px-5 py-4 sm:px-7 sm:py-6">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#8a6b4a]">Answers</p>
      <h2 className="font-hand mb-4 text-[#1f2a44]" style={{ fontSize: "1.75rem" }}>
        {packetTitle}
      </h2>

      {/* The right-hand column is a bare number without this. On a marking
          key that convention is obvious; to a student checking their own work
          it is not, and an unlabelled figure sitting beside an answer is the
          one thing on this page that could be mistaken for part of it. */}
      <div className="flex justify-end border-b border-[#d9cdb8] pb-1 text-[11px] font-semibold uppercase tracking-wide text-[#8a6b4a]">
        Marks
      </div>

      <dl className="divide-y divide-[#d9cdb8]">
        {shown.map((line) => {
          const long = line.answerChars > CLAMP_OVER;
          const isOpen = opened.has(line.label);
          return (
            <div key={line.label} className="flex gap-3 py-2.5 sm:gap-4">
              <dt className="w-20 shrink-0 pt-1 text-sm font-semibold text-[#6b5844] sm:w-28">
                {line.label}
              </dt>
              <dd className="min-w-0 flex-1">
                {line.answerHtml === null ? (
                  <p className="pt-1 text-sm italic text-[#7a6a55]">
                    Your own answer — there is no single right one. The detailed view has your
                    feedback on it.
                  </p>
                ) : (
                  <>
                    <div
                      className="font-hand text-[#1d3a6b]"
                      style={
                        long && !isOpen
                          ? {
                              display: "-webkit-box",
                              WebkitLineClamp: 3,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                            }
                          : undefined
                      }
                      // Safe by construction: lib/rubric-latex escapes all prose
                      // and only ever emits KaTeX's own markup unescaped.
                      dangerouslySetInnerHTML={{ __html: line.answerHtml }}
                    />
                    {long && (
                      <button
                        type="button"
                        onClick={() => toggle(line.label)}
                        className="mt-0.5 text-xs font-semibold text-[#8a3a52] hover:underline"
                      >
                        {isOpen ? "Show less" : "Show all"}
                      </button>
                    )}
                  </>
                )}
              </dd>
              {line.marks ? (
                <span className="shrink-0 pt-1 text-xs text-[#9a8a76]" title={`${line.marks} Clev's Marks`}>
                  {line.marks}
                </span>
              ) : null}
            </div>
          );
        })}
      </dl>

      {shown.length === 0 && (
        <p className="text-sm text-[#7a6a55]">
          No answers have been written up for this packet yet.
        </p>
      )}
    </div>
  );
}
