import { isGrade9Course } from "./course-level";

export interface NavigationItem {
  href: string;
  label: string;
  icon: string;
}

/** Shared by the server layout and the client shell. The shell needs it
 *  because the "view as" target lives in the URL, and only a client
 *  component can react to a search-param change -- a Next App Router
 *  layout is not re-rendered for one. */
export function getNavigation(role: string, isGrade9 = false): NavigationItem[] {
  const shared = [{ href: "/dashboard", label: "Dashboard", icon: "\u{1F4CA}" }];

  if (role === "teacher") {
    return [
      ...shared,
      { href: "/dashboard/lessons", label: "Lessons", icon: "\u{1F4A1}" },
      { href: "/dashboard/questions", label: "PPQ Bank", icon: "❓" },
      { href: "/dashboard/practice-sets", label: "Practice Sets", icon: "\u{1F4D0}" },
      // The same page the class gets, opened as yourself: a working answer
      // editor and notation palette that saves nothing, so a set can be tried
      // before it is handed out. Deliberately NOT called "Practice" and
      // deliberately not sharing the set-builder's icon -- two adjacent items
      // called Practice and Practice Sets, both with a ruler, is a coin flip
      // every time. To read one student's real answers, use "View as"
      // instead; this entry is nobody's page.
      { href: "/dashboard/practice", label: "Practice (as a student)", icon: "\u{1F441}️" },
      { href: "/dashboard/assignments", label: "Assignments", icon: "\u{1F4CB}" },
      { href: "/dashboard/tests", label: "Tests", icon: "\u{1F4DD}" },
      // Next to Tests, because it is a view OF the tests -- their dates, across
      // every class at once. The dates themselves live on the test.
      { href: "/dashboard/calendar", label: "Assessment Calendar", icon: "\u{1F4C5}" },
      { href: "/dashboard/placement", label: "Placement Tests", icon: "\u{1F9ED}" },
      { href: "/dashboard/reflection", label: "Exam Reflection", icon: "\u{1FA9E}" },
      { href: "/dashboard/remark-requests", label: "Re-mark Requests", icon: "\u{1F64B}" },
      { href: "/dashboard/mastery", label: "Mastery", icon: "\u{1F3AF}" },
      { href: "/dashboard/seating", label: "Seating Chart", icon: "\u{1FA91}" },
      { href: "/dashboard/na-review/scan-test", label: "Scan Pipeline", icon: "\u{1F5A8}\uFE0F" },
      { href: "/dashboard/na-review/batch-runs", label: "Active Batch Runs", icon: "\u{1F5C2}\uFE0F" },
      { href: "/dashboard/gradebook", label: "Gradebook", icon: "\u{1F4D2}" },
      { href: "/dashboard/classroom", label: "Google Classroom", icon: "\u{1F393}" },
      { href: "/dashboard/games", label: "Live Game", icon: "\u{1F3AE}" },
    ];
  }

  if (role === "student") {
    // A Grade 9 student's use of the platform was ONLY reading feedback --
    // not a Dashboard whose tiles lead where they have no reason to go --
    // and that comes from two separate places: Nuanced Analysis packets
    // (na-feedback) and Clev's Marks on a Tests-based assessment like a
    // Formative Assessment (reflection). Both need a menu entry, or a
    // student whose class only uses one of the two has no way to reach it.
    //
    // Lessons is the first entry here that is not feedback, and it leads the
    // list because it is the only one that comes BEFORE the work: a mini
    // lesson is what you read to be able to start the worksheet. The two
    // feedback destinations are what you read afterwards, so they keep their
    // order behind it.
    if (isGrade9) {
      return [
        { href: "/dashboard/lessons", label: "Lessons", icon: "\u{1F4A1}" },
        { href: "/dashboard/na-feedback", label: "Feedback", icon: "\u{1F4DD}" },
        { href: "/dashboard/reflection", label: "Test Feedback", icon: "\u{1FA9E}" },
      ];
    }
    // Practice sits in the menu whether or not the class currently has a
    // released set, exactly as Live Game does whether or not a game is
    // running: this is a static list with no database behind it, and the
    // page says plainly when there is nothing yet. The dashboard TILE is the
    // conditional one, because a tile is a claim that there is something to
    // open. Grade 9 is excluded above -- practice sets are a DP thing.
    // Lessons is static here for the same reason Practice is: the page says
    // plainly what has been published, and every lesson card names the class
    // it was written for. Filtering the list by the reader's own course is
    // per-course RELEASE, which is one of the three things that would move
    // lesson content into the database -- see lib/lessons/types.ts.
    return [
      ...shared,
      { href: "/dashboard/lessons", label: "Lessons", icon: "\u{1F4A1}" },
      { href: "/dashboard/practice", label: "Practice", icon: "\u{1F4D0}" },
      { href: "/dashboard/games", label: "Live Game", icon: "\u{1F3AE}" },
    ];
  }

  if (role === "parent") {
    return [...shared, { href: "/dashboard/progress", label: "Student Progress", icon: "\u{1F4C8}" }];
  }

  return shared;
}

export function getSettingsNavigation(role: string): NavigationItem[] {
  if (role === "teacher") {
    return [
      { href: "/dashboard/students", label: "Students", icon: "\u{1F465}" },
      { href: "/dashboard/parents", label: "Parents", icon: "\u{1F46A}" },
      { href: "/dashboard/courses", label: "Courses", icon: "\u{1F4DA}" },
      { href: "/dashboard/archived-courses", label: "Archived Courses", icon: "\u{1F5C4}️" },
      { href: "/dashboard/syllabus", label: "Syllabus", icon: "\u{1F4D6}" },
      { href: "/dashboard/archived-exams", label: "Archived Exams", icon: "\u{1F5C4}️" },
      { href: "/dashboard/archived-saved-exams", label: "Archived Saved Exams", icon: "\u{1F5C3}️" },
      { href: "/dashboard/questions/review", label: "LaTeX Review", icon: "\u{1F52C}" },
      { href: "/dashboard/graph-lab", label: "Graph Lab", icon: "\u{1F4C8}" },
      { href: "/dashboard/settings", label: "Settings", icon: "\u{2699}️" },
    ];
  }
  return [];
}

export { isGrade9Course };

/** Minimal shape of a roster option the shell needs. Declared structurally
 *  rather than imported from lib/view-as, which pulls in server-only
 *  modules the client shell must not bundle. */
export interface ViewAsLike {
  invitedStudentId: string;
  name: string;
  courseName: string;
  hasAccount: boolean;
}

/** Works out what the sidebar should show for a given ?viewAs= value.
 *
 *  Pure and separately tested because this is the exact logic that failed
 *  twice: first resolved in a layout (never re-rendered on a search-param
 *  change), then via a middleware header (middleware that never runs in
 *  this app -- see lib/view-as.ts). It now lives in the client shell, but
 *  the decision itself should not need a browser to verify. */
export function deriveDashboardView(input: {
  viewAsId: string | null;
  options: ViewAsLike[];
  teacherNavigation: NavigationItem[];
  teacherSettingsNavigation: NavigationItem[];
}): {
  viewing: ViewAsLike | null;
  navigation: NavigationItem[];
  settingsNavigation: NavigationItem[];
} {
  const viewing = input.viewAsId
    ? (input.options.find((o) => o.invitedStudentId === input.viewAsId) ?? null)
    : null;

  // An unrecognised id falls back to the teacher's own view rather than a
  // half-applied student one: a stale bookmark should not strand a teacher
  // in a nameless student shell.
  if (!viewing) {
    return {
      viewing: null,
      navigation: input.teacherNavigation,
      settingsNavigation: input.teacherSettingsNavigation,
    };
  }

  return {
    viewing,
    navigation: getNavigation("student", isGrade9Course(viewing.courseName)),
    settingsNavigation: getSettingsNavigation("student"),
  };
}
