/**
 * na-answer-service.ts
 * -----------------------------------------------------------------------------
 * The answers a student is allowed to see for their own marked packet.
 *
 * na_rubric_items is teacher-only under RLS ("students never see the answer
 * key" -- 20260823151440_create_na_rubric_items.sql), and that stays true:
 * what a student gets here is the ANSWER alone, lifted out by
 * lib/na-answer-extract, never the mark scheme, common errors, misconception
 * context or teacher notes that sit beside it in the same row.
 *
 * Reading it therefore needs the service key, which means the gate has to live
 * in this file rather than in a policy. It is deliberately the same shape as
 * lib/na-feedback-service: a checked entry point that a student path calls, an
 * unchecked one that only the teacher-preview paths call, and inside both, a
 * status = 'released' test that does not trust the caller. A packet that has
 * been scanned but not released hands back nothing, however it is reached.
 * -----------------------------------------------------------------------------
 */

import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAnswerList, type AnswerLine, type RubricAnswerRow } from "@/lib/na-answer-extract";
import { packetUsesLatexDelimiters, renderRubricText } from "@/lib/rubric-latex";

/** One line of the student's answers list, ready to render. */
export interface StudentAnswerLine extends Omit<AnswerLine, "answer"> {
  /** Safe HTML: prose is escaped, and maths is typeset only on a packet whose
   *  dollars are delimiters rather than prices. See lib/rubric-latex. */
  answerHtml: string | null;
  /** How long the answer reads, in characters of the answer itself. Carried
   *  separately because answerHtml is not a proxy for it: KaTeX expands a
   *  twenty-character formula into several thousand characters of markup, and
   *  measuring that offered to expand a one-line answer. */
  answerChars: number;
}

/** Built inside the call, not at module scope, so `next build`'s page-data
 *  collection does not throw where the service key is absent. */
function serviceClient(): SupabaseClient {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

type RubricShape = {
  question_number: number | null;
  answer_key: string | null;
  open_rubric: string | null;
  marks: number | null;
};
type AnchorRow = {
  qid: string;
  base_qid: string;
  part_label: string | null;
  sort_order: number | null;
  marks_available: number | null;
  answer_sketch: string | null;
  open_rubric: string | null;
  na_rubric_items: RubricShape | RubricShape[] | null;
};

/**
 * The answers for one released packet scan, in the order the boxes appear on
 * the page -- the same order, and the same labels, as the detailed feedback
 * list, because both are built from na_anchors.sort_order.
 *
 * Returns [] for a scan that is not released. No ownership check: this is the
 * teacher-preview entry point, where ownership comes from the teacher role.
 * Never call it on behalf of a student -- getReleasedAnswersForStudent is the
 * checked wrapper.
 */
export async function getReleasedAnswersForPacketScan(
  packetScanId: string
): Promise<StudentAnswerLine[]> {
  const service = serviceClient();

  // Defence in depth. RLS cannot help here (the service key bypasses it), so
  // the release test is this function's own, and it is done before any answer
  // is read rather than filtered out afterwards.
  const { data: scan } = await service
    .from("na_packet_scans")
    .select("id, status, packet_version_id")
    .eq("id", packetScanId)
    .maybeSingle();
  if (!scan || scan.status !== "released" || !scan.packet_version_id) return [];

  const { data: anchorRows, error } = await service
    .from("na_anchors")
    .select(
      `qid, base_qid, part_label, sort_order, marks_available, answer_sketch, open_rubric,
       na_rubric_items(question_number, answer_key, open_rubric, marks)`
    )
    .eq("packet_version_id", scan.packet_version_id)
    .order("sort_order");
  if (error) throw error;

  const rows: RubricAnswerRow[] = ((anchorRows ?? []) as unknown as AnchorRow[]).map((a) => {
    const rubric = Array.isArray(a.na_rubric_items) ? a.na_rubric_items[0] : a.na_rubric_items;
    return {
      qid: a.qid,
      base_qid: a.base_qid,
      part_label: a.part_label,
      question_number: rubric?.question_number ?? null,
      answer_sketch: a.answer_sketch,
      answer_key: rubric?.answer_key ?? null,
      // An anchor can carry its own open rubric where the rubric row does not.
      open_rubric: a.open_rubric ?? rubric?.open_rubric ?? null,
      // marks_available is what the box is worth on this printed version, so
      // it wins over the rubric's figure where a question was split across
      // boxes (A.1's Q6 is 5 + 2, not 7 twice).
      marks: a.marks_available ?? rubric?.marks ?? null,
    };
  });

  const lines = buildAnswerList(rows);

  // Decided once for the whole packet, from the answers actually being shown:
  // a dollar sign is a delimiter or a price, and getting it wrong rewrites an
  // answer into nonsense. Both released packets price things in dollars, so
  // both come back false and render as written.
  const renderLatex = packetUsesLatexDelimiters(lines.map((l) => l.answer));

  return lines.map(({ answer, ...rest }) => ({
    ...rest,
    answerHtml: answer === null ? null : renderRubricText(answer, renderLatex),
    answerChars: answer?.length ?? 0,
  }));
}

/**
 * The same answers, for a student reading their own page. Returns [] unless
 * the scan really belongs to this student -- the same ownership test, against
 * the same column, as getNaFeedbackForStudent makes before showing the marks
 * these answers sit beside.
 */
export async function getReleasedAnswersForStudent(
  packetScanId: string,
  studentProfileId: string
): Promise<StudentAnswerLine[]> {
  const service = serviceClient();
  const { data: scan } = await service
    .from("na_packet_scans")
    .select("id, student_profile_id")
    .eq("id", packetScanId)
    .maybeSingle();
  if (!scan || scan.student_profile_id !== studentProfileId) return [];

  return getReleasedAnswersForPacketScan(packetScanId);
}
