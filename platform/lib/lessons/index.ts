import type { Lesson } from "./types";
import { lesson16 } from "./lesson-1-6";
import { lesson17 } from "./lesson-1-7";

export type { Lesson } from "./types";

/** The published lessons, in the order the index page lists them.
 *
 *  Adding one is: write `lesson-<code>.ts` beside this file, import it, and
 *  put it in this array. lessons.test.ts then checks its mathematics spans,
 *  its coverage map and its slide ids without anyone having to remember to
 *  write a test for it. */
const LESSONS: Lesson[] = [lesson16, lesson17];

export function listLessons(): {
  slug: string;
  code: string;
  title: string;
  courseLabel: string;
  summary: string;
  learnCount: number;
  hintCount: number;
  minutes: number;
}[] {
  return LESSONS.map((l) => ({
    slug: l.slug,
    code: l.code,
    title: l.title,
    courseLabel: l.courseLabel,
    // The big idea doubles as the card summary. It is one sentence written
    // for a student, which is exactly what the card wants, and keeping one
    // copy means the card can never drift from the lesson.
    summary: stripMath(l.bigIdea),
    // Counted per act rather than in total. "43 slides" is true and reads as
    // a wall; what a student wants to know is how much there is to READ, and
    // separately that there is a hint waiting for every question.
    learnCount: l.slides.filter((s) => s.act === "learn").length,
    hintCount: l.slides.filter((s) => s.act === "hint").length,
    // Minutes are the teaching time, so only the learn act counts: the hint
    // act is opened one slide at a time during the work, not taught.
    minutes: l.slides.filter((s) => s.act === "learn").reduce((sum, s) => sum + s.minutes, 0),
  }));
}

export function getLesson(slug: string): Lesson | null {
  return LESSONS.find((l) => l.slug === slug) ?? null;
}

/** All lessons, for tests and for anything that needs to walk the set. */
export function allLessons(): Lesson[] {
  return LESSONS;
}

/** The index card is plain text, not a KaTeX surface, so a `$...$` span
 *  would print its own delimiters there. Strip them and keep the contents,
 *  which read fine unstyled for the short expressions a big idea carries. */
function stripMath(text: string): string {
  return text.replace(/\$([^$\n]*?)\$/g, "$1");
}
