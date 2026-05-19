"use client";

import { useEffect, useState } from "react";
import LatexRenderer from "@/components/LatexRenderer";
import { playChatCompletionChime } from "@/lib/chat-audio";
import { readJsonSafely } from "@/lib/http-json";
import { IB_CORRECTION_SYSTEM } from "@/lib/latex-utils";
import type { Field, StemField } from "./review-types";
import { saveStemLatex } from "./review-types";

export function StemEditor({
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
      const data = await readJsonSafely<{ content?: { text?: string }[]; completion?: string }>(res);
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
