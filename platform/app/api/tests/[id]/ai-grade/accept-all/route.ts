import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { INVITED_SUBJECT_PREFIX } from "@/lib/ai-grading";
import { fetchAllRows } from "@/lib/na-scanning";

export const maxDuration = 300;

interface RunRow {
  id: string;
  student_id: string | null;
  invited_student_id: string | null;
  created_at: string;
}

/** Which student_marks/mark_changes columns a run's identity writes against. */
interface Identity {
  student_id: string | null;
  invited_student_id: string | null;
}

/** One not-yet-accepted ai_grade_results row, as this route reads it. */
interface PendingResult {
  id: string;
  run_id: string;
  test_item_id: string;
  suggested_marks: number;
  max_marks: number;
  confidence: string;
}

/** One student_marks row this batch may overwrite (for the audit log). */
interface ExistingMark {
  id: string;
  student_id: string | null;
  invited_student_id: string | null;
  test_item_id: string;
  marks_awarded: number;
}

function identityFor(r: RunRow): Identity {
  return r.student_id
    ? { student_id: r.student_id, invited_student_id: null }
    : { student_id: null, invited_student_id: r.invited_student_id };
}

/**
 * POST /api/tests/[id]/ai-grade/accept-all
 *
 * Accepts every not-yet-accepted suggested mark, for every question, for
 * every student's most recent COMPLETE run on this assessment -- one click
 * instead of opening each student's review individually. Applies the exact
 * same student_marks / mark_changes writes as POST .../accept, just batched
 * across the whole class rather than one run's selections at a time.
 *
 * Works the same whether a run's identity is a registered student
 * (student_id) or an imported-but-not-yet-registered one
 * (invited_student_id) -- see student_marks.invited_student_id. Since a
 * batch this size mixes both, and each identity kind needs its own upsert
 * conflict target (test_item_id,student_id vs test_item_id,invited_student_id),
 * the two groups are upserted separately.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const { id: testId } = await params;

  const { data: allRuns, error: runsErr } = await supabase
    .from("ai_grade_runs")
    .select("id, student_id, invited_student_id, created_at")
    .eq("test_id", testId)
    .eq("status", "complete")
    .order("created_at", { ascending: false });

  if (runsErr) return NextResponse.json({ error: runsErr.message }, { status: 500 });

  // Newest run per student, same rule the review UI uses (loadOverview).
  const latestBySubject = new Map<string, RunRow>();
  for (const r of (allRuns ?? []) as RunRow[]) {
    const key = r.student_id ?? `${INVITED_SUBJECT_PREFIX}${r.invited_student_id}`;
    if (!latestBySubject.has(key)) latestBySubject.set(key, r);
  }

  const runs = [...latestBySubject.values()];
  if (runs.length === 0) {
    return NextResponse.json(
      { error: "No completed runs to accept.", appliedCount: 0, studentsProcessed: 0 },
      { status: 404 }
    );
  }

  const identityByRun = new Map(runs.map((r) => [r.id, identityFor(r)]));
  const runIds = runs.map((r) => r.id);

  // Every read here pages through .range(): PostgREST returns at most 1000
  // rows per request and does not say when it stopped. A single query for
  // a 50-student test (2,050 result rows) handed back 1,000 of them, so the
  // marks below were written for half the class while the accepted flag,
  // set by run id at the end, covered everyone -- 21 students then had
  // "accepted" suggestions and nothing in Clev's Marks, and a second click
  // reported nothing left to accept.
  let results: PendingResult[];
  try {
    results = await fetchAllRows<PendingResult>((from, to) =>
      supabase
        .from("ai_grade_results")
        .select("id, run_id, test_item_id, suggested_marks, max_marks, confidence")
        .in("run_id", runIds)
        .eq("accepted", false)
        .order("id", { ascending: true })
        .range(from, to)
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  if (!results || results.length === 0) {
    return NextResponse.json({
      appliedCount: 0,
      studentsProcessed: runs.length,
      message: "Nothing to accept -- every suggested mark for every student is already accepted.",
    });
  }

  const clamped = results.map((r) => ({
    ...r,
    identity: identityByRun.get(r.run_id)!,
    marks: Math.max(0, Math.min(r.suggested_marks, r.max_marks)),
  }));

  // Prior marks, for the mark_changes audit log -- one query per identity
  // kind for every (subject, test_item) pair this batch touches, instead of
  // one query per row (this test alone can be 41 items x 17 students).
  const testItemIds = [...new Set(clamped.map((r) => r.test_item_id))];
  const profileRows = clamped.filter((r) => r.identity.student_id);
  const invitedRows = clamped.filter((r) => r.identity.invited_student_id);

  const existingByKey = new Map<string, number>();
  try {
    if (profileRows.length > 0) {
      const studentIds = [...new Set(profileRows.map((r) => r.identity.student_id!))];
      const existing = await fetchAllRows<ExistingMark>((from, to) =>
        supabase
          .from("student_marks")
          .select("id, student_id, invited_student_id, test_item_id, marks_awarded")
          .in("student_id", studentIds)
          .in("test_item_id", testItemIds)
          .order("id", { ascending: true })
          .range(from, to)
      );
      for (const m of existing) existingByKey.set(`p:${m.student_id}:${m.test_item_id}`, m.marks_awarded);
    }
    if (invitedRows.length > 0) {
      const invitedIds = [...new Set(invitedRows.map((r) => r.identity.invited_student_id!))];
      const existing = await fetchAllRows<ExistingMark>((from, to) =>
        supabase
          .from("student_marks")
          .select("id, student_id, invited_student_id, test_item_id, marks_awarded")
          .in("invited_student_id", invitedIds)
          .in("test_item_id", testItemIds)
          .order("id", { ascending: true })
          .range(from, to)
      );
      for (const m of existing) existingByKey.set(`i:${m.invited_student_id}:${m.test_item_id}`, m.marks_awarded);
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  const keyFor = (r: (typeof clamped)[number]) =>
    r.identity.student_id
      ? `p:${r.identity.student_id}:${r.test_item_id}`
      : `i:${r.identity.invited_student_id}:${r.test_item_id}`;

  // Every write below goes out in chunks. A whole-class accept (50 students
  // x 41 parts = 2,018 rows on 5 Sep 2026) sent as ONE request had only its
  // first 1,000 rows land, silently, and the request that followed was
  // refused outright -- so 21 students' marks never reached Clev's Marks
  // while the audit log said they had. 400 rows per request stays well
  // inside the gateway's limits.
  const CHUNK = 400;
  const chunks = <T,>(rows: T[]): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
    return out;
  };

  for (const chunk of chunks(profileRows)) {
    const { error } = await supabase.from("student_marks").upsert(
      chunk.map((r) => ({
        test_item_id: r.test_item_id,
        student_id: r.identity.student_id,
        invited_student_id: null,
        marks_awarded: r.marks,
      })),
      { onConflict: "test_item_id,student_id" }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  for (const chunk of chunks(invitedRows)) {
    const { error } = await supabase.from("student_marks").upsert(
      chunk.map((r) => ({
        test_item_id: r.test_item_id,
        student_id: null,
        invited_student_id: r.identity.invited_student_id,
        marks_awarded: r.marks,
      })),
      { onConflict: "test_item_id,invited_student_id" }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Audit only real changes: a mark that already held this value (e.g. a
  // re-run of accept-all after a partial failure) is not a change.
  const changes = clamped
    .filter((r) => existingByKey.get(keyFor(r)) !== r.marks)
    .map((r) => ({
      test_item_id: r.test_item_id,
      student_id: r.identity.student_id,
      invited_student_id: r.identity.invited_student_id,
      changed_by: user.id,
      old_marks: existingByKey.get(keyFor(r)) ?? null,
      new_marks: r.marks,
      reason: `AI grading run ${r.run_id}, suggestion accepted as marked via batch accept-all (${r.confidence} confidence)`,
    }));
  for (const chunk of chunks(changes)) {
    const { error: changesErr } = await supabase.from("mark_changes").insert(chunk);
    if (changesErr) return NextResponse.json({ error: changesErr.message }, { status: 500 });
  }

  // Flag the results accepted by RUN, not by result id. Listing every
  // result id put ~2,000 UUIDs in the query string for a 50-student test
  // (41 parts each) and the database gateway refused the URL with a bare
  // "Bad Request" -- after the marks above had already been written, so
  // the review UI kept showing them as unaccepted. The run list is short
  // (one id per student) and, with the same accepted = false filter the
  // results were selected with, names exactly the rows just applied.
  const acceptedAt = new Date().toISOString();
  const { error: acceptErr } = await supabase
    .from("ai_grade_results")
    .update({ accepted: true, accepted_at: acceptedAt, accepted_by: user.id })
    .in("run_id", runIds)
    .eq("accepted", false);
  if (acceptErr) {
    return NextResponse.json(
      {
        error: `The marks were written to Clev's Marks, but flagging the suggestions as accepted failed: ${acceptErr.message}. Run "Accept all" again to finish.`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    appliedCount: clamped.length,
    studentsProcessed: runs.length,
    totalApplied: clamped.reduce((sum, r) => sum + r.marks, 0),
  });
}
