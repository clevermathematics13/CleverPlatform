"use client";

import type { ReflectionMarkScheme } from "@/lib/reflection-types";

/**
 * One part's mark scheme, printed under that part's label on the self-grade
 * form and the comparison table, so a student reads the scheme and enters
 * the mark in the same row -- not in a panel laid over the form that has to
 * be closed to type and opened again for the next part.
 *
 * The HTML comes from the server (renderStudentMarkSchemePart in
 * lib/student-mark-scheme.ts): the text is escaped before KaTeX typesets it,
 * and it is the same renderer as the full mark-scheme page, so the two
 * cannot disagree. katex.min.css is loaded app-wide (app/globals.css).
 *
 * Never wider than the screen shows. The comparison table is wider than a
 * phone and scrolls sideways inside its own box; a row spanning all of it
 * would run its text off the right edge. 5.5rem is <main>'s p-8 on both
 * sides (app/dashboard/dashboard-shell.tsx) plus the cell's px-3.
 */
export function MarkSchemePart({ scheme }: { scheme: ReflectionMarkScheme }) {
  return (
    <div className="mt-1.5 max-w-[min(65ch,calc(100vw_-_5.5rem))] space-y-1 rounded-md border border-da-border/40 bg-da-bg/40 px-2.5 py-2 text-sm leading-relaxed text-da-text">
      {scheme.answer_html && (
        <div>
          <span className="mr-1.5 text-[11px] font-bold uppercase tracking-wide text-da-amber">Answer</span>
          <span dangerouslySetInnerHTML={{ __html: scheme.answer_html }} />
        </div>
      )}
      {scheme.how_marked_html && (
        <div>
          <span className="block text-[11px] font-bold uppercase tracking-wide text-da-amber">
            How it&apos;s marked
          </span>
          <span dangerouslySetInnerHTML={{ __html: scheme.how_marked_html }} />
        </div>
      )}
    </div>
  );
}
