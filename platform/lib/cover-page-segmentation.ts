import type { Confidence, SegmentedStudent } from "./ai-grading";
import type { CoverPageCheck } from "./na-scanning";

/**
 * Segmenting a formative-assessment batch scan by checking EVERY page for a
 * cover page, instead of handing the whole document to the segmentation
 * model ("Quick read" vs "Deep read").
 *
 * The NA pipeline already segments this way and can afford to be clever
 * about it (scanCoverPages in lib/na-scanning.ts): an NA packet has a KNOWN
 * fixed page count, so the boundaries are nearly determined already and only
 * the pages near each expected boundary need checking. A formative
 * assessment has no such number -- the tests table stores no pages-per-
 * student and its PDFs are generated transiently -- so there are no expected
 * boundaries to search around and every page has to be asked about.
 *
 * That is still far cheaper than the whole-document Opus read it replaces.
 * One Haiku call per page at ~2.35K input tokens is ~0.3 cents/page, against
 * ~1 cent/page for Opus reading the document in one go (~$1.00 of the $3.00
 * an 84-page scan costs today). And because every request carries exactly
 * ONE page, neither Anthropic's 100-page document limit nor its 32MB request
 * limit can ever be reached, whatever the scan's length or resolution.
 *
 * What Quick read gives up is the ability to reattribute a page to a student
 * whose cover page is elsewhere: it builds segments purely by position, each
 * student running from their cover page to the page before the next cover.
 * A scan of loose sheets shuffled out of order still needs Deep read, which
 * is why that stays available as an opt-in.
 *
 * Blank pages are deliberately NOT this module's problem: the route runs
 * detectBlankPages (lib/blank-pages.ts) as a post-pass over unassignedPages,
 * exactly as it already does for the Deep read path.
 *
 * Nothing here calls a model or touches the database -- planning is pure and
 * the page check is injected, so both halves are testable with fakes.
 */

/** How many single-page cover checks are in flight at once. */
export const QUICK_READ_CONCURRENCY = 6;

/**
 * The most pages Quick read will check in one request. A cover check takes
 * ~3s, so at QUICK_READ_CONCURRENCY in flight 300 pages is ~150s of the 300s
 * a serverless request gets, leaving margin for downloading the scan and for
 * individual slow calls. The route uses this to decide when a very long scan
 * has to be cut into parts instead of read in one pass.
 */
export const QUICK_READ_MAX_PAGES = 300;

/** One page's answer to "is this the first page of a student's script?". */
export interface CoverPageVerdict {
  /** 1-indexed page in the source document. */
  page: number;
  isCoverPage: boolean;
  studentName: string | null;
  rosterMatch: string | null;
  confidence: Confidence;
  note: string;
  /** The model call threw, or answered with something unusable. */
  checkFailed?: boolean;
}

export interface CoverPageSegmentationPlan {
  students: SegmentedStudent[];
  /** Pages belonging to no student -- only ever the run before the first cover page. */
  unassignedPages: number[];
  warnings: string[];
}

/** Whether a page's name fields yield a usable label. */
function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** "3" for a single page, "3-7" for a run. */
function pageRange(first: number, last: number): string {
  return first === last ? `${first}` : `${first}-${last}`;
}

/**
 * Build per-student page ranges from one verdict per page.
 *
 * Pure and synchronous: a cover page opens a student, every following
 * non-cover page joins them, and the last student runs to the end of the
 * document. Verdicts may arrive in any order (the checks run concurrently)
 * and any that fall outside 1..pageCount are ignored.
 *
 * Every page 1..pageCount lands in exactly one student's pages or in
 * unassignedPages -- the route splits the PDF by this mapping, so a page
 * that appears twice would be graded twice and a page that appears nowhere
 * would be silently dropped.
 */
export function planSegmentsFromCoverVerdicts(
  pageCount: number,
  verdicts: CoverPageVerdict[]
): CoverPageSegmentationPlan {
  if (pageCount < 1) return { students: [], unassignedPages: [], warnings: ["Empty document."] };

  // First verdict wins for a page, so a caller that retried a check cannot
  // change the plan depending on which answer happened to land last.
  const byPage = new Map<number, CoverPageVerdict>();
  for (const v of verdicts) {
    if (!Number.isInteger(v.page) || v.page < 1 || v.page > pageCount) continue;
    if (!byPage.has(v.page)) byPage.set(v.page, v);
  }

  const students: SegmentedStudent[] = [];
  const unassignedPages: number[] = [];
  const warnings: string[] = [];
  let open: SegmentedStudent | null = null;

  for (let page = 1; page <= pageCount; page++) {
    const verdict = byPage.get(page);

    // A check that failed, or never ran at all, is treated as a continuation
    // page: a missing answer must never start a student (inventing a split
    // mid-script) nor end one (orphaning the rest of a script), so it stays
    // with whoever is open and the teacher is told which page to look at.
    if (!verdict || verdict.checkFailed) {
      warnings.push(
        verdict
          ? `Page ${page} could not be checked, so it was kept with the student before it -- check whether a new student starts there.`
          : `Page ${page} was never checked, so it was kept with the student before it -- check whether a new student starts there.`
      );
      if (open) open.pages.push(page);
      else unassignedPages.push(page);
      continue;
    }

    if (!verdict.isCoverPage) {
      if (open) open.pages.push(page);
      else unassignedPages.push(page);
      continue;
    }

    // Prefer the roster match over the raw handwriting read, as labelFor in
    // lib/na-scanning.ts does: a rosterMatch is constrained recognition
    // against the real class list, not open-vocabulary handwriting OCR.
    const label =
      trimmedOrNull(verdict.rosterMatch) ??
      trimmedOrNull(verdict.studentName) ??
      `(name unreadable, page ${page})`;
    if (!trimmedOrNull(verdict.rosterMatch) && !trimmedOrNull(verdict.studentName)) {
      warnings.push(
        `The cover page on page ${page} has no readable name -- pick the student for it by hand in the review table.`
      );
    }

    open = { label, pages: [page], confidence: verdict.confidence, note: verdict.note };
    students.push(open);
  }

  // The document-level problem is what the teacher acts on first, so it
  // leads the list ahead of the per-page notes gathered above.
  if (students.length === 0) {
    warnings.unshift(
      `No cover page was found on any of the ${pageCount} pages, so no students could be identified. Try Deep read, which reads the whole scan at once.`
    );
  } else if (unassignedPages.length > 0) {
    warnings.unshift(
      `Page(s) ${pageRange(unassignedPages[0], unassignedPages[unassignedPages.length - 1])} come before the first cover page, so no student could be assigned to them. If this scan has loose sheets shuffled out of order, try Deep read.`
    );
  }

  return { students, unassignedPages, warnings };
}

/** A verdict for a page whose check threw or answered with nothing usable. */
function failedVerdict(page: number, note: string): CoverPageVerdict {
  return {
    page,
    isCoverPage: false,
    studentName: null,
    rosterMatch: null,
    confidence: "low",
    note,
    checkFailed: true,
  };
}

function isConfidence(value: unknown): value is Confidence {
  return value === "high" || value === "medium" || value === "low";
}

/** Runs `task` over `items` with at most `width` in flight, results in order. */
async function runPool<T, R>(items: T[], width: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await task(items[i]);
    }
  };
  await Promise.all(Array.from({ length: width }, worker));
  return results;
}

export interface SegmentByCoverPagesOptions {
  pageCount: number;
  /**
   * Whether the given 1-indexed page is the first page of a student's
   * script, and whose it is. Called once for every page, concurrently.
   */
  checkPage: (page: number) => Promise<CoverPageCheck>;
  concurrency?: number;
}

/**
 * Check every page of a scan for a cover page and plan the segments.
 *
 * One page's check never fails the upload: a throw or an unusable answer
 * becomes a checkFailed verdict, which planSegmentsFromCoverVerdicts keeps
 * with the student before it and warns about. Losing a whole class scan to
 * one overloaded request would be far worse than one flagged page.
 *
 * pagesChecked counts every page attempted (failures included) -- it is the
 * cost driver the route logs.
 */
export async function segmentByCoverPages(
  opts: SegmentByCoverPagesOptions
): Promise<CoverPageSegmentationPlan & { pagesChecked: number }> {
  const { pageCount, checkPage } = opts;
  if (pageCount < 1) return { ...planSegmentsFromCoverVerdicts(pageCount, []), pagesChecked: 0 };

  const pages = Array.from({ length: pageCount }, (_, i) => i + 1);
  const width = Math.max(1, Math.min(opts.concurrency ?? QUICK_READ_CONCURRENCY, pageCount));

  const verdicts = await runPool(pages, width, async (page): Promise<CoverPageVerdict> => {
    let check: CoverPageCheck;
    try {
      check = await checkPage(page);
    } catch (e) {
      return failedVerdict(page, e instanceof Error ? e.message : String(e));
    }
    // The caller validates the model's answer against CoverPageCheckSchema,
    // but a null/malformed one arriving here must be flagged rather than
    // read as a confident "not a cover page".
    if (!check || typeof check.isCoverPage !== "boolean") {
      return failedVerdict(page, "Unreadable answer");
    }
    return {
      page,
      isCoverPage: check.isCoverPage,
      studentName: check.studentName ?? null,
      rosterMatch: check.rosterMatch ?? null,
      confidence: isConfidence(check.confidence) ? check.confidence : "low",
      note: check.note ?? "",
    };
  });

  return { ...planSegmentsFromCoverVerdicts(pageCount, verdicts), pagesChecked: verdicts.length };
}
