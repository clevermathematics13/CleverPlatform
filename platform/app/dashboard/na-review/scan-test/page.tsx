import { Suspense } from "react";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadInvitedRoster } from "@/lib/na-scanning";
import { ScanTestClient } from "./scan-test-client";

/**
 * TEST HARNESS — not the real upload UI.
 *
 * This page exists purely to drive and inspect stages 1 (upload +
 * segmentation), 2 (confirm + split), and 4 (crop extraction) of the NA
 * scan pipeline directly, without needing curl/devtools. It does not
 * attempt page-identity matching or assessment (stages 3, 5), which don't
 * exist yet.
 *
 * Once the real upload UI is built at /dashboard/na-review, this page
 * should be deleted rather than kept around as a second entry point.
 */

// This page's entire purpose is inspecting the CURRENT state of the scan
// pipeline (roster membership, track_courses mappings, packet versions),
// all of which change during active development. Without this, Next.js
// can statically cache the render at build time and keep serving a stale
// roster/course list to every load until the next deploy -- which is
// exactly what happened after the track_courses fix for Grade 9 Extended
// (9A/9C/9G): the database was correct, but this page kept showing the
// old pooled-from-9G-(2025-2026) roster because nothing forced a fresh
// render.
export const dynamic = "force-dynamic";

export default async function ScanTestPage() {
  await requireTeacher();
  const supabase = await createClient();

  const { data: packetVersions } = await supabase
    .from("na_packet_versions")
    .select("id, version_label, page_count, anchors_locked, nuanced_analyses(title, course_id)")
    .order("created_at", { ascending: false });

  const versions = (packetVersions ?? []).map((pv) => {
    const na = Array.isArray(pv.nuanced_analyses) ? pv.nuanced_analyses[0] : pv.nuanced_analyses;
    return {
      id: pv.id as string,
      versionLabel: pv.version_label as string,
      pageCount: pv.page_count as number | null,
      anchorsLocked: pv.anchors_locked as boolean,
      title: (na as { title: string | null } | null)?.title ?? null,
      courseId: (na as { course_id: string | null } | null)?.course_id ?? null,
    };
  });

  // Uses the same track-aware resolution the real stage 1 route uses
  // (lib/na-scanning.ts): a packet's course may be a virtual track (e.g.
  // Grade 9 Extended) with no roster of its own, whose real students are
  // split across several actual class courses via track_courses. Calling
  // this per packet version (rather than a single invited_students query
  // across raw courseIds, as this page used to) is what actually resolves
  // that -- a direct query against a track course's ID always returns
  // zero, which is exactly the "roster: 0" bug this replaces.
  //
  // Each roster entry now also carries sourceCourseId, so the client can
  // show which real class (9A/9C/9G) a student belongs to -- useful once a
  // track pools several classes together, since "Tanja Blomqvist" alone
  // doesn't say whether she's 9A, 9C, or 9G.
  const rosterByPacketVersion = new Map<
    string,
    { id: string; fullName: string; sourceCourseId: string }[]
  >();
  const resolutionByPacketVersion = new Map<
    string,
    { isTrack: boolean; sourceCourseIds: string[] }
  >();

  for (const v of versions) {
    if (!v.courseId) continue;
    const resolution = await loadInvitedRoster(supabase, v.courseId);
    rosterByPacketVersion.set(
      v.id,
      resolution.roster.map((r) => ({ id: r.invitedId, fullName: r.fullName, sourceCourseId: r.sourceCourseId }))
    );
    resolutionByPacketVersion.set(v.id, {
      isTrack: resolution.isTrack,
      sourceCourseIds: resolution.sourceCourseIds,
    });
  }

  // For any track resolution, resolve source course IDs to names too, so
  // the UI can show "pooled from 9A, 9G" rather than bare UUIDs, and so
  // each roster entry's sourceCourseId above can be turned into a real
  // class label like "9A" next to the student's name.
  const allSourceCourseIds = [
    ...new Set([...resolutionByPacketVersion.values()].flatMap((r) => r.sourceCourseIds)),
  ];
  const { data: sourceCourses } = allSourceCourseIds.length
    ? await supabase.from("courses").select("id, name").in("id", allSourceCourseIds)
    : { data: [] };
  const courseNameById = new Map((sourceCourses ?? []).map((c) => [c.id, c.name as string]));

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <a href="/dashboard/na-review" className="text-sm text-da-accent hover:underline">
          ← Back to Scanned Response Review
        </a>
        <p className="mt-2 text-xs font-semibold uppercase tracking-widest text-amber-600">
          Test harness — not the real upload flow
        </p>
        <h1 className="font-serif text-3xl font-bold text-da-text">Scan pipeline: stage 1, 2 + 4 test</h1>
        <p className="mt-1 text-sm text-da-muted">
          Upload a batch scan, review the AI&apos;s proposed student mapping, confirm it, split the
          PDF, then run crop extraction per student. No page-identity matching or assessment yet
          (stages 3, 5). Progress is saved to the URL — refreshing or returning to a link with
          <code>?batchId=…</code> reloads exactly where you left off.
        </p>
      </div>

      {/* useSearchParams() inside ScanTestClient requires a Suspense
          boundary in the App Router -- without this, the build fails
          (or, in some Next.js versions, silently forces this whole route
          to opt out of static rendering in a way that's easy to miss).
          The fallback only ever flashes briefly since the page itself is
          already force-dynamic and versions are already resolved above. */}
      <Suspense fallback={<div className="text-sm text-da-muted">Loading…</div>}>
        <ScanTestClient
          versions={versions.map((v) => {
            const resolution = resolutionByPacketVersion.get(v.id);
            const roster = rosterByPacketVersion.get(v.id) ?? [];
            return {
              ...v,
              roster: roster.map((r) => ({
                id: r.id,
                fullName: r.fullName,
                courseName: courseNameById.get(r.sourceCourseId) ?? "",
              })),
              rosterIsTrack: resolution?.isTrack ?? false,
              rosterSourceCourseNames: (resolution?.sourceCourseIds ?? []).map(
                (id) => courseNameById.get(id) ?? id
              ),
            };
          })}
        />
      </Suspense>
    </div>
  );
}
