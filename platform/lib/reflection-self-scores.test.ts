import { describe, it, expect } from "vitest";
import {
  buildSelfScoreRows,
  selfScoreSubmitMessage,
  SELF_SCORE_CONFLICT_TARGET,
} from "./reflection-self-scores";

const AT = "2026-09-07T15:15:53.404Z";
const STUDENT = "c16afeae-c628-4502-9f9d-bb241b252ad5";

describe("buildSelfScoreRows", () => {
  // The bug this whole module exists for. NativeForm tells the student to
  // leave a box blank if they made no attempt and sends that box as null;
  // student_self_scores.self_marks was NOT NULL, so the submit died on the
  // first blank. Coercing null to 0 here would "fix" the error by filing a
  // claim the student never made -- that they sat the question and got
  // nothing -- so null has to survive all the way to the row.
  it("keeps an unattempted question null rather than scoring it 0", () => {
    const rows = buildSelfScoreRows(
      [
        { test_item_id: "item-1", self_marks: 3 },
        { test_item_id: "item-2", self_marks: null },
        { test_item_id: "item-3", self_marks: 0 },
      ],
      STUDENT,
      AT
    );

    expect(rows.map((r) => r.self_marks)).toEqual([3, null, 0]);
  });

  it("builds one row per score so the caller can send a single upsert", () => {
    const rows = buildSelfScoreRows(
      [
        { test_item_id: "item-1", self_marks: 1 },
        { test_item_id: "item-2", self_marks: null },
      ],
      STUDENT,
      AT
    );

    expect(rows).toEqual([
      { test_item_id: "item-1", student_id: STUDENT, self_marks: 1, submitted_at: AT },
      { test_item_id: "item-2", student_id: STUDENT, self_marks: null, submitted_at: AT },
    ]);
  });

  it("stamps every row with the same submitted_at", () => {
    const rows = buildSelfScoreRows(
      [
        { test_item_id: "item-1", self_marks: 1 },
        { test_item_id: "item-2", self_marks: 2 },
      ],
      STUDENT,
      AT
    );

    expect(new Set(rows.map((r) => r.submitted_at))).toEqual(new Set([AT]));
  });

  // A repeated test_item_id in one batched upsert is Postgres error 21000
  // ("ON CONFLICT DO UPDATE command cannot affect row a second time"), which
  // would take the whole submit down. The old row-at-a-time loop simply
  // overwrote; keep that.
  it("collapses a repeated question to its last value", () => {
    const rows = buildSelfScoreRows(
      [
        { test_item_id: "item-1", self_marks: 1 },
        { test_item_id: "item-1", self_marks: 4 },
      ],
      STUDENT,
      AT
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].self_marks).toBe(4);
  });

  it("returns nothing for an empty submission", () => {
    expect(buildSelfScoreRows([], STUDENT, AT)).toEqual([]);
  });

  it("upserts against the table's own unique constraint", () => {
    expect(SELF_SCORE_CONFLICT_TARGET).toBe("test_item_id,student_id");
  });
});

describe("selfScoreSubmitMessage", () => {
  it("leads with the fact that nothing was saved, and keeps the detail", () => {
    const message = selfScoreSubmitMessage(new Error("permission denied"));
    expect(message).toContain("not saved");
    expect(message).toContain("permission denied");
  });

  it("handles a thrown value that is not an Error", () => {
    expect(selfScoreSubmitMessage("network down")).toContain("network down");
  });
});
