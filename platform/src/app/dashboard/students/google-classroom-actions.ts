"use server";

import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import {
  getAuthUrl,
  getTokenFromCookie,
  clearTokenCookie,
  listCourses,
  listStudentsInCourse,
  type ClassroomCourse,
  type ClassroomStudent,
} from "@/lib/google-classroom";

export async function getGoogleAuthUrl(): Promise<string> {
  await requireTeacher();
  return getAuthUrl();
}

export async function isGoogleConnected(): Promise<boolean> {
  const token = await getTokenFromCookie();
  return token !== null;
}

export async function disconnectGoogle(): Promise<void> {
  await clearTokenCookie();
  revalidatePath("/dashboard/students");
}

export async function fetchGoogleCourses(): Promise<ClassroomCourse[]> {
  await requireTeacher();
  return listCourses();
}

export async function fetchGoogleStudents(
  courseId: string
): Promise<ClassroomStudent[]> {
  await requireTeacher();
  return listStudentsInCourse(courseId);
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
    const email = emails[i];
    const fullName = names[i] || email.split("@")[0];

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

    // If student already has a profile, auto-enroll them now
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", email)
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
