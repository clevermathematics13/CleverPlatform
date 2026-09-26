"use client";

import { useId, useState } from "react";
import dynamic from "next/dynamic";
import type { ReflectionMarkScheme } from "@/lib/reflection-types";

/*
 * The "Explain more" slides, loaded only when a student opens them: they
 * typeset their maths in the browser, and KaTeX is a large script that the
 * self-grade form would otherwise download for every student whether or not
 * anyone opens an explanation.
 */
const ExplainMore = dynamic(() => import("./ExplainMore"), {
  ssr: false,
  loading: () => (
    <p role="status" className="rounded-lg border border-da-info/30 bg-da-info/5 px-3 py-3 text-sm text-da-muted">
      Loading the explanation…
    </p>
  ),
});

/**
 * One part's mark scheme, printed under that part's label on the self-grade
 * form and the comparison table, so a student reads the scheme and enters
 * the mark in the same row -- not in a panel laid over the form that has to
 * be closed to type and opened again for the next part. The full mark-scheme
 * page and the teacher's Re-mark Requests page show the same card.
 *
 * It is written for a student who may find a wall of text hard going
 * (ADHD, dyslexia, autism, anxiety), so it reads in a fixed order, every
 * time, and each thing has one job:
 *
 *   1. the answer, first, on its own and larger than the rest;
 *   2. how the marks work: one line per mark, with the mark count in a chip;
 *   3. at most three "watch out" notes;
 *   4. "Explain more", closed until the student asks: a short step-by-step
 *      explanation, one idea per step, with its own "Explain this further"
 *      and "Book office hours" on every step (ExplainMore);
 *   5. the teacher's full mark scheme, closed, for the exact wording.
 *
 * 2 to 4 exist when the part has a written explanation (scheme.guide).
 * Without one the card is the teacher's answer and marking note, as before.
 *
 * The HTML comes from the server (renderStudentMarkSchemePart in
 * lib/student-mark-scheme.ts): the text is escaped before KaTeX typesets it,
 * and it is the same renderer everywhere this card appears, so no two can
 * disagree. katex.min.css is loaded app-wide (app/globals.css).
 *
 * Never wider than the screen shows. The comparison table is wider than a
 * phone and scrolls sideways inside its own box; a row spanning all of it
 * would run its text off the right edge. 5.5rem is <main>'s p-8 on both
 * sides (app/dashboard/dashboard-shell.tsx) plus the cell's px-3.
 */
export function MarkSchemePart({
  scheme,
  wide = false,
}: {
  scheme: ReflectionMarkScheme;
  /** On a page of its own (the full mark scheme) the card takes the page's
   *  width; inside the self-grade table it keeps to what a phone shows. */
  wide?: boolean;
}) {
  const guide = scheme.guide ?? null;
  const [explaining, setExplaining] = useState(false);
  const panelId = useId();
  const answerHtml = guide?.answer_html ?? scheme.answer_html;
  const hasTeacherText = !!(scheme.answer_html || scheme.how_marked_html);

  return (
    <div
      className={`mt-1.5 ${wide ? "max-w-full" : "max-w-[min(72ch,calc(100vw_-_5.5rem))]"} space-y-3 rounded-lg border border-da-border/60 bg-da-bg/50 p-3 text-base leading-relaxed text-da-text`}
    >
      {answerHtml && (
        <section aria-label="Answer" className="rounded-md border border-da-success/40 bg-da-success/10 px-3 py-2">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-da-success">
            <span aria-hidden="true">✓</span>
            Answer
          </p>
          <div className="mt-0.5 overflow-x-auto text-xl" dangerouslySetInnerHTML={{ __html: answerHtml }} />
        </section>
      )}

      {guide ? (
        <>
          {guide.marks.length > 0 && (
            <section aria-label="How the marks work">
              <p className="text-sm font-semibold text-da-amber">How the marks work</p>
              <ul className="mt-1.5 space-y-1.5">
                {guide.marks.map((m, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-0.5 shrink-0 whitespace-nowrap rounded-full border border-da-amber/50 bg-da-amber/10 px-2 text-xs font-bold leading-5 text-da-amber">
                      {m.marks} {m.marks === 1 ? "mark" : "marks"}
                    </span>
                    <span className="min-w-0" dangerouslySetInnerHTML={{ __html: m.html }} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {guide.watch_html.length > 0 && (
            <section aria-label="Watch out" className="rounded-md border border-da-warning/40 bg-da-warning/10 px-3 py-2">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-da-warning">
                <span aria-hidden="true">⚠</span>
                Watch out
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-5 marker:text-da-warning">
                {guide.watch_html.map((html, i) => (
                  <li key={i} dangerouslySetInnerHTML={{ __html: html }} />
                ))}
              </ul>
            </section>
          )}

          {guide.steps.length > 0 && (
            <div>
              <button
                type="button"
                aria-expanded={explaining}
                aria-controls={panelId}
                onClick={() => setExplaining((open) => !open)}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-da-info/50 bg-da-info/10 px-3 py-2 text-sm font-semibold text-da-info transition-colors hover:bg-da-info/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-da-info"
              >
                <span aria-hidden="true" className={`inline-block transition-transform motion-reduce:transition-none ${explaining ? "rotate-90" : ""}`}>
                  ▸
                </span>
                Explain more
                <span className="font-normal text-da-muted">
                  ({guide.steps.length} {guide.steps.length === 1 ? "step" : "steps"})
                </span>
              </button>
              <div id={panelId}>
                {explaining && <ExplainMore steps={guide.steps} onClose={() => setExplaining(false)} />}
              </div>
            </div>
          )}

          {hasTeacherText && (
            <details className="group text-sm text-da-muted">
              <summary className="cursor-pointer select-none rounded py-1 hover:text-da-text focus-visible:outline-2 focus-visible:outline-da-accent">
                Full mark scheme (exact wording)
              </summary>
              <div className="mt-1 space-y-2 rounded-md border border-da-border/40 bg-da-surface/60 px-3 py-2 text-sm leading-relaxed text-da-text">
                {scheme.answer_html && (
                  <p>
                    <span className="font-semibold text-da-muted">Answer: </span>
                    <span dangerouslySetInnerHTML={{ __html: scheme.answer_html }} />
                  </p>
                )}
                {scheme.how_marked_html && (
                  <p>
                    <span className="font-semibold text-da-muted">How it&apos;s marked: </span>
                    <span dangerouslySetInnerHTML={{ __html: scheme.how_marked_html }} />
                  </p>
                )}
              </div>
            </details>
          )}
        </>
      ) : (
        scheme.how_marked_html && (
          <section aria-label="How it's marked">
            <p className="text-sm font-semibold text-da-amber">How it&apos;s marked</p>
            <div className="mt-0.5" dangerouslySetInnerHTML={{ __html: scheme.how_marked_html }} />
          </section>
        )
      )}
    </div>
  );
}
