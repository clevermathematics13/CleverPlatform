import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getImpersonatedRole } from "./impersonate-actions";
import { ImpersonateMenu } from "./impersonate-menu";

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
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r border-gray-200 bg-white">
        {/* Brand */}
        <div className="flex h-16 items-center border-b border-gray-200 px-6">
          <Link href="/dashboard" className="text-xl font-bold text-gray-900">
            CleverPlatform
          </Link>
        </div>

        {/* Nav Links */}
        <nav className="flex-1 space-y-1 px-3 py-4">
          {navigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              <span>{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>

        {/* User Info + Logout */}
        <div className="border-t border-gray-200 p-4">
          <ImpersonateMenu
            currentRole={profile.role}
            impersonating={impersonating}
          />
          <div className="flex items-center gap-3">
            {profile.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt=""
                className="h-8 w-8 rounded-full"
              />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-sm font-medium text-blue-700">
                {profile.display_name?.[0]?.toUpperCase() ?? "?"}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-900">
                {profile.display_name}
              </p>
              <p className="truncate text-xs text-gray-500 capitalize">
                {impersonating ? `Teacher (as ${impersonating})` : profile.role}
              </p>
            </div>
          </div>
          <form action="/auth/signout" method="POST" className="mt-3">
            <button
              type="submit"
              className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 bg-gray-50 p-8">{children}</main>
    </div>
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
      { href: "/dashboard/assignments", label: "Assignments", icon: "📋" },
      { href: "/dashboard/reflection", label: "Reflection", icon: "🪞" },
      { href: "/dashboard/mastery", label: "Mastery", icon: "🎯" },
    ];
  }

  if (role === "student") {
    return [
      ...shared,
      { href: "/dashboard/progress", label: "My Progress", icon: "📈" },
      { href: "/dashboard/textbook", label: "Textbook", icon: "📚" },
      { href: "/dashboard/assignments", label: "My Assignments", icon: "📋" },
      { href: "/dashboard/reflection", label: "Reflection", icon: "🪞" },
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
