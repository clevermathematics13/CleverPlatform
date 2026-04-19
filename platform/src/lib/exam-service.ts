import { createClient } from "@/lib/supabase/server";
import type {
  ReflectionTest,
  ReflectionItem,
  SelfScore,
  PdfUpload,
  StudentReflectionRow,
  SubtopicMastery,
  HeatmapCell,
} from "@/lib/reflection-types";

/** Fetch all tests visible to a student (via their course enrollment). */
export async function getTestsForStudent(
  studentProfileId: string
): Promise<ReflectionTest[]> {
  const supabase = await createClient();

  // Get the student's course IDs
  const { data: enrollments } = await supabase
    .from("students")
    .select("course_id")
    .eq("profile_id", studentProfileId);

  if (!enrollments || enrollments.length === 0) return [];

  const courseIds = enrollments.map((e) => e.course_id);

  const { data: tests, error } = await supabase
    .from("tests")
    .select("id, name, test_date, total_marks, course_id")
    .in("course_id", courseIds)
    .order("test_date", { ascending: false });

  if (error) throw error;
  return (tests ?? []) as ReflectionTest[];
}

/** Fetch all tests (teacher view). */
export async function getAllTests(): Promise<ReflectionTest[]> {
  const supabase = await createClient();

  const { data: tests, error } = await supabase
    .from("tests")
    .select("id, name, test_date, total_marks, course_id")
    .order("test_date", { ascending: false });

  if (error) throw error;
  return (tests ?? []) as ReflectionTest[];
}

/** Fetch test items with teacher marks and self-scores for a student. */
export async function getReflectionItems(
  testId: string,
  studentId: string
): Promise<ReflectionItem[]> {
  const supabase = await createClient();

  // Get test items
  const { data: items, error: itemsError } = await supabase
    .from("test_items")
    .select("id, question_number, part_label, max_marks, subtopic_codes")
    .eq("test_id", testId)
    .order("sort_order", { ascending: true });

  if (itemsError) throw itemsError;
  if (!items || items.length === 0) return [];

  // Get teacher marks
  const itemIds = items.map((i) => i.id);
  const { data: marks } = await supabase
    .from("student_marks")
    .select("test_item_id, marks_awarded")
    .eq("student_id", studentId)
    .in("test_item_id", itemIds);

  // Get self-scores
  const { data: selfScores } = await supabase
    .from("student_self_scores")
    .select("test_item_id, self_marks")
    .eq("student_id", studentId)
    .in("test_item_id", itemIds);

  const marksMap = new Map(
    (marks ?? []).map((m) => [m.test_item_id, m.marks_awarded])
  );
  const selfMap = new Map(
    (selfScores ?? []).map((s) => [s.test_item_id, s.self_marks])
  );

  return items.map((item) => ({
    id: item.id,
    test_item_id: item.id,
    question_number: item.question_number,
    part_label: item.part_label,
    max_marks: item.max_marks,
    subtopic_codes: item.subtopic_codes ?? [],
    marks_awarded: marksMap.get(item.id) ?? null,
    self_marks: selfMap.get(item.id) ?? null,
  }));
}

/** Submit student self-assessment scores. */
export async function submitSelfScores(
  studentId: string,
  testId: string,
  scores: SelfScore[]
): Promise<void> {
  const supabase = await createClient();

  // Upsert each score
  for (const score of scores) {
    const { error } = await supabase.from("student_self_scores").upsert(
      {
        test_item_id: score.test_item_id,
        student_id: studentId,
        self_marks: score.self_marks,
        submitted_at: new Date().toISOString(),
      },
      { onConflict: "test_item_id,student_id" }
    );
    if (error) throw error;
  }
}

/** Upload a PDF to Supabase Storage. */
export async function uploadCorrectionsPdf(
  studentId: string,
  testId: string,
  file: File
): Promise<PdfUpload> {
  const supabase = await createClient();

  const storagePath = `${studentId}/${testId}/${file.name}`;

  const { error: uploadError } = await supabase.storage
    .from("corrections")
    .upload(storagePath, file, { upsert: true });

  if (uploadError) throw uploadError;

  // Upsert the record
  const { data, error } = await supabase
    .from("pdf_uploads")
    .upsert(
      {
        student_id: studentId,
        test_id: testId,
        storage_path: storagePath,
        file_name: file.name,
        file_size: file.size,
        uploaded_at: new Date().toISOString(),
      },
      { onConflict: "student_id,test_id" }
    )
    .select()
    .single();

  if (error) throw error;
  return data as PdfUpload;
}

/** Get the PDF upload record for a student+test. */
export async function getPdfUpload(
  studentId: string,
  testId: string
): Promise<PdfUpload | null> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("pdf_uploads")
    .select("*")
    .eq("student_id", studentId)
    .eq("test_id", testId)
    .maybeSingle();

  return (data as PdfUpload | null) ?? null;
}

/** Get mastery stats for a student. */
export async function getStudentMastery(
  studentId: string
): Promise<SubtopicMastery[]> {
  const supabase = await createClient();

  // Get all marks for the student
  const { data: marks } = await supabase
    .from("student_marks")
    .select(
      "marks_awarded, test_item_id, test_items(max_marks, subtopic_codes)"
    )
    .eq("student_id", studentId);

  // Get self-scores
  const { data: selfScores } = await supabase
    .from("student_self_scores")
    .select("self_marks, test_item_id, test_items(max_marks, subtopic_codes)")
    .eq("student_id", studentId);

  // Get subtopic descriptors
  const { data: subtopics } = await supabase
    .from("subtopics")
    .select("code, descriptor");

  const subtopicMap = new Map(
    (subtopics ?? []).map((s) => [s.code, s.descriptor])
  );

  // Aggregate by subtopic
  const agg = new Map<
    string,
    { total: number; awarded: number; self: number }
  >();

  for (const m of marks ?? []) {
    const item = m.test_items as unknown as {
      max_marks: number;
      subtopic_codes: string[];
    } | null;
    if (!item) continue;
    for (const code of item.subtopic_codes ?? []) {
      const cur = agg.get(code) ?? { total: 0, awarded: 0, self: 0 };
      cur.total += item.max_marks;
      cur.awarded += m.marks_awarded;
      agg.set(code, cur);
    }
  }

  for (const s of selfScores ?? []) {
    const item = s.test_items as unknown as {
      max_marks: number;
      subtopic_codes: string[];
    } | null;
    if (!item) continue;
    for (const code of item.subtopic_codes ?? []) {
      const cur = agg.get(code) ?? { total: 0, awarded: 0, self: 0 };
      cur.self += s.self_marks;
      // Only add total if not already counted from marks
      if (!agg.has(code) || cur.total === 0) {
        cur.total += item.max_marks;
      }
      agg.set(code, cur);
    }
  }

  const results: SubtopicMastery[] = [];
  for (const [code, data] of agg) {
    if (data.total === 0) continue;
    results.push({
      code,
      descriptor: subtopicMap.get(code) ?? code,
      total_marks: data.total,
      marks_awarded: data.awarded,
      self_marks: data.self,
      percentage: Math.round((100 * data.awarded) / data.total),
      self_percentage: Math.round((100 * data.self) / data.total),
    });
  }

  results.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  return results;
}

/** Get class-wide reflection data for teacher dashboard. */
export async function getClassReflectionData(
  testId: string
): Promise<{ items: { id: string; question_number: number; part_label: string; max_marks: number }[]; rows: StudentReflectionRow[] }> {
  const supabase = await createClient();

  // Get test items
  const { data: items } = await supabase
    .from("test_items")
    .select("id, question_number, part_label, max_marks")
    .eq("test_id", testId)
    .order("sort_order", { ascending: true });

  if (!items || items.length === 0) return { items: [], rows: [] };

  // Get the test to find course
  const { data: test } = await supabase
    .from("tests")
    .select("course_id")
    .eq("id", testId)
    .single();

  if (!test) return { items, rows: [] };

  // Get all students in the course
  const { data: students } = await supabase
    .from("students")
    .select("profile_id, hidden, profiles(display_name)")
    .eq("course_id", test.course_id);

  if (!students || students.length === 0) return { items, rows: [] };

  const studentIds = students.map((s) => s.profile_id);
  const itemIds = items.map((i) => i.id);

  // Get all marks
  const { data: allMarks } = await supabase
    .from("student_marks")
    .select("student_id, test_item_id, marks_awarded")
    .in("student_id", studentIds)
    .in("test_item_id", itemIds);

  // Get all self-scores
  const { data: allSelf } = await supabase
    .from("student_self_scores")
    .select("student_id, test_item_id, self_marks")
    .in("student_id", studentIds)
    .in("test_item_id", itemIds);

  // Get uploads
  const { data: uploads } = await supabase
    .from("pdf_uploads")
    .select("student_id")
    .eq("test_id", testId)
    .in("student_id", studentIds);

  const uploadSet = new Set((uploads ?? []).map((u) => u.student_id));

  // Build rows
  const rows: StudentReflectionRow[] = students.map((s) => {
    const profile = s.profiles as unknown as { display_name: string } | null;
    return {
      student_id: s.profile_id,
      display_name: profile?.display_name ?? "Unknown",
      items: items.map((item) => ({
        test_item_id: item.id,
        marks_awarded:
          allMarks?.find(
            (m) =>
              m.student_id === s.profile_id && m.test_item_id === item.id
          )?.marks_awarded ?? null,
        self_marks:
          allSelf?.find(
            (ss) =>
              ss.student_id === s.profile_id && ss.test_item_id === item.id
          )?.self_marks ?? null,
      })),
      has_upload: uploadSet.has(s.profile_id),
      hidden: s.hidden ?? false,
    };
  });

  rows.sort((a, b) => a.display_name.localeCompare(b.display_name));
  return { items, rows };
}

/** Get heatmap data for class mastery. */
export async function getClassHeatmap(): Promise<HeatmapCell[]> {
  const supabase = await createClient();

  // Get all students
  const { data: students } = await supabase
    .from("students")
    .select("profile_id, hidden, profiles(display_name)");

  if (!students || students.length === 0) return [];

  const cells: HeatmapCell[] = [];

  for (const s of students) {
    const profile = s.profiles as unknown as { display_name: string } | null;
    const mastery = await getStudentMastery(s.profile_id);
    for (const m of mastery) {
      cells.push({
        student_id: s.profile_id,
        display_name: profile?.display_name ?? "Unknown",
        subtopic_code: m.code,
        percentage: m.percentage,
        hidden: s.hidden ?? false,
      });
    }
  }

  return cells;
}
