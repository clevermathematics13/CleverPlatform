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
  if (error) {
    // Foreign-key restricted tables (tests, archived_tests, archived_saved_exams,
    // placement_tests, na_scan_batches) block hard delete with existing records.
    // Surface a clearer message than the raw Postgres error where possible.
    const isFkViolation = error.code === "23503";
    return {
      error: isFkViolation
        ? "This course still has tests or other records attached, so it can't be deleted. Remove or reassign those first."
        : error.message,
    };
  }

  revalidatePath("/dashboard/courses");
  revalidatePath("/dashboard/archived-courses");
  return { success: true };
}

/**
 * Soft-archives a course: sets archived = true. Archived courses drop out of
 * active course pickers/lists app-wide but remain directly accessible by ID
 * (gradebook, Google Classroom links, etc). Reversible via unarchiveCourse.
 */
export async function archiveCourse(formData: FormData) {
  await requireTeacher();
  const supabase = await createClient();

  const id = formData.get("id") as string;
  if (!id) return { error: "Missing course ID" };

  const { error } = await supabase
    .from("courses")
    .update({ archived: true })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/dashboard/courses");
  revalidatePath("/dashboard/archived-courses");
  revalidatePath("/dashboard/students");
  revalidatePath("/dashboard/gradebook");
  revalidatePath("/dashboard/syllabus");
  revalidatePath("/dashboard/tests");
  return { success: true };
}

/** Reverses archiveCourse: sets archived = false. */
export async function unarchiveCourse(formData: FormData) {
  await requireTeacher();
  const supabase = await createClient();

  const id = formData.get("id") as string;
  if (!id) return { error: "Missing course ID" };

  const { error } = await supabase
    .from("courses")
    .update({ archived: false })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/dashboard/courses");
  revalidatePath("/dashboard/archived-courses");
  revalidatePath("/dashboard/students");
  revalidatePath("/dashboard/gradebook");
  revalidatePath("/dashboard/syllabus");
  revalidatePath("/dashboard/tests");
  return { success: true };
}
