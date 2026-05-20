import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { GradebookGrid } from "./GradebookGrid";

function inferComponent(name: string): "P1" | "P2" | "P3" | "IA" | null {
  const u = name.toUpperCase();
  if (/\bIA\b/.test(u)) return "IA";
  if (/\bP3\b/.test(u)) return "P3";
  if (/\bP2\b/.test(u)) return "P2";
  if (/\bP1\b/.test(u)) return "P1";
  return null;
}

export default async function GradebookCoursePage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  await requireTeacher();
  const { courseId } = await params;
  const supabase = await createClient();

  // Course
  const { data: course } = await supabase
    .from("courses")
    .select("id, name")
    .eq("id", courseId)
    .single();

  if (!course) notFound();

  // Tests for this course ordered most-recent-first
  const { data: rawTests } = await supabase
    .from("tests")
    .select("id, name, test_date, total_marks")
    .eq("course_id", courseId)
    .order("test_date", { ascending: false });

  const testList = rawTests ?? [];
  const testIds = testList.map((t) => t.id);

  // Test items (question parts)
  let allItems: {
    id: string;
    test_id: string;
    question_number: number;
    part_label: string;
    max_marks: number;
    sort_order: number;
  }[] = [];
  if (testIds.length > 0) {
    const { data } = await supabase
      .from("test_items")
      .select("id, test_id, question_number, part_label, max_marks, sort_order")
      .in("test_id", testIds)
      .order("sort_order");
    allItems = data ?? [];
  }

  // Students enrolled in this course
  const { data: rawStudents } = await supabase
    .from("students")
    .select("profile_id, profiles(display_name)")
    .eq("course_id", courseId)
    .eq("hidden", false);

  const students = (rawStudents ?? [])
    .map((s) => {
      // Supabase may return joined record as object or array depending on type gen
      const prof = s.profiles as unknown;
      const displayName =
        prof && typeof prof === "object" && !Array.isArray(prof)
          ? (prof as { display_name: string }).display_name
          : Array.isArray(prof) && prof.length > 0
          ? (prof[0] as { display_name: string }).display_name
          : null;
      return {
        profile_id: s.profile_id as string,
        name: displayName ?? "Unknown",
      };
    })
    .sort((a, b) => {
      const lastName = (n: string) => n.trim().split(/\s+/).slice(-1)[0] ?? n;
      return lastName(a.name).localeCompare(lastName(b.name)) || a.name.localeCompare(b.name);
    });

  // Student marks
  const itemIds = allItems.map((i) => i.id);
  const marksMap: Record<string, Record<string, number>> = {};
  if (itemIds.length > 0) {
    const { data: rawMarks } = await supabase
      .from("student_marks")
      .select("test_item_id, student_id, marks_awarded")
      .in("test_item_id", itemIds);
    for (const m of rawMarks ?? []) {
      if (!marksMap[m.test_item_id]) marksMap[m.test_item_id] = {};
      marksMap[m.test_item_id][m.student_id] = m.marks_awarded;
    }
  }

  // Group items by test
  const itemsByTest: Record<string, typeof allItems> = {};
  for (const item of allItems) {
    if (!itemsByTest[item.test_id]) itemsByTest[item.test_id] = [];
    itemsByTest[item.test_id].push(item);
  }

  const tests = testList.map((t) => ({
    id: t.id,
    name: t.name,
    test_date: t.test_date as string | null,
    total_marks: t.total_marks ?? 0,
    component: inferComponent(t.name),
    items: (itemsByTest[t.id] ?? []).map((item) => ({
      id: item.id,
      question_number: item.question_number,
      part_label: item.part_label ?? "",
      max_marks: item.max_marks,
      sort_order: item.sort_order,
    })),
  }));

  return (
    <div>
      <div className="mb-6">
        <p className="text-da-muted text-xs font-medium uppercase tracking-widest mb-1">
          Gradebook
        </p>
        <h1 className="text-3xl font-bold text-da-text font-serif">{course.name}</h1>
        <p className="text-da-muted text-sm mt-1">
          {students.length} student{students.length !== 1 ? "s" : ""} ·{" "}
          {tests.length} assessment{tests.length !== 1 ? "s" : ""}
        </p>
      </div>

      <GradebookGrid
        tests={tests}
        students={students}
        initialMarks={marksMap}
      />
    </div>
  );
}
