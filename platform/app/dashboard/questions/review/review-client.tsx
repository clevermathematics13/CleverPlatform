"use client";

import { useCallback, useEffect, useState } from "react";
import { ExtractAllImagesButton } from "./components/ExtractAllImagesButton";
import { QuestionReviewCard } from "./components/QuestionReviewCard";
import type { Question } from "./components/review-types";
import { SyncDriveDocsButton } from "./components/SyncDriveDocsButton";

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
