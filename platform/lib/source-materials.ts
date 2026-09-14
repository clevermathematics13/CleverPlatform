/**
 * source-materials.ts
 * -----------------------------------------------------------------------------
 * What an assessment can be built FROM.
 *
 * The creator could be told a grade and a topic, and nothing else. That is
 * enough to generate a paper about the right subject and not nearly enough to
 * generate a paper about the right lessons -- the wording a class has met, the
 * worked examples they were shown, the properties they were taught to name.
 * All of that lived outside the prompt, some of it outside the platform.
 *
 * ONE CATALOGUE, TWO ORIGINS. Uploaded files are rows in `source_materials`,
 * with their text pulled out at upload time. Everything the platform produced
 * itself -- Nuanced Analysis packets, authored templates, saved assessments --
 * is NOT copied there: it already holds its content as structured JSON, which
 * is better than the text of its own PDF, and a copy would immediately start
 * disagreeing with the original. So the catalogue reads both and presents one
 * list, with a namespaced id saying which side each entry came from.
 * -----------------------------------------------------------------------------
 */

import type { AssignmentDraft } from "./assignments";

export type SourceMaterialKind = "upload" | "na-packet" | "template" | "assessment";

/** The human label for each origin, used in the picker and in the prompt. */
export const SOURCE_KIND_LABELS: Record<SourceMaterialKind, string> = {
  upload: "Uploaded",
  "na-packet": "Nuanced Analysis packet",
  template: "Authored template",
  assessment: "Saved assessment",
};

/**
 * One catalogue entry, as the picker shows it.
 *
 * `id` is namespaced (`upload:<uuid>`, `na-packet:<uuid>`) because the two
 * origins have independent id spaces and a picker keyed on a bare uuid would
 * collide the first time they overlapped.
 */
export type SourceMaterialSummary = {
  id: string;
  kind: SourceMaterialKind;
  title: string;
  /** Section code, page count, whatever distinguishes this one at a glance. */
  detail: string;
  courseName: string | null;
  gradeLevel: string | null;
  createdAt: string;
  /**
   * False when there is no text to contribute -- a scan with no text layer, or
   * a packet whose content has not been authored yet. Shown as such rather than
   * silently adding nothing to the prompt, which would look like the material
   * was used and ignored.
   */
  usable: boolean;
  /** Roughly how much prompt this entry costs, so the picker can total it. */
  approxChars: number;
  /** Where the file downloads from, for the entries that have one. */
  downloadPath: string | null;
};

export function namespacedId(kind: SourceMaterialKind, id: string): string {
  return `${kind}:${id}`;
}

export function parseNamespacedId(value: string): { kind: SourceMaterialKind; id: string } | null {
  const idx = value.indexOf(":");
  if (idx <= 0) return null;
  const kind = value.slice(0, idx) as SourceMaterialKind;
  if (!(kind in SOURCE_KIND_LABELS)) return null;
  return { kind, id: value.slice(idx + 1) };
}

// -- Turning stored content into text -----------------------------------------

/**
 * An AssignmentDraft as plain text.
 *
 * Mark schemes and answers are included deliberately. This text is only ever
 * sent to the generator, never printed, and a past paper's mark scheme is the
 * clearest statement there is of what a class was expected to be able to do.
 */
export function draftToText(draft: AssignmentDraft): string {
  const lines: string[] = [draft.title, draft.subtitle];
  for (const line of draft.instructions ?? []) lines.push(`- ${line}`);
  for (const section of draft.sections ?? []) {
    lines.push("", `## ${section.heading}`);
    for (const q of section.questions ?? []) {
      lines.push(`Q: ${q.prompt}${q.marks ? ` [${q.marks}]` : ""}`);
      if (q.answer) lines.push(`   answer: ${q.answer}`);
      if (q.markScheme) lines.push(`   mark scheme: ${q.markScheme}`);
      for (const sp of q.subparts ?? []) {
        lines.push(`   - ${sp.prompt}${sp.marks ? ` [${sp.marks}]` : ""}`);
        if (sp.answer) lines.push(`     answer: ${sp.answer}`);
        if (sp.markScheme) lines.push(`     mark scheme: ${sp.markScheme}`);
      }
    }
  }
  for (const p of draft.markingPrinciples ?? []) lines.push(`principle: ${p}`);
  return lines.filter((l) => l !== undefined && l !== null).join("\n").trim();
}

/**
 * Every string worth reading out of an arbitrary JSON blob.
 *
 * For Nuanced Analysis `parts`, whose shape has changed several times and will
 * change again. A structural walker keeps working across those changes where a
 * field-by-field reader would quietly start returning less; the cost is some
 * incidental keys coming along, which the generator can ignore and a schema
 * migration cannot.
 */
export function harvestText(value: unknown, depth = 0): string[] {
  if (depth > 8) return [];
  if (typeof value === "string") {
    const trimmed = value.trim();
    // Skip ids, enum-ish tokens and single words -- they are structure, not prose.
    return trimmed.length > 3 && /\s/.test(trimmed) ? [trimmed] : [];
  }
  if (Array.isArray(value)) return value.flatMap((v) => harvestText(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap((v) => harvestText(v, depth + 1));
  }
  return [];
}

// -- The prompt ----------------------------------------------------------------

/**
 * Per-item and total ceilings on what reaches the model.
 *
 * These are a guard against a runaway upload, NOT a working limit. The first
 * version set them at 24k/90k characters on a worry about the source material
 * drowning out the instructions, and that number was picked without measuring
 * anything: selecting the whole Grade 9 catalogue came to ~107k characters and
 * hit the ceiling on ordinary use.
 *
 * The real budget is the model's. The generator runs on claude-sonnet-5, whose
 * context window is 1M tokens; 107k characters is roughly 27k tokens, under 3%
 * of it. 400k characters is around 100k tokens -- a tenth of the window, three
 * times the entire catalogue as it stands, and still far enough from the edge
 * that the output budget and the thinking tokens are never squeezed.
 *
 * The per-item cap is a fairness rule rather than a capacity one: one enormous
 * document should not crowd every other selection out of the prompt.
 *
 * Truncation that nobody is told about is worse than a limit that is stated,
 * so the caller still reports exactly what was shortened or skipped.
 */
export const SOURCE_TEXT_PER_ITEM = 150_000;
export const SOURCE_TEXT_TOTAL = 400_000;

export type SelectedSource = { title: string; kind: SourceMaterialKind; text: string };

export type SourcePromptResult = {
  /** "" when nothing usable was selected, so the caller can append it blindly. */
  prompt: string;
  /** Titles whose text was shortened, for telling the teacher. */
  truncated: string[];
  /** Titles dropped entirely because the total ran out. */
  dropped: string[];
  charsUsed: number;
};

export function buildSourceMaterialPrompt(sources: SelectedSource[]): SourcePromptResult {
  const truncated: string[] = [];
  const dropped: string[] = [];
  const blocks: string[] = [];
  let used = 0;

  for (const source of sources) {
    const text = source.text.trim();
    if (!text) {
      dropped.push(source.title);
      continue;
    }
    if (used >= SOURCE_TEXT_TOTAL) {
      dropped.push(source.title);
      continue;
    }
    const room = Math.min(SOURCE_TEXT_PER_ITEM, SOURCE_TEXT_TOTAL - used);
    const body = text.length > room ? text.slice(0, room) : text;
    if (body.length < text.length) truncated.push(source.title);
    used += body.length;
    blocks.push(
      `--- SOURCE: ${source.title} (${SOURCE_KIND_LABELS[source.kind]}) ---\n${body}`,
    );
  }

  if (blocks.length === 0) return { prompt: "", truncated, dropped, charsUsed: 0 };

  return {
    prompt: [
      "",
      "SOURCE MATERIAL. The following is what this class has actually been taught.",
      "Build the paper from it: use its vocabulary, its notation, its command terms and the",
      "kinds of context its examples use. Assess what is here rather than what the topic",
      "could in principle cover, and do not introduce a form of words or a technique that",
      "does not appear below. Do NOT copy a question verbatim -- a paper that reprints the",
      "practice set measures memory, not understanding.",
      "",
      ...blocks,
      "--- END SOURCE MATERIAL ---",
    ].join("\n"),
    truncated,
    dropped,
    charsUsed: used,
  };
}
