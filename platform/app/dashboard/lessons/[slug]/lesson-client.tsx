"use client";

import { useCallback, useEffect, useState } from "react";
import { LessonMath } from "@/components/lessons/LessonMath";
import { SequencePlotFigure } from "@/components/lessons/SequencePlotFigure";
import type { CheckQuestion, Lesson, LessonSlide } from "@/lib/lessons/types";

/** The mini lesson, one slide at a time.
 *
 *  There is no Tabs, Accordion, Carousel or Card primitive in this repo and
 *  no components/ui directory, so this is built from the two idioms that
 *  already exist: the pill tab bar in assignments-client.tsx and the
 *  bordered da-surface card used everywhere else. It deliberately does not
 *  invent a third look.
 *
 *  Only the current slide is mounted. LatexRenderer shares one token counter
 *  across a render pass and recurses for tabular cells, so mounting thirteen
 *  slides' worth of math at once is not the cheap leaf it looks like.
 *
 *  `isTeacher` gates a whole extra layer -- purpose, teacher note, answers,
 *  misconceptions, coverage, open questions -- rather than a separate page,
 *  so the teacher is looking at exactly what the class is looking at, with
 *  the margin notes turned on. */
export function LessonClient({ lesson, isTeacher }: { lesson: Lesson; isTeacher: boolean }) {
  const [index, setIndex] = useState(0);
  const [showTeacherLayer, setShowTeacherLayer] = useState(isTeacher);
  const slide = lesson.slides[index];

  const go = useCallback(
    (next: number) => {
      setIndex((i) => Math.min(lesson.slides.length - 1, Math.max(0, next === -1 ? i - 1 : next === -2 ? i + 1 : next)));
    },
    [lesson.slides.length],
  );

  // Arrow keys move between slides, the way a deck does. Ignored while a
  // form control has focus so the reveal buttons still behave normally.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(el.tagName)) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(-2);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  return (
    <div className="mx-auto max-w-4xl">
      <LessonHeader lesson={lesson} />

      {isTeacher && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-da-border bg-da-surface px-4 py-3">
          <p className="text-xs leading-relaxed text-da-muted">
            You are seeing the teacher layer: what each slide is for, what to watch for, and the answers.
            Students never see it.
          </p>
          <button
            type="button"
            onClick={() => setShowTeacherLayer((v) => !v)}
            className="da-btn shrink-0 text-xs"
          >
            {showTeacherLayer ? "Hide teacher notes" : "Show teacher notes"}
          </button>
        </div>
      )}

      <SlideRail
        slides={lesson.slides}
        index={index}
        onPick={go}
        showCore={isTeacher && showTeacherLayer}
      />

      <SlideView slide={slide} showTeacherLayer={isTeacher && showTeacherLayer} />

      <div className="mt-6 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => go(-1)}
          disabled={index === 0}
          className="da-btn disabled:opacity-40"
        >
          Back
        </button>
        <span className="font-mono text-xs tracking-wide text-da-muted">
          Slide {index + 1} of {lesson.slides.length}
        </span>
        <button
          type="button"
          onClick={() => go(-2)}
          disabled={index === lesson.slides.length - 1}
          className="da-btn disabled:opacity-40"
        >
          Next
        </button>
      </div>

      <LessonAppendix lesson={lesson} showTeacherLayer={isTeacher && showTeacherLayer} />
    </div>
  );
}

function LessonHeader({ lesson }: { lesson: Lesson }) {
  return (
    <header>
      <p className="font-mono text-xs tracking-widest text-da-accent">
        LESSON {lesson.code} &middot; {lesson.courseLabel.toUpperCase()}
      </p>
      {/* font-serif is pinned to weight 400 in globals.css (Instrument Serif
          ships one weight), so hierarchy comes from size and color here,
          not from font-bold. */}
      <h1 className="mt-2 font-serif text-3xl text-da-text">{lesson.title}</h1>
      <div className="mt-4 rounded-lg border border-da-accent/40 bg-da-accent/5 p-4">
        <p className="font-mono text-[11px] tracking-widest text-da-accent">THE BIG IDEA</p>
        <LessonMath text={lesson.bigIdea} className="mt-2 text-sm leading-relaxed text-da-text" />
      </div>
      {lesson.materials.length > 0 && (
        <p className="mt-4 text-xs leading-relaxed text-da-muted">
          Use this alongside: {lesson.materials.join("; ")}.
        </p>
      )}
    </header>
  );
}

function SlideRail({
  slides,
  index,
  onPick,
  showCore,
}: {
  slides: LessonSlide[];
  index: number;
  onPick: (n: number) => void;
  showCore: boolean;
}) {
  return (
    <nav className="mt-6 flex flex-wrap gap-2" aria-label="Slides">
      {slides.map((s, i) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onPick(i)}
          title={s.title}
          aria-current={i === index ? "step" : undefined}
          className={
            i === index
              ? "rounded-full border border-da-accent bg-da-accent px-3 py-1 text-xs font-medium text-da-on-accent"
              : "rounded-full border border-da-border bg-da-surface px-3 py-1 text-xs text-da-muted hover:border-da-accent/50 hover:text-da-text"
          }
        >
          {i + 1}
          {showCore && !s.core && <span className="ml-1 opacity-60">&bull;</span>}
        </button>
      ))}
      {showCore && (
        <span className="self-center pl-2 text-[11px] text-da-muted">
          &bull; marks a slide outside the core spine
        </span>
      )}
    </nav>
  );
}

function SlideView({ slide, showTeacherLayer }: { slide: LessonSlide; showTeacherLayer: boolean }) {
  return (
    <article className="mt-4 rounded-xl border border-da-border bg-da-surface p-6 shadow-sm shadow-black/30">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={
            slide.phase === "primer"
              ? "rounded-full border border-da-info/40 bg-da-info/10 px-2.5 py-0.5 font-mono text-[10px] tracking-widest text-da-info"
              : "rounded-full border border-da-amber/40 bg-da-amber/10 px-2.5 py-0.5 font-mono text-[10px] tracking-widest text-da-amber"
          }
        >
          {slide.phase === "primer" ? "BEFORE THE EXPLORATION" : "AFTER THE EXPLORATION"}
        </span>
        {showTeacherLayer && (
          <span className="font-mono text-[10px] tracking-widest text-da-muted">
            {slide.minutes} MIN &middot; {slide.core ? "CORE" : "AS NEEDED"}
          </span>
        )}
      </div>

      <h2 className="mt-3 font-serif text-2xl text-da-text">{slide.title}</h2>

      {showTeacherLayer && (
        <LessonMath
          text={slide.purpose}
          className="mt-2 border-l-2 border-da-border pl-3 text-xs leading-relaxed text-da-muted"
        />
      )}

      <div className="mt-5 space-y-3">
        {slide.body.map((line, i) => (
          <LessonMath key={i} text={line} className="text-[15px] leading-relaxed text-da-text" />
        ))}
      </div>

      {slide.table && (
        <div className="mt-6 overflow-x-auto">
          <p className="mb-2 text-xs text-da-muted">{slide.table.caption}</p>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {slide.table.headers.map((h) => (
                  <th
                    key={h}
                    className="border border-da-border bg-da-hover px-3 py-2 text-left font-medium text-da-text"
                  >
                    <LessonMath text={h} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slide.table.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="border border-da-border px-3 py-2 align-top text-da-text">
                      <LessonMath text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {slide.plot && <SequencePlotFigure plot={slide.plot} />}

      {slide.examples.map((ex) => (
        <section key={ex.title} className="mt-6 rounded-lg border border-da-border bg-da-bg/60 p-4">
          <h3 className="font-mono text-[11px] tracking-widest text-da-amber">
            {ex.title.toUpperCase()}
          </h3>
          <ol className="mt-3 space-y-2">
            {ex.steps.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-0.5 shrink-0 font-mono text-[11px] text-da-muted">{i + 1}</span>
                <LessonMath text={step} className="text-sm leading-relaxed text-da-text" />
              </li>
            ))}
          </ol>
          <div className="mt-3 border-t border-da-border pt-3">
            <LessonMath text={ex.answer} className="text-sm leading-relaxed text-da-text" />
          </div>
        </section>
      ))}

      {slide.check && <CheckPanel check={slide.check} />}

      {showTeacherLayer && (slide.teacherNote || slide.answers.length > 0) && (
        <section className="mt-6 rounded-lg border border-da-warning/30 bg-da-warning/5 p-4">
          <h3 className="font-mono text-[11px] tracking-widest text-da-warning">TEACHER NOTE</h3>
          {slide.teacherNote && (
            <LessonMath
              text={slide.teacherNote}
              className="mt-2 text-sm leading-relaxed text-da-text"
            />
          )}
          {slide.answers.length > 0 && (
            <div className="mt-3 border-t border-da-warning/20 pt-3">
              <p className="font-mono text-[11px] tracking-widest text-da-warning">ANSWERS</p>
              <div className="mt-2 space-y-1.5">
                {slide.answers.map((a, i) => (
                  <LessonMath key={i} text={a} className="text-sm leading-relaxed text-da-text" />
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </article>
  );
}

/** The answer is hidden behind a click on purpose: a check question whose
 *  answer is already on screen is a worked example, not a check. */
function CheckPanel({ check }: { check: CheckQuestion }) {
  const [shown, setShown] = useState(false);
  return (
    <section className="mt-6 rounded-lg border border-da-success/30 bg-da-success/5 p-4">
      <h3 className="font-mono text-[11px] tracking-widest text-da-success">CHECK YOURSELF</h3>
      <LessonMath text={check.question} className="mt-2 text-sm leading-relaxed text-da-text" />
      {shown ? (
        <div className="mt-3 border-t border-da-success/20 pt-3">
          <LessonMath text={check.answer} className="text-sm leading-relaxed text-da-text" />
        </div>
      ) : (
        <button type="button" onClick={() => setShown(true)} className="da-btn mt-3 text-xs">
          Try it first, then check
        </button>
      )}
    </section>
  );
}

function LessonAppendix({ lesson, showTeacherLayer }: { lesson: Lesson; showTeacherLayer: boolean }) {
  return (
    <div className="mt-10 space-y-6">
      <Panel title="Words you need">
        <dl className="space-y-4">
          {lesson.vocabulary.map((v) => (
            <div key={v.term}>
              <dt className="text-sm font-medium text-da-text">{v.term}</dt>
              <dd className="mt-1 space-y-1">
                <LessonMath text={v.definition} className="text-sm leading-relaxed text-da-muted" />
                <LessonMath text={v.example} className="text-sm leading-relaxed text-da-muted" />
              </dd>
            </div>
          ))}
        </dl>
      </Panel>

      <Panel title="Warm up first">
        <p className="mb-3 text-xs text-da-muted">
          If any of these five are hard, say so before the lesson starts. They are the skills every
          question below leans on.
        </p>
        <ol className="space-y-3">
          {lesson.warmUp.map((w, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-0.5 shrink-0 font-mono text-[11px] text-da-muted">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <LessonMath text={w.question} className="text-sm leading-relaxed text-da-text" />
                {showTeacherLayer && (
                  <LessonMath text={w.answer} className="mt-1 text-sm leading-relaxed text-da-success" />
                )}
              </div>
            </li>
          ))}
        </ol>
      </Panel>

      <Panel title="What you should be able to do">
        <ul className="space-y-2">
          {lesson.learningTargets.map((t, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-1 shrink-0 text-da-accent">&bull;</span>
              <LessonMath text={t} className="text-sm leading-relaxed text-da-text" />
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Exit ticket">
        <LessonMath text={lesson.exitTicket.task} className="text-sm leading-relaxed text-da-text" />
        <p className="mt-4 font-mono text-[11px] tracking-widest text-da-muted">HOW IT IS MARKED</p>
        <ul className="mt-2 space-y-2">
          {lesson.exitTicket.rubric.map((r, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-0.5 shrink-0 font-mono text-[11px] text-da-muted">1</span>
              <LessonMath text={r} className="text-sm leading-relaxed text-da-text" />
            </li>
          ))}
        </ul>
      </Panel>

      {lesson.challenge.length > 0 && (
        <Panel title="If you finish early">
          <ol className="space-y-4">
            {lesson.challenge.map((c, i) => (
              <li key={i}>
                <LessonMath text={c.task} className="text-sm leading-relaxed text-da-text" />
                {showTeacherLayer && (
                  <LessonMath text={c.answer} className="mt-1 text-sm leading-relaxed text-da-success" />
                )}
              </li>
            ))}
          </ol>
        </Panel>
      )}

      {showTeacherLayer && (
        <>
          <Panel title="Pacing">
            <LessonMath text={lesson.pacing} className="text-sm leading-relaxed text-da-text" />
            <p className="mt-4 font-mono text-[11px] tracking-widest text-da-muted">PREREQUISITES</p>
            <ul className="mt-2 space-y-1.5">
              {lesson.prerequisites.map((pre, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-1 shrink-0 text-da-muted">&bull;</span>
                  <LessonMath text={pre} className="text-xs leading-relaxed text-da-muted" />
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="What students get wrong">
            <ol className="space-y-5">
              {lesson.misconceptions.map((m, i) => (
                <li key={i}>
                  <LessonMath
                    text={m.misconception}
                    className="text-sm font-medium leading-relaxed text-da-danger"
                  />
                  <LessonMath
                    text={m.whyItHappens}
                    className="mt-1 text-sm leading-relaxed text-da-muted"
                  />
                  <LessonMath
                    text={m.howToFixIt}
                    className="mt-1 text-sm leading-relaxed text-da-text"
                  />
                </li>
              ))}
            </ol>
          </Panel>

          <Panel title="Every question on both worksheets, and the slide that covers it">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    {["Worksheet", "Question", "What they must do", "Slide"].map((h) => (
                      <th
                        key={h}
                        className="border border-da-border bg-da-hover px-3 py-2 text-left font-medium text-da-text"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lesson.coverageMap.map((c, i) => (
                    <tr key={i}>
                      <td className="border border-da-border px-3 py-2 align-top text-xs text-da-muted">
                        {c.source}
                      </td>
                      <td className="border border-da-border px-3 py-2 align-top whitespace-nowrap text-da-text">
                        {c.question}
                      </td>
                      <td className="border border-da-border px-3 py-2 align-top text-da-text">
                        <LessonMath text={c.demand} />
                      </td>
                      <td className="border border-da-border px-3 py-2 align-top text-xs text-da-muted">
                        {lesson.slides.find((s) => s.id === c.slideId)?.title ?? c.slideId}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {lesson.openQuestions.length > 0 && (
            <Panel title="Check these against the printed worksheet">
              <p className="mb-3 text-xs leading-relaxed text-da-muted">
                These could not be read reliably from the source PDFs, so they were not guessed.
              </p>
              <ol className="space-y-4">
                {lesson.openQuestions.map((q, i) => (
                  <li key={i}>
                    <LessonMath text={q.item} className="text-sm font-medium text-da-warning" />
                    <LessonMath
                      text={q.whyUnresolved}
                      className="mt-1 text-sm leading-relaxed text-da-muted"
                    />
                    <LessonMath
                      text={q.whatWasDone}
                      className="mt-1 text-sm leading-relaxed text-da-text"
                    />
                  </li>
                ))}
              </ol>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-da-border bg-da-surface p-6">
      <h2 className="font-serif text-xl text-da-text">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}
