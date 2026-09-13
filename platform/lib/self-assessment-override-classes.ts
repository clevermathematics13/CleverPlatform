import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/na-scanning";
import { loadTrackLinks, trackFamilyCourseIds } from "@/lib/track-courses";
import type { OverrideMap } from "@/lib/self-assessment-override-diff";

/** One class that sits this assessment, and what its setting decides. */
export type OverrideClass = {
  courseId: string;
  name: string;
  studentCount: number;
  /** Students here who have not self-graded -- the only ones a release changes
   *  anything for, and so the number worth putting in front of the teacher. */
  notSelfAssessed: number;
};

/**
 * The classes that actually sit this assessment, each with the number its
 * self-assessment setting decides something for.
 *
 * A test hangs off one course but is sat by its whole track family, which is
 * why the per-class override exists at all. The count that matters is not the
 * roster but the students who have NOT self-graded: they are the only ones
 * releasing the gate changes anything for, and showing it turns a toggle into
 * an informed decision about named people.
 *
 * The track course itself (Grade 9 Extended) comes back from the family and is
 * kept, with a zero count -- it is virtual and has no roster by design, and
 * saying so is better than silently dropping a course the teacher can see
 * elsewhere.
 */
export async function loadOverrideClasses(
  supabase: SupabaseClient,
  testId: string,
  courseId: string | null,
  itemIds: string[]
): Promise<{ classes: OverrideClass[]; overrides: OverrideMap }> {
  if (!courseId) return { classes: [], overrides: {} };

  const familyIds = trackFamilyCourseIds(courseId, await loadTrackLinks(supabase, courseId));

  const [{ data: courseRows }, { data: studentRows }, { data: overrideRows }] = await Promise.all([
    supabase.from("courses").select("id, name").in("id", familyIds),
    supabase.from("students").select("profile_id, course_id").in("course_id", familyIds).eq("hidden", false),
    supabase
      .from("test_course_self_assessment")
      .select("course_id, require_self_assessment")
      .eq("test_id", testId),
  ]);

  // Paged: one assessment for a full track is past PostgREST's silent 1000-row
  // cap, and a truncated read here would overstate how many students a release
  // affects -- see the same note in lib/powerschool-rows.ts.
  const selfRows =
    itemIds.length > 0
      ? await fetchAllRows<{ student_id: string }>((from, to) =>
          supabase
            .from("student_self_scores")
            .select("student_id")
            .in("test_item_id", itemIds)
            .not("self_marks", "is", null)
            .order("id", { ascending: true })
            .range(from, to)
        )
      : [];
  const selfAssessed = new Set(selfRows.map((r) => r.student_id));

  const nameById = new Map((courseRows ?? []).map((c) => [c.id as string, c.name as string]));
  const classes: OverrideClass[] = familyIds
    .filter((id) => nameById.has(id))
    .map((id) => {
      const students = (studentRows ?? []).filter((s) => s.course_id === id);
      return {
        courseId: id,
        name: nameById.get(id)!,
        studentCount: students.length,
        notSelfAssessed: students.filter((s) => !selfAssessed.has(s.profile_id as string)).length,
      };
    });

  const overrides: OverrideMap = {};
  for (const row of overrideRows ?? []) {
    overrides[row.course_id as string] = row.require_self_assessment as boolean;
  }

  return { classes, overrides };
}
