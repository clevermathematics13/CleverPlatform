/**
 * na-continuity-context.test.ts
 * -----------------------------------------------------------------------------
 * What buildContinuityContext() puts in front of the generator, and -- the
 * reason this file exists -- what it leaves out.
 *
 * The block's whole job is prohibition: it tells the model which TOK
 * provocations, mathematicians, misconceptions, section headings and worked
 * expressions are already spent, and those lines sit LAST in the prompt
 * because that is where a model weights them most heavily.
 *
 * Which makes one case sharp. Regenerating a section that already has a
 * digest used to include that section's OWN entry in the spent lists, so
 * asking for a better B.4 handed the model a list of everything the current
 * B.4 does and told it not to do any of it. A regeneration is asked for
 * because the previous attempt should be improved on, not avoided.
 * -----------------------------------------------------------------------------
 */

import { describe, it, expect } from "vitest";
import { buildContinuityContext, type ContinuityRecord, type PacketDigest } from "./na-continuity";

function digest(section: string, overrides: Partial<PacketDigest> = {}): PacketDigest {
  return {
    slug: section.toLowerCase().replace(".", "-"),
    title: `Packet ${section}`,
    section,
    whereItLeftOff: `${section} ended here.`,
    vocabularyIntroduced: [`vocab-${section}`],
    notationConventions: [`notation-${section}`],
    tokProvocationsUsed: [`tok-${section}`],
    internationalMindednessUsed: [`mathematician-${section}`],
    misconceptionsPlanted: [`misconception-${section}`],
    contentSpent: [`content-${section}`],
    ...overrides,
  } as PacketDigest;
}

const record: ContinuityRecord = {
  courseId: "course-1",
  unitSequence: [
    { section: "A.1", title: "First", status: "done" },
    { section: "B.4", title: "Fourth", status: "done" },
    { section: "B.5", title: "Fifth", status: "next" },
  ],
  packets: [digest("A.1"), digest("B.4")],
} as ContinuityRecord;

describe("buildContinuityContext", () => {
  it("sends every prior packet when the target is a new section", () => {
    const ctx = buildContinuityContext(record, "B.5");
    expect(ctx).toContain("A.1");
    expect(ctx).toContain("tok-A.1");
    expect(ctx).toContain("tok-B.4");
    expect(ctx).toContain("content-B.4");
  });

  it("drops the target section's own digest when it is being regenerated", () => {
    const ctx = buildContinuityContext(record, "B.4");
    // What came before B.4 is still prior teaching, and still binding.
    expect(ctx).toContain("tok-A.1");
    expect(ctx).toContain("misconception-A.1");
    // B.4's own is not: it describes the packet about to be replaced, and
    // listing it as spent forbids the new packet from covering its own topic.
    expect(ctx).not.toContain("tok-B.4");
    expect(ctx).not.toContain("misconception-B.4");
    expect(ctx).not.toContain("content-B.4");
    expect(ctx).not.toContain("vocab-B.4");
    expect(ctx).not.toContain("B.4 ended here.");
  });

  it("still sends the scope and sequence, so the target knows what follows", () => {
    // The spine is what stops a regenerated B.4 pre-empting B.5, and it is
    // separate from the digests -- so it must survive the filter.
    const ctx = buildContinuityContext(record, "B.4");
    expect(ctx).toContain("[next] B.5");
    expect(ctx).toContain("[done] A.1");
  });

  it("returns nothing at all when there is no prior teaching to describe", () => {
    const solo: ContinuityRecord = { courseId: "c", unitSequence: [], packets: [digest("A.1")] } as ContinuityRecord;
    expect(buildContinuityContext(solo, "A.1")).toBe("");
  });
});
