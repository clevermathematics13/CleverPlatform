import { describe, it, expect } from "vitest";
import katex from "katex";
import { allLessons, getLesson, listLessons } from "./index";
import { ACT_ORDER, coverageFromHints, slidesInAct, type Lesson } from "./types";

/** Lesson content is hand-authored TypeScript, so the things that would
 *  otherwise only show up on a student's screen are checked here instead:
 *  a dropped backslash, an odd dollar count, a hint pointing at a slide that
 *  does not exist.
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
 *  needs. Mirrors splitSegments() in components/LatexRenderer.tsx: an
 *  ESCAPED dollar is recognised first and is not a delimiter, and an inline
 *  span may NOT contain a newline.
 *
 *  A plain /\$([^$\n]*?)\$/ is not good enough once a lesson mentions money.
 *  On "costs \$40.68 and \$30.59" it pairs the two escaped signs, hands
 *  KaTeX the prose between them and fails a correct line. The renderer does
 *  not make that mistake, so neither should the test. */
function mathSpans(text: string): string[] {
  const spans: string[] = [];
  let i = 0;
  while (i < text.length) {
    // An escaped dollar is a literal sign, never a delimiter.
    if (text[i] === "\\" && text[i + 1] === "$") {
      i += 2;
      continue;
    }
    if (text[i] === "$") {
      let j = i + 1;
      let buf = "";
      while (j < text.length && text[j] !== "\n" && text[j] !== "$") {
        if (text[j] === "\\" && text[j + 1] === "$") {
          buf += "\\$";
          j += 2;
          continue;
        }
        buf += text[j];
        j += 1;
      }
      if (text[j] === "$") {
        spans.push(buf);
        i = j + 1;
        continue;
      }
    }
    i += 1;
  }
  return spans;
}

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
      expect(row.learnCount).toBeGreaterThan(0);
      expect(row.hintCount).toBeGreaterThan(0);
      expect(row.minutes).toBeGreaterThan(0);
    }
  });
});

describe.each(LESSONS.map((l) => [l.slug, l] as const))("lesson %s", (_slug, lesson: Lesson) => {
  const strings = [...walkStrings(lesson)];
  const learn = slidesInAct(lesson, "learn");
  const hint = slidesInAct(lesson, "hint");
  const review = slidesInAct(lesson, "review");

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

  it("keeps every string on a single line", () => {
    const multiline = strings.filter(([, t]) => t.includes("\n")).map(([p]) => p);
    expect(multiline).toEqual([]);
  });

  it("never joins content with a double space", () => {
    const runOn = strings.filter(([, t]) => t.includes("  ")).map(([p, t]) => `${p}: ${t}`);
    expect(runOn).toEqual([]);
  });

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
    const banned = ["\\xrightarrow", "\\bm{", "\\mathbf{", "\\vec{", "\\overrightarrow{", "\\times"];
    const hits: string[] = [];
    for (const [path, text] of strings) {
      for (const b of banned) if (text.includes(b)) hits.push(`${path}: ${b}`);
    }
    expect(hits).toEqual([]);
  });

  it("braces every fraction argument", () => {
    const unbraced: string[] = [];
    for (const [path, text] of strings) {
      const m = text.match(/\\[dt]?frac(?!\{)/g);
      if (m) unbraced.push(`${path}: ${m.join(", ")}`);
    }
    expect(unbraced).toEqual([]);
  });

  // splitSegments() closes an inline span on the FIRST bare dollar it meets,
  // so an escaped dollar INSIDE math truncates the span and feeds KaTeX a
  // lone backslash. Money belongs in prose as \$, outside the math.
  it("never puts an escaped dollar inside a math span", () => {
    const inside: string[] = [];
    for (const [path, text] of strings) {
      for (const span of mathSpans(text)) {
        if (span.includes("\\$")) inside.push(`${path}: ${span}`);
      }
    }
    expect(inside).toEqual([]);
  });

  it("writes a rounded value with \\approx rather than a trailing ellipsis", () => {
    const bad = strings.filter(([, t]) => /\d\.\d+\\ldots/.test(t)).map(([p, t]) => `${p}: ${t}`);
    expect(bad).toEqual([]);
  });

  it("gives every slide a unique id and some student-facing body", () => {
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

  it("orders the slides act by act, so Next never jumps backwards through the lesson", () => {
    const seen = lesson.slides.map((s) => s.act);
    const firstIndexOf = ACT_ORDER.map((a) => seen.indexOf(a)).filter((i) => i >= 0);
    const lastIndexOf = ACT_ORDER.map((a) => seen.lastIndexOf(a)).filter((i) => i >= 0);
    for (let i = 1; i < firstIndexOf.length; i++) {
      expect(firstIndexOf[i]).toBeGreaterThan(lastIndexOf[i - 1]);
    }
  });

  // ---- One idea per slide. This is the whole reason the lesson is split
  // into acts, so it is worth failing a build over.

  it("keeps a learn slide to one idea: at most six body lines and one worked example", () => {
    const tooBig = learn
      .filter((s) => s.body.length > 6 || s.examples.length > 1)
      .map((s) => `${s.id}: ${s.body.length} body lines, ${s.examples.length} examples`);
    expect(tooBig).toEqual([]);
  });

  it("keeps a worked example to one screen: at most six steps", () => {
    const tooLong = lesson.slides
      .flatMap((s) => s.examples.map((e) => ({ s, e })))
      .filter(({ e }) => e.steps.length > 6)
      .map(({ s, e }) => `${s.id} / ${e.title}: ${e.steps.length} steps`);
    expect(tooLong).toEqual([]);
  });

  it("keeps a hint slide to hints: no examples, tables, plots or check questions", () => {
    const heavy = hint
      .filter((s) => s.examples.length > 0 || s.table || s.plot || s.check || s.body.length > 2)
      .map((s) => s.id);
    expect(heavy).toEqual([]);
  });

  // ---- Hints

  it("gives every hint slide a question, a source and at least one hint", () => {
    for (const s of hint) {
      expect(s.questionRef).toBeTruthy();
      expect(s.source).toBeTruthy();
      expect(s.hints.length).toBeGreaterThan(0);
    }
  });

  it("points every hint back at a slide in the learn act", () => {
    const learnIds = new Set(learn.map((s) => s.id));
    const dangling = hint
      .flatMap((s) => s.hints.map((h) => ({ s, h })))
      .filter(({ h }) => !learnIds.has(h.backTo))
      .map(({ s, h }) => `${s.id} -> ${h.backTo}`);
    expect(dangling).toEqual([]);
  });

  // A hint is a first move. The moment it states the ratio or the difference
  // it has done the question, and the hint act stops being usable during the
  // work. Answers live in `answers`, behind the teacher layer.
  it("never lets a hint give the answer away", () => {
    const leaks = hint
      .flatMap((s) => s.hints.map((h) => ({ s, h })))
      .filter(({ h }) => /\b[rd]\s*=/.test(h.hint))
      .map(({ s, h }) => `${s.id}: ${h.hint}`);
    expect(leaks).toEqual([]);
  });

  it("leaves hints off the learn and review slides", () => {
    for (const s of [...learn, ...review]) {
      expect(s.hints).toEqual([]);
      expect(s.questionRef).toBeNull();
      expect(s.source).toBeNull();
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

  it("plots points that really do follow the sequence they claim", () => {
    for (const s of lesson.slides) {
      if (!s.plot) continue;
      for (const series of s.plot.series) {
        const ys = series.points.map(([, y]) => y);
        expect(ys.length).toBeGreaterThan(2);
        if (series.kind === "geometric") {
          const r = ys[1] / ys[0];
          for (let i = 1; i < ys.length; i++) expect(ys[i] / ys[i - 1]).toBeCloseTo(r, 9);
        } else if (series.kind === "arithmetic") {
          const d = ys[1] - ys[0];
          for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeCloseTo(d, 9);
        } else {
          // linear: collinear in (x, y). The x values need not be evenly
          // spaced, which is the whole reason this kind exists -- 1.7 plots
          // area against a measured boundary count, not against a term
          // number. Cross-product of the two step vectors must vanish.
          const [x0, y0] = series.points[0];
          const [x1, y1] = series.points[1];
          for (let i = 2; i < series.points.length; i++) {
            const [xi, yi] = series.points[i];
            expect((x1 - x0) * (yi - y0) - (y1 - y0) * (xi - x0)).toBeCloseTo(0, 9);
          }
        }
        for (const [x, y] of series.points) {
          expect(x).toBeLessThanOrEqual(s.plot.xMax);
          expect(y).toBeLessThanOrEqual(s.plot.yMax);
        }
      }
      expect(s.plot.yStep).toBeGreaterThan(0);
      expect(s.plot.yMax % s.plot.yStep).toBe(0);
      expect(s.plot.xStep).toBeGreaterThan(0);
      expect(s.plot.xMax % s.plot.xStep).toBe(0);
    }
  });

  it("gives the teacher an answer wherever a slide asks a check question", () => {
    for (const s of lesson.slides) {
      if (!s.check) continue;
      expect(s.check.question.length).toBeGreaterThan(0);
      expect(s.check.answer.length).toBeGreaterThan(0);
    }
  });
});

describe("lesson 1.6, specifically", () => {
  const lesson = getLesson("1-6-describing-geometric-patterns")!;
  const coverage = coverageFromHints(lesson);

  it("is published", () => {
    expect(lesson).toBeDefined();
    expect(lesson.code).toBe("1.6");
  });

  it("runs in three acts", () => {
    expect(slidesInAct(lesson, "learn").length).toBeGreaterThan(0);
    expect(slidesInAct(lesson, "hint").length).toBeGreaterThan(0);
    expect(slidesInAct(lesson, "review").length).toBeGreaterThan(0);
  });

  it("has one hint slide per worksheet question", () => {
    const bySource = (s: string) => slidesInAct(lesson, "hint").filter((x) => x.source === s).length;
    expect(bySource("exploration")).toBe(7);
    expect(bySource("check-your-understanding")).toBe(2);
    expect(bySource("homework")).toBe(10);
  });

  // The census the review established: 7 exploration items, 7 Check Your
  // Understanding items (Q1 a-d and Q2 a-c), 19 homework items.
  it("covers all 33 question parts across both worksheets", () => {
    const parts = (s: string) => coverage.filter((c) => c.source === s).length;
    expect(parts("exploration")).toBe(7);
    expect(parts("check-your-understanding")).toBe(7);
    expect(parts("homework")).toBe(19);
    expect(coverage.length).toBe(33);
  });

  // The primer runs BEFORE students explore. The exploration is a knockout
  // tournament that halves 64 teams, and a primer that works that context
  // has answered exploration Q1, Q2, Q4 and Q5 in advance. Scoped to LEARN
  // slides on purpose: a hint slide names the question freely, because by
  // then the student is holding the worksheet.
  it("never uses the exploration's own context in a primer learn slide", () => {
    const primerText = slidesInAct(lesson, "learn")
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

  it("teaches direction as sign-aware, not as a fact about r alone", () => {
    const slide = lesson.slides.find((s) => s.id === "increasing-or-decreasing")!;
    const all = [...slide.body, ...slide.examples.flatMap((e) => [...e.steps, e.answer])].join(" ");
    expect(all).toContain("-100");
    expect(all).toMatch(/INCREASING/);
    // And the size-only slide must say out loud that it is not the whole story.
    const sizeSlide = lesson.slides.find((s) => s.id === "what-r-does-to-size")!;
    expect(sizeSlide.table?.caption).toMatch(/next slide/i);
  });

  it("teaches both explicit rules, because homework Q6(a) leaves the kind open", () => {
    const geo = lesson.slides.find((s) => s.id === "nth-term-geometric")!;
    const ari = lesson.slides.find((s) => s.id === "nth-term-arithmetic")!;
    expect(geo.body.join(" ")).toContain("a_1 \\cdot r^{\\,n-1}");
    expect(ari.body.join(" ")).toContain("a_1 + (n-1)d");
  });

  it("names the misconceptions that produce the likeliest wrong answers", () => {
    const text = lesson.misconceptions.map((m) => m.misconception + m.howToFixIt).join(" ");
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

  it("puts the exit ticket and its rubric in the review act", () => {
    const exit = slidesInAct(lesson, "review").find((s) => s.id === "review-exit-ticket")!;
    expect(exit).toBeDefined();
    expect(exit.table?.rows).toHaveLength(3);
    expect(lesson.exitTicket.rubric).toHaveLength(3);
  });

  it("has a primer short enough to teach before the exploration", () => {
    const primerMinutes = slidesInAct(lesson, "learn")
      .filter((s) => s.phase === "primer")
      .reduce((sum, s) => sum + s.minutes, 0);
    expect(primerMinutes).toBeLessThanOrEqual(20);
  });
});

describe("lesson 1.7, specifically", () => {
  const lesson = getLesson("1-7-connecting-patterns-across-representations")!;
  const coverage = coverageFromHints(lesson);

  it("is published", () => {
    expect(lesson).toBeDefined();
    expect(lesson.code).toBe("1.7");
  });

  it("has one hint slide per worksheet question", () => {
    const bySource = (s: string) => slidesInAct(lesson, "hint").filter((x) => x.source === s).length;
    expect(bySource("exploration")).toBe(5);
    expect(bySource("check-your-understanding")).toBe(2);
    expect(bySource("homework")).toBe(0);
  });

  // Exploration Q1-Q5 and Check Your Understanding Q1, Q2(a), Q2(b). Q1 of
  // the exploration gets two hints because counting the points and finding
  // the area are genuinely different first moves.
  it("covers every question part on the sheet", () => {
    expect(coverage.filter((c) => c.source === "exploration").length).toBe(6);
    expect(coverage.filter((c) => c.source === "check-your-understanding").length).toBe(3);
    expect(coverage.length).toBe(9);
  });

  // The exploration IS the discovery of A = B/2 + 1. A primer slide that
  // states it, or that pairs a boundary count with an area for the same
  // shape, has done the exploration for the student. The primer teaches the
  // two measurements on shapes that are not on the sheet, and never states
  // both numbers for one shape.
  it("never gives the relationship away in a primer slide", () => {
    const primer = slidesInAct(lesson, "learn").filter((s) => s.phase === "primer");
    const text = primer
      .flatMap((s) => [
        s.title,
        ...s.body,
        ...s.examples.flatMap((e) => [e.title, ...e.steps, e.answer]),
        s.check?.question ?? "",
        s.check?.answer ?? "",
      ])
      .join(" ")
      .toLowerCase();

    // The rule itself, in any of the forms it is written elsewhere.
    for (const spoiler of ["b + 1", "\\tfrac{1}{2}b", "pick", "interior point", "6.5", "51"]) {
      expect(text).not.toContain(spoiler);
    }
    // And no primer slide may pair a boundary count with an area.
    for (const s of primer) {
      const own = [...s.body, ...s.examples.flatMap((e) => [...e.steps, e.answer])].join(" ").toLowerCase();
      const namesPoints = own.includes("boundary point");
      const namesArea = own.includes("area");
      expect(`${s.id}: points=${namesPoints} area=${namesArea}`).not.toBe(`${s.id}: points=true area=true`);
    }
  });

  it("teaches the four representations by name", () => {
    const slide = lesson.slides.find((s) => s.id === "four-representations")!;
    const cells = (slide.table?.rows ?? []).map((r) => r[0].toLowerCase());
    for (const r of ["table", "graph", "words", "equation"]) {
      expect(cells).toContain(r);
    }
  });

  it("records why the rule works, which the worksheet never says", () => {
    const items = lesson.openQuestions
      .map((q) => [q.item, q.whyUnresolved, q.whatWasDone].join(" "))
      .join(" ");
    expect(items).toContain("interior dots");
    // And the teacher is told it on the review slide, not only in the notes.
    const review = lesson.slides.find((s) => s.id === "review-the-rule")!;
    expect(review.teacherNote).toContain("Pick");
  });

  it("flags the duplicated figure label and the missing homework sheet", () => {
    const items = lesson.openQuestions.map((q) => q.item).join(" ");
    expect(items).toContain("C twice");
    expect(items).toContain("homework");
  });

  it("has a primer short enough to teach before the exploration", () => {
    const primerMinutes = slidesInAct(lesson, "learn")
      .filter((s) => s.phase === "primer")
      .reduce((sum, s) => sum + s.minutes, 0);
    expect(primerMinutes).toBeLessThanOrEqual(20);
  });
});

describe("lesson 2.1, specifically", () => {
  const lesson = getLesson("2-1-proportional-reasoning")!;
  const coverage = coverageFromHints(lesson);

  it("is published, and opens unit 2", () => {
    expect(lesson).toBeDefined();
    expect(lesson.code).toBe("2.1");
  });

  it("has one hint slide per worksheet question", () => {
    const bySource = (s: string) => slidesInAct(lesson, "hint").filter((x) => x.source === s).length;
    expect(bySource("exploration")).toBe(7);
    expect(bySource("check-your-understanding")).toBe(3);
  });

  // Exploration Q1-Q7, then CYU Q1(a)-(e), Q2 and Q3.
  it("covers every question part on the sheet", () => {
    expect(coverage.filter((c) => c.source === "exploration").length).toBe(7);
    expect(coverage.filter((c) => c.source === "check-your-understanding").length).toBe(7);
    expect(coverage.length).toBe(14);
  });

  // Q5 and Q6 of the exploration ARE the discovery that the gas relationship
  // is proportional and starts at the origin. A primer slide that names
  // either has done the exploration for the student, and the primer also
  // avoids the gas context entirely so no worked pair is handed over.
  it("never names the discovery, or the gas context, in a primer slide", () => {
    const text = slidesInAct(lesson, "learn")
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

    for (const spoiler of ["proportional", "origin", "y = kx", "3.39", "gallon", "40.68"]) {
      expect(text).not.toContain(spoiler);
    }
  });

  // The whole lesson turns on this being said out loud, because CYU Q3 is a
  // table that starts at the origin and is NOT proportional.
  it("says the origin is necessary but not sufficient", () => {
    const slide = lesson.slides.find((s) => s.id === "through-the-origin")!;
    const body = slide.body.join(" ");
    expect(body).toContain("NOT enough");
    expect(slide.teacherNote).toContain("CYU Q3");
    // And the trap is the first of the review traps.
    const traps = lesson.slides.find((s) => s.id === "review-traps")!;
    expect(traps.body[0]).toContain("Necessary");
  });

  it("gives the t-shirt table its real per-shirt rates in the answer key", () => {
    const slide = lesson.slides.find((s) => s.id === "hint-cyu-q3")!;
    const answers = slide.answers.join(" ");
    for (const rate of ["12", "11", "10"]) expect(answers).toContain(rate);
    expect(answers).toContain("NOT proportional");
  });

  it("records the untidy Q4 answer and the image-read pump value", () => {
    const items = lesson.openQuestions
      .map((q) => [q.item, q.whyUnresolved, q.whatWasDone].join(" "))
      .join(" ");
    expect(items).toContain("9.02");
    expect(items).toContain("17.465");
  });

  it("has a primer short enough to teach before the exploration", () => {
    const primerMinutes = slidesInAct(lesson, "learn")
      .filter((s) => s.phase === "primer")
      .reduce((sum, s) => sum + s.minutes, 0);
    expect(primerMinutes).toBeLessThanOrEqual(20);
  });
});
