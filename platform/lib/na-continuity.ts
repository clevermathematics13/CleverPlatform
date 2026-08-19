/**
 * Nuanced Analysis — continuity layer
 * -----------------------------------
 * A Nuanced Analysis packet is never standalone. Packet A.3 has to know that
 * A.1 already spent the al-Khwarizmi international-mindedness note, that A.2
 * already planted the "division is commutative" misconception, and that the
 * Chris pants-and-shirts warm-up printed in the A.3 source book was already
 * burned as A.2 Q12. Without that, every generated packet silently repeats
 * itself and the spine stops being a spine.
 *
 * `public.na_continuity` holds one row per course:
 *   - unit_sequence: the full planned scope and sequence (the spine)
 *   - packets:       a growing array of per-packet digests, in teaching order
 *
 * This module is the only place that reads or writes that table. It exposes:
 *   - loadContinuity()          → the raw typed record
 *   - buildContinuityContext()  → that record rendered as a prompt block
 *   - appendPacketDigest()      → commit one packet's digest after a save
 *   - draftDigestFromDraft()    → auto-draft a digest from an AssignmentDraft,
 *                                 for the teacher to confirm before committing
 *
 * Nothing here throws on a missing row: a course with no continuity record yet
 * is a legitimate first-packet state, and generation must still work.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssignmentDraft } from "@/lib/assignments";

// -- Types --------------------------------------------------------------------

/** One entry in the planned scope and sequence. */
export type UnitSequenceEntry = {
  section: string;
  title: string;
  status: "done" | "next" | "planned";
  /** Free-text warning carried forward, e.g. a source problem already used. */
  prepNote?: string;
  /** True when this section's pre-class prep already shipped in a prior bundle. */
  prepAlreadyShipped?: boolean;
};

/** The compact record of what one packet actually taught. */
export type PacketDigest = {
  section: string;
  slug: string;
  title: string;
  /**
   * The single most load-bearing field. Prose describing where the packet
   * ended AND — just as importantly — what it deliberately did NOT do, so the
   * next packet does not pre-empt a skill reserved for it.
   */
  whereItLeftOff: string;
  vocabularyIntroduced: string[];
  notationConventions: string[];
  tokProvocationsUsed: string[];
  misconceptionsPlanted: string[];
  internationalMindednessUsed: string[];
  /** Contexts, scenarios, or source problems now spent and not to be reused. */
  contentSpent?: string[];
};

export type ContinuityRecord = {
  courseId: string;
  unitSequence: UnitSequenceEntry[];
  packets: PacketDigest[];
};

// -- snake_case ↔ camelCase ---------------------------------------------------
// The JSONB in na_continuity was authored by hand in snake_case. Rather than
// migrate the stored shape (and risk breaking a record that is currently the
// only source of truth for two shipped packets), normalise on read and
// denormalise on write. Both spellings are accepted on read so hand-edits in
// the Supabase table editor never silently drop a field.

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function pick(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null) return row[k];
  }
  return undefined;
}

export function normalizeDigest(raw: unknown): PacketDigest | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const section = str(pick(row, "section"));
  if (!section) return null;

  return {
    section,
    slug: str(pick(row, "slug")),
    title: str(pick(row, "title")),
    whereItLeftOff: str(pick(row, "whereItLeftOff", "where_it_left_off")),
    vocabularyIntroduced: strArray(pick(row, "vocabularyIntroduced", "vocabulary_introduced")),
    notationConventions: strArray(pick(row, "notationConventions", "notation_conventions")),
    tokProvocationsUsed: strArray(pick(row, "tokProvocationsUsed", "tok_provocations_used")),
    misconceptionsPlanted: strArray(pick(row, "misconceptionsPlanted", "misconceptions_planted")),
    internationalMindednessUsed: strArray(
      pick(row, "internationalMindednessUsed", "international_mindedness_used"),
    ),
    contentSpent: strArray(pick(row, "contentSpent", "content_spent")),
  };
}

/** Write shape — snake_case, matching what is already stored. */
export function denormalizeDigest(d: PacketDigest): Record<string, unknown> {
  return {
    section: d.section,
    slug: d.slug,
    title: d.title,
    where_it_left_off: d.whereItLeftOff,
    vocabulary_introduced: d.vocabularyIntroduced,
    notation_conventions: d.notationConventions,
    tok_provocations_used: d.tokProvocationsUsed,
    misconceptions_planted: d.misconceptionsPlanted,
    international_mindedness_used: d.internationalMindednessUsed,
    content_spent: d.contentSpent ?? [],
  };
}

function normalizeUnitEntry(raw: unknown): UnitSequenceEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const section = str(pick(row, "section"));
  if (!section) return null;

  const rawStatus = str(pick(row, "status"));
  const status: UnitSequenceEntry["status"] =
    rawStatus === "done" || rawStatus === "next" ? rawStatus : "planned";

  return {
    section,
    title: str(pick(row, "title")),
    status,
    prepNote: str(pick(row, "prepNote", "prep_note")) || undefined,
    prepAlreadyShipped: Boolean(pick(row, "prepAlreadyShipped", "prep_already_shipped")),
  };
}

// -- Read ---------------------------------------------------------------------

/**
 * Load a course's continuity record. Returns null when the course has no row
 * yet — that is the normal first-packet state, not an error.
 */
export async function loadContinuity(
  supabase: SupabaseClient,
  courseId: string,
): Promise<ContinuityRecord | null> {
  const { data, error } = await supabase
    .from("na_continuity")
    .select("course_id, unit_sequence, packets")
    .eq("course_id", courseId)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as { course_id: string; unit_sequence: unknown; packets: unknown };

  return {
    courseId: row.course_id,
    unitSequence: (Array.isArray(row.unit_sequence) ? row.unit_sequence : [])
      .map(normalizeUnitEntry)
      .filter((e): e is UnitSequenceEntry => e !== null),
    packets: (Array.isArray(row.packets) ? row.packets : [])
      .map(normalizeDigest)
      .filter((d): d is PacketDigest => d !== null),
  };
}

// -- Prompt context -----------------------------------------------------------

function bulletList(label: string, items: string[]): string[] {
  if (items.length === 0) return [];
  return [`${label}:`, ...items.map((i) => `  - ${i}`)];
}

/**
 * Render a continuity record as a prompt block for the generator.
 *
 * Ordering is deliberate. The prohibitions come LAST, immediately before the
 * generation instruction, because that is the position a model weights most
 * heavily — and a repeated TOK question or a re-used warm-up is the failure
 * mode that costs the most to catch by eye after the PDF is built.
 *
 * `targetSection` is the section about to be generated; the block describes
 * everything before it and surfaces any prep note attached to it.
 */
export function buildContinuityContext(
  record: ContinuityRecord | null,
  targetSection?: string,
): string {
  if (!record || record.packets.length === 0) return "";

  const lines: string[] = [
    "-- TEACHING CONTINUITY (authoritative — read before generating) --",
    "",
    "This packet is one instalment in a sequence. Prior packets in this course:",
    "",
  ];

  for (const p of record.packets) {
    lines.push(`▸ ${p.section} — "${p.title}"`);
    if (p.whereItLeftOff) lines.push(`  Where it left off: ${p.whereItLeftOff}`);
    lines.push(...bulletList("  Vocabulary introduced", p.vocabularyIntroduced));
    lines.push(...bulletList("  Notation and conventions established", p.notationConventions));
    lines.push("");
  }

  // The spine, so the model knows what comes after and does not pre-empt it.
  if (record.unitSequence.length > 0) {
    lines.push("Planned scope and sequence for this unit:");
    for (const u of record.unitSequence) {
      const mark = u.status === "done" ? "[done]" : u.status === "next" ? "[next]" : "[planned]";
      lines.push(`  ${mark} ${u.section} — ${u.title}`);
    }
    lines.push("");
  }

  // Any note pinned to the section being generated.
  const target = targetSection
    ? record.unitSequence.find((u) => u.section === targetSection)
    : undefined;
  if (target?.prepNote) {
    lines.push(`SECTION NOTE for ${target.section}: ${target.prepNote}`);
    lines.push("");
  }
  if (target?.prepAlreadyShipped) {
    lines.push(
      `The pre-class prep for ${target.section} has ALREADY been distributed at the back of the previous bundle. Do NOT generate it again — open this packet assuming students arrive having done it.`,
    );
    lines.push("");
  }

  // Prohibitions, aggregated across every prior packet.
  const spentTok = record.packets.flatMap((p) => p.tokProvocationsUsed);
  const spentIm = record.packets.flatMap((p) => p.internationalMindednessUsed);
  const spentVocab = record.packets.flatMap((p) => p.vocabularyIntroduced);
  const spentMisconceptions = record.packets.flatMap((p) => p.misconceptionsPlanted);
  const spentContent = record.packets.flatMap((p) => p.contentSpent ?? []);

  lines.push("DO NOT REPEAT — the following are already spent in this course:");
  lines.push(...bulletList("TOK provocations already asked", spentTok));
  lines.push(...bulletList("Mathematicians already credited", spentIm));
  lines.push(...bulletList("Misconceptions already planted", spentMisconceptions));
  lines.push(...bulletList("Contexts and source problems already used", spentContent));
  lines.push("");
  lines.push(
    `Vocabulary already formally introduced (use it freely, but do NOT re-define it as new): ${spentVocab.join(", ") || "none"}.`,
  );
  lines.push("");
  lines.push(
    "Do not re-teach what a prior packet established, and do not pre-empt a skill that the scope and sequence reserves for a later section.",
  );
  lines.push("-- END CONTINUITY --");

  return lines.join("\n");
}

// -- Auto-draft a digest from a generated packet ------------------------------

function collectPrompts(draft: AssignmentDraft): string[] {
  const out: string[] = [];
  for (const section of draft.sections ?? []) {
    for (const q of section.questions ?? []) {
      if (q.prompt) out.push(q.prompt);
      for (const sp of q.subparts ?? []) {
        if (sp.prompt) out.push(sp.prompt);
      }
    }
  }
  return out;
}

/**
 * Candidate vocabulary terms drawn from every question and subpart's
 * contentTag/skillTag fields (e.g. "Topic 1.13 — De Moivre's Theorem",
 * "Proof by mathematical induction") — the generator's own concise naming of
 * what each question teaches. Deliberately NOT free-text extraction from
 * prompt prose: contentTag/skillTag are already short, specific, and written
 * by the model for exactly this purpose, so they are a far more reliable
 * vocabulary signal than trying to regex terms out of a sentence.
 *
 * Returns candidates in first-appearance order with duplicates removed
 * (a term named on three questions in one packet should appear once).
 *
 * EXPORTED (2026-08-19) so continuity-digest-modal.tsx's confirm UI can
 * build a checklist from the same candidate set draftDigestFromDraft()
 * diffs internally — previously private, which meant the modal had no way
 * to show already-seen terms for the teacher's awareness; it could only
 * see draftDigestFromDraft()'s already-filtered "new terms only" output.
 */
export function collectCandidateVocabulary(draft: AssignmentDraft): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (tag: string | undefined) => {
    const trimmed = (tag ?? "").trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      out.push(trimmed);
    }
  };
  for (const section of draft.sections ?? []) {
    for (const q of section.questions ?? []) {
      add(q.contentTag);
      add(q.skillTag);
      for (const sp of q.subparts ?? []) {
        add(sp.contentTag);
        add(sp.skillTag);
      }
    }
  }
  return out;
}

/**
 * One vocabulary candidate from THIS packet, already classified against
 * everything continuity has recorded so far. The modal uses `alreadySeen` to
 * pre-check only genuinely new terms, and shows the already-seen ones
 * unchecked (with their origin) purely for the teacher's awareness — a term
 * reappearing is not itself a problem, silently treating a repeat as "newly
 * introduced" is.
 */
export type VocabularyCandidate = {
  term: string;
  alreadySeen: boolean;
  /** Section that first introduced this term, if alreadySeen. */
  firstSeenIn?: string;
};

/**
 * Diffs this packet's candidate vocabulary against every term continuity has
 * already recorded as introduced, across all prior packets in the course.
 * Case-insensitive, trimmed comparison: "Show that" and "show that " should
 * not be treated as different terms because of stray whitespace or casing a
 * teacher typed differently across two packets.
 */
export function diffVocabularyAgainstContinuity(
  candidates: string[],
  priorPackets: PacketDigest[],
): VocabularyCandidate[] {
  const priorByNormalized = new Map<string, string>(); // normalized term -> section it first appeared in
  for (const packet of priorPackets) {
    for (const term of packet.vocabularyIntroduced ?? []) {
      const key = term.trim().toLowerCase();
      if (key && !priorByNormalized.has(key)) {
        priorByNormalized.set(key, packet.section);
      }
    }
  }

  return candidates.map((term) => {
    const key = term.trim().toLowerCase();
    const firstSeenIn = priorByNormalized.get(key);
    return firstSeenIn
      ? { term, alreadySeen: true, firstSeenIn }
      : { term, alreadySeen: false };
  });
}

/**
 * Produce a best-effort digest from a generated draft.
 *
 * This is a DRAFT, not a commit — every field stays fully editable in the
 * confirm modal. What changed (2026-08-19): NEITHER field the teacher used to
 * have to fill from a blank box is blank anymore.
 *
 *   - vocabularyIntroduced now starts pre-populated with candidate terms
 *     (from collectCandidateVocabulary) that do NOT already appear anywhere
 *     in priorPackets' recorded vocabulary — i.e. it is a pre-computed diff,
 *     not a guess. A term this packet reuses from three packets ago is
 *     correctly left off the "newly introduced" list rather than requiring
 *     the teacher to know that and manually exclude it.
 *   - whereItLeftOff now starts with a real mechanical summary (last
 *     question's contentTag, if present) instead of "". It is still the
 *     single most important field to actually get right, and the teacher
 *     should still read and likely rewrite it — the modal no longer BLOCKS
 *     saving on it being empty (see continuity-digest-modal.tsx), because a
 *     mechanical guess that is merely unedited is a better failure mode than
 *     a required field that stops a save the teacher wanted to make.
 *
 * priorPackets is optional so this function still works standalone (e.g. in
 * a context with no continuity loaded yet, such as a course's first packet).
 */
export function draftDigestFromDraft(
  draft: AssignmentDraft,
  meta: { section: string; slug?: string },
  priorPackets: PacketDigest[] = [],
): PacketDigest {
  const prompts = collectPrompts(draft);

  const slug =
    meta.slug ||
    (draft.title || "untitled")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  // Only terms genuinely new to this course are pre-checked. A term this
  // packet reuses from an earlier section is correctly excluded here, rather
  // than requiring the teacher to already know that and manually uncheck it.
  const vocabularyCandidates = diffVocabularyAgainstContinuity(
    collectCandidateVocabulary(draft),
    priorPackets,
  );
  const vocabularyIntroduced = vocabularyCandidates
    .filter((c) => !c.alreadySeen)
    .map((c) => c.term);

  // Mechanical starting point, not a substitute for the teacher's own
  // judgement (see the doc comment above): names the last section covered
  // and, if the final question tagged one, the last content point reached.
  // Deliberately does NOT attempt to guess what the packet did NOT do —
  // that half of the field is the part this function truly cannot infer,
  // and papering over it with a plausible-sounding sentence would be worse
  // than an honest gap the teacher notices and fills in.
  const lastSection = draft.sections?.[draft.sections.length - 1];
  const lastQuestionTag = lastSection?.questions
    ?.slice()
    .reverse()
    .map((q) => q.contentTag)
    .find((tag) => tag && tag.trim());
  const whereItLeftOff = lastSection
    ? `Ends having covered "${lastSection.heading}"${lastQuestionTag ? `, up to ${lastQuestionTag}` : ""}. Did NOT yet… [edit this — what did this packet deliberately hold back for a later section?]`
    : "";

  return {
    section: meta.section,
    slug,
    title: draft.title || "Untitled",
    whereItLeftOff,
    vocabularyIntroduced,
    notationConventions: (draft.commandTerms ?? []).map(
      (c) => `Command term in glossary: ${c.term}`,
    ),
    tokProvocationsUsed: (draft.tokProvocations ?? []).map((t) => t.body).filter(Boolean),
    misconceptionsPlanted: prompts
      .filter((p) => /error|mistake|incorrect|wrong|misconception|critique/i.test(p))
      .map((p) => (p.length > 160 ? `${p.slice(0, 157)}…` : p)),
    internationalMindednessUsed: [],
    contentSpent: [],
  };
}


// -- Write --------------------------------------------------------------------

/**
 * Append (or replace) one packet's digest on the course's continuity record,
 * and mark the matching unit_sequence entry as done.
 *
 * Replace-by-section rather than blind append: regenerating A.3 after an edit
 * must not leave two competing A.3 digests, which would double every
 * prohibition list on the next generation.
 *
 * Creates the continuity row if the course has none yet.
 */
export async function appendPacketDigest(
  supabase: SupabaseClient,
  courseId: string,
  digest: PacketDigest,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const existing = await loadContinuity(supabase, courseId);

  const packets = existing ? existing.packets.filter((p) => p.section !== digest.section) : [];
  packets.push(digest);
  packets.sort((a, b) => a.section.localeCompare(b.section, undefined, { numeric: true }));

  const unitSequence = (existing?.unitSequence ?? []).map((u) =>
    u.section === digest.section ? { ...u, status: "done" as const } : u,
  );

  const { error } = await supabase.from("na_continuity").upsert(
    {
      course_id: courseId,
      packets: packets.map(denormalizeDigest),
      unit_sequence: unitSequence.map((u) => ({
        section: u.section,
        title: u.title,
        status: u.status,
        prep_note: u.prepNote ?? null,
        prep_already_shipped: u.prepAlreadyShipped ?? false,
      })),
    },
    { onConflict: "course_id" },
  );

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
