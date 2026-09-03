import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Whether the teacher has opted to see hidden roster rows (e.g. the
 * pcleveng/paulsclevenger test-account enrolments) in student counts and
 * lists. Defaults to false -- hidden rows stay out of sight unless toggled
 * on in Settings.
 */
export async function getShowHiddenStudents(
  supabase: SupabaseClient,
  teacherId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("teacher_settings")
    .select("show_hidden_students")
    .eq("teacher_id", teacherId)
    .maybeSingle();
  return data?.show_hidden_students ?? false;
}
