/**
 * One-off: give every saved Nuanced Analysis packet a `draft_content`.
 *
 * WHY THE PACKETS WOULD NOT RENDER. Seven of the eight rows in
 * nuanced_analyses predate the column. Their content lives in the original
 * per-field columns -- title, subtitle, vocabulary, tok_provocations, parts
 * -- and nothing reads those any more: GET /api/nuanced-analyses/[id] selects
 * draft_content alone, the editor loads draft_content, and the Typst pipeline
 * starts from an AssignmentDraft. So "Open" produced an empty editor and
 * there was no PDF path at all. The packets were not broken; they were
 * invisible to every route written after them.
 *
 * WHY IT CONVERTS RATHER THAN RE-AUTHORS. convertNuancedAnalysisToDraft() is
 * the same function /api/assignments/from-nuanced-analysis already uses to
 * open one of these rows in Assignment Studio, and it already knows all three
 * `parts` encodings the table has accumulated (see the header of
 * lib/nuanced-analysis-bridge.ts). Using it means the persisted draft is
 * exactly what that route has been producing on the fly, so this script
 * changes what is STORED and not what the content is.
 *
 * WHY IT RENDERS BEFORE IT WRITES. A draft that cannot compile is worse than
 * no draft: Typst has no try/catch around eval(.., mode: "math"), so one span
 * it refuses aborts the whole document and the packet still will not print --
 * only now it looks like it should. Every packet is compiled to a real PDF
 * with the production template before its row is touched, and a packet that
 * fails is reported and skipped, never written.
 *
 * WHAT IT DOES NOT TOUCH. `parts` keeps its original encoding: it is what
 * harvestText() reads in app/api/source-materials/route.ts, it still round-
 * trips through the bridge, and rewriting it would put a second, larger
 * change inside a backfill. The first editor save will normalise it through
 * buildPacketContentUpdate. Rubric rows (na_rubric_items) are likewise left
 * alone -- four of these packets are published and their items may already
 * carry marks, and a re-sync deletes and reinserts generated rows.
 *
 * Usage (from platform/):
 *   npx tsx scripts/backfill-na-draft-content.ts               # dry run
 *   npx tsx scripts/backfill-na-draft-content.ts --yes
 *   npx tsx scripts/backfill-na-draft-content.ts --slug <slug> --yes
 *   npx tsx scripts/backfill-na-draft-content.ts --pdf-dir /tmp/na  # keep PDFs
 */
import { createClient } from "@supabase/supabase-js";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  convertNuancedAnalysisToDraft,
  type NuancedAnalysisRow,
} from "../lib/nuanced-analysis-bridge";
import { sanitizeDraft, type AssignmentDraft } from "../lib/assignments";
import { DocumentOrchestratorService } from "../lib/document-orchestrator-nuanced";
import { TypstRenderService } from "../lib/typst-render.service";

const APPLY = process.argv.includes("--yes");
const slugIdx = process.argv.indexOf("--slug");
const ONLY_SLUG = slugIdx === -1 ? undefined : process.argv[slugIdx + 1];
const pdfIdx = process.argv.indexOf("--pdf-dir");
const PDF_DIR = pdfIdx === -1 ? undefined : process.argv[pdfIdx + 1];

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://qnawglgnoojrlaivylou.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  console.error("Missing env: SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

/** Columns the bridge reads, plus the ones this script reports on. */
const SELECT =
  "id, slug, section_code, is_published, title, subtitle, course, syllabus_topics, " +
  "prerequisites, materials, vocabulary, atl_statement, tok_provocations, parts, " +
  "teacher_companion, draft_content";

type Row = NuancedAnalysisRow & {
  section_code: string | null;
  is_published: boolean;
  draft_content: AssignmentDraft | null;
};

/**
 * Compiles the draft exactly as the sandbox's "Download PDF (Typst)" button
 * does -- same orchestrator, same default template, same service -- and
 * returns the page count, or the compiler's own complaint.
 */
async function renderDraft(
  draft: AssignmentDraft
): Promise<{ ok: true; pdf: Buffer; pages: number } | { ok: false; error: string }> {
  const orchestrated = DocumentOrchestratorService.build(draft, undefined, {
    includeTeacherCompanion: true,
    includeAnswerKey: false,
  });
  if (!orchestrated.success) return { ok: false, error: `orchestrator: ${orchestrated.error}` };

  const result = await TypstRenderService.render(orchestrated.payload);
  if (!result.success) {
    return { ok: false, error: [result.error, result.detail].filter(Boolean).join(" — ") };
  }
  return {
    ok: true,
    pdf: result.pdfBuffer,
    pages: result.pageCount ?? countPages(result.pdfBuffer),
  };
}

/** Page count straight off the PDF, for a compiler build that omits it. */
function countPages(pdf: Buffer): number {
  const text = pdf.toString("latin1");
  const counts = [...text.matchAll(/\/Count\s+(\d+)/g)].map((m) => Number(m[1]));
  return counts.length > 0 ? Math.max(...counts) : 0;
}

async function main() {
  let query = supabase.from("nuanced_analyses").select(SELECT).order("created_at");
  if (ONLY_SLUG) query = query.eq("slug", ONLY_SLUG);

  const { data, error } = await query;
  if (error) {
    console.error("Read failed:", error.message);
    process.exit(1);
  }

  const rows = (data ?? []) as unknown as Row[];
  const todo = rows.filter((r) => r.draft_content == null);

  console.log(
    `${rows.length} packet(s); ${todo.length} without draft_content.` +
      (APPLY ? "" : "  (dry run — pass --yes to write)")
  );
  if (PDF_DIR) await mkdir(PDF_DIR, { recursive: true });

  let written = 0;
  let failed = 0;

  for (const row of todo) {
    const label = `${row.slug}${row.section_code ? ` [${row.section_code}]` : ""}`;
    const draft = sanitizeDraft(convertNuancedAnalysisToDraft(row));

    const questions = draft.sections.reduce((n, s) => n + s.questions.length, 0);
    const rendered = await renderDraft(draft);

    if (!rendered.ok) {
      failed += 1;
      console.log(`\n  FAIL  ${label}`);
      console.log(`        ${rendered.error.replace(/\n/g, "\n        ")}`);
      continue;
    }

    if (PDF_DIR) {
      await writeFile(path.join(PDF_DIR, `${row.slug}.pdf`), rendered.pdf);
    }

    console.log(
      `  ok    ${label.padEnd(56)} ${String(draft.sections.length).padStart(2)} parts, ` +
        `${String(questions).padStart(3)} questions, ${String(rendered.pages).padStart(2)} pages` +
        `${row.is_published ? "  (published)" : ""}`
    );

    if (!APPLY) continue;

    const { error: writeError } = await supabase
      .from("nuanced_analyses")
      .update({ draft_content: draft, updated_at: new Date().toISOString() })
      .eq("id", row.id);

    if (writeError) {
      failed += 1;
      console.log(`        WRITE FAILED: ${writeError.message}`);
      continue;
    }
    written += 1;
  }

  console.log(
    `\n${APPLY ? `${written} written` : `${todo.length - failed} ready`}, ${failed} failed.`
  );
  if (failed > 0) process.exit(1);
}

main();
