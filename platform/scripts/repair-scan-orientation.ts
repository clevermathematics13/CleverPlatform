// Finds and fixes upside-down pages in a test's already-uploaded student
// scans, so a class can be re-graded from pages the right way up.
//
// Why this exists: Block A's Key Assessment 1 (14 Sep 2026) was marked from a
// duplex scan in which every EVEN page was rotated 180 degrees. 271 of 504
// graded parts drew their evidence from one of those pages, and the model
// never said so -- it reported 77.9% high confidence on the inverted pages
// against 89.1% on the upright ones. See lib/page-orientation.ts.
//
// NON-DESTRUCTIVE BY DESIGN. Corrected scans are written to a NEW object
// beside the original (same folder, "-upright" before the extension), never
// over it. main is production with real student data and no staging, so the
// evidence of the defect stays on disk and a bad repair can be abandoned by
// ignoring the new file. Nothing in the database is touched at all: this
// script only reads storage, asks Haiku, and writes new objects.
//
// Usage (from platform/):
//   npx tsx scripts/repair-scan-orientation.ts --test <uuid>              # dry run, the default
//   npx tsx scripts/repair-scan-orientation.ts --test <uuid> --limit 1    # one student, to eyeball first
//   npx tsx scripts/repair-scan-orientation.ts --test <uuid> --write      # actually upload
//   npx tsx scripts/repair-scan-orientation.ts --test <uuid> --write --out repair.json
//
// Needs SUPABASE_SERVICE_ROLE_KEY and ANTHROPIC_API_KEY (or
// GRADING_ANTHROPIC_API_KEY). Cost is one Haiku call per page: a 14-student,
// 8-page class is ~112 calls, well under a dollar.
//
// After it runs, re-grade from the "-upright" objects. The queue route accepts
// any storagePath under `${testId}/${studentId}/`, so the new names qualify.

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { PDFDocument } from "pdf-lib";
import { writeFileSync } from "node:fs";
import {
  PAGE_ORIENTATION_MODEL,
  PAGE_ORIENTATION_SYSTEM_PROMPT,
  buildPageOrientationUserPrompt,
  collectInvertedPages,
  correctPageOrientation,
  validatePageOrientation,
  type PageOrientation,
} from "../lib/page-orientation";
import { NA_SCAN_BUCKET } from "../lib/na-scanning";
import { recordUsage } from "../lib/ai-usage";

// -- args ---------------------------------------------------------------------
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string): string | undefined => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const TEST_ID = opt("test");
const WRITE = flag("write");
const LIMIT = opt("limit") ? Number(opt("limit")) : Infinity;
const OUT = opt("out");
/** Marks a corrected copy. Kept out of the timestamp so the pair sorts together. */
const SUFFIX = "-upright";

if (!TEST_ID) throw new Error("--test <uuid> is required");

const supabaseUrl = process.env.SUPABASE_URL ?? "https://qnawglgnoojrlaivylou.supabase.co";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anthropicKey = process.env.ANTHROPIC_API_KEY ?? process.env.GRADING_ANTHROPIC_API_KEY;
if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY (or GRADING_ANTHROPIC_API_KEY) is required");

const supabase = createClient(supabaseUrl, serviceKey);
const anthropic = new Anthropic({ apiKey: anthropicKey });

interface StudentReport {
  studentId: string;
  path: string;
  pageCount: number;
  perPage: PageOrientation[];
  invertedPages: number[];
  correctedPath: string | null;
  skippedReason?: string;
}

/**
 * Ask Haiku about one page, handed to it as a one-page PDF.
 *
 * One page per request, exactly as the cover-page check does: it keeps every
 * request far inside Anthropic's page and size limits whatever the scan's
 * length or resolution, and it means one unreadable page cannot spoil the
 * verdict on its neighbours.
 */
async function checkPage(source: PDFDocument, pageIndex: number, pageCount: number): Promise<PageOrientation> {
  const single = await PDFDocument.create();
  const [copied] = await single.copyPages(source, [pageIndex]);
  single.addPage(copied);
  const bytes = await single.save();

  const message = await anthropic.messages.create({
    model: PAGE_ORIENTATION_MODEL,
    max_tokens: 512,
    system: PAGE_ORIENTATION_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: Buffer.from(bytes).toString("base64") },
          },
          { type: "text", text: buildPageOrientationUserPrompt(pageIndex + 1, pageCount) },
        ],
      },
    ],
  });

  await recordUsage(supabase, {
    pipeline: "scan_orientation",
    model: PAGE_ORIENTATION_MODEL,
    usage: message.usage,
  });

  const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
  const validated = validatePageOrientation(text);
  if (!validated.ok) {
    // An unreadable verdict must not become a rotation. Treated as "upright,
    // low confidence", which collectInvertedPages will not act on.
    console.warn(`    page ${pageIndex + 1}: ${validated.error} -- treating as upright`);
    return { upsideDown: false, confidence: "low", note: validated.error };
  }
  return validated.result;
}

async function main() {
  const { data: objects, error } = await supabase.storage
    .from(NA_SCAN_BUCKET)
    .list(TEST_ID, { limit: 1000 });
  if (error) throw new Error(`Could not list ${TEST_ID}: ${error.message}`);

  // One folder per student; the split PDF is the only .pdf directly inside it.
  const studentIds = (objects ?? []).filter((o) => o.id === null).map((o) => o.name);
  console.log(`test ${TEST_ID}: ${studentIds.length} student folder(s)`);
  if (!WRITE) console.log("DRY RUN -- nothing will be uploaded. Re-run with --write to apply.\n");

  const reports: StudentReport[] = [];
  let processed = 0;

  for (const studentId of studentIds) {
    if (processed >= LIMIT) break;

    const { data: files } = await supabase.storage.from(NA_SCAN_BUCKET).list(`${TEST_ID}/${studentId}`, { limit: 100 });
    const pdfs = (files ?? []).filter((f) => f.name.endsWith(".pdf") && !f.name.includes(SUFFIX));
    if (pdfs.length === 0) {
      reports.push({ studentId, path: "", pageCount: 0, perPage: [], invertedPages: [], correctedPath: null, skippedReason: "no split PDF" });
      continue;
    }
    if (pdfs.length > 1) {
      // Ambiguous: repairing the wrong one would be invisible until a teacher
      // opened the crops. Leave it for a human.
      reports.push({ studentId, path: "", pageCount: 0, perPage: [], invertedPages: [], correctedPath: null, skippedReason: `${pdfs.length} candidate PDFs, cannot choose` });
      continue;
    }

    processed++;
    const path = `${TEST_ID}/${studentId}/${pdfs[0].name}`;
    const { data: file, error: dlErr } = await supabase.storage.from(NA_SCAN_BUCKET).download(path);
    if (dlErr || !file) {
      reports.push({ studentId, path, pageCount: 0, perPage: [], invertedPages: [], correctedPath: null, skippedReason: `download failed: ${dlErr?.message}` });
      continue;
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const pageCount = doc.getPageCount();
    console.log(`\n${studentId} -- ${pageCount} pages`);

    const perPage: PageOrientation[] = [];
    for (let i = 0; i < pageCount; i++) {
      const verdict = await checkPage(doc, i, pageCount);
      perPage.push(verdict);
      const mark = verdict.upsideDown ? (verdict.confidence === "high" ? "INVERTED" : "inverted?") : "upright";
      console.log(`    page ${String(i + 1).padStart(2)}: ${mark.padEnd(10)} (${verdict.confidence}) ${verdict.note}`);
    }

    const { invertedPages } = collectInvertedPages(perPage);
    if (invertedPages.length === 0) {
      console.log(`  -> nothing to correct`);
      reports.push({ studentId, path, pageCount, perPage, invertedPages, correctedPath: null });
      continue;
    }

    console.log(`  -> rotating ${invertedPages.length} page(s): ${invertedPages.map((i) => i + 1).join(", ")}`);
    const corrected = await correctPageOrientation(bytes, invertedPages);
    const correctedPath = path.replace(/\.pdf$/, `${SUFFIX}.pdf`);

    if (WRITE) {
      const { error: upErr } = await supabase.storage
        .from(NA_SCAN_BUCKET)
        .upload(correctedPath, corrected, { contentType: "application/pdf", upsert: true });
      if (upErr) {
        reports.push({ studentId, path, pageCount, perPage, invertedPages, correctedPath: null, skippedReason: `upload failed: ${upErr.message}` });
        console.log(`  !! upload failed: ${upErr.message}`);
        continue;
      }
      console.log(`  -> wrote ${correctedPath}`);
    } else {
      console.log(`  -> would write ${correctedPath} (${(corrected.length / 1e6).toFixed(2)} MB)`);
    }
    reports.push({ studentId, path, pageCount, perPage, invertedPages, correctedPath: WRITE ? correctedPath : null });
  }

  const touched = reports.filter((r) => r.invertedPages.length > 0);
  const skipped = reports.filter((r) => r.skippedReason);
  console.log(`\n=== SUMMARY ===`);
  console.log(`students examined : ${processed}`);
  console.log(`with inversions   : ${touched.length}`);
  console.log(`pages rotated     : ${touched.reduce((n, r) => n + r.invertedPages.length, 0)}`);
  console.log(`skipped           : ${skipped.length}${skipped.length ? " -- " + skipped.map((s) => `${s.studentId.slice(0, 8)}: ${s.skippedReason}`).join("; ") : ""}`);
  console.log(WRITE ? `corrected objects written with the "${SUFFIX}" suffix` : `DRY RUN -- nothing was uploaded`);

  if (OUT) {
    writeFileSync(OUT, JSON.stringify({ testId: TEST_ID, write: WRITE, ranAt: new Date().toISOString(), reports }, null, 2));
    console.log(`report written to ${OUT}`);
  }
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
