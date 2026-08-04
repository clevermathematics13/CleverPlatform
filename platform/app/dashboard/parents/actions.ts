"use server";

import { createClient } from "@/lib/supabase/server";
import { requireTeacher } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function linkParent(
  _prev: { error?: string; success?: boolean; message?: string } | null,
  formData: FormData
) {
  await requireTeacher();
  const supabase = await createClient();

  const parentEmail = (formData.get("parent_email") as string)?.trim().toLowerCase();
  const studentId = formData.get("student_id") as string;

  if (!parentEmail || !studentId) {
    return { error: "Parent email and student are required." };
  }

  const { data, error } = await supabase
    .rpc("teacher_link_parent", {
      p_parent_email: parentEmail,
      p_student_id: studentId,
    })
    .single<{ parent_profile_id: string; parent_display_name: string | null; already_linked: boolean }>();

  if (error) {
    console.error("[linkParent] RPC error:", error.message);
    return { error: error.message.replace(/^.*?: /, "") };
  }

  revalidatePath("/dashboard/parents");

  if (data?.already_linked) {
    return { success: true, message: `${parentEmail} is already linked to this student.` };
  }

  return {
    success: true,
    message: `Linked ${data?.parent_display_name ?? parentEmail} as a parent.`,
  };
}

export async function unlinkParent(formData: FormData) {
  await requireTeacher();
  const supabase = await createClient();

  const linkId = formData.get("link_id") as string;
  if (!linkId) return;

  const { error } = await supabase.rpc("teacher_unlink_parent", { p_link_id: linkId });
  if (error) {
    console.error("[unlinkParent] RPC error:", error.message);
    throw new Error(`Failed to remove link: ${error.message}`);
  }
  revalidatePath("/dashboard/parents");
}
