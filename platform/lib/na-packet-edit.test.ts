import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluatePacketLock, buildPacketContentUpdate } from "./na-packet-edit";
import type { AssignmentDraft } from "./assignments";

describe("evaluatePacketLock", () => {
  it("leaves a packet that was never printed editable", () => {
    expect(evaluatePacketLock({ packetVersions: 0, anchors: 0, scans: 0 })).toEqual({
      locked: false,
    });
  });

  it("locks on a print master even before anything is scanned", () => {
    // The anchors are already cut to that PDF's geometry by this point, so
    // waiting for scans would be locking the door after the fact.
    const lock = evaluatePacketLock({ packetVersions: 1, anchors: 32, scans: 0 });
    expect(lock.locked).toBe(true);
  });

  it("names what exists so the teacher can see why", () => {
    // A.1's real numbers.
    const lock = evaluatePacketLock({ packetVersions: 1, anchors: 40, scans: 44 });
    if (!lock.locked) throw new Error("expected locked");
    expect(lock.reason).toContain("1 print master");
    expect(lock.reason).toContain("40 answer-box anchors");
    expect(lock.reason).toContain("44 scanned student copies");
  });

  it("omits counts that are zero rather than saying '0 scanned'", () => {
    const lock = evaluatePacketLock({ packetVersions: 2, anchors: 0, scans: 0 });
    if (!lock.locked) throw new Error("expected locked");
    // Only the enumerated list is conditional; the sentence after it always
    // explains what anchors are, so assert on the counts themselves.
    expect(lock.reason).toContain("2 print masters");
    expect(lock.reason).not.toContain("0 answer-box anchors");
    expect(lock.reason).not.toContain("0 scanned");
  });

  it("tells the teacher formatting still saves and where to correct a key", () => {
    const lock = evaluatePacketLock({ packetVersions: 1, anchors: 1, scans: 1 });
    if (!lock.locked) throw new Error("expected locked");
    expect(lock.reason).toContain("Formatting changes still save");
    expect(lock.reason).toContain("rubric");
  });
});

describe("buildPacketContentUpdate", () => {
  const draft = (over: Partial<AssignmentDraft> = {}): AssignmentDraft => ({
    title: "Sixty Times a Person",
    subtitle: "Grade 9 Extended",
    instructions: [],
    sections: [{ heading: "Part 1", questions: [{ prompt: "q", marks: 2 }] }],
    ...over,
  });

  it("writes the content columns from the draft", () => {
    const out = buildPacketContentUpdate(
      draft({ syllabusTopics: "Unit 1 A.1", prerequisites: "Times tables", materials: "Ruler", atl: "Transfer" })
    );
    expect(out.title).toBe("Sixty Times a Person");
    expect(out.subtitle).toBe("Grade 9 Extended");
    expect(out.syllabus_topics).toEqual(["Unit 1 A.1"]);
    expect(out.prerequisites).toEqual(["Times tables"]);
    expect(out.materials).toBe("Ruler");
    expect(out.atl_statement).toBe("Transfer");
  });

  it("stores sections as parts and the whole draft as draft_content", () => {
    const d = draft();
    const out = buildPacketContentUpdate(d);
    expect(out.parts).toBe(d.sections);
    expect(out.draft_content).toBe(d);
  });

  it("empties the array columns rather than nulling them when unset", () => {
    // These columns are text[]/jsonb NOT NULL with an empty default; writing
    // null would violate that where an empty array is what 'none' means.
    const out = buildPacketContentUpdate(draft());
    expect(out.syllabus_topics).toEqual([]);
    expect(out.prerequisites).toEqual([]);
    expect(out.vocabulary).toEqual([]);
    expect(out.tok_provocations).toEqual([]);
    expect(out.materials).toBeNull();
    expect(out.atl_statement).toBeNull();
  });

  it("only sets course when the draft carries one", () => {
    expect(buildPacketContentUpdate(draft())).not.toHaveProperty("course");
    expect(buildPacketContentUpdate(draft({ course: "Grade 9 Mathematics" })).course).toBe(
      "Grade 9 Mathematics"
    );
  });

  it("never writes identity or placement columns", () => {
    // section_code is half the (course_id, section_code) key the sandbox
    // upsert conflicts on; writing it from the editor could repoint a packet
    // at another one's slot. The rest are equally not the editor's to set.
    const out = buildPacketContentUpdate(draft({ course: "x" }));
    for (const forbidden of [
      "slug",
      "course_id",
      "owner_id",
      "grade_level",
      "section_code",
      "is_published",
      "continuity_digest",
      "id",
    ]) {
      expect(out, `must not write ${forbidden}`).not.toHaveProperty(forbidden);
    }
  });

  it("stamps updated_at", () => {
    const out = buildPacketContentUpdate(draft());
    expect(Number.isNaN(Date.parse(out.updated_at as string))).toBe(false);
  });
});

describe("column parity with the sandbox save path", () => {
  it("writes the same content columns app/api/nuanced-analyses/route.ts does", () => {
    // Both paths write a packet from the same AssignmentDraft. If one grows a
    // column the other does not, a packet saved from the sandbox and the same
    // packet saved from the editor stop being the same row -- the exact class
    // of drift this whole change is removing. Read as source text because the
    // route is a Next handler, which AGENTS.md says not to unit test.
    const routeSrc = readFileSync(
      join(process.cwd(), "app", "api", "nuanced-analyses", "route.ts"),
      "utf8"
    );
    const ours = Object.keys(buildPacketContentUpdate({
      title: "t",
      subtitle: "s",
      instructions: [],
      sections: [{ heading: "h", questions: [] }],
      course: "c",
    }));

    for (const col of ours) {
      if (col === "updated_at") continue; // the route relies on the column default
      expect(routeSrc.includes(`${col}:`), `sandbox save path is missing ${col}`).toBe(true);
    }
  });
});
