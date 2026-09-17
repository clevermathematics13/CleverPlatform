"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LessonMath } from "@/components/lessons/LessonMath";
import { SequencePlotFigure } from "@/components/lessons/SequencePlotFigure";
import {
  ACT_LABEL,
  ACT_ORDER,
  coverageFromHints,
  type CheckQuestion,
  type Lesson,
  type LessonAct,
  type LessonSlide,
} from "@/lib/lessons/types";

/** The mini lesson, one slide at a time, in three acts.
 *
 *  The act tabs are not decoration: they are how a student uses this. Read
 *  the Learn act before the work; open one Hint slide when a question stops
 *  you; go to Review afterwards. A flat deck of forty-odd slides would make
 *  the Hint act unreachable, which is the act students actually need mid-
 *  worksheet.
 *
 *  There is no Tabs, Accordion, Carousel or Card primitive in this repo and
 *  no components/ui directory, so this is built from the two idioms that
 *  already exist: the pill tab bar in assignments-client.tsx and the
 *  bordered da-surface card used everywhere else. It deliberately does not
 *  invent a third look.
 *
 *  Only the current slide is mounted. LatexRenderer shares one token counter
 *  across a render pass and recurses for tabular cells, so mounting forty
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
  const teacherLayer = isTeacher && showTeacherLayer;

  const byId = useMemo(() => {
    const m = new Map<string, number>();
    lesson.slides.forEach((s, i) => m.set(s.id, i));
    return m;
  }, [lesson.slides]);

  const goToId = useCallback(
    (id: string) => {
      const i = byId.get(id);
      if (i !== undefined) setIndex(i);
    },
    [byId],
  );

  const step = useCallback(
    (delta: number) => {
      setIndex((i) => Math.min(lesson.slides.length - 1, Math.max(0, i + delta)));
    },
    [lesson.slides.length],
  );

  // Arrow keys move between slides, the way a deck does. Ignored while a
  // control has focus so the reveal and jump buttons still behave normally.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(el.tagName)) return;
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  // Position within the act, which is what the footer counts. A global
  // "slide 24 of 43" tells a student nothing about where they are.
  const actSlides = lesson.slides.filter((s) => s.act === slide.act);
  const posInAct = actSlides.findIndex((s) => s.id === slide.id) + 1;

  return (
    <div className="mx-auto max-w-4xl">
      <LessonHeader lesson={lesson} />

      {isTeacher && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-da-border bg-da-surface px-4 py-3">
          <p className="text-xs leading-relaxed text-da-muted">
            You are seeing the teacher layer: what each slide is for, what to watch for, and the answers.
            Students never see it.
          </p>
          <button type="button" onClick={() => setShowTeacherLayer((v) => !v)} className="da-btn shrink-0 text-xs">
            {showTeacherLayer ? "Hide teacher notes" : "Show teacher notes"}
          </button>
        </div>
      )}

      <ActTabs lesson={lesson} current={slide.act} onPick={goToId} />
      <SlideRail lesson={lesson} act={slide.act} currentId={slide.id} onPick={goToId} showCore={teacherLayer} />

      <SlideView slide={slide} lesson={lesson} showTeacherLayer={teacherLayer} onJump={goToId} />

      <div className="mt-6 flex items-center justify-between gap-4">
        <button type="button" onClick={() => step(-1)} disabled={index === 0} className="da-btn disabled:opacity-40">
          Back
        </button>
        <span className="font-mono text-xs tracking-wide text-da-muted">
          {ACT_LABEL[slide.act]} &middot; {posInAct} of {actSlides.length}
        </span>
        <button
          type="button"
          onClick={() => step(1)}
          disabled={index === lesson.slides.length - 1}
          className="da-btn disabled:opacity-40"
        >
          Next
        </button>
      </div>

      <LessonAppendix lesson={lesson} showTeacherLayer={teacherLayer} onJump={goToId} />
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
        <p className="mt-4 text-xs leading-relaxed text-da-muted">Use this alongside: {lesson.materials.join("; ")}.</p>
      )}
    </header>
  );
}

const ACT_BLURB: Record<LessonAct, string> = {
  learn: "Read these before you start the worksheets.",
  hint: "Open the slide for whichever question has stopped you. Hints only, no answers.",
  review: "Come back here once the work is done.",
};

function ActTabs({
  lesson,
  current,
  onPick,
}: {
  lesson: Lesson;
  current: LessonAct;
  onPick: (id: string) => void;
}) {
  return (
    <div className="mt-6">
      <nav className="flex flex-wrap gap-2" aria-label="Parts of this lesson">
        {ACT_ORDER.map((act) => {
          const first = lesson.slides.find((s) => s.act === act);
          if (!first) return null;
          const count = lesson.slides.filter((s) => s.act === act).length;
          return (
            <button
              key={act}
              type="button"
              onClick={() => onPick(first.id)}
              aria-current={act === current ? "true" : undefined}
              className={
                act === current
                  ? "rounded-lg border border-da-accent bg-da-accent px-4 py-2 text-sm font-medium text-da-on-accent"
                  : "rounded-lg border border-da-border bg-da-surface px-4 py-2 text-sm text-da-muted hover:border-da-accent/50 hover:text-da-text"
              }
            >
              {ACT_LABEL[act]}
              <span className="ml-2 font-mono text-[11px] opacity-70">{count}</span>
            </button>
          );
        })}
      </nav>
      <p className="mt-2 text-xs leading-relaxed text-da-muted">{ACT_BLURB[current]}</p>
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  exploration: "Exploration",
  "check-your-understanding": "Check Your Understanding",
  homework: "Homework",
};

/** The rail shows only the CURRENT act. Forty numbered pills in one row is
 *  not a menu, it is wallpaper.
 *
 *  In the hint act the pills carry the question label rather than an index,
 *  and are grouped by worksheet: a student mid-homework is looking for "Q7",
 *  not for "slide 27". */
function SlideRail({
  lesson,
  act,
  currentId,
  onPick,
  showCore,
}: {
  lesson: Lesson;
  act: LessonAct;
  currentId: string;
  onPick: (id: string) => void;
  showCore: boolean;
}) {
  const slides = lesson.slides.filter((s) => s.act === act);

  const pill = (s: LessonSlide, label: string) => (
    <button
      key={s.id}
      type="button"
      onClick={() => onPick(s.id)}
      title={s.title}
      aria-current={s.id === currentId ? "step" : undefined}
      className={
        s.id === currentId
          ? "rounded-full border border-da-accent bg-da-accent px-3 py-1 text-xs font-medium text-da-on-accent"
          : "rounded-full border border-da-border bg-da-surface px-3 py-1 text-xs text-da-muted hover:border-da-accent/50 hover:text-da-text"
      }
    >
      {label}
      {showCore && act === "learn" && !s.core && <span className="ml-1 opacity-60">&bull;</span>}
    </button>
  );

  if (act === "hint") {
    const sources = ["exploration", "check-your-understanding", "homework"] as const;
    return (
      <div className="mt-4 space-y-2" aria-label="Questions">
        {sources.map((src) => {
          const group = slides.filter((s) => s.source === src);
          if (group.length === 0) return null;
          return (
            <div key={src} className="flex flex-wrap items-center gap-2">
              <span className="w-full font-mono text-[10px] tracking-widest text-da-muted sm:w-52">
                {SOURCE_LABEL[src].toUpperCase()}
              </span>
              {group.map((s) => pill(s, (s.questionRef ?? "").replace(/^.*\b(Q\d+)$/, "$1")))}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <nav className="mt-4 flex flex-wrap gap-2" aria-label="Slides">
      {slides.map((s, i) => pill(s, String(i + 1)))}
      {showCore && act === "learn" && (
        <span className="self-center pl-2 text-[11px] text-da-muted">&bull; marks a slide outside the core spine</span>
      )}
    </nav>
  );
}

function SlideView({
  slide,
  lesson,
  showTeacherLayer,
  onJump,
}: {
  slide: LessonSlide;
  lesson: Lesson;
  showTeacherLayer: boolean;
  onJump: (id: string) => void;
}) {
  return (
    <article className="mt-4 rounded-xl border border-da-border bg-da-surface p-6 shadow-sm shadow-black/30">
      <div className="flex flex-wrap items-center gap-2">
        {slide.act === "hint" ? (
          <span className="rounded-full border border-da-accent/40 bg-da-accent/10 px-2.5 py-0.5 font-mono text-[10px] tracking-widest text-da-accent">
            {(slide.questionRef ?? "").toUpperCase()}
          </span>
        ) : slide.act === "learn" ? (
          <span
            className={
              slide.phase === "primer"
                ? "rounded-full border border-da-info/40 bg-da-info/10 px-2.5 py-0.5 font-mono text-[10px] tracking-widest text-da-info"
                : "rounded-full border border-da-amber/40 bg-da-amber/10 px-2.5 py-0.5 font-mono text-[10px] tracking-widest text-da-amber"
            }
          >
            {slide.phase === "primer" ? "BEFORE THE EXPLORATION" : "AFTER THE EXPLORATION"}
          </span>
        ) : null}
        {showTeacherLayer && slide.act === "learn" && (
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

      {slide.hints.length > 0 && <HintList slide={slide} lesson={lesson} onJump={onJump} />}

      {slide.table && (
        <div className="mt-6 overflow-x-auto">
          <p className="mb-2 text-xs text-da-muted">{slide.table.caption}</p>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {slide.table.headers.map((h) => (
                  <th key={h} className="border border-da-border bg-da-hover px-3 py-2 text-left font-medium text-da-text">
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
          <h3 className="font-mono text-[11px] tracking-widest text-da-amber">{ex.title.toUpperCase()}</h3>
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
          {slide.teacherNote && (
            <>
              <h3 className="font-mono text-[11px] tracking-widest text-da-warning">TEACHER NOTE</h3>
              <LessonMath text={slide.teacherNote} className="mt-2 text-sm leading-relaxed text-da-text" />
            </>
          )}
          {slide.answers.length > 0 && (
            <div className={slide.teacherNote ? "mt-3 border-t border-da-warning/20 pt-3" : ""}>
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

/** One nudge per part, each with a way back to the slide that teaches it.
 *  The jump is the point: a hint that is not enough should cost one click,
 *  not a hunt through the Learn act. */
function HintList({
  slide,
  lesson,
  onJump,
}: {
  slide: LessonSlide;
  lesson: Lesson;
  onJump: (id: string) => void;
}) {
  return (
    <div className="mt-5 space-y-3">
      {slide.hints.map((h, i) => {
        const target = lesson.slides.find((s) => s.id === h.backTo);
        return (
          <div key={i} className="rounded-lg border border-da-border bg-da-bg/60 p-4">
            <div className="flex gap-3">
              {h.part && <span className="shrink-0 font-mono text-xs text-da-accent">{h.part}</span>}
              <LessonMath text={h.hint} className="text-[15px] leading-relaxed text-da-text" />
            </div>
            {target && (
              <button
                type="button"
                onClick={() => onJump(target.id)}
                className="da-btn da-btn-link mt-3 text-xs"
              >
                Still stuck? Go to &ldquo;{target.title}&rdquo;
              </button>
            )}
          </div>
        );
      })}
    </div>
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

function LessonAppendix({
  lesson,
  showTeacherLayer,
  onJump,
}: {
  lesson: Lesson;
  showTeacherLayer: boolean;
  onJump: (id: string) => void;
}) {
  const coverage = coverageFromHints(lesson);

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
          If any of these five are hard, say so before the lesson starts. Every question below leans on them.
        </p>
        <ol className="space-y-3">
          {lesson.warmUp.map((w, i) => (
            <li key={i} className="min-w-0">
              <LessonMath text={w.question} className="text-sm leading-relaxed text-da-text" />
              {showTeacherLayer && (
                <LessonMath text={w.answer} className="mt-1 text-sm leading-relaxed text-da-success" />
              )}
            </li>
          ))}
        </ol>
      </Panel>

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
                  <LessonMath text={m.misconception} className="text-sm font-medium leading-relaxed text-da-danger" />
                  <LessonMath text={m.whyItHappens} className="mt-1 text-sm leading-relaxed text-da-muted" />
                  <LessonMath text={m.howToFixIt} className="mt-1 text-sm leading-relaxed text-da-text" />
                </li>
              ))}
            </ol>
          </Panel>

          <Panel title="Every question, and the slide that teaches it">
            <p className="mb-3 text-xs leading-relaxed text-da-muted">
              Built from the hint slides, so it cannot drift from what students are actually shown.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    {["Question", "Part", "The hint they get", "Teaches it"].map((h) => (
                      <th key={h} className="border border-da-border bg-da-hover px-3 py-2 text-left font-medium text-da-text">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {coverage.map((c, i) => {
                    const target = lesson.slides.find((s) => s.id === c.backTo);
                    return (
                      <tr key={i}>
                        <td className="border border-da-border px-3 py-2 align-top text-xs whitespace-nowrap text-da-muted">
                          {c.questionRef}
                        </td>
                        <td className="border border-da-border px-3 py-2 align-top text-xs text-da-text">{c.part || "-"}</td>
                        <td className="border border-da-border px-3 py-2 align-top text-da-text">
                          <LessonMath text={c.hint} />
                        </td>
                        <td className="border border-da-border px-3 py-2 align-top text-xs">
                          <button
                            type="button"
                            onClick={() => onJump(c.backTo)}
                            className="da-btn da-btn-link text-xs"
                          >
                            {target?.title ?? c.backTo}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
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
                    <LessonMath text={q.whyUnresolved} className="mt-1 text-sm leading-relaxed text-da-muted" />
                    <LessonMath text={q.whatWasDone} className="mt-1 text-sm leading-relaxed text-da-text" />
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
