/**
 * POST /api/nuanced-analyses  — save a generated Nuanced Analysis packet
 * GET  /api/nuanced-analyses  — list packets, optionally scoped to a course
 *
 * This is the route that closes the generation loop. Until now a packet
 * generated in Assignment Studio could only be saved to `assignment_templates`,
 * which is a draft store: nothing downstream reads it, and nothing about the
 * packet is recorded for the NEXT packet to build on. That is why continuity
 * has had to be maintained by hand.
 *
 * A save here does two things atomically from the caller's point of view:
 *   1. upserts the packet into public.nuanced_analyses, keyed on
 *      (course_id, section_code) so re-saving a section replaces it
 *   2. appends the packet's continuity digest to public.na_continuity
 *
 * The digest is auto-drafted client-side by draftDigestFromDraft() and then
 * confirmed (and edited) by the teacher, so what arrives here is already
 * reviewed. The one field the generator cannot infer — whereItLeftOff, which
 * has to state what the packet deliberately did NOT do — is required, and a
 * request missing it is rejected rather than silently stored empty. An empty
 * handoff is worse than no handoff: it looks like continuity while conveying
 * nothing, and the next generation would trust it.
 */

import { NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import {
  appendPacketDigest,
  normalizeDigest,
  type PacketDigest,
} from "@/lib/na-continuity";
import type { AssignmentDraft } from "@/lib/assignments";

export const runtime = "nodejs";

type SaveBody = {
  courseId?: unknown;
  gradeLevel?: unknown;
  sectionCode?: unknown;
  slug?: unknown;
  draft?: unknown;
  digest?: unknown;
  isPublished?: unknown;
  /** Set false to save the packet without touching continuity. */
  commitContinuity?: unknown;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECTION_RE = /^[A-Z]{1,2}\.\d{1,2}$/;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function GET(req: Request) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const { searchParams } = new URL(req.url);
  const courseId = searchParams.get("courseId");

  let query = supabase
    .from("nuanced_analyses")
    .select(
      "id, slug, title, subtitle, course, course_id, grade_level, section_code, sort_order, is_published, continuity_digest, created_at, updated_at",
    )
    .order("sort_order", { ascending: true });

  if (courseId) {
    if (!UUID_RE.test(courseId)) {
      return NextResponse.json({ error: "courseId must be a UUID" }, { status: 400 });
    }
    query = query.eq("course_id", courseId);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ packets: data ?? [] }, { status: 200 });
}

export async function POST(req: Request) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, profile } = auth;

  let body: SaveBody;
  try {
    body = (await req.json()) as SaveBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // -- Validate --------------------------------------------------------

  const courseId = typeof body.courseId === "string" ? body.courseId : "";
  if (!UUID_RE.test(courseId)) {
    return NextResponse.json({ error: "courseId is required and must be a UUID" }, { status: 400 });
  }

  const sectionCode = typeof body.sectionCode === "string" ? body.sectionCode.trim() : "";
  if (!SECTION_RE.test(sectionCode)) {
    return NextResponse.json(
      { error: "sectionCode is required and must look like 'A.1' or 'B.4'" },
      { status: 400 },
    );
  }

  const gradeLevel = typeof body.gradeLevel === "string" ? body.gradeLevel.trim() : "";
  if (!gradeLevel) {
    return NextResponse.json({ error: "gradeLevel is required" }, { status: 400 });
  }

  if (!body.draft || typeof body.draft !== "object") {
    return NextResponse.json({ error: "draft is required" }, { status: 400 });
  }
  const draft = body.draft as AssignmentDraft;
  if (!draft.title || !Array.isArray(draft.sections)) {
    return NextResponse.json(
      { error: "draft must have a title and a sections array" },
      { status: 400 },
    );
  }

  const commitContinuity = body.commitContinuity !== false;

  let digest: PacketDigest | null = null;
  if (commitContinuity) {
    digest = normalizeDigest(body.digest);
    if (!digest) {
      return NextResponse.json(
        { error: "digest is required when committing continuity" },
        { status: 400 },
      );
    }
    if (!digest.whereItLeftOff.trim()) {
      return NextResponse.json(
        {
          error:
            "digest.whereItLeftOff is required. State where this packet ended AND what it deliberately did not do, so the next packet does not pre-empt it.",
        },
        { status: 400 },
      );
    }
    // The digest's section must match the packet's, or continuity and the
    // packet table would disagree about what this section taught.
    if (digest.section !== sectionCode) {
      return NextResponse.json(
        { error: `digest.section (${digest.section}) does not match sectionCode (${sectionCode})` },
        { status: 400 },
      );
    }
  }

  const slug =
    (typeof body.slug === "string" && slugify(body.slug)) ||
    digest?.slug ||
    slugify(draft.title);

  if (!slug) {
    return NextResponse.json({ error: "Could not derive a slug from the packet" }, { status: 400 });
  }

  // -- Upsert the packet ------------------------------------------------
  // onConflict targets the (course_id, section_code) partial unique index added
  // in migration 058, so re-saving a section replaces it instead of creating a
  // second row that would then be counted twice in continuity.

  const row = {
    slug,
    title: draft.title,
    subtitle: draft.subtitle ?? null,
    course: draft.course ?? `${gradeLevel} Mathematics`,
    course_id: courseId,
    owner_id: profile.id,
    grade_level: gradeLevel,
    section_code: sectionCode,
    syllabus_topics: draft.syllabusTopics ? [draft.syllabusTopics] : [],
    prerequisites: draft.prerequisites ? [draft.prerequisites] : [],
    materials: draft.materials ?? null,
    atl_statement: draft.atl ?? null,
    vocabulary: draft.commandTerms ?? [],
    tok_provocations: draft.tokProvocations ?? [],
    parts: draft.sections,
    draft_content: draft,
    continuity_digest: digest ?? null,
    is_published: body.isPublished === true,
  };

  const { data: saved, error: saveError } = await supabase
    .from("nuanced_analyses")
    .upsert(row, { onConflict: "course_id,section_code" })
    .select("id, slug, section_code, grade_level, is_published")
    .single();

  if (saveError) {
    return NextResponse.json({ error: saveError.message }, { status: 500 });
  }

  // -- Commit continuity ------------------------------------------------
  // Reported separately rather than rolled back: the packet is saved and the
  // teacher should not lose it because the continuity write failed. The
  // response makes the partial state explicit so the UI can offer a retry.

  if (!commitContinuity || !digest) {
    return NextResponse.json({ packet: saved, continuity: "skipped" }, { status: 200 });
  }

  const result = await appendPacketDigest(supabase, courseId, digest);
  if (!result.ok) {
    return NextResponse.json(
      { packet: saved, continuity: "failed", continuityError: result.error },
      { status: 207 },
    );
  }

  return NextResponse.json({ packet: saved, continuity: "committed" }, { status: 200 });
}
