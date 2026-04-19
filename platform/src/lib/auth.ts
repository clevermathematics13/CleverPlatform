import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { UserRole, Profile } from "@/lib/types";

/**
 * Get the current user's profile from the database.
 * Redirects to /login if not authenticated.
 */
export async function getProfile(): Promise<Profile> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    // User is authenticated but has no profile (e.g. stale session from
    // a previous Supabase project, or profile not yet created).
    // Sign out to clear cookies and break any redirect loop.
    await supabase.auth.signOut();
    redirect("/login");
  }

  return profile as Profile;
}

/**
 * Require a specific role. Redirects to /unauthorized if the user
 * doesn't have the required role.
 */
export async function requireRole(
  ...allowedRoles: UserRole[]
): Promise<Profile> {
  const profile = await getProfile();

  if (!allowedRoles.includes(profile.role)) {
    redirect("/unauthorized");
  }

  return profile;
}

/**
 * Check if the current user is a teacher.
 */
export async function requireTeacher(): Promise<Profile> {
  return requireRole("teacher");
}

/**
 * Check if the current user is a student or teacher.
 */
export async function requireStudentOrTeacher(): Promise<Profile> {
  return requireRole("student", "teacher");
}
