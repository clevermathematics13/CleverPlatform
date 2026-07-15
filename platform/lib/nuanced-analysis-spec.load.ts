/**
 * nuanced-analysis-spec.load.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Server-only loader that resolves the NuancedAnalysisSpec the generator should
 * use, from the database, with a safe fallback to the code-defined canonical.
 *
 * Resolution order:
 *   1. Read the CANONICAL row for (IBDP, Mathematics, AA, HL) from
 *      public.nuanced_analysis_specs and Zod-validate it. If valid, use it —
 *      this makes the DB the single source of truth, so editing the spec (via
 *      the future "Edit Template" flow) changes generation with no code deploy.
 *   2. If the row is missing or fails validation, fall back to the code-defined
 *      CANONICAL_AAHL_SPEC and best-effort auto-seed it into the table so the DB
 *      becomes authoritative from then on.
 *
 * Everything here is defensive: a DB hiccup must NEVER break packet generation,
 * so all failures degrade quietly to the in-code canonical spec.
 *
 * Must be called with a SERVICE-ROLE Supabase client (the canonical row is
 * owner_id IS NULL and is only writable by the service role under RLS).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { CANONICAL_AAHL_SPEC } from "./nuanced-analysis-spec.defaults";
import {
  validateNuancedAnalysisSpec,
  type NuancedAnalysisSpec,
} from "./nuanced-analysis-spec.schema";

const TABLE = "nuanced_analysis_specs";

/** Course key of the canonical AA HL spec. */
const CANON_COURSE = {
  programme: CANONICAL_AAHL_SPEC.identity.course.programme,
  subject: CANONICAL_AAHL_SPEC.identity.course.subject,
  strand: CANONICAL_AAHL_SPEC.identity.course.strand,
  level: CANONICAL_AAHL_SPEC.identity.course.level,
} as const;

/**
 * Resolve the canonical spec for generation: DB row if present and valid,
 * otherwise the in-code canonical (auto-seeding the DB on the way).
 */
export async function loadCanonicalSpecForGeneration(
  supabase: SupabaseClient
): Promise<NuancedAnalysisSpec> {
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("spec")
      .match({ ...CANON_COURSE, is_canonical: true })
      .maybeSingle();

    if (!error && data && data.spec) {
      const validated = validateNuancedAnalysisSpec(data.spec);
      if (validated.success) return validated.data;
      console.error(
        "[nuanced-spec] canonical DB row failed validation; using in-code fallback.",
        validated.error
      );
    }
  } catch (e) {
    console.error(
      "[nuanced-spec] failed to read canonical spec row; using in-code fallback.",
      e
    );
  }

  // Best-effort seed so the DB becomes the source of truth for next time.
  await seedCanonicalSpec(supabase).catch(() => {});
  return CANONICAL_AAHL_SPEC;
}

/**
 * Insert the in-code canonical spec as the canonical DB row, unless one already
 * exists. A partial unique index guards against races; any error is swallowed
 * by the caller (seeding is never allowed to break generation).
 */
async function seedCanonicalSpec(supabase: SupabaseClient): Promise<void> {
  const existing = await supabase
    .from(TABLE)
    .select("id")
    .match({ ...CANON_COURSE, is_canonical: true })
    .maybeSingle();

  if (existing.data) return; // already seeded

  await supabase.from(TABLE).insert({
    owner_id: null,
    programme: CANON_COURSE.programme,
    subject: CANON_COURSE.subject,
    strand: CANON_COURSE.strand,
    level: CANON_COURSE.level,
    name: CANONICAL_AAHL_SPEC.identity.name,
    spec_version: CANONICAL_AAHL_SPEC.identity.specVersion,
    is_canonical: true,
    spec: CANONICAL_AAHL_SPEC,
  });
}
