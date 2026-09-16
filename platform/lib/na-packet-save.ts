/**
 * na-packet-save.ts
 * -----------------------------------------------------------------------------
 * Writes one Nuanced Analysis packet row, replacing the existing packet for that
 * (course, section) rather than adding a second one.
 *
 * WHY THIS IS NOT A ONE-LINE .upsert(), which is what it used to be:
 *
 * The uniqueness this route depends on is enforced by a PARTIAL index --
 *   uq_nuanced_analyses_course_section (course_id, section_code)
 *     WHERE course_id IS NOT NULL AND section_code IS NOT NULL
 * -- and Postgres will not infer a partial index as an ON CONFLICT arbiter
 * unless the statement repeats the predicate. PostgREST sends only the column
 * list, so `.upsert(row, { onConflict: "course_id,section_code" })` failed at
 * runtime, every time, with:
 *   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
 * It type-checked and it compiled; it just could never save a packet. A.1 and
 * A.2 were seeded by migration and A.2-P0 inserted directly, so nothing had
 * exercised the Save button on a real packet until B.4.
 *
 * app/api/tests/[id]/paper-layout/anchors/route.ts already answers the same
 * problem the same way (an EXPRESSION index there rather than a partial one --
 * different reason, identical remedy: PostgREST cannot name the arbiter).
 *
 * WHY IT LIVES IN lib/ RATHER THAN IN THE ROUTE: AGENTS.md forbids unit tests
 * for Next.js API routes, so logic left inline in the handler is untestable by
 * policy. That is exactly how the original bug shipped -- and
 * lib/na-packet-edit.test.ts is reduced to reading the route as SOURCE TEXT to
 * check column parity. Here the branching is ordinary library code with real
 * coverage.
 *
 * WHAT THE SPLIT COSTS, and what is done about it. One statement became two
 * round trips with no transaction between them, so three things that
 * INSERT ... ON CONFLICT DO UPDATE handled structurally now need handling:
 *
 *   1. The lookup can FAIL rather than return nothing. A discarded error reads
 *      as "no such row", takes the insert branch, and surfaces as a duplicate-key
 *      500 naming a cause that did not happen -- the original confusing error,
 *      re-spelled and now intermittent. The error is checked.
 *   2. The row can VANISH between the lookup and the update (the manage tab's
 *      delete is one click away). An upsert would have re-inserted it; a bare
 *      .single() would 500 with "Cannot coerce the result to a single JSON
 *      object". The update is allowed to match nothing, and the retry inserts.
 *   3. Two saves of the same section can RACE, both lookups missing. The unique
 *      index still forbids a duplicate row -- it is the backstop, not the
 *      arbiter -- so the loser gets 23505 where an upsert would have quietly
 *      taken the update path. The retry converts that back into the update.
 *
 * Hence at most two attempts: whichever branch loses its race the first time,
 * the second pass sees the world the winner left and takes the other branch.
 * -----------------------------------------------------------------------------
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Columns the route returns to the client after a save. */
export const SAVED_PACKET_COLUMNS = "id, slug, section_code, grade_level, is_published";

export type SavedPacket = {
  id: string;
  slug: string;
  section_code: string;
  grade_level: string | null;
  is_published: boolean;
};

export type PacketSaveResult =
  | { ok: true; packet: SavedPacket; created: boolean }
  | { ok: false; error: string; status: number };

/** Postgres unique-violation. */
const UNIQUE_VIOLATION = "23505";

/**
 * Is this unique violation about the packet's slug rather than its section?
 *
 * `nuanced_analyses.slug` carries its own non-partial UNIQUE, and the slug is
 * derived from the packet's TITLE. Two different sections whose titles slugify
 * the same collide there, and retrying cannot help -- the teacher has to change
 * the title. Worth separating, because Postgres reports whichever index it
 * checked first (the slug one is older, so it usually wins the race to fail),
 * which means a section clash can be reported as a slug clash and vice versa.
 */
function isSlugCollision(error: { message?: string; details?: string | null }): boolean {
  const text = `${error.message ?? ""} ${error.details ?? ""}`;
  return /nuanced_analyses_slug_key|\(slug\)/.test(text);
}

/**
 * Inserts the packet, or replaces the one already saved for its section.
 *
 * `row` must carry the same course_id and section_code passed alongside it;
 * the caller has already validated both (the route checks courseId against a
 * UUID pattern and sectionCode against a grade-specific one), which is what
 * guarantees every row this writes falls inside the partial index's predicate.
 */
export async function savePacketRow(
  supabase: SupabaseClient,
  params: { row: Record<string, unknown>; courseId: string; sectionCode: string },
): Promise<PacketSaveResult> {
  const { row, courseId, sectionCode } = params;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data: existing, error: lookupError } = await supabase
      .from("nuanced_analyses")
      .select("id")
      .eq("course_id", courseId)
      .eq("section_code", sectionCode)
      .maybeSingle();

    // Not optional. RLS filters rows rather than raising, so `error` is the only
    // signal separating "there is no such packet" from "I could not find out".
    if (lookupError) {
      return { ok: false, error: lookupError.message, status: 500 };
    }

    if (existing) {
      const { data, error } = await supabase
        .from("nuanced_analyses")
        .update(row)
        .eq("id", (existing as { id: string }).id)
        .select(SAVED_PACKET_COLUMNS)
        .maybeSingle();

      if (error) {
        if (error.code === UNIQUE_VIOLATION && isSlugCollision(error)) {
          return { ok: false, error: slugCollisionMessage(row), status: 409 };
        }
        return { ok: false, error: error.message, status: 500 };
      }
      // maybeSingle, not single: zero rows means the packet was deleted between
      // the lookup and here, which an upsert would simply have re-inserted.
      if (data) return { ok: true, packet: data as SavedPacket, created: false };
      continue;
    }

    const { data, error } = await supabase
      .from("nuanced_analyses")
      .insert(row)
      .select(SAVED_PACKET_COLUMNS)
      .maybeSingle();

    if (!error) {
      if (data) return { ok: true, packet: data as SavedPacket, created: true };
      return { ok: false, error: "The packet was saved but could not be read back.", status: 500 };
    }
    if (error.code === UNIQUE_VIOLATION) {
      if (isSlugCollision(error)) {
        return { ok: false, error: slugCollisionMessage(row), status: 409 };
      }
      // Someone else saved this section between our lookup and our insert. The
      // next pass finds their row and updates it, which is what the upsert did.
      continue;
    }
    return { ok: false, error: error.message, status: 500 };
  }

  return {
    ok: false,
    error:
      `Another save for section ${sectionCode} completed while this one was in progress. ` +
      `Reopen the packet to see the saved version, then save again if you still need to.`,
    status: 409,
  };
}

function slugCollisionMessage(row: Record<string, unknown>): string {
  const slug = typeof row.slug === "string" ? row.slug : "this packet";
  return (
    `Another packet already uses the address "${slug}", which is derived from the packet's title. ` +
    `Change the title and save again.`
  );
}
