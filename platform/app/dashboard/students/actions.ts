
"use server";

export async function setStudentExtraTime(formData: FormData) {
  await requireTeacher();
  const supabase = await createClient();

  const studentId = formData.get("student_id") as string;
  const extraTime = parseInt(formData.get("extra_time") as string, 10);
  if (!studentId || ![0, 25, 50].includes(extraTime)) return;

  const { error } = await supabase
    .from("students")
    .update({ extra_time: extraTime })
    .eq("id", studentId);
  if (error) {
    console.error("[setStudentExtraTime] Failed to update students.extra_time:", error.message, error.code);
    throw new Error(`Failed to save extra time: ${error.message}`);
  }
  revalidatePath("/dashboard/students");
}

export async function setInvitedStudentExtraTime(formData: FormData) {
  await requireTeacher();
  const supabase = await createClient();

  const invitedId = formData.get("invited_id") as string;
  const extraTime = parseInt(formData.get("extra_time") as string, 10);
  if (!invitedId || ![0, 25, 50].includes(extraTime)) return;

  const { error } = await supabase
    .from("invited_students")
    .update({ extra_time: extraTime })
    .eq("id", invitedId);
  if (error) {
    console.error("[setInvitedStudentExtraTime] Failed to update invited_students.extra_time:", error.message, error.code);
    throw new Error(`Failed to save invited extra time: ${error.message}`);
  }
  revalidatePath("/dashboard/students");
}

import { createClient } from "@/lib/supabase/server";
import { requireTeacher } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function addManualInvite(formData: FormData) {
  await requireTeacher();
  const supabase = await createClient();

  const email = (formData.get("email") as string)?.trim().toLowerCase();
  const fullNameInput = (formData.get("full_name") as string)?.trim();
  const courseId = formData.get("course_id") as string;

  if (!email || !courseId) {
    return { error: "Email and course are required." };
  }

  if (!email.endsWith("@amersol.edu.pe")) {
    return { error: "Manual invite must use an @amersol.edu.pe student email." };
  }

  const fullName = fullNameInput || email.split("@")[0];
  const firstName = fullName.split(/\s+/)[0];

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
    return { error: inviteError.message };
  }

  // Set nickname to first name only if not already set
  await supabase
    .from("invited_students")
    .update({ nickname: firstName })
    .eq("email", email)
    .eq("course_id", courseId)
    .is("nickname", null);

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
      return { error: `Invited, but enrollment failed: ${enrollError.message}` };
    }

    await supabase
      .from("invited_students")
      .update({ registered: true, profile_id: profile.id })
      .eq("email", email)
      .eq("course_id", courseId);
  }

  revalidatePath("/dashboard/students");

  const inviteParams = new URLSearchParams({
    redirectTo: "/dashboard/student-start",
    invitedEmail: email,
  });

  return {
    success: true,
    inviteLink: `/login?${inviteParams.toString()}`,
  };
}

export async function removeStudent(formData: FormData) {
  await requireTeacher();
  const supabase = await createClient();

  const studentId = formData.get("student_id") as string;
  if (!studentId) return;

  await supabase.from("students").delete().eq("id", studentId);
  revalidatePath("/dashboard/students");
}

export async function removeInvitedStudent(formData: FormData) {
  await requireTeacher();
  const supabase = await createClient();

  const invitedId = formData.get("invited_id") as string;
  if (!invitedId) return;

  await supabase.from("invited_students").delete().eq("id", invitedId);
  revalidatePath("/dashboard/students");
}

export async function setStudentHidden(formData: FormData) {
  await requireTeacher();
  const supabase = await createClient();

  const studentId = formData.get("student_id") as string;
  const hidden = (formData.get("hidden") as string) === "true";
  if (!studentId) return;

  await supabase.from("students").update({ hidden }).eq("id", studentId);
  revalidatePath("/dashboard/students");
  revalidatePath("/dashboard/courses");
}

export async function setInvitedStudentHidden(formData: FormData) {
  await requireTeacher();
  const supabase = await createClient();

  const invitedId = formData.get("invited_id") as string;
  const hidden = (formData.get("hidden") as string) === "true";
  if (!invitedId) return;

  await supabase.from("invited_students").update({ hidden }).eq("id", invitedId);
  revalidatePath("/dashboard/students");
  revalidatePath("/dashboard/courses");
}

export async function updateNickname(formData: FormData) {
  await requireTeacher();
  const supabase = await createClient();

  const profileId = formData.get("profile_id") as string;
  const nickname = (formData.get("nickname") as string)?.trim() ?? "";

  if (!profileId) return;

  const { error } = await supabase.rpc("teacher_set_profile_nickname", {
    p_profile_id: profileId,
    p_nickname: nickname,
  });
  if (error) {
    console.error("[updateNickname] RPC error:", error.message);
    throw new Error(`Failed to save nickname: ${error.message}`);
  }
  revalidatePath("/dashboard/students");
}

export async function updateInvitedNickname(formData: FormData) {
  await requireTeacher();
  const supabase = await createClient();

  const invitedId = formData.get("invited_id") as string;
  const nickname = (formData.get("nickname") as string)?.trim() ?? "";

  if (!invitedId) return;

  const { error } = await supabase.rpc("teacher_set_invited_nickname", {
    p_invited_id: invitedId,
    p_nickname: nickname,
  });
  if (error) {
    console.error("[updateInvitedNickname] RPC error:", error.message);
    throw new Error(`Failed to save nickname: ${error.message}`);
  }
  revalidatePath("/dashboard/students");
}

export async function updateDisplayName(formData: FormData) {
  await requireTeacher();
  const supabase = await createClient();

  const profileId = formData.get("profile_id") as string;
  const displayName = (formData.get("display_name") as string)?.trim();
  if (!profileId || !displayName) return;

  const { error } = await supabase.rpc("teacher_set_profile_display_name", {
    p_profile_id: profileId,
    p_display_name: displayName,
  });
  if (error) {
    console.error("[updateDisplayName] RPC error:", error.message);
    throw new Error(`Failed to save name: ${error.message}`);
  }
  revalidatePath("/dashboard/students");
}

export async function updateInvitedFullName(formData: FormData) {
  await requireTeacher();
  const supabase = await createClient();

  const invitedId = formData.get("invited_id") as string;
  const fullName = (formData.get("full_name") as string)?.trim();
  if (!invitedId || !fullName) return;

  const { error } = await supabase.rpc("teacher_set_invited_full_name", {
    p_invited_id: invitedId,
    p_full_name: fullName,
  });
  if (error) {
    console.error("[updateInvitedFullName] RPC error:", error.message);
    throw new Error(`Failed to save name: ${error.message}`);
  }
  revalidatePath("/dashboard/students");
}
