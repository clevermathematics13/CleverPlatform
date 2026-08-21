"use server";

import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import {
  getAuthUrl,
  getConnectionStatus,
  clearToken,
  listCourses,
  listStudentsInCourse,
  pingClassroom,
  ClassroomError,
  type ClassroomCourse,
  type ClassroomStudent,
  type ConnectionStatus,
} from "@/lib/google-classroom";

function getRequestBaseUrl(forwardedHost: string | null, forwardedProto: string | null, host: string | null): string | null {
  if (forwardedHost) {
    return `${forwardedProto || "https"}://${forwardedHost}`;
  }
  if (host) {
    const proto = host.includes("localhost") ? "http" : "https";
    return `${proto}://${host}`;
  }
  return null;
}

export async function getGoogleAuthUrl(): Promise<string> {
  await requireTeacher();

  const headerStore = await headers();
  const baseUrl = getRequestBaseUrl(
    headerStore.get("x-forwarded-host"),
    headerStore.get("x-forwarded-proto"),
    headerStore.get("host")
  );

  if (baseUrl) {
    return getAuthUrl(`${baseUrl}/auth/google-classroom/callback`);
  }

  return getAuthUrl();
}

export async function isGoogleConnected(): Promise<boolean> {
  const status = await getConnectionStatus();
  return status.connected;
}

/** Full status: account, granted scopes, expiry, whether it can self-heal. */
export async function googleConnectionStatus(): Promise<ConnectionStatus> {
  await requireTeacher();
  return getConnectionStatus();
}

/** Live round-trip against the Google API using the stored credential. */
export async function checkGoogleConnection(): Promise<{ ok: boolean; detail: string }> {
  await requireTeacher();
  return pingClassroom();
}

export async function disconnectGoogle(): Promise<void> {
  await clearToken();
  revalidatePath("/dashboard/students");
}

function toMessage(err: unknown): string {
  if (err instanceof ClassroomError) return err.message;
  return err instanceof Error ? err.message : "Google Classroom request failed.";
}

export async function fetchGoogleCourses(): Promise<ClassroomCourse[]> {
  await requireTeacher();
  try {
    return await listCourses();
  } catch (err) {
    console.error("[GC] listCourses:", toMessage(err));
    return [];
  }
}

export async function fetchGoogleStudents(
  courseId: string
): Promise<ClassroomStudent[]> {
  await requireTeacher();
  try {
    return await listStudentsInCourse(courseId);
  } catch (err) {
    console.error("[GC] listStudentsInCourse:", toMessage(err));
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/*  Class links: which Google Classroom course backs which CleverPlatform     */
/*  course. This is a small persistent mapping (course_google_classroom_links) */
/*  separate from the one-off roster import above and from the Classroom      */
/*  grading page — it exists so both of those can agree on "our classes"      */
/*  instead of re-picking a Google course from scratch every time.            */
/* -------------------------------------------------------------------------- */

export interface ClassroomLink {
  id: string;
  courseId: string;
  courseName: string;
  googleCourseId: string;
  googleCourseName: string;
  googleCourseSection: string | null;
}

export async function fetchClassroomLinks(): Promise<ClassroomLink[]> {
  await requireTeacher();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("course_google_classroom_links")
    .select(`
      id,
      google_course_id,
      google_course_name,
      google_course_section,
      courses:course_id ( id, name )
    `)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[GC] fetchClassroomLinks:", error.message);
    return [];
  }

  return (data ?? []).flatMap((row) => {
    const course = row.courses as unknown as { id: string; name: string } | null;
    if (!course) return [];
    return [
      {
        id: row.id,
        courseId: course.id,
        courseName: course.name,
        googleCourseId: row.google_course_id,
        googleCourseName: row.google_course_name,
        googleCourseSection: row.google_course_section,
      },
    ];
  });
}

export async function linkClassroomCourse(formData: FormData) {
  await requireTeacher();
  const supabase = await createClient();

  const courseId = formData.get("course_id") as string;
  const googleCourseId = formData.get("google_course_id") as string;
  const googleCourseName = formData.get("google_course_name") as string;
  const googleCourseSection = (formData.get("google_course_section") as string) || null;

  if (!courseId || !googleCourseId || !googleCourseName) {
    return { error: "Select both a Google Classroom course and a CleverPlatform course." };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase
    .from("course_google_classroom_links")
    .upsert(
      {
        course_id: courseId,
        google_course_id: googleCourseId,
        google_course_name: googleCourseName,
        google_course_section: googleCourseSection,
        linked_by: user?.id ?? null,
      },
      { onConflict: "course_id" }
    );

  if (error) {
    console.error("[GC] linkClassroomCourse:", error.message);
    return { error: error.message };
  }

  revalidatePath("/dashboard/students");
  revalidatePath("/dashboard/classroom");
  return { success: true };
}

export async function unlinkClassroomCourse(linkId: string) {
  await requireTeacher();
  const supabase = await createClient();

  const { error } = await supabase
    .from("course_google_classroom_links")
    .delete()
    .eq("id", linkId);

  if (error) {
    console.error("[GC] unlinkClassroomCourse:", error.message);
    return { error: error.message };
  }

  revalidatePath("/dashboard/students");
  revalidatePath("/dashboard/classroom");
  return { success: true };
}

export async function importGoogleStudents(formData: FormData) {
  await requireTeacher();
  const supabase = await createClient();

  const courseId = formData.get("course_id") as string;
  const emails = formData.getAll("student_email") as string[];
  const names = formData.getAll("student_name") as string[];

  if (!courseId || emails.length === 0) {
    return { error: "Select a course and at least one student." };
  }

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Look up course name once (used for seating_students)
  const { data: course } = await supabase
    .from("courses")
    .select("name")
    .eq("id", courseId)
    .single();

  console.log(`[GC Import] Starting import of ${emails.length} students into course ${courseId} (${course?.name})`);

  for (let i = 0; i < emails.length; i++) {
    const email = emails[i]?.trim().toLowerCase();
    const fullName = names[i] || email.split("@")[0];
    const firstName = fullName.split(/\s+/)[0];

    if (!email || !email.endsWith("@amersol.edu.pe")) {
      skipped++;
      errors.push(`${emails[i]}: must be an @amersol.edu.pe email`);
      continue;
    }

    // Upsert into invited_students (auto-register immediately)
    const { error: inviteError } = await supabase
      .from("invited_students")
      .upsert(
        {
          email,
          full_name: fullName,
          course_id: courseId,
          registered: true,
        },
        { onConflict: "email,course_id" }
      );

    if (inviteError) {
      console.error(`[GC Import] invited_students upsert failed for ${email}:`, inviteError.message);
      skipped++;
      errors.push(`${email}: ${inviteError.message}`);
      continue;
    }

    // Set nickname to first name only if not already set
    await supabase
      .from("invited_students")
      .update({ nickname: firstName })
      .eq("email", email)
      .eq("course_id", courseId)
      .is("nickname", null);

    // If student already has a profile, auto-enroll them now
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .ilike("email", email)
      .single();

    if (profile) {
      const { error: enrollError } = await supabase
        .from("students")
        .upsert(
          { profile_id: profile.id, course_id: courseId },
          { onConflict: "profile_id,course_id" }
        );

      if (enrollError) {
        skipped++;
        errors.push(`${email}: enrollment failed — ${enrollError.message}`);
        continue;
      }

      // Mark invitation as registered
      await supabase
        .from("invited_students")
        .update({ registered: true, profile_id: profile.id })
        .eq("email", email)
        .eq("course_id", courseId);
    }

    // Sync into seating_students
    if (course) {
      await supabase
        .from("seating_students")
        .upsert(
          {
            student_id: email,
            name: fullName,
            class_group: course.name,
            active: true,
            notes: "",
          },
          { onConflict: "student_id", ignoreDuplicates: true }
        );
    }

    console.log(`[GC Import] OK: ${email}`);
    imported++;
  }

  revalidatePath("/dashboard/students");
  console.log(`[GC Import] Done: ${imported} imported, ${skipped} skipped`);
  return {
    success: true,
    imported,
    skipped,
    errors: errors.length > 0 ? errors : undefined,
  };
}
