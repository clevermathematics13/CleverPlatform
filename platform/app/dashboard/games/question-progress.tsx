"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * One critter per question. Questions still to come are awake and dancing,
 * each to a different dance; a question dozes off the moment its answer is
 * revealed, so the row reads left to right as "how far through the game are
 * we". Numbers sit under each one. Both game screens show it.
 *
 * The critter is an original design in the punk-cute register the students
 * like -- a black hood with long pink-lined ears and a pink star on the brow,
 * a white face and belly, a curly tail, a mischievous fanged grin -- not a
 * licensed character. The figure is split into parts (legs, body, each arm,
 * head) so a dance can move them independently: headbanging throws the head,
 * disco points an arm, cumbia swishes a skirt.
 *
 * Each dance is a CSS class (`critter-dance-<name>`, keyframes in
 * globals.css) and comes with a prop that says which dance it is at a
 * glance: a rose for salsa, maracas for merengue, a floating heart for
 * bachata, a skirt for cumbia, a sideways cap for hip-hop, a striped beanie
 * for reggae, a studded collar for headbanging, sunglasses for disco,
 * glowsticks and headphones for trance, a polka-dot bandana for the twist.
 * Dances are dealt round the row in order and repeat past ten.
 * prefers-reduced-motion stills everything; the poses and props still tell
 * the dances and the two moods apart.
 */

export type CritterMood = "dancing" | "sleeping";

export const DANCES = [
  "salsa",
  "merengue",
  "bachata",
  "cumbia",
  "hip-hop",
  "reggae",
  "headbanging",
  "disco",
  "trance",
  "twist",
] as const;
export type Dance = (typeof DANCES)[number];

const INK = "#17121a";
const FACE = "#fbf3f5";
const PINK = "#f06aa0";
const PINK_DEEP = "#c8447d";
const BLUSH = "#f7a6c6";
const EDGE_COLOR = "#d9c9ce";
// The hood is near-black on a near-black card, so every ink shape carries a
// thin pale outline; that edge is what makes the silhouette read at 64px.
const EDGE = { stroke: EDGE_COLOR, strokeWidth: 1.3, strokeLinejoin: "round" as const };

/** A stroke drawn twice: pale halo underneath, ink on top. */
function Limb({ d, width = 4 }: { d: string; width?: number }) {
  return (
    <>
      <path d={d} stroke={EDGE_COLOR} strokeWidth={width + 2.4} strokeLinecap="round" fill="none" />
      <path d={d} stroke={INK} strokeWidth={width} strokeLinecap="round" fill="none" />
    </>
  );
}

function Hand({ cx, cy }: { cx: number; cy: number }) {
  return <circle cx={cx} cy={cy} r="2.7" fill={INK} {...EDGE} />;
}

// ---- Props, one per dance ----------------------------------------------------

function Rose({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M0 3 L0 9" stroke="#3f8f4f" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M0 6 l-2.4 -1.6" stroke="#3f8f4f" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="0" cy="1.5" r="3" fill="#d8264a" />
      <circle cx="-0.8" cy="0.8" r="1.5" fill="#f06a86" />
      <circle cx="0.9" cy="1.9" r="0.9" fill="#a3122f" />
    </g>
  );
}

function Maraca({ x, y, flip = false }: { x: number; y: number; flip?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -1 : 1} 1)`}>
      <path d="M0 0 L3 -6" stroke="#8a5a2b" strokeWidth="1.6" strokeLinecap="round" />
      <ellipse cx="4.6" cy="-9.2" rx="3.2" ry="3.8" transform="rotate(-25 4.6 -9.2)" fill="#f2b84b" stroke="#8a5a2b" strokeWidth="0.8" />
      <circle cx="4" cy="-10" r="0.7" fill="#d8264a" />
      <circle cx="5.6" cy="-8.2" r="0.7" fill="#3f8f4f" />
    </g>
  );
}

/** The position lives on a wrapper group so a CSS animation on the path's
 *  own transform (the floating heart) cannot displace it. */
function Heart({ x, y, size = 1, floating = false }: { x: number; y: number; size?: number; floating?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${size})`}>
      <path
        className={floating ? "critter-float" : undefined}
        d="M0 3 C -4 0, -3 -4, 0 -2 C 3 -4, 4 0, 0 3 Z"
        fill={PINK}
        stroke={PINK_DEEP}
        strokeWidth="0.6"
      />
    </g>
  );
}

function Skirt() {
  return (
    <g className="critter-skirt">
      <path
        d="M22 50 C 20 56, 18 60, 17 62 Q 32 66 47 62 C 46 60, 44 56, 42 50 Z"
        fill={PINK}
        stroke={PINK_DEEP}
        strokeWidth="0.9"
        strokeLinejoin="round"
      />
      <path d="M20 58 q3 2 6 0 t6 0 t6 0 t6 0" stroke="#ffd3e4" strokeWidth="0.9" fill="none" />
    </g>
  );
}

function Cap() {
  return (
    <g>
      <path d="M17 24 C 17 15, 47 15, 47 24 Q 32 21 17 24 Z" fill={PINK_DEEP} stroke={EDGE_COLOR} strokeWidth="1" />
      <path d="M44 23 L 58 21 Q 58 24.5 45 26 Z" fill={PINK_DEEP} stroke={EDGE_COLOR} strokeWidth="1" />
      <circle cx="32" cy="16.5" r="1.4" fill={PINK} />
    </g>
  );
}

function Beanie() {
  return (
    <g>
      <path d="M15 27 C 15 12, 49 12, 49 27 Z" fill="#c8102e" stroke={EDGE_COLOR} strokeWidth="1" />
      <path d="M16.2 22 C 18 15.5, 46 15.5, 47.8 22 Z" fill="#f2c40f" />
      <path d="M18.6 18 C 22 13.5, 42 13.5, 45.4 18 Z" fill="#1a9b3b" />
      <path d="M15 26 h34" stroke="#17121a" strokeWidth="2.2" strokeLinecap="round" />
    </g>
  );
}

function Collar() {
  return (
    <g>
      <path d="M22 47 q10 4 20 0" stroke={INK} strokeWidth="3.2" strokeLinecap="round" fill="none" />
      <circle cx="26" cy="48.3" r="1" fill="#d9d9de" />
      <circle cx="32" cy="49.2" r="1" fill="#d9d9de" />
      <circle cx="38" cy="48.3" r="1" fill="#d9d9de" />
    </g>
  );
}

function Sunglasses() {
  return (
    <g>
      <rect x="21.5" y="32.5" width="9" height="6" rx="2" fill={INK} />
      <rect x="33.5" y="32.5" width="9" height="6" rx="2" fill={INK} />
      <path d="M30.5 35 h3 M21.5 34 l-3 -1 M42.5 34 l3 -1" stroke={INK} strokeWidth="1.2" strokeLinecap="round" />
      <path d="M23.5 34 l2 -0.6 M35.5 34 l2 -0.6" stroke="#fff" strokeWidth="0.9" strokeLinecap="round" opacity="0.8" />
    </g>
  );
}

function Headphones() {
  return (
    <g>
      <path d="M16 30 C 14 14, 50 14, 48 30" stroke="#3b3542" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <rect x="12.5" y="27" width="6" height="9" rx="2.5" fill="#3b3542" stroke={EDGE_COLOR} strokeWidth="0.9" />
      <rect x="45.5" y="27" width="6" height="9" rx="2.5" fill="#3b3542" stroke={EDGE_COLOR} strokeWidth="0.9" />
      <rect x="14" y="29" width="3" height="5" rx="1.2" fill="#23b7d9" />
      <rect x="47" y="29" width="3" height="5" rx="1.2" fill="#23b7d9" />
    </g>
  );
}

function Glowstick({ x, y, color, rotate }: { x: number; y: number; color: string; rotate: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate})`} className="critter-glow">
      <path d="M0 0 L0 -9" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
      <path d="M0 0 L0 -9" stroke="#fff" strokeWidth="0.8" strokeLinecap="round" opacity="0.7" />
    </g>
  );
}

function Bandana() {
  return (
    <g>
      <path d="M15.5 25 C 18 18, 46 18, 48.5 25 Q 32 28 15.5 25 Z" fill="#d8264a" stroke={EDGE_COLOR} strokeWidth="1" />
      <path d="M47 24 l6 -3 l-2 5 Z" fill="#d8264a" stroke={EDGE_COLOR} strokeWidth="0.8" />
      <circle cx="24" cy="22.5" r="1" fill="#fff" />
      <circle cx="31" cy="21" r="1" fill="#fff" />
      <circle cx="38" cy="21.6" r="1" fill="#fff" />
      <circle cx="44" cy="23.4" r="1" fill="#fff" />
    </g>
  );
}

function Nightcap() {
  return (
    <g>
      <path d="M15 25 C 20 14, 42 12, 52 6 C 50 14, 48 20, 49 26 Q 32 22 15 25 Z" fill={PINK} stroke={PINK_DEEP} strokeWidth="0.9" strokeLinejoin="round" />
      <path d="M15.5 25.5 Q 32 21.5 48.5 25.5" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <circle cx="53" cy="5.5" r="2.6" fill="#fff" stroke={PINK_DEEP} strokeWidth="0.7" />
    </g>
  );
}

// ---- Per-dance pose: where the arms rest before the animation moves them ---
// Angles are degrees about the shoulder, 0 = the default up-and-out pose,
// positive swings the arm down toward the hip.

const ARM_REST: Record<Dance, { l: number; r: number }> = {
  salsa: { l: 20, r: -10 },
  merengue: { l: 30, r: 30 },
  bachata: { l: 55, r: 45 },
  cumbia: { l: 70, r: 70 },
  "hip-hop": { l: 75, r: 10 },
  reggae: { l: 60, r: 60 },
  headbanging: { l: -15, r: -15 },
  disco: { l: 80, r: -25 },
  trance: { l: -14, r: -14 },
  twist: { l: 40, r: 40 },
};

const DANCE_LABEL: Record<Dance, string> = {
  salsa: "dancing salsa",
  merengue: "dancing merengue",
  bachata: "dancing bachata",
  cumbia: "dancing cumbia",
  "hip-hop": "dancing hip-hop",
  reggae: "skanking to reggae",
  headbanging: "headbanging",
  disco: "dancing disco",
  trance: "raving to trance",
  twist: "doing the twist",
};

function propsFor(dance: Dance): { head?: ReactNode; body?: ReactNode; handL?: ReactNode; handR?: ReactNode; float?: ReactNode } {
  switch (dance) {
    case "salsa":
      return { handR: <Rose x={0} y={-7} /> };
    case "merengue":
      return { handL: <Maraca x={0} y={0} flip />, handR: <Maraca x={0} y={0} /> };
    case "bachata":
      return { float: <Heart x={48} y={14} size={1.3} floating /> };
    case "cumbia":
      return { body: <Skirt /> };
    case "hip-hop":
      return { head: <Cap /> };
    case "reggae":
      return { head: <Beanie /> };
    case "headbanging":
      return { body: <Collar /> };
    case "disco":
      return { head: <Sunglasses /> };
    case "trance":
      return {
        head: <Headphones />,
        handL: <Glowstick x={0} y={0} color="#4df3a3" rotate={-30} />,
        handR: <Glowstick x={0} y={0} color="#23d3f0" rotate={30} />,
      };
    case "twist":
      return { head: <Bandana /> };
  }
}

export function Critter({
  mood,
  dance = "salsa",
  delaySeconds = 0,
  className,
}: {
  mood: CritterMood;
  dance?: Dance;
  delaySeconds?: number;
  className?: string;
}) {
  const sleeping = mood === "sleeping";
  const rest = ARM_REST[dance];
  const style = {
    "--critter-delay": `${delaySeconds}s`,
    // In SVG screen coordinates a positive rotation is clockwise, which
    // lowers the right arm but raises the left, hence the sign flip on l.
    "--arm-l-rest": `${-rest.l}deg`,
    "--arm-r-rest": `${rest.r}deg`,
  } as CSSProperties;
  const extras = sleeping ? {} : propsFor(dance);

  return (
    <svg
      viewBox="0 0 64 64"
      className={`critter ${sleeping ? "critter-sleeping" : `critter-dancing critter-dance-${dance}`} ${className ?? ""}`}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      <g className="critter-figure">
        {/* Feet, with a toe notch each */}
        <g className="critter-legs">
          <ellipse cx="26" cy="59.5" rx="4.6" ry="2.7" fill={INK} {...EDGE} />
          <ellipse cx="38" cy="59.5" rx="4.6" ry="2.7" fill={INK} {...EDGE} />
          <path d="M23.5 58.3 v2 M36 58.3 v2" stroke={EDGE_COLOR} strokeWidth="0.7" />
        </g>

        {/* Tail: a curl off the hip with a pink tip */}
        <path d="M41 52 c 6 0, 8 -4, 6 -8" stroke={INK} strokeWidth="2.6" strokeLinecap="round" fill="none" />
        <path d="M41 52 c 6 0, 8 -4, 6 -8" stroke={EDGE_COLOR} strokeWidth="0.7" strokeLinecap="round" fill="none" />
        <circle cx="47.2" cy="43.6" r="2" fill={PINK} />

        {/* Body with a white belly patch and a tiny heart */}
        <g className="critter-body">
          <ellipse cx="32" cy="51" rx="10.5" ry="8.5" fill={INK} {...EDGE} />
          <ellipse cx="32" cy="52.5" rx="6" ry="5" fill={FACE} />
          <Heart x={32} y={52.5} size={0.75} />
          {extras.body}
        </g>

        {/* Head: ears, hood, face. Pivots at the neck. */}
        <g className="critter-head">
          <g className="critter-ear critter-ear-l">
            <path d="M23 27 C 14 20, 9 9, 15 4 C 21 1, 26 12, 28 23 Z" fill={INK} {...EDGE} />
            <path d="M22 23 C 17 17, 14 11, 17 8 C 20 7, 23 14, 25 21 Z" fill={PINK} />
          </g>
          <g className="critter-ear critter-ear-r">
            <path d="M41 27 C 50 20, 55 9, 49 4 C 43 1, 38 12, 36 23 Z" fill={INK} {...EDGE} />
            <path d="M42 23 C 47 17, 50 11, 47 8 C 44 7, 41 14, 39 21 Z" fill={PINK} />
          </g>
          <ellipse cx="32" cy="34" rx="18" ry="15" fill={INK} {...EDGE} />
          {/* Hood hem round the face, and a stitched seam over the crown */}
          <ellipse cx="32" cy="36.5" rx="13.3" ry="10.3" fill="none" stroke="#3b3542" strokeWidth="1.2" />
          <path d="M24 21 Q 32 17 40 21" stroke="#3b3542" strokeWidth="0.9" strokeDasharray="1.4 1.4" fill="none" />
          <ellipse cx="32" cy="36.5" rx="12.5" ry="9.5" fill={FACE} />
          {/* Brow star */}
          <path
            d="M32 20.5 l1.5 3 3.3 .5 -2.4 2.3 .6 3.3 -3 -1.6 -3 1.6 .6 -3.3 -2.4 -2.3 3.3 -.5 Z"
            fill={PINK}
            stroke={PINK_DEEP}
            strokeWidth="0.5"
          />
          {/* Cheeks */}
          <circle cx="24.5" cy="39.5" r="2.1" fill={BLUSH} />
          <circle cx="39.5" cy="39.5" r="2.1" fill={BLUSH} />

          {sleeping ? (
            <>
              <path d="M24.5 35.5 q2.5 2.4 5 0" stroke={INK} strokeWidth="1.6" strokeLinecap="round" fill="none" />
              <path d="M34.5 35.5 q2.5 2.4 5 0" stroke={INK} strokeWidth="1.6" strokeLinecap="round" fill="none" />
              <path d="M30 41.5 q2 1.6 4 0" stroke={INK} strokeWidth="1.4" strokeLinecap="round" fill="none" />
              <Nightcap />
            </>
          ) : (
            <>
              {/* Eyebrows, wide eyes with a glint, open fanged grin */}
              <path d="M24 30.5 q3 -1.6 6 0" stroke={INK} strokeWidth="1.1" strokeLinecap="round" fill="none" />
              <path d="M34 30.5 q3 -1.6 6 0" stroke={INK} strokeWidth="1.1" strokeLinecap="round" fill="none" />
              <ellipse cx="27" cy="35.5" rx="2.5" ry="3.2" fill={INK} />
              <ellipse cx="37" cy="35.5" rx="2.5" ry="3.2" fill={INK} />
              <circle cx="27.9" cy="34.3" r="0.9" fill="#fff" />
              <circle cx="37.9" cy="34.3" r="0.9" fill="#fff" />
              <path d="M27.5 40.5 q4.5 5 9 0 Z" fill={INK} />
              <path d="M28.5 41.2 q3.5 3 7 0 q-3.5 1.6 -7 0 Z" fill="#c8445f" />
              <path d="M33.5 40.6 l1.6 0 -0.8 2 Z" fill="#fff" />
              {extras.head}
            </>
          )}
        </g>

        {/* Arms, in front of the head so a raised hand (and whatever it holds)
            stays visible. Drawn from the shoulder up and out; the dance rotates
            them about the shoulder from the rest angle set by --arm-*-rest. */}
        {sleeping ? (
          <>
            <g><Limb d="M24 50 L 20 56" /><Hand cx={20} cy={56.5} /></g>
            <g><Limb d="M40 50 L 44 56" /><Hand cx={44} cy={56.5} /></g>
          </>
        ) : (
          <>
            <g className="critter-arm critter-arm-l">
              <Limb d="M24 48 L 14 39" />
              <Hand cx={13.5} cy={38.5} />
              {extras.handL && <g transform="translate(13.5 38.5)">{extras.handL}</g>}
            </g>
            <g className="critter-arm critter-arm-r">
              <Limb d="M40 48 L 50 39" />
              <Hand cx={50.5} cy={38.5} />
              {extras.handR && <g transform="translate(50.5 38.5)">{extras.handR}</g>}
            </g>
          </>
        )}
      </g>

      {extras.float}

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
      {Array.from({ length: total }, (_, i) => {
        const dance = DANCES[i % DANCES.length];
        const asleep = i < done;
        return (
          <div
            key={i}
            className="flex flex-col items-center"
            title={`Question ${i + 1}: ${asleep ? "done, fast asleep" : DANCE_LABEL[dance]}`}
          >
            <Critter
              mood={asleep ? "sleeping" : "dancing"}
              dance={dance}
              delaySeconds={(i % 8) * 0.11}
              className="h-16 w-16 sm:h-20 sm:w-20"
            />
            <span className="mt-1 text-[11px] leading-none tabular-nums text-da-muted">{i + 1}</span>
          </div>
        );
      })}
    </div>
  );
}
