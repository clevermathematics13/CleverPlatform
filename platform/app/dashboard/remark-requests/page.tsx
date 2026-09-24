import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadTeacherRemarkQueue, RESOLVED_WINDOW_DAYS } from "@/lib/remark-requests-service";
import { RemarkRequestsClient } from "./remark-requests-client";

/**
 * Re-mark requests: every part a student has asked to be re-marked after
 * comparing their self-assessment with ClevMarks, waiting for an answer,
 * across every test. Answered here as "Mark changed" (which writes the new
 * ClevMark, as a gradebook edit does) or "Mark stands", with an optional
 * note the student reads beside the part.
 */
export default async function RemarkRequestsPage() {
  await requireTeacher();
  const supabase = await createClient();
  const queue = await loadTeacherRemarkQueue(supabase);

  return (
    <div className="max-w-5xl">
      <h1 className="mb-1 text-2xl font-bold text-da-amber">Re-mark Requests</h1>
      <p className="mb-6 text-sm text-da-muted">
        Parts students have asked you to re-mark after comparing their self-assessment with
        ClevMarks, oldest first. A waiting request does not count against the student&apos;s
        disagreement, so it does not hold their corrections upload shut; once you answer, the
        part counts again.
      </p>
      {queue.error ? (
        <div className="rounded-md border border-red-500/40 bg-red-900/35 p-4 text-sm text-red-100">
          Re-mark requests could not be loaded: {queue.error}
        </div>
      ) : (
        <RemarkRequestsClient
          waiting={queue.waiting}
          resolved={queue.resolved}
          schemes={queue.schemes}
          resolvedWindowDays={RESOLVED_WINDOW_DAYS}
        />
      )}
    </div>
  );
}
