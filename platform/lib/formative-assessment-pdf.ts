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

// Pinned to the same known-good release the two PDF routes use. Keep these in
// step: a mismatch means the archived paper renders on a different Chromium
// than the one the teacher previewed.
const CHROMIUM_REMOTE_URL =
  "https://github.com/Sparticuz/chromium/releases/download/v133.0.0/chromium-v133.0.0-pack.tar";

export type ArchivedPdf = { kind: "paper" | "mark-scheme"; storagePath: string; bytes: number };

export type ArchiveResult =
  | { ok: true; archived: ArchivedPdf[] }
  | { ok: false; error: string };

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

    return { ok: true, archived };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "PDF archive failed" };
  }
}
