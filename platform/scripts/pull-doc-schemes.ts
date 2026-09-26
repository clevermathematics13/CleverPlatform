// Pulls the mark-scheme images of the PPQ questions whose only scheme is a
// Google Doc (ib_questions.google_ms_id: screenshots pasted into a Doc) into
// Storage as question_images rows, so the mark-scheme build
// (scripts/build-mark-schemes.ts) reads them like every other scheme's
// images. Step 5 of that build.
//
// Usage (from platform/):
//   npx tsx scripts/pull-doc-schemes.ts                     # dry run: which questions; no Drive calls, no writes
//   npx tsx scripts/pull-doc-schemes.ts --apply --limit 5
//   npx tsx scripts/pull-doc-schemes.ts --apply --all
//   Options: --codes a,b   --profile <id of the teacher whose Drive token to use>
//
// Images land where Extract all images puts them (<code>/markscheme/NN.ext,
// source_google_doc_id set, part_id null), in the order the Doc shows them
// (lib/google-doc-images.ts). A question that already has any mark-scheme
// image is left alone, so a re-run only picks up what is missing. A Doc that
// Drive no longer has is reported, not unlinked: that is the teacher's call.
//
// Needs SUPABASE_SERVICE_ROLE_KEY, and for --apply GOOGLE_CLIENT_ID and
// GOOGLE_CLIENT_SECRET: the teacher's stored Drive token is refreshed with
// them (lib/google-drive.ts getDriveAuthClientFor).

import { createClient } from "@supabase/supabase-js";
import { getDriveAuthClientFor } from "../lib/google-drive";
import { downloadImage, extensionForType, getDocImages, isDriveFileNotFound } from "../lib/google-doc-images";
import { isBlockedQuestionImage } from "../lib/question-image-filter";
import { fetchAllRows } from "../lib/supabase-paging";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  const v = i >= 0 ? args[i + 1] : undefined;
  return v !== undefined && !v.startsWith("--") ? v : undefined;
};
const APPLY = flag("apply");
const LIMIT = opt("limit") ? Number(opt("limit")) : Infinity;
const CODES = opt("codes")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
if (APPLY && LIMIT === Infinity && !CODES && !flag("all")) {
  throw new Error("--apply writes to Storage and the bank: give --limit, --codes or --all");
}

const supabaseUrl = process.env.SUPABASE_URL ?? "https://qnawglgnoojrlaivylou.supabase.co";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
if (APPLY && (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)) {
  throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required to refresh the stored Drive token");
}
const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

interface DocQuestion {
  id: string;
  code: string;
  google_ms_id: string;
}

/** Questions with a scheme Doc and no mark-scheme image yet, in code order. */
async function selectQuestions(): Promise<DocQuestion[]> {
  const [withDoc, imageRows] = await Promise.all([
    fetchAllRows<DocQuestion>((from, to) =>
      supabase
        .from("ib_questions")
        .select("id, code, google_ms_id")
        .not("google_ms_id", "is", null)
        .order("code")
        .order("id")
        .range(from, to)
    ),
    fetchAllRows<{ question_id: string }>((from, to) =>
      supabase.from("question_images").select("question_id").eq("image_type", "markscheme").order("id").range(from, to)
    ),
  ]);
  const hasImages = new Set(imageRows.map((r) => r.question_id));
  return withDoc
    .filter((q) => !hasImages.has(q.id))
    .filter((q) => !CODES || CODES.includes(q.code))
    .slice(0, LIMIT);
}

/** The teacher whose stored Drive token reads the Docs: --profile, or the only one there is. */
async function driveProfileId(): Promise<string> {
  const given = opt("profile");
  if (given) return given;
  const { data, error } = await supabase.from("google_oauth_tokens").select("profile_id").eq("provider", "google-drive");
  if (error) throw new Error(error.message);
  const ids = [...new Set((data ?? []).map((r) => r.profile_id as string))];
  if (ids.length !== 1) throw new Error(`${ids.length} profiles hold a Drive token; name one with --profile`);
  return ids[0];
}

/**
 * One question's scheme Doc into Storage and question_images. All or
 * nothing: a failure part-way removes what this call wrote, since a question
 * with any scheme image is not picked up again.
 */
async function pullOne(auth: NonNullable<Awaited<ReturnType<typeof getDriveAuthClientFor>>>, q: DocQuestion): Promise<string> {
  const images = await getDocImages(auth, q.google_ms_id);
  const written: string[] = [];
  let blocked = 0;
  try {
    for (const img of images) {
      const { buffer, contentType } = await downloadImage(auth, img.contentUri);
      if (isBlockedQuestionImage(buffer)) {
        blocked += 1;
        continue;
      }
      const storagePath = `${q.code}/markscheme/${String(written.length + 1).padStart(2, "0")}.${extensionForType(contentType)}`;
      const { error: uploadError } = await supabase.storage
        .from("question-images")
        .upload(storagePath, buffer, { contentType, upsert: true });
      if (uploadError) throw new Error(`upload ${storagePath}: ${uploadError.message}`);
      written.push(storagePath);
      const { error: insertError } = await supabase.from("question_images").insert({
        question_id: q.id,
        part_id: null,
        image_type: "markscheme",
        storage_path: storagePath,
        source_google_doc_id: q.google_ms_id,
        sort_order: written.length - 1,
        alt_text: `Markscheme image ${written.length} for ${q.code}`,
      });
      if (insertError) throw new Error(`record ${storagePath}: ${insertError.message}`);
    }
  } catch (e) {
    if (written.length > 0) {
      await supabase.from("question_images").delete().eq("question_id", q.id).in("storage_path", written);
      await supabase.storage.from("question-images").remove(written);
    }
    throw e;
  }
  return `${written.length} image(s)${blocked ? `, ${blocked} blocked placeholder(s) skipped` : ""}${images.length === 0 ? " (the Doc has no images)" : ""}`;
}

async function main(): Promise<void> {
  const questions = await selectQuestions();
  console.log(`${questions.length} question(s) have a scheme Doc and no scheme images${APPLY ? "" : " (dry run)"}.`);
  if (!APPLY) {
    for (const q of questions) console.log(`  ${q.code}`);
    return;
  }
  const profileId = await driveProfileId();
  const auth = await getDriveAuthClientFor(supabase, profileId);
  if (!auth) throw new Error(`Profile ${profileId} has no stored Drive token`);

  let pulled = 0;
  const failed: string[] = [];
  for (const q of questions) {
    try {
      const summary = await pullOne(auth, q);
      pulled += 1;
      console.log(`  ${q.code}: ${summary}`);
    } catch (e) {
      const why = isDriveFileNotFound(e) ? "the Doc is no longer in Drive" : e instanceof Error ? e.message : String(e);
      failed.push(`${q.code}: ${why}`);
      console.log(`  ${q.code}: failed: ${why}`);
    }
    // Keep well inside the Docs API's per-minute quota.
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log(`\n${pulled} pulled, ${failed.length} failed.`);
  if (pulled > 0) console.log("Next: npx tsx scripts/build-mark-schemes.ts selects them like any other questions with scheme images.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
