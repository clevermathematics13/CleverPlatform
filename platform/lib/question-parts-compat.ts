type PostgrestLikeError = {
  code?: string | null;
  message?: string | null;
};

export const INSTRUCTIONAL_CONTEXT_TERMS_FIELD = "instructional_context_terms";

export function isMissingInstructionalContextTermsColumnError(error: PostgrestLikeError | null | undefined) {
  if (!error) return false;

  const message = error.message?.toLowerCase() ?? "";
  return error.code === "42703" || message.includes(`${INSTRUCTIONAL_CONTEXT_TERMS_FIELD} does not exist`);
}

export function getQuestionPartsSelect(select: string, includeInstructionalContextTerms: boolean) {
  if (includeInstructionalContextTerms) {
    return select;
  }

  return select
    .replace(", instructional_context_terms,", ", ")
    .replace(", instructional_context_terms)", ")")
    .replace("instructional_context_terms, ", "");
}

export function omitInstructionalContextTerms<T extends Record<string, unknown>>(payload: T) {
  const rest = { ...payload };
  delete (rest as { instructional_context_terms?: unknown }).instructional_context_terms;
  return rest;
}

export async function detectInstructionalContextTermsSupport(
  probe: () => Promise<PostgrestLikeError | null | undefined>,
) {
  const error = await probe();
  return !isMissingInstructionalContextTermsColumnError(error);
}

export async function retryWithoutInstructionalContextTerms<Result>(
  run: (includeInstructionalContextTerms: boolean) => Promise<Result>,
  getError: (result: Result) => PostgrestLikeError | null | undefined,
  preferredIncludeInstructionalContextTerms = true,
) {
  const initial = await run(preferredIncludeInstructionalContextTerms);
  if (!isMissingInstructionalContextTermsColumnError(getError(initial))) {
    return {
      result: initial,
      includeInstructionalContextTerms: preferredIncludeInstructionalContextTerms,
    };
  }

  if (!preferredIncludeInstructionalContextTerms) {
    return { result: initial, includeInstructionalContextTerms: false };
  }

  const fallback = await run(false);
  return { result: fallback, includeInstructionalContextTerms: false };
}