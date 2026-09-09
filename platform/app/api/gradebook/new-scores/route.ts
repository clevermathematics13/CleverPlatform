/**
 * "Download new scores" -- every class whose levels have moved since the last
 * time the teacher took them, in one zip.
 *
 * GET reports what is waiting, so the gradebook can enable or disable the
 * button and say how much. POST builds the zip, hands it over, drops a copy in
 * the teacher's Drive folder and records what was taken.
 *
 * ## Not per class
 *
 * The button sits on every gradebook page but is never about the class being
 * looked at: the teacher marks several sections and then imports the lot in
 * one sitting, so scoping the batch to whichever page they happened to open
 * would be a trap. Every class the teacher owns is considered.
 *
 * ## What counts as new
 *
 * content_sha (what the file says now) differing from downloaded_sha (what it
 * said when last taken). A hash rather than a timestamp, because a rebuild
 * happens whenever a student self-assesses or a mark is touched -- including
 * an edit that puts a value back where it was -- and asking the teacher to
 * re-import a file identical to the one they already have is how a button like
 * this stops being trusted. See the migration for the longer version.
 *
 * A stale file is rebuilt before it is judged, so a mark changed a moment ago
 * is in the batch rather than missed by it.
 */

import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import {
  BUCKET,
  regenerateIfStale,
  serviceClient,
} from "@/lib/self-assessment-export";
import { uploadFileToDrive } from "@/lib/drive-export-mirror";
import { buildZip } from "@/lib/zip";

type PendingRow = {
  course_id: string;
  test_id: string;
  storage_path: string;
  filename: string;
  content_sha: string | null;
  downloaded_sha: string | null;
  stale: boolean;
  courses: { name: string } | null;
  tests: { name: string } | null;
};

/** Every export this teacher owns, rebuilt where stale, with the ones whose
 *  bytes have moved since the last download separated out. */
async function collect(teacherId: string) {
  const service = serviceClient();

  const { data: rows } = await service
    .from("powerschool_export_files")
    .select(
      "course_id, test_id, storage_path, filename, content_sha, downloaded_sha, stale, courses(name), tests(name, teacher_id)"
    );

  // Only this teacher's. Filtered here rather than in the query because the
  // ownership lives on tests, through a join PostgREST will not filter on
  // without a foreign-table filter that is easy to get subtly wrong.
  const mine = ((rows ?? []) as unknown as (PendingRow & {
    tests: { name: string; teacher_id: string } | null;
  })[]).filter((r) => r.tests?.teacher_id === teacherId);

  // A file the marks moved under is rebuilt first, so the batch reflects the
  // gradebook rather than whatever was written before the last edit.
  for (const row of mine) {
    if (row.stale) await regenerateIfStale(row.course_id, row.test_id, true);
  }

  const { data: fresh } = await service
    .from("powerschool_export_files")
    .select("course_id, test_id, storage_path, filename, content_sha, downloaded_sha")
    .in(
      "course_id",
      mine.map((r) => r.course_id)
    );

  const byKey = new Map(
    (fresh ?? []).map((r) => [`${r.course_id}:${r.test_id}`, r])
  );

  const pending = mine
    .map((r) => {
      const now = byKey.get(`${r.course_id}:${r.test_id}`);
      return {
        courseId: r.course_id,
        testId: r.test_id,
        courseName: r.courses?.name ?? "Class",
        testName: r.tests?.name ?? "Assessment",
        storagePath: (now?.storage_path as string) ?? r.storage_path,
        filename: (now?.filename as string) ?? r.filename,
        contentSha: (now?.content_sha as string | null) ?? null,
        downloadedSha: (now?.downloaded_sha as string | null) ?? null,
      };
    })
    // A row with no content hash has never been written by a version that
    // records one; treat it as new rather than silently skipping it forever.
    .filter((r) => r.contentSha !== r.downloadedSha);

  return { service, pending };
}

export async function GET() {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;

  const { pending } = await collect(auth.user.id);
  return NextResponse.json({
    count: pending.length,
    classes: pending.map((p) => ({
      course: p.courseName,
      assessment: p.testName,
      filename: p.filename,
    })),
  });
}

export async function POST() {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;

  const { service, pending } = await collect(auth.user.id);
  if (pending.length === 0) {
    return NextResponse.json({ error: "No new scores to download." }, { status: 409 });
  }

  const entries: { name: string; content: string }[] = [];
  const missing: string[] = [];
  for (const p of pending) {
    const { data: file } = await service.storage.from(BUCKET).download(p.storagePath);
    if (!file) {
      missing.push(p.filename);
      continue;
    }
    entries.push({ name: p.filename, content: await file.text() });
  }
  if (entries.length === 0) {
    return NextResponse.json(
      { error: "The files for these classes could not be read." },
      { status: 500 }
    );
  }

  const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  const zipName = `PowerSchool-new-scores-${stamp}.zip`;
  const zip = buildZip(entries.map((e) => ({ ...e })));

  // A copy in Drive as the record of this batch, alongside the per-class CSVs
  // that live there already. Never fatal: the teacher has the zip regardless,
  // and a Drive problem is reported rather than raised.
  let driveError: string | null = null;
  const { data: settings } = await service
    .from("teacher_settings")
    .select("powerschool_drive_folder_id")
    .eq("teacher_id", auth.user.id)
    .maybeSingle();
  const folderId = (settings?.powerschool_drive_folder_id as string | null)?.trim();
  if (folderId) {
    const up = await uploadFileToDrive({
      supabase: service,
      teacherId: auth.user.id,
      folderId,
      filename: zipName,
      mimeType: "application/zip",
      content: zip,
    });
    if (!up.ok) driveError = up.error;
  }

  // Only now, and only for the files that actually made it into the archive:
  // a class whose file could not be read must stay pending rather than be
  // marked as taken.
  const taken = new Set(entries.map((e) => e.name));
  const stampedAt = new Date().toISOString();
  for (const p of pending) {
    if (!taken.has(p.filename)) continue;
    await service
      .from("powerschool_export_files")
      .update({ downloaded_sha: p.contentSha, downloaded_at: stampedAt })
      .eq("course_id", p.courseId)
      .eq("test_id", p.testId);
  }

  return new NextResponse(Buffer.from(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zipName}"`,
      "X-File-Count": String(entries.length),
      "X-Classes": encodeURIComponent(
        pending
          .filter((p) => taken.has(p.filename))
          .map((p) => `${p.courseName} ${p.testName}`)
          .join(", ")
      ),
      "X-Unreadable": String(missing.length),
      "X-Drive-Error": encodeURIComponent(driveError ?? ""),
      "X-Drive-Filename": driveError ? "" : folderId ? zipName : "",
    },
  });
}
