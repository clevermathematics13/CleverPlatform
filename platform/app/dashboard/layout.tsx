import { getProfile } from "@/lib/auth";
import { getViewAsTarget, getViewAsOptions } from "@/lib/view-as";
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

  const navigation = getNavigation(viewRole);
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

function getNavigation(role: string) {
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
