import { describe, expect, it } from "vitest";
import {
  filterStudentGroups,
  groupStudentsByClass,
  matchesStudentQuery,
} from "./student-picker";

describe("matchesStudentQuery", () => {
  it("matches the start of the first name", () => {
    expect(matchesStudentQuery("Freya Delisle", "fr")).toBe(true);
    expect(matchesStudentQuery("Freya Delisle", "Frey")).toBe(true);
  });

  it("matches the start of the last name", () => {
    expect(matchesStudentQuery("Freya Delisle", "del")).toBe(true);
    expect(matchesStudentQuery("Ines Palomino", "PALO")).toBe(true);
  });

  it("does not match the middle of a word", () => {
    expect(matchesStudentQuery("Freya Delisle", "reya")).toBe(false);
    expect(matchesStudentQuery("Freya Delisle", "isle")).toBe(false);
  });

  it("requires every typed word to start some name word", () => {
    expect(matchesStudentQuery("Freya Delisle", "fr de")).toBe(true);
    expect(matchesStudentQuery("Freya Delisle", "de fr")).toBe(true);
    expect(matchesStudentQuery("Freya Delisle", "fr pa")).toBe(false);
  });

  it("ignores accents, case and punctuation", () => {
    expect(matchesStudentQuery("José Núñez-Ortiz", "jose")).toBe(true);
    expect(matchesStudentQuery("José Núñez-Ortiz", "nun")).toBe(true);
    expect(matchesStudentQuery("José Núñez-Ortiz", "ort")).toBe(true);
    expect(matchesStudentQuery("Mary-Anne O'Brien", "obr")).toBe(true);
  });

  it("matches a nickname shown in parentheses", () => {
    expect(matchesStudentQuery("Alexander Smith (Sasha)", "sas")).toBe(true);
  });

  it("matches everyone on an empty or whitespace query", () => {
    expect(matchesStudentQuery("Freya Delisle", "")).toBe(true);
    expect(matchesStudentQuery("Freya Delisle", "   ")).toBe(true);
  });
});

const roster = [
  { profile_id: "g2", display_name: "Zara Gill", class_name: "9G" },
  { profile_id: "g1", display_name: "Amir Gill", class_name: "9G" },
  { profile_id: "a1", display_name: "Freya Delisle", class_name: "9A" },
  { profile_id: "c1", display_name: "Davi Verma", class_name: "9C" },
  { profile_id: "x1", display_name: "Unknown Student", class_name: null },
  { profile_id: "a2", display_name: "Fred Adams", class_name: "9A" },
];

describe("groupStudentsByClass", () => {
  it("keeps classes in first-seen order, sorts names within each, and trails unknowns as Other", () => {
    const groups = groupStudentsByClass(roster);
    expect(groups.map((g) => g.label)).toEqual(["9G", "9A", "9C", "Other"]);
    expect(groups[0].students.map((s) => s.display_name)).toEqual([
      "Amir Gill",
      "Zara Gill",
    ]);
    expect(groups[1].students.map((s) => s.display_name)).toEqual([
      "Fred Adams",
      "Freya Delisle",
    ]);
    expect(groups[3].students.map((s) => s.profile_id)).toEqual(["x1"]);
  });

  it("omits the Other group when every student has a class", () => {
    const groups = groupStudentsByClass(roster.filter((s) => s.class_name));
    expect(groups.map((g) => g.label)).toEqual(["9G", "9A", "9C"]);
  });
});

describe("filterStudentGroups", () => {
  it("drops groups with no matching student", () => {
    const groups = filterStudentGroups(roster, "fr");
    expect(groups.map((g) => g.label)).toEqual(["9A"]);
    expect(groups[0].students.map((s) => s.display_name)).toEqual([
      "Fred Adams",
      "Freya Delisle",
    ]);
  });

  it("narrows with a second word", () => {
    const groups = filterStudentGroups(roster, "fr de");
    expect(groups).toHaveLength(1);
    expect(groups[0].students.map((s) => s.profile_id)).toEqual(["a1"]);
  });

  it("returns everything grouped on an empty query", () => {
    expect(filterStudentGroups(roster, "")).toEqual(
      groupStudentsByClass(roster),
    );
  });
});
