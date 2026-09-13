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

export type PacketLock =
  /** Editable. `warning` is advisory only and never blocks a save. */
  | { locked: false; warning?: string }
  | { locked: true; reason: string };

/**
 * A packet is locked for content edits once student work has been scanned
 * against it (na_packet_scans).
 *
 * That is the point where an edit can produce a wrong mark rather than merely
 * a stale document: crops have been taken at the anchors' coordinates and
 * Clev's Marks grades them against na_rubric_items, so renumbering a question
 * or changing its marks afterwards leaves the marking key describing a paper
 * the students never wrote on, with nothing downstream reporting the
 * mismatch.
 *
 * A registered print master with no scans is deliberately NOT a lock. A
 * teacher who has generated a master but not yet handed it out is exactly who
 * needs to fix a typo, and refusing them buys nothing: no marks exist to be
 * computed against the wrong key.
 *
 * That middle state does carry a smaller risk, so it returns a warning rather
 * than passing silently. na_anchors.rubric_item_id points at a rubric row by
 * qid; syncRubricItems upserts on (nuanced_analysis_id, qid), so an edit that
 * leaves the numbering alone re-links cleanly, while one that renumbers a
 * question leaves an existing anchor pointing at a row that no longer
 * describes it. Reprinting the master and re-cutting the anchors is what
 * resolves that, and the warning is where the teacher hears so.
 */
export function evaluatePacketLock(facts: PacketLockFacts): PacketLock {
  if (facts.scans > 0) {
    const parts = [`${facts.scans} scanned student cop${facts.scans === 1 ? "y" : "ies"}`];
    if (facts.anchors > 0) parts.push(`${facts.anchors} answer-box anchors`);

    return {
      locked: true,
      reason:
        `This packet has ${parts.join(" and ")}. Those crops were taken at the ` +
        `anchors' coordinates and Clev's Marks grades them against its rubric, ` +
        `so changing the content here would leave the marking key describing a ` +
        `paper the students never wrote on. Formatting changes still save. To ` +
        `correct an answer key, edit the rubric; to change the questions, issue ` +
        `a new packet version.`,
    };
  }

  if (facts.packetVersions > 0) {
    return {
      locked: false,
      warning:
        `This packet has a print master${
          facts.anchors > 0 ? ` and ${facts.anchors} answer-box anchors` : ""
        } but no scanned work yet, so it is still editable. If you renumber or ` +
        `remove a question, reprint the master and re-cut the anchors before ` +
        `collecting any work against it.`,
    };
  }

  return { locked: false };
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
