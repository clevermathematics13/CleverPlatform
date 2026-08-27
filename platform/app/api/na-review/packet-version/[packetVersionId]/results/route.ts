import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { isUngradedAnchor, type AnchorContext } from "@/lib/na-assessment";

/**
 * GET /api/na-review/packet-version/[packetVersionId]/results
 *
 * Class-grouped results summary for one packet version: every identified
 * packet scan (has invited_student_id), how many of its gradable questions
 * are assessed, and marks so far -- grouped by the student's real course
 * (9A/9C/9G etc.), not by which upload batch produced the scan.
 *
 * "Gradable" excludes anchors with no marks and no answer key of any kind
 * (matches isUngradedAnchor in na-assessment.ts -- e.g. A.1's Desmos
 * "noticings from the sandbox" thinking space), so the denominator here
 * matches what stage 5 actually attempts rather than raw crop count.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ packetVersionId: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { packetVersionId } = await params;

  const { data: anchorRows, error: anchorErr } = await supabase
    .from("na_anchors")
    .select("id, qid, marks_available, question_answer, answer_sketch, open_rubric")
    .eq("packet_version_id", packetVersionId);
  if (anchorErr) return NextResponse.json({ error: anchorErr.message }, { status: 500 });

  const gradableAnchorIds = new Set(
    (anchorRows ?? [])
      .filter(
        (a) =>
          !isUngradedAnchor({
            qid: a.qid,
            baseQid: a.qid,
            marksAvailable: a.marks_available,
            commandTerm: null,
            answerSketch: a.answer_sketch,
            openRubric: a.open_rubric,
            misconceptionContext: null,
            questionAnswer: a.question_answer,
          } satisfies AnchorContext)
      )
      .map((a) => a.id)
  );
  const totalGradable = gradableAnchorIds.size;
  const totalMarksAvailable = (anchorRows ?? [])
    .filter((a) => gradableAnchorIds.has(a.id))
    .reduce((sum, a) => sum + (a.marks_available ?? 0), 0);

  type InvitedStudentRow = {
    full_name: string | null;
    nickname: string | null;
    courses: { id: string; name: string } | { id: string; name: string }[] | null;
  };

  type ScanRow = {
    id: string;
    status: string;
    invited_students: InvitedStudentRow | InvitedStudentRow[] | null;
  };

  const { data: scanRows, error: scanErr } = await supabase
    .from("na_packet_scans")
    .select("id, status, invited_students(full_name, nickname, courses(id, name))")
    .eq("packet_version_id", packetVersionId)
    .not("invited_student_id", "is", null);
  if (scanErr) return NextResponse.json({ error: scanErr.message }, { status: 500 });

  const scans = (scanRows ?? []) as unknown as ScanRow[];
  const scanIds = scans.map((s) => s.id);

  type CropRow = {
    id: string;
    anchor_id: string;
    packet_scan_id: string;
    na_feedback:
      | { ai_attempted: boolean | null; ai_marks_awarded: number | null; ai_marks_available: number | null; ai_validation_error: string | null }
      | { ai_attempted: boolean | null; ai_marks_awarded: number | null; ai_marks_available: number | null; ai_validation_error: string | null }[]
      | null;
  };

  const cropsByScan = new Map<string, CropRow[]>();
  if (scanIds.length > 0) {
    const { data: cropRows, error: cropErr } = await supabase
      .from("na_response_crops")
      .select("id, anchor_id, packet_scan_id, na_feedback(ai_attempted, ai_marks_awarded, ai_marks_available, ai_validation_error)")
      .in("packet_scan_id", scanIds);
    if (cropErr) return NextResponse.json({ error: cropErr.message }, { status: 500 });
    for (const c of (cropRows ?? []) as CropRow[]) {
      const bucket = cropsByScan.get(c.packet_scan_id) ?? [];
      bucket.push(c);
      cropsByScan.set(c.packet_scan_id, bucket);
    }
  }

  const studentResults = scans.map((s) => {
    const student = Array.isArray(s.invited_students) ? s.invited_students[0] : s.invited_students;
    const course = student
      ? Array.isArray(student.courses)
        ? student.courses[0]
        : student.courses
      : null;

    const crops = cropsByScan.get(s.id) ?? [];
    let assessedCount = 0;
    let marksAwarded = 0;
    let marksAvailable = 0;
    for (const c of crops) {
      if (!gradableAnchorIds.has(c.anchor_id)) continue;
      const fb = Array.isArray(c.na_feedback) ? c.na_feedback[0] : c.na_feedback;
      if (fb?.ai_attempted === true && !fb.ai_validation_error) {
        assessedCount += 1;
        marksAwarded += fb.ai_marks_awarded ?? 0;
        marksAvailable += fb.ai_marks_available ?? 0;
      }
    }

    return {
      packetScanId: s.id,
      studentName: student?.full_name ?? student?.nickname ?? "(unnamed)",
      courseId: course?.id ?? null,
      courseName: course?.name ?? "Unassigned",
      status: s.status,
      totalCrops: crops.length,
      assessedCount,
      totalGradable,
      marksAwarded,
      marksAvailable,
    };
  });

  const byCourse = new Map<string, { courseId: string | null; courseName: string; students: typeof studentResults }>();
  for (const r of studentResults) {
    const key = r.courseName;
    const bucket = byCourse.get(key) ?? { courseId: r.courseId, courseName: r.courseName, students: [] };
    bucket.students.push(r);
    byCourse.set(key, bucket);
  }
  for (const bucket of byCourse.values()) {
    bucket.students.sort((a, b) => a.studentName.localeCompare(b.studentName));
  }
  const courses = [...byCourse.values()].sort((a, b) => a.courseName.localeCompare(b.courseName));

  return NextResponse.json({
    packetVersionId,
    totalGradable,
    totalMarksAvailable,
    courses,
  });
}
