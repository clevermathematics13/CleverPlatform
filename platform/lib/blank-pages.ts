import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument } from "pdf-lib";
import { recordUsage } from "./ai-usage";
import { COVER_PAGE_CHECK_MODEL } from "./na-scanning";

/**
 * Blank-page detection for batch scans.
 *
 * The whole-document segmentation call is asked to list blank pages, but it
 * misses them often enough to matter: a class scan of 12-page booklets with
 * an unused back page each came back with every back page "unassigned"
 * (5 Sep 2026, U1_G_Form_1_comp.pdf: pages 12, 24, 36, 48), which the
 * review UI then flags as needing a row. Rather than trust one answer
 * buried in a 48-page read, each unassigned page gets its own cheap
 * single-page question -- the same Haiku-per-page pattern the oversized-
 * upload chunker uses for cover pages -- and only a HIGH-confidence "blank"
 * moves a page out of the way. A page with any student work must never be
 * dropped on a guess; leaving the warning up is the safe failure.
 */

export const BLANK_PAGE_CHECK_MODEL = COVER_PAGE_CHECK_MODEL;

export const BlankPageCheckSchema = z.object({
  /** True only if the page carries no handwriting and no question content. */
  isBlank: z.boolean(),
  confidence: z.enum(["high", "medium", "low"]),
  /** Brief justification, e.g. "empty ruled page, printed footer only". */
  note: z.string().default(""),
});

export type BlankPageCheck = z.infer<typeof BlankPageCheckSchema>;

export const BLANK_PAGE_CHECK_SYSTEM_PROMPT = `You are looking at a single page from a scanned batch of student exam booklets. Decide whether this page is BLANK.

A page is BLANK when it carries no student work and no question content: an unused back page, a page showing only printed page furniture (a header or footer, a page number, ruled lines or a grid, "this page has been left blank"), or scanner noise, faint bleed-through from the other side, and stray marks that are not writing.

A page is NOT blank if it shows ANY handwritten working, answers, diagrams or a name, or ANY printed question or instruction text beyond page furniture. When in doubt, it is NOT blank -- a page wrongly called blank would drop a student's work, while a page wrongly kept only costs a teacher a glance.

Return a JSON object: { "isBlank": boolean, "confidence": "high" | "medium" | "low", "note": string }.`;

/** Whether a check result is strong enough to drop the page from review. */
export function isConfidentlyBlank(check: BlankPageCheck): boolean {
  return check.isBlank && check.confidence === "high";
}

/**
 * Merges freshly confirmed blank pages into a batch's bookkeeping: they
 * join blank_pages and leave unassigned_pages. Pure, so the two routes that
 * do this agree by construction.
 */
export function applyBlankPages(
  current: { blankPages: number[]; unassignedPages: number[] },
  confirmedBlank: number[]
): { blankPages: number[]; unassignedPages: number[] } {
  const blank = new Set([...current.blankPages, ...confirmedBlank]);
  return {
    blankPages: [...blank].sort((a, b) => a - b),
    unassignedPages: current.unassignedPages.filter((p) => !blank.has(p)).sort((a, b) => a - b),
  };
}

export interface BlankPageResult {
  page: number;
  blank: boolean;
  confidence: BlankPageCheck["confidence"] | null;
  note: string;
}

/**
 * Asks the model, one page at a time, whether each of `pages` (1-indexed
 * in `sourceDoc`) is blank. Never throws for a single page: a failed or
 * malformed answer is reported as not blank, which keeps the page in front
 * of the teacher. Pages are checked a few at a time so a long list does
 * not fan out into a burst.
 */
export async function detectBlankPages(args: {
  anthropic: Anthropic;
  supabase: SupabaseClient;
  sourceDoc: PDFDocument;
  pages: number[];
  /** ai_grade_batches.id, for the usage log. */
  batchId?: string;
  concurrency?: number;
}): Promise<BlankPageResult[]> {
  const { anthropic, supabase, sourceDoc, batchId } = args;
  const pageCount = sourceDoc.getPageCount();
  const pages = [...new Set(args.pages)].filter((p) => Number.isInteger(p) && p >= 1 && p <= pageCount);
  const width = Math.max(1, Math.min(args.concurrency ?? 3, pages.length || 1));

  const checkOne = async (page: number): Promise<BlankPageResult> => {
    try {
      const single = await PDFDocument.create();
      const [copied] = await single.copyPages(sourceDoc, [page - 1]);
      single.addPage(copied);
      const data = Buffer.from(await single.save()).toString("base64");

      const message = await anthropic.messages.parse({
        model: BLANK_PAGE_CHECK_MODEL,
        max_tokens: 256,
        system: BLANK_PAGE_CHECK_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data } },
              { type: "text", text: `Is this page blank? Answer with the JSON object only.` },
            ],
          },
        ],
        output_config: { format: zodOutputFormat(BlankPageCheckSchema) },
      });
      await recordUsage(supabase, {
        pipeline: "ai_grade_blank_check",
        model: BLANK_PAGE_CHECK_MODEL,
        usage: message.usage,
        ref: batchId ? { type: "ai_grade_batch", id: batchId } : undefined,
      });

      const parsed = BlankPageCheckSchema.safeParse(message.parsed_output);
      if (!parsed.success) return { page, blank: false, confidence: null, note: "Unreadable answer" };
      return {
        page,
        blank: isConfidentlyBlank(parsed.data),
        confidence: parsed.data.confidence,
        note: parsed.data.note,
      };
    } catch (e) {
      return { page, blank: false, confidence: null, note: e instanceof Error ? e.message : String(e) };
    }
  };

  const results: BlankPageResult[] = new Array(pages.length);
  let next = 0;
  const worker = async () => {
    while (next < pages.length) {
      const i = next++;
      results[i] = await checkOne(pages[i]);
    }
  };
  await Promise.all(Array.from({ length: width }, worker));
  return results;
}
