import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import type { UserRole, Profile } from "@/lib/types";

// ─── API route auth helpers ──────────────────────────────────────────────────
// Use these in API route handlers instead of writing the auth boilerplate
// manually. They return a discriminated union so the caller can short-circuit
// with `if (!auth.ok) return auth.response`.

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export type ApiAuthOk = {
  ok: true;
  supabase: SupabaseClient;
  user: User;
  profile: Profile;
};

export type ApiAuthFail = {
  ok: false;
  response: NextResponse<{ error: string }>;
};

export type ApiAuth = ApiAuthOk | ApiAuthFail;

/** Authenticate the request and require the caller to be a teacher. */
export async function getApiTeacher(): Promise<ApiAuth> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }),
    };
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role !== "teacher") {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { ok: true, supabase, user, profile: profile as Profile };
}

/** Authenticate the request and require any logged-in user. */
export async function getApiUser(): Promise<ApiAuth> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }),
    };
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  if (!profile) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Profile not found" }, { status: 401 }),
    };
  }
  return { ok: true, supabase, user, profile: profile as Profile };
}

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
