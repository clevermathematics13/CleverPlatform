// Shared types, constants, and API helpers for the review page
export { DEFAULT_COMMAND_TERMS } from "@/lib/command-terms";
import { DEFAULT_COMMAND_TERMS } from "@/lib/command-terms";

export function canonicalCommandTerm(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";
  const canonical = DEFAULT_COMMAND_TERMS.find(
    (term) => term.toLowerCase() === trimmed.toLowerCase(),
  );
  return canonical ?? "";
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface QuestionPart {
  id: string;
  part_label: string | null;
  marks: number | null;
  subtopic_codes: string[] | null;
  command_term: string | null;
  sort_order: number;
  content_latex: string | null;
  markscheme_latex: string | null;
  latex_verified: boolean | null;
}

export interface QuestionImage {
  id: string;
  image_type: "question" | "markscheme";
  sort_order: number;
  url?: string | null;
}

export interface PartMetadataVersion {
  id: string;
  part_label: string | null;
  marks: number | null;
  command_term: string | null;
  subtopic_codes: string[] | null;
  sort_order: number;
  changed_by: string | null;
  created_at: string;
}

export interface Question {
  id: string;
  code: string;
  session: string;
  paper: number;
  level: string;
  timezone: string;
  page_image_paths: string[] | null;
  source_pdf_path: string | null;
  has_question_images: boolean;
  has_markscheme_images: boolean;
  google_doc_id?: string | null;
  google_ms_id?: string | null;
  stem_latex?: string | null;
  stem_markscheme_latex?: string | null;
  parts_draft_latex?: string | null;
  parts_draft_markscheme_latex?: string | null;
  question_parts: QuestionPart[];
}

export interface SignedUrl {
  path: string;
  url: string;
}

export type Field = "content_latex" | "markscheme_latex";
export type StemField = "stem_latex" | "stem_markscheme_latex";
export type DraftField = "parts_draft_latex" | "parts_draft_markscheme_latex";

// ─── Helpers ────────────────────────────────────────────────────────────────

export async function getSignedUrls(paths: string[]): Promise<Record<string, string>> {
  const res = await fetch("/api/questions/signed-urls", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths }),
  });
  if (!res.ok) return {};
  const data = (await res.json()) as { urls: SignedUrl[] };
  return Object.fromEntries(data.urls.map((u) => [u.path, u.url]));
}

export async function saveLatex(partId: string, field: Field, value: string) {
  await fetch("/api/questions/latex-update", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ partId, field, value }),
  });
}

export async function saveStemLatex(questionId: string, field: StemField, value: string) {
  await fetch("/api/questions/stem-update", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ questionId, field, value }),
  });
}

export async function saveDraftLatex(questionId: string, field: DraftField, value: string) {
  await fetch("/api/questions/stem-update", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ questionId, field, value }),
  });
}

export async function setVerified(questionId: string, verified: boolean) {
  await fetch("/api/questions/latex-verify", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ questionId, verified }),
  });
}

export type PartMetadataPayload = {
  partLabel: string;
  marks: number | null;
  commandTerm: string;
  subtopicCodes: string[];
};

export async function savePartMetadata(partId: string, payload: PartMetadataPayload): Promise<QuestionPart> {
  const res = await fetch("/api/questions/part-metadata", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ partId, ...payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? "Failed to save metadata");
  return data.part as QuestionPart;
}

export async function createPartMetadata(questionId: string, payload: PartMetadataPayload): Promise<QuestionPart> {
  const res = await fetch("/api/questions/part-metadata", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ questionId, ...payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? "Failed to create part metadata");
  return data.part as QuestionPart;
}

export async function listPartMetadataVersions(partId: string): Promise<PartMetadataVersion[]> {
  const res = await fetch(`/api/questions/part-metadata/revert?partId=${encodeURIComponent(partId)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? "Failed to load metadata history");
  return (data.versions ?? []) as PartMetadataVersion[];
}

export async function revertPartMetadata(partId: string, historyId?: string): Promise<QuestionPart> {
  const res = await fetch("/api/questions/part-metadata/revert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ partId, historyId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? "Failed to revert metadata");
  return data.part as QuestionPart;
}
