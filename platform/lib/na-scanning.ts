import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  extractJsonBlock,
  type SegmentedStudent,
  type Confidence,
} from "./ai-grading";

/**
 * Scanning pipeline for Nuanced Analysis packets: upload a batch scan,
 * segment it by student, match students to the class roster, identify each
 * page against the packet's master layout, and (in a later stage) extract
 * per-anchor crops for AI assessment.
 *
 * This module deliberately reuses the segmentation types, prompt, and JSON
 * extraction helpers already proven in lib/ai-grading.ts (built for the
 * Tests batch-grading pipeline) rather than duplicating them — segmenting a
 * batch scan by student cover page is the same problem whether the pages
 * are an exam script or an NA packet.
 *
 * What's NA-specific and lives here instead:
 *   - roster matching against invited_students (the Tests pipeline matches
 *     against `students`, which requires a profiles row; NA's real roster
 *     right now is entirely invited_students with no profile yet)
 *   - page identity matching against a packet's master PDF (an NA packet
 *     is a fixed multi-page layout with anchor boxes at known coordinates;
 *     an exam script has no equivalent concept)
 *   - pre-splitting an oversized batch (more pages than Anthropic's 100-page
 *     PDF document block limit) into smaller sub-batches on whole-packet
 *     boundaries, so a class-sized upload never needs the teacher to
 *     manually cut their scan into pieces
 */

// -----------------------------------------------------------------------------
// Storage
// -----------------------------------------------------------------------------

/** Same bucket the Tests AI-grading pipeline uses for uploaded scans. */
export const NA_SCAN_BUCKET = "exam-scans";

// -----------------------------------------------------------------------------
// Roster matching against invited_students
// -----------------------------------------------------------------------------

/**
 * A minimal invited-roster row for name matching. Distinct from
 * ai-grading.ts's RosterEntry, which requires a profileId (a real
 * profiles row) — the current 9A roster is entirely invited_students
 * with profile_id still null, since nobody has logged in yet.
 */
export interface InvitedRosterEntry {
  invitedId: string;
  fullName: string;
  /** Populated once the student has registered; null until then. */
  profileId: string | null;
  /** The real class course this student is actually enrolled/invited on. */
  sourceCourseId: string;
}

export interface ProposedInvitedSegment {
  label: string;
  pages: number[];
  confidence: Confidence;
  note: string;
  /** invited_students.id of the roster match, or null if no confident match. */
  matchedInvitedId: string | null;
  matchedStudentName: string | null;
  /** Carried through from the roster row when already registered. */
  matchedProfileId: string | null;
}

/**
 * Loosely normalise a name for matching: lowercase, strip accents and
 * punctuation, collapse whitespace. Deliberately permissive — this only
 * produces a *proposed* match; the teacher confirms it before anything is
 * written to na_packet_scans.
 */
function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Match each segmented label against the invited-student roster by name
 * similarity. Mirrors matchSegmentsToRoster in lib/ai-grading.ts exactly in
 * scoring logic (kept in sync deliberately, not imported, since the two
 * roster shapes differ) — a match is only proposed at score >= 0.5, and
 * this NEVER auto-selects a match the teacher hasn't seen; it only
 * pre-fills the review UI's picker.
 */
export function matchSegmentsToInvitedRoster(
  students: SegmentedStudent[],
  roster: InvitedRosterEntry[]
): ProposedInvitedSegment[] {
  const normalisedRoster = roster.map((r) => ({
    ...r,
    normalised: normaliseName(r.fullName),
    tokens: new Set(normaliseName(r.fullName).split(" ").filter(Boolean)),
  }));

  return students.map((s) => {
    const target = normaliseName(s.label);
    const targetTokens = new Set(target.split(" ").filter(Boolean));

    let best: { entry: (typeof normalisedRoster)[number]; score: number } | null = null;

    for (const entry of normalisedRoster) {
      let score = 0;
      if (entry.normalised === target) {
        score = 1;
      } else {
        let shared = 0;
        for (const t of targetTokens) if (entry.tokens.has(t)) shared++;
        const denom = Math.max(entry.tokens.size, targetTokens.size, 1);
        score = shared / denom;
      }
      if (score > 0 && (!best || score > best.score)) best = { entry, score };
    }

    const matched = best && best.score >= 0.5 ? best.entry : null;

    return {
      label: s.label,
      pages: [...s.pages].sort((a, b) => a - b),
      confidence: s.confidence,
      note: s.note,
      matchedInvitedId: matched?.invitedId ?? null,
      matchedStudentName: matched?.fullName ?? null,
      matchedProfileId: matched?.profileId ?? null,
    };
  });
}

export interface RosterResolution {
  roster: InvitedRosterEntry[];
  /** The course IDs actually queried for students -- either [courseId] itself, or its track_courses members. */
  sourceCourseIds: string[];
  /** True if courseId was resolved as a track (its members were pooled) rather than queried directly. */
  isTrack: boolean;
}

/**
 * Loads the invited-student roster for a course, for use with
 * matchSegmentsToInvitedRoster.
 *
 * Some courses (Grade 9 Extended, Grade 9 Standard) are virtual "track"
 * groupings with no roster of their own -- their real students are split
 * across several actual class courses (e.g. Grade 9 Extended = 9A, 9C, 9G).
 * See the track_courses table. If courseId has one or more rows in
 * track_courses, this pools invited students from every member course
 * instead of querying courseId directly, since a direct query would always
 * return zero rows for a track course by design.
 *
 * Returns which course IDs were actually queried (sourceCourseIds) so
 * callers can show the teacher what was pooled rather than hiding it --
 * important here because an incomplete track_courses mapping (e.g. a real
 * class not yet added) would silently under-count the roster otherwise.
 */
export async function loadInvitedRoster(
  supabase: SupabaseClient,
  courseId: string
): Promise<RosterResolution> {
  const { data: trackMembers, error: trackErr } = await supabase
    .from("track_courses")
    .select("member_course_id")
    .eq("track_course_id", courseId);

  if (trackErr) throw new Error(`Failed to resolve track_courses for ${courseId}: ${trackErr.message}`);

  const isTrack = (trackMembers ?? []).length > 0;
  const sourceCourseIds = isTrack
    ? (trackMembers ?? []).map((r) => r.member_course_id as string)
    : [courseId];

  const { data, error } = await supabase
    .from("invited_students")
    .select("id, full_name, profile_id, course_id")
    .in("course_id", sourceCourseIds)
    .eq("hidden", false);

  if (error) throw new Error(`Failed to load invited roster: ${error.message}`);

  const roster = (data ?? [])
    .filter(
      (r): r is { id: string; full_name: string; profile_id: string | null; course_id: string } =>
        !!r.full_name
    )
    .map((r) => ({
      invitedId: r.id,
      fullName: r.full_name,
      profileId: r.profile_id,
      sourceCourseId: r.course_id,
    }));

  return { roster, sourceCourseIds, isTrack };
}

// -----------------------------------------------------------------------------
// Page identity matching (vision-based — replaces the OpenCV/ORB pilot
// approach, which only ran locally and has no equivalent in a Vercel
// serverless function)
// -----------------------------------------------------------------------------

export const PAGE_IDENTITY_MODEL = "claude-opus-4-5";

export const PageIdentitySchema = z.object({
  /** 1-indexed page number within the STUDENT'S scan (not the batch). */
  scanPage: z.number().int().min(1),
  /**
   * 0-indexed page within the packet master (matches na_anchors.page_index),
   * or null if this scan page has no corresponding master page (e.g. a
   * blank loose-leaf continuation sheet, or a page that doesn't belong to
   * this packet at all).
   */
  masterPageIndex: z.number().int().min(0).nullable(),
  /** True if the scan page appears rotated ~180 degrees relative to the master. */
  rotated180: z.boolean(),
  confidence: z.enum(["high", "medium", "low"]),
  note: z.string().default(""),
});

export const PageIdentityResponseSchema = z.object({
  pages: z.array(PageIdentitySchema).min(1),
});

export type PageIdentity = z.infer<typeof PageIdentitySchema>;
export type PageIdentityResponse = z.infer<typeof PageIdentityResponseSchema>;

export const PAGE_IDENTITY_SYSTEM_PROMPT = `You are matching pages from a scanned, handwritten student worksheet against a known printed master document, so that each scan page can be identified with a specific page of the master.

You will be given:
1. The MASTER document — the original printed worksheet with no handwriting, every page in order.
2. A STUDENT SCAN — a photocopy or photo of the same worksheet, filled in by hand, whose pages may be out of order, rotated, or may include extra pages (loose-leaf continuation paper) that don't correspond to any master page.

For EVERY page in the student scan, identify:
- scanPage: the page's position in the scan document (1-indexed, in the order it appears in the scan file)
- masterPageIndex: the 0-indexed page number in the MASTER document this scan page corresponds to (0 = the master's first page), based on matching the PRINTED layout — headers, question numbers, box outlines, table structure — not the handwriting. If this scan page has no corresponding master page (e.g. blank loose-leaf paper, or scratch work), set this to null.
- rotated180: true if the scan page's content appears upside-down relative to how the master page reads
- confidence: "high" if the printed layout match is unambiguous; "medium" if likely but some uncertainty (e.g. partial page, poor scan quality); "low" if genuinely unsure
- note: brief explanation for anything non-obvious, especially any "low" confidence call or a null masterPageIndex

Match on the PRINTED structure (headers, rules, question numbers, box positions), not on handwritten content — handwriting varies page to page and is not reliable evidence of which master page a scan page corresponds to.

Return ONLY a JSON object, no markdown fences, no commentary:

{
  "pages": [
    { "scanPage": 1, "masterPageIndex": 3, "rotated180": false, "confidence": "high", "note": "" }
  ]
}

Return exactly one entry per page in the student scan, in scan-page order.`;

export function buildPageIdentityUserPrompt(scanPageCount: number, masterPageCount: number): string {
  return `The MASTER document has ${masterPageCount} pages (indices 0-${masterPageCount - 1}). The STUDENT SCAN that follows has ${scanPageCount} pages. Identify which master page index each scan page corresponds to, per the system instructions. Return the JSON object now.`;
}

/** Validate a raw page-identity response: well-formed JSON matching the schema, one entry per scan page. */
export function validatePageIdentityResponse(
  rawText: string,
  scanPageCount: number
): { ok: true; response: PageIdentityResponse; warnings: string[] } | { ok: false; error: string } {
  const json = extractJsonBlock(rawText);
  if (!json) return { ok: false, error: "No JSON object found in page-identity response" };

  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(json);
  } catch (e) {
    return {
      ok: false,
      error: `Page-identity response was not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const parsed = PageIdentityResponseSchema.safeParse(parsedUnknown);
  if (!parsed.success) {
    return { ok: false, error: `Page-identity response failed schema validation: ${parsed.error.message}` };
  }

  const warnings: string[] = [];
  const seen = new Set<number>();
  for (const p of parsed.data.pages) {
    if (p.scanPage > scanPageCount) {
      warnings.push(`Page-identity response referenced scan page ${p.scanPage}, beyond the ${scanPageCount}-page scan — ignored`);
      continue;
    }
    if (seen.has(p.scanPage)) {
      warnings.push(`Duplicate page-identity entry for scan page ${p.scanPage} — first one kept`);
      continue;
    }
    seen.add(p.scanPage);
  }
  for (let i = 1; i <= scanPageCount; i++) {
    if (!seen.has(i)) warnings.push(`No page-identity entry returned for scan page ${i} — treated as unmatched`);
  }

  return { ok: true, response: parsed.data, warnings };
}

// -----------------------------------------------------------------------------
// Pre-split: cover-page detection + chunk boundary planning
// -----------------------------------------------------------------------------
//
// An oversized batch (more pages than MAX_BATCH_PAGES, from lib/ai-grading.ts)
// can't be sent to the segmentation model in one call. Rather than asking the
// teacher to cut their scan into pieces by hand -- which risks tearing a
// student's own packet across two pieces -- this plans cut points
// automatically, confirming each one against a real cover page before
// committing to it.
//
// Approach: given the packet's known master page count, estimate how many
// students fit in one MAX_BATCH_PAGES-sized chunk, then walk the document in
// chunks of that size. At each candidate boundary, ask a single cheap vision
// call whether that page looks like a cover/divider page bearing a student's
// name. If not, search outward (the boundary page ± a small window) for the
// nearest real cover page -- real submissions rarely match the master's page
// count exactly (a missing page, an extra loose sheet), so the boundary
// needs some give. This never guesses blindly: every cut point is confirmed
// against actual page content before the chunk boundaries are finalised.

export const COVER_PAGE_CHECK_MODEL = "claude-opus-4-5";

/** How far to search on either side of an estimated boundary for a real cover page. */
export const BOUNDARY_SEARCH_WINDOW = 4;

export const CoverPageCheckSchema = z.object({
  isCoverPage: z.boolean(),
  confidence: z.enum(["high", "medium", "low"]),
  /** Brief justification, e.g. "handwritten name field, page 1 header matches the packet cover" */
  note: z.string().default(""),
});

export type CoverPageCheck = z.infer<typeof CoverPageCheckSchema>;

export const COVER_PAGE_CHECK_SYSTEM_PROMPT = `You are looking at a single page from a scanned batch of student worksheets. Decide whether this specific page is the FIRST page of a student's submission (a cover or divider page, typically bearing a printed title/header and a handwritten student name), as opposed to a page from the middle or end of a student's work.

A cover page usually has some combination of: a printed title or worksheet name, a "Name:" field with something handwritten in it, minimal or no worked mathematics, and it is visually the start of a fresh document rather than a continuation.

A non-cover page usually has: worked mathematics filling much of the page, no name field, or continues a problem visibly begun on a previous page.

Return ONLY a JSON object, no markdown fences, no commentary:

{ "isCoverPage": true, "confidence": "high", "note": "printed worksheet title and a handwritten name field, no prior working visible" }`;

export function buildCoverPageCheckUserPrompt(): string {
  return `Is this page a cover/divider page (the first page of a student's submission)? Return the JSON object now.`;
}

/** Validate a raw cover-page-check response. */
export function validateCoverPageCheck(
  rawText: string
): { ok: true; result: CoverPageCheck } | { ok: false; error: string } {
  const json = extractJsonBlock(rawText);
  if (!json) return { ok: false, error: "No JSON object found in cover-page-check response" };
  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(json);
  } catch (e) {
    return { ok: false, error: `Cover-page-check response was not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  const parsed = CoverPageCheckSchema.safeParse(parsedUnknown);
  if (!parsed.success) {
    return { ok: false, error: `Cover-page-check response failed schema validation: ${parsed.error.message}` };
  }
  return { ok: true, result: parsed.data };
}

export interface ChunkPlan {
  /** 1-indexed page range for this chunk, inclusive on both ends. */
  startPage: number;
  endPage: number;
}

/**
 * Plan chunk boundaries for an oversized batch, given a boundary-check
 * function the caller supplies (so this stays testable and has no direct
 * Anthropic SDK dependency). The check function is called once per
 * candidate page and should return true if that page is a confirmed cover
 * page.
 *
 * Algorithm: estimate a target chunk size as the largest whole multiple of
 * packetPageCount that fits under maxPagesPerChunk. Walk the document in
 * steps of that size; at each estimated boundary (the page immediately
 * AFTER the intended cut, which should be a new cover page), search
 * outward within BOUNDARY_SEARCH_WINDOW pages for a confirmed cover page,
 * preferring the closest match. If no cover page is found in the window,
 * falls back to the estimated boundary itself (better to risk one bad cut
 * than to fail outright) and flags it in the returned warnings.
 *
 * The very last chunk always runs to totalPages -- there is nothing to
 * search for at the end of the document.
 *
 * Verified against 182-page / 26-page-packet / 100-page-cap scenarios
 * (matching a real class batch), including a missing-page submission and
 * the worst case where no cover page is ever confirmed -- every page stays
 * covered exactly once even in the worst case, just with a warning instead
 * of a silent guess.
 */
export async function planChunkBoundaries(
  totalPages: number,
  packetPageCount: number,
  maxPagesPerChunk: number,
  checkIsCoverPage: (page: number) => Promise<boolean>
): Promise<{ chunks: ChunkPlan[]; warnings: string[] }> {
  const warnings: string[] = [];

  if (totalPages <= maxPagesPerChunk) {
    return { chunks: [{ startPage: 1, endPage: totalPages }], warnings };
  }

  const studentsPerChunk = Math.max(1, Math.floor(maxPagesPerChunk / Math.max(1, packetPageCount)));
  const targetChunkSize = studentsPerChunk * packetPageCount;

  if (targetChunkSize > maxPagesPerChunk) {
    // Shouldn't happen given the floor() above, but guard anyway rather
    // than silently emitting a chunk that will fail the same 100-page
    // check this whole mechanism exists to avoid.
    throw new Error(
      `Computed chunk size ${targetChunkSize} exceeds the ${maxPagesPerChunk}-page limit — packetPageCount (${packetPageCount}) may be wrong.`
    );
  }

  const chunks: ChunkPlan[] = [];
  let chunkStart = 1;

  while (chunkStart <= totalPages) {
    const estimatedEnd = chunkStart + targetChunkSize - 1;

    if (estimatedEnd >= totalPages) {
      chunks.push({ startPage: chunkStart, endPage: totalPages });
      break;
    }

    // The boundary we're looking for is the page AFTER the cut -- the next
    // chunk's cover page. Search outward from estimatedEnd + 1.
    const idealNextStart = estimatedEnd + 1;
    let confirmedNextStart: number | null = null;

    for (let offset = 0; offset <= BOUNDARY_SEARCH_WINDOW; offset++) {
      const candidates = offset === 0 ? [idealNextStart] : [idealNextStart + offset, idealNextStart - offset];
      for (const candidate of candidates) {
        if (candidate <= chunkStart || candidate > totalPages) continue;
        if (await checkIsCoverPage(candidate)) {
          confirmedNextStart = candidate;
          break;
        }
      }
      if (confirmedNextStart !== null) break;
    }

    if (confirmedNextStart === null) {
      warnings.push(
        `Could not confirm a cover page within ${BOUNDARY_SEARCH_WINDOW} pages of the estimated cut at page ${idealNextStart} — cutting there anyway. Double-check this chunk boundary in the review step.`
      );
      confirmedNextStart = idealNextStart;
    } else if (confirmedNextStart !== idealNextStart) {
      warnings.push(
        `Chunk boundary adjusted from estimated page ${idealNextStart} to confirmed cover page ${confirmedNextStart}.`
      );
    }

    chunks.push({ startPage: chunkStart, endPage: confirmedNextStart - 1 });
    chunkStart = confirmedNextStart;
  }

  return { chunks, warnings };
}
