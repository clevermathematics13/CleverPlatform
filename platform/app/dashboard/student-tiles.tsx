/**
 * The student's landing tiles: a large carved-steel medallion, a raised
 * emblem cut in relief on it, and a title set in stepped topographic layers.
 *
 * The steel is done with SVG lighting filters rather than baked raster: the
 * emblem's own alpha is blurred into a height map, lit from the upper left
 * with a diffuse pass (form) and a specular pass (the hard metallic glint),
 * then multiplied back over a brushed-steel gradient. The medallion beneath
 * is a turned disc -- radial gradient, a chamfered ring, and a faint
 * horizontal turbulence clipped to the disc for the brushed grain.
 *
 * The titles get their relief from CSS (`.terrain-title` in globals.css):
 * a stack of one-pixel text-shadow steps, each a shade deeper than the one
 * above, from a pale rose summit down through the accent to the maroon of
 * the navigation rail. Read as contour lines, the word stands up out of the
 * card like a ridge.
 */

import type { ReactNode } from "react";

// ---- Steel ------------------------------------------------------------------

/** Shared defs, instanced per icon so ids never collide on one page. */
function SteelDefs({ id }: { id: string }) {
  return (
    <defs>
      {/* Brushed-steel face gradient: alternating light and dark bands read
          as a polished cylinder, which is what a lathe leaves behind. */}
      <linearGradient id={`${id}-steel`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#f2f3f5" />
        <stop offset="0.22" stopColor="#a9acb4" />
        <stop offset="0.45" stopColor="#e2e4e8" />
        <stop offset="0.62" stopColor="#7f838c" />
        <stop offset="0.82" stopColor="#c6c9cf" />
        <stop offset="1" stopColor="#6d7079" />
      </linearGradient>
      {/* Medallion disc: lit centre falling to a dark rim. */}
      <radialGradient id={`${id}-disc`} cx="0.42" cy="0.36" r="0.75">
        <stop offset="0" stopColor="#7c8089" />
        <stop offset="0.55" stopColor="#4d5058" />
        <stop offset="0.9" stopColor="#2b2d33" />
        <stop offset="1" stopColor="#1c1d21" />
      </radialGradient>
      {/* Chamfer ring: the bevel catches light at the top left and falls
          into shadow at the bottom right. */}
      <linearGradient id={`${id}-ring`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#eef0f3" />
        <stop offset="0.5" stopColor="#5a5e67" />
        <stop offset="1" stopColor="#15161a" />
      </linearGradient>
      <clipPath id={`${id}-clip`}>
        <circle cx="100" cy="100" r="92" />
      </clipPath>
      {/* Horizontal brushing on the disc face. */}
      <filter id={`${id}-brush`} x="0" y="0" width="1" height="1">
        <feTurbulence type="fractalNoise" baseFrequency="0.015 0.9" numOctaves="2" seed="7" result="noise" />
        <feColorMatrix in="noise" type="saturate" values="0" result="grey" />
        <feComponentTransfer in="grey">
          <feFuncA type="linear" slope="0.35" />
        </feComponentTransfer>
      </filter>
      {/* Relief lighting for the raised emblem. */}
      <filter id={`${id}-emboss`} x="-25%" y="-25%" width="150%" height="150%" colorInterpolationFilters="sRGB">
        <feGaussianBlur in="SourceAlpha" stdDeviation="1.4" result="height" />
        <feDiffuseLighting in="height" surfaceScale="7" diffuseConstant="1.1" lightingColor="#ffffff" result="diffuse">
          <feDistantLight azimuth="225" elevation="42" />
        </feDiffuseLighting>
        <feComposite in="SourceGraphic" in2="diffuse" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="formed" />
        <feSpecularLighting in="height" surfaceScale="7" specularConstant="0.85" specularExponent="22" lightingColor="#ffffff" result="spec">
          <feDistantLight azimuth="225" elevation="38" />
        </feSpecularLighting>
        <feComposite in="spec" in2="SourceAlpha" operator="in" result="specIn" />
        <feComposite in="formed" in2="specIn" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="lit" />
        {/* Contact shadow so the emblem sits on the disc rather than
            floating over it. */}
        <feGaussianBlur in="SourceAlpha" stdDeviation="2.2" result="shadowBlur" />
        <feOffset in="shadowBlur" dx="2.5" dy="3.5" result="shadowOff" />
        <feFlood floodColor="#000000" floodOpacity="0.7" result="shadowColor" />
        <feComposite in="shadowColor" in2="shadowOff" operator="in" result="shadow" />
        <feMerge>
          <feMergeNode in="shadow" />
          <feMergeNode in="lit" />
        </feMerge>
      </filter>
      {/* Deep-cut engraving lines inside the emblem: a dark groove with a
          thin light lip below it, the way a chisel leaves a V-cut. */}
      <filter id={`${id}-groove`} x="-10%" y="-10%" width="120%" height="120%">
        <feOffset in="SourceAlpha" dx="0" dy="1.2" result="lipOff" />
        <feFlood floodColor="#ffffff" floodOpacity="0.55" result="lipColor" />
        <feComposite in="lipColor" in2="lipOff" operator="in" result="lip" />
        <feMerge>
          <feMergeNode in="lip" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  );
}

/** The turned steel disc every emblem is carved on. */
function Medallion({ id }: { id: string }) {
  return (
    <g>
      <circle cx="100" cy="100" r="98" fill={`url(#${id}-ring)`} />
      <circle cx="100" cy="100" r="92" fill={`url(#${id}-disc)`} />
      <rect x="0" y="0" width="200" height="200" clipPath={`url(#${id}-clip)`} filter={`url(#${id}-brush)`} fill="#ffffff" style={{ mixBlendMode: "overlay" }} />
      {/* Inner turned groove, a hair inside the chamfer. */}
      <circle cx="100" cy="100" r="86" fill="none" stroke="#111216" strokeWidth="1.6" opacity="0.9" />
      <circle cx="100" cy="101.4" r="86" fill="none" stroke="#ffffff" strokeWidth="0.9" opacity="0.28" />
    </g>
  );
}

function CarvedIcon({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 200 200"
      role="img"
      aria-label={label}
      className="carved-icon"
      width="100%"
      height="100%"
    >
      <SteelDefs id={id} />
      <Medallion id={id} />
      <g fill={`url(#${id}-steel)`} filter={`url(#${id}-emboss)`}>
        {children}
      </g>
    </svg>
  );
}

// ---- Emblems ----------------------------------------------------------------

/** Self-Assess: a balance scale. Weighing your own work against the mark
 *  scheme is the whole act, and a pair of pans on a pillar is what a carver
 *  reaches for to say "judgement". Level beam, ornamented finial, stepped
 *  plinth. */
export function SelfAssessIcon() {
  const id = "sa";
  return (
    <CarvedIcon id={id} label="Self-Assess: a balance scale">
      {/* Plinth, two steps */}
      <path d="M52 176 h96 a6 6 0 0 1 6 6 v4 H46 v-4 a6 6 0 0 1 6 -6 Z" />
      <path d="M66 165 h68 a5 5 0 0 1 5 5 v6 H61 v-6 a5 5 0 0 1 5 -5 Z" />
      {/* Pillar with a swell at the foot */}
      <path d="M93 62 h14 v88 q6 4 6 12 v3 H87 v-3 q0 -8 6 -12 Z" />
      {/* Beam and pivot */}
      <rect x="28" y="56" width="144" height="8" rx="4" />
      <circle cx="100" cy="60" r="9" />
      {/* Finial: a small lozenge above the pivot */}
      <path d="M100 30 l9 12 l-9 12 l-9 -12 Z" />
      {/* Chains */}
      <g fill="none" stroke={`url(#${id}-steel)`} strokeWidth="2.6" strokeLinecap="round">
        <path d="M36 62 L20 112 M36 62 L52 112" />
        <path d="M164 62 L148 112 M164 62 L180 112" />
      </g>
      {/* Pans: shallow bowls with a rolled lip */}
      <path d="M14 112 h44 a3 3 0 0 1 3 3 q-3 22 -25 22 q-22 0 -25 -22 a3 3 0 0 1 3 -3 Z" />
      <path d="M142 112 h44 a3 3 0 0 1 3 3 q-3 22 -25 22 q-22 0 -25 -22 a3 3 0 0 1 3 -3 Z" />
      {/* Engraved marks: a tick weighed on the left, the cross on the right */}
      <g fill="none" stroke="#1a1b1f" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" filter={`url(#${id}-groove)`}>
        <path d="M28 124 l6 6 l12 -12" />
        <path d="M158 118 l12 12 M170 118 l-12 12" />
      </g>
      {/* Engraved band round the pillar */}
      <g fill="none" stroke="#1a1b1f" strokeWidth="1.8" filter={`url(#${id}-groove)`}>
        <path d="M94 104 h12 M94 110 h12" />
      </g>
    </CarvedIcon>
  );
}

/** My Feedback: an unrolled scroll with a quill laid across it. The marks
 *  are written down and handed back; the scroll carries the writing, the
 *  quill says whose hand it is in. */
export function FeedbackIcon() {
  const id = "fb";
  return (
    <CarvedIcon id={id} label="My Feedback: a scroll and quill">
      {/* Scroll sheet */}
      <path d="M46 56 h108 v92 H46 Z" />
      {/* Rolled ends, top and bottom, slightly wider than the sheet */}
      <rect x="36" y="44" width="128" height="20" rx="10" />
      <rect x="36" y="140" width="128" height="20" rx="10" />
      {/* Roll end caps: the spiral core seen end-on */}
      <circle cx="46" cy="54" r="5" fill="#2a2b30" />
      <circle cx="154" cy="54" r="5" fill="#2a2b30" />
      <circle cx="46" cy="150" r="5" fill="#2a2b30" />
      <circle cx="154" cy="150" r="5" fill="#2a2b30" />
      {/* Engraved lines of writing, the last one short like a signature */}
      <g fill="none" stroke="#1a1b1f" strokeWidth="3" strokeLinecap="round" filter={`url(#${id}-groove)`}>
        <path d="M62 80 h60" />
        <path d="M62 96 h52" />
        <path d="M62 112 h40" />
        <path d="M62 128 h22" />
      </g>
      {/* Quill: shaft with a vane, laid from top right down to the page */}
      <path d="M166 22 c14 12 12 44 -8 72 c-10 14 -22 26 -36 38 l-8 3 l3 -8 c8 -16 16 -32 28 -50 c10 -16 14 -36 21 -55 Z" />
      {/* Vane barbs, engraved */}
      <g fill="none" stroke="#1a1b1f" strokeWidth="1.8" strokeLinecap="round" filter={`url(#${id}-groove)`}>
        <path d="M160 40 l-16 8 M162 56 l-18 6 M158 72 l-18 4 M150 88 l-16 2" />
        <path d="M163 26 c-8 26 -22 60 -46 104" />
      </g>
      {/* Nib and the ink it leaves */}
      <path d="M114 132 l-8 3 l3 -8 Z" fill="#1a1b1f" />
      <circle cx="104" cy="139" r="3.2" fill="#1a1b1f" />
    </CarvedIcon>
  );
}

// ---- Tile -------------------------------------------------------------------

export function StudentTile({
  title,
  description,
  href,
  icon,
}: {
  title: string;
  description: string;
  href: string;
  icon: ReactNode;
}) {
  return (
    <a
      href={href}
      className="student-tile group flex flex-col items-center rounded-2xl border border-da-border bg-da-surface px-6 pb-7 pt-8 text-center shadow-lg shadow-black/40 transition-all hover:border-da-accent/60 hover:shadow-xl hover:shadow-black/60"
    >
      <div className="student-tile-icon h-44 w-44 sm:h-52 sm:w-52">{icon}</div>
      <p className="terrain-title mt-7 font-serif text-4xl sm:text-5xl">{title}</p>
      <p className="mt-4 max-w-xs text-sm text-da-muted/80">{description}</p>
    </a>
  );
}
