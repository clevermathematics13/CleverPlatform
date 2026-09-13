import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * These tests exist because this module reads with the service key.
 *
 * na_rubric_items is teacher-only under RLS, so every other path to the answer
 * key is closed by a policy and would stay closed if the code above it were
 * wrong. This one is not: the service key bypasses RLS, and the only thing
 * standing between an unreleased packet and a student is the two checks below.
 * A test that asserted the happy path would not notice either of them going
 * missing, so what is asserted here is that nothing is read at all when a
 * check fails.
 */

type Row = Record<string, unknown> | null;

/** The one scan row the fake database holds, and a note of what was queried. */
const db: { scan: Row; anchors: unknown[]; tablesRead: string[] } = {
  scan: null,
  anchors: [],
  tablesRead: [],
};

function builder(table: string) {
  db.tablesRead.push(table);
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => Promise.resolve({ data: db.anchors, error: null }),
    maybeSingle: () => Promise.resolve({ data: db.scan, error: null }),
  };
  return chain;
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: (table: string) => builder(table) }),
}));

const { getReleasedAnswersForPacketScan, getReleasedAnswersForStudent } = await import(
  "./na-answer-service"
);

const ANCHOR = {
  qid: "Q1",
  base_qid: "Q1",
  part_label: null,
  sort_order: 0,
  marks_available: 3,
  answer_sketch: "(a) 420 (b) 330",
  open_rubric: null,
  na_rubric_items: { question_number: 1, answer_key: "(a) 420.", open_rubric: null, marks: 3 },
};

beforeEach(() => {
  db.scan = null;
  db.anchors = [ANCHOR];
  db.tablesRead = [];
});

describe("getReleasedAnswersForPacketScan", () => {
  it("returns the answers for a released scan", async () => {
    db.scan = { id: "s1", status: "released", packet_version_id: "pv1" };
    const lines = await getReleasedAnswersForPacketScan("s1");
    expect(lines).toEqual([
      { label: "Q1", answerHtml: "(a) 420 (b) 330", answerChars: 15, kind: "answer", marks: 3 },
    ]);
  });

  it("reads no rubric at all for a scan that is not released", async () => {
    db.scan = { id: "s1", status: "assessed", packet_version_id: "pv1" };
    await expect(getReleasedAnswersForPacketScan("s1")).resolves.toEqual([]);
    expect(db.tablesRead).not.toContain("na_anchors");
  });

  it("reads no rubric for a scan that does not exist", async () => {
    db.scan = null;
    await expect(getReleasedAnswersForPacketScan("nope")).resolves.toEqual([]);
    expect(db.tablesRead).not.toContain("na_anchors");
  });

  it("reads no rubric for a released scan with no packet version", async () => {
    db.scan = { id: "s1", status: "released", packet_version_id: null };
    await expect(getReleasedAnswersForPacketScan("s1")).resolves.toEqual([]);
    expect(db.tablesRead).not.toContain("na_anchors");
  });

  it("never hands over the parts of a rubric row that belong to the teacher", async () => {
    db.scan = { id: "s1", status: "released", packet_version_id: "pv1" };
    db.anchors = [
      {
        ...ANCHOR,
        answer_sketch: null,
        na_rubric_items: {
          question_number: 1,
          answer_key:
            "Answer: 420 Mark scheme: (M1) for the product Common error: adds instead of multiplying",
          open_rubric: null,
          marks: 3,
        },
      },
    ];
    const [line] = await getReleasedAnswersForPacketScan("s1");
    expect(line.answerHtml).toBe("420");
    expect(JSON.stringify(line)).not.toContain("M1");
    expect(JSON.stringify(line)).not.toContain("Common error");
  });
});

describe("getReleasedAnswersForStudent", () => {
  it("returns the answers to the student the scan belongs to", async () => {
    db.scan = {
      id: "s1",
      status: "released",
      packet_version_id: "pv1",
      student_profile_id: "student-1",
    };
    const lines = await getReleasedAnswersForStudent("s1", "student-1");
    expect(lines).toHaveLength(1);
  });

  it("reads no rubric for a scan belonging to somebody else", async () => {
    db.scan = {
      id: "s1",
      status: "released",
      packet_version_id: "pv1",
      student_profile_id: "student-1",
    };
    await expect(getReleasedAnswersForStudent("s1", "student-2")).resolves.toEqual([]);
    expect(db.tablesRead).not.toContain("na_anchors");
  });

  it("reads no rubric for a scan no student has been matched to yet", async () => {
    // student_profile_id stays NULL until a student first signs in. A page
    // asking on behalf of a student must not fall through that.
    db.scan = {
      id: "s1",
      status: "released",
      packet_version_id: "pv1",
      student_profile_id: null,
    };
    await expect(getReleasedAnswersForStudent("s1", "student-1")).resolves.toEqual([]);
    expect(db.tablesRead).not.toContain("na_anchors");
  });
});
