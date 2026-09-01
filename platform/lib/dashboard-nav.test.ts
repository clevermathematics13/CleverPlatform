import { describe, it, expect } from "vitest";
import { getNavigation, getSettingsNavigation, deriveDashboardView } from "./dashboard-nav";

describe("getNavigation", () => {
  it("gives a Grade 9 student exactly one item: their feedback", () => {
    const nav = getNavigation("student", true);
    expect(nav).toHaveLength(1);
    expect(nav[0].href).toBe("/dashboard/na-feedback");
    expect(nav[0].label).toBe("Feedback");
  });

  it("leaves a non-Grade-9 student on the Dashboard", () => {
    const nav = getNavigation("student", false);
    expect(nav.map((n) => n.href)).toEqual(["/dashboard"]);
  });

  it("does not leak teacher destinations into a student menu", () => {
    for (const isGrade9 of [true, false]) {
      const hrefs = getNavigation("student", isGrade9).map((n) => n.href);
      for (const teacherOnly of [
        "/dashboard/questions",
        "/dashboard/tests",
        "/dashboard/gradebook",
        "/dashboard/seating",
        "/dashboard/classroom",
      ]) {
        expect(hrefs).not.toContain(teacherOnly);
      }
    }
  });

  it("keeps the teacher menu intact regardless of the Grade 9 flag", () => {
    const nav = getNavigation("teacher", true).map((n) => n.href);
    expect(nav).toContain("/dashboard");
    expect(nav).toContain("/dashboard/tests");
    expect(nav).toContain("/dashboard/gradebook");
  });

  it("gives a student no settings menu", () => {
    expect(getSettingsNavigation("student")).toEqual([]);
    expect(getSettingsNavigation("teacher").length).toBeGreaterThan(0);
  });
});

describe("deriveDashboardView", () => {
  const teacherNavigation = getNavigation("teacher");
  const teacherSettingsNavigation = getSettingsNavigation("teacher");
  const options = [
    { invitedStudentId: "davi", name: "Davi Verma", courseName: "9A", hasAccount: false },
    { invitedStudentId: "dp", name: "A DP Student", courseName: "27AH", hasAccount: true },
  ];
  const derive = (viewAsId: string | null) =>
    deriveDashboardView({ viewAsId, options, teacherNavigation, teacherSettingsNavigation });

  it("shows the teacher their own menu when no student is selected", () => {
    const r = derive(null);
    expect(r.viewing).toBeNull();
    expect(r.navigation).toEqual(teacherNavigation);
    expect(r.settingsNavigation).toEqual(teacherSettingsNavigation);
  });

  it("swaps to the Grade 9 student menu when viewing a Grade 9 student", () => {
    const r = derive("davi");
    expect(r.viewing?.name).toBe("Davi Verma");
    expect(r.navigation.map((n) => n.href)).toEqual(["/dashboard/na-feedback"]);
    expect(r.settingsNavigation).toEqual([]);
  });

  it("gives a DP student the ordinary student menu, not the Grade 9 one", () => {
    const r = derive("dp");
    expect(r.navigation.map((n) => n.href)).toEqual(["/dashboard"]);
  });

  it("falls back to the teacher view for an unrecognised id", () => {
    // a stale bookmark must not strand the teacher in a nameless shell
    const r = derive("no-such-student");
    expect(r.viewing).toBeNull();
    expect(r.navigation).toEqual(teacherNavigation);
  });
});
