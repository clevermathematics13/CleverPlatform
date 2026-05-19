"use client";

import { useEffect, useState } from "react";
import LatexRenderer from "@/components/LatexRenderer";
import { playChatCompletionChime } from "@/lib/chat-audio";
import { readJsonSafely } from "@/lib/http-json";
import { IB_CORRECTION_SYSTEM } from "@/lib/latex-utils";
import type { Field, QuestionPart } from "./review-types";
import { saveLatex } from "./review-types";

export function PartEditor({
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
      const data = await readJsonSafely<{ content?: { text?: string }[]; completion?: string }>(res);
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
    ? `part ${part.part_label.toLowerCase()}`
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
