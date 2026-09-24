import { describe, it, expect } from "vitest";
import { getNavigation, getSettingsNavigation, deriveDashboardView } from "./dashboard-nav";

describe("getNavigation", () => {
  it("gives a Grade 9 student both feedback destinations: NA packets and Tests-based reflection", () => {
    const nav = getNavigation("student", true);
    expect(nav.map((n) => n.href)).toEqual([
      "/dashboard/lessons",
      "/dashboard/na-feedback",
      "/dashboard/reflection",
    ]);
    expect(nav.find((n) => n.href === "/dashboard/na-feedback")?.label).toBe("Feedback");
  });

  // Lessons is the one entry a Grade 9 student opens BEFORE doing the work.
  // Leading with it is the whole reason it was added ahead of the two
  // feedback destinations rather than after them.
  it("puts Lessons first in the Grade 9 menu, ahead of the feedback destinations", () => {
    expect(getNavigation("student", true)[0]).toMatchObject({
      href: "/dashboard/lessons",
      label: "Lessons",
    });
  });

  it("gives a non-Grade-9 student the Dashboard, Practice and the Live Game", () => {
    const nav = getNavigation("student", false);
    expect(nav.map((n) => n.href)).toEqual([
      "/dashboard",
      "/dashboard/lessons",
      "/dashboard/practice",
      "/dashboard/games",
    ]);
  });

  it("keeps Practice out of the Grade 9 menu", () => {
    expect(getNavigation("student", true).map((n) => n.href)).not.toContain("/dashboard/practice");
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
        "/dashboard/remark-requests",
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
    expect(r.navigation.map((n) => n.href)).toEqual([
      "/dashboard/lessons",
      "/dashboard/na-feedback",
      "/dashboard/reflection",
    ]);
    expect(r.settingsNavigation).toEqual([]);
  });

  it("gives a DP student the ordinary student menu, not the Grade 9 one", () => {
    const r = derive("dp");
    expect(r.navigation.map((n) => n.href)).toEqual([
      "/dashboard",
      "/dashboard/lessons",
      "/dashboard/practice",
      "/dashboard/games",
    ]);
  });

  it("falls back to the teacher view for an unrecognised id", () => {
    // a stale bookmark must not strand the teacher in a nameless shell
    const r = derive("no-such-student");
    expect(r.viewing).toBeNull();
    expect(r.navigation).toEqual(teacherNavigation);
  });
});

describe("the teacher's route into the student practice page", () => {
  const teacherNav = getNavigation("teacher");

  it("gives the teacher a way in, which is the whole point of the entry", () => {
    expect(teacherNav.map((n) => n.href)).toContain("/dashboard/practice");
  });

  // Two adjacent items called Practice and Practice Sets, both with a ruler,
  // is a coin flip every time. The label and the icon both have to differ.
  it("cannot be mistaken for the set builder", () => {
    const practice = teacherNav.find((n) => n.href === "/dashboard/practice");
    const builder = teacherNav.find((n) => n.href === "/dashboard/practice-sets");
    expect(practice).toBeDefined();
    expect(builder).toBeDefined();
    expect(practice!.label).not.toBe(builder!.label);
    expect(practice!.icon).not.toBe(builder!.icon);
    expect(practice!.label).toMatch(/student/i);
  });

  it("sits next to the builder, since one leads to the other", () => {
    const hrefs = teacherNav.map((n) => n.href);
    expect(hrefs.indexOf("/dashboard/practice")).toBe(
      hrefs.indexOf("/dashboard/practice-sets") + 1
    );
  });

  // The student's own menu keeps the plain label; this rename is the
  // teacher's entry only.
  it("leaves the student's own Practice entry alone", () => {
    const studentPractice = getNavigation("student", false).find(
      (n) => n.href === "/dashboard/practice"
    );
    expect(studentPractice?.label).toBe("Practice");
  });
});

describe("the Lessons section", () => {
  // A mini lesson is shared class content with no per-student data on it, so
  // unlike every other student destination it has to appear for the teacher
  // AND the class, and the teacher's entry is not a separate "as a student"
  // preview -- it is the same page with the teacher layer turned on.
  it("reaches the teacher and every kind of student", () => {
    for (const nav of [
      getNavigation("teacher"),
      getNavigation("student", true),
      getNavigation("student", false),
    ]) {
      expect(nav.map((n) => n.href)).toContain("/dashboard/lessons");
    }
  });

  it("uses one label and one icon everywhere, so it is the same section", () => {
    const entries = [
      getNavigation("teacher"),
      getNavigation("student", true),
      getNavigation("student", false),
    ].map((nav) => nav.find((n) => n.href === "/dashboard/lessons")!);
    for (const e of entries) {
      expect(e.label).toBe("Lessons");
      expect(e.icon).toBe(entries[0].icon);
    }
  });

  it("does not collide with another destination's icon in the same menu", () => {
    for (const nav of [
      getNavigation("teacher"),
      getNavigation("student", true),
      getNavigation("student", false),
    ]) {
      const icons = nav.map((n) => n.icon);
      expect(new Set(icons).size).toBe(icons.length);
    }
  });

  it("is not offered to a parent", () => {
    expect(getNavigation("parent").map((n) => n.href)).not.toContain("/dashboard/lessons");
  });
});
