import { getProfile } from "@/lib/auth";
import { getImpersonatedRole } from "./impersonate-actions";
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

  const navigation = getNavigation(viewRole);

  return (
    <DashboardShell
      navigation={navigation}
      profile={{
        role: profile.role,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
      }}
      impersonating={impersonating}
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
      { href: "/dashboard/students", label: "Students", icon: "👥" },
      { href: "/dashboard/gradebook", label: "Gradebook", icon: "📝" },
      { href: "/dashboard/courses", label: "Courses", icon: "📚" },
      { href: "/dashboard/questions", label: "Question Bank", icon: "❓" },
      { href: "/dashboard/questions/review", label: "LaTeX Review", icon: "🔬" },
      { href: "/dashboard/assignments", label: "Assignments", icon: "📋" },
      { href: "/dashboard/reflection", label: "Exam Reflection", icon: "🪞" },
      { href: "/dashboard/mastery", label: "Mastery", icon: "🎯" },
      { href: "/dashboard/seating", label: "Seating Chart", icon: "🪑" },
    ];
  }

  if (role === "student") {
    return [
      ...shared,
      { href: "/dashboard/progress", label: "My Progress", icon: "📈" },
      { href: "/dashboard/textbook", label: "Textbook", icon: "📚" },
      { href: "/dashboard/assignments", label: "My Assignments", icon: "📋" },
      { href: "/dashboard/reflection", label: "Exam Reflection", icon: "🪞" },
      { href: "/dashboard/mastery", label: "My Mastery", icon: "🎯" },
    ];
  }

  if (role === "parent") {
    return [
      ...shared,
      { href: "/dashboard/progress", label: "Student Progress", icon: "📈" },
    ];
  }

  return shared;
}
