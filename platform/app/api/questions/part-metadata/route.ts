import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getApiTeacher } from "@/lib/auth";
import { deriveCommandTermFlags, deriveInstructionalContextTerms } from "@/lib/command-term-flags";
import {
  probeQuestionPartsColumns,
  stripUnsupportedColumns,
  omitUnsupportedColumns,
} from "@/lib/question-parts-compat";
import { DEFAULT_COMMAND_TERMS } from "@/lib/command-terms";

type Body = {
  partId?: unknown;
  questionId?: unknown;
  partLabel?: unknown;
  marks?: unknown;
  commandTerm?: unknown;
  commandTerms?: unknown;
  subtopicCodes?: unknown;
  primarySubtopicCode?: unknown;
  sourceLatex?: unknown;
};

type PartMetadataRow = {
  id: string;
  question_id: string;
  part_label: string;
  marks: number;
  command_term: string | null;
  command_terms: string[] | null;
  subtopic_codes: string[] | null;
  sort_order: number;
  instructional_context_terms: string[] | null;
  is_hence: boolean;
  is_hence_or_otherwise: boolean;
  is_using: boolean;
  is_deduce: boolean;
  is_verify: boolean;
};

type PartMetadataSnapshotRow = Pick<
  PartMetadataRow,
  "id" | "question_id" | "part_label" | "marks" | "command_term" | "command_terms" | "subtopic_codes" | "sort_order"
>;

type CurrentPartRow = PartMetadataSnapshotRow & {
  content_latex: string | null;
};

const PART_SELECT = "id, part_label, marks, subtopic_codes, primary_subtopic_code, command_term, command_terms, instructional_context_terms, sort_order, is_hence, is_hence_or_otherwise, is_using, is_deduce, is_verify, content_latex, markscheme_latex, latex_verified";

async function snapshotPartMetadata(
  supabase: Awaited<ReturnType<typeof createClient>>,
  part: PartMetadataSnapshotRow,
  changedBy: string,
) {
  const { error } = await supabase
    .from("question_part_metadata_history")
    .insert({
      part_id: part.id,
      question_id: part.question_id,
      part_label: part.part_label ?? "",
      marks: part.marks ?? 1,
      command_term: part.command_term,
      subtopic_codes: part.subtopic_codes ?? [],
      sort_order: part.sort_order ?? 0,
      changed_by: changedBy,
    });

  return error;
}

function normalizePartLabel(partLabel: unknown): string {
  if (partLabel == null) return "";
  return partLabel
    .toString()
    .trim()
    .toLowerCase()
    .replace(/^\(|\)$/g, "");
}

function parseMarks(marks: unknown): number {
  if (marks == null || marks === "") return 1;
  if (typeof marks === "number" && Number.isFinite(marks)) {
    return Math.max(0, Math.floor(marks));
  }
  throw new Error("marks must be a number or null");
}

function sanitizeSubtopics(subtopicCodes: unknown): string[] {
  if (subtopicCodes === undefined) return [];
  if (!Array.isArray(subtopicCodes)) {
    throw new Error("subtopicCodes must be an array");
  }
  return subtopicCodes
    .filter((c): c is string => typeof c === "string")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

function sortOrderFromLabel(label: string, fallback: number): number {
  if (!label) return 0;
  const m = label.match(/^([a-z])(i|ii|iii|iv|v)?$/);
  if (!m) return fallback;
  const base = (m[1].charCodeAt(0) - 96) * 10;
  const subMap: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5 };
  return base + (m[2] ? subMap[m[2]] ?? 0 : 0);
}

function normalizeCommandTerm(commandTerm: unknown): string | null {
  if (commandTerm == null) return null;
  if (typeof commandTerm !== "string") {
    throw new Error("commandTerm must be a string or null");
  }

  const trimmed = commandTerm.trim();
  if (!trimmed) return null;

  const canonical = DEFAULT_COMMAND_TERMS.find(
    (term) => term.toLowerCase() === trimmed.toLowerCase(),
  );

  if (!canonical) {
    throw new Error(`commandTerm "${trimmed}" is not an approved IB command term`);
  }

  return canonical;
}

function normalizeCommandTerms(commandTerms: unknown): string[] | null {
  if (commandTerms == null) return null;
  if (!Array.isArray(commandTerms)) {
    throw new Error("commandTerms must be an array of allowed command terms");
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of commandTerms) {
    const canonical = normalizeCommandTerm(raw);
    if (!canonical) continue;
    const key = canonical.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(canonical);
  }
  return out;
}

export async function PATCH(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user, profile } = auth;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { partId, partLabel, marks, commandTerm, commandTerms, subtopicCodes, sourceLatex } = body;
  if (typeof partId !== "string" || !partId) {
    return NextResponse.json({ error: "partId is required" }, { status: 400 });
  }

  const supportedColumns = await probeQuestionPartsColumns(async (col) => {
    const { error } = await supabase.from("question_parts").select(col).limit(0);
    return error;
  });

  const currentSelect = stripUnsupportedColumns(
    "id, question_id, part_label, marks, command_term, command_terms, subtopic_codes, sort_order, content_latex, is_hence, is_hence_or_otherwise, is_using, is_deduce, is_verify",
    supportedColumns,
  );

  const { data: currentPartRaw, error: currentErr } = await supabase
    .from("question_parts")
    .select(currentSelect)
    .eq("id", partId)
    .single();

  const currentPart = currentPartRaw as CurrentPartRow | null;

  if (currentErr || !currentPart) {
    return NextResponse.json({ error: "Part not found" }, { status: 404 });
  }

  const update: Record<string, unknown> = {};
  let normalizedLabel: string | undefined;

  if (partLabel !== undefined) {
    if (partLabel !== null && typeof partLabel !== "string") {
      return NextResponse.json({ error: "partLabel must be a string or null" }, { status: 400 });
    }
    normalizedLabel = normalizePartLabel(partLabel);
    update.part_label = normalizedLabel;
  }

  if (normalizedLabel !== undefined) {
    const { data: latestSibling } = await supabase
      .from("question_parts")
      .select("sort_order")
      .eq("question_id", currentPart.question_id)
      .neq("id", partId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    update.sort_order = sortOrderFromLabel(normalizedLabel, (latestSibling?.sort_order ?? 0) + 10);
  }

  if (marks !== undefined) {
    try {
      update.marks = parseMarks(marks);
    } catch {
      return NextResponse.json({ error: "marks must be a number or null" }, { status: 400 });
    }
  }

  if (commandTerms !== undefined) {
    try {
      const normalizedTerms = normalizeCommandTerms(commandTerms) ?? [];
      update.command_terms = normalizedTerms;
      update.command_term = normalizedTerms[0] ?? null;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid commandTerms";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  } else if (commandTerm !== undefined) {
    try {
      const single = normalizeCommandTerm(commandTerm);
      update.command_term = single;
      update.command_terms = single ? [single] : [];
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid commandTerm";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  if (subtopicCodes !== undefined) {
    try {
      update.subtopic_codes = sanitizeSubtopics(subtopicCodes);
    } catch {
      return NextResponse.json({ error: "subtopicCodes must be an array" }, { status: 400 });
    }
  }

  if (body.primarySubtopicCode !== undefined) {
    update.primary_subtopic_code =
      typeof body.primarySubtopicCode === "string" && body.primarySubtopicCode.trim().length > 0
        ? body.primarySubtopicCode.trim()
        : null;
  }

  const sourceText = typeof sourceLatex === "string" ? sourceLatex : "";
  if (commandTerm !== undefined || commandTerms !== undefined || sourceText) {
    const effectiveTerms =
      (update.command_terms as string[] | undefined)
      ?? currentPart.command_terms
      ?? ((update.command_term as string | null | undefined) ? [update.command_term as string] : (currentPart.command_term ? [currentPart.command_term] : []));
    const effectiveTerm = effectiveTerms[0] ?? null;
    const effectiveSource = sourceText || currentPart.content_latex || "";
    const flags = deriveCommandTermFlags({ commandTerm: effectiveTerm, sourceLatex: effectiveSource });
    update.is_hence = flags.is_hence;
    update.is_hence_or_otherwise = flags.is_hence_or_otherwise;
    update.is_using = flags.is_using;
    update.is_deduce = flags.is_deduce;
    update.is_verify = flags.is_verify;
    update.instructional_context_terms = deriveInstructionalContextTerms({
      commandTerm: effectiveTerm,
      sourceLatex: effectiveSource,
    });
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No metadata fields provided" }, { status: 400 });
  }

  const historyErr = await snapshotPartMetadata(supabase, currentPart, user.id);
  if (historyErr) {
    return NextResponse.json({ error: historyErr.message }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("question_parts")
    .update(omitUnsupportedColumns(update, supportedColumns))
    .eq("id", partId)
    .select(stripUnsupportedColumns(PART_SELECT, supportedColumns))
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, part: data });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role !== "teacher") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const partId = searchParams.get("partId");
  if (!partId) {
    return NextResponse.json({ error: "partId is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("question_parts")
    .delete()
    .eq("id", partId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role !== "teacher") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { questionId, partLabel, marks, commandTerm, commandTerms, subtopicCodes, primarySubtopicCode, sourceLatex } = body;
  if (typeof questionId !== "string" || !questionId) {
    return NextResponse.json({ error: "questionId is required" }, { status: 400 });
  }

  const label = normalizePartLabel(partLabel);
  const marksValue = (() => {
    try {
      return parseMarks(marks);
    } catch {
      return null;
    }
  })();
  if (marksValue == null) {
    return NextResponse.json({ error: "marks must be a number or null" }, { status: 400 });
  }

  let commandTermsValue: string[] = [];
  try {
    if (commandTerms !== undefined) {
      commandTermsValue = normalizeCommandTerms(commandTerms) ?? [];
    } else {
      const single = normalizeCommandTerm(commandTerm);
      commandTermsValue = single ? [single] : [];
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid commandTerm(s)";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  const commandTermValue = commandTermsValue[0] ?? null;

  let codes: string[];
  try {
    codes = sanitizeSubtopics(subtopicCodes);
  } catch {
    return NextResponse.json({ error: "subtopicCodes must be an array" }, { status: 400 });
  }

  const { data: existing } = await supabase
    .from("question_parts")
    .select("sort_order")
    .eq("question_id", questionId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const fallbackSort = (existing?.sort_order ?? 0) + 10;
  const sortOrder = sortOrderFromLabel(label, fallbackSort);

  const insertPayload = {
    question_id: questionId,
    part_label: label,
    marks: marksValue,
    command_term: commandTermValue,
    command_terms: commandTermsValue,
    ...deriveCommandTermFlags({
      commandTerm: commandTermValue,
      sourceLatex: typeof sourceLatex === "string" ? sourceLatex : "",
    }),
    instructional_context_terms: deriveInstructionalContextTerms({
      commandTerm: commandTermValue,
      sourceLatex: typeof sourceLatex === "string" ? sourceLatex : "",
    }),
    subtopic_codes: codes,
    primary_subtopic_code:
      typeof primarySubtopicCode === "string" && primarySubtopicCode.trim().length > 0
        ? primarySubtopicCode.trim()
        : null,
    sort_order: sortOrder,
  };

  const supportedColumns = await probeQuestionPartsColumns(async (col) => {
    const { error } = await supabase.from("question_parts").select(col).limit(0);
    return error;
  });

  const { data: insertResult, error: insertError } = await supabase
    .from("question_parts")
    .insert(omitUnsupportedColumns(insertPayload, supportedColumns))
    .select(stripUnsupportedColumns(PART_SELECT, supportedColumns))
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      const labelText = label ? `'${label}'` : "(empty label)";
      return NextResponse.json(
        { error: `Part label ${labelText} already exists for this question` },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, part: insertResult });
}
