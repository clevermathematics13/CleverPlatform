import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadInvitedRoster } from "@/lib/na-scanning";
import { ScanTestClient } from "./scan-test-client";

/**
 * TEST HARNESS — not the real upload UI.
 *
 * This page exists purely to drive and inspect stages 1 (upload +
 * segmentation) and 2 (confirm + split) of the NA scan pipeline directly,
 * without needing curl/devtools. It stops after split and prints the raw
 * results — it does not attempt page-identity matching, cropping, or
 * assessment (stages 3-5), which don't exist yet.
 *
 * Once the real upload UI is built at /dashboard/na-review, this page
 * should be deleted rather than kept around as a second entry point.
 */
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
  const rosterByPacketVersion = new Map<
    string,
    { id: string; fullName: string }[]
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
      resolution.roster.map((r) => ({ id: r.invitedId, fullName: r.fullName }))
    );
    resolutionByPacketVersion.set(v.id, {
      isTrack: resolution.isTrack,
      sourceCourseIds: resolution.sourceCourseIds,
    });
  }

  // For any track resolution, resolve source course IDs to names too, so
  // the UI can show "pooled from 9A, 9G" rather than bare UUIDs.
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
        <h1 className="font-serif text-3xl font-bold text-da-text">Scan pipeline: stage 1 + 2 test</h1>
        <p className="mt-1 text-sm text-da-muted">
          Upload a batch scan, review the AI&apos;s proposed student mapping, confirm it, and
          split the PDF. Stops there — no page-identity matching, cropping, or assessment yet.
        </p>
      </div>

      <ScanTestClient
        versions={versions.map((v) => {
          const resolution = resolutionByPacketVersion.get(v.id);
          return {
            ...v,
            roster: rosterByPacketVersion.get(v.id) ?? [],
            rosterIsTrack: resolution?.isTrack ?? false,
            rosterSourceCourseNames: (resolution?.sourceCourseIds ?? []).map(
              (id) => courseNameById.get(id) ?? id
            ),
          };
        })}
      />
    </div>
  );
}
