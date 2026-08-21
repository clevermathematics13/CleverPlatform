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

/** Loads the invited-student roster for a course, for use with matchSegmentsToInvitedRoster. */
export async function loadInvitedRoster(
  supabase: SupabaseClient,
  courseId: string
): Promise<InvitedRosterEntry[]> {
  const { data, error } = await supabase
    .from("invited_students")
    .select("id, full_name, profile_id")
    .eq("course_id", courseId)
    .eq("hidden", false);

  if (error) throw new Error(`Failed to load invited roster: ${error.message}`);

  return (data ?? [])
    .filter((r): r is { id: string; full_name: string; profile_id: string | null } => !!r.full_name)
    .map((r) => ({ invitedId: r.id, fullName: r.full_name, profileId: r.profile_id }));
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
