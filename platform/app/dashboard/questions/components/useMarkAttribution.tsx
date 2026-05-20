"use client";

import React, { useState, useEffect, useRef } from "react";
import { parseMSTokens } from "@/lib/latex-utils";
import type { QuestionPart, MarkAttribution } from "./types";

export type TokenRationaleResult = {
  selectedSubtopic: string;
  confidence: number;
  confidenceBucket: "high" | "medium" | "low";
  rationale: string;
  evidenceSpan: string;
};

/**
 * Manages mark-level subtopic attribution state for a question.
 * State is initialised from the persisted `mark_attributions` column and
 * automatically synced back to the DB on every manual or AI change.
 */
export function useMarkAttribution(
  questionParts: QuestionPart[],
  availableSubtopics: { code: string; descriptor?: string | null }[],
) {
  const [tokenResults, setTokenResults] = useState<
    Record<string, TokenRationaleResult | "loading" | "error">
  >(() => {
    const initial: Record<string, TokenRationaleResult> = {};
    for (const part of questionParts) {
      if (!part.mark_attributions) continue;
      for (const [tokenId, attr] of Object.entries(
        part.mark_attributions as Record<string, MarkAttribution>,
      )) {
        const key = `${part.id}-${tokenId}`;
        initial[key] = {
          selectedSubtopic: attr.subtopicCode,
          confidence: attr.source === "manual" ? 1 : 0.8,
          confidenceBucket: attr.source === "manual" ? "high" : "medium",
          rationale: attr.rationale ?? (attr.source === "manual" ? "Manual" : "AI"),
          evidenceSpan: "",
        };
      }
    }
    return initial;
  });

  const [activePopover, setActivePopover] = useState<string | null>(null);

  // Auto-generate subtopic attribution for all unassigned tokens on mount.
  // - Single-subtopic parts: trivially persist the one code to DB (no AI).
  // - Single-subtopic parts: trivially persist the one code to DB (no AI).
  // - Multi-subtopic parts: use AI to pick the best subtopic per token.
  // Tracks which part IDs have already been processed so re-renders caused by
  // questionParts prop changes (e.g. after an extraction + onRefresh) still
  // trigger auto-gen for newly-appeared parts without re-processing old ones.
  const autoGenProcessedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const part of questionParts) {
      if (autoGenProcessedRef.current.has(part.id)) continue;
      autoGenProcessedRef.current.add(part.id);
      if (part.subtopic_codes.length === 0) continue;
      const tokens = parseMSTokens(part.markscheme_latex ?? "");
      if (tokens.length === 0) continue;
      if (part.subtopic_codes.length === 1) {
        // Single subtopic: persist without AI for any token not yet in DB.
        const code = part.subtopic_codes[0];
        for (const token of tokens) {
          const key = `${part.id}-${token.id}`;
          if (!tokenResults[key]) {
            void persistAttribution(part.id, token.id, code, "ai", "Auto-attributed — single subtopic");
          }
        }
      } else {
        // Multi-subtopic: use AI per token.
        for (const token of tokens) {
          const key = `${part.id}-${token.id}`;
          if (!tokenResults[key]) {
            void generateMarkRationale(part, token.id);
          }
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionParts]);

  async function persistAttribution(
    partId: string,
    tokenId: string,
    subtopicCode: string | null,
    source: "manual" | "ai",
    rationale?: string,
  ) {
    try {
      await fetch("/api/questions/mark-attribution", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partId, tokenId, subtopicCode, source, rationale }),
      });
    } catch {
      // Non-fatal: the UI already reflects the local state update
    }
  }

  async function generateMarkRationale(part: QuestionPart, tokenId: string) {
    const { parseMSTokens: _parseTokens } = await import("@/lib/latex-utils");
    const tokens = _parseTokens(part.markscheme_latex ?? "");
    const token = tokens.find((t) => t.id === tokenId);
    if (!token) return;

    const key = `${part.id}-${tokenId}`;
    setTokenResults((r) => ({ ...r, [key]: "loading" }));
    try {
      const res = await fetch("/api/questions/mark-rationale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partLabel: part.part_label,
          partMarks: part.marks,
          token,
          subtopicCodes: part.subtopic_codes,
          primarySubtopicCode: part.primary_subtopic_code ?? null,
          questionLatex: part.content_latex ?? "",
          markschemeLatex: part.markscheme_latex ?? "",
          availableSubtopics: availableSubtopics.map((s) => ({
            code: s.code,
            descriptor: s.descriptor ?? s.code,
          })),
        }),
      });
      if (!res.ok) {
        setTokenResults((r) => ({ ...r, [key]: "error" }));
        return;
      }
      const data = (await res.json()) as TokenRationaleResult;
      setTokenResults((r) => ({ ...r, [key]: data }));
      void persistAttribution(part.id, tokenId, data.selectedSubtopic, "ai", data.rationale);
    } catch {
      setTokenResults((r) => ({ ...r, [key]: "error" }));
    }
  }

  /**
   * Returns the `renderMarkAttribution` callback for a given part and its
   * rendered markscheme LaTeX. Pass this directly to `<LatexRenderer>`.
   */
  function makeMarkAttributionRenderer(
    part: QuestionPart,
    saved: string,
  ): (label: string, ordinal: number) => React.ReactNode {
    return (label: string, ordinal: number) => {
      const tokens = parseMSTokens(saved);
      const token = tokens[ordinal];
      if (!token) return null;

      const singleSubtopic =
        part.subtopic_codes.length === 1 ? part.subtopic_codes[0] : null;
      const rKey = `${part.id}-${token.id}`;
      const result = tokenResults[rKey];
      const isLoading = result === "loading";
      const isError = result === "error";
      const hasResult = result && result !== "loading" && result !== "error";
      const res = hasResult ? (result as TokenRationaleResult) : null;
      const displayCode = singleSubtopic ?? res?.selectedSubtopic ?? null;

      const handleManualSelect = (code: string) => {
        if (code) {
          setTokenResults((r) => ({
            ...r,
            [rKey]: {
              selectedSubtopic: code,
              confidence: 1,
              confidenceBucket: "high",
              rationale: "Manual",
              evidenceSpan: "",
            } as TokenRationaleResult,
          }));
          void persistAttribution(part.id, token.id, code, "manual");
        } else {
          setTokenResults((r) => {
            const next = { ...r };
            delete next[rKey];
            return next;
          });
          void persistAttribution(part.id, token.id, null, "manual");
        }
      };

      const hasRationale =
        !!res?.rationale && res.rationale !== "Manual" && res.rationale !== "AI";

      const popoverContent = (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setActivePopover(null)}
          />
          <div
            className="absolute right-0 top-full mt-1 z-50 w-56 bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-left"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-xs font-semibold text-indigo-700">
                {displayCode ?? "unassigned"}
              </span>
              <button
                type="button"
                onClick={() => setActivePopover(null)}
                className="text-gray-400 hover:text-gray-600 text-sm leading-none ml-2 shrink-0"
              >
                ×
              </button>
            </div>
            <div className="flex flex-wrap gap-1 mb-2">
              {part.subtopic_codes.map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => { handleManualSelect(code); setActivePopover(null); }}
                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded border transition-colors ${
                    displayCode === code
                      ? "bg-indigo-50 border-indigo-400 text-indigo-700"
                      : "border-gray-200 text-gray-600 hover:border-indigo-300 hover:text-indigo-600"
                  }`}
                >
                  {code}
                </button>
              ))}
              {part.subtopic_codes.length > 1 && (
                <button
                  type="button"
                  onClick={() => { handleManualSelect(""); setActivePopover(null); }}
                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded border transition-colors ${
                    !displayCode
                      ? "bg-gray-100 border-gray-400 text-gray-700"
                      : "border-gray-200 text-gray-400 hover:border-gray-400 hover:text-gray-600"
                  }`}
                >
                  unassigned
                </button>
              )}
            </div>
            {hasRationale ? (
              <div className="space-y-1 border-t border-gray-100 pt-2">
                <p className="text-xs text-gray-700 leading-snug">{res!.rationale}</p>
                {res!.evidenceSpan && (
                  <p className="text-[10px] text-gray-400 italic">&ldquo;{res!.evidenceSpan}&rdquo;</p>
                )}
                <p className="text-[10px] text-gray-400">
                  Confidence: {res!.confidenceBucket}
                </p>
              </div>
            ) : null}
            <button
              type="button"
              disabled={isLoading}
              onClick={(e) => {
                e.stopPropagation();
                void generateMarkRationale(part, token.id);
              }}
              className="mt-2 text-[10px] text-indigo-500 hover:text-indigo-700 disabled:opacity-40 flex items-center gap-1"
            >
              {isLoading
                ? "Generating…"
                : hasRationale
                  ? "↺ Regenerate"
                  : "✦ Generate rationale"}
            </button>
          </div>
        </>
      );

      return (
        <span
          key={token.id}
          className="group relative inline-flex items-center gap-0.5 ml-1"
        >
          <span className="relative">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setActivePopover(activePopover === rKey ? null : rKey);
              }}
              className={`font-mono text-[10px] px-1 rounded cursor-pointer transition-colors ${
                isError
                  ? "bg-red-50 text-red-400"
                  : isLoading
                    ? "bg-gray-100 text-gray-400 animate-pulse"
                    : displayCode
                      ? "bg-gray-100 hover:bg-indigo-50 text-gray-600 hover:text-indigo-600"
                      : "bg-gray-50 text-gray-400 hover:bg-indigo-50 hover:text-indigo-500 border border-dashed border-gray-300"
              }`}
            >
              {isLoading ? "…" : isError ? "err" : (displayCode ?? "?")}
            </button>
            {activePopover === rKey && popoverContent}
          </span>
        </span>
      );
    };
  }

  return { tokenResults, generateMarkRationale, makeMarkAttributionRenderer };
}
