import { describe, expect, it } from "vitest";
import { diffOverrides } from "./self-assessment-override-diff";

/**
 * The three-state control behind per-class release, and the writes it implies.
 *
 * The case that makes this worth pinning: a teacher who releases 9C and then
 * changes their mind and sets it back to "follow the test". That is a DELETE,
 * not an update -- there is no row value that means "follow the test". Emit an
 * upsert there and the class stays released while the form shows otherwise,
 * which is exactly the kind of wrong nobody notices until a student has seen
 * marks they should not have.
 */
describe("diffOverrides", () => {
  it("writes nothing when nothing changed", () => {
    expect(diffOverrides({ "9c": false }, { "9c": false })).toEqual({ upserts: [], deletes: [] });
  });

  it("upserts a class being released for the first time", () => {
    expect(diffOverrides({}, { "9c": false })).toEqual({
      upserts: [{ courseId: "9c", requireSelfAssessment: false }],
      deletes: [],
    });
  });

  it("deletes the row when a class goes back to following the test", () => {
    expect(diffOverrides({ "9c": false }, { "9c": null })).toEqual({ upserts: [], deletes: ["9c"] });
  });

  it("upserts when a class flips from released to required", () => {
    expect(diffOverrides({ "9c": false }, { "9c": true })).toEqual({
      upserts: [{ courseId: "9c", requireSelfAssessment: true }],
      deletes: [],
    });
  });

  // "Follow the test" and "no row" are the same state; asking for it when it
  // already holds must not emit a delete for a row that was never there.
  it("treats an absent row and an explicit null as the same state", () => {
    expect(diffOverrides({}, { "9c": null })).toEqual({ upserts: [], deletes: [] });
  });

  it("leaves classes the form did not list completely alone", () => {
    expect(diffOverrides({ "9a": true, "9c": false }, { "9c": false })).toEqual({
      upserts: [],
      deletes: [],
    });
  });

  it("handles a mixed save across several classes", () => {
    const writes = diffOverrides(
      { "9a": true, "9c": false, "9d": false },
      { "9a": null, "9c": false, "9d": true, "9g": false }
    );
    expect(writes.deletes).toEqual(["9a"]);
    expect(writes.upserts).toEqual([
      { courseId: "9d", requireSelfAssessment: true },
      { courseId: "9g", requireSelfAssessment: false },
    ]);
  });
});
