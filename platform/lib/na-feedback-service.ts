import { createClient } from "@/lib/supabase/server";

const EXAM_SCAN_BUCKET = "exam-scans";

/** One released packet scan a student (or a teacher previewing them) can
 *  open -- the picker unit, matching Phase 1's release granularity
 *  (whole packet scan, not per-question). A student could in principle
 *  have more than one scan for the same packet version (see
 *  results/route.ts's own comment on this), so this is keyed by
 *  packetScanId, not packetVersionId. */
export interface ReleasedPacketScan {
  packetScanId: string;
  packetVersionId: string;
  title: string;
  versionLabel: string | null;
  releasedAt: string;
}

/** Every released packet scan for one student, newest first. Reads
 *  na_packet_scans.status = 'released' rather than joining through
 *  na_feedback -- cheaper, and status is only ever set to 'released' by
 *  the release routes at the same moment every gradable feedback row's
 *  released_at is set, so the two are always in lockstep. */
export async function getReleasedPacketScansForStudent(
  studentProfileId: string
): Promise<ReleasedPacketScan[]> {
  const supabase = await createClient();

  type Row = {
    id: string;
    packet_version_id: string;
    updated_at: string;
    na_packet_versions:
      | {
          version_label: string | null;
          nuanced_analyses: { title: string } | { title: string }[] | null;
        }
      | {
          version_label: string | null;
          nuanced_analyses: { title: string } | { title: string }[] | null;
        }[]
      | null;
  };

  const { data, error } = await supabase
    .from("na_packet_scans")
    .select("id, packet_version_id, updated_at, na_packet_versions(version_label, nuanced_analyses(title))")
    .eq("student_profile_id", studentProfileId)
    .eq("status", "released")
    .order("updated_at", { ascending: false });
  if (error) throw error;

  return ((data ?? []) as unknown as Row[]).map((row) => {
    const version = Array.isArray(row.na_packet_versions) ? row.na_packet_versions[0] : row.na_packet_versions;
    const analysis = version
      ? Array.isArray(version.nuanced_analyses)
        ? version.nuanced_analyses[0]
        : version.nuanced_analyses
      : null;
    return {
      packetScanId: row.id,
      packetVersionId: row.packet_version_id,
      title: analysis?.title ?? "Untitled packet",
      versionLabel: version?.version_label ?? null,
      releasedAt: row.updated_at,
    };
  });
}

export interface NaFeedbackItem {
  cropId: string;
  qid: string;
  partLabel: string | null;
  marksAwarded: number | null;
  marksAvailable: number | null;
  fullMarks: boolean;
  marginComment: string | null;
  nextStep: string | null;
  cropImageUrl: string | null;
  promptCropImageUrl: string | null;
  studentFlaggedMisread: boolean;
  studentFlagNote: string | null;
}

/** The released, student-facing feedback for one packet scan -- ordered
 *  to match na_anchors.sort_order, the same authoring order the packet
 *  itself was laid out in. Only ever reads final_* fields, never ai_*
 *  drafts (ai_marks_available is the one exception -- it's a point total,
 *  not part of the answer key, and results/route.ts already sources the
 *  teacher-side marksAvailable the same way), and explicitly filters
 *  released_at IS NOT NULL as defense-in-depth -- RLS already enforces
 *  this, but a query that only works because of RLS is one accidental
 *  service-role client away from leaking an unreleased AI draft, so this
 *  never relies on RLS alone. */
export async function getNaFeedbackForStudent(
  packetScanId: string,
  studentProfileId: string
): Promise<NaFeedbackItem[]> {
  const supabase = await createClient();

  // Ownership check up front -- a student ID the caller doesn't actually
  // own returns [] rather than silently falling through to an empty
  // RLS-filtered result that looks the same either way.
  const { data: scan, error: scanErr } = await supabase
    .from("na_packet_scans")
    .select("id, student_profile_id")
    .eq("id", packetScanId)
    .single();
  if (scanErr || !scan || scan.student_profile_id !== studentProfileId) return [];

  type AnchorShape = {
    qid: string;
    part_label: string | null;
    sort_order: number | null;
    prompt_crop_storage_path: string | null;
  };
  type FeedbackShape = {
    final_marks_awarded: number | null;
    ai_marks_available: number | null;
    final_margin_comment: string | null;
    final_next_step: string | null;
    released_at: string | null;
    student_flagged_misread: boolean | null;
    student_flag_note: string | null;
  };
  type Row = {
    id: string;
    storage_path: string;
    na_anchors: AnchorShape | AnchorShape[] | null;
    na_feedback: FeedbackShape | FeedbackShape[] | null;
  };

  const { data: cropRows, error } = await supabase
    .from("na_response_crops")
    .select(
      `id, storage_path,
       na_anchors(qid, part_label, sort_order, prompt_crop_storage_path),
       na_feedback(final_marks_awarded, ai_marks_available, final_margin_comment, final_next_step, released_at, student_flagged_misread, student_flag_note)`
    )
    .eq("packet_scan_id", packetScanId);
  if (error) throw error;

  const rows = ((cropRows ?? []) as unknown as Row[])
    .map((row) => {
      const anchor = Array.isArray(row.na_anchors) ? row.na_anchors[0] : row.na_anchors;
      const fb = Array.isArray(row.na_feedback) ? row.na_feedback[0] : row.na_feedback;
      if (!anchor || !fb || !fb.released_at) return null;

      const marksAvailable = fb.ai_marks_available;
      const marksAwarded = fb.final_marks_awarded;

      return {
        cropId: row.id,
        qid: anchor.qid,
        partLabel: anchor.part_label,
        sortOrder: anchor.sort_order ?? 0,
        marksAwarded,
        marksAvailable,
        fullMarks: marksAwarded !== null && marksAvailable !== null && marksAwarded >= marksAvailable,
        marginComment: fb.final_margin_comment,
        nextStep: fb.final_next_step,
        promptCropStoragePath: anchor.prompt_crop_storage_path,
        cropStoragePath: row.storage_path,
        studentFlaggedMisread: fb.student_flagged_misread ?? false,
        studentFlagNote: fb.student_flag_note,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const items: NaFeedbackItem[] = await Promise.all(
    rows.map(async (r) => {
      const { data: cropSigned } = await supabase.storage
        .from(EXAM_SCAN_BUCKET)
        .createSignedUrl(r.cropStoragePath, 3600);
      const promptSigned = r.promptCropStoragePath
        ? await supabase.storage.from(EXAM_SCAN_BUCKET).createSignedUrl(r.promptCropStoragePath, 3600)
        : null;

      return {
        cropId: r.cropId,
        qid: r.qid,
        partLabel: r.partLabel,
        marksAwarded: r.marksAwarded,
        marksAvailable: r.marksAvailable,
        fullMarks: r.fullMarks,
        marginComment: r.marginComment,
        nextStep: r.nextStep,
        cropImageUrl: cropSigned?.signedUrl ?? null,
        promptCropImageUrl: promptSigned?.data?.signedUrl ?? null,
        studentFlaggedMisread: r.studentFlaggedMisread,
        studentFlagNote: r.studentFlagNote,
      };
    })
  );

  return items;
}
