"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";
import type { ExplanationStep } from "@/lib/mark-scheme-explanation";
import { plainText } from "@/lib/math-text";
import { renderMathTextHtml } from "@/lib/tex-render";
import { ExplanationDiagram } from "./ExplanationDiagram";
import { OfficeHoursLink } from "./OfficeHoursLink";

/**
 * "Explain more": a part's worked explanation as a short slideshow, one idea
 * per step, opened from its mark scheme card (MarkSchemePart).
 *
 * Built for students who find a page of working hard to take in at once:
 *
 *  - one step at a time, and nothing moves on its own -- the student
 *    decides when to go on, with "I understand, please continue";
 *  - "Explain this further" opens a slower, more detailed version of the
 *    step in front of them, in place, without losing their position;
 *  - "Book office hours" is on every step, for when the answer is to ask a
 *    person;
 *  - "Step 2 of 4" and the dots say where they are and how much is left;
 *    a dot jumps straight to its step, and "Show all steps" lays the whole
 *    explanation out at once for anyone who prefers to scroll;
 *  - moving to a step moves keyboard focus to its heading and announces it,
 *    and the arrow keys move between steps;
 *  - no animation.
 *
 * Its maths is typeset here, in the browser, when the student opens it:
 * this module is loaded on demand (next/dynamic in MarkSchemePart), so
 * KaTeX never rides in the self-grade form's first download.
 */
export default function ExplainMore({ steps, onClose }: { steps: ExplanationStep[]; onClose: () => void }) {
  const total = steps.length;
  // 0..total-1 is a step; total is the "that's everything" panel.
  const [index, setIndex] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [further, setFurther] = useState<ReadonlySet<number>>(() => new Set());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const endRef = useRef<HTMLParagraphElement>(null);
  const navigated = useRef(false);

  const rendered = useMemo(
    () =>
      steps.map((step) => ({
        title: renderMathTextHtml(step.title),
        titleText: plainText(step.title),
        body: renderMathTextHtml(step.body),
        more: renderMathTextHtml(step.more),
      })),
    [steps],
  );

  // Focus follows the student's own navigation, never the first render: the
  // panel opening should not yank the page.
  useEffect(() => {
    if (!navigated.current) return;
    if (index >= total) endRef.current?.focus();
    else headingRef.current?.focus();
  }, [index, total]);

  const goTo = (i: number) => {
    navigated.current = true;
    setIndex(Math.max(0, Math.min(total, i)));
  };

  const toggleFurther = (i: number) =>
    setFurther((open) => {
      const next = new Set(open);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (showAll || e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, select, [contenteditable='true']")) return;
    if (e.key === "ArrowRight" && index < total) {
      e.preventDefault();
      goTo(index + 1);
    } else if (e.key === "ArrowLeft" && index > 0) {
      e.preventDefault();
      goTo(index - 1);
    }
  };

  const finished = index >= total;

  return (
    <section
      aria-label="Explain more"
      onKeyDown={onKeyDown}
      className="mt-2 rounded-lg border border-da-info/40 bg-da-surface p-3 sm:p-4"
    >
      <p aria-live="polite" className="sr-only">
        {showAll ? `All ${total} steps shown.` : finished ? "End of the explanation." : `Step ${index + 1} of ${total}: ${rendered[index].titleText}`}
      </p>

      {showAll ? (
        <>
          <ol className="space-y-5">
            {steps.map((step, i) => (
              <li key={i} className="border-b border-da-border/40 pb-4 last:border-0 last:pb-0">
                <p className="text-sm font-semibold text-da-muted">
                  Step {i + 1} of {total}
                </p>
                <StepBody
                  step={step}
                  html={rendered[i]}
                  furtherOpen={further.has(i)}
                  onFurther={() => toggleFurther(i)}
                  ownFurtherButton
                />
              </li>
            ))}
          </ol>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <SecondaryButton onClick={() => setShowAll(false)}>Show one step at a time</SecondaryButton>
            <OfficeHoursLink />
            <SecondaryButton onClick={onClose}>Close</SecondaryButton>
          </div>
        </>
      ) : finished ? (
        <div className="space-y-3">
          <p ref={endRef} tabIndex={-1} className="flex items-center gap-2 text-lg font-bold text-da-success focus:outline-none">
            <span aria-hidden="true">✓</span>
            That is the whole explanation.
          </p>
          <p>Now compare your own work with the answer, and give yourself the marks you earned.</p>
          <p className="text-da-muted">Still not sure? Your teacher can go through it with you.</p>
          <div className="flex flex-wrap items-center gap-2">
            <SecondaryButton onClick={() => goTo(0)}>
              <span aria-hidden="true">↺</span> Start again
            </SecondaryButton>
            <OfficeHoursLink />
            <SecondaryButton onClick={onClose}>Close</SecondaryButton>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <p className="text-sm font-semibold text-da-muted">
              Step {index + 1} of {total}
            </p>
            <ol aria-label="Steps" className="flex items-center gap-1">
              {steps.map((_, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => goTo(i)}
                    aria-label={`Step ${i + 1}: ${rendered[i].titleText}`}
                    aria-current={i === index ? "step" : undefined}
                    className="flex h-6 w-6 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-da-info"
                  >
                    <span
                      aria-hidden="true"
                      className={`block h-2.5 w-2.5 rounded-full border ${
                        i === index
                          ? "border-da-info bg-da-info"
                          : i < index
                            ? "border-da-info/70 bg-da-info/40"
                            : "border-da-muted/70 bg-transparent"
                      }`}
                    />
                  </button>
                </li>
              ))}
            </ol>
          </div>

          <StepBody
            step={steps[index]}
            html={rendered[index]}
            headingRef={headingRef}
            furtherOpen={further.has(index)}
            onFurther={() => toggleFurther(index)}
          />

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => goTo(index + 1)}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-da-info px-4 py-2 text-base font-bold text-da-on-accent transition-colors hover:bg-da-info/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-da-info"
            >
              I understand, please continue
              <span aria-hidden="true">→</span>
            </button>
            {index > 0 && (
              <SecondaryButton onClick={() => goTo(index - 1)}>
                <span aria-hidden="true">←</span> Back
              </SecondaryButton>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <SecondaryButton onClick={() => toggleFurther(index)} expanded={further.has(index)}>
              <span aria-hidden="true">🔍</span>
              {further.has(index) ? "Hide the extra detail" : "Explain this further"}
            </SecondaryButton>
            <OfficeHoursLink />
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="text-da-muted underline underline-offset-2 hover:text-da-text focus-visible:outline-2 focus-visible:outline-da-info"
            >
              Show all steps at once
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-da-muted underline underline-offset-2 hover:text-da-text focus-visible:outline-2 focus-visible:outline-da-info"
            >
              Close the explanation
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function StepBody({
  step,
  html,
  headingRef,
  furtherOpen,
  onFurther,
  ownFurtherButton = false,
}: {
  step: ExplanationStep;
  html: { title: string; body: string; more: string };
  headingRef?: Ref<HTMLHeadingElement>;
  furtherOpen: boolean;
  onFurther: () => void;
  /** The all-steps view gives each step its own "Explain this further";
   *  one step at a time, it sits with the step's other buttons. */
  ownFurtherButton?: boolean;
}) {
  return (
    <div className="mt-1 space-y-3">
      <h4
        ref={headingRef}
        tabIndex={-1}
        className="text-lg font-bold leading-snug text-da-text focus:outline-none"
        dangerouslySetInnerHTML={{ __html: html.title }}
      />
      <div className="text-base leading-relaxed" dangerouslySetInnerHTML={{ __html: html.body }} />
      {step.diagram && <ExplanationDiagram diagram={step.diagram} />}
      {furtherOpen ? (
        <div className="rounded-md border border-da-info/40 bg-da-info/10 px-3 py-2">
          <p className="text-sm font-semibold text-da-info">In more detail</p>
          <div className="mt-0.5 text-base leading-relaxed" dangerouslySetInnerHTML={{ __html: html.more }} />
        </div>
      ) : null}
      {ownFurtherButton && (
        <SecondaryButton onClick={onFurther} expanded={furtherOpen}>
          <span aria-hidden="true">🔍</span>
          {furtherOpen ? "Hide the extra detail" : "Explain this further"}
        </SecondaryButton>
      )}
    </div>
  );
}

function SecondaryButton({
  onClick,
  expanded,
  children,
}: {
  onClick: () => void;
  expanded?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-da-border bg-da-surface px-3 py-2 text-sm font-semibold text-da-text transition-colors hover:border-da-info/60 hover:bg-da-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-da-info"
    >
      {children}
    </button>
  );
}
