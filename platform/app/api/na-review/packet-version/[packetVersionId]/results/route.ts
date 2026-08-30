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
 *
 * Each course bucket also carries totalRegistered (the course's full
 * invited_students roster size) and missingStudentNames (roster students
 * with no identified scan at all for this packet version yet) -- lets the
 * UI show "12/15 identified" next to a course heading and name exactly
 * who hasn't been uploaded/matched, not just how many are missing.
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

  type BatchRow = { source_filename: string | null } | { source_filename: string | null }[] | null;

  type ScanRow = {
    id: string;
    status: string;
    invited_student_id: string;
    invited_students: InvitedStudentRow | InvitedStudentRow[] | null;
    na_scan_batches: BatchRow;
  };

  const { data: scanRows, error: scanErr } = await supabase
    .from("na_packet_scans")
    .select("id, status, invited_student_id, invited_students(full_name, nickname, courses(id, name)), na_scan_batches(source_filename)")
    .eq("packet_version_id", packetVersionId)
    .not("invited_student_id", "is", null);
  if (scanErr) return NextResponse.json({ error: scanErr.message }, { status: 500 });

  const scans = (scanRows ?? []) as unknown as ScanRow[];
  const scanIds = scans.map((s) => s.id);

  type Feedback = {
    ai_attempted: boolean | null;
    ai_marks_awarded: number | null;
    ai_marks_available: number | null;
    ai_validation_error: string | null;
    final_marks_awarded: number | null;
  };

  type CropRow = {
    id: string;
    anchor_id: string;
    packet_scan_id: string;
    na_feedback: Feedback | Feedback[] | null;
  };

  const cropsByScan = new Map<string, CropRow[]>();
  if (scanIds.length > 0) {
    const { data: cropRows, error: cropErr } = await supabase
      .from("na_response_crops")
      .select("id, anchor_id, packet_scan_id, na_feedback(ai_attempted, ai_marks_awarded, ai_marks_available, ai_validation_error, final_marks_awarded)")
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
    const batch = Array.isArray(s.na_scan_batches) ? s.na_scan_batches[0] : s.na_scan_batches;

    const crops = cropsByScan.get(s.id) ?? [];
    let assessedCount = 0;
    let marksAwarded = 0;
    let marksAvailable = 0;
    for (const c of crops) {
      if (!gradableAnchorIds.has(c.anchor_id)) continue;
      const fb = Array.isArray(c.na_feedback) ? c.na_feedback[0] : c.na_feedback;
      if (fb?.ai_attempted === true && !fb.ai_validation_error) {
        assessedCount += 1;
        // A teacher override (final_marks_awarded) is the actual current
        // mark once one exists -- summing ai_marks_awarded unconditionally
        // would silently show a stale AI draft after a correction, exactly
        // the kind of number this whole page exists to get right.
        marksAwarded += fb.final_marks_awarded ?? fb.ai_marks_awarded ?? 0;
        marksAvailable += fb.ai_marks_available ?? 0;
      }
    }

    return {
      packetScanId: s.id,
      invitedStudentId: s.invited_student_id,
      sourceFilename: batch?.source_filename ?? null,
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

  // Roster totals + who's missing, per course: a student in the course's
  // invited_students roster whose id never shows up among this packet
  // version's identified scans hasn't been uploaded/matched at all yet --
  // distinct from a low-progress row, which at least has a scan started.
  // Diffed by invited_student_id, not name, since names can collide or
  // vary (nickname vs full_name) in ways a string compare would miss.
  const courseIds = [...byCourse.values()].map((b) => b.courseId).filter((id): id is string => !!id);
  const rosterByCourse = new Map<string, { total: number; missingNames: string[] }>();
  if (courseIds.length > 0) {
    const { data: rosterRows, error: rosterErr } = await supabase
      .from("invited_students")
      .select("id, full_name, nickname, course_id")
      .in("course_id", courseIds);
    if (rosterErr) return NextResponse.json({ error: rosterErr.message }, { status: 500 });

    const presentIdsByCourse = new Map<string, Set<string>>();
    for (const bucket of byCourse.values()) {
      if (!bucket.courseId) continue;
      presentIdsByCourse.set(bucket.courseId, new Set(bucket.students.map((s) => s.invitedStudentId)));
    }
    for (const r of rosterRows ?? []) {
      const entry = rosterByCourse.get(r.course_id) ?? { total: 0, missingNames: [] };
      entry.total += 1;
      if (!presentIdsByCourse.get(r.course_id)?.has(r.id)) {
        entry.missingNames.push(r.full_name ?? r.nickname ?? "(unnamed)");
      }
      rosterByCourse.set(r.course_id, entry);
    }
    for (const entry of rosterByCourse.values()) entry.missingNames.sort((a, b) => a.localeCompare(b));
  }

  const courses = [...byCourse.values()]
    .map((bucket) => {
      const roster = bucket.courseId ? rosterByCourse.get(bucket.courseId) : undefined;
      return {
        ...bucket,
        totalRegistered: roster?.total ?? bucket.students.length,
        missingStudentNames: roster?.missingNames ?? [],
      };
    })
    .sort((a, b) => a.courseName.localeCompare(b.courseName));

  return NextResponse.json({
    packetVersionId,
    totalGradable,
    totalMarksAvailable,
    courses,
  });
}
