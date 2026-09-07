/**
 * Run the rubric validator over a Formative Assessment already stored in the
 * database, and print what it finds.
 *
 * The validator's real acceptance test is not its unit tests -- those use
 * schemes chosen to exercise each rule -- but whether it reproduces a careful
 * human audit of a whole paper. This script is how that comparison is made,
 * and how a teacher can check a paper that shipped before the gate existed.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=... npx tsx scripts/audit-rubric.ts --test <testId>
 */
import { createClient } from "@supabase/supabase-js";
import type { AssignmentDraft } from "../lib/assignments";
import { validateRubric, summarizeRubricFindings } from "../lib/rubric-validator";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;

const testId = process.argv[process.argv.indexOf("--test") + 1];
if (!process.argv.includes("--test") || !testId) {
  console.error("--test <testId> is required");
  process.exit(1);
}
if (!URL || !SRK) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  process.exit(1);
}

async function main() {
  const db = createClient(URL!, SRK!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await db
    .from("tests")
    .select("name, custom_content")
    .eq("id", testId)
    .single();

  if (error) {
    console.error("could not load test:", error.message);
    process.exit(1);
  }

  const draft = data.custom_content as AssignmentDraft | null;
  if (!draft?.sections) {
    console.error("this test has no stored draft (custom_content.sections is empty)");
    process.exit(1);
  }

  const findings = validateRubric(draft);
  const summary = summarizeRubricFindings(findings);

  const partCount = draft.sections.reduce(
    (n, s) =>
      n +
      (s.questions ?? []).reduce(
        (m, q) => m + (q.subparts && q.subparts.length > 0 ? q.subparts.length : 1),
        0
      ),
    0
  );

  console.log(`\n${data.name} -- ${partCount} parts\n`);
  console.log(`  blocking: ${summary.blocking}    warnings: ${summary.warnings}`);
  console.log(`  publishable: ${summary.publishable ? "yes" : "NO"}`);

  let lastRule = -1;
  for (const f of findings) {
    if (f.rule !== lastRule) {
      console.log(`\n  Rule ${f.rule} -- ${f.code}`);
      lastRule = f.rule;
    }
    console.log(
      `    [${f.severity === "block" ? "BLOCK" : " warn"}] ${f.part.padEnd(8)} ${f.message}`
    );
  }

  const affected = new Set(findings.map((f) => f.part));
  console.log(`\n  ${affected.size} of ${partCount} parts carry at least one finding.\n`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
