import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadMarkProtection, selfAssessedStudentIds } from "./protected-marks-service";

type Row = Record<string, unknown>;

interface Call {
  table: string;
  eq: [string, unknown][];
  in: [string, unknown[]][];
  range?: [number, number];
}

/**
 * A stand-in for the supabase client that answers per table, applies the
 * .eq()/.in() filters it was given, and reproduces PostgREST's silent
 * 1000-row cap on .range(). Every request is recorded, so a test can check
 * the chunking and the paging as well as the answer.
 */
function fakeClient(tables: Record<string, Row[]>, options: { failOn?: string; pageCap?: number } = {}) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, eq: [], in: [] };
      calls.push(call);
      const run = () => {
        if (options.failOn === table) return { data: null, error: { message: `${table} unavailable` } };
        let rows = (tables[table] ?? []).filter(
          (r) => call.eq.every(([c, v]) => r[c] === v) && call.in.every(([c, vs]) => vs.includes(r[c]))
        );
        if (call.range) {
          const [from, to] = call.range;
          rows = rows.slice(from, from + Math.min(to - from + 1, options.pageCap ?? 1000));
        }
        return { data: rows, error: null };
      };
      const q = {
        select: () => q,
        eq: (column: string, value: unknown) => {
          call.eq.push([column, value]);
          return q;
        },
        in: (column: string, values: unknown[]) => {
          call.in.push([column, [...values]]);
          return q;
        },
        order: () => q,
        range: (from: number, to: number) => {
          call.range = [from, to];
          return Promise.resolve(run());
        },
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve(run()).then(resolve, reject),
      };
      return q;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const TEST_A = uuid(900001);
const TEST_B = uuid(900002);

describe("selfAssessedStudentIds", () => {
  const items = [
    { id: "item-a1", test_id: TEST_A },
    { id: "item-a2", test_id: TEST_A },
    { id: "item-b1", test_id: TEST_B },
  ];
  const s1 = uuid(1);
  const s2 = uuid(2);
  const s3 = uuid(3);

  it("finds the students with a self-score row on this test, and only them", async () => {
    const { client } = fakeClient({
      test_items: items,
      student_self_scores: [
        { id: "x1", test_item_id: "item-a2", student_id: s1, self_marks: 2 },
        // Self-assessed a different test: does not count for this one.
        { id: "x2", test_item_id: "item-b1", student_id: s2, self_marks: 1 },
      ],
    });
    expect(await selfAssessedStudentIds(client, TEST_A, [s1, s2, s3])).toEqual(new Set([s1]));
  });

  // A Redo or an all-blank submit leaves rows whose self marks are null.
  it("counts a row whose self mark is blank", async () => {
    const { client } = fakeClient({
      test_items: items,
      student_self_scores: [{ id: "x1", test_item_id: "item-a1", student_id: s3, self_marks: null }],
    });
    expect(await selfAssessedStudentIds(client, TEST_A, [s3])).toEqual(new Set([s3]));
  });

  it("makes no request for an empty list, or for invited-only students", async () => {
    const { client, calls } = fakeClient({ test_items: items, student_self_scores: [] });
    expect(await selfAssessedStudentIds(client, TEST_A, [])).toEqual(new Set());
    expect(await selfAssessedStudentIds(client, TEST_A, [`invited-${uuid(7)}`])).toEqual(new Set());
    expect(calls).toHaveLength(0);
  });

  it("throws when either read fails, so the caller writes nothing", async () => {
    const itemsDown = fakeClient({ test_items: items, student_self_scores: [] }, { failOn: "test_items" });
    await expect(selfAssessedStudentIds(itemsDown.client, TEST_A, [s1])).rejects.toThrow(/test_items unavailable/);
    const scoresDown = fakeClient({ test_items: items, student_self_scores: [] }, { failOn: "student_self_scores" });
    await expect(selfAssessedStudentIds(scoresDown.client, TEST_A, [s1])).rejects.toThrow(
      /student_self_scores unavailable/
    );
  });

  it("pages past the 1000-row cap", async () => {
    // 30 parts x 50 students = 1500 rows in one chunk pair: one request
    // would return 1000 of them with no error and miss 17 students.
    const parts = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, test_id: TEST_A }));
    const students = Array.from({ length: 50 }, (_, i) => uuid(100 + i));
    const scores = students.flatMap((student, s) =>
      parts.map((p, i) => ({ id: `r${String(s * 30 + i).padStart(5, "0")}`, test_item_id: p.id, student_id: student }))
    );
    const { client, calls } = fakeClient({ test_items: parts, student_self_scores: scores });
    const found = await selfAssessedStudentIds(client, TEST_A, students);
    expect(found.size).toBe(50);
    expect(calls.filter((c) => c.table === "student_self_scores").length).toBeGreaterThan(1);
  });

  it("keeps every .in() list inside its bound", async () => {
    const parts = Array.from({ length: 100 }, (_, i) => ({ id: `p${i}`, test_id: TEST_A }));
    const students = Array.from({ length: 200 }, (_, i) => uuid(1000 + i));
    const { client, calls } = fakeClient({ test_items: parts, student_self_scores: [] });
    await selfAssessedStudentIds(client, TEST_A, students);
    const scoreCalls = calls.filter((c) => c.table === "student_self_scores");
    // 3 part chunks (40, 40, 20) x 3 student chunks (80, 80, 40).
    expect(scoreCalls).toHaveLength(9);
    for (const c of scoreCalls) {
      const byColumn = new Map(c.in);
      expect(byColumn.get("test_item_id")!.length).toBeLessThanOrEqual(40);
      expect(byColumn.get("student_id")!.length).toBeLessThanOrEqual(80);
    }
  });
});

describe("loadMarkProtection", () => {
  const items = [
    { id: "item-a1", test_id: TEST_A },
    { id: "item-a2", test_id: TEST_A },
    { id: "item-b1", test_id: TEST_B },
  ];
  const s1 = uuid(11);
  const s2 = uuid(12);

  it("scopes the protection to the test the student self-assessed", async () => {
    const { client } = fakeClient({
      test_items: items,
      student_self_scores: [{ id: "x1", test_item_id: "item-a1", student_id: s1, self_marks: 3 }],
    });
    const protection = await loadMarkProtection(client, [
      { testItemId: "item-a2", studentId: s1 },
      { testItemId: "item-b1", studentId: s1 },
      { testItemId: "item-a2", studentId: s2 },
    ]);
    // Part a2 is protected though the self-score is on a1: any part counts.
    expect(protection.isSelfAssessed(s1, "item-a2")).toBe(true);
    expect(protection.isSelfAssessed(s1, "item-b1")).toBe(false);
    expect(protection.isSelfAssessed(s2, "item-a2")).toBe(false);
  });

  it("reads an unknown part and an invited-only student as unprotected", async () => {
    const { client } = fakeClient({
      test_items: items,
      student_self_scores: [{ id: "x1", test_item_id: "item-a1", student_id: s1, self_marks: 3 }],
    });
    const protection = await loadMarkProtection(client, [
      { testItemId: "gone", studentId: s1 },
      { testItemId: "item-a1", studentId: `invited-${uuid(5)}` },
    ]);
    expect(protection.isSelfAssessed(s1, "gone")).toBe(false);
    expect(protection.isSelfAssessed(`invited-${uuid(5)}`, "item-a1")).toBe(false);
  });

  it("throws when the parts cannot be read", async () => {
    const { client } = fakeClient({ test_items: items }, { failOn: "test_items" });
    await expect(loadMarkProtection(client, [{ testItemId: "item-a1", studentId: s1 }])).rejects.toThrow();
  });
});
