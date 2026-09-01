/**
 * Re-crop + re-assess A.1 Q2 for the 7 live students, after the Q2
 * anchor's y0_pt was widened (276.48 -> 210.0) on 1 Sep 2026.
 *
 * Why this exists: Q2 prints its five items (a)-(e) ABOVE the ruled
 * answer box, and students (Davi Verma, at minimum) answer them inline
 * next to each item. The anchor's box -- from auto_fillrect, which only
 * ever saw the filled rectangle -- started at y0=276.48, slicing through
 * the (c)/(d) row, so the crop showed the grader and the student only
 * part (e) plus the box. Davi's five correct inline answers were cut out
 * of his own "See my work" view and out of what stage 5 graded (2/5).
 *
 * Mirrors packet-scans/[packetScanId]/crop/route.ts (stage 4, one anchor)
 * and response-crops/[cropId]/assess/route.ts (stage 5) exactly. Writes
 * ai_* only -- final_*, approved_*, released_at are never touched, same
 * contract as the route: re-assessment produces a proposal for teacher
 * review, never a released grade.
 *
 * Committed (unlike the deleted 28 Aug reassess-q1-tmp.ts) because the
 * agent session that authored it was permission-blocked from running
 * production writes; run it from any environment with the env vars below.
 *
 * Safe to re-run: stage 4 upserts per (packet_scan_id, anchor_id), and
 * the assessment upsert replaces the crop's single ai_* proposal.
 *
 * Env: SUPABASE_SERVICE_ROLE_KEY, GRAPH_LAB_CV_SERVICE_URL,
 *      CV_SERVICE_SECRET, and GRADING_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY.
 * Run: cd platform && npx tsx scripts/recrop-assess-q2.ts
 */
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import {
  ASSESSMENT_MODEL,
  ASSESSMENT_SYSTEM_PROMPT,
  buildAssessmentUserPrompt,
  buildRubricBlock,
  isUngradedAnchor,
  validateAssessment,
  type AnchorContext,
} from "../lib/na-assessment";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://qnawglgnoojrlaivylou.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANTHROPIC_KEY = process.env.GRADING_ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY!;
const CV_URL = process.env.GRAPH_LAB_CV_SERVICE_URL!.trim().replace(/\/$/, "");
const CV_SECRET = process.env.CV_SERVICE_SECRET ?? "";
const BUCKET = "exam-scans";

const PACKET_VERSION_ID = "1462a2f2-fc2a-4bab-8135-ed3aefeb0aff";
const Q2_ANCHOR_ID = "da2cc841-379f-4496-a449-d5dc6dd4dbef";
// Scans that already went through this script's first run (1 Sep 2026) --
// skipped so a re-run only processes what's still pending. The full-cohort
// bulk upload (~48 scans with splits, discovered 1 Sep) is why the scan
// list became a query: the original hardcoded 7 covered only the students
// the 27 Aug handoff knew about. Scans still mid-pipeline (status 'split',
// stage 4 incomplete -- mostly duplicate re-uploads pending a teacher
// decision) and the 3 orphaned pilot scans (no split PDF) are excluded.
const ALREADY_DONE = new Set([
  "fb4b6967-2280-4cf6-ac8b-ba7961727c41", // Davi Verma (released; final_* re-approved 1 Sep)
  "511127b9-1b8b-4eef-911c-9f830a0c8ab1", // Freya Delisle
  "3797e2c9-5b14-4e74-bcda-39719cbdbec0", // Kaito Fujii
  "93b74b8f-3322-4f5b-abad-1bbe1a1510fc", // Roberto Aurelio Gamio
  "812210f8-f6e5-4fb6-b083-d5147deea1d8", // Ruifeng Wu
  "69862b2f-6f2f-41ca-bcc6-3277fa5401b8", // Santiago Caipo
  "68867cf5-48e3-435c-bcf9-80810d050f39", // Ines Palomino
]);

async function eligibleScanIds(): Promise<string[]> {
  const { data, error } = await supabase
    .from("na_packet_scans")
    .select("id, status, split_storage_path")
    .eq("packet_version_id", PACKET_VERSION_ID)
    .in("status", ["cropped", "assessed", "released"])
    .not("split_storage_path", "is", null)
    .order("created_at");
  if (error) throw new Error(`scan list: ${error.message}`);
  return (data ?? []).map((r) => r.id as string).filter((id) => !ALREADY_DONE.has(id));
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

async function main() {
  const { data: anchor, error: aErr } = await supabase
    .from("na_anchors")
    .select(
      "id, qid, base_qid, page_index, x0_pt, y0_pt, x1_pt, y1_pt, expand_max_x1_pt, expand_max_y1_pt, marks_available, command_term, answer_sketch, open_rubric, misconception_context, question_text, question_answer, question_marks"
    )
    .eq("id", Q2_ANCHOR_ID)
    .single();
  if (aErr || !anchor) throw new Error(`anchor: ${aErr?.message}`);
  console.log(`Anchor ${anchor.qid}: y0=${anchor.y0_pt} y1=${anchor.y1_pt} capY1=${anchor.expand_max_y1_pt}`);

  const { data: pv } = await supabase
    .from("na_packet_versions")
    .select("page_count")
    .eq("id", PACKET_VERSION_ID)
    .single();
  const expectedPageCount = pv?.page_count;
  if (!expectedPageCount) throw new Error("no page_count on packet version");

  const scanIds = await eligibleScanIds();
  console.log(`${scanIds.length} scans to process`);

  for (const scanId of scanIds) {
    const { data: scan, error: sErr } = await supabase
      .from("na_packet_scans")
      .select("id, split_storage_path, invited_students(full_name)")
      .eq("id", scanId)
      .single();
    if (sErr || !scan?.split_storage_path) {
      console.error(`SKIP ${scanId}: ${sErr?.message ?? "no split PDF"}`);
      continue;
    }
    const inv = Array.isArray(scan.invited_students) ? scan.invited_students[0] : scan.invited_students;
    const name = inv?.full_name ?? scanId;

    // ---- stage 4: re-crop Q2 only (mirrors crop/route.ts) ----
    const { data: pdfFile, error: dlErr } = await supabase.storage.from(BUCKET).download(scan.split_storage_path);
    if (dlErr || !pdfFile) {
      console.error(`SKIP ${name}: split PDF download failed: ${dlErr?.message}`);
      continue;
    }
    const pdfBase64 = Buffer.from(await pdfFile.arrayBuffer()).toString("base64");

    const cvRes = await fetch(`${CV_URL}/crop`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(CV_SECRET ? { "X-CV-Secret": CV_SECRET } : {}) },
      body: JSON.stringify({
        studentPdfBase64: pdfBase64,
        expectedPageCount,
        rotationHint: 0,
        anchors: [
          {
            qid: anchor.qid,
            pageIndex: anchor.page_index,
            x0Pt: Number(anchor.x0_pt),
            y0Pt: Number(anchor.y0_pt),
            x1Pt: Number(anchor.x1_pt),
            y1Pt: Number(anchor.y1_pt),
            expandMaxX1Pt: anchor.expand_max_x1_pt == null ? null : Number(anchor.expand_max_x1_pt),
            expandMaxY1Pt: anchor.expand_max_y1_pt == null ? null : Number(anchor.expand_max_y1_pt),
          },
        ],
      }),
    });
    if (!cvRes.ok) {
      console.error(`FAIL ${name}: CV service HTTP ${cvRes.status}: ${(await cvRes.text()).slice(0, 200)}`);
      continue;
    }
    const cv = (await cvRes.json()) as {
      pageCountMismatch: number | null;
      crops: { qid: string; imageBase64: string; expanded: boolean; possiblyTruncated: boolean; warnings: string[] }[];
    };
    if (cv.pageCountMismatch !== null) {
      console.error(`FAIL ${name}: pageCountMismatch=${cv.pageCountMismatch} -- not saving`);
      continue;
    }
    const crop = cv.crops[0];
    if (!crop?.imageBase64) {
      console.error(`FAIL ${name}: no image returned (${crop?.warnings?.join("; ")})`);
      continue;
    }
    const imageBytes = Buffer.from(crop.imageBase64, "base64");
    const storagePath = `na-crops/${PACKET_VERSION_ID}/${scanId}/${anchor.id}.png`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, imageBytes, { contentType: "image/png", upsert: true });
    if (upErr) {
      console.error(`FAIL ${name}: storage upload: ${upErr.message}`);
      continue;
    }
    const { data: existingCrop } = await supabase
      .from("na_response_crops")
      .select("id")
      .eq("packet_scan_id", scanId)
      .eq("anchor_id", anchor.id)
      .maybeSingle();
    let cropId = existingCrop?.id as string | undefined;
    if (cropId) {
      const { error } = await supabase
        .from("na_response_crops")
        .update({
          storage_path: storagePath,
          boundary_expanded: crop.expanded,
          possibly_truncated: crop.possiblyTruncated,
          is_blank: false,
        })
        .eq("id", cropId);
      if (error) {
        console.error(`FAIL ${name}: crop row update: ${error.message}`);
        continue;
      }
    } else {
      const { data: created, error } = await supabase
        .from("na_response_crops")
        .insert({
          packet_scan_id: scanId,
          anchor_id: anchor.id,
          storage_path: storagePath,
          boundary_expanded: crop.expanded,
          possibly_truncated: crop.possiblyTruncated,
          is_blank: false,
        })
        .select("id")
        .single();
      if (error || !created) {
        console.error(`FAIL ${name}: crop row insert: ${error?.message}`);
        continue;
      }
      cropId = created.id;
    }
    console.log(
      `cropped ${name}: ${(imageBytes.length / 1024).toFixed(0)}KB expanded=${crop.expanded} possiblyTruncated=${crop.possiblyTruncated}`
    );

    // ---- stage 5: re-assess (mirrors assess/route.ts; ai_* only) ----
    const ctx: AnchorContext = {
      qid: anchor.qid,
      baseQid: anchor.base_qid ?? anchor.qid,
      marksAvailable: anchor.marks_available == null ? null : Number(anchor.marks_available),
      commandTerm: anchor.command_term,
      answerSketch: anchor.answer_sketch,
      openRubric: anchor.open_rubric,
      misconceptionContext: anchor.misconception_context,
      questionText: anchor.question_text,
      questionAnswer: anchor.question_answer,
      questionMarks: anchor.question_marks == null ? null : Number(anchor.question_marks),
      boundaryExpanded: crop.expanded,
      possiblyTruncated: crop.possiblyTruncated,
    };
    if (isUngradedAnchor(ctx)) {
      console.log(`skip assess ${name}: ungraded anchor`);
      continue;
    }

    const { data: prior } = await supabase
      .from("na_feedback")
      .select("id, ai_marks_awarded, final_marks_awarded, teacher_edited")
      .eq("crop_id", cropId)
      .maybeSingle();

    const message = await anthropic.messages.create({
      model: ASSESSMENT_MODEL,
      max_tokens: 2048,
      system: ASSESSMENT_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: crop.imageBase64 } },
            { type: "text", text: buildRubricBlock(ctx), cache_control: { type: "ephemeral" } },
            { type: "text", text: buildAssessmentUserPrompt() },
          ],
        },
      ],
    });
    const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
    const validated = validateAssessment(text, ctx.marksAvailable);

    const upsertFeedback = async (fields: Record<string, unknown>) => {
      if (prior?.id) {
        const { error } = await supabase
          .from("na_feedback")
          .update({ ...fields, updated_at: new Date().toISOString() })
          .eq("id", prior.id);
        if (error) throw new Error(`feedback update: ${error.message}`);
        return;
      }
      const { error } = await supabase.from("na_feedback").insert({ crop_id: cropId, ...fields });
      if (error) throw new Error(`feedback insert: ${error.message}`);
    };

    if (!validated.ok) {
      await upsertFeedback({
        ai_attempted: true,
        ai_marks_available: ctx.marksAvailable,
        ai_validation_error: validated.error,
        ai_raw_response: { rawText: text.slice(0, 4000) },
      });
      console.error(`ASSESS FAILED ${name}: ${validated.error}`);
      continue;
    }

    const a = validated.assessment;
    let warnings = validated.warnings;
    if (a.redirectedElsewhere) {
      // The route's wider-page second pass is not replicated here; fall
      // back to its own fallback behavior (flag loudly for a teacher).
      warnings = [
        ...warnings,
        "An arrow crossing this answer box was detected, meaning the student's real work for this question is elsewhere on the page, but the wider-page re-check could not resolve it -- a teacher should check the original page for where that work was written.",
      ];
    }
    await upsertFeedback({
      ai_attempted: true,
      ai_student_attempted: a.studentAttempted,
      ai_transcription: a.transcription,
      ai_verdict: a.verdict,
      ai_marks_awarded: a.marksAwarded,
      ai_marks_available: ctx.marksAvailable,
      ai_misconception_tags: a.misconceptionTags,
      ai_margin_comment: a.marginComment,
      ai_next_step: a.nextStep,
      ai_confidence: a.confidence,
      ai_teacher_note: [a.teacherNote, ...warnings].filter(Boolean).join(" | "),
      ai_validation_error: null,
      ai_raw_response: a as unknown as Record<string, unknown>,
    });
    console.log(
      `assessed ${name}: ai ${prior?.ai_marks_awarded ?? "-"} -> ${a.marksAwarded}/${ctx.marksAvailable} (${a.verdict})` +
        (prior?.final_marks_awarded != null ? ` [final_marks_awarded stays ${prior.final_marks_awarded}, teacher_edited=${prior.teacher_edited}]` : "") +
        (warnings.length ? ` WARNINGS: ${warnings.join(" | ")}` : "")
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
