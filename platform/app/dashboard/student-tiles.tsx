/**
 * The student's landing tiles: a large photographic steel medallion with the
 * emblem embossed on it, and a title set in stepped topographic layers.
 *
 * The medallions are rendered images, not live SVG. An earlier version drew
 * them with SVG lighting filters and read as cartoon metal: flat lighting,
 * no reflections, no grain. Real steel is almost entirely a reflection of
 * the room around it, so the images are produced offline by
 * scripts/steel-emblems/ -- a height field (turned disc, bevelled emblem,
 * V-cut engravings, lathe rings, brushing) shaded with an environment map,
 * a key light, ambient occlusion and sensor grain -- and shipped from
 * public/student-tiles/. Change the geometry there and re-run both scripts.
 *
 * The titles get their relief from CSS (`.terrain-title` in globals.css):
 * a stack of one-pixel text-shadow steps from the maroon of the navigation
 * rail on the face down to brushed silver at the base.
 */

import Image from "next/image";
import selfAssess from "@/public/student-tiles/self-assess.png";
import feedback from "@/public/student-tiles/feedback.png";

/** Self-Assess: a balance scale. Weighing your own work against the mark
 *  scheme is the whole act, and a pair of pans on a pillar is what a carver
 *  reaches for to say "judgement". A tick is cut into one pan, a cross into
 *  the other. */
export function SelfAssessIcon() {
  return (
    <Image
      src={selfAssess}
      alt="Self-Assess: a balance scale embossed in steel"
      className="carved-icon"
      sizes="(min-width: 640px) 13rem, 11rem"
      priority
    />
  );
}

/** My Feedback: an unrolled scroll with a quill laid across it. The marks
 *  are written down and handed back; the scroll carries the writing, the
 *  quill says whose hand it is in. */
export function FeedbackIcon() {
  return (
    <Image
      src={feedback}
      alt="My Feedback: a scroll and quill embossed in steel"
      className="carved-icon"
      sizes="(min-width: 640px) 13rem, 11rem"
      priority
    />
  );
}

export function StudentTile({
  title,
  description,
  href,
  icon,
}: {
  title: string;
  description: string;
  href: string;
  icon: React.ReactNode;
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
