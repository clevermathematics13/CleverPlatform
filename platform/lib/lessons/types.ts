/** Mini lesson content, authored in this repo rather than in the database.
 *
 *  WHY STATIC, AND WHEN TO STOP BEING STATIC
 *  ----
 *  This is the first thing in CleverPlatform that a STUDENT reads which does
 *  not come out of Postgres, so the choice is deliberate and worth writing
 *  down. A mini lesson is read-only, authored by the one teacher who also
 *  deploys, and read by ~20 students. A table buys nothing against that, and
 *  costs a migration against a live database with real student data and no
 *  staging environment.
 *
 *  The dead `lessons` table in SCHEMA.md is NOT the home for this. It has
 *  zero rows, its only content column is `mdx_content_path` (an MDX pipeline
 *  that was never built -- there is no @next/mdx in next.config.ts), its
 *  `topic_id` is NOT NULL against a `topics` table that is also empty, and
 *  its SELECT policy is `USING (true)` granted to PUBLIC, so a row in it is
 *  readable with the anon key by anyone on the internet. Do not revive it.
 *
 *  Move to the database the moment ANY of these becomes true:
 *    (a) students write something against a lesson -- progress, answers,
 *        a completion tick. That needs a row id to key on.
 *    (b) a lesson must be released or hidden per course or per class.
 *    (c) the teacher must edit a lesson without a deploy.
 *  At that point write a NEW table modelled on `practice_sets`, and keep
 *  these types as the shape its content column carries.
 *
 *  A TypeScript module rather than a .md file on disk, because a .md would
 *  need fs.readFileSync with two literal path segments to survive Vercel's
 *  file tracing (see lib/na-assessment.ts), and would rot silently the way
 *  templates/nuanced_analysis_template.tex did. A module that stops being
 *  imported is a compile-time fact.
 *
 *  AUTHORING RULES, enforced by lessons.test.ts
 *  ----
 *  - Every mathematical value goes inside `$...$`. Question labels such as
 *    "Q7(b)" stay as plain text.
 *  - An inline `$...$` span must never contain a newline: splitSegments() in
 *    components/LatexRenderer.tsx excludes \n from the inline character
 *    class, so a wrapped span renders as literal dollars and raw LaTeX.
 *    Every string below is therefore ONE LINE, and arrays carry the breaks.
 *  - Never join two expressions with two spaces; the renderer collapses
 *    runs of spaces and they become one run-on line. Use a new array entry,
 *    or `\quad` inside a single span.
 *  - ASCII only. No en-dashes, em-dashes, curly quotes or box-drawing.
 */

/** Where a slide sits relative to the exploration activity. A `primer` slide
 *  is safe to teach BEFORE students explore; a `formalise` slide names what
 *  they found afterwards. The split is load-bearing: a primer that works the
 *  exploration's own context has answered it for them. */
export type LessonPhase = "primer" | "formalise";

export interface WorkedExample {
  title: string;
  /** One line per step. Every step shown -- this is Grade 9. */
  steps: string[];
  answer: string;
}

export interface LessonTable {
  caption: string;
  headers: string[];
  /** Every row carries exactly `headers.length` cells. */
  rows: string[][];
}

/** A sequence plotted on axes. Drawn as inline SVG rather than through
 *  components/IbGraph.tsx, which hardcodes `bg-white` and must be mounted
 *  with dynamic({ssr:false}) -- a bright white card mid-lesson, and a
 *  client boundary, for what is four points and two axes. */
export interface SequencePlot {
  caption: string;
  xLabel: string;
  yLabel: string;
  xMax: number;
  yMax: number;
  /** The y-axis interval, chosen deliberately. Plotting 64 down to 2 in
   *  steps of 1 runs off the page, which is the point of the example. */
  yStep: number;
  series: {
    label: string;
    kind: "geometric" | "arithmetic";
    points: [number, number][];
  }[];
}

export interface CheckQuestion {
  question: string;
  answer: string;
}

/** An extension task for a student who finishes early. Separate from
 *  CheckQuestion because it is a piece of work to go and do, not a question
 *  to answer in your head -- and because both of these deliberately pick up
 *  the lesson's own loose ends (the negative root, the decade-versus-year
 *  wording) rather than being harder arithmetic. */
export interface ChallengeTask {
  task: string;
  answer: string;
}

export interface LessonSlide {
  /** Stable kebab-case id. It is the anchor in the URL and the key the
   *  coverage map points at, so renaming one is a breaking change. */
  id: string;
  title: string;
  phase: LessonPhase;
  minutes: number;
  /** The core spine a 45-minute period must cover. Everything else is day
   *  two or as-needed, which is what `pacing` explains. */
  core: boolean;
  /** Teacher-facing. Names the source questions this slide unlocks. */
  purpose: string;
  /** Student-facing, one line per entry. */
  body: string[];
  examples: WorkedExample[];
  table: LessonTable | null;
  plot: SequencePlot | null;
  check: CheckQuestion | null;
  /** Commentary only. Answers live in `answers` so a teacher scanning
   *  mid-class finds them under their own heading instead of buried in the
   *  last clause of a paragraph. */
  teacherNote: string;
  answers: string[];
}

export interface VocabularyEntry {
  term: string;
  definition: string;
  example: string;
}

export interface Misconception {
  misconception: string;
  whyItHappens: string;
  howToFixIt: string;
}

/** One question of the source worksheets, mapped to the slide that equips a
 *  student for it. The map is exhaustive by test: every question in both
 *  documents appears exactly once. */
export interface CoverageEntry {
  source: "exploration" | "check-your-understanding" | "homework";
  question: string;
  demand: string;
  slideId: string;
}

/** Something the author could not settle from the source material. Recorded
 *  rather than guessed, so the teacher knows to check it against the printed
 *  worksheet before handing the lesson out. */
export interface OpenQuestion {
  item: string;
  whyUnresolved: string;
  whatWasDone: string;
}

export interface Lesson {
  slug: string;
  /** Course-facing lesson number, e.g. "1.6". */
  code: string;
  title: string;
  /** Which class this was written for, in the teacher's own words. */
  courseLabel: string;
  bigIdea: string;
  pacing: string;
  prerequisites: string[];
  warmUp: CheckQuestion[];
  learningTargets: string[];
  vocabulary: VocabularyEntry[];
  slides: LessonSlide[];
  misconceptions: Misconception[];
  exitTicket: { task: string; rubric: string[] };
  challenge: ChallengeTask[];
  coverageMap: CoverageEntry[];
  openQuestions: OpenQuestion[];
  /** The worksheets this lesson is the key to. Titles only -- the PDFs
   *  themselves are handed out on paper or through Google Classroom. */
  materials: string[];
}
