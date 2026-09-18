/**
 * formative-assessment-pdf.ts
 * -----------------------------------------------------------------------------
 * Render a Formative Assessment's two PDFs and archive them in Storage.
 *
 * WHY THIS EXISTS: until this module, no blank paper was stored anywhere in
 * the system. `/api/assignments/generate-pdf` and `/api/assignments/mark-scheme`
 * stream a PDF straight to the browser and keep nothing, and the sandbox cannot
 * reload a saved assessment -- so once the tab closed, the paper a class had
 * already sat was unrecoverable except by re-rendering it from
 * `tests.custom_content` by hand. Formative Assessment 1, sat by 50 students,
 * was in exactly that state.
 *
 * Both PDFs share ONE browser launch. That is the whole reason archiving fits
 * inside the save request's budget: the launch dominates, the second page costs
 * little, so archiving is barely more expensive than the single-PDF routes the
 * teacher already waits on.
 * -----------------------------------------------------------------------------
 */

import puppeteer, { type Browser } from "puppeteer-core";
import chromium from "@sparticuz/chromium-min";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DocumentOrchestratorService, generateMarkSchemeHtml } from "./document-orchestrator";
import { FormattingRequirementsSchema } from "./template-schema";
import { SCAN_BUCKET } from "./ai-grading";
import type { AssignmentDraft, FormattingRequirements } from "./assignments";
import {
  buildFormativeAssessmentPdfBody,
  assessmentPdfStoragePath,
} from "./formative-assessment-pdf-body";
import { deriveLayoutFromPaper } from "./paper-layout-derive";
import { computeExpansionCaps } from "./evidence-crops";

/**
 * What marks an anchor as this module's to replace rather than a teacher's to
 * protect. Not a CHECK-constrained column, so the value only has to be
 * consistent with itself.
 */
const GENERATED_ANCHOR_SOURCE = "generated";

// Pinned to the same known-good release the two PDF routes use. Keep these in
// step: a mismatch means the archived paper renders on a different Chromium
// than the one the teacher previewed.
const CHROMIUM_REMOTE_URL =
  "https://github.com/Sparticuz/chromium/releases/download/v133.0.0/chromium-v133.0.0-pack.tar";

export type ArchivedPdf = { kind: "paper" | "mark-scheme"; storagePath: string; bytes: number };

export type ArchiveResult =
  | { ok: true; archived: ArchivedPdf[]; layout: LayoutResult }
  | { ok: false; error: string };

/**
 * What became of the paper's answer-box regions. Never a failure of the
 * archive: a paper with no layout is exactly where every paper was before
 * this existed, and the marker's own box still gets a crop.
 */
export type LayoutResult =
  | { status: "written"; anchors: number; pageCount: number; warnings: string[] }
  | { status: "kept-existing"; reason: string }
  | { status: "failed"; reason: string };

async function launchBrowser(): Promise<Browser> {
  if (process.env.VERCEL) {
    const executablePath = await chromium.executablePath(CHROMIUM_REMOTE_URL);
    return puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: chromium.headless,
    });
  }
  return puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    executablePath: process.env.CHROME_EXECUTABLE_PATH,
  });
}

/**
 * Render both PDFs for a draft.
 *
 * The student paper goes through the orchestrator and the mark scheme through
 * `generateMarkSchemeHtml` -- two different renderers, not one renderer with a
 * flag. See buildFormativeAssessmentPdfBody for why that distinction is load-
 * bearing.
 */
export async function renderFormativeAssessmentPdfs(
  draft: AssignmentDraft,
  formatting: FormattingRequirements,
): Promise<{ paper: Buffer; markScheme: Buffer }> {
  const fmt = FormattingRequirementsSchema.parse(formatting);
  const margin = `${fmt.pageMarginsMm}mm`;

  const browser = await launchBrowser();
  try {
    const out: Record<"paper" | "markScheme", Buffer | null> = { paper: null, markScheme: null };

    for (const kind of ["paper", "markScheme"] as const) {
      const body = buildFormativeAssessmentPdfBody(draft, fmt, kind === "markScheme");
      let html: string;
      if (kind === "markScheme") {
        html = generateMarkSchemeHtml({ ...body, formatting: fmt });
      } else {
        const rendered = DocumentOrchestratorService.render(body);
        if (!rendered.success) throw new Error(`student paper render failed: ${rendered.error}`);
        html = rendered.html;
      }

      const page = await browser.newPage();
      try {
        await page.setContent(html, { waitUntil: "load", timeout: 30000 });
        // `load` covers the document's stylesheets, not the @font-face files
        // they fetch lazily -- so without this, page.pdf() can print before a
        // face arrives. KaTeX draws U+2260 as a private-use slash glyph over
        // an `=`, and a missing face drops the slash without dropping the
        // `=`: "n != 0" prints as "n = 0". lib/katex-inline-css.ts removes
        // the fetch entirely; this covers the CDN fallback, and any face a
        // future stylesheet adds.
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        const pdf = await page.pdf({
          format: "A4",
          margin: { top: margin, right: margin, bottom: margin, left: margin },
          printBackground: true,
          displayHeaderFooter: false,
          preferCSSPageSize: true,
        });
        out[kind] = Buffer.from(pdf);
      } finally {
        await page.close();
      }
    }

    return { paper: out.paper!, markScheme: out.markScheme! };
  } finally {
    try {
      await browser.close();
    } catch {
      /* a browser that already died is not a render failure */
    }
  }
}

/**
 * Render and upload both PDFs, then record their paths on the test row.
 *
 * `upsert: true` so re-saving an edited assessment replaces the archive rather
 * than accumulating copies -- a stored paper that no longer matches the draft
 * would be worse than none, because it looks authoritative.
 *
 * Never throws: a failure here must not cost the teacher a save that already
 * succeeded, so it is returned and reported. The caller surfaces it.
 */
/**
 * Record the paper's answer-box regions as this assessment's locked layout.
 *
 * A layout is geometry for ONE printing. This one is derived from the very
 * PDF just archived, so the two cannot disagree -- which is the whole reason
 * to do it here rather than from a re-render later, when a redesigned template
 * or an edited draft would give a different paper than the one students sat.
 *
 * NEVER OVERWRITES A HAND-DRAWN LAYOUT. A teacher who has drawn regions has
 * made decisions about this paper, and a generated layout replacing them
 * silently would destroy that work and stamp the result 'anchor' either way,
 * so it would not even look wrong. Only a layout this function wrote before
 * (every anchor source='generated') is replaced.
 */
async function writeDerivedLayout(
  supabase: SupabaseClient,
  testId: string,
  paperStoragePath: string,
  paper: Buffer
): Promise<LayoutResult> {
  try {
    const { data: active } = await supabase
      .from("test_paper_layouts")
      .select("id")
      .eq("test_id", testId)
      .eq("is_active", true)
      .maybeSingle();

    if (active) {
      const { data: existing } = await supabase
        .from("test_item_anchors")
        .select("source")
        .eq("layout_id", active.id);
      const rows = existing ?? [];
      const handDrawn = rows.some((r) => r.source !== GENERATED_ANCHOR_SOURCE);
      if (handDrawn) {
        return {
          status: "kept-existing",
          reason:
            "this assessment already has a layout with regions drawn by hand, which was left untouched",
        };
      }
    }

    const derived = await deriveLayoutFromPaper(paper);
    if (derived.anchors.length === 0) {
      return {
        status: "failed",
        reason: "no answer-box regions could be read back out of the paper",
      };
    }

    // Replaced, not deleted: the partial unique index allows one active layout
    // per test, and an old one is a record of a previous printing.
    if (active) {
      await supabase.from("test_paper_layouts").update({ is_active: false }).eq("id", active.id);
    }

    const { data: layout, error: layoutError } = await supabase
      .from("test_paper_layouts")
      .insert({
        test_id: testId,
        label: `Generated from the archived paper`,
        reference_storage_path: paperStoragePath,
        reference_kind: "master_upload",
        page_count: derived.pageCount,
        reference_page_sizes: derived.pageSizes,
        anchors_locked: true,
        is_active: true,
      })
      .select("id")
      .single();
    if (layoutError || !layout) {
      return { status: "failed", reason: layoutError?.message ?? "the layout row could not be created" };
    }

    const caps = computeExpansionCaps(
      derived.anchors.map((a) => ({
        pageIndex: a.pageIndex,
        x0Pt: a.x0Pt,
        y0Pt: a.y0Pt,
        x1Pt: a.x1Pt,
        y1Pt: a.y1Pt,
      })),
      derived.pageSizes
    );

    const { error: anchorError } = await supabase.from("test_item_anchors").insert(
      derived.anchors.map((a, i) => ({
        layout_id: layout.id,
        question_number: a.questionNumber,
        part_label: a.partLabel,
        page_index: a.pageIndex,
        x0_pt: a.x0Pt,
        y0_pt: a.y0Pt,
        x1_pt: a.x1Pt,
        y1_pt: a.y1Pt,
        expand_max_x1_pt: caps[i]?.expandMaxX1Pt ?? null,
        expand_max_y1_pt: caps[i]?.expandMaxY1Pt ?? null,
        sort_order: i,
        source: GENERATED_ANCHOR_SOURCE,
      }))
    );
    if (anchorError) {
      // An empty locked layout would make loadLockedLayout return null anyway,
      // but leaving it active would block the next generated one from being
      // recognised as replaceable. Stand it down.
      await supabase.from("test_paper_layouts").update({ is_active: false }).eq("id", layout.id);
      return { status: "failed", reason: anchorError.message };
    }

    return {
      status: "written",
      anchors: derived.anchors.length,
      pageCount: derived.pageCount,
      warnings: derived.warnings,
    };
  } catch (err) {
    return { status: "failed", reason: err instanceof Error ? err.message : "layout derivation failed" };
  }
}

export async function archiveFormativeAssessmentPdfs(
  supabase: SupabaseClient,
  testId: string,
  draft: AssignmentDraft,
  formatting: FormattingRequirements,
): Promise<ArchiveResult> {
  try {
    const { paper, markScheme } = await renderFormativeAssessmentPdfs(draft, formatting);

    const files: Array<{ kind: "paper" | "mark-scheme"; buffer: Buffer }> = [
      { kind: "paper", buffer: paper },
      { kind: "mark-scheme", buffer: markScheme },
    ];

    const archived: ArchivedPdf[] = [];
    for (const { kind, buffer } of files) {
      const storagePath = assessmentPdfStoragePath(testId, kind);
      const { error } = await supabase.storage
        .from(SCAN_BUCKET)
        .upload(storagePath, buffer, { contentType: "application/pdf", upsert: true });
      if (error) return { ok: false, error: `upload of ${kind} failed: ${error.message}` };
      archived.push({ kind, storagePath, bytes: buffer.length });
    }

    // Written only after BOTH uploads land, so a half-archived test never
    // advertises a mark scheme that is not there.
    const { error: updateError } = await supabase
      .from("tests")
      .update({
        paper_pdf_storage_path: assessmentPdfStoragePath(testId, "paper"),
        mark_scheme_pdf_storage_path: assessmentPdfStoragePath(testId, "mark-scheme"),
        assessment_formatting: formatting,
        pdfs_generated_at: new Date().toISOString(),
      })
      .eq("id", testId);
    if (updateError) return { ok: false, error: `recording PDF paths failed: ${updateError.message}` };

    // After the paths are recorded, so a layout can never point at a paper the
    // test does not yet claim as its own.
    const layout = await writeDerivedLayout(
      supabase,
      testId,
      assessmentPdfStoragePath(testId, "paper"),
      paper
    );

    return { ok: true, archived, layout };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "PDF archive failed" };
  }
}
