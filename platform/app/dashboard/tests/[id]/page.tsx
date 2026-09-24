import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadOverrideClasses } from "@/lib/self-assessment-override-classes";
import { CUTOFF_GRADES, cutoffsFromBoundaries, sameCutoffs, type GradeBoundary } from "@/lib/grade-bands";
import { TestDetailClient, type BoundarySummary, type TestDetail } from "./test-detail-client";

/**
 * One assessment, everything about it, editable.
 *
 * Reached by clicking an assessment's name in the gradebook. Until this page
 * existed the gradebook could tell the teacher that a paper's boundary set was
 * "unassigned (approx.)" and offer no way to assign one, and the Tests list
 * exposed only a few of the fields a test actually has. Grade boundaries are
 * now decided per assessment on their own page (./boundaries); this one
 * summarises them.
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
  const [{ data: test }, { data: courses }] =
    await Promise.all([
      supabase
        .from("tests")
        .select(
          `id, name, short_name, test_date, exam_time, release_at, total_marks,
           course_id, hidden, hidden_from_gradebook, require_self_assessment,
           boundary_set_id, paper_url, mark_scheme_url, standards_rubric,
           paper_pdf_storage_path, mark_scheme_pdf_storage_path, pdfs_generated_at,
           courses!tests_course_id_fkey(name),
           test_items(id, question_number, part_label, max_marks, sort_order, ib_question_code, subtopic_codes)`
        )
        .eq("id", id)
        .maybeSingle(),
      supabase.from("courses").select("id, name").eq("archived", false).order("name"),
    ]);

  if (!test) notFound();

  const { classes: overrideClasses, overrides } = await loadOverrideClasses(
    supabase,
    id,
    (test.course_id as string | null) ?? null,
    ((test.test_items ?? []) as { id: string }[]).map((i) => i.id)
  );

  const boundarySummary = await summariseBoundaries(
    supabase,
    id,
    (test.boundary_set_id as string | null) ?? null,
    (test.total_marks as number | null) ?? null
  );

  return (
    <TestDetailClient
      test={test as unknown as TestDetail}
      courses={(courses ?? []) as { id: string; name: string }[]}
      boundarySummary={boundarySummary}
      overrideClasses={overrideClasses}
      overrides={overrides}
    />
  );
}

/** The Grading section's one-paragraph account of this assessment's boundaries. */
async function summariseBoundaries(
  supabase: Awaited<ReturnType<typeof createClient>>,
  testId: string,
  setId: string | null,
  total: number | null
): Promise<BoundarySummary> {
  const { data: decision } = await supabase
    .from("test_boundary_decisions")
    .select("decided_at, statement")
    .eq("test_id", testId)
    .order("decided_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const decided = {
    decidedAt: (decision?.decided_at as string | undefined) ?? null,
    statement: (decision?.statement as string | undefined) ?? null,
  };
  if (!setId) return { kind: "none", label: null, lines: null, ...decided };

  const { data: set } = await supabase
    .from("grade_boundary_sets")
    .select("id, name, test_id, origin_set_id")
    .eq("id", setId)
    .maybeSingle();
  if (!set) return { kind: "none", label: null, lines: null, ...decided };

  const ids = [set.id as string, ...(set.origin_set_id ? [set.origin_set_id as string] : [])];
  const [{ data: bands }, { data: origin }] = await Promise.all([
    supabase.from("grade_boundaries").select("set_id, grade, min_proportion").in("set_id", ids),
    set.origin_set_id
      ? supabase.from("grade_boundary_sets").select("name").eq("id", set.origin_set_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const bandsFor = (sid: string): GradeBoundary[] =>
    (bands ?? [])
      .filter((b) => b.set_id === sid)
      .map((b) => ({ grade: b.grade as number, min_proportion: Number(b.min_proportion) }));
  const own = total ? cutoffsFromBoundaries(bandsFor(set.id as string), total) : null;
  const lines = own && total ? `${CUTOFF_GRADES.map((g) => own[g]).join("/")} of ${total}` : null;

  if (set.test_id === null) {
    return { kind: "preset", label: set.name as string, lines, ...decided };
  }
  const originName = (origin as { name?: string } | null)?.name ?? null;
  const unchanged =
    !!originName &&
    !!total &&
    sameCutoffs(own, cutoffsFromBoundaries(bandsFor(set.origin_set_id as string), total));
  return {
    kind: "own",
    label: unchanged ? `own copy of ${originName}` : "own boundaries",
    lines,
    ...decided,
  };
}
