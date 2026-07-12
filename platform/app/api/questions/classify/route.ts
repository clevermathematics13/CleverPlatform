import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getApiTeacher } from "@/lib/auth";
import { IB_CLASSIFY_SYSTEM } from "@/lib/latex-utils";
import { DEFAULT_COMMAND_TERMS } from "@/lib/command-terms";
import { deriveCommandTermFlags, deriveInstructionalContextTerms } from "@/lib/command-term-flags";
import {
  probeQuestionPartsColumns,
  omitUnsupportedColumns,
} from "@/lib/question-parts-compat";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST /api/questions/classify
// Body: { questionId: string }
//
// Re-runs IB subtopic + command-term classification for an existing question and
// writes the results back to each part. This restores the auto-classification that
// used to run inside the Question Studio "Extract LaTeX" flow before the June 2026
// UI rewrite, but does it entirely server-side (atomic — no partial client states),
// self-contained (fetches the canonical subtopics list itself), non-destructively
// (existing subtopics / command terms are preserved when the model returns nothing),
// and with validation hardening (hallucinated subtopic codes and non-canonical
// command terms are dropped rather than persisted or allowed to fail the save).
//
// Marks are intentionally left untouched — they stay under the teacher's control.

type ClaudePart = {
  label?: unknown;
  marks?: unknown;
  commandTerm?: unknown;
  primarySubtopicCode?: unknown;
  subtopicCodes?: unknown;
};

type PartRow = {
  id: string;
  question_id: string;
  part_label: string | null;
  marks: number | null;
  sort_order: number | null;
  content_latex: string | null;
  markscheme_latex: string | null;
  subtopic_codes: string[] | null;
  primary_subtopic_code: string | null;
  command_term: string | null;
  command_terms: string[] | null;
};

function normalizePartLabel(partLabel: unknown): string {
  if (partLabel == null) return "";
  return partLabel
    .toString()
    .trim()
    .toLowerCase()
    .replace(/^\(|\)$/g, "");
}

function canonicalCommandTerm(term: unknown): string | null {
  if (typeof term !== "string") return null;
  const trimmed = term.trim();
  if (!trimmed) return null;
  return (
    DEFAULT_COMMAND_TERMS.find((t) => t.toLowerCase() === trimmed.toLowerCase()) ??
    null
  );
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/** Collapse a list of possibly-duplicated LaTeX blobs into one prompt string.
 *  In the current data model, extraction stores the whole-question LaTeX on every
 *  part, so identical blobs dedupe to a single copy; genuinely per-part LaTeX is
 *  concatenated. */
function joinDistinctLatex(values: (string | null)[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const t = (v ?? "").trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.join("\n\n");
}

export async function POST(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  let body: { questionId?: unknown };
  try {
    body = (await request.json()) as { questionId?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const questionId = body.questionId;
  if (typeof questionId !== "string" || !questionId) {
    return NextResponse.json({ error: "questionId is required" }, { status: 400 });
  }

  // Load the question's parts.
  const { data: partsRaw, error: partsErr } = await supabase
    .from("question_parts")
    .select(
      "id, question_id, part_label, marks, sort_order, content_latex, markscheme_latex, subtopic_codes, primary_subtopic_code, command_term, command_terms",
    )
    .eq("question_id", questionId)
    .order("sort_order", { ascending: true });

  if (partsErr) {
    return NextResponse.json({ error: partsErr.message }, { status: 500 });
  }

  const parts = (partsRaw ?? []) as PartRow[];
  if (parts.length === 0) {
    return NextResponse.json({
      ok: true,
      classified: [],
      note: "No parts on this question yet — add a part before classifying.",
    });
  }

  const questionLatex = joinDistinctLatex(parts.map((p) => p.content_latex));
  const markschemeLatex = joinDistinctLatex(parts.map((p) => p.markscheme_latex));

  if (!questionLatex) {
    return NextResponse.json({
      ok: true,
      classified: [],
      note: "No question LaTeX found — extract the question first, then classify.",
    });
  }

  // Load the canonical subtopics list (self-contained — not reliant on the client).
  const { data: subtopics, error: subErr } = await supabase
    .from("subtopics")
    .select("code, descriptor, section")
    .order("code", { ascending: true });

  if (subErr) {
    return NextResponse.json({ error: subErr.message }, { status: 500 });
  }

  const validCodeSet = new Set((subtopics ?? []).map((s) => s.code));
  const subtopicList = (subtopics ?? [])
    .map((s) => `${s.code}: ${s.descriptor}`)
    .join("\n");

  const knownLabels = parts.map((p) => normalizePartLabel(p.part_label)).filter(Boolean);
  const partsDetected = knownLabels.length
    ? knownLabels.join(", ")
    : "single whole-question part (no sub-parts)";

  // Call Claude. Any model / parsing failure here is soft — the LaTeX that was
  // already extracted stands, and the teacher can classify manually.
  let claudeParts: ClaudePart[] = [];
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
    }
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 4096,
      system: IB_CLASSIFY_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Question LaTeX:\n\`\`\`\n${questionLatex}\n\`\`\`\n\nMark Scheme LaTeX:\n\`\`\`\n${markschemeLatex}\n\`\`\`\n\nAvailable subtopics:\n${subtopicList}\n\nParts detected: ${partsDetected}`,
        },
      ],
    });
    // Claude Sonnet 5 has adaptive thinking on by default and cannot disable it,
    // so response.content[0] is frequently a "thinking" block rather than "text" —
    // find the text block by type instead of assuming it's first.
    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === "text",
    );
    const text = textBlock?.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({
        ok: true,
        classified: [],
        note: "The classifier did not return structured output. Nothing was changed.",
      });
    }
    const parsed = JSON.parse(jsonMatch[0]) as { parts?: unknown };
    claudeParts = Array.isArray(parsed.parts) ? (parsed.parts as ClaudePart[]) : [];
  } catch (err) {
    const message = err instanceof Error ? err.message : "Classification failed";
    return NextResponse.json({
      ok: true,
      classified: [],
      note: `Classifier unavailable (${message}). Nothing was changed — you can set metadata manually.`,
    });
  }

  if (claudeParts.length === 0) {
    return NextResponse.json({
      ok: true,
      classified: [],
      note: "The classifier returned no parts. Nothing was changed.",
    });
  }

  const supportedColumns = await probeQuestionPartsColumns(async (col) => {
    const { error } = await supabase.from("question_parts").select(col).limit(0);
    return error;
  });

  const partByLabel = new Map<string, PartRow>();
  for (const p of parts) partByLabel.set(normalizePartLabel(p.part_label), p);

  const usedIds = new Set<string>();
  const classified: Array<{
    partId: string;
    label: string;
    commandTerm: string | null;
    subtopicCodes: string[];
    primarySubtopicCode: string | null;
    changed: boolean;
  }> = [];
  const unmatched: string[] = [];

  for (const cp of claudeParts) {
    const norm = normalizePartLabel(cp.label);

    // Match by normalized label; fall back to the sole part for whole-question
    // questions where the model may return a non-empty label.
    let target = partByLabel.get(norm);
    if (!target && parts.length === 1) target = parts[0];
    if (!target || usedIds.has(target.id)) {
      unmatched.push(typeof cp.label === "string" ? cp.label : "(unlabelled)");
      continue;
    }
    usedIds.add(target.id);

    const existingSubs = target.subtopic_codes ?? [];

    // Subtopics: keep only codes that exist in the syllabus; if the model returned
    // nothing usable, preserve whatever the part already had.
    const claudeSubs = cleanStringArray(cp.subtopicCodes).filter((c) => validCodeSet.has(c));
    const finalSubs = claudeSubs.length > 0 ? claudeSubs : existingSubs;

    // Primary must always be one of the final subtopic codes.
    const claudePrimary =
      typeof cp.primarySubtopicCode === "string" ? cp.primarySubtopicCode.trim() : "";
    let finalPrimary: string | null;
    if (claudePrimary && finalSubs.includes(claudePrimary)) {
      finalPrimary = claudePrimary;
    } else if (finalSubs.length === 1) {
      finalPrimary = finalSubs[0];
    } else if (target.primary_subtopic_code && finalSubs.includes(target.primary_subtopic_code)) {
      finalPrimary = target.primary_subtopic_code;
    } else {
      finalPrimary = null;
    }

    // Command term: canonicalise; preserve the existing term if the model's term
    // isn't an approved IB command term.
    const claudeTerm = canonicalCommandTerm(cp.commandTerm);
    const finalTerm = claudeTerm ?? target.command_term ?? null;
    const finalTerms = finalTerm ? [finalTerm] : target.command_terms ?? [];

    const sameSubs =
      JSON.stringify([...finalSubs].sort()) === JSON.stringify([...existingSubs].sort());
    const samePrimary = (finalPrimary ?? null) === (target.primary_subtopic_code ?? null);
    const sameTerm = (finalTerm ?? null) === (target.command_term ?? null);
    const changed = !(sameSubs && samePrimary && sameTerm);

    if (changed) {
      // Best-effort history snapshot (parity with part-metadata); never block on it.
      await supabase.from("question_part_metadata_history").insert({
        part_id: target.id,
        question_id: target.question_id,
        part_label: target.part_label ?? "",
        marks: target.marks ?? 1,
        command_term: target.command_term,
        subtopic_codes: existingSubs,
        sort_order: target.sort_order ?? 0,
        changed_by: user.id,
      });

      const update: Record<string, unknown> = {
        subtopic_codes: finalSubs,
        primary_subtopic_code: finalPrimary,
        command_term: finalTerm,
        command_terms: finalTerms,
        ...deriveCommandTermFlags({
          commandTerm: finalTerm,
          sourceLatex: target.content_latex ?? "",
        }),
        instructional_context_terms: deriveInstructionalContextTerms({
          commandTerm: finalTerm,
          sourceLatex: target.content_latex ?? "",
        }),
      };

      const { error: updErr } = await supabase
        .from("question_parts")
        .update(omitUnsupportedColumns(update, supportedColumns))
        .eq("id", target.id);

      if (updErr) {
        return NextResponse.json({ error: updErr.message }, { status: 500 });
      }
    }

    classified.push({
      partId: target.id,
      label: target.part_label ?? "",
      commandTerm: finalTerm,
      subtopicCodes: finalSubs,
      primarySubtopicCode: finalPrimary,
      changed,
    });
  }

  const changedCount = classified.filter((c) => c.changed).length;
  return NextResponse.json({
    ok: true,
    engine: "claude-sonnet-5",
    classified,
    unmatched,
    changedCount,
    note:
      classified.length === 0
        ? "No parts could be matched to the classifier output."
        : undefined,
  });
}
