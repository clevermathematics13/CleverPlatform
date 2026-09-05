import { describe, expect, it } from "vitest";
import { trackFamilyCourseIds } from "./track-courses";

describe("trackFamilyCourseIds", () => {
  it("returns only the course itself when it is in no track", () => {
    expect(trackFamilyCourseIds("solo", { members: [], parentTracks: [], siblings: [] })).toEqual(["solo"]);
  });

  it("pools a track with its member classes", () => {
    expect(trackFamilyCourseIds("ext", { members: ["9A", "9C", "9G"], parentTracks: [], siblings: [] })).toEqual([
      "ext",
      "9A",
      "9C",
      "9G",
    ]);
  });

  it("pools a class with its parent track and sibling classes, itself first and once", () => {
    expect(
      trackFamilyCourseIds("9A", { members: [], parentTracks: ["ext"], siblings: ["9A", "9C", "9G"] })
    ).toEqual(["9A", "ext", "9C", "9G"]);
  });
});
