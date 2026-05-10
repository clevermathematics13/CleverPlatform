"use client";

import { useState, useCallback, useEffect, useMemo, useRef, forwardRef, useImperativeHandle } from "react";
import LatexRenderer from "@/components/LatexRenderer";
import { IB_CORRECTION_SYSTEM } from "@/lib/latex-utils";
import { splitDraftIntoParts } from "./split-draft-into-parts";
import { playChatCompletionChime } from "@/lib/chat-audio";

const DEFAULT_COMMAND_TERMS = [
  "Calculate",
  "Classify",
  "Comment",
  "Compare",
  "Complete",
  "Construct",
  "Copy",
  "Deduce",
  "Demonstrate",
  "Describe",
  "Determine",
  "Differentiate",
  "Distinguish",
  "Draw",
  "Estimate",
  "Evaluate",
  "Expand",
  "Explain",
  "Express",
  "Factorise",
  "Find",
  "Give",
  "Hence",
  "Identify",
  "Integrate",
  "Interpret",
  "Investigate",
  "Justify",
  "Label",
  "Let",
  "List",
  "Mark",
  "Measure",
  "Outline",
  "Plot",
  "Predict",
  "Prove",
  "Represent",
  "Show",
  "Simplify",
  "Sketch",
  "Solve",
  "State",
  "Suggest",
  "Trace",
  "Using",
  "Verify",
  "Write down",
];

function canonicalCommandTerm(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";
  const canonical = DEFAULT_COMMAND_TERMS.find(
    (term) => term.toLowerCase() === trimmed.toLowerCase(),
  );
  return canonical ?? "";
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface QuestionPart {
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

interface QuestionImage {
  id: string;
  image_type: "question" | "markscheme";
  sort_order: number;
  url?: string | null;
}

interface PartMetadataVersion {
  id: string;
  part_label: string | null;
  marks: number | null;
  command_term: string | null;
  subtopic_codes: string[] | null;
  sort_order: number;
  changed_by: string | null;
  created_at: string;
}

interface Question {
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

interface SignedUrl {
  path: string;
  url: string;
}

type Field = "content_latex" | "markscheme_latex";
type StemField = "stem_latex" | "stem_markscheme_latex";
type DraftField = "parts_draft_latex" | "parts_draft_markscheme_latex";

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getSignedUrls(paths: string[]): Promise<Record<string, string>> {
  const res = await fetch("/api/questions/signed-urls", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths }),
  });
  if (!res.ok) return {};
  const data = (await res.json()) as { urls: SignedUrl[] };
  return Object.fromEntries(data.urls.map((u) => [u.path, u.url]));
}

async function saveLatex(partId: string, field: Field, value: string) {
  await fetch("/api/questions/latex-update", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ partId, field, value }),
  });
}

async function saveStemLatex(questionId: string, field: StemField, value: string) {
  await fetch("/api/questions/stem-update", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ questionId, field, value }),
  });
}

async function saveDraftLatex(questionId: string, field: DraftField, value: string) {
  await fetch("/api/questions/stem-update", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ questionId, field, value }),
  });
}

async function setVerified(questionId: string, verified: boolean) {
  await fetch("/api/questions/latex-verify", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ questionId, verified }),
  });
}

type PartMetadataPayload = {
  partLabel: string;
  marks: number | null;
  commandTerm: string;
  subtopicCodes: string[];
};

async function savePartMetadata(partId: string, payload: PartMetadataPayload): Promise<QuestionPart> {
  const res = await fetch("/api/questions/part-metadata", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ partId, ...payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? "Failed to save metadata");
  return data.part as QuestionPart;
}

async function createPartMetadata(questionId: string, payload: PartMetadataPayload): Promise<QuestionPart> {
  const res = await fetch("/api/questions/part-metadata", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ questionId, ...payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? "Failed to create part metadata");
  return data.part as QuestionPart;
}

async function listPartMetadataVersions(partId: string): Promise<PartMetadataVersion[]> {
  const res = await fetch(`/api/questions/part-metadata/revert?partId=${encodeURIComponent(partId)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? "Failed to load metadata history");
  return (data.versions ?? []) as PartMetadataVersion[];
}

async function revertPartMetadata(partId: string, historyId?: string): Promise<QuestionPart> {
  const res = await fetch("/api/questions/part-metadata/revert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ partId, historyId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? "Failed to revert metadata");
  return data.part as QuestionPart;
}

// ─── CommandTermCombobox ───────────────────────────────────────────────────────
function CommandTermCombobox({
  value,
  onChange,
  disabled,
  options,
  className,
  onEnterCommit,
  "data-part-id": dataPartId,
  "data-field": dataField,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  options: string[];
  className?: string;
  onEnterCommit?: () => void;
  "data-part-id"?: string;
  "data-field"?: string;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);

  // Sync display text when value changes externally
  if (query !== value && !open) setQuery(value);

  const filtered = query.trim()
    ? options.filter((o) => o.toLowerCase().startsWith(query.trim().toLowerCase()))
    : options;
  const topMatch = filtered[0] ?? null;

  function commit(term: string) {
    onChange(term);
    setQuery(term);
    setOpen(false);
  }

  return (
    <div className="relative">
      <input
        value={query}
        disabled={disabled}
        data-part-id={dataPartId}
        data-field={dataField}
        placeholder="Term…"
        autoComplete="off"
        className={className}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (e.target.value === "") onChange("");
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Delay so onMouseDown on a list item fires first
          setTimeout(() => {
            setOpen(false);
            const match = options.find(
              (o) => o.toLowerCase() === query.trim().toLowerCase()
            );
            if (match) onChange(match);
            else setQuery(value); // revert if not a valid term
          }, 120);
        }}
        onKeyDown={(e) => {
          if (e.key === "Tab") {
            if (topMatch) commit(topMatch);
            // allow natural Tab to move focus
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (topMatch) commit(topMatch);
            onEnterCommit?.();
          } else if (e.key === "Escape") {
            setOpen(false);
            setQuery(value);
          } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault(); // prevent scroll
          }
        }}
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-50 top-full left-0 right-0 max-h-40 overflow-auto bg-white border border-slate-300 rounded shadow-md text-xs">
          {filtered.map((term, i) => (
            <li
              key={term}
              onMouseDown={(e) => { e.preventDefault(); commit(term); }}
              className={`px-2 py-1 cursor-pointer ${i === 0 ? "bg-blue-50 text-blue-700 font-medium" : "hover:bg-slate-100"}`}
            >
              {term}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── DraftPartsPanel ──────────────────────────────────────────────────────────
// Staged whole-question extraction: OCR extracts all labelled parts as one
// block; the "Split & apply" button auto-splits it by (a)/(b)/... labels and
// populates the stem editor + individual part editors directly.

// splitDraftIntoParts imported from ./split-draft-into-parts

interface DraftPartsPanelHandle {
  runOcrAndApply: (field?: Field) => void;
}

const DraftPartsPanel = forwardRef<DraftPartsPanelHandle, {
  questionId: string;
  draftLatex: string | null;
  draftMarkschemeLatex: string | null;
  activeField: Field;
  parts: QuestionPart[];
  onSave: (field: DraftField, value: string) => void;
  onApply: (sourceField: Field, stem: string, parts: Map<string, string>) => void;
  onOcrLoadingChange?: (loading: boolean) => void;
}>(function DraftPartsPanel({
  questionId,
  draftLatex,
  draftMarkschemeLatex,
  activeField,
  parts: questionParts,
  onSave,
  onApply,
  onOcrLoadingChange,
}, ref) {
  const draftField: DraftField =
    activeField === "content_latex"
      ? "parts_draft_latex"
      : "parts_draft_markscheme_latex";
  const [text, setText] = useState(
    activeField === "content_latex" ? (draftLatex ?? "") : (draftMarkschemeLatex ?? "")
  );
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const draftFieldFor = (field: Field): DraftField =>
    field === "content_latex" ? "parts_draft_latex" : "parts_draft_markscheme_latex";

  const imageTypeFor = (field: Field): "question" | "markscheme" =>
    field === "content_latex" ? "question" : "markscheme";

  // Sync text when activeField changes
  const prevField = useRef(activeField);
  if (prevField.current !== activeField) {
    prevField.current = activeField;
    setText(activeField === "content_latex" ? (draftLatex ?? "") : (draftMarkschemeLatex ?? ""));
  }

  const runOcrAndApply = useCallback(async (fieldOverride?: Field) => {
    const sourceField: Field = fieldOverride ?? activeField;
    const targetDraftField = draftFieldFor(sourceField);
    const targetImageType = imageTypeFor(sourceField);

    onOcrLoadingChange?.(true);
    setOcrError(null);
    try {
      // Step 1: Check if images exist for this field (fast check)
      const checkRes = await fetch("/api/questions/ocr-direct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId, imageType: targetImageType }),
      });
      const checkData = await checkRes.json().catch(() => ({}));
      if (!checkRes.ok) {
        setOcrError(checkData.error ?? "Failed to check for images");
        return;
      }

      const { hasImages, imageCount } = checkData;
      if (!hasImages || imageCount === 0) {
        setOcrError(
          targetImageType === "markscheme"
            ? `No mark scheme images found. Run Extract All Images first, or check the Mark Scheme Doc link.`
            : `No question images found. Run Extract All Images first, or check the Question Doc link.`
        );
        return;
      }

      // Step 2: Run OCR on existing images
      const res = await fetch("/api/questions/ocr-latex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId, field: targetDraftField }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOcrError(data.error ?? "OCR failed");
        return;
      }
      const latex: string = data.latex ?? "";
      setText(latex);
      onSave(targetDraftField, latex);
      // Immediately split and apply
      const partLabels = questionParts.map((p) => p.part_label ?? "");
      const { stem, parts: splitParts } = splitDraftIntoParts(latex, partLabels);
      onApply(sourceField, stem, splitParts);
    } catch {
      setOcrError("Network error");
    } finally {
      onOcrLoadingChange?.(false);
    }
  }, [activeField, onApply, onOcrLoadingChange, onSave, questionId, questionParts]);

  useImperativeHandle(ref, () => ({
    runOcrAndApply,
  }));

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }

  const imageLabel = activeField === "content_latex" ? "question" : "mark scheme";
  void imageLabel;

  return (
    <div className="border border-amber-200 rounded-lg overflow-hidden bg-amber-50/30">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200">
        <span className="font-semibold text-sm text-amber-800">
          Extracted draft
          <span className="text-amber-500 font-normal ml-1 text-xs">(review or edit below, then apply)</span>
        </span>
      </div>

      {/* Error banner */}
      {ocrError && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-xs text-red-700 font-medium">
          ⚠ {ocrError}
        </div>
      )}

      {/* Textarea */}
      <div className="p-3 space-y-2">
        <textarea
          name={draftField}
          className="w-full border border-amber-200 rounded-md p-2 font-mono text-xs resize-y min-h-24 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-400"
          placeholder="Click ⟳ Extract & apply above to populate automatically, or paste/type LaTeX here and use Apply below…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex gap-2">
          <button
            onClick={copyToClipboard}
            disabled={!text}
            className="px-3 py-1 bg-gray-100 text-gray-700 rounded text-xs font-medium hover:bg-gray-200 disabled:opacity-40"
          >
            {copied ? "✓ Copied" : "Copy"}
          </button>
          <button
            onClick={() => onSave(draftField, text)}
            disabled={!text}
            className="px-3 py-1 bg-amber-600 text-white rounded text-xs font-medium hover:bg-amber-700 disabled:opacity-40"
          >
            Save draft
          </button>
          <button
            onClick={() => {
              const partLabels = questionParts.map((p) => p.part_label ?? "");
              const { stem, parts: splitParts } = splitDraftIntoParts(text, partLabels);
              onApply(activeField, stem, splitParts);
            }}
            disabled={!text}
            className="px-3 py-1 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700 disabled:opacity-40"
            title="Split what's in the textarea and apply to editors (use after manual edits)"
          >
            ↓ Apply to editors
          </button>
        </div>
      </div>
    </div>
  );
});

// ─── StemEditor ─────────────────────────────────────────────────────────────

function StemEditor({
  questionId,
  stemLatex,
  stemMarkschemeLatex,
  pageImageUrl,
  activeField,
  onSave,
}: {
  questionId: string;
  stemLatex: string | null;
  stemMarkschemeLatex: string | null;
  pageImageUrl: string | null;
  activeField: Field;
  onSave: (field: StemField, value: string) => void;
}) {
  const stemField: StemField =
    activeField === "content_latex" ? "stem_latex" : "stem_markscheme_latex";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<StemField, string>>({
    stem_latex: stemLatex ?? "",
    stem_markscheme_latex: stemMarkschemeLatex ?? "",
  });
  const [claudeInstruction, setClaudeInstruction] = useState("");
  const [claudeLoading, setClaudeLoading] = useState(false);

  // Sync internal draft when parent updates the value (e.g. from Split & apply)
  useEffect(() => {
    if (!editing) {
      setDraft({
        stem_latex: stemLatex ?? "",
        stem_markscheme_latex: stemMarkschemeLatex ?? "",
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stemLatex, stemMarkschemeLatex]);

  const currentLatex = draft[stemField];

  async function runClaude() {
    if (!claudeInstruction.trim()) return;
    setClaudeLoading(true);
    const messages: { role: "user"; content: ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[] }[] = [
      {
        role: "user",
        content: [
          ...(pageImageUrl
            ? [{ type: "image_url" as const, image_url: { url: pageImageUrl } }]
            : []),
          {
            type: "text" as const,
            text: `Here is the current LaTeX for the question stem:\n\n\`\`\`\n${currentLatex}\n\`\`\`\n\nInstruction: ${claudeInstruction}\n\nReturn ONLY the corrected LaTeX, nothing else.`,
          },
        ],
      },
    ];
    try {
      const res = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ system: IB_CORRECTION_SYSTEM, messages }),
      });
      const data = await res.json();
      const corrected: string = data?.content?.[0]?.text ?? data?.completion ?? "";
      if (corrected) {
        setDraft((d) => ({ ...d, [stemField]: corrected.trim() }));
        void playChatCompletionChime();
      }
    } finally {
      setClaudeLoading(false);
      setClaudeInstruction("");
    }
  }

  function save() {
    onSave(stemField, draft[stemField]);
    setEditing(false);
  }

  return (
    <div className="border border-indigo-200 rounded-lg overflow-hidden bg-indigo-50/30">
      {/* Stem header */}
      <div className="flex items-center gap-3 px-4 py-2 bg-indigo-50 border-b border-indigo-200">
        <span className="font-semibold text-sm text-indigo-800">
          Initial question
          <span className="text-indigo-400 font-normal ml-1 text-xs">(stem — shared across all parts)</span>
        </span>
      </div>

      {/* Content */}
      <div className="p-4 space-y-3">
        {editing ? (
          <textarea
            name={stemField}
            className="w-full border border-indigo-300 rounded-md p-2 font-mono text-sm resize-y min-h-32 text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            value={draft[stemField]}
            onChange={(e) => setDraft((d) => ({ ...d, [stemField]: e.target.value }))}
          />
        ) : (
          <div className="min-h-16 text-sm leading-relaxed">
            {draft[stemField] ? (
              <LatexRenderer latex={draft[stemField]} graphImageUrl={pageImageUrl} />
            ) : (
              <span className="text-gray-400 italic">No LaTeX content</span>
            )}
          </div>
        )}

        {/* Action row */}
        <div className="flex gap-2">
          {editing ? (
            <>
              <button
                onClick={save}
                className="px-3 py-1.5 bg-indigo-600 text-white rounded text-xs font-medium hover:bg-indigo-700"
              >
                Save
              </button>
              <button
                onClick={() => setEditing(false)}
                className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded text-xs font-medium hover:bg-gray-200"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setEditing(true)}
                className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded text-xs font-medium hover:bg-gray-200"
              >
                Edit LaTeX
              </button>
            </>
          )}
        </div>

        {/* Claude correction row */}
        <div className="flex gap-2 pt-1 border-t border-indigo-100">
          <input
            name={`claude-instruction-${stemField}`}
            type="text"
            placeholder="Correction for Claude, e.g. 'fix the fraction in line 2'..."
            value={claudeInstruction}
            onChange={(e) => setClaudeInstruction(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runClaude()}
            className="flex-1 border border-gray-300 rounded-md px-3 py-1.5 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-400"
          />
          <button
            onClick={runClaude}
            disabled={claudeLoading || !claudeInstruction.trim()}
            className="px-3 py-1.5 bg-purple-600 text-white rounded text-xs font-medium hover:bg-purple-700 disabled:opacity-40"
          >
            {claudeLoading ? "…" : "Ask Claude"}
          </button>
        </div>

        {/* OCR note */}
        <div className="pt-1 border-t border-indigo-100">
          <p className="text-xs text-indigo-400 italic">
            Stem is auto-populated from the &ldquo;Extracted draft&rdquo; panel below — click &ldquo;Extract &amp; apply&rdquo;.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── PartEditor ─────────────────────────────────────────────────────────────

function PartEditor({
  part,
  questionId,
  pageImageUrl,
  activeField,
  onSave,
}: {
  part: QuestionPart;
  questionId: string;
  pageImageUrl: string | null;
  activeField: Field;
  onSave: (partId: string, field: Field, value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<Field, string>>({
    content_latex: part.content_latex ?? "",
    markscheme_latex: part.markscheme_latex ?? "",
  });
  const [claudeInstruction, setClaudeInstruction] = useState("");
  const [claudeLoading, setClaudeLoading] = useState(false);

  // Sync internal draft when parent updates the value (e.g. from Split & apply)
  useEffect(() => {
    if (!editing) {
      setDraft({
        content_latex: part.content_latex ?? "",
        markscheme_latex: part.markscheme_latex ?? "",
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [part.content_latex, part.markscheme_latex]);

  const currentLatex = draft[activeField];

  async function runClaude() {
    if (!claudeInstruction.trim()) return;
    setClaudeLoading(true);
    const messages: { role: "user"; content: ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[] }[] = [
      {
        role: "user",
        content: [
          ...(pageImageUrl
            ? [{ type: "image_url" as const, image_url: { url: pageImageUrl } }]
            : []),
          {
            type: "text" as const,
            text: `Here is the current LaTeX for this question part:\n\n\`\`\`\n${currentLatex}\n\`\`\`\n\nInstruction: ${claudeInstruction}\n\nReturn ONLY the corrected LaTeX, nothing else.`,
          },
        ],
      },
    ];

    try {
      const res = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: IB_CORRECTION_SYSTEM,
          messages,
        }),
      });
      const data = await res.json();
      const corrected: string =
        data?.content?.[0]?.text ?? data?.completion ?? "";
      if (corrected) {
        setDraft((d) => ({ ...d, [activeField]: corrected.trim() }));
        void playChatCompletionChime();
      }
    } finally {
      setClaudeLoading(false);
      setClaudeInstruction("");
    }
  }

  function save() {
    onSave(part.id, activeField, draft[activeField]);
    setEditing(false);
  }

  const label = part.part_label
    ? `Part ${part.part_label.toUpperCase()}`
    : "Whole question";
  const marks = part.marks != null ? ` [${part.marks} mark${part.marks !== 1 ? "s" : ""}]` : "";

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Part header */}
      <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 border-b border-gray-200">
        <span className="font-semibold text-sm text-gray-800">
          {label}
          <span className="text-gray-400 font-normal">{marks}</span>
        </span>
        {part.latex_verified && (
          <span className="ml-auto text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
            ✓ Verified
          </span>
        )}
      </div>

      {/* Content */}
      <div className="p-4 space-y-3">
        {editing ? (
          <textarea
            name={`${part.id}-${activeField}`}
            className="w-full border border-gray-300 rounded-md p-2 font-mono text-sm resize-y min-h-32 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
            value={draft[activeField]}
            onChange={(e) =>
              setDraft((d) => ({ ...d, [activeField]: e.target.value }))
            }
          />
        ) : (
          <div className="min-h-16 text-sm leading-relaxed">
            {draft[activeField] ? (
              <LatexRenderer latex={draft[activeField]} graphImageUrl={pageImageUrl} />
            ) : (
              <span className="text-gray-400 italic">No LaTeX content</span>
            )}
          </div>
        )}

        {/* Action row */}
        <div className="flex gap-2">
          {editing ? (
            <>
              <button
                onClick={save}
                className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700"
              >
                Save
              </button>
              <button
                onClick={() => setEditing(false)}
                className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded text-xs font-medium hover:bg-gray-200"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded text-xs font-medium hover:bg-gray-200"
            >
              Edit LaTeX
            </button>
          )}
        </div>

        {/* Claude correction row */}
        <div className="flex gap-2 pt-1 border-t border-gray-100">
          <input
            name={`claude-instruction-${part.id}-${activeField}`}
            type="text"
            placeholder="Correction for Claude, e.g. 'fix the fraction in line 2'..."
            value={claudeInstruction}
            onChange={(e) => setClaudeInstruction(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runClaude()}
            className="flex-1 border border-gray-300 rounded-md px-3 py-1.5 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-400"
          />
          <button
            onClick={runClaude}
            disabled={claudeLoading || !claudeInstruction.trim()}
            className="px-3 py-1.5 bg-purple-600 text-white rounded text-xs font-medium hover:bg-purple-700 disabled:opacity-40"
          >
            {claudeLoading ? "…" : "Ask Claude"}
          </button>
        </div>

        {/* OCR extract row — removed: use \u22ef Extract all parts\u22ef in the draft panel above */}
      </div>
    </div>
  );
}

// ─── QuestionReviewCard ──────────────────────────────────────────────────────

function QuestionReviewCard({
  question,
  onVerify,
  autoExpand,
}: {
  question: Question;
  onVerify: (id: string, v: boolean) => void;
  autoExpand?: boolean;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const didAutoExpand = useRef(false);
  const draftPanelRef = useRef<DraftPartsPanelHandle>(null);
  const [expanded, setExpanded] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [loadingUrls, setLoadingUrls] = useState(false);
  const [allQuestionImages, setAllQuestionImages] = useState<QuestionImage[]>([]);
  const [imageType, setImageType] = useState<"question" | "markscheme">("question");
  const [imageZoom, setImageZoom] = useState(100);
  const [activeField, setActiveField] = useState<Field>("content_latex");
  const [verified, setVerifiedState] = useState(
    question.question_parts.every((p) => p.latex_verified)
  );
  const [parts, setParts] = useState<QuestionPart[]>(
    [...question.question_parts].sort((a, b) => a.sort_order - b.sort_order)
  );
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [metadataDrafts, setMetadataDrafts] = useState<Record<string, {
    partLabel: string;
    marks: string;
    commandTerm: string;
    subtopicCodes: string;
  }>>({});
  const [metadataSavingAll, setMetadataSavingAll] = useState(false);
  const [metadataRevertingAll, setMetadataRevertingAll] = useState(false);
  const [metadataHistoryLoadingAll, setMetadataHistoryLoadingAll] = useState(false);
  const [metadataHistoryOpen, setMetadataHistoryOpen] = useState(false);
  const [metadataHistoryByPart, setMetadataHistoryByPart] = useState<Record<string, PartMetadataVersion[]>>({});
  const [metadataCreating, setMetadataCreating] = useState(false);
  const [addPartOpen, setAddPartOpen] = useState(false);
  const [newMetadataDraft, setNewMetadataDraft] = useState({
    partLabel: "",
    marks: "",
    commandTerm: "",
    subtopicCodes: "",
  });
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [insertAfterPartId, setInsertAfterPartId] = useState<string | null>(null);
  const [insertDraft, setInsertDraft] = useState({ partLabel: "", marks: "", commandTerm: "", subtopicCodes: "" });
  const [insertCreating, setInsertCreating] = useState(false);
  const [stemLatex, setStemLatex] = useState<string | null>(question.stem_latex ?? null);
  const [stemMarkschemeLatex, setStemMarkschemeLatex] = useState<string | null>(question.stem_markscheme_latex ?? null);
  const [partsDraftLatex, setPartsDraftLatex] = useState<string | null>(question.parts_draft_latex ?? null);
  const [partsDraftMarkschemeLatex, setPartsDraftMarkschemeLatex] = useState<string | null>(question.parts_draft_markscheme_latex ?? null);
  const [isOcrLoading, setIsOcrLoading] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  const pagePaths = question.page_image_paths ?? [];
  const hasExtractedImages = question.has_question_images || question.has_markscheme_images;
  // Filter images client-side by the selected image_type
  const questionImages = allQuestionImages
    .filter((img) => img.image_type === imageType)
    .sort((a, b) => a.sort_order - b.sort_order);

  // Auto-expand and scroll when this is the focused question
  useEffect(() => {
    if (autoExpand && !didAutoExpand.current) {
      didAutoExpand.current = true;
      doExpand().then(() => {
        // Give the DOM time to render the expanded content before scrolling
        requestAnimationFrame(() => {
          setTimeout(() => {
            cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 150);
        });
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoExpand]);

  async function doExpand() {
    setExpanded(true);
    if (hasExtractedImages && allQuestionImages.length === 0) {
      setLoadingUrls(true);
      try {
        const res = await fetch(`/api/questions/images?questionId=${question.id}`);
        if (res.ok) {
          const data = await res.json();
          setAllQuestionImages(data.images ?? []);
        }
      } finally {
        setLoadingUrls(false);
      }
    } else if (pagePaths.length > 0 && Object.keys(signedUrls).length === 0) {
      setLoadingUrls(true);
      const urls = await getSignedUrls(pagePaths);
      setSignedUrls(urls);
      setLoadingUrls(false);
    }
  }

  async function expand() {
    return doExpand();
  }

  function switchImageType(type: "question" | "markscheme") {
    setImageType(type);
    setPageIndex(0);
  }

  function handleSave(partId: string, field: Field, value: string) {
    saveLatex(partId, field, value);
    setParts((prev) =>
      prev.map((p) => (p.id === partId ? { ...p, [field]: value } : p))
    );
  }

  function handleStemSave(field: StemField, value: string) {
    saveStemLatex(question.id, field, value);
    if (field === "stem_latex") setStemLatex(value);
    else setStemMarkschemeLatex(value);
  }

  function clearAllLatexForCurrentField(field: Field) {
    const stemField: StemField = field === "content_latex" ? "stem_latex" : "stem_markscheme_latex";
    handleStemSave(stemField, "");
    parts.forEach((part) => {
      handleSave(part.id, field, "");
    });
  }

  function handleDraftSave(field: DraftField, value: string) {
    saveDraftLatex(question.id, field, value);
    if (field === "parts_draft_latex") setPartsDraftLatex(value);
    else setPartsDraftMarkschemeLatex(value);
  }

  async function copyQuestionCode() {
    try {
      await navigator.clipboard.writeText(question.code);
      setCodeCopied(true);
      try { sessionStorage.setItem("review-last-copied-code", question.code); } catch { /* ignore */ }
      setTimeout(() => setCodeCopied(false), 1500);
    } catch { /* ignore */ }
  }

  async function toggleVerified() {
    const next = !verified;
    setVerifiedState(next);
    await setVerified(question.id, next);
    onVerify(question.id, next);
  }

  async function deleteCurrentImage() {
    const img = questionImages[pageIndex];
    if (!img) return;
    if (!confirm("Delete this image from the database? This cannot be undone.")) return;
    const res = await fetch(`/api/questions/images?imageId=${img.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error ?? "Failed to delete image");
      return;
    }
    const next = allQuestionImages.filter((i) => i.id !== img.id);
    setAllQuestionImages(next);
    setPageIndex((p) => Math.min(p, Math.max(0, next.length - 1)));
  }

  async function moveCurrentImage(direction: -1 | 1) {
    const newIndex = pageIndex + direction;
    if (newIndex < 0 || newIndex >= questionImages.length) return;
    const a = questionImages[pageIndex];
    const b = questionImages[newIndex];
    if (!a || !b) return;
    // Swap sort_orders optimistically
    const updated = allQuestionImages.map((img) => {
      if (img.id === a.id) return { ...img, sort_order: b.sort_order };
      if (img.id === b.id) return { ...img, sort_order: a.sort_order };
      return img;
    });
    setAllQuestionImages(updated);
    setPageIndex(newIndex);
    // Persist
    await Promise.all([
      fetch(`/api/questions/images/${a.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sortOrder: b.sort_order }) }),
      fetch(`/api/questions/images/${b.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sortOrder: a.sort_order }) }),
    ]);
  }

  const currentPageUrl = hasExtractedImages
    ? (questionImages[pageIndex]?.url ?? null)
    : pagePaths[pageIndex]
      ? (signedUrls[pagePaths[pageIndex]] ?? null)
      : null;
  const totalPages = hasExtractedImages ? questionImages.length : pagePaths.length;

  const allVerified = parts.every((p) => p.latex_verified);
  const hasContentLatex = parts.some((p) => p.content_latex && p.content_latex.trim().length > 0);
  const hasMSLatex = parts.some((p) => p.markscheme_latex && p.markscheme_latex.trim().length > 0);
  const hasStemContentLatex = Boolean(stemLatex && stemLatex.trim().length > 0);
  const hasStemMSLatex = Boolean(stemMarkschemeLatex && stemMarkschemeLatex.trim().length > 0);
  const hasLabeledParts = parts.some((p) => p.part_label && p.part_label.trim() !== "");
  const canClearCurrentSideLatex = activeField === "content_latex"
    ? hasStemContentLatex || hasContentLatex
    : hasStemMSLatex || hasMSLatex;
  const visibleParts = hasLabeledParts
    ? parts.filter((p) => (p.part_label ?? "").trim() !== "")
    : parts;
  const commandTermOptions = useMemo(() => DEFAULT_COMMAND_TERMS, []);

  const mergeAndSortParts = useCallback((updater: (prev: QuestionPart[]) => QuestionPart[]) => {
    setParts((prev) => updater(prev).slice().sort((a, b) => a.sort_order - b.sort_order));
  }, []);

  function metadataDraftFromPart(part: QuestionPart) {
    return {
      partLabel: part.part_label ?? "",
      marks: part.marks != null ? String(part.marks) : "",
      commandTerm: canonicalCommandTerm(part.command_term),
      subtopicCodes: (part.subtopic_codes ?? []).join(", "),
    };
  }

  function resetMetadataDraft(partId: string) {
    const part = parts.find((item) => item.id === partId);
    if (!part) return;
    setMetadataDrafts((prev) => ({
      ...prev,
      [partId]: metadataDraftFromPart(part),
    }));
  }

  function resetNewMetadataDraft() {
    setNewMetadataDraft({
      partLabel: "",
      marks: "",
      commandTerm: "",
      subtopicCodes: "",
    });
  }

  function setMetadataDraft(
    partId: string,
    field: "partLabel" | "marks" | "commandTerm" | "subtopicCodes",
    value: string,
  ) {
    setMetadataDrafts((prev) => {
      const part = parts.find((item) => item.id === partId);
      const baseDraft = prev[partId]
        ?? (part
          ? metadataDraftFromPart(part)
          : { partLabel: "", marks: "", commandTerm: "", subtopicCodes: "" });

      return {
        ...prev,
        [partId]: {
          ...baseDraft,
          [field]: value,
        },
      };
    });
  }

  function getDraftForPart(existingPart: QuestionPart) {
    return metadataDrafts[existingPart.id] ?? metadataDraftFromPart(existingPart);
  }

  function normalizeLabelForCompare(value: string | null | undefined): string {
    return (value ?? "")
      .trim()
      .toLowerCase()
      .replace(/^\(|\)$/g, "");
  }

  function normalizeMarksForCompare(value: string): number {
    const parsed = value.trim() === "" ? NaN : Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) return 1;
    return Math.max(0, parsed);
  }

  function normalizeSubtopicsForCompare(value: string): string[] {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function isMetadataChanged(existingPart: QuestionPart, draft: ReturnType<typeof getDraftForPart>): boolean {
    const currentLabel = normalizeLabelForCompare(existingPart.part_label);
    const nextLabel = normalizeLabelForCompare(draft.partLabel);

    const currentMarks = existingPart.marks ?? 1;
    const nextMarks = normalizeMarksForCompare(draft.marks);

    const currentCommandTerm = canonicalCommandTerm(existingPart.command_term);
    const nextCommandTerm = canonicalCommandTerm(draft.commandTerm);

    const currentSubtopics = (existingPart.subtopic_codes ?? []).map((s) => s.trim()).filter(Boolean);
    const nextSubtopics = normalizeSubtopicsForCompare(draft.subtopicCodes);

    return currentLabel !== nextLabel
      || currentMarks !== nextMarks
      || currentCommandTerm !== nextCommandTerm
      || currentSubtopics.join("|") !== nextSubtopics.join("|");
  }

  async function saveMetadataForQuestion() {
    setMetadataSavingAll(true);
    setMetadataError(null);
    try {
      const changedParts = parts.filter((existingPart) => {
        const draft = getDraftForPart(existingPart);
        return isMetadataChanged(existingPart, draft);
      });

      if (changedParts.length === 0) {
        return;
      }

      const updates = await Promise.all(changedParts.map(async (existingPart) => {
        const draft = getDraftForPart(existingPart);
        const parsedMarks = draft.marks.trim() === "" ? null : Number.parseInt(draft.marks, 10);
        const marks = parsedMarks == null || Number.isNaN(parsedMarks) ? null : parsedMarks;
        const subtopicCodes = draft.subtopicCodes
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

        const updated = await savePartMetadata(existingPart.id, {
          partLabel: draft.partLabel,
          marks,
          commandTerm: canonicalCommandTerm(draft.commandTerm),
          subtopicCodes,
        });

        return updated;
      }));

      const byId = new Map(updates.map((item) => [item.id, item]));
      mergeAndSortParts((prev) => prev.map((p) => byId.get(p.id) ?? p));

      const refreshedDrafts: Record<string, { partLabel: string; marks: string; commandTerm: string; subtopicCodes: string }> = {};
      updates.forEach((updated) => {
        refreshedDrafts[updated.id] = metadataDraftFromPart(updated);
      });
      setMetadataDrafts((prev) => ({ ...prev, ...refreshedDrafts }));
    } catch (err) {
      setMetadataError(err instanceof Error ? err.message : "Failed to save metadata");
    } finally {
      setMetadataSavingAll(false);
    }
  }

  async function createMetadataPart() {
    setMetadataCreating(true);
    setMetadataError(null);
    try {
      const parsedMarks = newMetadataDraft.marks.trim() === ""
        ? 1
        : Number.parseInt(newMetadataDraft.marks, 10);
      const marks = Number.isNaN(parsedMarks) ? 1 : parsedMarks;
      const subtopicCodes = newMetadataDraft.subtopicCodes
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const created = await createPartMetadata(question.id, {
        partLabel: newMetadataDraft.partLabel,
        marks,
        commandTerm: canonicalCommandTerm(newMetadataDraft.commandTerm),
        subtopicCodes,
      });

      mergeAndSortParts((prev) => [...prev, created]);
      setMetadataDrafts((prev) => ({
        ...prev,
        [created.id]: metadataDraftFromPart(created),
      }));
      resetNewMetadataDraft();
      setAddPartOpen(false);
    } catch (err) {
      setMetadataError(err instanceof Error ? err.message : "Failed to create metadata part");
    } finally {
      setMetadataCreating(false);
    }
  }

  async function insertPartAfter() {
    setInsertCreating(true);
    setMetadataError(null);
    try {
      const parsedMarks = insertDraft.marks.trim() === ""
        ? 1
        : Number.parseInt(insertDraft.marks, 10);
      const marks = Number.isNaN(parsedMarks) ? 1 : parsedMarks;
      const subtopicCodes = insertDraft.subtopicCodes
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const created = await createPartMetadata(question.id, {
        partLabel: insertDraft.partLabel,
        marks,
        commandTerm: canonicalCommandTerm(insertDraft.commandTerm),
        subtopicCodes,
      });

      mergeAndSortParts((prev) => [...prev, created]);
      setMetadataDrafts((prev) => ({
        ...prev,
        [created.id]: metadataDraftFromPart(created),
      }));
      setInsertAfterPartId(null);
      setInsertDraft({ partLabel: "", marks: "", commandTerm: "", subtopicCodes: "" });
    } catch (err) {
      setMetadataError(err instanceof Error ? err.message : "Failed to insert part");
    } finally {
      setInsertCreating(false);
    }
  }

  function clearMetadataDrafts() {
    const cleared: Record<string, { partLabel: string; marks: string; commandTerm: string; subtopicCodes: string }> = {};
    parts.forEach((part) => {
      cleared[part.id] = {
        partLabel: "",
        marks: "",
        commandTerm: "",
        subtopicCodes: "",
      };
    });
    setMetadataDrafts(cleared);
    resetNewMetadataDraft();
  }

  async function loadMetadataHistoryForQuestion() {
    setMetadataHistoryLoadingAll(true);
    setMetadataError(null);
    try {
      const entries = await Promise.all(parts.map(async (part) => {
        const versions = await listPartMetadataVersions(part.id);
        return [part.id, versions] as const;
      }));

      const byPart: Record<string, PartMetadataVersion[]> = {};
      entries.forEach(([partId, versions]) => {
        byPart[partId] = versions;
      });
      setMetadataHistoryByPart(byPart);
      setMetadataHistoryOpen(true);
    } catch (err) {
      setMetadataError(err instanceof Error ? err.message : "Failed to load metadata history");
    } finally {
      setMetadataHistoryLoadingAll(false);
    }
  }

  async function revertMetadataForQuestion() {
    setMetadataRevertingAll(true);
    setMetadataError(null);
    try {
      const revertedParts = await Promise.all(parts.map((part) => revertPartMetadata(part.id)));
      const byId = new Map(revertedParts.map((item) => [item.id, item]));
      mergeAndSortParts((prev) => prev.map((p) => byId.get(p.id) ?? p));

      const refreshedDrafts: Record<string, { partLabel: string; marks: string; commandTerm: string; subtopicCodes: string }> = {};
      revertedParts.forEach((part) => {
        refreshedDrafts[part.id] = metadataDraftFromPart(part);
      });
      setMetadataDrafts((prev) => ({ ...prev, ...refreshedDrafts }));

      if (metadataHistoryOpen) {
        await loadMetadataHistoryForQuestion();
      }
    } catch (err) {
      setMetadataError(err instanceof Error ? err.message : "Failed to revert metadata");
    } finally {
      setMetadataRevertingAll(false);
    }
  }

  return (
    <div ref={cardRef} className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
      {/* Header — left 2/3 is info/copy area, right 1/3 collapses */}
      <div className="w-full flex items-center bg-white hover:bg-gray-50 transition-colors text-left divide-x divide-gray-100">
        {/* Left zone: code + badges (copyable, does NOT toggle) */}
        <div className="flex items-center flex-wrap gap-2 px-5 py-3 flex-1 min-w-0">
          <button
            type="button"
            title="Click to copy code"
            onClick={copyQuestionCode}
            className="font-mono font-semibold text-sm text-gray-800 hover:text-indigo-600 cursor-copy select-all"
          >
            {question.code}
          </button>
          <button
            type="button"
            onClick={copyQuestionCode}
            className="shrink-0 px-2.5 py-0.5 rounded border border-indigo-300 bg-indigo-50 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
            title="Copy code"
          >
            {codeCopied ? "Copied" : "Copy code"}
          </button>
          <span className="text-xs text-gray-400">
            P{question.paper} · {question.level} · {question.timezone}
          </span>
          {question.has_question_images && (
            <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">🖼 Q</span>
          )}
          {question.has_markscheme_images && (
            <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">🖼 MS</span>
          )}
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              hasContentLatex
                ? "bg-blue-100 text-blue-700"
                : "bg-red-100 text-red-500"
            }`}
            title={hasContentLatex ? "Has question LaTeX" : "Missing question LaTeX"}
          >
            {hasContentLatex ? "TeX Q" : "No TeX Q"}
          </span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              hasMSLatex
                ? "bg-blue-100 text-blue-700"
                : "bg-red-100 text-red-500"
            }`}
            title={hasMSLatex ? "Has markscheme LaTeX" : "Missing markscheme LaTeX"}
          >
            {hasMSLatex ? "TeX MS" : "No TeX MS"}
          </span>
          {allVerified && (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
              ✓ All verified
            </span>
          )}
        </div>
        {/* Right zone: collapse toggle (~1/3 width) */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 w-1/3">
          <button
            type="button"
            onClick={copyQuestionCode}
            className="shrink-0 px-2.5 py-1 rounded border border-indigo-300 bg-indigo-50 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
            title="Copy code"
          >
            {codeCopied ? "Copied" : "Copy code"}
          </button>
          <button
            type="button"
            className="cursor-pointer hover:bg-gray-100 transition-colors text-gray-400 text-xs px-2 py-1 rounded"
            onClick={() => (expanded ? setExpanded(false) : expand())}
          >
            <span>{expanded ? "collapse ▲" : "expand ▼"}</span>
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-200 grid grid-cols-2 gap-0 h-[80vh] min-h-96 overflow-hidden">
          {/* Left: image viewer */}
          <div className="border-r border-gray-200 flex flex-col bg-gray-50 h-full min-h-0">
            {/* Google Doc links */}
            {(question.google_doc_id || question.google_ms_id) && (
              <div className="flex items-center gap-3 px-4 py-1.5 border-b border-gray-200 bg-white text-xs">
                {question.google_doc_id && (
                  <a
                    href={`https://docs.google.com/document/d/${question.google_doc_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-600 hover:underline flex items-center gap-1"
                  >
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM6 20V4h5v7h7v9H6z"/></svg>
                    Question Doc
                  </a>
                )}
                {question.google_ms_id && (
                  <a
                    href={`https://docs.google.com/document/d/${question.google_ms_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-purple-600 hover:underline flex items-center gap-1"
                  >
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM6 20V4h5v7h7v9H6z"/></svg>
                    Mark Scheme Doc
                  </a>
                )}
              </div>
            )}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 text-xs text-gray-500">
              {hasExtractedImages && (
                <div className="flex rounded overflow-hidden border border-gray-200">
                  {(["question", "markscheme"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => {
                        setPageIndex(0);
                        switchImageType(t);
                        setActiveField(t === "question" ? "content_latex" : "markscheme_latex");
                      }}
                      className={`px-2 py-0.5 capitalize transition-colors ${
                        imageType === t ? "bg-indigo-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      {t === "question" ? "Q" : "MS"}
                    </button>
                  ))}
                </div>
              )}
              <span>Image {pageIndex + 1} / {totalPages || 1}</span>
              <div className="ml-2 flex items-center gap-1">
                <button
                  onClick={() => setImageZoom((z) => Math.max(100, z - 25))}
                  className="px-2 py-1 rounded bg-white border border-gray-200 hover:bg-gray-50"
                  title="Zoom out"
                >
                  −
                </button>
                <span className="min-w-10 text-center text-[11px] text-gray-600">{imageZoom}%</span>
                <button
                  onClick={() => setImageZoom((z) => Math.min(500, z + 25))}
                  className="px-2 py-1 rounded bg-white border border-gray-200 hover:bg-gray-50"
                  title="Zoom in"
                >
                  +
                </button>
              </div>
              <div className="ml-auto flex gap-1">
                {hasExtractedImages && totalPages > 1 && (
                  <>
                    <button
                      disabled={pageIndex === 0}
                      onClick={() => moveCurrentImage(-1)}
                      className="px-2 py-1 rounded bg-white border border-gray-200 disabled:opacity-30 hover:bg-gray-50"
                      title="Move this image earlier"
                    >↑</button>
                    <button
                      disabled={pageIndex >= totalPages - 1}
                      onClick={() => moveCurrentImage(1)}
                      className="px-2 py-1 rounded bg-white border border-gray-200 disabled:opacity-30 hover:bg-gray-50"
                      title="Move this image later"
                    >↓</button>
                  </>
                )}
                <button
                  disabled={pageIndex === 0}
                  onClick={() => setPageIndex((i) => i - 1)}
                  className="px-2 py-1 rounded bg-white border border-gray-200 disabled:opacity-30 hover:bg-gray-50"
                >
                  ‹
                </button>
                <button
                  disabled={pageIndex >= (totalPages - 1)}
                  onClick={() => setPageIndex((i) => i + 1)}
                  className="px-2 py-1 rounded bg-white border border-gray-200 disabled:opacity-30 hover:bg-gray-50"
                >
                  ›
                </button>
              </div>
            </div>
            <div className="flex-1 flex items-start justify-center p-4 overflow-auto">
              {loadingUrls ? (
                <span className="text-gray-400 text-sm">Loading…</span>
              ) : currentPageUrl ? (
                <div className="relative group max-w-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={currentPageUrl}
                    alt={`Page ${pageIndex + 1}`}
                    className="shadow-sm border border-gray-200 rounded"
                    style={{ width: `${imageZoom}%`, maxWidth: "none" }}
                  />
                  {hasExtractedImages && (
                    <button
                      onClick={deleteCurrentImage}
                      title="Delete this image from the database"
                      className="absolute top-1.5 right-1.5 w-6 h-6 flex items-center justify-center rounded-full bg-red-600 text-white text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-700 shadow"
                    >
                      ×
                    </button>
                  )}
                </div>
              ) : (
                <span className="text-gray-400 text-sm italic">
                  No page images available
                </span>
              )}
            </div>
          </div>

          {/* Right: per-part LaTeX editors */}
          <div className="flex flex-col min-h-0 h-full">
            <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-200 bg-white">
              <span className="text-xs font-medium text-gray-600">
                {visibleParts.length} part{visibleParts.length !== 1 ? "s" : ""}
              </span>
              <button
                onClick={() => setMetadataOpen((v) => !v)}
                className="px-2 py-1 text-xs rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                title="Edit part metadata for this question"
              >
                {metadataOpen ? "Hide metadata" : "Edit metadata"}
              </button>
              {/* Q/MS is controlled by the image toggle on the left — no duplicate tab here */}
              {!hasExtractedImages && (
                <div className="flex rounded overflow-hidden border border-gray-200 ml-2">
                  {(["content_latex", "markscheme_latex"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setActiveField(f)}
                      className={`px-3 py-1 text-xs font-medium transition-colors ${
                        activeField === f
                          ? "bg-blue-600 text-white"
                          : "bg-white text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      {f === "content_latex" ? "Question" : "Mark Scheme"}
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={() => draftPanelRef.current?.runOcrAndApply()}
                disabled={isOcrLoading}
                className="ml-auto px-3 py-1.5 rounded text-xs font-medium bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-40"
                title="Extract all parts from images and apply to editors"
              >
                {isOcrLoading ? "⏳ Extracting…" : "⟳ Extract & apply"}
              </button>
              <button
                onClick={() => clearAllLatexForCurrentField(activeField)}
                disabled={!canClearCurrentSideLatex}
                className="px-3 py-1.5 rounded text-xs font-medium bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-40"
                title="Clear LaTeX for the current side (stem and all parts)"
              >
                Clear LaTeX
              </button>
              <button
                onClick={toggleVerified}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  verified
                    ? "bg-green-100 text-green-700 hover:bg-green-200"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {verified ? "✓ Verified" : "Mark all verified"}
              </button>
            </div>
            {metadataOpen && (
              <div className="border-b border-gray-200 bg-slate-50 p-3 space-y-2 max-w-xl">
                <div className="grid grid-cols-[60px_48px_minmax(100px,1fr)_90px_20px] gap-2 text-[11px] font-semibold text-slate-600 uppercase tracking-wide">
                  <span>Part</span>
                  <span>Marks</span>
                  <span>Command term</span>
                  <span>Subtopics</span>
                  <span/>
                </div>
                {parts.map((part) => {
                  const draft = metadataDrafts[part.id] ?? metadataDraftFromPart(part);
                  const isInsertingAfterThis = insertAfterPartId === part.id;
                  return (
                    <div key={`meta-${part.id}`} className="space-y-1.5">
                      <div className="grid grid-cols-[60px_48px_minmax(100px,1fr)_90px_20px] gap-2 items-center">
                      <input
                        name={`part-label-${part.id}`}
                        value={draft.partLabel}
                        onChange={(e) => setMetadataDraft(part.id, "partLabel", e.target.value)}
                        disabled={metadataSavingAll || metadataRevertingAll || metadataCreating}
                        data-part-id={part.id}
                        data-field="partLabel"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            const idx = parts.findIndex((p) => p.id === part.id);
                            if (idx !== -1 && idx < parts.length - 1) {
                              (document.querySelector(`[data-part-id="${parts[idx+1].id}"][data-field="partLabel"]`) as HTMLElement)?.focus();
                            }
                          }
                        }}
                        className="border border-slate-300 rounded px-2 py-1 text-xs bg-white"
                      />
                      <input
                        name={`part-marks-${part.id}`}
                        value={draft.marks}
                        type="number"
                        min={0}
                        onChange={(e) => setMetadataDraft(part.id, "marks", e.target.value)}
                        disabled={metadataSavingAll || metadataRevertingAll || metadataCreating}
                        data-part-id={part.id}
                        data-field="marks"
                        onFocus={(e) => e.target.select()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            const idx = parts.findIndex((p) => p.id === part.id);
                            if (idx !== -1 && idx < parts.length - 1) {
                              (document.querySelector(`[data-part-id="${parts[idx+1].id}"][data-field="marks"]`) as HTMLElement)?.focus();
                            }
                          }
                        }}
                        className="border border-slate-300 rounded px-2 py-1 text-xs bg-white [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                      <CommandTermCombobox
                        value={draft.commandTerm ?? ""}
                        onChange={(v) => setMetadataDraft(part.id, "commandTerm", v)}
                        disabled={metadataSavingAll || metadataRevertingAll || metadataCreating}
                        options={commandTermOptions}
                        data-part-id={part.id}
                        data-field="commandTerm"
                        onEnterCommit={() => {
                          const idx = parts.findIndex((p) => p.id === part.id);
                          if (idx !== -1 && idx < parts.length - 1) {
                            (document.querySelector(`[data-part-id="${parts[idx+1].id}"][data-field="commandTerm"]`) as HTMLElement)?.focus();
                          }
                        }}
                        className="border border-slate-300 rounded px-2 py-1 text-xs bg-white w-full"
                      />
                      <input
                        name={`part-subtopics-${part.id}`}
                        value={draft.subtopicCodes}
                        onChange={(e) => setMetadataDraft(part.id, "subtopicCodes", e.target.value)}
                        disabled={metadataSavingAll || metadataRevertingAll || metadataCreating}
                        data-part-id={part.id}
                        data-field="subtopics"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
                            const idx = parts.findIndex((p) => p.id === part.id);
                            if (idx !== -1 && idx < parts.length - 1) {
                              e.preventDefault();
                              (document.querySelector(`[data-part-id="${parts[idx+1].id}"][data-field="subtopics"]`) as HTMLElement)?.focus();
                            }
                          }
                        }}
                        className="border border-slate-300 rounded px-2 py-1 text-xs bg-white"
                      />
                      <button
                        onClick={() => {
                          setInsertDraft({ partLabel: "", marks: "", commandTerm: "", subtopicCodes: "" });
                          setInsertAfterPartId(isInsertingAfterThis ? null : part.id);
                        }}
                        disabled={metadataSavingAll || metadataRevertingAll || metadataCreating || insertCreating}
                        className={`text-xs font-bold rounded w-5 h-5 flex items-center justify-center transition-colors disabled:opacity-30 ${isInsertingAfterThis ? "bg-blue-200 text-blue-700" : "text-slate-400 hover:text-blue-600 hover:bg-blue-50"}`}
                        title="Insert a new part after this row"
                      >+</button>
                      </div>
                      {/* Insert-between row */}
                      {isInsertingAfterThis ? (
                        <div className="grid grid-cols-[60px_48px_minmax(100px,1fr)_90px_auto] gap-2 pl-3 border-l-2 border-blue-400 bg-blue-50/60 rounded-r py-1.5">
                          <input
                            autoFocus
                            placeholder="Label"
                            value={insertDraft.partLabel}
                            onChange={(e) => setInsertDraft((d) => ({ ...d, partLabel: e.target.value }))}
                            disabled={insertCreating}
                            className="border border-blue-300 rounded px-2 py-1 text-xs bg-white"
                          />
                          <input
                            placeholder="Marks"
                            type="number"
                            min={0}
                            value={insertDraft.marks}
                            onChange={(e) => setInsertDraft((d) => ({ ...d, marks: e.target.value }))}
                            disabled={insertCreating}
                            onFocus={(e) => e.target.select()}
                            className="border border-blue-300 rounded px-2 py-1 text-xs bg-white [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          />
                          <CommandTermCombobox
                            value={insertDraft.commandTerm}
                            onChange={(v) => setInsertDraft((d) => ({ ...d, commandTerm: v }))}
                            disabled={insertCreating}
                            options={commandTermOptions}
                            className="border border-blue-300 rounded px-2 py-1 text-xs bg-white w-full"
                          />
                          <input
                            placeholder="Subtopics"
                            value={insertDraft.subtopicCodes}
                            onChange={(e) => setInsertDraft((d) => ({ ...d, subtopicCodes: e.target.value }))}
                            disabled={insertCreating}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") { e.preventDefault(); insertPartAfter(); }
                              if (e.key === "Escape") { setInsertAfterPartId(null); }
                            }}
                            className="border border-blue-300 rounded px-2 py-1 text-xs bg-white"
                          />
                          <div className="flex gap-1 items-center">
                            <button
                              onClick={() => insertPartAfter()}
                              disabled={insertCreating}
                              className="px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
                            >
                              {insertCreating ? "…" : "Insert"}
                            </button>
                            <button
                              onClick={() => setInsertAfterPartId(null)}
                              disabled={insertCreating}
                              className="px-2 py-1 text-xs rounded bg-slate-200 text-slate-600 hover:bg-slate-300 disabled:opacity-40"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}

                {addPartOpen && (
                  <div className="grid grid-cols-[60px_48px_minmax(100px,1fr)_90px_auto] gap-2 pt-1 border-t border-slate-200 items-center">
                    <input
                      autoFocus
                      data-field="new-part-label"
                      name="new-part-label"
                      placeholder="Label"
                      value={newMetadataDraft.partLabel}
                      onChange={(e) => setNewMetadataDraft((d) => ({ ...d, partLabel: e.target.value }))}
                      disabled={metadataSavingAll || metadataRevertingAll || metadataCreating}
                      onKeyDown={(e) => { if (e.key === "Escape") setAddPartOpen(false); }}
                      className="border border-slate-300 rounded px-2 py-1 text-xs bg-white"
                    />
                    <input
                      name="new-part-marks"
                      placeholder="Marks"
                      value={newMetadataDraft.marks}
                      type="number"
                      min={0}
                      onChange={(e) => setNewMetadataDraft((d) => ({ ...d, marks: e.target.value }))}
                      disabled={metadataSavingAll || metadataRevertingAll || metadataCreating}
                      onFocus={(e) => e.target.select()}
                      className="border border-slate-300 rounded px-2 py-1 text-xs bg-white [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <CommandTermCombobox
                      value={newMetadataDraft.commandTerm}
                      onChange={(v) => setNewMetadataDraft((d) => ({ ...d, commandTerm: v }))}
                      disabled={metadataSavingAll || metadataRevertingAll || metadataCreating}
                      options={commandTermOptions}
                      className="border border-slate-300 rounded px-2 py-1 text-xs bg-white w-full"
                    />
                    <input
                      name="new-part-subtopics"
                      placeholder="Subtopics"
                      value={newMetadataDraft.subtopicCodes}
                      onChange={(e) => setNewMetadataDraft((d) => ({ ...d, subtopicCodes: e.target.value }))}
                      disabled={metadataSavingAll || metadataRevertingAll || metadataCreating}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); createMetadataPart(); }
                        if (e.key === "Escape") setAddPartOpen(false);
                      }}
                      className="border border-slate-300 rounded px-2 py-1 text-xs bg-white"
                    />
                    <button
                      onClick={() => setAddPartOpen(false)}
                      className="text-slate-400 hover:text-slate-600 text-xs px-1"
                      title="Cancel"
                    >✕</button>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-200">
                  <button
                    onClick={() => {
                      if (addPartOpen) {
                        createMetadataPart();
                      } else {
                        setAddPartOpen(true);
                      }
                    }}
                    disabled={metadataSavingAll || metadataRevertingAll || metadataCreating}
                    className="px-3 py-1.5 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-40"
                    title="Add a new part"
                  >
                    {metadataCreating ? "Adding…" : "+ Add part"}
                  </button>
                  <button
                    onClick={saveMetadataForQuestion}
                    disabled={metadataSavingAll || metadataRevertingAll || metadataCreating}
                    className="px-3 py-1.5 text-xs rounded bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-40"
                    title="Save metadata changes for this question"
                  >
                    {metadataSavingAll ? "Saving" : "Save to DB"}
                  </button>
                  <button
                    onClick={() => {
                      if (metadataHistoryOpen) {
                        setMetadataHistoryOpen(false);
                        return;
                      }
                      loadMetadataHistoryForQuestion();
                    }}
                    disabled={metadataSavingAll || metadataRevertingAll || metadataCreating || metadataHistoryLoadingAll}
                    className="px-3 py-1.5 text-xs rounded border border-indigo-300 text-indigo-700 hover:bg-indigo-50 disabled:opacity-40"
                    title="List previous metadata versions for all parts"
                  >
                    {metadataHistoryLoadingAll ? "Loading" : metadataHistoryOpen ? "Hide history" : "History"}
                  </button>
                  <button
                    onClick={revertMetadataForQuestion}
                    disabled={metadataSavingAll || metadataRevertingAll || metadataCreating}
                    className="px-3 py-1.5 text-xs rounded border border-amber-300 text-amber-800 hover:bg-amber-100 disabled:opacity-40"
                    title="Revert each part to its previous metadata snapshot"
                  >
                    {metadataRevertingAll ? "Reverting" : "Revert DB"}
                  </button>
                  <button
                    onClick={clearMetadataDrafts}
                    disabled={metadataSavingAll || metadataRevertingAll || metadataCreating}
                    className="px-3 py-1.5 text-xs rounded border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                    title="Clear entered metadata in the editor"
                  >
                    Clear metadata
                  </button>
                </div>

                {metadataHistoryOpen && (
                  <div className="border border-indigo-200 bg-indigo-50/40 rounded p-2 space-y-2">
                    {parts.map((part) => {
                      const versions = metadataHistoryByPart[part.id] ?? [];
                      return (
                        <div key={`history-${part.id}`} className="space-y-1">
                          <div className="text-xs font-semibold text-indigo-900">
                            Part {(part.part_label ?? "(empty label)").toUpperCase()}
                          </div>
                          {versions.length === 0 ? (
                            <div className="text-xs text-slate-500">No saved versions yet.</div>
                          ) : (
                            versions.map((version) => (
                              <div key={version.id} className="flex items-center gap-2 text-xs bg-white border border-indigo-100 rounded px-2 py-1.5">
                                <span className="text-slate-500 min-w-32">{new Date(version.created_at).toLocaleString()}</span>
                                <span className="text-slate-700">{version.part_label || "(empty label)"}</span>
                                <span className="text-slate-500">[{version.marks ?? 0}]</span>
                                <span className="text-slate-600 truncate">{version.command_term || "no command term"}</span>
                              </div>
                            ))
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {metadataError && (
                  <div className="text-xs text-red-600 font-medium">{metadataError}</div>
                )}
              </div>
            )}
            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
              {parts.length === 0 ? (
                <p className="text-gray-400 text-sm italic">No parts found.</p>
              ) : (
                <>
                  {/* Show stem editor only for questions that have labeled parts. */}
                  <DraftPartsPanel
                    ref={draftPanelRef}
                    questionId={question.id}
                    draftLatex={partsDraftLatex}
                    draftMarkschemeLatex={partsDraftMarkschemeLatex}
                    activeField={activeField}
                    parts={parts}
                    onSave={handleDraftSave}
                    onOcrLoadingChange={setIsOcrLoading}
                      onApply={(sourceField, stem, splitParts) => {
                      // Always save extracted stem.
                        const stemField: StemField = sourceField === "content_latex" ? "stem_latex" : "stem_markscheme_latex";
                      handleStemSave(stemField, stem);

                        const contentField: Field = sourceField === "content_latex" ? "content_latex" : "markscheme_latex";

                      if (hasLabeledParts) {
                        const normalizeLabel = (raw: string | null | undefined): string => {
                          if (!raw) return "";
                          return raw
                            .trim()
                            .toLowerCase()
                            .replace(/[^a-z]/g, "");
                        };
                        // Save each matched labeled part.
                        splitParts.forEach((content, label) => {
                          const normalizedTarget = normalizeLabel(label);
                          const matchedPart = parts.find((p) => normalizeLabel(p.part_label) === normalizedTarget);
                          if (matchedPart) {
                            handleSave(matchedPart.id, contentField, content);
                          }
                        });
                      } else if (parts.length === 1) {
                        // No labels: treat the extracted stem as whole-question content so users still get auto-fill.
                        handleSave(parts[0].id, contentField, stem);
                      }
                    }}
                  />
                  {activeField === "content_latex" && hasLabeledParts && (
                    <StemEditor
                      questionId={question.id}
                      stemLatex={stemLatex}
                      stemMarkschemeLatex={stemMarkschemeLatex}
                      pageImageUrl={currentPageUrl}
                      activeField={activeField}
                      onSave={handleStemSave}
                    />
                  )}
                  {visibleParts.map((part) => (
                    <PartEditor
                      key={part.id}
                      part={part}
                      questionId={question.id}
                      pageImageUrl={currentPageUrl}
                      activeField={activeField}
                      onSave={handleSave}
                    />
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ReviewClient (root) ─────────────────────────────────────────────────────

// ─── ExtractAllImagesButton ───────────────────────────────────────────────────

function ExtractAllImagesButton() {
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [progress, setProgress] = useState<{ completed: number; total: number; currentCode: string; totalImages: number; errors: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<Array<{ code: string; message: string }>>([]);
  const [showErrorDetails, setShowErrorDetails] = useState(true);

  async function run() {
    setStatus("running");
    setError(null);
    setErrorDetails([]);
    setShowErrorDetails(true);
    setProgress({ completed: 0, total: 0, currentCode: "Starting…", totalImages: 0, errors: 0 });

    try {
      const res = await fetch("/api/questions/extract-all-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skipExisting: true }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `HTTP ${res.status}`);
        setStatus("error");
        return;
      }

      if (!res.body) {
        setError("No response stream");
        setStatus("error");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.type === "start") {
              setProgress((p) => ({ ...p!, total: msg.total }));
            } else if (msg.type === "progress") {
              setProgress((prev) => ({
                completed: msg.completed,
                total: msg.total,
                currentCode: msg.code,
                totalImages: (prev?.totalImages ?? 0) + (msg.questionImages ?? 0) + (msg.msImages ?? 0),
                errors: msg.error ? (prev?.errors ?? 0) + 1 : (prev?.errors ?? 0),
              }));
              if (msg.error) {
                setErrorDetails((prev) => {
                  const next = [...prev, { code: msg.code ?? "unknown", message: String(msg.error) }];
                  return next;
                });
              }
            } else if (msg.type === "done") {
              setProgress({ completed: msg.totalQuestions, total: msg.totalQuestions, currentCode: "Done", totalImages: msg.totalImages, errors: msg.errors ?? 0 });
              if (Array.isArray(msg.errorDetails)) {
                setErrorDetails(
                  msg.errorDetails.map((item: { code?: unknown; error?: unknown }) => ({
                    code: typeof item.code === "string" ? item.code : "unknown",
                    message: typeof item.error === "string" ? item.error : String(item.error ?? "Unknown error"),
                  }))
                );
              }
              setStatus("done");
            } else if (msg.type === "error") {
              setError(msg.error);
              setStatus("error");
            }
          } catch { /* ignore bad lines */ }
        }
      }
      if (status === "running") setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed");
      setStatus("error");
    }
  }

  const busy = status === "running";
  const pct = progress && progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

  return (
    <div className="border border-green-200 rounded-lg bg-green-50/40 p-3 space-y-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-green-800 text-xs">Extract images from Google Docs</span>
        <span className="text-xs text-gray-400">(skips questions that already have images)</span>
        <div className="ml-auto">
          <button
            onClick={run}
            disabled={busy}
            className="px-3 py-1 rounded bg-green-600 text-white text-xs font-medium hover:bg-green-700 disabled:opacity-40"
          >
            {busy ? "Extracting…" : "Extract all"}
          </button>
        </div>
      </div>

      {(error || (progress?.errors ?? 0) > 0) && (
        <div className="rounded border border-red-300 bg-red-50 px-2.5 py-2 space-y-1">
          <div className="flex items-center gap-2">
            <p className="text-xs text-red-700 font-semibold">
              ⚠ Errors detected{progress && progress.errors > 0 ? `: ${progress.errors}` : ""}
            </p>
            {errorDetails.length > 0 && (
              <button
                type="button"
                onClick={() => setShowErrorDetails((v) => !v)}
                className="text-[11px] text-red-700 underline underline-offset-2 hover:text-red-800"
              >
                {showErrorDetails ? "Hide details" : `Show details (${errorDetails.length})`}
              </button>
            )}
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          {showErrorDetails && errorDetails.length > 0 && (
            <div className="max-h-48 overflow-auto rounded border border-red-200 bg-white/70 p-2">
              <ul className="text-xs text-red-700 space-y-1 font-mono">
                {errorDetails.map((item, idx) => (
                  <li key={`${item.code}-${idx}`} className="wrap-break-word">
                    <span className="font-semibold">{item.code}</span>: {item.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {progress && (
        <div className="space-y-1">
          <div className={`flex justify-between text-xs ${(progress.errors ?? 0) > 0 ? "text-red-700" : "text-green-700"}`}>
            <span>{progress.currentCode}</span>
            <span>{progress.completed} / {progress.total} questions · {progress.totalImages} images{progress.errors > 0 ? ` · ${progress.errors} errors` : ""}</span>
          </div>
          <div className="w-full bg-green-100 rounded-full h-1.5">
            <div className="bg-green-500 h-1.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SyncDriveDocsButton ─────────────────────────────────────────────────────

function SyncDriveDocsButton() {
  const [status, setStatus] = useState<"idle" | "dryrun" | "syncing" | "done" | "error">("idle");
  const [result, setResult] = useState<{ found: number; updated: number; updates: { code: string; google_doc_id?: string; google_ms_id?: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [force, setForce] = useState(false);
  const [debugCode, setDebugCode] = useState(() => {
    try { return sessionStorage.getItem("review-last-copied-code") || "12M.1.AHL.TZ1.H_5"; } catch { return "12M.1.AHL.TZ1.H_5"; }
  });

  useEffect(() => {
    if (!showConfig) return;
    try {
      const saved = sessionStorage.getItem("review-last-copied-code");
      if (saved) setDebugCode(saved);
    } catch {}
  }, [showConfig]);
  const [debugBusy, setDebugBusy] = useState(false);
  const [debugError, setDebugError] = useState<string | null>(null);
  const [singleSyncBusy, setSingleSyncBusy] = useState(false);
  const [singleSyncStatus, setSingleSyncStatus] = useState<string | null>(null);
  const [debugResult, setDebugResult] = useState<{
    code: string;
    db?: { id: string; code: string; google_doc_id?: string | null; google_ms_id?: string | null } | null;
    questionFolderCount: number;
    markschemeFolderCount: number;
    questionMatches: { id: string; name: string; webViewLink?: string; parents?: string[] }[];
    markschemeMatches: { id: string; name: string; webViewLink?: string; parents?: string[] }[];
  } | null>(null);

  async function run(dryRun: boolean) {
    setStatus(dryRun ? "dryrun" : "syncing");
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/sync-drive-docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun, force }),
      });
      const raw = await res.text();
      let data: { error?: string; found?: number; updated?: number; updates?: { code: string; google_doc_id?: string; google_ms_id?: string }[] } = {};
      if (raw.trim()) {
        try {
          data = JSON.parse(raw);
        } catch {
          setError(`Sync failed: non-JSON response (HTTP ${res.status})`);
          setStatus("error");
          return;
        }
      }
      if (!res.ok) {
        setError(data.error ?? `Sync failed (HTTP ${res.status})`);
        setStatus("error");
        return;
      }
      setResult({
        found: data.found ?? 0,
        updated: data.updated ?? 0,
        updates: data.updates ?? [],
      });
      setStatus("done");
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  }

  async function runSingleCodeDebug() {
    if (!debugCode.trim()) return;
    setDebugBusy(true);
    setDebugError(null);
    setDebugResult(null);

    try {
      const res = await fetch("/api/admin/debug-drive-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: debugCode.trim() }),
      });
      const raw = await res.text();
      let data: {
        error?: string;
        code?: string;
        db?: { id: string; code: string; google_doc_id?: string | null; google_ms_id?: string | null } | null;
        questionFolderCount?: number;
        markschemeFolderCount?: number;
        questionMatches?: { id: string; name: string; webViewLink?: string; parents?: string[] }[];
        markschemeMatches?: { id: string; name: string; webViewLink?: string; parents?: string[] }[];
      } = {};

      if (raw.trim()) {
        try {
          data = JSON.parse(raw);
        } catch {
          setDebugError(`Debug failed: non-JSON response (HTTP ${res.status})`);
          return;
        }
      }

      if (!res.ok) {
        setDebugError(data.error ?? `Debug failed (HTTP ${res.status})`);
        return;
      }

      setDebugResult({
        code: data.code ?? debugCode.trim(),
        db: data.db ?? null,
        questionFolderCount: data.questionFolderCount ?? 0,
        markschemeFolderCount: data.markschemeFolderCount ?? 0,
        questionMatches: data.questionMatches ?? [],
        markschemeMatches: data.markschemeMatches ?? [],
      });
    } catch (e) {
      setDebugError(String(e));
    } finally {
      setDebugBusy(false);
    }
  }

  async function runSingleCodeSync() {
    if (!debugCode.trim()) return;
    setSingleSyncBusy(true);
    setSingleSyncStatus(null);
    setDebugError(null);

    try {
      const res = await fetch("/api/admin/sync-drive-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: debugCode.trim(), force }),
      });
      const raw = await res.text();
      let data: {
        error?: string;
        updated?: Record<string, string>;
        message?: string;
      } = {};

      if (raw.trim()) {
        try {
          data = JSON.parse(raw);
        } catch {
          setSingleSyncStatus(`Single-code sync failed: non-JSON response (HTTP ${res.status})`);
          return;
        }
      }

      if (!res.ok) {
        setSingleSyncStatus(data.error ?? `Single-code sync failed (HTTP ${res.status})`);
        return;
      }

      if (data.message === "No updates needed") {
        setSingleSyncStatus("No updates needed for this code.");
      } else {
        const pieces: string[] = [];
        if (data.updated?.google_doc_id) pieces.push("Q linked");
        if (data.updated?.google_ms_id) pieces.push("MS linked");
        setSingleSyncStatus(pieces.length > 0 ? `Updated: ${pieces.join(", ")}` : "Synced.");
      }

      await runSingleCodeDebug();
    } catch (e) {
      setSingleSyncStatus(String(e));
    } finally {
      setSingleSyncBusy(false);
    }
  }

  const busy = status === "dryrun" || status === "syncing";

  return (
    <div className="border border-blue-200 rounded-lg bg-blue-50/40 p-3 space-y-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-blue-800 text-xs">Sync Google Doc IDs from Drive</span>
        <button
          onClick={() => setShowConfig((v) => !v)}
          className="text-xs text-blue-500 hover:underline"
        >
          {showConfig ? "hide options" : "options"}
        </button>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => run(true)}
            disabled={busy}
            className="px-3 py-1 rounded bg-white border border-blue-300 text-blue-700 text-xs font-medium hover:bg-blue-50 disabled:opacity-40"
          >
            {status === "dryrun" ? "Scanning…" : "Dry run"}
          </button>
          <button
            onClick={() => run(false)}
            disabled={busy}
            className="px-3 py-1 rounded bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-40"
          >
            {status === "syncing" ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </div>

      {showConfig && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
            <input
              name="force-relink"
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
              className="rounded"
            />
            <span>Force re-link (overwrite existing Doc IDs — use to fix stale/deleted links)</span>
          </label>

          <div className="pt-1 border-t border-blue-100 space-y-1.5">
            <p className="text-xs text-blue-800 font-medium">Debug one code (no full scan):</p>
            <div className="flex items-center gap-2">
              <input
                name="debug-code"
                type="text"
                value={debugCode}
                onChange={(e) => setDebugCode(e.target.value)}
                className="flex-1 px-2 py-1 rounded border border-blue-200 text-xs font-mono bg-white"
                placeholder="e.g. 12M.1.AHL.TZ1.H_5"
              />
              <button
                onClick={runSingleCodeDebug}
                disabled={debugBusy || singleSyncBusy || !debugCode.trim()}
                className="px-3 py-1 rounded bg-white border border-blue-300 text-blue-700 text-xs font-medium hover:bg-blue-50 disabled:opacity-40"
              >
                {debugBusy ? "Debugging…" : "Debug code"}
              </button>
              <button
                onClick={runSingleCodeSync}
                disabled={singleSyncBusy || debugBusy || !debugCode.trim()}
                className="px-3 py-1 rounded bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-40"
              >
                {singleSyncBusy ? "Syncing…" : "Sync this code"}
              </button>
            </div>
            {debugError && <p className="text-xs text-red-600 font-medium">⚠ {debugError}</p>}
            {singleSyncStatus && <p className="text-xs text-blue-700 font-medium">{singleSyncStatus}</p>}
            {debugResult && (
              <div className="text-xs text-blue-700 bg-white border border-blue-100 rounded p-2 space-y-1.5">
                <p>
                  <span className="font-semibold">Code:</span> <span className="font-mono">{debugResult.code}</span>
                </p>
                <p>
                  <span className="font-semibold">DB:</span>{" "}
                  {debugResult.db
                    ? `google_doc_id=${debugResult.db.google_doc_id ?? "null"}, google_ms_id=${debugResult.db.google_ms_id ?? "null"}`
                    : "No ib_questions row found"}
                </p>
                <p>
                  Q folder tree ({debugResult.questionFolderCount} folders): <strong>{debugResult.questionMatches.length}</strong> match(es)
                </p>
                <p>
                  MS folder tree ({debugResult.markschemeFolderCount} folders): <strong>{debugResult.markschemeMatches.length}</strong> match(es)
                </p>

                {debugResult.questionMatches.length > 0 && (
                  <div>
                    <p className="font-semibold text-blue-800">Question doc matches:</p>
                    <ul className="max-h-28 overflow-auto font-mono border border-blue-100 rounded p-1 space-y-0.5">
                      {debugResult.questionMatches.map((m) => (
                        <li key={`q-${m.id}`}>
                          {m.webViewLink ? (
                            <a href={m.webViewLink} target="_blank" rel="noreferrer" className="underline text-blue-600">
                              {m.name}
                            </a>
                          ) : (
                            <span>{m.name}</span>
                          )}
                          <span className="text-gray-500 ml-2">{m.id}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {debugResult.markschemeMatches.length > 0 && (
                  <div>
                    <p className="font-semibold text-purple-800">Mark scheme doc matches:</p>
                    <ul className="max-h-28 overflow-auto font-mono border border-blue-100 rounded p-1 space-y-0.5">
                      {debugResult.markschemeMatches.map((m) => (
                        <li key={`ms-${m.id}`}>
                          {m.webViewLink ? (
                            <a href={m.webViewLink} target="_blank" rel="noreferrer" className="underline text-blue-600">
                              {m.name}
                            </a>
                          ) : (
                            <span>{m.name}</span>
                          )}
                          <span className="text-gray-500 ml-2">{m.id}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-600 font-medium">⚠ {error}</p>
      )}

      {result && (
        <div className="text-xs text-blue-700 space-y-1">
          <p>
            Found <strong>{result.found}</strong> docs to link
            {result.updated > 0 ? `, updated ${result.updated} questions` : result.found > 0 ? " (dry run — no changes written)" : ""}
            .
          </p>
          {result.found > 0 && (
            <button onClick={() => setShowDetails((v) => !v)} className="underline text-blue-500">
              {showDetails ? "Hide" : "Show"} details ({result.updates.length})
            </button>
          )}
          {showDetails && (
            <ul className="max-h-40 overflow-auto bg-white border border-blue-100 rounded p-2 space-y-0.5 font-mono">
              {result.updates.map((u) => (
                <li key={u.code}>
                  <span className="text-gray-700">{u.code}</span>
                  {u.google_doc_id && <span className="text-blue-600 ml-2">Q✓</span>}
                  {u.google_ms_id && <span className="text-purple-600 ml-1">MS✓</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ReviewClient ─────────────────────────────────────────────────────────────

const SCROLL_KEY = "review-scroll-y";

export default function ReviewClient({
  initialQuestions,
  focusId,
}: {
  initialQuestions: Question[];
  focusId: string | null;
}) {
  const [questions, setQuestions] = useState(initialQuestions);
  // When deep-linking to a specific question, show all so the target isn't filtered out
  const [filterVerified, setFilterVerified] = useState<"all" | "verified" | "unverified">(focusId ? "all" : "unverified");

  // Persist and restore scroll position so returning from a linked page keeps position
  useEffect(() => {
    if (focusId) return; // let auto-scroll handle focused mode
    try {
      const saved = sessionStorage.getItem(SCROLL_KEY);
      if (saved) {
        const y = Number(saved);
        if (Number.isFinite(y) && y > 0) {
          // wait one frame so the list is rendered before scrolling
          requestAnimationFrame(() => window.scrollTo({ top: y, behavior: "instant" }));
        }
      }
    } catch { /* ignore private-browsing errors */ }

    const onScroll = () => {
      try { sessionStorage.setItem(SCROLL_KEY, String(window.scrollY)); } catch { /* ignore */ }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [filterImages, setFilterImages] = useState(false);
  const [filterNoLatex, setFilterNoLatex] = useState(false);
  const [codeSearch, setCodeSearch] = useState("");

  const handleVerify = useCallback(
    (id: string, verified: boolean) => {
      setQuestions((prev) =>
        prev.map((q) =>
          q.id === id
            ? {
                ...q,
                question_parts: q.question_parts.map((p) => ({
                  ...p,
                  latex_verified: verified,
                })),
              }
            : q
        )
      );
    },
    []
  );

  const visible = questions.filter((q) => {
    if (codeSearch && !q.code.toLowerCase().includes(codeSearch.toLowerCase()))
      return false;
    const allVerified = q.question_parts.every((p) => p.latex_verified);
    if (filterVerified === "verified" && !allVerified) return false;
    if (filterVerified === "unverified" && allVerified) return false;
    if (filterImages && !q.has_question_images && !q.has_markscheme_images) return false;
    if (filterNoLatex) {
      const hasContent = q.question_parts.some((p) => p.content_latex && p.content_latex.trim().length > 0);
      const hasMS = q.question_parts.some((p) => p.markscheme_latex && p.markscheme_latex.trim().length > 0);
      if (hasContent && hasMS) return false;
    }
    return true;
  });

  const totalVerified = questions.filter((q) =>
    q.question_parts.every((p) => p.latex_verified)
  ).length;

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">LaTeX Review</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {totalVerified} / {questions.length} questions verified
          </p>
        </div>
        {/* Progress bar */}
        <div className="flex-1 max-w-xs ml-8 bg-gray-200 rounded-full h-2">
          <div
            className="bg-green-500 h-2 rounded-full transition-all"
            style={{
              width:
                questions.length > 0
                  ? `${(totalVerified / questions.length) * 100}%`
                  : "0%",
            }}
          />
        </div>
      </div>

      {/* Drive sync */}
      <SyncDriveDocsButton />

      {/* Bulk image extraction */}
      <ExtractAllImagesButton />

      {/* Filters */}
      <div className="flex gap-3 flex-wrap" suppressHydrationWarning>
        <input
          id="review-code-search"
          name="reviewCodeSearch"
          aria-label="Search questions by code"
          type="text"
          placeholder="Search by code…"
          value={codeSearch}
          onChange={(e) => setCodeSearch(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-56 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
          suppressHydrationWarning
        />
        <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm">
          {(["all", "unverified", "verified"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setFilterVerified(v)}
              className={`px-3 py-1.5 capitalize transition-colors ${
                filterVerified === v
                  ? "bg-blue-600 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
              suppressHydrationWarning
            >
              {v}
            </button>
          ))}
        </div>
        <button
          onClick={() => setFilterImages((v) => !v)}
          className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
            filterImages
              ? "bg-indigo-600 text-white border-indigo-600"
              : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
          }`}
          suppressHydrationWarning
        >
          🖼 Has images
        </button>
        <button
          onClick={() => setFilterNoLatex((v) => !v)}
          className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
            filterNoLatex
              ? "bg-red-600 text-white border-red-600"
              : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
          }`}
          suppressHydrationWarning
        >
          Missing LaTeX
        </button>
        <span className="text-sm text-gray-400 self-center">
          Showing {visible.length} of {questions.length}
        </span>
      </div>

      {/* Question list */}
      {visible.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-lg">No questions match your filters.</p>
          <p className="text-sm mt-1">
            Try switching the filter to <strong>All</strong> or turning off <strong>Has images</strong>.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((q) => (
            <QuestionReviewCard
              key={q.id}
              question={q}
              onVerify={handleVerify}
              autoExpand={focusId === q.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
