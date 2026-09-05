import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Which courses' tests belong on a gradebook.
 *
 * A test is attached to exactly one course, but a track (Grade 9 Extended)
 * and its member classes (9A, 9C, 9G) sit one assessment: the AI grader
 * attaches a test to one class and marks a scan pile that mixes all three
 * (see LoadInvitedRosterOptions.includeTrackSiblings). Listing only tests
 * with course_id = the gradebook's own course therefore hid Formative
 * Assessment 1 (attached to 9G) from the 9A and 9C gradebooks, and from
 * the Grade 9 Extended one, so 33 students' accepted marks were visible
 * nowhere. A gradebook shows the tests of every course in its track
 * family instead: for a track, itself and its members; for a class,
 * itself, the tracks it belongs to, and their other members. A class
 * outside any track is unchanged.
 */
export interface TrackLinks {
  /** Member classes when courseId is a track (rows with track_course_id = courseId). */
  members: string[];
  /** Tracks courseId belongs to when it is a class (rows with member_course_id = courseId). */
  parentTracks: string[];
  /** Every member of those parent tracks, courseId possibly included. */
  siblings: string[];
}

/** Pure: the ordered, de-duplicated course ids whose tests a gradebook shows. courseId always comes first. */
export function trackFamilyCourseIds(courseId: string, links: TrackLinks): string[] {
  const ids = [courseId];
  if (links.members.length > 0) ids.push(...links.members);
  else ids.push(...links.parentTracks, ...links.siblings);
  return [...new Set(ids)];
}

export async function loadTrackLinks(supabase: SupabaseClient, courseId: string): Promise<TrackLinks> {
  const { data: memberRows, error: memberErr } = await supabase
    .from("track_courses")
    .select("member_course_id")
    .eq("track_course_id", courseId);
  if (memberErr) throw new Error(`Failed to resolve track_courses for ${courseId}: ${memberErr.message}`);
  const members = (memberRows ?? []).map((r) => r.member_course_id as string);
  if (members.length > 0) return { members, parentTracks: [], siblings: [] };

  const { data: parentRows, error: parentErr } = await supabase
    .from("track_courses")
    .select("track_course_id")
    .eq("member_course_id", courseId);
  if (parentErr) throw new Error(`Failed to resolve parent tracks for ${courseId}: ${parentErr.message}`);
  const parentTracks = [...new Set((parentRows ?? []).map((r) => r.track_course_id as string))];
  if (parentTracks.length === 0) return { members, parentTracks, siblings: [] };

  const { data: siblingRows, error: siblingErr } = await supabase
    .from("track_courses")
    .select("member_course_id")
    .in("track_course_id", parentTracks);
  if (siblingErr) throw new Error(`Failed to resolve sibling classes for ${courseId}: ${siblingErr.message}`);
  const siblings = (siblingRows ?? []).map((r) => r.member_course_id as string);
  return { members, parentTracks, siblings };
}
