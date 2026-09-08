/**
 * Rebuilding the PowerSchool file a class's self-assessment progress is named
 * after.
 *
 * Called on the student's submit and from the teacher-side paths that change
 * marks (app/api/gradebook/self-assessment-export), but it lives here rather
 * than in the route so the thing that writes the file can be run and checked
 * directly -- a verification script that recomposed these steps itself would
 * drift from what production does, silently, and only be found out once it had
 * written a wrong file.
 *
 * Two triggers, because two different things change what the file should say:
 *
 * - A student finishing a self-assessment moves the count the file is named
 *   after, and is rare enough to rebuild on the spot.
 * - A teacher changing marks moves the levels inside it, and is not: the
 *   gradebook saves one cell at a time. So a mark write only sets the stale
 *   flag (markExportsStale), and the rebuild happens a few seconds after the
 *   typing stops, or at the download if nothing got round to it first.
 */

import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { selfAssessmentExportFilename } from "@/lib/assessment-short-name";
import { buildScoreRows, loadStoredTemplate, scoreMapFor } from "@/lib/powerschool-rows";
import { fillPstScores, retargetPst, PstFormatError } from "@/lib/pst-fill";

export const BUCKET = "powerschool-exports";

/** Built inside the handler, not at module scope, so `next build`'s page-data
 *  collection does not throw where the service key is absent. */
export function serviceClient(): SupabaseClient {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Stable per class and assessment: the count lives in the recorded filename,
 *  so the object is overwritten rather than piling up one file per submit. */
export const storagePathFor = (courseId: string, testId: string) => `${courseId}/${testId}.csv`;

/**
 * Rebuild and store the file for one class and assessment.
 *
 * Always scope=self. The whole point of the name is that the number in it says
 * how many students the file covers, and a file that also carried levels for
 * students who have not reviewed their marks would make that number a lie.
 *
 * Returns null when there is nothing to write: no stored template for the
 * class (the teacher has not uploaded one yet), or a template we cannot parse.
 * Neither is the student's problem, and neither should fail their submit.
 */
export async function regenerateSelfAssessmentExport(
  service: SupabaseClient,
  courseId: string,
  testId: string
): Promise<{ filename: string; completedCount: number } | null> {
  const built = await buildScoreRows(service, testId, courseId, true);
  if ("error" in built) return null;

  const stored = await loadStoredTemplate(service, courseId);
  if (!stored) return null;

  const aimed =
    stored.source_test_id === testId
      ? stored.template
      : retargetPst(stored.template, {
          assignmentName: built.testName,
          dueDate: built.testDate,
        });

  let result;
  try {
    result = fillPstScores(aimed, scoreMapFor(built.rows));
  } catch (e) {
    if (e instanceof PstFormatError) return null;
    throw e;
  }

  const filename = selfAssessmentExportFilename(
    built.courseName,
    { name: built.testName, short_name: built.testShortName },
    built.completedCount
  );
  const storagePath = storagePathFor(courseId, testId);

  const { error: uploadError } = await service.storage
    .from(BUCKET)
    .upload(storagePath, new Blob([result.csv], { type: "text/csv" }), {
      upsert: true,
      contentType: "text/csv",
    });
  if (uploadError) throw new Error(`Could not store the export: ${uploadError.message}`);

  const { error: rowError } = await service.from("powerschool_export_files").upsert(
    {
      course_id: courseId,
      test_id: testId,
      storage_path: storagePath,
      filename,
      completed_count: built.completedCount,
      roster_count: built.rosterCount,
      filled_count: result.filled,
      stale: false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "course_id,test_id" }
  );
  if (rowError) throw new Error(`Could not record the export: ${rowError.message}`);

  return { filename, completedCount: built.completedCount };
}

/**
 * Note that the marks behind an assessment's exports have changed.
 *
 * Deliberately the cheapest possible write -- one UPDATE over at most a
 * handful of rows, no rebuild -- because the gradebook calls the routes that
 * call this once per cell. The rebuild is someone else's job: the gradebook
 * asks for one when the teacher stops typing, and the download does it before
 * serving a file this flag says is out of date.
 *
 * Never throws. A mark save that succeeded must not be reported as failed
 * because a bookkeeping flag did not stick; the worst case is a file that
 * stays stale until the next self-assessment or the next download rebuilds it.
 */
export async function markExportsStale(opts: {
  testId?: string;
  testItemIds?: string[];
}): Promise<void> {
  try {
    const service = serviceClient();
    let testIds: string[] = opts.testId ? [opts.testId] : [];

    if (testIds.length === 0 && opts.testItemIds && opts.testItemIds.length > 0) {
      const { data } = await service
        .from("test_items")
        .select("test_id")
        .in("id", [...new Set(opts.testItemIds)]);
      testIds = [...new Set((data ?? []).map((r) => r.test_id as string))].filter(Boolean);
    }
    if (testIds.length === 0) return;

    await service
      .from("powerschool_export_files")
      .update({ stale: true })
      .in("test_id", testIds);
  } catch (e) {
    console.error("markExportsStale failed", e);
  }
}

/**
 * Rebuild before serving, when the marks moved after the file was written.
 *
 * The backstop for every path that only sets the flag. Returns true when it
 * rebuilt, so the caller can re-read the row it is about to serve. A failure
 * here is not fatal: a stale file is still a file, and refusing to hand it over
 * would be the worse outcome.
 */
export async function regenerateIfStale(
  courseId: string,
  testId: string,
  stale: boolean
): Promise<boolean> {
  if (!stale) return false;
  try {
    return (await regenerateSelfAssessmentExport(serviceClient(), courseId, testId)) !== null;
  } catch (e) {
    console.error("regenerateIfStale failed", e);
    return false;
  }
}
