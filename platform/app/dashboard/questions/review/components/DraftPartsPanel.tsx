"use client";

import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";
import { splitDraftIntoParts } from "../split-draft-into-parts";
import type { DraftField, Field, QuestionPart } from "./review-types";
import { saveDraftLatex } from "./review-types";

export interface DraftPartsPanelHandle {
  runOcrAndApply: (field?: Field) => void;
}

export const DraftPartsPanel = forwardRef<DraftPartsPanelHandle, {
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
