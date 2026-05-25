import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getStudentMastery } from "@/lib/exam-service";
import { redirect } from "next/navigation";

type LinkedAssessmentRow = {
  testItemId: string;
  testId: string | null;
  questionCode: string;
  questionNumber: number;
  partLabel: string;
  testName: string;
  testDate: string | null;
  maxMarks: number;
  teacherMarks: number | null;
  selfMarks: number | null;
  subtopicCodes: string[];
};

type TestMeta = {
  id?: string;
  name: string;
  test_date: string | null;
};

type JoinedTestItem = {
  id: string;
  ib_question_code: string | null;
  question_number: number;
  part_label: string;
  max_marks: number;
  subtopic_codes: string[] | null;
  tests: TestMeta | TestMeta[] | null;
};

const normalizeTestMeta = (value: JoinedTestItem["tests"]): TestMeta | null => {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
};

const normalizeJoinedTestItem = (value: unknown): JoinedTestItem | null => {
  if (!value) return null;
  if (Array.isArray(value)) {
    return (value[0] as JoinedTestItem | undefined) ?? null;
  }
  return value as JoinedTestItem;
};

export default async function SubtopicMasteryPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; studentId?: string; limit?: string; sort?: string }>;
}) {
  const profile = await getProfile();
  const isTeacher = profile.role === "teacher";
  const { code, studentId, limit: rawLimit, sort: rawSort } = await searchParams;
  const targetStudentId = isTeacher && studentId ? studentId : profile.id;
  const sortMode: "date_desc" | "date_asc" | "gap_desc" =
    rawSort === "date_asc" || rawSort === "gap_desc" ? rawSort : "date_desc";
  const limitCount =
    rawLimit && rawLimit !== "all" && Number.isFinite(Number(rawLimit))
      ? Math.max(1, Number(rawLimit))
      : null;

  if (!code) {
    redirect("/dashboard/mastery");
  }

  const supabase = await createClient();
  const [
    { data: studentProfile },
    { data: subtopicRow },
    mastery,
    { data: allSubtopics },
    { data: markRows },
    { data: selfRows },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name")
      .eq("id", targetStudentId)
      .single(),
    supabase
      .from("subtopics")
      .select("code, descriptor")
      .eq("code", code)
      .maybeSingle(),
    getStudentMastery(targetStudentId),
    supabase.from("subtopics").select("code, descriptor"),
    supabase
      .from("student_marks")
      .select(`
        marks_awarded,
        test_item_id,
        test_items(
          id,
          ib_question_code,
          question_number,
          part_label,
          max_marks,
          subtopic_codes,
          tests(id, name, test_date)
        )
      `)
      .eq("student_id", targetStudentId),
    supabase
      .from("student_self_scores")
      .select(`
        self_marks,
        test_item_id,
        test_items(
          id,
          ib_question_code,
          question_number,
          part_label,
          max_marks,
          subtopic_codes,
          tests(id, name, test_date)
        )
      `)
      .eq("student_id", targetStudentId),
  ]);

  const selected = mastery.find((m) => m.code === code);
  const studentName = studentProfile?.display_name ?? "Student";
  const subtopicDescriptor = subtopicRow?.descriptor ?? code;

  const subtopicDescriptorMap = new Map(
    (allSubtopics ?? []).map((s) => [s.code, s.descriptor])
  );

  const linkedByItem = new Map<string, LinkedAssessmentRow>();

  for (const row of markRows ?? []) {
    const item = normalizeJoinedTestItem(row.test_items);
    if (!item) continue;
    const testMeta = normalizeTestMeta(item.tests);
    const subtopicCodes = item.subtopic_codes ?? [];
    if (!subtopicCodes.includes(code)) continue;

    linkedByItem.set(item.id, {
      testItemId: item.id,
      testId: testMeta?.id ?? null,
      questionCode: item.ib_question_code ?? "—",
      questionNumber: item.question_number,
      partLabel: item.part_label ?? "",
      testName: testMeta?.name ?? "Untitled Test",
      testDate: testMeta?.test_date ?? null,
      maxMarks: item.max_marks,
      teacherMarks: row.marks_awarded ?? null,
      selfMarks: null,
      subtopicCodes,
    });
  }

  for (const row of selfRows ?? []) {
    const item = normalizeJoinedTestItem(row.test_items);
    if (!item) continue;
    const testMeta = normalizeTestMeta(item.tests);
    const subtopicCodes = item.subtopic_codes ?? [];
    if (!subtopicCodes.includes(code)) continue;

    const existing = linkedByItem.get(item.id);
    if (existing) {
      existing.selfMarks = row.self_marks ?? null;
      continue;
    }

    linkedByItem.set(item.id, {
      testItemId: item.id,
      testId: testMeta?.id ?? null,
      questionCode: item.ib_question_code ?? "—",
      questionNumber: item.question_number,
      partLabel: item.part_label ?? "",
      testName: testMeta?.name ?? "Untitled Test",
      testDate: testMeta?.test_date ?? null,
      maxMarks: item.max_marks,
      teacherMarks: null,
      selfMarks: row.self_marks ?? null,
      subtopicCodes,
    });
  }

  const effectiveSelfMarks = (row: LinkedAssessmentRow) => row.selfMarks ?? 0;

  const markGap = (row: LinkedAssessmentRow) => {
    if (row.teacherMarks === null) return -1;
    return Math.abs(row.teacherMarks - effectiveSelfMarks(row));
  };

  const linkedQuestions = [...linkedByItem.values()].sort((a, b) => {
    const ad = a.testDate ? Date.parse(a.testDate) : 0;
    const bd = b.testDate ? Date.parse(b.testDate) : 0;

    if (sortMode === "date_asc") return ad - bd;
    if (sortMode === "gap_desc") {
      const gapDiff = markGap(b) - markGap(a);
      if (gapDiff !== 0) return gapDiff;
      return bd - ad;
    }
    return bd - ad;
  });

  const visibleQuestions =
    limitCount !== null ? linkedQuestions.slice(0, limitCount) : linkedQuestions;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header>
        <a href={`/dashboard/mastery${isTeacher && studentId ? `?studentId=${encodeURIComponent(studentId)}` : ""}`} className="text-sm text-da-accent hover:underline">
          ← Back to mastery
        </a>
        <h1 className="mt-2 font-serif text-3xl font-bold text-da-text">
          {studentName}&apos;s mastery for {code}
        </h1>
        <p className="mt-1 text-sm text-da-muted">
          {subtopicDescriptor}
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-da-border bg-da-surface p-4 shadow-lg shadow-black/20">
          <p className="text-xs font-semibold uppercase tracking-wide text-da-muted">Code</p>
          <p className="mt-1 font-mono text-lg font-bold text-da-text">{code}</p>
        </div>
        <div className="rounded-xl border border-da-border bg-da-surface p-4 shadow-lg shadow-black/20">
          <p className="text-xs font-semibold uppercase tracking-wide text-da-muted">Teacher mastery</p>
          <p className="mt-1 text-2xl font-bold text-da-accent">
            {selected ? `${selected.percentage}%` : "—"}
          </p>
          <p className="text-sm text-da-muted">
            {selected ? `${selected.marks_awarded}/${selected.total_marks} marks` : "No mastery data yet"}
          </p>
        </div>
        <div className="rounded-xl border border-da-border bg-da-surface p-4 shadow-lg shadow-black/20">
          <p className="text-xs font-semibold uppercase tracking-wide text-da-muted">Self mastery</p>
          <p className="mt-1 text-2xl font-bold text-da-amber">
            {selected ? `${selected.self_percentage}%` : "—"}
          </p>
          <p className="text-sm text-da-muted">
            {selected ? `${selected.self_marks}/${selected.total_marks} marks` : "No self-score data yet"}
          </p>
        </div>
      </section>

      <section className="rounded-2xl border border-da-border bg-da-surface/90 p-5 shadow-lg shadow-black/30 wood-surface space-y-4">
        <h2 className="text-xl font-bold text-da-text">Question Links</h2>
        <p className="text-sm text-da-muted">
          Showing linked question parts from this student&apos;s assessments where the selected subtopic appears.
          Each row includes all subtopics tagged on that question part.
        </p>

        <form method="GET" className="flex flex-wrap items-end gap-3 rounded-lg border border-da-border/70 bg-da-bg/50 p-3">
          <input type="hidden" name="code" value={code} />
          {isTeacher && studentId && <input type="hidden" name="studentId" value={studentId} />}

          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-da-muted">Last N Assessments</span>
            <select
              name="limit"
              defaultValue={limitCount === null ? "all" : String(limitCount)}
              className="rounded border border-da-border bg-da-surface px-2 py-1 text-sm text-da-text"
            >
              <option value="5">5</option>
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="all">All</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-da-muted">Sort</span>
            <select
              name="sort"
              defaultValue={sortMode}
              className="rounded border border-da-border bg-da-surface px-2 py-1 text-sm text-da-text"
            >
              <option value="date_desc">Newest First</option>
              <option value="date_asc">Oldest First</option>
              <option value="gap_desc">Highest Disagreement</option>
            </select>
          </label>

          <button type="submit" className="da-btn">
            Apply
          </button>

          <p className="ml-auto text-xs text-da-muted">
            Showing {visibleQuestions.length} of {linkedQuestions.length}
          </p>
        </form>

        {linkedQuestions.length === 0 ? (
          <div className="rounded-lg border border-da-border/70 bg-da-bg/50 p-4 text-sm text-da-muted">
            No linked assessment questions were found for subtopic {code}.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-da-border/70">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-da-bg/60 text-left text-da-muted">
                  <th className="px-3 py-2 font-semibold">Assessment</th>
                  <th className="px-3 py-2 font-semibold">Question</th>
                  <th className="px-3 py-2 font-semibold">Marks</th>
                  <th className="px-3 py-2 font-semibold">All Subtopics On Part</th>
                </tr>
              </thead>
              <tbody>
                {visibleQuestions.map((q) => (
                  <tr key={q.testItemId} className="border-t border-da-border/50">
                    <td className="px-3 py-2 text-da-text">
                      <div className="font-medium">
                        {isTeacher && q.testId ? (
                          <a
                            href={`/dashboard/questions?testId=${encodeURIComponent(q.testId)}`}
                            className="da-btn-link"
                          >
                            {q.testName}
                          </a>
                        ) : (
                          q.testName
                        )}
                      </div>
                      <div className="text-xs text-da-muted">{q.testDate ?? "No date"}</div>
                    </td>
                    <td className="px-3 py-2 text-da-text">
                      <a
                        href={`/dashboard/questions?search=${encodeURIComponent(q.questionCode)}`}
                        className="da-btn-link"
                      >
                        {q.questionCode}
                      </a>
                      <div className="text-xs text-da-muted">
                        Q{q.questionNumber}{q.partLabel ? q.partLabel : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-da-text">
                      <div className="text-xs text-da-muted">Teacher</div>
                      <div>{q.teacherMarks !== null ? `${q.teacherMarks}/${q.maxMarks}` : "—"}</div>
                      <div className="mt-1 text-xs text-da-muted">Self</div>
                      <div>{`${effectiveSelfMarks(q)}/${q.maxMarks}`}</div>
                      {q.selfMarks === null && (
                        <div className="text-[11px] text-da-muted">Not submitted (counted as 0)</div>
                      )}
                      <div className="mt-1 text-xs text-da-muted">
                        Gap: {markGap(q) >= 0 ? markGap(q) : "—"}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-da-text">
                      <div className="flex flex-wrap gap-1">
                        {q.subtopicCodes.map((subtopicCode) => {
                          const descriptor = subtopicDescriptorMap.get(subtopicCode) ?? subtopicCode;
                          const isSelected = subtopicCode === code;
                          return (
                            <span
                              key={`${q.testItemId}-${subtopicCode}`}
                              className={`rounded-full border px-2 py-0.5 text-xs ${
                                isSelected
                                  ? "border-da-accent bg-da-hover text-da-text"
                                  : "border-da-border/70 bg-da-bg/60 text-da-muted"
                              }`}
                            >
                              {subtopicCode} — {descriptor}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
