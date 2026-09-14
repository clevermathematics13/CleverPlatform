/**
 * POST /api/source-materials/resolve — the text behind a picker's selection
 *
 * Kept off the catalogue endpoint deliberately. The catalogue is opened every
 * time the creator tab is, and sending an 18-page study guide's full text to
 * the browser so it can sit unused in React state is a waste of the teacher's
 * connection and their memory. Only the chosen few are resolved, and only when
 * they press Generate.
 *
 * The browser never sees this text either -- it is posted straight into the
 * generator prompt by the caller. Returning it here rather than assembling the
 * prompt server-side keeps the generate call exactly where it already is.
 */

import { NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import {
  parseNamespacedId,
  draftToText,
  harvestText,
  buildSourceMaterialPrompt,
  type SelectedSource,
} from "@/lib/source-materials";
import type { AssignmentDraft } from "@/lib/assignments";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_SELECTED = 12;

export async function POST(req: Request) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  let body: { ids?: unknown };
  try {
    body = (await req.json()) as { ids?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter((v): v is string => typeof v === "string") : [];
  if (ids.length === 0) return NextResponse.json({ prompt: "", truncated: [], dropped: [], charsUsed: 0 });
  if (ids.length > MAX_SELECTED) {
    return NextResponse.json(
      { error: `Select at most ${MAX_SELECTED} pieces of source material at a time.` },
      { status: 400 },
    );
  }

  // Grouped by origin so each table is read once, not once per selected item.
  const byKind = new Map<string, string[]>();
  for (const raw of ids) {
    const parsed = parseNamespacedId(raw);
    if (!parsed) continue;
    const list = byKind.get(parsed.kind) ?? [];
    list.push(parsed.id);
    byKind.set(parsed.kind, list);
  }

  // Keyed lookup, then re-ordered to the selection: the picker's order is the
  // teacher's reading order, and the prompt should follow it.
  const texts = new Map<string, SelectedSource>();

  const uploadIds = byKind.get("upload") ?? [];
  if (uploadIds.length > 0) {
    const { data, error } = await supabase
      .from("source_materials")
      .select("id, title, extracted_text")
      .in("id", uploadIds);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const r of data ?? []) {
      texts.set(`upload:${r.id}`, { title: r.title, kind: "upload", text: r.extracted_text ?? "" });
    }
  }

  const packetIds = byKind.get("na-packet") ?? [];
  if (packetIds.length > 0) {
    const { data, error } = await supabase
      .from("nuanced_analyses")
      .select("id, section_code, title, parts")
      .in("id", packetIds);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const r of data ?? []) {
      texts.set(`na-packet:${r.id}`, {
        title: `${r.section_code ?? ""} ${r.title}`.trim(),
        kind: "na-packet",
        text: harvestText(r.parts).join("\n"),
      });
    }
  }

  const templateIds = byKind.get("template") ?? [];
  if (templateIds.length > 0) {
    // draft_content only: this table has no `parts` column (that is
    // nuanced_analyses). Selecting one made the catalogue route 500.
    const { data, error } = await supabase
      .from("assignment_templates")
      .select("id, template_name, draft_content")
      .in("id", templateIds);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const r of data ?? []) {
      texts.set(`template:${r.id}`, {
        title: r.template_name,
        kind: "template",
        text: r.draft_content ? draftToText(r.draft_content as AssignmentDraft) : "",
      });
    }
  }

  const assessmentIds = byKind.get("assessment") ?? [];
  if (assessmentIds.length > 0) {
    const { data, error } = await supabase
      .from("tests")
      .select("id, name, custom_content")
      .in("id", assessmentIds);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const r of data ?? []) {
      texts.set(`assessment:${r.id}`, {
        title: r.name,
        kind: "assessment",
        text: draftToText(r.custom_content as AssignmentDraft),
      });
    }
  }

  const selected = ids.map((id) => texts.get(id)).filter((s): s is SelectedSource => Boolean(s));
  return NextResponse.json(buildSourceMaterialPrompt(selected));
}
