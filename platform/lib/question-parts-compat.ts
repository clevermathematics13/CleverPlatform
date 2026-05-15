type PostgrestLikeError = {
  code?: string | null;
  message?: string | null;
};

/**
 * All question_parts columns added by migrations 035 and 036.
 * If the target database is behind, any of these may be missing.
 */
export const OPTIONAL_QUESTION_PARTS_COLUMNS = [
  // migration 042
  "primary_subtopic_code",
  // migration 040
  "command_terms",
  // migration 035
  "is_hence",
  "is_hence_or_otherwise",
  "is_using",
  "is_deduce",
  "is_verify",
  // migration 036
  "instructional_context_terms",
] as const;

export type OptionalColumn = (typeof OPTIONAL_QUESTION_PARTS_COLUMNS)[number];

/** Returns true when a PostgREST error indicates a missing column (code 42703). */
function isMissingColumnError(error: PostgrestLikeError | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42703" || (error.message?.includes("does not exist") ?? false);
}

/**
 * Probes the target database for each optional column and returns the set of
 * columns that actually exist. Probes run in parallel.
 */
export async function probeQuestionPartsColumns(
  probe: (column: string) => Promise<PostgrestLikeError | null | undefined>,
): Promise<Set<OptionalColumn>> {
  const results = await Promise.all(
    OPTIONAL_QUESTION_PARTS_COLUMNS.map(async (col) => {
      const error = await probe(col);
      return { col, supported: !isMissingColumnError(error) } as const;
    }),
  );
  return new Set(results.filter((r) => r.supported).map((r) => r.col));
}

/**
 * Removes unsupported optional columns from a PostgREST select string.
 * Handles comma-separated fields inside both flat and nested relation selects.
 */
export function stripUnsupportedColumns(select: string, supported: Set<OptionalColumn>): string {
  const stripClause = (clause: string): string => {
    const items: string[] = [];
    let current = "";
    let depth = 0;

    for (let index = 0; index < clause.length; index += 1) {
      const char = clause[index];
      if (char === "," && depth === 0) {
        const item = current.trim();
        if (item) items.push(item);
        current = "";
        continue;
      }

      current += char;
      if (char === "(") depth += 1;
      if (char === ")" && depth > 0) depth -= 1;
    }

    const tail = current.trim();
    if (tail) items.push(tail);

    return items
      .map((item) => {
        const trimmed = item.trim();
        if (!trimmed) return null;

        const openIndex = trimmed.indexOf("(");
        const closeIndex = trimmed.lastIndexOf(")");
        if (openIndex > 0 && closeIndex === trimmed.length - 1) {
          const prefix = trimmed.slice(0, openIndex + 1);
          const inner = trimmed.slice(openIndex + 1, -1);
          const strippedInner = stripClause(inner);
          return strippedInner ? `${prefix}${strippedInner})` : null;
        }

        const fieldName = trimmed.includes(":") ? trimmed.split(":").pop()?.trim() ?? trimmed : trimmed;
        const isOptionalField = (OPTIONAL_QUESTION_PARTS_COLUMNS as readonly string[]).includes(fieldName);
        if (!isOptionalField) return trimmed;
        return supported.has(fieldName as OptionalColumn) ? trimmed : null;
      })
      .filter((item): item is string => Boolean(item))
      .join(", ");
  };

  return stripClause(select);
}

/**
 * Returns a copy of the payload with any unsupported optional columns removed.
 */
export function omitUnsupportedColumns<T extends Record<string, unknown>>(
  payload: T,
  supported: Set<OptionalColumn>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...payload };
  for (const col of OPTIONAL_QUESTION_PARTS_COLUMNS) {
    if (!supported.has(col)) delete result[col];
  }
  return result;
}

// ─── Legacy aliases kept for backward compatibility ──────────────────────────

/** @deprecated Use probeQuestionPartsColumns instead. */
export const INSTRUCTIONAL_CONTEXT_TERMS_FIELD = "instructional_context_terms";

/** @deprecated Use stripUnsupportedColumns instead. */
export function getQuestionPartsSelect(select: string, include: boolean): string {
  if (include) return select;
  const dummy = new Set(OPTIONAL_QUESTION_PARTS_COLUMNS.filter((c) => c !== "instructional_context_terms"));
  return stripUnsupportedColumns(select, dummy);
}

/** @deprecated Use omitUnsupportedColumns instead. */
export function omitInstructionalContextTerms<T extends Record<string, unknown>>(payload: T) {
  const rest: Record<string, unknown> = { ...payload };
  delete rest.instructional_context_terms;
  return rest;
}

/** @deprecated Use probeQuestionPartsColumns instead. */
export async function detectInstructionalContextTermsSupport(
  probe: () => Promise<PostgrestLikeError | null | undefined>,
): Promise<boolean> {
  const error = await probe();
  return !isMissingColumnError(error);
}

/** @deprecated Use probeQuestionPartsColumns + stripUnsupportedColumns instead. */
export async function retryWithoutInstructionalContextTerms<Result>(
  run: (include: boolean) => Promise<Result>,
  getError: (result: Result) => PostgrestLikeError | null | undefined,
  preferred = true,
) {
  const initial = await run(preferred);
  const err = getError(initial);
  if (!isMissingColumnError(err)) {
    return { result: initial, includeInstructionalContextTerms: preferred };
  }
  if (!preferred) {
    return { result: initial, includeInstructionalContextTerms: false };
  }
  const fallback = await run(false);
  return { result: fallback, includeInstructionalContextTerms: false };
}