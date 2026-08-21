import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
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

  // Pre-load every course's invited roster up front so the harness can
  // show "N students on roster" per packet version without a client round
  // trip. Fine at this scale (a handful of packet versions); the real
  // upload UI should load only the roster for the one course in view.
  const courseIds = [...new Set(versions.map((v) => v.courseId).filter((c): c is string => !!c))];
  const { data: invited } = courseIds.length
    ? await supabase
        .from("invited_students")
        .select("id, full_name, course_id")
        .in("course_id", courseIds)
        .eq("hidden", false)
    : { data: [] };

  const rosterByCourse = new Map<string, { id: string; fullName: string }[]>();
  for (const row of invited ?? []) {
    const list = rosterByCourse.get(row.course_id) ?? [];
    list.push({ id: row.id, fullName: row.full_name ?? "(no name)" });
    rosterByCourse.set(row.course_id, list);
  }

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
        versions={versions.map((v) => ({
          ...v,
          roster: v.courseId ? rosterByCourse.get(v.courseId) ?? [] : [],
        }))}
      />
    </div>
  );
}
