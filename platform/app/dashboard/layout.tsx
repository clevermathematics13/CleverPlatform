import { getProfile } from "@/lib/auth";
import { getViewAsTarget, getViewAsOptions } from "@/lib/view-as";
import { isGrade9Course } from "@/lib/course-level";
import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "./dashboard-shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getProfile();
  const supabase = await createClient();

  // Per-tab, driven by ?viewAs= in this tab's URL -- see lib/view-as.ts.
  const viewAs = await getViewAsTarget();
  const viewRole = viewAs ? "student" : profile.role;
  const viewAsOptions = profile.role === "teacher" && !viewAs ? await getViewAsOptions() : [];

  // Which course the viewer is in, so a Grade 9 student gets the Grade 9
  // menu. Resolved for the impersonated student when previewing, and for
  // the signed-in student otherwise -- the nav a teacher previews has to be
  // the nav the student actually gets, or the preview is worthless.
  let viewerCourseNames: string[] = [];
  if (viewAs) {
    viewerCourseNames = viewAs.courseName ? [viewAs.courseName] : [];
  } else if (profile.role === "student") {
    const { data } = await supabase
      .from("students")
      .select("courses(name)")
      .eq("profile_id", profile.id);
    viewerCourseNames = (data ?? [])
      .map((r) => {
        const c = Array.isArray(r.courses) ? r.courses[0] : r.courses;
        return (c as { name: string } | null)?.name ?? "";
      })
      .filter(Boolean);
  }
  const isGrade9 = viewerCourseNames.some(isGrade9Course);

  // Courses list for the Gradebook submenu (teacher only)
  let gradebookCourses: { id: string; name: string }[] = [];
  if (profile.role === "teacher") {
    const { data } = await supabase
      .from("courses")
      .select("id, name")
      .eq("archived", false)
      .order("name");
    gradebookCourses = data ?? [];
  }

  const navigation = getNavigation(viewRole, isGrade9);
  const settingsNavigation = getSettingsNavigation(viewRole);

  return (
    <DashboardShell
      navigation={navigation}
      settingsNavigation={settingsNavigation}
      gradebookCourses={gradebookCourses}
      profile={{
        role: profile.role,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
      }}
      viewAsId={viewAs?.invitedStudentId ?? null}
      viewAsName={viewAs?.name ?? null}
      viewAsCourse={viewAs?.courseName ?? null}
      viewAsHasAccount={viewAs?.hasAccount ?? false}
      viewAsOptions={viewAsOptions}
    >
      {children}
    </DashboardShell>
  );
}

function getNavigation(role: string, isGrade9 = false) {
  const shared = [
    { href: "/dashboard", label: "Dashboard", icon: "📊" },
  ];

  if (role === "teacher") {
    return [
      ...shared,
      { href: "/dashboard/questions", label: "PPQ Bank", icon: "❓" },

      { href: "/dashboard/assignments", label: "Assignments", icon: "📋" },
      { href: "/dashboard/tests", label: "Tests", icon: "📝" },
      { href: "/dashboard/placement", label: "Placement Tests", icon: "🧭" },
      { href: "/dashboard/reflection", label: "Exam Reflection", icon: "🪞" },
      { href: "/dashboard/mastery", label: "Mastery", icon: "🎯" },
      { href: "/dashboard/seating", label: "Seating Chart", icon: "🪑" },
      { href: "/dashboard/gradebook", label: "Gradebook", icon: "�" },
      { href: "/dashboard/classroom", label: "Google Classroom", icon: "🎓" },
    ];
  }

  if (role === "student") {
    // A Grade 9 student's whole use of the platform is reading the
    // feedback on their Nuanced Analysis packets, so that is the only
    // thing in their menu -- no Dashboard tile maze to get lost in.
    if (isGrade9) {
      return [{ href: "/dashboard/na-feedback", label: "Feedback", icon: "\u{1F4DD}" }];
    }
    return shared;
  }

  if (role === "parent") {
    return [
      ...shared,
      { href: "/dashboard/progress", label: "Student Progress", icon: "📈" },
    ];
  }

  return shared;
}

function getSettingsNavigation(role: string) {
  if (role === "teacher") {
    return [
      { href: "/dashboard/students", label: "Students", icon: "👥" },
      { href: "/dashboard/parents", label: "Parents", icon: "👪" },
      { href: "/dashboard/courses", label: "Courses", icon: "📚" },
      { href: "/dashboard/archived-courses", label: "Archived Courses", icon: "🗄️" },
      { href: "/dashboard/syllabus", label: "Syllabus", icon: "📖" },
      { href: "/dashboard/archived-exams", label: "Archived Exams", icon: "🗄️" },
      { href: "/dashboard/archived-saved-exams", label: "Archived Saved Exams", icon: "🗃️" },
      { href: "/dashboard/questions/review", label: "LaTeX Review", icon: "🔬" },
      { href: "/dashboard/graph-lab", label: "Graph Lab", icon: "📈" },
    ];
  }
  return [];
}
