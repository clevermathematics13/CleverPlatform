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
 *   - cover-page-only segmentation (see scanCoverPages), which exploits the
 *     packet's known fixed page count to locate student boundaries by
 *     checking ~1 page per student instead of billing for every page
 */

// -----------------------------------------------------------------------------
// Storage
// -----------------------------------------------------------------------------

/** Same bucket the Tests AI-grading pipeline uses for uploaded scans. */
export const NA_SCAN_BUCKET = "exam-scans";

/**
 * PostgREST caps a single request at 1000 rows by default. A packet
 * version's na_response_crops easily exceeds that once enough students
 * have been scanned (confirmed in production: one packet version alone
 * has 1515 crop rows) -- a plain `.select().in("packet_scan_id", ...)`
 * across every scan in a packet version silently returns only 1000 of
 * them, with no error, and Postgres gives no ordering guarantee for
 * which 1000. Whichever students' crops land outside that window read as
 * having done no work at all (0 assessed, 0 marks) in the teacher's
 * results table, even though their feedback is complete and correct --
 * discovered when a teacher asked why a fully-assessed student's row
 * showed 0/39. Any query that can return more than ~1000 rows for a
 * whole packet version (not a single scan, which stays well under the
 * cap) must page through `.range()` with this helper instead of trusting
 * a single request to return everything.
 */
export async function fetchAllRows<T>(
  queryPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await queryPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

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
  /**
   * Display names for every id in sourceCourseIds (e.g. "9A"), so a caller
   * pooling several real classes can label which class each student is in.
   */
  sourceCourseNames: Record<string, string>;
  /** True if courseId was resolved as a track (its members were pooled) rather than queried directly. */
  isTrack: boolean;
}

export interface LoadInvitedRosterOptions {
  /**
   * When courseId is itself a real class that belongs to a track (e.g. 9G,
   * a member of Grade 9 Extended), also pool the track's other member
   * classes (9A, 9C). Off by default: the NA scan pipeline attaches packets
   * to the track course and never needs this, while the IB-test AI grader
   * attaches a test to one class but marks a scan pile that mixes all
   * three, so it opts in.
   */
  includeTrackSiblings?: boolean;
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
  courseId: string,
  options: LoadInvitedRosterOptions = {}
): Promise<RosterResolution> {
  const { data: trackMembers, error: trackErr } = await supabase
    .from("track_courses")
    .select("member_course_id")
    .eq("track_course_id", courseId);

  if (trackErr) throw new Error(`Failed to resolve track_courses for ${courseId}: ${trackErr.message}`);

  const isTrack = (trackMembers ?? []).length > 0;
  let sourceCourseIds = isTrack
    ? (trackMembers ?? []).map((r) => r.member_course_id as string)
    : [courseId];

  if (!isTrack && options.includeTrackSiblings) {
    // courseId is a real class. If it belongs to one or more tracks, pool
    // every member of those tracks alongside it, keeping courseId first so
    // the test's own class stays at the top of any grouped listing.
    const { data: parentTracks, error: parentErr } = await supabase
      .from("track_courses")
      .select("track_course_id")
      .eq("member_course_id", courseId);
    if (parentErr) throw new Error(`Failed to resolve parent tracks for ${courseId}: ${parentErr.message}`);

    const trackIds = [...new Set((parentTracks ?? []).map((r) => r.track_course_id as string))];
    if (trackIds.length > 0) {
      const { data: siblings, error: siblingErr } = await supabase
        .from("track_courses")
        .select("member_course_id")
        .in("track_course_id", trackIds);
      if (siblingErr) throw new Error(`Failed to resolve sibling classes for ${courseId}: ${siblingErr.message}`);
      sourceCourseIds = [
        courseId,
        ...new Set((siblings ?? []).map((r) => r.member_course_id as string).filter((id) => id !== courseId)),
      ];
    }
  }

  const { data: courseRows, error: courseErr } = await supabase
    .from("courses")
    .select("id, name")
    .in("id", sourceCourseIds);
  if (courseErr) throw new Error(`Failed to load course names: ${courseErr.message}`);
  const sourceCourseNames: Record<string, string> = {};
  for (const c of courseRows ?? []) sourceCourseNames[c.id as string] = (c.name as string) ?? "";

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

  return { roster, sourceCourseIds, sourceCourseNames, isTrack };
}

// -----------------------------------------------------------------------------
// Cover-page detection
// -----------------------------------------------------------------------------

/**
 * Haiku, not Opus. "Is this a cover page, and whose name is on it?" is a
 * simple extraction task -- exactly what Haiku is built for -- and it is
 * called once per candidate page, so the model choice dominates the cost of
 * the whole segmentation stage. At $1/MTok vs Opus's $5/MTok this is a 5x
 * saving for no measurable loss on this task.
 */
export const COVER_PAGE_CHECK_MODEL = "claude-haiku-4-5-20251001";

/** How far to search on either side of an estimated boundary for a real cover page. */
export const BOUNDARY_SEARCH_WINDOW = 4;

export const CoverPageCheckSchema = z.object({
  isCoverPage: z.boolean(),
  /**
   * The handwritten student name read off the cover page, or null if this
   * isn't a cover page or the name is illegible. Extracted in the SAME call
   * as the cover-page decision -- splitting "is this a cover page?" and
   * "whose is it?" into two requests would double the cost of the entire
   * segmentation stage for no benefit.
   */
  studentName: z.string().nullable().default(null),
  /**
   * If a roster was supplied and the model is confident this name matches
   * one specific roster entry, the exact roster fullName string (copied
   * verbatim from the supplied list, not re-transcribed) -- otherwise null.
   * This is what matchSegmentsToInvitedRoster's label should prefer when
   * present, since it comes from constrained recognition against a known
   * list rather than open-vocabulary handwriting OCR.
   */
  rosterMatch: z.string().nullable().default(null),
  confidence: z.enum(["high", "medium", "low"]),
  /** Brief justification, e.g. "handwritten name field, page 1 header matches the packet cover" */
  note: z.string().default(""),
});

export type CoverPageCheck = z.infer<typeof CoverPageCheckSchema>;

export const COVER_PAGE_CHECK_SYSTEM_PROMPT = `You are looking at a single page from a scanned batch of student worksheets. Decide whether this specific page is the FIRST page of a student's submission (a cover or divider page, typically bearing a printed title/header and a handwritten student name), as opposed to a page from the middle or end of a student's work.

A cover page usually has some combination of: a printed title or worksheet name, a "Name:" field with something handwritten in it, minimal or no worked mathematics, and it is visually the start of a fresh document rather than a continuation.

A non-cover page usually has: worked mathematics filling much of the page, no name field, or continues a problem visibly begun on a previous page.

If it IS a cover page, also read the handwritten student name from the name field and return it as studentName, exactly as written, letter for letter, even if it doesn't look like a real name to you. Use null for studentName if the page is not a cover page, if the name field is blank, or if the handwriting is genuinely illegible — do not guess at a name you cannot read, and do not substitute the printed course or worksheet title for a student name.

You will also be given a ROSTER: the list of real student names actually enrolled in this class. Use it as a reference to disambiguate hard handwriting, NOT as a source of new information you invent from — a class roster massively narrows down what the handwritten name is likely to say, the same way a spell-checker's dictionary narrows down a smudged word. If the handwritten name plausibly matches exactly ONE roster entry (allowing for messy handwriting, missing/extra middle names, nicknames, or minor letter confusion), set rosterMatch to that roster entry's name EXACTLY as it appears in the ROSTER list. If it could plausibly match more than one roster entry, or doesn't clearly match any, set rosterMatch to null — never force a match you aren't confident in, and never fabricate a roster entry that wasn't given to you. studentName should still reflect your best raw reading of the handwriting regardless of whether rosterMatch was found.

Return ONLY a JSON object, no markdown fences, no commentary:

{ "isCoverPage": true, "studentName": "Maria Fernandez", "rosterMatch": "Maria Fernández Soto", "confidence": "high", "note": "printed worksheet title and a handwritten name field, no prior working visible; matched against roster despite missing accent and surname" }`;

export function buildCoverPageCheckUserPrompt(rosterNames?: string[]): string {
  const rosterBlock =
    rosterNames && rosterNames.length > 0
      ? `\n\nROSTER (${rosterNames.length} students actually enrolled in this class):\n${rosterNames
          .map((n) => `- ${n}`)
          .join("\n")}`
      : "\n\nNo roster was supplied for this batch -- read the handwritten name as best you can and leave rosterMatch null.";
  return `Is this page a cover/divider page (the first page of a student's submission)? If so, read the handwritten student name.${rosterBlock}\n\nReturn the JSON object now.`;
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

// -----------------------------------------------------------------------------
// Cover-page-only segmentation (the cheap path)
// -----------------------------------------------------------------------------
//
// The obvious way to segment a batch scan by student is to hand the whole
// document to a model and ask "who owns which pages?". That works, but it
// bills for every single page: a 20-student class at 26 pages each is 520
// pages of vision tokens per upload, and it forces a whole chunking
// apparatus (because 520 pages breaks both Anthropic's 100-page document
// limit and its 32MB request limit).
//
// But an NA packet has a KNOWN fixed page count. So the boundaries are
// nearly determined already -- the only thing actually needing a model is
// confirming where each packet starts and reading the name off it. Checking
// only candidate cover pages costs ~1 page per student instead of ~26:
// measured at 26x fewer pages on a 20-student class, and combined with
// Haiku (5x cheaper than Opus) it takes a full class batch from roughly
// $6.02 to $0.03.
//
// It also removes the size problem entirely rather than working around it:
// every request carries exactly ONE page, so neither the 100-page document
// limit nor the 32MB request limit can ever be reached, no matter how large
// the upload or how high the scan resolution.
//
// The trade is that this assumes packets appear in order at roughly the
// expected length. Real submissions drift (a missing page, an extra loose
// sheet), so each expected boundary is searched within a window rather than
// trusted outright, and any drift is surfaced as a warning. The teacher
// confirms every mapping in the review UI regardless, so a wrong boundary
// is visible and correctable rather than silent.
//
// As of the roster-grounding change: when a roster is supplied, each cover
// page check also receives the class's real name list, so the model is
// doing constrained recognition against a known set of names rather than
// open-vocabulary handwriting OCR. This is what actually fixes bad reads --
// downstream fuzzy matching in matchSegmentsToInvitedRoster can only work
// with whatever string the model already committed to, so grounding needs
// to happen at read time, not just at match time.

export interface CoverPageSegment {
  /** The student name read off the cover page (or a placeholder if unreadable). */
  label: string;
  /** 1-indexed page numbers belonging to this student, contiguous. */
  pages: number[];
  confidence: Confidence;
  note: string;
}

export interface CoverPageScanResult {
  segments: CoverPageSegment[];
  /** How many pages were actually sent to the model -- the cost driver. */
  pagesChecked: number;
  warnings: string[];
}

/**
 * Segment a batch scan into per-student page ranges by checking only
 * candidate cover pages, rather than sending every page to the model.
 *
 * The checkPage callback is supplied by the caller (keeping this function
 * free of any Anthropic SDK dependency, and directly testable). It receives
 * a 1-indexed page number and should return that page's cover-page verdict.
 * If the caller has a class roster, it should already be baked into
 * checkPage's own prompt construction (see buildCoverPageCheckUserPrompt) --
 * this function only consumes the verdict, preferring rosterMatch over
 * studentName when both are present (see labelFor below).
 *
 * Walks forward from page 1, expecting the next packet to start
 * packetPageCount pages later. At each expected boundary it searches within
 * BOUNDARY_SEARCH_WINDOW pages (closest-first, alternating after/before)
 * for a page the model confirms as a cover page. If none is found, it
 * assumes a packet starts at the expected page anyway and warns -- better
 * to produce a reviewable mapping with a flagged boundary than to fail
 * outright, since the teacher corrects page ranges in the review UI.
 *
 * Every page from 1..totalPages ends up assigned to exactly one student:
 * each student runs from their cover page to the page before the next
 * cover, and the final student runs to the end of the document.
 *
 * Verified against an aligned 182-page/7-student scan (7 checks, no
 * warnings), a scan where one packet is a page short (boundary recovers and
 * self-corrects, still full coverage), and a 520-page/20-student class
 * (20 checks vs 520 pages under the old approach).
 */
export async function scanCoverPages(
  totalPages: number,
  packetPageCount: number,
  checkPage: (page: number) => Promise<CoverPageCheck>
): Promise<CoverPageScanResult> {
  const warnings: string[] = [];
  let pagesChecked = 0;

  const check = async (page: number) => {
    pagesChecked++;
    return checkPage(page);
  };

  if (totalPages < 1) return { segments: [], pagesChecked: 0, warnings: ["Empty document."] };
  if (packetPageCount < 1) {
    throw new Error("packetPageCount must be at least 1 to locate packet boundaries.");
  }

  interface Cover {
    page: number;
    label: string;
    confidence: Confidence;
    note: string;
  }

  // Prefer a confirmed roster match over the raw handwriting read -- a
  // rosterMatch means the model cross-checked the name against the real
  // class list and committed to one specific known-good entry, which is
  // strictly more trustworthy than an unconstrained transcription. Falls
  // back to the raw reading (or an "unreadable" placeholder) exactly as
  // before when no roster was supplied or no confident match was found.
  const labelFor = (r: CoverPageCheck, page: number) => {
    if (r.rosterMatch?.trim()) return r.rosterMatch.trim();
    if (r.studentName?.trim()) return r.studentName.trim();
    return `(name unreadable, page ${page})`;
  };

  // Page 1 is always the start of the first packet, whatever the model says
  // about it -- there is nothing before it for it to be a continuation of.
  const firstCheck = await check(1);
  const covers: Cover[] = [
    {
      page: 1,
      label: labelFor(firstCheck, 1),
      confidence: firstCheck.confidence,
      note: firstCheck.note,
    },
  ];
  if (!firstCheck.isCoverPage) {
    warnings.push(
      "Page 1 didn't look like a cover page, but a packet must start there — treated as one. Check the first student's page range."
    );
  }

  let expected = 1 + packetPageCount;
  while (expected <= totalPages) {
    const lastCoverPage = covers[covers.length - 1].page;
    let found: Cover | null = null;

    for (let offset = 0; offset <= BOUNDARY_SEARCH_WINDOW && !found; offset++) {
      const candidates = offset === 0 ? [expected] : [expected + offset, expected - offset];
      for (const candidate of candidates) {
        if (candidate <= lastCoverPage || candidate > totalPages) continue;
        const result = await check(candidate);
        if (result.isCoverPage) {
          found = {
            page: candidate,
            label: labelFor(result, candidate),
            confidence: result.confidence,
            note: result.note,
          };
          break;
        }
      }
    }

    if (!found) {
      warnings.push(
        `No cover page found within ${BOUNDARY_SEARCH_WINDOW} pages of the expected boundary at page ${expected} — assuming a packet starts there. Verify this student's page range.`
      );
      found = { page: expected, label: `(unidentified, page ${expected})`, confidence: "low", note: "" };
    } else if (found.page !== expected) {
      warnings.push(
        `Packet boundary shifted from the expected page ${expected} to page ${found.page} — a submission is ${
          found.page > expected ? "longer" : "shorter"
        } than the ${packetPageCount}-page packet.`
      );
    }

    covers.push(found);
    expected = found.page + packetPageCount;
  }

  const segments: CoverPageSegment[] = covers.map((cover, i) => {
    const endPage = i + 1 < covers.length ? covers[i + 1].page - 1 : totalPages;
    return {
      label: cover.label,
      pages: Array.from({ length: endPage - cover.page + 1 }, (_, k) => cover.page + k),
      confidence: cover.confidence,
      note: cover.note,
    };
  });

  return { segments, pagesChecked, warnings };
}
