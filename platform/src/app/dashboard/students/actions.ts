"use server";

import { createClient } from "@/lib/supabase/server";
import { requireTeacher } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function addStudent(formData: FormData) {
  await requireTeacher();
  const supabase = await createClient();

  const email = (formData.get("email") as string)?.trim();
  const courseId = formData.get("course_id") as string;

  if (!email || !courseId) return { error: "Email and course are required" };

  // Create invitation
  const { error: inviteError } = await supabase
    .from("invited_students")
    .upsert(
      {
        email,
        full_name: email.split("@")[0],
        course_id: courseId,
      },
      { onConflict: "email,course_id" }
    );

  if (inviteError) {
    return { error: inviteError.message };
  }

  // If student already has a profile, also enroll them right away
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", email)
    .single();

  if (profile) {
    const { error: insertError } = await supabase
      .from("students")
      .upsert(
        { profile_id: profile.id, course_id: courseId },
        { onConflict: "profile_id,course_id" }
      );

    if (insertError) {
      return { error: `Invited, but enrollment failed: ${insertError.message}` };
    }

    // Mark invitation as registered
    await supabase
      .from("invited_students")
      .update({ registered: true, profile_id: profile.id })
      .eq("email", email)
      .eq("course_id", courseId);
  }

  revalidatePath("/dashboard/students");
  return { success: true };
}

export async function removeStudent(formData: FormData) {
  await requireTeacher();
  const supabase = await createClient();

  const studentId = formData.get("student_id") as string;
  if (!studentId) return;

  await supabase.from("students").delete().eq("id", studentId);
  revalidatePath("/dashboard/students");
}
