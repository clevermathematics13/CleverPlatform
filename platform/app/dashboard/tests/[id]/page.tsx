import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadOverrideClasses } from "@/lib/self-assessment-override-classes";
import { TestDetailClient, type BoundarySetOption, type TestDetail } from "./test-detail-client";

/**
 * One assessment, everything about it, editable.
 *
 * Reached by clicking an assessment's name in the gradebook. Until this page
 * existed the gradebook could tell the teacher that a paper's boundary set was
 * "unassigned (approx.)" and offer no way to assign one -- nothing in the app
 * wrote `boundary_set_id` at all -- and the Tests list exposed only a few of
 * the fields a test actually has.
 */
export default async function TestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireTeacher();
  const { id } = await params;

  const supabase = await createClient();

  // courses!tests_course_id_fkey, not a bare courses(name) -- see
  // app/dashboard/tests/page.tsx for why the bare form fails.
  const [{ data: test }, { data: courses }, { data: sets }, { data: bands }] =
    await Promise.all([
      supabase
        .from("tests")
        .select(
          `id, name, short_name, test_date, exam_time, release_at, total_marks,
           course_id, hidden, hidden_from_gradebook, require_self_assessment,
           boundary_set_id, paper_url, mark_scheme_url,
           courses!tests_course_id_fkey(name),
           test_items(id, question_number, part_label, max_marks, sort_order, ib_question_code, subtopic_codes)`
        )
        .eq("id", id)
        .maybeSingle(),
      supabase.from("courses").select("id, name").eq("archived", false).order("name"),
      supabase.from("grade_boundary_sets").select("id, name, description").order("name"),
      supabase
        .from("grade_boundaries")
        .select("set_id, grade, min_proportion")
        .order("grade", { ascending: false }),
    ]);

  if (!test) notFound();

  const { classes: overrideClasses, overrides } = await loadOverrideClasses(
    supabase,
    id,
    (test.course_id as string | null) ?? null,
    ((test.test_items ?? []) as { id: string }[]).map((i) => i.id)
  );

  // Each set summarised as the thing a teacher actually wants to compare:
  // where the grades start. "7 from 90%, 6 from 80%, ..." beats a set named "B".
  const bandsBySet = new Map<string, { grade: number; minPct: number }[]>();
  for (const b of bands ?? []) {
    const setId = b.set_id as string;
    if (!bandsBySet.has(setId)) bandsBySet.set(setId, []);
    bandsBySet.get(setId)!.push({
      grade: b.grade as number,
      minPct: Math.round(Number(b.min_proportion) * 100),
    });
  }

  const setOptions: BoundarySetOption[] = (sets ?? []).map((s) => ({
    id: s.id as string,
    name: s.name as string,
    description: (s.description as string | null) ?? null,
    bands: bandsBySet.get(s.id as string) ?? [],
  }));

  return (
    <TestDetailClient
      test={test as unknown as TestDetail}
      courses={(courses ?? []) as { id: string; name: string }[]}
      boundarySets={setOptions}
      overrideClasses={overrideClasses}
      overrides={overrides}
    />
  );
}
