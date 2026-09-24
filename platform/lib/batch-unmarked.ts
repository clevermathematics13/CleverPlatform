import { parseConfirmedSegments } from "./batch-split";

/**
 * Students a batch scan was confirmed for who have no marking of any kind on
 * the test -- no complete run, no failed one, nothing queued overnight.
 *
 * Every confirmed student is handed to marking straight after the split, so
 * one with no run at all is one the flow dropped: their pages could not be
 * stored (the split records that on the segment -- see ConfirmedSegment),
 * their overnight submission was refused, or the tab was closed part-way
 * through marking a class one student at a time. Before this existed the
 * roster showed such a student exactly like one who had not handed a script
 * in, and on 9C's Key Assessment 1 nobody noticed for nine days.
 *
 * Pure: the overview loader (lib/ai-grade-overview.ts) feeds it the test's
 * split batches and the subjects that have runs.
 */

/** The subset of an ai_grade_batches row this needs. */
export interface SplitBatchRef {
  id: string;
  file_name: string | null;
  status: string;
  confirmed_segments: unknown;
  created_at: string;
}

/** One confirmed-but-never-marked student, with what it takes to recover them. */
export interface UnmarkedBatchStudent {
  /** The opaque grading subject (a profiles.id, or "invited-<id>"). */
  studentId: string;
  batchId: string;
  fileName: string | null;
  /** The cover-page label the segment was confirmed under. */
  label: string;
  /** The student's pages, numbered within the batch's own PDF. */
  pages: number[];
  /** The per-student scan the split stored, when it recorded one. */
  storagePath: string | null;
  /** Why the split could not store it, when it recorded that instead. */
  splitError: string | null;
}

/**
 * @param handled   every subject id with at least one run on the test, in the
 *                  opaque form (formatGradingSubject)
 * @param sameAs    an invited subject id ("invited-<id>") mapped to the profile
 *                  that roster row has since signed in as, so a student
 *                  confirmed before their first login and marked after it is
 *                  not flagged
 */
export function findUnmarkedBatchStudents(
  batches: readonly SplitBatchRef[],
  handled: ReadonlySet<string>,
  sameAs: ReadonlyMap<string, string> = new Map()
): UnmarkedBatchStudent[] {
  const isHandled = (subject: string) => {
    if (handled.has(subject)) return true;
    const profile = sameAs.get(subject);
    return !!profile && handled.has(profile);
  };

  // Newest batch first, so a student confirmed in two uploads of the same
  // pile is recovered from the latest one.
  const newestFirst = [...batches]
    .filter((b) => b.status === "split")
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));

  const seen = new Set<string>();
  const out: UnmarkedBatchStudent[] = [];
  for (const batch of newestFirst) {
    for (const segment of parseConfirmedSegments(batch.confirmed_segments)) {
      const subject = segment.matchedStudentId;
      if (seen.has(subject)) continue;
      seen.add(subject);
      if (isHandled(subject)) continue;
      out.push({
        studentId: subject,
        batchId: batch.id,
        fileName: batch.file_name,
        label: segment.label,
        pages: [...segment.pages].sort((a, b) => a - b),
        storagePath: segment.storagePath ?? null,
        splitError: segment.splitError ?? null,
      });
    }
  }
  return out;
}

/** "157-168", "1-3, 7" -- a student's pages as the roster flag names them. */
export function formatPageRanges(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++;
    parts.push(sorted[i] === start ? `${start}` : `${start}-${sorted[i]}`);
  }
  return parts.join(", ");
}
