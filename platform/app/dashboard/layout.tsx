import { getProfile } from "@/lib/auth";
import { getImpersonatedRole, getImpersonatedProfileId } from "./impersonate-actions";
import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "./dashboard-shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getProfile();
  const impersonating = profile.role === "teacher"
    ? await getImpersonatedRole()
    : null;
  const viewRole = impersonating ?? profile.role;

  let impersonatedStudentName: string | null = null;
  if (impersonating === "student") {
    const impersonatedProfileId = await getImpersonatedProfileId();
    if (impersonatedProfileId) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("profiles")
        .select("display_name, nickname")
        .eq("id", impersonatedProfileId)
        .single();
      impersonatedStudentName = data?.nickname ?? data?.display_name ?? null;
    }
  }

  const navigation = getNavigation(viewRole);
  const settingsNavigation = getSettingsNavigation(viewRole);

  return (
    <DashboardShell
      navigation={navigation}
      settingsNavigation={settingsNavigation}
      profile={{
        role: profile.role,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
      }}
      impersonating={impersonating}
      impersonatedStudentName={impersonatedStudentName}
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
      { href: "/dashboard/gradebook", label: "Gradebook", icon: "📝" },
      { href: "/dashboard/questions", label: "Question Bank", icon: "❓" },
      { href: "/dashboard/questions/review", label: "LaTeX Review", icon: "🔬" },
      { href: "/dashboard/assignments", label: "Assignments", icon: "📋" },
      { href: "/dashboard/reflection", label: "Exam Reflection", icon: "🪞" },
      { href: "/dashboard/mastery", label: "Mastery", icon: "🎯" },
      { href: "/dashboard/seating", label: "Seating Chart", icon: "🪑" },
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
      { href: "/dashboard/courses", label: "Courses", icon: "📚" },
      { href: "/dashboard/syllabus", label: "Syllabus", icon: "📖" },
    ];
  }
  return [];
}
