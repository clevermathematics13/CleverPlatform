/**
 * One-off companion to regrade-na-feedback.ts: pushes a regraded packet's
 * new AI draft through to the student.
 *
 * regrade-na-feedback.ts deliberately writes only ai_* columns, so a
 * packet that was already released keeps showing its old, long feedback
 * until a teacher approves and releases again. This script performs that
 * step for one packet scan, copying ai_* -> final_* and re-stamping
 * approved_at/released_at, exactly as the approve-all and release routes
 * do -- with two differences that matter, both because this runs over a
 * packet that is ALREADY released:
 *
 *  - approve-all skips rows that already have approved_at (`.is(
 *    "approved_at", null)`), which is every row here. This overwrites
 *    them on purpose, including any comment a teacher hand-edited, so it
 *    must only ever run when a human has asked for exactly that.
 *  - approved_by is left as it was. The original approver stays the
 *    approver of record; this is not a new human decision.
 *
 * Always writes a JSON snapshot of every final_* value it is about to
 * replace, so the previous student-facing text and marks can be restored.
 *
 * Usage (from platform/):
 *   npx tsx scripts/rerelease-na-packet.ts --scan <packetScanId> --dry-run
 *   npx tsx scripts/rerelease-na-packet.ts --scan <packetScanId> --snapshot <path>
 *   npx tsx scripts/rerelease-na-packet.ts --scan <packetScanId> --text-only
 *
 * --text-only releases the shortened comment and next step but leaves
 * final_verdict and final_marks_awarded exactly as they are. A regrade is
 * a fresh model call, so its marks differ from the original run's on a
 * minority of crops even when nothing about the work changed -- on the
 * A.1 pilot packet, 6 of 39. Those differences are AI-vs-AI variance, not
 * a correction, and re-releasing them silently moves a mark a student has
 * already been shown. Use --text-only whenever the point of the regrade
 * was the wording.
 */
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { isUngradedAnchor, type AnchorContext } from "../lib/na-assessment";

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const value = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const SCAN_ID = value("scan");
const DRY_RUN = flag("dry-run");
const TEXT_ONLY = flag("text-only");
const SNAPSHOT = value("snapshot") ?? `na-rerelease-snapshot-${SCAN_ID}.json`;

if (!SCAN_ID) {
  console.error("Pass --scan <packetScanId>.");
  process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface FeedbackShape {
  id: string;
  ai_verdict: string | null;
  ai_marks_awarded: number | null;
  ai_margin_comment: string | null;
  ai_next_step: string | null;
  ai_validation_error: string | null;
  final_verdict: string | null;
  final_marks_awarded: number | null;
  final_margin_comment: string | null;
  final_next_step: string | null;
  teacher_edited: boolean | null;
  approved_at: string | null;
  released_at: string | null;
}

async function main() {
  const { data: scan, error: scanErr } = await supabase
    .from("na_packet_scans")
    .select("id, packet_version_id, status")
    .eq("id", SCAN_ID)
    .single();
  if (scanErr || !scan) throw new Error(scanErr?.message ?? "Packet scan not found");

  const { data: anchorRows, error: anchorErr } = await supabase
    .from("na_anchors")
    .select("id, qid, marks_available, question_answer, answer_sketch, open_rubric")
    .eq("packet_version_id", scan.packet_version_id);
  if (anchorErr) throw anchorErr;

  // Same gradable definition the approve-all and release routes use, so
  // an ungraded thinking space is neither approved nor released here.
  const gradableAnchorIds = new Set(
    (anchorRows ?? [])
      .filter(
        (a) =>
          !isUngradedAnchor({
            qid: a.qid,
            baseQid: a.qid,
            marksAvailable: a.marks_available,
            commandTerm: null,
            answerSketch: a.answer_sketch,
            openRubric: a.open_rubric,
            misconceptionContext: null,
            questionAnswer: a.question_answer,
          } satisfies AnchorContext)
      )
      .map((a) => a.id)
  );
  const qidByAnchor = new Map((anchorRows ?? []).map((a) => [a.id as string, a.qid as string]));

  const { data: cropRows, error: cropErr } = await supabase
    .from("na_response_crops")
    .select(
      `id, anchor_id,
       na_feedback(id, ai_verdict, ai_marks_awarded, ai_margin_comment, ai_next_step, ai_validation_error,
                   final_verdict, final_marks_awarded, final_margin_comment, final_next_step,
                   teacher_edited, approved_at, released_at)`
    )
    .eq("packet_scan_id", SCAN_ID);
  if (cropErr) throw cropErr;

  const snapshot: unknown[] = [];
  const updates: Array<{ id: string; qid: string; fields: Record<string, unknown> }> = [];
  const markChanges: string[] = [];
  const skipped: string[] = [];

  for (const crop of cropRows ?? []) {
    if (!gradableAnchorIds.has(crop.anchor_id as string)) continue;
    const fb = (Array.isArray(crop.na_feedback) ? crop.na_feedback[0] : crop.na_feedback) as
      | FeedbackShape
      | null;
    const qid = qidByAnchor.get(crop.anchor_id as string) ?? "?";
    if (!fb) {
      skipped.push(`${qid}: no feedback row`);
      continue;
    }
    // Never blank out text a student is already reading because the
    // regrade failed on that crop -- leave the released row alone and
    // report it instead.
    if (fb.ai_validation_error) {
      skipped.push(`${qid}: regrade left a validation error, released row untouched`);
      continue;
    }
    if (!fb.ai_verdict) {
      skipped.push(`${qid}: no AI verdict (blank or ungraded), released row untouched`);
      continue;
    }

    snapshot.push({
      feedbackId: fb.id,
      qid,
      final_verdict: fb.final_verdict,
      final_marks_awarded: fb.final_marks_awarded,
      final_margin_comment: fb.final_margin_comment,
      final_next_step: fb.final_next_step,
      teacher_edited: fb.teacher_edited,
      approved_at: fb.approved_at,
      released_at: fb.released_at,
    });

    if (fb.final_marks_awarded !== (fb.ai_marks_awarded ?? 0)) {
      markChanges.push(`${qid}: ${fb.final_marks_awarded} -> ${fb.ai_marks_awarded ?? 0}`);
    }

    updates.push({
      id: fb.id,
      qid,
      fields: TEXT_ONLY
        ? {
            final_margin_comment: fb.ai_margin_comment ?? "",
            final_next_step: fb.ai_next_step ?? "",
            teacher_edited: false,
          }
        : {
            final_verdict: fb.ai_verdict,
            final_marks_awarded: fb.ai_marks_awarded ?? 0,
            final_margin_comment: fb.ai_margin_comment ?? "",
            final_next_step: fb.ai_next_step ?? "",
            teacher_edited: false,
          },
    });
  }

  writeFileSync(SNAPSHOT, JSON.stringify(snapshot, null, 2));
  console.log(`snapshot of ${snapshot.length} rows written to ${SNAPSHOT}`);
  console.log(
    `${updates.length} row(s) to re-approve and re-release${TEXT_ONLY ? " (comment and next step only, marks untouched)" : ""}`
  );
  if (markChanges.length) {
    console.log(
      TEXT_ONLY
        ? `\n${markChanges.length} regraded mark(s) differ from the released mark and are being IGNORED (--text-only):`
        : `\nMARKS CHANGING (${markChanges.length}):`
    );
    for (const m of markChanges) console.log(`  ${m}`);
  } else {
    console.log("no marks change");
  }
  if (skipped.length) {
    console.log(`\nskipped (${skipped.length}):`);
    for (const s of skipped) console.log(`  ${s}`);
  }

  if (DRY_RUN) {
    console.log("\nDRY RUN -- nothing written.");
    return;
  }

  const nowIso = new Date().toISOString();
  const results = await Promise.allSettled(
    updates.map((u) =>
      supabase
        .from("na_feedback")
        .update({ ...u.fields, approved_at: nowIso, released_at: nowIso })
        .eq("id", u.id)
        .then((r) => {
          if (r.error) throw new Error(`${u.qid}: ${r.error.message}`);
          return r;
        })
    )
  );
  const failed = results.filter((r) => r.status === "rejected");
  for (const f of failed) console.log(`  FAILED ${(f as PromiseRejectedResult).reason}`);

  const { error: statusErr } = await supabase
    .from("na_packet_scans")
    .update({ status: "released" })
    .eq("id", SCAN_ID);
  if (statusErr) throw statusErr;

  console.log(`\nre-released ${updates.length - failed.length} row(s) at ${nowIso}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
