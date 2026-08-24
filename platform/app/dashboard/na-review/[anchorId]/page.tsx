import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AnchorReviewClient from "./anchor-review-client";

const SCAN_BUCKET = "exam-scans";

export default async function AnchorReviewPage({
  params,
}: {
  params: Promise<{ anchorId: string }>;
}) {
  await requireTeacher();
  const { anchorId } = await params;
  const supabase = await createClient();

  const { data: anchor, error: anchorErr } = await supabase
    .from("na_anchors")
    .select(
      "id, qid, base_qid, part_label, command_term, marks_available, answer_sketch, open_rubric, misconception_context"
    )
    .eq("id", anchorId)
    .single();

  if (anchorErr || !anchor) redirect("/dashboard/na-review");

  const { data: students } = await supabase
    .from("profiles")
    .select("id, display_name, nickname")
    .eq("role", "student")
    .order("display_name");

  const { data: crops } = await supabase
    .from("na_response_crops")
    .select(
      `id, storage_path, ink_density, is_blank, boundary_expanded,
       packet_scan:na_packet_scans!inner(
         id, packet_seq, id_status,
         student:profiles(id, display_name, nickname)
       ),
       na_feedback(
         id, ai_attempted, ai_transcription, ai_verdict, ai_marks_awarded,
         ai_marks_available, ai_misconception_tags, ai_margin_comment,
         ai_next_step, ai_confidence, ai_teacher_note, ai_validation_error,
         final_verdict, final_marks_awarded, final_margin_comment, final_next_step,
         teacher_edited, approved_by, approved_at, released_at,
         student_flagged_misread, student_flag_note
       )`
    )
    .eq("anchor_id", anchorId);

  const rows = await Promise.all(
    (crops ?? []).map(async (crop) => {
      const { data: signed } = await supabase.storage
        .from(SCAN_BUCKET)
        .createSignedUrl(crop.storage_path, 3600);

      const packetScan = Array.isArray(crop.packet_scan) ? crop.packet_scan[0] : crop.packet_scan;
      const student = packetScan?.student
        ? Array.isArray(packetScan.student)
          ? packetScan.student[0]
          : packetScan.student
        : null;
      const feedback = Array.isArray(crop.na_feedback) ? crop.na_feedback[0] : crop.na_feedback;

      return {
        cropId: crop.id,
        imageUrl: signed?.signedUrl ?? null,
        inkDensity: crop.ink_density,
        isBlank: crop.is_blank,
        boundaryExpanded: crop.boundary_expanded,
        packetScanId: packetScan?.id ?? null,
        packetSeq: packetScan?.packet_seq ?? null,
        idStatus: packetScan?.id_status ?? null,
        studentName: student?.nickname ?? student?.display_name ?? null,
        feedback: feedback ?? null,
      };
    })
  );

  rows.sort((a, b) => (a.packetSeq ?? 0) - (b.packetSeq ?? 0));

  return <AnchorReviewClient anchor={anchor} initialRows={rows} students={students ?? []} />;
}
