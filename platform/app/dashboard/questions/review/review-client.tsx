"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import LatexRenderer from "@/components/LatexRenderer";
import { IB_CORRECTION_SYSTEM } from "@/lib/latex-utils";

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

// ─── DraftPartsPanel ──────────────────────────────────────────────────────────
// Staged whole-question extraction: OCR extracts all labelled parts as one
// block; the "Split & apply" button auto-splits it by (a)/(b)/... labels and
// populates the stem editor + individual part editors directly.

/**
 * Split raw OCR draft into a stem and per-part segments.
 * Splits on top-level part labels like "(a)", "(b)", "(c)" etc.
 * Everything before the first label → stem.
 * The label itself is stripped from each part's content.
 */
function splitDraftIntoParts(draft: string, partLabels: string[]): { stem: string; parts: Map<string, string> } {
  // Strategy 1: split on \begin{IBPart}[letter] or \begin{IBPart}
  // Everything before the first \begin{IBPart} → stem
  // Each block between \begin{IBPart}...\end{IBPart} → one part in order

  const IBPART_OPEN_RE = /\\begin\{IBPart\}(?:\[([a-z])\])?/g;
  const openMatches: { index: number; label: string | null; contentStart: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = IBPART_OPEN_RE.exec(draft)) !== null) {
    openMatches.push({ index: m.index, label: m[1] ?? null, contentStart: m.index + m[0].length });
  }

  if (openMatches.length > 0) {
    // Has \begin{IBPart} structure
    const stem = draft.slice(0, openMatches[0].index).trim();
    const parts = new Map<string, string>();
    for (let i = 0; i < openMatches.length; i++) {
      const rawContent = i + 1 < openMatches.length
        ? draft.slice(openMatches[i].contentStart, openMatches[i + 1].index)
        : draft.slice(openMatches[i].contentStart);
      const content = rawContent.replace(/\\end\{IBPart\}\s*$/, "").trim();
      // Use explicit label if present, otherwise map by position to partLabels
      const label = openMatches[i].label ?? partLabels[i] ?? String.fromCharCode(97 + i);
      parts.set(label, content);
    }
    return { stem, parts };
  }

  // Strategy 2: plain (a)/(b)/(c) labels at line start
  const PLAIN_RE = /(^|\n)[ \t]*\(([a-z])\)[ \t]*/g;
  const plainSplits: { label: string; index: number; matchLen: number }[] = [];
  while ((m = PLAIN_RE.exec(draft)) !== null) {
    plainSplits.push({ label: m[2], index: m.index + m[1].length, matchLen: m[0].length - m[1].length });
  }
  const stem = (plainSplits.length > 0 ? draft.slice(0, plainSplits[0].index) : draft).trim();
  const parts = new Map<string, string>();
  for (let i = 0; i < plainSplits.length; i++) {
    const contentStart = plainSplits[i].index + plainSplits[i].matchLen;
    const content = (i + 1 < plainSplits.length
      ? draft.slice(contentStart, plainSplits[i + 1].index)
      : draft.slice(contentStart)).trim();
    parts.set(plainSplits[i].label, content);
  }
  return { stem, parts };
}

function DraftPartsPanel({
  questionId,
  draftLatex,
  draftMarkschemeLatex,
  activeField,
  parts: questionParts,
  onSave,
  onApply,
}: {
  questionId: string;
  draftLatex: string | null;
  draftMarkschemeLatex: string | null;
  activeField: Field;
  parts: QuestionPart[];
  onSave: (field: DraftField, value: string) => void;
  onApply: (stem: string, parts: Map<string, string>) => void;
}) {
  const draftField: DraftField =
    activeField === "content_latex"
      ? "parts_draft_latex"
      : "parts_draft_markscheme_latex";
  const [text, setText] = useState(
    activeField === "content_latex" ? (draftLatex ?? "") : (draftMarkschemeLatex ?? "")
  );
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Sync text when activeField changes
  const prevField = useRef(activeField);
  if (prevField.current !== activeField) {
    prevField.current = activeField;
    setText(activeField === "content_latex" ? (draftLatex ?? "") : (draftMarkschemeLatex ?? ""));
  }

  async function runOcrAndApply() {
    setOcrLoading(true);
    setOcrError(null);
    try {
      const res = await fetch("/api/questions/ocr-latex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId, field: draftField }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOcrError(data.error ?? "OCR failed");
        return;
      }
      const latex: string = data.latex ?? "";
      setText(latex);
      onSave(draftField, latex);
      // Immediately split and apply
      const partLabels = questionParts.map((p) => p.part_label ?? "");
      const { stem, parts: splitParts } = splitDraftIntoParts(latex, partLabels);
      onApply(stem, splitParts);
    } catch {
      setOcrError("Network error");
    } finally {
      setOcrLoading(false);
    }
  }

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }

  function save() {
    onSave(draftField, text);
  }

  const imageLabel = activeField === "content_latex" ? "question" : "mark scheme";

  return (
    <div className="border border-amber-200 rounded-lg overflow-hidden bg-amber-50/30">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200">
        <span className="font-semibold text-sm text-amber-800">
          Extracted draft
          <span className="text-amber-500 font-normal ml-1 text-xs">(review or edit below, then apply)</span>
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={runOcrAndApply}
            disabled={ocrLoading}
            className="px-3 py-1 bg-orange-600 text-white rounded text-xs font-medium hover:bg-orange-700 disabled:opacity-40"
            title={`Extract all parts from the ${imageLabel} images and apply directly to editors`}
          >
            {ocrLoading ? "⏳ Extracting… (may take ~60s)" : "⟳ Extract & apply"}
          </button>
        </div>
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
          className="w-full border border-amber-200 rounded-md p-2 font-mono text-xs resize-y min-h-24 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
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
              onApply(stem, splitParts);
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
}

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
            className="w-full border border-indigo-300 rounded-md p-2 font-mono text-sm resize-y min-h-32 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            value={draft[stemField]}
            onChange={(e) => setDraft((d) => ({ ...d, [stemField]: e.target.value }))}
          />
        ) : (
          <div className="min-h-16 text-sm leading-relaxed">
            {draft[stemField] ? (
              <LatexRenderer latex={draft[stemField]} />
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
              {draft[stemField] && (
                <button
                  onClick={() => {
                    setDraft((d) => ({ ...d, [stemField]: "" }));
                    onSave(stemField, "");
                  }}
                  className="px-3 py-1.5 bg-red-100 text-red-600 rounded text-xs font-medium hover:bg-red-200"
                  title="Clear the stem so it can be re-populated via Split & apply below"
                >
                  Clear
                </button>
              )}
            </>
          )}
        </div>

        {/* Claude correction row */}
        <div className="flex gap-2 pt-1 border-t border-indigo-100">
          <input
            type="text"
            placeholder="Correction for Claude, e.g. 'fix the fraction in line 2'..."
            value={claudeInstruction}
            onChange={(e) => setClaudeInstruction(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runClaude()}
            className="flex-1 border border-gray-300 rounded-md px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-purple-400"
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
            className="w-full border border-gray-300 rounded-md p-2 font-mono text-sm resize-y min-h-32 focus:outline-none focus:ring-2 focus:ring-blue-400"
            value={draft[activeField]}
            onChange={(e) =>
              setDraft((d) => ({ ...d, [activeField]: e.target.value }))
            }
          />
        ) : (
          <div className="min-h-16 text-sm leading-relaxed">
            {draft[activeField] ? (
              <LatexRenderer latex={draft[activeField]} />
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
            type="text"
            placeholder="Correction for Claude, e.g. 'fix the fraction in line 2'..."
            value={claudeInstruction}
            onChange={(e) => setClaudeInstruction(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runClaude()}
            className="flex-1 border border-gray-300 rounded-md px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-purple-400"
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
  const [expanded, setExpanded] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [loadingUrls, setLoadingUrls] = useState(false);
  const [allQuestionImages, setAllQuestionImages] = useState<QuestionImage[]>([]);
  const [imageType, setImageType] = useState<"question" | "markscheme">("question");
  const [activeField, setActiveField] = useState<Field>("content_latex");
  const [verified, setVerifiedState] = useState(
    question.question_parts.every((p) => p.latex_verified)
  );
  const [parts, setParts] = useState<QuestionPart[]>(
    [...question.question_parts].sort((a, b) => a.sort_order - b.sort_order)
  );
  const [stemLatex, setStemLatex] = useState<string | null>(question.stem_latex ?? null);
  const [stemMarkschemeLatex, setStemMarkschemeLatex] = useState<string | null>(question.stem_markscheme_latex ?? null);
  const [partsDraftLatex, setPartsDraftLatex] = useState<string | null>(question.parts_draft_latex ?? null);
  const [partsDraftMarkschemeLatex, setPartsDraftMarkschemeLatex] = useState<string | null>(question.parts_draft_markscheme_latex ?? null);

  const pagePaths = question.page_image_paths ?? [];
  const hasExtractedImages = question.has_question_images || question.has_markscheme_images;
  // Filter images client-side by the selected image_type
  const questionImages = allQuestionImages.filter((img) => img.image_type === imageType);

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

  function handleDraftSave(field: DraftField, value: string) {
    saveDraftLatex(question.id, field, value);
    if (field === "parts_draft_latex") setPartsDraftLatex(value);
    else setPartsDraftMarkschemeLatex(value);
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

  const currentPageUrl = hasExtractedImages
    ? (questionImages[pageIndex]?.url ?? null)
    : pagePaths[pageIndex]
      ? (signedUrls[pagePaths[pageIndex]] ?? null)
      : null;
  const totalPages = hasExtractedImages ? questionImages.length : pagePaths.length;

  const allVerified = parts.every((p) => p.latex_verified);
  const hasContentLatex = parts.some((p) => p.content_latex && p.content_latex.trim().length > 0);
  const hasMSLatex = parts.some((p) => p.markscheme_latex && p.markscheme_latex.trim().length > 0);

  return (
    <div ref={cardRef} className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
      {/* Header — left 2/3 is info/copy area, right 1/3 collapses */}
      <div className="w-full flex items-center bg-white hover:bg-gray-50 transition-colors text-left divide-x divide-gray-100">
        {/* Left zone: code + badges (copyable, does NOT toggle) */}
        <div className="flex items-center gap-3 px-5 py-3 flex-1 min-w-0">
          <button
            type="button"
            title="Click to copy code"
            onClick={async () => {
              try { await navigator.clipboard.writeText(question.code); } catch { /* ignore */ }
            }}
            className="font-mono font-semibold text-sm text-gray-800 hover:text-indigo-600 cursor-copy select-all"
          >
            {question.code}
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
        <button
          type="button"
          className="flex items-center justify-end gap-2 px-5 py-3 w-1/3 cursor-pointer hover:bg-gray-100 transition-colors text-gray-400 text-xs"
          onClick={() => (expanded ? setExpanded(false) : expand())}
        >
          <span>{expanded ? "collapse ▲" : "expand ▼"}</span>
        </button>
      </div>

      {expanded && (
        <div className="border-t border-gray-200 grid grid-cols-2 gap-0 min-h-96">
          {/* Left: image viewer */}
          <div className="border-r border-gray-200 flex flex-col bg-gray-50">
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
              <div className="ml-auto flex gap-1">
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
                    className="max-w-full shadow-sm border border-gray-200 rounded"
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
          <div className="flex flex-col overflow-auto">
            <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-200 bg-white">
              <span className="text-xs font-medium text-gray-600">
                {parts.length} part{parts.length !== 1 ? "s" : ""}
              </span>
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
                onClick={toggleVerified}
                className={`ml-auto px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  verified
                    ? "bg-green-100 text-green-700 hover:bg-green-200"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {verified ? "✓ Verified" : "Mark all verified"}
              </button>
            </div>
            <div className="p-4 space-y-4 overflow-auto">
              {parts.length === 0 ? (
                <p className="text-gray-400 text-sm italic">No parts found.</p>
              ) : (
                <>
                  {/* Show stem editor for multi-part questions (question side only — MS has no stem) */}
                  {parts.some((p) => p.part_label && p.part_label.trim() !== "") && (
                    <>
                      {activeField === "content_latex" && (
                        <StemEditor
                          questionId={question.id}
                          stemLatex={stemLatex}
                          stemMarkschemeLatex={stemMarkschemeLatex}
                          pageImageUrl={currentPageUrl}
                          activeField={activeField}
                          onSave={handleStemSave}
                        />
                      )}
                      <DraftPartsPanel
                        questionId={question.id}
                        draftLatex={partsDraftLatex}
                        draftMarkschemeLatex={partsDraftMarkschemeLatex}
                        activeField={activeField}
                        parts={parts}
                        onSave={handleDraftSave}
                        onApply={(stem, splitParts) => {
                          // Save stem
                          const stemField: StemField = activeField === "content_latex" ? "stem_latex" : "stem_markscheme_latex";
                          handleStemSave(stemField, stem);
                          // Save each matched part
                          const contentField: Field = activeField === "content_latex" ? "content_latex" : "markscheme_latex";
                          splitParts.forEach((content, label) => {
                            const matchedPart = parts.find((p) => p.part_label === label);
                            if (matchedPart) {
                              handleSave(matchedPart.id, contentField, content);
                            }
                          });
                        }}
                      />
                    </>
                  )}
                  {parts.map((part) => (
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

  async function run() {
    setStatus("running");
    setError(null);
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
            } else if (msg.type === "done") {
              setProgress({ completed: msg.totalQuestions, total: msg.totalQuestions, currentCode: "Done", totalImages: msg.totalImages, errors: msg.errors ?? 0 });
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

      {error && <p className="text-xs text-red-600 font-medium">⚠ {error}</p>}

      {progress && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-green-700">
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
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
              className="rounded"
            />
            <span>Force re-link (overwrite existing Doc IDs — use to fix stale/deleted links)</span>
          </label>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-600 font-medium">⚠ {error}</p>
      )}

      {result && (
        <div className="text-xs text-blue-700 space-y-1">
          <p>
            Found <strong>{result.found}</strong> docs to link
            {result.updated > 0 ? `, updated <strong>${result.updated}</strong> questions` : result.found > 0 ? " (dry run — no changes written)" : ""}
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
          type="text"
          placeholder="Search by code…"
          value={codeSearch}
          onChange={(e) => setCodeSearch(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-blue-400"
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
