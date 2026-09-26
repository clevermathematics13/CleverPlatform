import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  generationLessonsBlock,
  loadGenerationFamilyForCourse,
  withGenerationLessons,
} from "./generation-lessons";
import {
  GENERATION_FAMILY_LABELS,
  creatorFamilyForGradeLevel,
  generationFamilyFor,
  type GenerationFamily,
} from "./generation-family";
import { buildActivityGeneratorSystemPrompt } from "./assignments";
import { buildFormativeAssessmentSystemPrompt } from "./formative-assessment-prompt";
import { buildAuthoringSystemPrompt } from "./practice-question-generator";

const FAMILIES: GenerationFamily[] = ["g9_extended", "g9_standard", "ibdp_aa_hl"];
const HEADINGS: Record<GenerationFamily, string> = {
  g9_extended: "LESSONS FROM MARKING -- Grade 9 Extended",
  g9_standard: "LESSONS FROM MARKING -- Grade 9 Standard",
  ibdp_aa_hl: "LESSONS FROM MARKING -- IBDP Mathematics: Analysis and Approaches HL",
};

describe("the lessons files", () => {
  it.each(FAMILIES)("%s loads without its maintainer notes, in ASCII", (family) => {
    const block = generationLessonsBlock(family);
    expect(block.startsWith(HEADINGS[family])).toBe(true);
    expect(block).not.toContain("<!--");
    expect(block).not.toContain("notes for whoever edits this file");
    expect(block).not.toMatch(/\n{3,}/);
    expect(/^[\x00-\x7f]*$/.test(block)).toBe(true);
  });

  // The families are marked differently, and each file speaks its own
  // family's language.
  it("keeps Grade 9 Standard in descriptor language, with no mark codes", () => {
    // It names the codes once, to rule them out; nowhere else may use one.
    const block = generationLessonsBlock("g9_standard");
    expect(block).toContain("never as M1, A1 or R1");
    expect(block.replace("never as M1, A1 or R1", "")).not.toMatch(/\b[MAR][01]\b/);
    expect(generationLessonsBlock("g9_standard")).toContain("Exceeding, Meeting, Approaching, Beginning");
  });

  it("writes Grade 9 Extended's scheme lessons in M/A/R codes and AAHL's in IB conventions", () => {
    expect(generationLessonsBlock("g9_extended")).toContain("M1M0A0");
    expect(generationLessonsBlock("ibdp_aa_hl")).toContain("AG marks");
    expect(generationLessonsBlock("ibdp_aa_hl")).not.toContain("Grade 9");
  });

  it("carries the lessons from the review into every family", () => {
    for (const family of FAMILIES) {
      const block = generationLessonsBlock(family);
      expect(block).toMatch(/cross out work rather than/);
      expect(block).toMatch(/its own labelled space/);
      expect(block).toMatch(/b \(6\)/);
      expect(block).toMatch(/numerical check built on a wrong model/);
    }
  });

  it("appends a family's lessons after the prompt", () => {
    expect(withGenerationLessons("PROMPT", "ibdp_aa_hl")).toBe(`PROMPT\n\n${generationLessonsBlock("ibdp_aa_hl")}`);
  });
});

describe("the generators", () => {
  const extended = generationLessonsBlock("g9_extended");

  it("NA generator: unchanged without lessons, and lessons sit before the continuity block", () => {
    expect(buildActivityGeneratorSystemPrompt("Grade 9", "CONTINUITY")).toBe(
      buildActivityGeneratorSystemPrompt("Grade 9", "CONTINUITY", undefined)
    );
    const withLessons = buildActivityGeneratorSystemPrompt("Grade 9", "CONTINUITY", extended);
    expect(withLessons).toContain(extended);
    expect(withLessons.indexOf(extended)).toBeLessThan(withLessons.indexOf("CONTINUITY"));
    expect(withLessons.endsWith("CONTINUITY")).toBe(true);
    expect(buildActivityGeneratorSystemPrompt("Grade 9", undefined, extended).endsWith(extended)).toBe(true);
  });

  it("Assessment Creator: unchanged without lessons, and lessons come last", () => {
    for (const kind of ["formative", "summative"] as const) {
      expect(buildFormativeAssessmentSystemPrompt(kind, undefined)).toBe(buildFormativeAssessmentSystemPrompt(kind));
      expect(buildFormativeAssessmentSystemPrompt(kind, "")).toBe(buildFormativeAssessmentSystemPrompt(kind));
      const withLessons = buildFormativeAssessmentSystemPrompt(kind, extended);
      expect(withLessons).toBe(`${buildFormativeAssessmentSystemPrompt(kind)}\n\n${extended}`);
    }
  });

  it("practice questions get AAHL's lessons and no other family's", () => {
    const prompt = buildAuthoringSystemPrompt();
    expect(prompt.endsWith(generationLessonsBlock("ibdp_aa_hl"))).toBe(true);
    expect(prompt).not.toContain(HEADINGS.g9_extended);
    expect(prompt).not.toContain(HEADINGS.g9_standard);
  });
});

describe("which family a course writes for", () => {
  it("reads the Grade 9 tracks by name and a DP course by its code", () => {
    expect(generationFamilyFor({ courseName: "Grade 9 Extended" })).toBe("g9_extended");
    expect(generationFamilyFor({ courseName: "Grade 9 Standard" })).toBe("g9_standard");
    expect(generationFamilyFor({ courseName: "27AH" })).toBe("ibdp_aa_hl");
    expect(generationFamilyFor({ courseName: "29ah" })).toBe("ibdp_aa_hl");
  });

  it("gives other DP courses, and anything unknown, no lessons", () => {
    expect(generationFamilyFor({ courseName: "30AS" })).toBeNull();
    expect(generationFamilyFor({ courseName: "32IH" })).toBeNull();
    expect(generationFamilyFor({ courseName: "Grade 10" })).toBeNull();
    expect(generationFamilyFor({ courseName: "" })).toBeNull();
  });

  it("gives a roster class its track's family, and none when its tracks disagree", () => {
    expect(generationFamilyFor({ courseName: "9A", parentTrackNames: ["Grade 9 Extended"] })).toBe("g9_extended");
    expect(generationFamilyFor({ courseName: "9D", parentTrackNames: ["Grade 9 Standard"] })).toBe("g9_standard");
    expect(generationFamilyFor({ courseName: "9A", parentTrackNames: [] })).toBeNull();
    expect(
      generationFamilyFor({ courseName: "9X", parentTrackNames: ["Grade 9 Extended", "Grade 9 Standard"] })
    ).toBeNull();
  });

  it("falls back on the Creator's grade level when no course is chosen", () => {
    expect(creatorFamilyForGradeLevel("Grade 9")).toBe("g9_extended");
    expect(creatorFamilyForGradeLevel("grade 9 extended")).toBe("g9_extended");
    expect(creatorFamilyForGradeLevel("Grade 11")).toBe("ibdp_aa_hl");
    expect(creatorFamilyForGradeLevel("Grade 12")).toBe("ibdp_aa_hl");
    expect(creatorFamilyForGradeLevel("Grade 10")).toBeNull();
    expect(creatorFamilyForGradeLevel("")).toBeNull();
  });

  it("labels every family", () => {
    for (const family of FAMILIES) expect(GENERATION_FAMILY_LABELS[family]).toBeTruthy();
  });
});

describe("loadGenerationFamilyForCourse", () => {
  const courses = [
    { id: "track-ext", name: "Grade 9 Extended" },
    { id: "class-9a", name: "9A" },
    { id: "dp", name: "27AH" },
  ];
  const trackCourses = [{ track_course_id: "track-ext", member_course_id: "class-9a" }];

  function fake(failOn?: string) {
    const tables: Record<string, Record<string, unknown>[]> = { courses, track_courses: trackCourses };
    return {
      from(table: string) {
        const filters: [string, "eq" | "in", unknown][] = [];
        const run = () => {
          if (failOn === table) return { data: null, error: { message: `${table} unavailable` } };
          const rows = (tables[table] ?? []).filter((r) =>
            filters.every(([c, op, v]) => (op === "eq" ? r[c] === v : (v as unknown[]).includes(r[c])))
          );
          return { data: rows, error: null };
        };
        const q = {
          select: () => q,
          eq: (c: string, v: unknown) => (filters.push([c, "eq", v]), q),
          in: (c: string, v: unknown[]) => (filters.push([c, "in", v]), q),
          maybeSingle: () => {
            const { data, error } = run();
            return Promise.resolve({ data: data?.[0] ?? null, error });
          },
          then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve(run()).then(resolve, reject),
        };
        return q;
      },
    } as unknown as SupabaseClient;
  }

  it("reads a track, a class through its track, and a DP course", async () => {
    expect(await loadGenerationFamilyForCourse(fake(), "track-ext")).toBe("g9_extended");
    expect(await loadGenerationFamilyForCourse(fake(), "class-9a")).toBe("g9_extended");
    expect(await loadGenerationFamilyForCourse(fake(), "dp")).toBe("ibdp_aa_hl");
  });

  it("is null for a course it cannot find, and throws when a read fails", async () => {
    expect(await loadGenerationFamilyForCourse(fake(), "missing")).toBeNull();
    await expect(loadGenerationFamilyForCourse(fake("track_courses"), "class-9a")).rejects.toThrow(/unavailable/);
  });
});

// The loader reads files, so it must never reach the browser. The prompt
// builders that run there take the lessons as a string instead.
describe("the loader stays on the server", () => {
  const ROOT = path.resolve(__dirname, "..");

  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...sourceFiles(rel));
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(rel);
    }
    return out;
  }

  it("is imported by no client component", () => {
    const offenders = [...sourceFiles("app"), ...sourceFiles("components")].filter((file) => {
      const source = fs.readFileSync(path.join(ROOT, file), "utf8");
      return /^\s*["']use client["']/m.test(source) && /generation-lessons["']/.test(source);
    });
    expect(offenders).toEqual([]);
  });

  it("is not imported by the prompt builders that run in the browser", () => {
    for (const file of ["lib/assignments.ts", "lib/formative-assessment-prompt.ts", "lib/generation-family.ts"]) {
      expect(fs.readFileSync(path.join(ROOT, file), "utf8")).not.toMatch(/generation-lessons["']/);
    }
  });
});
