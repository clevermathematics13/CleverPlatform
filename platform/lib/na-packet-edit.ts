/**
 * na-packet-edit.ts
 * -----------------------------------------------------------------------------
 * The two pure decisions behind editing a saved packet from the Nuanced
 * Analysis editor: may this packet's content be rewritten at all, and what
 * exactly does a rewrite set.
 *
 * Both live here rather than inline in the route so they can be tested without
 * a database, and so the column mapping can be compared line by line against
 * the one in app/api/nuanced-analyses/route.ts, which writes the same columns
 * from the same AssignmentDraft shape on the sandbox's save path. Those two
 * must not drift: a packet saved from the sandbox and the same packet saved
 * from the editor should land identically.
 * -----------------------------------------------------------------------------
 */

import type { AssignmentDraft } from "./assignments";

// ---- Lock ------------------------------------------------------------------

export interface PacketLockFacts {
  /** Rows in na_packet_versions for this packet. */
  packetVersions: number;
  /** Answer-box anchors cut against those versions' page geometry. */
  anchors: number;
  /** Scanned student copies ingested against those versions. */
  scans: number;
}

export type PacketLock = { locked: false } | { locked: true; reason: string };

/**
 * A packet is locked for content edits once a print master has been
 * registered for it (na_packet_versions), whether or not anything has been
 * scanned yet.
 *
 * The version row is the point at which the packet stops being only a
 * document and becomes the key to physical paper: anchors are cut against
 * that PDF's exact page geometry, crops are taken at those coordinates, and
 * na_rubric_items is what Clev's Marks grades the resulting work against.
 * Renumbering a question or changing its marks after that point silently
 * desyncs the marking key from the paper the students actually wrote on, and
 * nothing downstream would report the mismatch.
 *
 * Deliberately conservative: it refuses even at zero scans, because the
 * anchors are already keyed to the printed geometry by then. The cost of a
 * false refusal is a teacher re-saving from the sandbox; the cost of a false
 * allow is marks computed against the wrong key.
 */
export function evaluatePacketLock(facts: PacketLockFacts): PacketLock {
  if (facts.packetVersions <= 0) return { locked: false };

  const parts = [
    `${facts.packetVersions} print master${facts.packetVersions === 1 ? "" : "s"}`,
  ];
  if (facts.anchors > 0) parts.push(`${facts.anchors} answer-box anchors`);
  if (facts.scans > 0) parts.push(`${facts.scans} scanned student copies`);

  return {
    locked: true,
    reason:
      `This packet has ${parts.join(", ")}. Its anchors are cut against the ` +
      `printed page geometry and Clev's Marks grades against its rubric, so ` +
      `changing the content here would leave the marking key describing a ` +
      `paper the students never wrote on. Formatting changes still save. To ` +
      `correct an answer key, edit the rubric; to change the questions, issue ` +
      `a new packet version.`,
  };
}

// ---- Content write ---------------------------------------------------------

/**
 * The nuanced_analyses columns an editor save rewrites, and only those.
 *
 * Identity and placement -- slug, course_id, owner_id, grade_level,
 * section_code, is_published, continuity_digest -- are deliberately absent.
 * The editor does not present them, and section_code in particular is half of
 * the (course_id, section_code) key the sandbox's upsert conflicts on, so
 * writing it from here could silently repoint a packet at another one's slot.
 *
 * Continuity is also deliberately untouched: a digest records what a packet
 * deliberately did NOT do and is confirmed by the teacher at save time in the
 * sandbox. Regenerating one from an edit nobody reviewed would be worse than
 * leaving the existing digest in place.
 */
export function buildPacketContentUpdate(draft: AssignmentDraft): Record<string, unknown> {
  return {
    title: draft.title,
    subtitle: draft.subtitle ?? null,
    // Mirrors app/api/nuanced-analyses/route.ts: these three columns are text[]
    // in the schema but hold a single joined string in practice.
    syllabus_topics: draft.syllabusTopics ? [draft.syllabusTopics] : [],
    prerequisites: draft.prerequisites ? [draft.prerequisites] : [],
    materials: draft.materials ?? null,
    atl_statement: draft.atl ?? null,
    vocabulary: draft.commandTerms ?? [],
    tok_provocations: draft.tokProvocations ?? [],
    parts: draft.sections,
    draft_content: draft,
    ...(draft.course ? { course: draft.course } : {}),
    updated_at: new Date().toISOString(),
  };
}
