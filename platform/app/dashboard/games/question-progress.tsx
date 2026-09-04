"use client";

import type { CSSProperties } from "react";

/**
 * One small critter per question. Questions still to come are awake and
 * dancing; a question dozes off the moment its answer is revealed, so the
 * row reads left to right as "how far through the game are we" without a
 * number in sight (the numbers are under each one anyway, for the literal-
 * minded). Both game screens show it.
 *
 * The critter is an original design in the punk-cute register the students
 * like -- a black hood with long floppy ears, pink inner ears and a pink star
 * on the brow, a mischievous fanged grin -- not a licensed character.
 *
 * Motion is CSS keyframes (globals.css, `.critter-*`) so the browser runs it
 * off the main thread, each critter offset by its index so the row dances as
 * a wave rather than in lockstep. prefers-reduced-motion stills all of it and
 * the two moods stay distinguishable by pose alone.
 */

export type CritterMood = "dancing" | "sleeping";

const INK = "#17121a";
const FACE = "#fbf3f5";
const PINK = "#f06aa0";
const BLUSH = "#f7a6c6";
// The hood is near-black on a near-black card, so every ink shape carries a
// thin pale outline; that edge is what makes the silhouette read at 64px.
const EDGE = { stroke: "#d9c9ce", strokeWidth: 1.3, strokeLinejoin: "round" as const };

export function Critter({
  mood,
  delaySeconds = 0,
  className,
}: {
  mood: CritterMood;
  delaySeconds?: number;
  className?: string;
}) {
  const sleeping = mood === "sleeping";
  const style = { "--critter-delay": `${delaySeconds}s` } as CSSProperties;
  return (
    <svg
      viewBox="0 0 64 64"
      className={`critter ${sleeping ? "critter-sleeping" : "critter-dancing"} ${className ?? ""}`}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      <g className="critter-figure">
        {/* Ears: long, hooded, pink inside. Awake they flick; asleep they droop. */}
        <g className="critter-ear critter-ear-l">
          <path d="M23 27 C 14 20, 9 9, 15 4 C 21 1, 26 12, 28 23 Z" fill={INK} {...EDGE} />
          <path d="M22 23 C 17 17, 14 11, 17 8 C 20 7, 23 14, 25 21 Z" fill={PINK} />
        </g>
        <g className="critter-ear critter-ear-r">
          <path d="M41 27 C 50 20, 55 9, 49 4 C 43 1, 38 12, 36 23 Z" fill={INK} {...EDGE} />
          <path d="M42 23 C 47 17, 50 11, 47 8 C 44 7, 41 14, 39 21 Z" fill={PINK} />
        </g>

        {/* Body, arms, feet */}
        <ellipse cx="32" cy="51" rx="10" ry="8" fill={INK} {...EDGE} />
        {sleeping ? (
          <>
            <path d="M24 50 L 20 56" stroke="#d9c9ce" strokeWidth="6.4" strokeLinecap="round" />
            <path d="M40 50 L 44 56" stroke="#d9c9ce" strokeWidth="6.4" strokeLinecap="round" />
            <path d="M24 50 L 20 56" stroke={INK} strokeWidth="4" strokeLinecap="round" />
            <path d="M40 50 L 44 56" stroke={INK} strokeWidth="4" strokeLinecap="round" />
          </>
        ) : (
          <>
            <g className="critter-arm critter-arm-l">
              <path d="M24 48 L 14 39" stroke="#d9c9ce" strokeWidth="6.4" strokeLinecap="round" />
              <path d="M24 48 L 14 39" stroke={INK} strokeWidth="4" strokeLinecap="round" />
            </g>
            <g className="critter-arm critter-arm-r">
              <path d="M40 48 L 50 39" stroke="#d9c9ce" strokeWidth="6.4" strokeLinecap="round" />
              <path d="M40 48 L 50 39" stroke={INK} strokeWidth="4" strokeLinecap="round" />
            </g>
          </>
        )}
        <ellipse cx="26" cy="59" rx="4.2" ry="2.6" fill={INK} {...EDGE} />
        <ellipse cx="38" cy="59" rx="4.2" ry="2.6" fill={INK} {...EDGE} />

        {/* Hood and face */}
        <ellipse cx="32" cy="34" rx="18" ry="15" fill={INK} {...EDGE} />
        <ellipse cx="32" cy="36.5" rx="12.5" ry="9.5" fill={FACE} />
        {/* Brow star */}
        <path
          d="M32 20.5 l1.5 3 3.3 .5 -2.4 2.3 .6 3.3 -3 -1.6 -3 1.6 .6 -3.3 -2.4 -2.3 3.3 -.5 Z"
          fill={PINK}
        />
        {/* Cheeks */}
        <circle cx="24.5" cy="39.5" r="2.1" fill={BLUSH} />
        <circle cx="39.5" cy="39.5" r="2.1" fill={BLUSH} />

        {sleeping ? (
          <>
            {/* Closed eyes, contented little smile */}
            <path d="M24.5 35.5 q2.5 2.4 5 0" stroke={INK} strokeWidth="1.6" strokeLinecap="round" fill="none" />
            <path d="M34.5 35.5 q2.5 2.4 5 0" stroke={INK} strokeWidth="1.6" strokeLinecap="round" fill="none" />
            <path d="M30 41.5 q2 1.6 4 0" stroke={INK} strokeWidth="1.4" strokeLinecap="round" fill="none" />
          </>
        ) : (
          <>
            {/* Wide eyes with a glint, open fanged grin */}
            <ellipse cx="27" cy="35.5" rx="2.5" ry="3.2" fill={INK} />
            <ellipse cx="37" cy="35.5" rx="2.5" ry="3.2" fill={INK} />
            <circle cx="27.9" cy="34.3" r="0.9" fill="#fff" />
            <circle cx="37.9" cy="34.3" r="0.9" fill="#fff" />
            <path d="M27.5 40.5 q4.5 5 9 0 Z" fill={INK} />
            <path d="M33.5 40.6 l1.6 0 -0.8 2 Z" fill="#fff" />
          </>
        )}
      </g>

      {sleeping && (
        <g className="critter-zs" fill={PINK} fontFamily="ui-sans-serif, sans-serif" fontWeight="700">
          <text className="critter-z critter-z-1" x="45" y="25" fontSize="7">z</text>
          <text className="critter-z critter-z-2" x="50" y="19" fontSize="8.5">z</text>
          <text className="critter-z critter-z-3" x="55" y="13" fontSize="10">Z</text>
        </g>
      )}
    </svg>
  );
}

export function QuestionProgress({ total, completed }: { total: number; completed: number }) {
  if (total <= 0) return null;
  const done = Math.max(0, Math.min(total, completed));
  return (
    <div
      role="img"
      aria-label={`${done} of ${total} questions done`}
      className="flex flex-wrap items-end justify-center gap-x-1.5 gap-y-2"
    >
      {Array.from({ length: total }, (_, i) => (
        <div key={i} className="flex flex-col items-center">
          <Critter
            mood={i < done ? "sleeping" : "dancing"}
            delaySeconds={(i % 8) * 0.11}
            className="h-16 w-16 sm:h-[4.5rem] sm:w-[4.5rem]"
          />
          <span className="mt-1 text-[11px] leading-none tabular-nums text-da-muted">{i + 1}</span>
        </div>
      ))}
    </div>
  );
}
