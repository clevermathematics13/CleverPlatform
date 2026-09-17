import { describe, it, expect } from "vitest";
import katex from "katex";
import { allLessons, getLesson, listLessons } from "./index";
import type { Lesson } from "./types";

/** Lesson content is hand-authored TypeScript, so the things that would
 *  otherwise only show up on a student's screen are checked here instead:
 *  a dropped backslash, an odd dollar count, a slide id the coverage map
 *  points at that does not exist.
 *
 *  The KaTeX pass is the important one. `"\\frac"` in a TS string literal is
 *  a backslash and `"\frac"` is a form feed followed by "rac", and the second
 *  one renders as garbage rather than failing to compile. Only KaTeX itself
 *  can tell the difference, so every span goes through it. */

/** Walks every string in a lesson, yielding [path, value]. */
function* walkStrings(value: unknown, path = ""): Generator<[string, string]> {
  if (typeof value === "string") {
    yield [path, value];
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) yield* walkStrings(value[i], `${path}[${i}]`);
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      yield* walkStrings(v, path ? `${path}.${k}` : k);
    }
  }
}

/** The inline-math split the renderer performs, narrowed to what a test
 *  needs: the spans, and nothing else. Mirrors splitSegments() in
 *  components/LatexRenderer.tsx closely enough to catch a broken span --
 *  notably that an inline span may NOT contain a newline. */
const INLINE_SPAN = /\$([^$\n]*?)\$/g;

function mathSpans(text: string): string[] {
  return [...text.matchAll(INLINE_SPAN)].map((m) => m[1]);
}

/** Dollars that are real delimiters, i.e. not written as an escaped
 *  currency sign. There is no currency in these lessons, but the count has
 *  to agree with the renderer's rule either way. */
function delimiterDollarCount(text: string): number {
  return (text.replace(/\\\$/g, "").match(/\$/g) ?? []).length;
}

const LESSONS = allLessons();

describe("the lesson registry", () => {
  it("publishes at least one lesson", () => {
    expect(LESSONS.length).toBeGreaterThan(0);
  });

  it("gives every lesson a unique slug, and finds each one by it", () => {
    const slugs = LESSONS.map((l) => l.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(getLesson(slug)?.slug).toBe(slug);
  });

  it("returns null for a slug that does not exist, rather than throwing", () => {
    expect(getLesson("no-such-lesson")).toBeNull();
    expect(getLesson("")).toBeNull();
  });

  it("summarises each lesson for the index without leaving math delimiters in the card", () => {
    for (const row of listLessons()) {
      expect(row.summary).not.toContain("$");
      expect(row.summary.length).toBeGreaterThan(20);
      expect(row.slideCount).toBeGreaterThan(0);
      expect(row.minutes).toBeGreaterThan(0);
    }
  });
});

describe.each(LESSONS.map((l) => [l.slug, l] as const))("lesson %s", (_slug, lesson: Lesson) => {
  const strings = [...walkStrings(lesson)];

  it("has every mathematics span render through KaTeX", () => {
    const failures: string[] = [];
    for (const [path, text] of strings) {
      for (const span of mathSpans(text)) {
        try {
          katex.renderToString(span, { throwOnError: true, displayMode: false });
        } catch (err) {
          failures.push(`${path}: ${span} -- ${(err as Error).message}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("closes every math delimiter it opens", () => {
    const odd = strings.filter(([, t]) => delimiterDollarCount(t) % 2 !== 0).map(([p, t]) => `${p}: ${t}`);
    expect(odd).toEqual([]);
  });

  // An inline span cannot straddle a line break, so every authored string is
  // one line and the arrays carry the structure. A newline that creeps in
  // silently turns the rest of the line into literal dollars and raw LaTeX.
  it("keeps every string on a single line", () => {
    const multiline = strings.filter(([, t]) => t.includes("\n")).map(([p]) => p);
    expect(multiline).toEqual([]);
  });

  // The renderer collapses runs of spaces, so two expressions joined by two
  // spaces become one run-on line.
  it("never joins content with a double space", () => {
    const runOn = strings.filter(([, t]) => t.includes("  ")).map(([p, t]) => `${p}: ${t}`);
    expect(runOn).toEqual([]);
  });

  // CLAUDE.md: ASCII only. An en-dash or a curly quote here also means two
  // typographic conventions on one page.
  it("uses ASCII characters only", () => {
    const offenders: string[] = [];
    for (const [path, text] of strings) {
      for (const ch of text) {
        if (ch.codePointAt(0)! > 127) {
          offenders.push(`${path}: U+${ch.codePointAt(0)!.toString(16).toUpperCase()} in "${text}"`);
          break;
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("avoids the LaTeX commands this repo has ruled out", () => {
    // \xrightarrow is absent from older KaTeX builds and from restricted
    // macro whitelists; the rest are the vector-notation rules in AGENTS.md,
    // plus \times, which this codebase writes as \cdot.
    const banned = ["\\xrightarrow", "\\bm{", "\\mathbf{", "\\vec{", "\\overrightarrow{", "\\times"];
    const hits: string[] = [];
    for (const [path, text] of strings) {
      for (const b of banned) if (text.includes(b)) hits.push(`${path}: ${b}`);
    }
    expect(hits).toEqual([]);
  });

  it("braces every fraction argument", () => {
    // \tfrac12 is valid KaTeX but an editing landmine: changing it to
    // \tfrac1{10} by hand silently produces \frac{1}{1}0.
    const unbraced: string[] = [];
    for (const [path, text] of strings) {
      const m = text.match(/\\[dt]?frac(?!\{)/g);
      if (m) unbraced.push(`${path}: ${m.join(", ")}`);
    }
    expect(unbraced).toEqual([]);
  });

  it("writes a rounded value with \\approx rather than a trailing ellipsis", () => {
    // $1.67\ldots$ for 10/6 asserts digits that are not there. \ldots is for
    // a true expansion only.
    const bad = strings
      .filter(([, t]) => /\d\.\d+\\ldots/.test(t))
      .map(([p, t]) => `${p}: ${t}`);
    expect(bad).toEqual([]);
  });

  it("gives every slide a unique id, a positive length and some student-facing body", () => {
    const ids = lesson.slides.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of lesson.slides) {
      expect(s.id).toMatch(/^[a-z0-9-]+$/);
      expect(s.minutes).toBeGreaterThan(0);
      expect(s.body.length).toBeGreaterThan(0);
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.purpose.length).toBeGreaterThan(0);
    }
  });

  it("keeps every table rectangular", () => {
    for (const s of lesson.slides) {
      if (!s.table) continue;
      for (const row of s.table.rows) {
        expect(`${s.id}: ${row.length}`).toBe(`${s.id}: ${s.table.headers.length}`);
      }
    }
  });

  // A plot is a claim about a sequence. If the points do not actually follow
  // the rule the series names, the figure teaches the wrong shape.
  it("plots points that really do follow the sequence they claim", () => {
    for (const s of lesson.slides) {
      if (!s.plot) continue;
      for (const series of s.plot.series) {
        const ys = series.points.map(([, y]) => y);
        expect(ys.length).toBeGreaterThan(2);
        if (series.kind === "geometric") {
          const r = ys[1] / ys[0];
          for (let i = 1; i < ys.length; i++) {
            expect(ys[i] / ys[i - 1]).toBeCloseTo(r, 9);
          }
        } else {
          const d = ys[1] - ys[0];
          for (let i = 1; i < ys.length; i++) {
            expect(ys[i] - ys[i - 1]).toBeCloseTo(d, 9);
          }
        }
        for (const [x, y] of series.points) {
          expect(x).toBeLessThanOrEqual(s.plot.xMax);
          expect(y).toBeLessThanOrEqual(s.plot.yMax);
        }
      }
      expect(s.plot.yStep).toBeGreaterThan(0);
      // An axis whose interval does not divide its maximum leaves the top
      // gridline off the axis.
      expect(s.plot.yMax % s.plot.yStep).toBe(0);
    }
  });

  it("points every coverage entry at a slide that exists", () => {
    const ids = new Set(lesson.slides.map((s) => s.id));
    const dangling = lesson.coverageMap.filter((c) => !ids.has(c.slideId)).map((c) => c.question);
    expect(dangling).toEqual([]);
  });

  it("maps each source question exactly once", () => {
    const keys = lesson.coverageMap.map((c) => `${c.source} ${c.question}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives the teacher answers wherever a slide asks a check question", () => {
    for (const s of lesson.slides) {
      if (!s.check) continue;
      expect(s.check.question.length).toBeGreaterThan(0);
      expect(s.check.answer.length).toBeGreaterThan(0);
    }
  });
});

describe("lesson 1.6, specifically", () => {
  const lesson = getLesson("1-6-describing-geometric-patterns")!;

  it("is published", () => {
    expect(lesson).toBeDefined();
    expect(lesson.code).toBe("1.6");
  });

  // The census the review established: 7 exploration items, 7 Check Your
  // Understanding items, 19 homework items.
  it("covers all 33 questions across both worksheets", () => {
    const bySource = (s: string) => lesson.coverageMap.filter((c) => c.source === s).length;
    expect(bySource("exploration")).toBe(7);
    expect(bySource("check-your-understanding")).toBe(7);
    expect(bySource("homework")).toBe(19);
    expect(lesson.coverageMap.length).toBe(33);
  });

  // The primer runs BEFORE students explore. The exploration is a knockout
  // tournament that halves 64 teams, and a primer that works that context
  // has answered exploration Q1, Q2, Q4 and Q5 in advance. This is the
  // regression test for exactly that, because it is invisible on the page:
  // the slide reads perfectly well, it just spoils the activity.
  it("never uses the exploration's own context in a primer slide", () => {
    const primerText = lesson.slides
      .filter((s) => s.phase === "primer")
      .flatMap((s) => [
        s.title,
        ...s.body,
        ...s.examples.flatMap((e) => [e.title, ...e.steps, e.answer]),
        s.check?.question ?? "",
        s.check?.answer ?? "",
      ])
      .join(" ")
      .toLowerCase();

    for (const spoiler of ["tournament", "knockout", "championship", "teams", "64"]) {
      expect(primerText).not.toContain(spoiler);
    }
  });

  // The one outright wrong statement the review found in the first draft:
  // "$0<r<1$ means decreasing" is false when the terms are negative.
  it("teaches direction as sign-aware, not as a fact about r alone", () => {
    const rSlide = lesson.slides.find((s) => s.id === "what-r-tells-you")!;
    const all = [...rSlide.body, ...rSlide.examples.flatMap((e) => [...e.steps, e.answer])].join(" ");
    // The negative-terms, fractional-ratio case must be worked, and must be
    // called increasing.
    expect(all).toContain("-100");
    expect(all).toMatch(/INCREASING/);
    // And the table must say out loud that its right-hand column assumes
    // positive terms.
    expect(rSlide.table?.caption.toUpperCase()).toContain("POSITIVE");
  });

  it("teaches both explicit rules, because homework Q6(a) leaves the kind open", () => {
    const slide = lesson.slides.find((s) => s.id === "jump-ahead-explicit-rule")!;
    const body = slide.body.join(" ");
    expect(body).toContain("a_1 \\cdot r^{\\,n-1}");
    expect(body).toContain("a_1 + (n-1)d");
  });

  it("names the misconceptions that produce the likeliest wrong answers", () => {
    const text = lesson.misconceptions.map((m) => m.misconception + m.howToFixIt).join(" ");
    // Reversed ratio, the two percent-to-ratio errors, and the shape rule.
    expect(text).toContain("LATER divided by EARLIER");
    expect(text).toContain("0.1");
    expect(text).toContain("90\\%");
    expect(text).toMatch(/r>0/);
  });

  it("records what could not be read off the source PDFs instead of guessing it", () => {
    expect(lesson.openQuestions.length).toBeGreaterThan(0);
    const items = lesson.openQuestions.map((q) => q.item).join(" ");
    expect(items).toContain("Q1(b)");
    expect(items).toContain("Q6");
  });

  it("gives the exit ticket a rubric students can see", () => {
    expect(lesson.exitTicket.rubric).toHaveLength(3);
    expect(lesson.exitTicket.task.length).toBeGreaterThan(40);
  });

  it("has a core spine that fits inside one period", () => {
    const core = lesson.slides.filter((s) => s.core);
    expect(core.length).toBeGreaterThan(0);
    const coreMinutes = core.reduce((sum, s) => sum + s.minutes, 0);
    expect(coreMinutes).toBeLessThanOrEqual(30);
  });
});
