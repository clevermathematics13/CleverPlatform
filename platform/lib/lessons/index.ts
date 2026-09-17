import type { Lesson } from "./types";
import { lesson16 } from "./lesson-1-6";

export type { Lesson } from "./types";

/** The published lessons, in the order the index page lists them.
 *
 *  Adding one is: write `lesson-<code>.ts` beside this file, import it, and
 *  put it in this array. lessons.test.ts then checks its mathematics spans,
 *  its coverage map and its slide ids without anyone having to remember to
 *  write a test for it. */
const LESSONS: Lesson[] = [lesson16];

export function listLessons(): {
  slug: string;
  code: string;
  title: string;
  courseLabel: string;
  summary: string;
  slideCount: number;
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
    slideCount: l.slides.length,
    minutes: l.slides.reduce((sum, s) => sum + s.minutes, 0),
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
