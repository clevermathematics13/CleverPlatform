"use client";

import LatexRenderer from "@/components/LatexRenderer";

/** LatexRenderer renders into a <span> and emits <br> between logical lines,
 *  so layout utilities applied to it directly behave unexpectedly. Every
 *  caller in this app wraps it; this is that wrapper, once, for the lesson
 *  surface.
 *
 *  Math comes out parchment (#f0dfc0), not da-text: app/globals.css sets
 *  `.katex, .katex * { color: #f0dfc0 }` with no @layer, so it beats every
 *  Tailwind utility. That is the house look on dark surfaces and is left
 *  alone -- the only way to get dark math is to nest it under one of the six
 *  light-background classes the stylesheet whitelists. */
export function LessonMath({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className}>
      <LatexRenderer latex={text} />
    </div>
  );
}
