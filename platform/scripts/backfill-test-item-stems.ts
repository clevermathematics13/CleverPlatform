/**
 * One-off: populate test_items.stem_text on assessments saved before the
 * column existed (migration 20260915122310).
 *
 * WHY A SCRIPT AND NOT A RE-SAVE. syncTestItems() brings a test's rows up to
 * date by deleting every source='custom' row and reinserting them, which is
 * safe for a paper nobody has sat and destructive for one that has been
 * marked: ai_grade_results, mark_changes, student_marks and student_self_scores
 * all reference test_items.id ON DELETE CASCADE. Formative Assessment 1 alone
 * carries 2091 marks, 2378 AI results and 1429 self-scores hanging off rows a
 * re-sync would delete. So this script never deletes: it UPDATEs stem_text on
 * the rows that already exist, and ids -- and everything hanging off them --
 * survive untouched.
 *
 * WHY IT REFUSES TO GUESS. Rows are matched to the draft on
 * (question_number, part_label), which is only sound while the stored rows
 * still describe the stored draft. The script proves that per row by requiring
 * question_text to match the draft's prompt exactly, and skips the whole test
 * if any row disagrees -- a test whose draft has moved on from its items needs
 * a real re-sync (and the decision about its marks), not a stem written onto
 * whatever row happened to be in that position.
 *
 * Reads tests.custom_content through buildTestItemsFromSections rather than
 * walking the JSON itself, so the numbering and the stem rule are the
 * production ones and cannot drift from what a future save will write.
 *
 * Usage (from platform/):
 *   npx tsx scripts/backfill-test-item-stems.ts             # dry run
 *   npx tsx scripts/backfill-test-item-stems.ts --yes
 *   npx tsx scripts/backfill-test-item-stems.ts --test <id> --yes
 */
import { createClient } from "@supabase/supabase-js";
import { buildTestItemsFromSections } from "../lib/formative-assessment-bridge";
import type { AssignmentDraft } from "../lib/assignments";

const APPLY = process.argv.includes("--yes");
const testIdx = process.argv.indexOf("--test");
const ONLY_TEST = testIdx === -1 ? undefined : process.argv[testIdx + 1];

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type ItemRow = {
  id: string;
  question_number: number;
  part_label: string | null;
  question_text: string | null;
  stem_text: string | null;
};

const key = (questionNumber: number, partLabel: string | null) =>
  `${questionNumber}|${partLabel ?? ""}`;

async function main() {
  let query = supabase
    .from("tests")
    .select("id, name, custom_content")
    .not("custom_content", "is", null)
    .order("created_at", { ascending: true });
  if (ONLY_TEST) query = query.eq("id", ONLY_TEST);

  const { data: tests, error } = await query;
  if (error) {
    console.error("Could not list assessments:", error.message);
    process.exit(1);
  }
  if (!tests?.length) {
    console.log("No creator-authored assessments found.");
    process.exit(0);
  }

  let written = 0;
  let skipped = 0;

  for (const test of tests) {
    const draft = test.custom_content as AssignmentDraft;
    const derived = buildTestItemsFromSections(test.id, draft.sections ?? []);

    const { data: itemRows, error: itemsError } = await supabase
      .from("test_items")
      .select("id, question_number, part_label, question_text, stem_text")
      .eq("test_id", test.id)
      .eq("source", "custom");
    if (itemsError) {
      console.log(`${test.name}: SKIPPED -- could not read items (${itemsError.message})`);
      skipped++;
      continue;
    }
    const items = (itemRows ?? []) as ItemRow[];
    const byKey = new Map(items.map((r) => [key(r.question_number, r.part_label), r]));

    // Prove the stored rows still describe the stored draft before writing to
    // any of them. Reported in full rather than row-by-row, so a test that has
    // drifted is one legible finding instead of forty.
    const problems: string[] = [];
    for (const row of derived) {
      const existing = byKey.get(key(row.question_number, row.part_label));
      if (!existing) {
        problems.push(`no row for Q${row.question_number}${row.part_label ? `(${row.part_label})` : ""}`);
      } else if ((existing.question_text ?? "") !== row.question_text) {
        problems.push(
          `Q${row.question_number}${row.part_label ? `(${row.part_label})` : ""} text differs from the draft`,
        );
      }
    }
    if (derived.length !== items.length) {
      problems.push(`draft has ${derived.length} parts, ${items.length} rows stored`);
    }
    if (problems.length > 0) {
      console.log(`${test.name}: SKIPPED -- items do not match the draft:`);
      for (const p of problems.slice(0, 5)) console.log(`    ${p}`);
      if (problems.length > 5) console.log(`    ...and ${problems.length - 5} more`);
      console.log("    Re-sync this test from the creator, deciding first what happens to its marks.");
      skipped++;
      continue;
    }

    const updates = derived
      .map((row) => ({ row, existing: byKey.get(key(row.question_number, row.part_label))! }))
      .filter(({ row, existing }) => (existing.stem_text ?? null) !== (row.stem_text ?? null));

    if (updates.length === 0) {
      console.log(`${test.name}: already correct (${items.length} items)`);
      continue;
    }

    console.log(`${test.name}: ${updates.length} of ${items.length} items need a stem`);
    for (const { row, existing } of updates.slice(0, 3)) {
      const label = `Q${row.question_number}${row.part_label ? `(${row.part_label})` : ""}`;
      console.log(`    ${label}  ${existing.stem_text === null ? "(none)" : "(changed)"} -> ${
        row.stem_text === null ? "(none)" : JSON.stringify(row.stem_text.slice(0, 70))
      }`);
    }
    if (updates.length > 3) console.log(`    ...and ${updates.length - 3} more`);

    if (!APPLY) continue;

    for (const { row, existing } of updates) {
      // By id, so the write cannot touch a row this run did not verify.
      const { error: updateError } = await supabase
        .from("test_items")
        .update({ stem_text: row.stem_text })
        .eq("id", existing.id);
      if (updateError) {
        console.log(`    FAILED on ${existing.id}: ${updateError.message}`);
        continue;
      }
      written++;
    }
  }

  console.log(
    APPLY
      ? `\n${written} row(s) updated, ${skipped} assessment(s) skipped.`
      : `\ndry run -- nothing written, ${skipped} assessment(s) would be skipped. Re-run with --yes.`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
