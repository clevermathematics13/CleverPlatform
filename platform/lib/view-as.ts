import { headers } from "next/headers";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { VIEW_AS_HEADER } from "@/lib/supabase/middleware";

/**
 * Per-tab "view as this student" for the teacher.
 *
 * Scoping: the target comes from the ?viewAs= query param (forwarded onto
 * the request by middleware -- see VIEW_AS_HEADER for why a header rather
 * than searchParams). That makes it per-TAB by construction: the URL is
 * the only per-tab state a plain navigation carries to the server, so two
 * tabs on the same origin can sit in different views at the same time, and
 * one can stay in the teacher view while another impersonates. This
 * replaces the impersonate-role/impersonate-profile-id cookies, which were
 * shared by every tab and so could not do that.
 *
 * Keyed on invited_students.id, not profiles.id, deliberately. Most of the
 * roster has never signed in (profiles rows only appear on first login), so
 * a profile-keyed picker would today be almost empty and would not contain
 * the students a teacher actually wants to preview. The roster row always
 * exists, and profileId comes along with it when the student does have an
 * account.
 *
 * Nothing here trusts the header. The caller must really be a teacher, and
 * the id must really be one of the teacher's roster students, or this
 * returns null and the caller renders its ordinary teacher view.
 */
export interface ViewAsTarget {
  /** invited_students.id -- the value carried in ?viewAs= */
  invitedStudentId: string;
  /** profiles.id, or null when this student has never signed in. Anything
   *  that reads a student's own data by profile id must handle the null:
   *  there is no account to attribute that data to yet. */
  profileId: string | null;
  name: string;
  courseName: string | null;
  /** False when the student has no login yet. The banner says so, because
   *  "viewing as" someone with no account shows an emptier page than they
   *  will eventually see, and that is otherwise indistinguishable from a
   *  bug. */
  hasAccount: boolean;
}

export async function getViewAsTarget(): Promise<ViewAsTarget | null> {
  const requested = (await headers()).get(VIEW_AS_HEADER);
  if (!requested) return null;

  // Teacher-only. A student who hand-types ?viewAs=<someone else> gets
  // their own view, exactly as if the param were absent.
  const profile = await getProfile();
  if (profile.role !== "teacher") return null;

  // Accepts either an invited_students.id or a profiles.id. The roster row
  // is the canonical key (it exists for every student, signed in or not),
  // but the Students table lists enrolled students by profile id and has no
  // invited id on those rows, so both are resolved to the same roster row
  // rather than making callers know which one they hold.
  const supabase = await createClient();
  let { data } = await supabase
    .from("invited_students")
    .select("id, full_name, nickname, profile_id, courses(name)")
    .eq("id", requested)
    .maybeSingle();

  if (!data) {
    ({ data } = await supabase
      .from("invited_students")
      .select("id, full_name, nickname, profile_id, courses(name)")
      .eq("profile_id", requested)
      .maybeSingle());
  }
  if (!data) return null;

  const course = Array.isArray(data.courses) ? data.courses[0] : data.courses;
  return {
    invitedStudentId: data.id,
    profileId: data.profile_id ?? null,
    name: data.nickname ?? data.full_name ?? "Student",
    courseName: (course as { name: string } | null)?.name ?? null,
    hasAccount: !!data.profile_id,
  };
}

export interface ViewAsOption {
  invitedStudentId: string;
  name: string;
  courseName: string;
  hasAccount: boolean;
}

/** The roster the picker offers, active courses only, grouped by course in
 *  the UI. Archived courses are left out for the same reason the seating
 *  generator now excludes them: they are last year's students. */
export async function getViewAsOptions(): Promise<ViewAsOption[]> {
  const profile = await getProfile();
  if (profile.role !== "teacher") return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("invited_students")
    .select("id, full_name, nickname, profile_id, courses!inner(name, archived)")
    .eq("courses.archived", false)
    .order("full_name");

  return (data ?? []).map((r) => {
    const course = Array.isArray(r.courses) ? r.courses[0] : r.courses;
    return {
      invitedStudentId: r.id,
      name: r.full_name ?? r.nickname ?? "Student",
      courseName: (course as { name: string } | null)?.name ?? "Unassigned",
      hasAccount: !!r.profile_id,
    };
  });
}
