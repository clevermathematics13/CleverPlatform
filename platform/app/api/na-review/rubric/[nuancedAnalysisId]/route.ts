import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

export const maxDuration = 60;

/**
 * GET /api/na-review/rubric/[nuancedAnalysisId]
 *
 * Returns the marking rubric for one nuanced analysis, as JSON by
 * default or as a printable HTML document with ?format=html.
 *
 * WHY HTML RATHER THAN A GENERATED PDF BINARY: the platform's existing
 * PDF paths (Typst for packets, puppeteer for exports) are heavy
 * dependencies to pull into what is fundamentally a table of text.
 * A print-styled HTML page reaches the same destination -- the browser's
 * own "Save as PDF" -- with no new dependency, no cold-start cost, and
 * the useful property that the teacher can proofread it on screen before
 * committing it to paper. The page is styled for A4 print with page
 * breaks kept out of the middle of a question.
 *
 * The rubric lives in na_rubric_items, deliberately separate from the
 * activity record it belongs to. Before that table existed the answer
 * key was only reachable by parsing nuanced_analyses.parts JSONB, there
 * were two competing versions of it with no defined precedence, and
 * there was no way to export it at all.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ nuancedAnalysisId: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { nuancedAnalysisId } = await params;
  const format = request.nextUrl.searchParams.get("format") ?? "json";

  const { data: na, error: naErr } = await supabase
    .from("nuanced_analyses")
    .select("id, title, subtitle, course, slug")
    .eq("id", nuancedAnalysisId)
    .maybeSingle();
  if (naErr) return NextResponse.json({ error: naErr.message }, { status: 500 });
  if (!na) return NextResponse.json({ error: "Nuanced analysis not found" }, { status: 404 });

  const { data: rows, error: itemsErr } = await supabase
    .from("na_rubric_items")
    .select(
      "qid, base_qid, question_number, question_text, answer_key, open_rubric, misconception_context, command_term, marks, question_marks, teacher_notes"
    )
    .eq("nuanced_analysis_id", nuancedAnalysisId)
    .order("question_number")
    .order("qid");

  if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 });
  const items = rows ?? [];

  // Totals, and the mark-split integrity check. Sub-part shares for one
  // base question should sum to that question's total; where they don't,
  // the rubric is internally inconsistent and every student's total for
  // that question is wrong. Surfacing it here rather than hiding it means
  // a printed rubric can't quietly carry a bad split.
  const byBase = new Map<string, { shares: number; total: number | null }>();
  for (const it of items) {
    const cur = byBase.get(it.base_qid) ?? { shares: 0, total: it.question_marks };
    cur.shares += it.marks ?? 0;
    if (cur.total == null) cur.total = it.question_marks;
    byBase.set(it.base_qid, cur);
  }
  const mismatches = [...byBase.entries()]
    .filter(([, v]) => v.total != null && v.shares !== v.total)
    .map(([base, v]) => ({ baseQid: base, sharesSumTo: v.shares, shouldBe: v.total as number }));

  const trueTotal = [...byBase.values()].reduce((s, v) => s + (v.total ?? 0), 0);
  const shareTotal = [...byBase.values()].reduce((s, v) => s + v.shares, 0);

  if (format !== "html") {
    return NextResponse.json({
      nuancedAnalysis: { id: na.id, title: na.title, subtitle: na.subtitle, course: na.course },
      items,
      totals: { trueTotal, shareTotal },
      markSplitMismatches: mismatches,
    });
  }

  const esc = (s: unknown) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const warningBlock =
    mismatches.length > 0
      ? `<div class="warn">
           <strong>Mark split inconsistency &mdash; ${mismatches.length} question(s).</strong>
           The parts of these questions carry marks that do not sum to the question's own total,
           so totals derived from them will be wrong until corrected:
           <ul>${mismatches
             .map(
               (m) =>
                 `<li><strong>${esc(m.baseQid)}</strong>: parts sum to ${m.sharesSumTo}, should be ${m.shouldBe}</li>`
             )
             .join("")}</ul>
         </div>`
      : "";

  const rowsHtml = items
    .map((it) => {
      const bits: string[] = [];
      if (it.question_text) bits.push(`<div class="qtext">${esc(it.question_text)}</div>`);
      if (it.answer_key) bits.push(`<div class="ans"><span class="lbl">Answer key</span>${esc(it.answer_key)}</div>`);
      if (it.open_rubric)
        bits.push(
          `<div class="ans"><span class="lbl">Open rubric (no single correct answer)</span>${esc(it.open_rubric)}</div>`
        );
      if (it.misconception_context)
        bits.push(`<div class="mis"><span class="lbl">Misconception tested</span>${esc(it.misconception_context)}</div>`);
      if (it.teacher_notes)
        bits.push(`<div class="note"><span class="lbl">Marking note</span>${esc(it.teacher_notes)}</div>`);
      if (!it.answer_key && !it.open_rubric)
        bits.push(`<div class="none">No answer key &mdash; ungraded or open thinking space.</div>`);

      return `<section class="item">
        <h2>${esc(it.qid)}
          <span class="marks">${it.marks == null ? "unmarked" : `${it.marks} mark${it.marks === 1 ? "" : "s"}`}</span>
          ${it.command_term ? `<span class="cmd">${esc(it.command_term)}</span>` : ""}
        </h2>
        ${bits.join("")}
      </section>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Rubric — ${esc(na.title)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font: 11pt/1.45 Georgia, "Times New Roman", serif; color: #16130f; margin: 0; }
  header { border-bottom: 2px solid #16130f; padding-bottom: 10px; margin-bottom: 18px; }
  h1 { font-size: 19pt; margin: 0 0 2px; }
  .sub { color: #5a5148; font-size: 10pt; }
  .totals { margin-top: 6px; font-size: 10pt; color: #5a5148; }
  .warn { border: 1.5px solid #a8631b; background: #fdf4e7; padding: 10px 12px; margin: 0 0 18px;
          font-family: system-ui, sans-serif; font-size: 9.5pt; color: #6b3d0a; }
  .warn ul { margin: 6px 0 0 18px; padding: 0; }
  .item { break-inside: avoid; page-break-inside: avoid; margin: 0 0 14px; padding: 0 0 12px;
          border-bottom: 1px solid #e2dbd1; }
  h2 { font-size: 12pt; margin: 0 0 5px; display: flex; align-items: baseline; gap: 9px; }
  .marks { font-family: system-ui, sans-serif; font-size: 8.5pt; font-weight: 600; color: #3f6b2f;
           background: #eef5ea; border: 1px solid #cfe3c5; border-radius: 3px; padding: 1px 6px; }
  .cmd { font-family: system-ui, sans-serif; font-size: 8.5pt; color: #5a5148; font-weight: 400; }
  .qtext { margin: 4px 0 7px; }
  .lbl { display: block; font-family: system-ui, sans-serif; font-size: 8pt; text-transform: uppercase;
         letter-spacing: .05em; color: #5a5148; margin-bottom: 1px; }
  .ans { background: #f6f3ee; border-left: 3px solid #3f6b2f; padding: 6px 10px; margin: 5px 0; }
  .mis { background: #fdf4e7; border-left: 3px solid #a8631b; padding: 6px 10px; margin: 5px 0; }
  .note { background: #eef2f7; border-left: 3px solid #3a5a80; padding: 6px 10px; margin: 5px 0; }
  .none { color: #857a6d; font-style: italic; font-size: 10pt; }
  footer { margin-top: 20px; padding-top: 8px; border-top: 1px solid #e2dbd1;
           font-family: system-ui, sans-serif; font-size: 8pt; color: #857a6d; }
  @media screen { body { max-width: 820px; margin: 30px auto; padding: 0 22px; } }
</style></head>
<body>
  <header>
    <h1>Marking rubric — ${esc(na.title)}</h1>
    ${na.subtitle ? `<div class="sub">${esc(na.subtitle)}</div>` : ""}
    <div class="sub">${esc(na.course ?? "")}</div>
    <div class="totals">${items.length} entries · ${trueTotal} marks total${
      shareTotal !== trueTotal ? ` · parts currently sum to ${shareTotal}` : ""
    }</div>
  </header>
  ${warningBlock}
  ${rowsHtml}
  <footer>
    Teacher answer key — not for student distribution.
    Generated ${new Date().toISOString().slice(0, 10)} from na_rubric_items.
    To save as PDF: File → Print → Save as PDF.
  </footer>
</body></html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
