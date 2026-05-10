import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY.",
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const probes = [
  {
    table: "ib_questions",
    column: "stem_latex",
    migration: "029_stem_latex.sql",
  },
  {
    table: "ib_questions",
    column: "parts_draft_latex",
    migration: "030_parts_draft_latex.sql",
  },
  {
    table: "question_parts",
    column: "is_hence",
    migration: "035_command_term_exception_flags.sql",
  },
  {
    table: "question_parts",
    column: "instructional_context_terms",
    migration: "036_instructional_context_terms.sql",
  },
];

const missing = [];

for (const probe of probes) {
  const { error } = await supabase.from(probe.table).select(probe.column).limit(0);

  if (!error) {
    console.log(`OK ${probe.table}.${probe.column}`);
    continue;
  }

  const message = error.message?.toLowerCase() ?? "";
  if (error.code === "42703" || message.includes(`${probe.column} does not exist`)) {
    missing.push(probe);
    continue;
  }

  console.error(`Unexpected probe failure for ${probe.table}.${probe.column}: ${error.message}`);
  process.exit(1);
}

if (missing.length > 0) {
  console.error("Missing required Supabase schema changes:");
  for (const probe of missing) {
    console.error(`- ${probe.table}.${probe.column} -> run ${probe.migration}`);
  }
  console.error(
    "Note: 037_separate_command_and_context_terms.sql is a data cleanup migration and should also be applied after 036.",
  );
  process.exit(1);
}

console.log("Schema probe passed for deploy-critical question bank columns.");