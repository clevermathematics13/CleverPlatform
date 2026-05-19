"use client";

import React, { useState } from "react";
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

      return (
        <span
          key={token.id}
          className="group relative inline-flex items-center gap-0.5 ml-1"
        >
          {singleSubtopic ? (
            <span className="font-mono text-[10px] px-1 bg-gray-100 text-gray-600 rounded">
              {singleSubtopic}
            </span>
          ) : isError ? (
            <span className="text-red-400 text-[10px]">err</span>
          ) : (
            <span className="inline-flex items-center gap-0.5">
              <select
                value={displayCode ?? ""}
                onChange={(e) => {
                  e.stopPropagation();
                  handleManualSelect(e.target.value);
                }}
                onClick={(e) => e.stopPropagation()}
                disabled={isLoading}
                title="Attribute this mark to a subtopic"
                className="text-[10px] font-mono text-gray-600 border border-gray-300 rounded px-0.5 bg-white leading-none"
              >
                <option value="">unassigned</option>
                {part.subtopic_codes.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
              <button
                type="button"
                title="Auto-assign with AI"
                disabled={isLoading}
                onClick={(e) => {
                  e.stopPropagation();
                  void generateMarkRationale(part, token.id);
                }}
                className="font-mono text-[10px] text-gray-400 hover:text-indigo-500 disabled:opacity-40"
              >
                {isLoading ? "…" : "✦"}
              </button>
            </span>
          )}
        </span>
      );
    };
  }

  return { tokenResults, generateMarkRationale, makeMarkAttributionRenderer };
}
