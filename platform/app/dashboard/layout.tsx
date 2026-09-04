import { getProfile } from "@/lib/auth";
import { getViewAsOptions } from "@/lib/view-as";
import { isGrade9Course } from "@/lib/course-level";
import { getNavigation, getSettingsNavigation } from "@/lib/dashboard-nav";
import { createClient } from "@/lib/supabase/server";
import { MULTI_ROLE_TEST_PROFILE_IDS } from "@/lib/test-accounts";
import { cookies } from "next/headers";
import { DEFAULT_NAV_POSITION, NAV_POSITION_COOKIE, isNavPosition } from "@/lib/nav-position";
import { DashboardShell } from "./dashboard-shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getProfile();
  const supabase = await createClient();

  // The viewed student is NOT resolved here. This is a layout, and a Next
  // App Router layout is never re-rendered when only search params change --
  // ?viewAs= is exactly that, so a layout-resolved view would go stale the
  // moment it was switched. The shell is a client component and reads the
  // param itself; the layout's job is only to hand it the roster it needs
  // to name whoever is selected.
  const viewAsOptions = profile.role === "teacher" ? await getViewAsOptions() : [];

  // A real (non-impersonating) student's own courses, for the Grade 9 menu.
  // The two multi-role test accounts are enrolled in 9A for test coverage,
  // not because they're real Grade 9 students -- exempt them so choosing
  // "Student" gets the ordinary nav, not the minimal Grade 9 one.
  let isGrade9 = false;
  if (profile.role === "student" && !MULTI_ROLE_TEST_PROFILE_IDS.includes(profile.id)) {
    const { data } = await supabase
      .from("students")
      .select("courses(name)")
      .eq("profile_id", profile.id);
    isGrade9 = (data ?? []).some((r) => {
      const c = Array.isArray(r.courses) ? r.courses[0] : r.courses;
      return isGrade9Course((c as { name: string } | null)?.name ?? "");
    });
  }

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

  const navigation = getNavigation(profile.role, isGrade9);
  const settingsNavigation = getSettingsNavigation(profile.role);

  // Which edge the navigation docks to. Read here, on the server, so the
  // first paint already lands on the chosen edge instead of rendering on the
  // left and jumping once the client reads a preference.
  const rawNavPosition = (await cookies()).get(NAV_POSITION_COOKIE)?.value;
  const navPosition = isNavPosition(rawNavPosition) ? rawNavPosition : DEFAULT_NAV_POSITION;

  return (
    <DashboardShell
      navigation={navigation}
      settingsNavigation={settingsNavigation}
      navPosition={navPosition}
      gradebookCourses={gradebookCourses}
      profile={{
        role: profile.role,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
      }}
      viewAsOptions={viewAsOptions}
    >
      {children}
    </DashboardShell>
  );
}


