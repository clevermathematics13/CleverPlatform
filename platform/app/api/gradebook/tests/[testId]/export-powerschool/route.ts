import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { fillPowerSchoolTemplate, type PowerSchoolRosterEntry } from "@/lib/powerschool-export";

/**
 * POST /api/gradebook/tests/[testId]/export-powerschool
 *
 * Fills a PowerTeacher Pro "Export Template" (uploaded as multipart form
 * field "file") with this test's recorded scores from our own gradebook
 * (student_marks), matched to the template's rows by student name. Returns
 * the completed CSV as text for the client to offer as a download, plus any
 * rows that couldn't be confidently filled in.
 *
 * RLS on tests/students/student_marks scopes every query below to this
 * teacher's own data, same as the rest of the gradebook API.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ testId: string }> }) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { testId } = await params;

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json({ error: "Expected multipart/form-data with a 'file' field" }, { status: 400 });
  }
  const form = await req.formData();
  const file = form.get("file");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }
  const templateCsvText = await file.text();

  const { data: test, error: testError } = await supabase
    .from("tests")
    .select("id, name, course_id, total_marks")
    .eq("id", testId)
    .maybeSingle();
  if (testError) return NextResponse.json({ error: testError.message }, { status: 500 });
  if (!test) return NextResponse.json({ error: "Test not found" }, { status: 404 });

  const { data: items, error: itemsError } = await supabase
    .from("test_items")
    .select("id")
    .eq("test_id", testId);
  if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 });
  const itemIds = (items ?? []).map((i) => i.id as string);

  const { data: rawStudents, error: studentsError } = await supabase
    .from("students")
    .select("profile_id, profiles(display_name)")
    .eq("course_id", test.course_id)
    .eq("hidden", false);
  if (studentsError) return NextResponse.json({ error: studentsError.message }, { status: 500 });

  const marksByStudent: Record<string, number> = {};
  const hasAnyMark: Record<string, boolean> = {};
  if (itemIds.length > 0) {
    const { data: rawMarks, error: marksError } = await supabase
      .from("student_marks")
      .select("student_id, marks_awarded")
      .in("test_item_id", itemIds);
    if (marksError) return NextResponse.json({ error: marksError.message }, { status: 500 });
    for (const m of rawMarks ?? []) {
      const sid = m.student_id as string;
      marksByStudent[sid] = (marksByStudent[sid] ?? 0) + (m.marks_awarded as number);
      hasAnyMark[sid] = true;
    }
  }

  const roster: PowerSchoolRosterEntry[] = (rawStudents ?? []).map((s) => {
    const prof = s.profiles as unknown;
    const displayName =
      prof && typeof prof === "object" && !Array.isArray(prof)
        ? ((prof as { display_name: string }).display_name ?? "Unknown")
        : Array.isArray(prof) && prof.length > 0
        ? ((prof[0] as { display_name: string }).display_name ?? "Unknown")
        : "Unknown";
    const profileId = s.profile_id as string;
    return {
      profileId,
      displayName,
      score: hasAnyMark[profileId] ? marksByStudent[profileId] : null,
    };
  });

  const result = fillPowerSchoolTemplate(templateCsvText, roster, test.name);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    csvText: result.csvText,
    warnings: result.warnings,
    filename: `${test.name.replace(/[^a-zA-Z0-9._-]+/g, "_")}_powerschool.csv`,
  });
}
