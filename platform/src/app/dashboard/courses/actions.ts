"use server";

import { createClient } from "@/lib/supabase/server";
import { requireTeacher } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function createCourse(formData: FormData) {
  await requireTeacher();
  const supabase = await createClient();

  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim() || null;

  if (!name) return { error: "Course name is required" };

  const { error } = await supabase.from("courses").insert({ name, description });
  if (error) return { error: error.message };

  revalidatePath("/dashboard/courses");
  return { success: true };
}

export async function updateCourse(formData: FormData) {
  await requireTeacher();
  const supabase = await createClient();

  const id = formData.get("id") as string;
  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim() || null;

  if (!id) return { error: "Missing course ID" };
  if (!name) return { error: "Course name is required" };

  const { error } = await supabase
    .from("courses")
    .update({ name, description })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/dashboard/courses");
  return { success: true };
}

export async function deleteCourse(formData: FormData) {
  await requireTeacher();
  const supabase = await createClient();

  const id = formData.get("id") as string;
  if (!id) return { error: "Missing course ID" };

  const { error } = await supabase.from("courses").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/courses");
  return { success: true };
}
