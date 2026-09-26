/**
 * Decisions behind POST .../ai-grade/batch/[batchId]/split, kept pure so
 * they can be unit-tested without a PDF or a database.
 */

/**
 * Whether a segment can be served by copying the batch's source PDF as-is
 * in Storage, instead of downloading it, rebuilding a new PDF from the
 * chosen pages with pdf-lib, and uploading the result.
 *
 * True when the segment claims every page of the source except pages the
 * segmentation pass confirmed blank. That is exactly the shape of a part
 * cut from an oversized upload (lib/batch-chunking.ts): the cutter lands
 * each part on a cover page, so a part is usually one student's whole
 * booklet plus its unused back page. Sending that blank page along with
 * the script changes nothing for marking, and skipping the rebuild means
 * the split costs one Storage-side copy rather than shuttling 12-18MB in
 * and out of a serverless function -- which is what made a class-sized
 * upload, with every part splitting at once, run past the function's
 * time limit.
 */
export function canCopySourceWhole(
  segmentPages: number[],
  pageCount: number,
  blankPages: number[]
): boolean {
  if (pageCount < 1) return false;
  const claimed = new Set(segmentPages);
  const blank = new Set(blankPages);
  for (let page = 1; page <= pageCount; page++) {
    if (!claimed.has(page) && !blank.has(page)) return false;
  }
  return true;
}

/**
 * One student's pages as the teacher confirmed them, as stored in
 * ai_grade_batches.confirmed_segments -- and, from 24 Sep 2026, what the split
 * did with them.
 *
 * The outcome used to live only in the split route's HTTP response. When one
 * student's upload failed there (a 9C student's, on Key Assessment 1's scan,
 * 15 Sep 2026), the batch was still marked split with every segment
 * confirmed, the tab that had shown "1 could not be sent" was closed, and
 * nothing anywhere said she had never been marked -- until she self-assessed
 * and found no ClevMarks nine days later.
 */
export interface ConfirmedSegment {
  label: string;
  pages: number[];
  matchedStudentId: string;
  /** Where this student's scan was stored. Absent on segments split before 24 Sep 2026. */
  storagePath?: string | null;
  /** Why it could not be stored, when it could not. */
  splitError?: string | null;
}

/** What the split did with one student's pages. */
export interface SplitOutcome {
  studentId: string;
  status: "split" | "failed";
  storagePath?: string;
  error?: string;
}

/**
 * The confirmed segments with each student's split outcome written onto their
 * own row. A segment with no outcome here keeps what it already had, which is
 * what lets a retry of one student update only that student.
 */
export function withSplitOutcomes(
  segments: readonly ConfirmedSegment[],
  outcomes: readonly SplitOutcome[]
): ConfirmedSegment[] {
  const byStudent = new Map(outcomes.map((o) => [o.studentId, o]));
  return segments.map((s) => {
    const o = byStudent.get(s.matchedStudentId);
    if (!o) return { ...s };
    return o.status === "split" && o.storagePath
      ? { ...s, storagePath: o.storagePath, splitError: null }
      : { ...s, storagePath: null, splitError: o.error?.trim() || "The scan could not be stored." };
  });
}

/**
 * ai_grade_batches.confirmed_segments as stored, read defensively: it is jsonb
 * written by more than one version of the split route, so a row that is not
 * a usable segment is dropped rather than trusted.
 */
export function parseConfirmedSegments(value: unknown): ConfirmedSegment[] {
  if (!Array.isArray(value)) return [];
  const out: ConfirmedSegment[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.matchedStudentId !== "string" || !r.matchedStudentId) continue;
    const pages = Array.isArray(r.pages)
      ? r.pages.filter((p): p is number => typeof p === "number" && Number.isInteger(p) && p >= 1)
      : [];
    out.push({
      label: typeof r.label === "string" ? r.label : "",
      pages,
      matchedStudentId: r.matchedStudentId,
      storagePath: typeof r.storagePath === "string" && r.storagePath ? r.storagePath : null,
      splitError: typeof r.splitError === "string" && r.splitError ? r.splitError : null,
    });
  }
  return out;
}
