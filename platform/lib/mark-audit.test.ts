import { describe, it, expect } from "vitest";
import {
  buildMarkChangeRows,
  describeAuditWarning,
  markKey,
  readPriorMarks,
  type MarkChange,
} from "./mark-audit";

const profile = { kind: "profile" as const, id: "p1" };
const invited = { kind: "invited" as const, id: "i1" };
const BY = "teacher-1";

describe("markKey", () => {
  it("separates the two identity kinds even when the ids collide", () => {
    expect(markKey("t1", { kind: "profile", id: "same" })).not.toBe(
      markKey("t1", { kind: "invited", id: "same" })
    );
  });

  it("separates test items for the same student", () => {
    expect(markKey("t1", profile)).not.toBe(markKey("t2", profile));
  });

  it("is stable for the same inputs", () => {
    expect(markKey("t1", profile)).toBe(markKey("t1", { kind: "profile", id: "p1" }));
  });
});

describe("buildMarkChangeRows", () => {
  it("writes a profile mark against student_id and leaves invited_student_id null", () => {
    const rows = buildMarkChangeRows(
      [{ testItemId: "t1", subject: profile, oldMarks: 1, newMarks: 2 }],
      BY,
      "Gradebook edit"
    );
    expect(rows).toEqual([
      {
        test_item_id: "t1",
        student_id: "p1",
        invited_student_id: null,
        changed_by: BY,
        old_marks: 1,
        new_marks: 2,
        reason: "Gradebook edit",
      },
    ]);
  });

  // Agustina's cohort is the live case: every one of them is marked by
  // roster row, with no account and so no profiles.id to attribute to.
  it("writes a roster mark against invited_student_id and leaves student_id null", () => {
    const [row] = buildMarkChangeRows(
      [{ testItemId: "t1", subject: invited, oldMarks: null, newMarks: 3 }],
      BY,
      "Gradebook edit"
    );
    expect(row.student_id).toBeNull();
    expect(row.invited_student_id).toBe("i1");
    expect(row.old_marks).toBeNull();
    expect(row.new_marks).toBe(3);
  });

  it("records a cleared mark as new_marks null, not as a score of zero", () => {
    const [row] = buildMarkChangeRows(
      [{ testItemId: "t1", subject: profile, oldMarks: 4, newMarks: null }],
      BY,
      "Gradebook edit"
    );
    expect(row.new_marks).toBeNull();
    expect(row.new_marks).not.toBe(0);
    expect(row.old_marks).toBe(4);
  });

  it("keeps a genuine zero distinct from a clear", () => {
    const [row] = buildMarkChangeRows(
      [{ testItemId: "t1", subject: profile, oldMarks: 5, newMarks: 0 }],
      BY,
      "Gradebook edit"
    );
    expect(row.new_marks).toBe(0);
  });

  it("drops writes that changed nothing", () => {
    const unchanged: MarkChange[] = [
      { testItemId: "t1", subject: profile, oldMarks: 2, newMarks: 2 },
      { testItemId: "t2", subject: invited, oldMarks: null, newMarks: null },
    ];
    expect(buildMarkChangeRows(unchanged, BY, "Gradebook edit")).toEqual([]);
  });

  it("keeps only the real edits out of a mixed batch", () => {
    const rows = buildMarkChangeRows(
      [
        { testItemId: "t1", subject: profile, oldMarks: 2, newMarks: 2 },
        { testItemId: "t2", subject: profile, oldMarks: 2, newMarks: 3 },
        { testItemId: "t3", subject: invited, oldMarks: 1, newMarks: null },
      ],
      BY,
      "Gradebook edit (batch)"
    );
    expect(rows.map((r) => r.test_item_id)).toEqual(["t2", "t3"]);
    expect(rows.every((r) => r.reason === "Gradebook edit (batch)")).toBe(true);
  });

  it("treats first-time marks as changes, since null to a value is a change", () => {
    const rows = buildMarkChangeRows(
      [{ testItemId: "t1", subject: profile, oldMarks: null, newMarks: 0 }],
      BY,
      "Gradebook edit"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].old_marks).toBeNull();
    expect(rows[0].new_marks).toBe(0);
  });

  it("stamps every row with the acting teacher", () => {
    const rows = buildMarkChangeRows(
      [
        { testItemId: "t1", subject: profile, oldMarks: 1, newMarks: 2 },
        { testItemId: "t2", subject: invited, oldMarks: 1, newMarks: 2 },
      ],
      BY,
      "Gradebook edit"
    );
    expect(rows.every((r) => r.changed_by === BY)).toBe(true);
  });

  it("returns nothing for an empty edit set", () => {
    expect(buildMarkChangeRows([], BY, "Gradebook edit")).toEqual([]);
  });

  it("never sets both identity columns on one row", () => {
    const rows = buildMarkChangeRows(
      [
        { testItemId: "t1", subject: profile, oldMarks: null, newMarks: 1 },
        { testItemId: "t2", subject: invited, oldMarks: null, newMarks: 1 },
      ],
      BY,
      "Gradebook edit"
    );
    for (const r of rows) {
      expect(r.student_id === null || r.invited_student_id === null).toBe(true);
      expect(r.student_id !== null || r.invited_student_id !== null).toBe(true);
    }
  });
});

describe("describeAuditWarning", () => {
  it("says nothing when the trail is sound", () => {
    expect(describeAuditWarning({ priorReadFailed: false, missed: 0 })).toBeNull();
  });

  // The failure is in the RECORD of the change, not the change. A teacher who
  // reads this mid-marking as "my edit was lost" will re-enter marks that were
  // never lost, so every wording states the save first.
  it("leads with the marks being saved, whichever failure it is", () => {
    const missed = describeAuditWarning({ priorReadFailed: false, missed: 1 });
    const priorFailed = describeAuditWarning({ priorReadFailed: true, missed: 0 });
    expect(missed).toMatch(/^Your marks are saved\./);
    expect(priorFailed).toMatch(/^Your marks are saved\./);
  });

  it("never suggests the edit failed or should be redone", () => {
    for (const w of [
      describeAuditWarning({ priorReadFailed: false, missed: 3 }),
      describeAuditWarning({ priorReadFailed: true, missed: 0 }),
      describeAuditWarning({ priorReadFailed: true, missed: 3 }),
    ]) {
      expect(w).not.toMatch(/failed to save|not saved|re-enter|try again|lost/i);
    }
  });

  it("reports unwritten audit rows, pluralised", () => {
    expect(describeAuditWarning({ priorReadFailed: false, missed: 1 })).toContain("1 change");
    expect(describeAuditWarning({ priorReadFailed: false, missed: 4 })).toContain("4 changes");
  });

  it("explains a failed prior read as a possibly-wrong history entry", () => {
    const w = describeAuditWarning({ priorReadFailed: true, missed: 0 });
    expect(w).toContain("first-time mark");
  });

  // A missing row is the worse fact: there is no history entry at all, versus
  // one whose "before" value may be wrong. Report the worse one.
  it("reports the missing rows when both failures happen at once", () => {
    const w = describeAuditWarning({ priorReadFailed: true, missed: 2 });
    expect(w).toContain("2 changes");
    expect(w).not.toContain("first-time mark");
  });
});

/**
 * A stand-in for the supabase client that reproduces PostgREST's silent
 * 1000-row cap: it serves whatever `.range()` asks for out of a fixed row
 * set and never reports an error for a short page. An unpaged reader looks
 * correct against a small fixture and only fails in production, so the
 * fixture here is deliberately larger than the cap.
 */
function fakeSupabase(rows: Record<string, unknown>[], pageCap = 1000) {
  const requests: { from: number; to: number }[] = [];
  const client = {
    from() {
      const q = {
        select: () => q,
        in: () => q,
        order: () => q,
        range: (from: number, to: number) => {
          requests.push({ from, to });
          const span = Math.min(to - from + 1, pageCap);
          return Promise.resolve({ data: rows.slice(from, from + span), error: null });
        },
      };
      return q;
    },
  };
  return { client, requests };
}

describe("readPriorMarks paging", () => {
  const ITEMS = 41;
  const STUDENTS = 50;

  // 41 items x 50 students = 2050 rows, the real shape of Formative
  // Assessment 1. A single request returns 1000 of them with error null, so
  // the ~1050 missing priors would be logged as first-time marks.
  const rows = Array.from({ length: ITEMS * STUDENTS }, (_, n) => ({
    test_item_id: `item-${n % ITEMS}`,
    student_id: null,
    invited_student_id: `stu-${Math.floor(n / ITEMS)}`,
    marks_awarded: 1,
  }));

  const targets = rows.map((r) => ({
    testItemId: r.test_item_id as string,
    subject: { kind: "invited" as const, id: r.invited_student_id as string },
  }));

  it("reads every prior mark past the 1000-row cap", async () => {
    const { client, requests } = fakeSupabase(rows);
    const { prior, failed } = await readPriorMarks(
      client as unknown as Parameters<typeof readPriorMarks>[0],
      targets
    );

    expect(failed).toBe(false);
    expect(prior.size).toBe(ITEMS * STUDENTS);
    // More than one request: a single unpaged read is the bug.
    expect(requests.length).toBeGreaterThan(1);
  });

  it("reports a failed lookup rather than reading it as no prior mark", async () => {
    const throwing = {
      from() {
        const q = {
          select: () => q,
          in: () => q,
          order: () => q,
          range: () => Promise.resolve({ data: null, error: { message: "boom" } }),
        };
        return q;
      },
    };
    const { prior, failed } = await readPriorMarks(
      throwing as unknown as Parameters<typeof readPriorMarks>[0],
      targets.slice(0, 3)
    );
    expect(failed).toBe(true);
    expect(prior.size).toBe(0);
  });

  it("makes no request at all for an empty target list", async () => {
    const { client, requests } = fakeSupabase(rows);
    const { prior, failed } = await readPriorMarks(
      client as unknown as Parameters<typeof readPriorMarks>[0],
      []
    );
    expect(requests).toHaveLength(0);
    expect(prior.size).toBe(0);
    expect(failed).toBe(false);
  });
});
