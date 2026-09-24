/**
 * Server-side reads for the teacher's Re-mark requests page
 * (app/dashboard/remark-requests). Everything is read in the teacher's own
 * session, so the table's policy decides what is in the queue: requests on
 * tests this teacher owns.
 *
 * Built for the size a real assessment reaches -- Key Assessment 1 alone had
 * 187 parts where a student's mark and ClevMarks differed -- so every read
 * that can pass PostgREST's silent 1000-row cap is paged (fetchAllRows), and
 * each part's mark scheme is rendered once, not once per request.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/na-scanning";
import { paperQuestionPrefixes } from "@/lib/paper-labels";
import { studentMarkSchemeParts } from "@/lib/student-mark-scheme";
import type { ReflectionMarkScheme, RemarkStatus } from "@/lib/reflection-types";
import type { RemarkQueueEntry } from "@/lib/remark-requests";

/** How far back the page lists requests already answered. */
export const RESOLVED_WINDOW_DAYS = 30;

export interface TeacherRemarkEntry extends RemarkQueueEntry {
  testHidden: boolean;
  /** The part's label: the paper's own "2.1(a)" where the draft numbers its
   *  sections (as the student's page shows it), else "Q1(a)". */
  partLabel: string;
  maxMarks: number;
  studentId: string;
  studentName: string;
  explanation: string;
  updatedAt: string;
  selfMarksAtRequest: number | null;
  /** The student has uploaded corrections for this test. */
  hasUpload: boolean;
  status: RemarkStatus;
  resolvedMarks: number | null;
  teacherNote: string | null;
  resolvedAt: string | null;
}

export interface TeacherRemarkQueue {
  waiting: TeacherRemarkEntry[];
  resolved: TeacherRemarkEntry[];
  /** Each part's mark scheme, as the student saw it, keyed by test_items.id. */
  schemes: Record<string, ReflectionMarkScheme>;
  /** Set when the queue could not be read at all. */
  error: string | null;
}

type RequestRow = {
  id: string;
  test_item_id: string;
  student_id: string;
  explanation: string;
  status: RemarkStatus;
  marks_at_request: number;
  self_marks_at_request: number | null;
  resolved_marks: number | null;
  teacher_note: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

const REQUEST_COLUMNS =
  "id, test_item_id, student_id, explanation, status, marks_at_request, self_marks_at_request, resolved_marks, teacher_note, created_at, updated_at, resolved_at";

/** PostgREST renders `.in("col", [])` as a syntax error, not an empty match. */
const NO_SUCH_UUID = "00000000-0000-0000-0000-000000000000";
const orNone = (ids: string[]) => (ids.length ? ids : [NO_SUCH_UUID]);

export async function loadTeacherRemarkQueue(supabase: SupabaseClient): Promise<TeacherRemarkQueue> {
  const empty: TeacherRemarkQueue = { waiting: [], resolved: [], schemes: {}, error: null };
  const since = new Date(Date.now() - RESOLVED_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  let waitingRows: RequestRow[];
  let resolvedRows: RequestRow[];
  try {
    [waitingRows, resolvedRows] = await Promise.all([
      fetchAllRows<RequestRow>((from, to) =>
        supabase
          .from("remark_requests")
          .select(REQUEST_COLUMNS)
          .eq("status", "pending")
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to)
      ),
      fetchAllRows<RequestRow>((from, to) =>
        supabase
          .from("remark_requests")
          .select(REQUEST_COLUMNS)
          .neq("status", "pending")
          .gte("resolved_at", since)
          .order("resolved_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to)
      ),
    ]);
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : String(e) };
  }

  const rows = [...waitingRows, ...resolvedRows];
  if (rows.length === 0) return empty;

  const itemIds = [...new Set(rows.map((r) => r.test_item_id))];
  const studentIds = [...new Set(rows.map((r) => r.student_id))];

  const { data: items, error: itemsError } = await supabase
    .from("test_items")
    .select("id, test_id, question_number, part_label, max_marks, sort_order, markscheme_text")
    .in("id", orNone(itemIds));
  if (itemsError) return { ...empty, error: itemsError.message };

  const testIds = [...new Set((items ?? []).map((i) => i.test_id as string))];

  type MarkRow = { test_item_id: string; student_id: string; marks_awarded: number | null };
  type SelfRow = { test_item_id: string; student_id: string; self_marks: number | null };
  let marks: MarkRow[];
  let selfScores: SelfRow[];
  try {
    [marks, selfScores] = await Promise.all([
      fetchAllRows<MarkRow>((from, to) =>
        supabase
          .from("student_marks")
          .select("test_item_id, student_id, marks_awarded")
          .in("test_item_id", orNone(itemIds))
          .in("student_id", orNone(studentIds))
          .order("id", { ascending: true })
          .range(from, to)
      ),
      fetchAllRows<SelfRow>((from, to) =>
        supabase
          .from("student_self_scores")
          .select("test_item_id, student_id, self_marks")
          .in("test_item_id", orNone(itemIds))
          .in("student_id", orNone(studentIds))
          .order("id", { ascending: true })
          .range(from, to)
      ),
    ]);
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : String(e) };
  }

  const [testsRes, profilesRes, uploadsRes] = await Promise.all([
    supabase.from("tests").select("id, name, hidden, custom_content").in("id", orNone(testIds)),
    supabase.from("profiles").select("id, display_name").in("id", orNone(studentIds)),
    supabase
      .from("pdf_uploads")
      .select("student_id, test_id")
      .in("test_id", orNone(testIds))
      .in("student_id", orNone(studentIds)),
  ]);
  const lookupError = testsRes.error ?? profilesRes.error ?? uploadsRes.error;
  if (lookupError) return { ...empty, error: lookupError.message };

  const itemById = new Map((items ?? []).map((i) => [i.id as string, i]));
  const testById = new Map((testsRes.data ?? []).map((t) => [t.id as string, t]));
  const nameById = new Map(
    (profilesRes.data ?? []).map((p) => [p.id as string, (p.display_name as string | null) ?? "Student"])
  );
  const key = (itemId: string, studentId: string) => `${itemId}|${studentId}`;
  const markByKey = new Map(marks.map((m) => [key(m.test_item_id, m.student_id), m.marks_awarded]));
  const selfByKey = new Map(selfScores.map((s) => [key(s.test_item_id, s.student_id), s.self_marks]));
  const uploaded = new Set((uploadsRes.data ?? []).map((u) => `${u.test_id}|${u.student_id}`));

  // Labels and mark schemes come from each test's draft when it has one,
  // exactly as the student's own page builds them.
  const prefixesByTest = new Map<string, Map<number, string>>();
  const schemes: Record<string, ReflectionMarkScheme> = {};
  for (const testId of testIds) {
    const test = testById.get(testId);
    const customContent = test?.custom_content ?? null;
    prefixesByTest.set(testId, paperQuestionPrefixes(customContent));
    const testItems = (items ?? [])
      .filter((i) => i.test_id === testId)
      .map((i) => ({
        id: i.id as string,
        sort_order: i.sort_order as number,
        markscheme_text: (i.markscheme_text as string | null) ?? null,
      }));
    for (const [itemId, scheme] of studentMarkSchemeParts(customContent, testItems)) {
      schemes[itemId] = scheme;
    }
  }

  const toEntry = (r: RequestRow): TeacherRemarkEntry | null => {
    const item = itemById.get(r.test_item_id);
    if (!item) return null;
    const testId = item.test_id as string;
    const test = testById.get(testId);
    const prefix = prefixesByTest.get(testId)?.get(item.sort_order as number);
    const partLabel = `${prefix ?? `Q${item.question_number}`}${item.part_label ? `(${item.part_label})` : ""}`;
    return {
      id: r.id,
      testId,
      testName: (test?.name as string | undefined) ?? "Test",
      testHidden: !!test?.hidden,
      testItemId: r.test_item_id,
      sortOrder: item.sort_order as number,
      partLabel,
      maxMarks: item.max_marks as number,
      studentId: r.student_id,
      studentName: nameById.get(r.student_id) ?? "Student",
      explanation: r.explanation,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      marksAtRequest: r.marks_at_request,
      selfMarksAtRequest: r.self_marks_at_request,
      currentMarks: markByKey.get(key(r.test_item_id, r.student_id)) ?? null,
      currentSelfMarks: selfByKey.get(key(r.test_item_id, r.student_id)) ?? null,
      hasUpload: uploaded.has(`${testId}|${r.student_id}`),
      status: r.status,
      resolvedMarks: r.resolved_marks,
      teacherNote: r.teacher_note,
      resolvedAt: r.resolved_at,
    };
  };

  return {
    waiting: waitingRows.map(toEntry).filter((e): e is TeacherRemarkEntry => e !== null),
    resolved: resolvedRows.map(toEntry).filter((e): e is TeacherRemarkEntry => e !== null),
    schemes,
    error: null,
  };
}
