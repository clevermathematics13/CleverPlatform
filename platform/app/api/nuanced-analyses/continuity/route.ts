/**
 * GET /api/nuanced-analyses/continuity?courseId=…&section=A.3
 *
 * Returns the course's continuity record plus that record rendered as the
 * prompt block the generator prepends to its system prompt.
 *
 * This exists as a route rather than a client-side query because the rendering
 * logic in buildContinuityContext() is what makes prior packets actually bind
 * on generation — the ordering of the prohibition list, the "do not pre-empt a
 * later section" instruction, the handling of prep that already shipped. That
 * logic must stay in one place; a client that assembled its own version would
 * drift from it silently and the drift would only ever show up as a duplicated
 * TOK question in a printed packet.
 *
 * A course with no continuity row yet returns an empty context and 200, not a
 * 404 — the first packet in a course is a normal state, not a missing resource.
 */

import { NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { buildContinuityContext, loadContinuity } from "@/lib/na-continuity";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const { searchParams } = new URL(req.url);
  const courseId = searchParams.get("courseId") ?? "";
  const section = searchParams.get("section") ?? undefined;

  if (!UUID_RE.test(courseId)) {
    return NextResponse.json({ error: "courseId is required and must be a UUID" }, { status: 400 });
  }

  const record = await loadContinuity(supabase, courseId);
  const context = buildContinuityContext(record, section);

  // nextSection is a convenience for the UI's section picker: the first entry
  // in the spine that is not yet marked done.
  const nextSection =
    record?.unitSequence.find((u) => u.status !== "done")?.section ?? null;

  return NextResponse.json(
    {
      hasContinuity: record !== null && record.packets.length > 0,
      packetCount: record?.packets.length ?? 0,
      unitSequence: record?.unitSequence ?? [],
      nextSection,
      context,
    },
    { status: 200 },
  );
}
