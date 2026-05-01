"use client";

import { useState, useCallback } from "react";
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
  question_parts: QuestionPart[];
}

interface SignedUrl {
  path: string;
  url: string;
}

type Field = "content_latex" | "markscheme_latex";

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

async function setVerified(questionId: string, verified: boolean) {
  await fetch("/api/questions/latex-verify", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ questionId, verified }),
  });
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
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);

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

  async function runOcr() {
    setOcrLoading(true);
    setOcrError(null);
    try {
      const res = await fetch("/api/questions/ocr-latex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId, field: activeField }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOcrError(data.error ?? "OCR failed");
        return;
      }
      const latex: string = data.latex ?? "";
      setDraft((d) => ({ ...d, [activeField]: latex }));
      onSave(part.id, activeField, latex);
    } catch {
      setOcrError("Network error");
    } finally {
      setOcrLoading(false);
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
            className="w-full border border-gray-300 rounded-md p-2 font-mono text-sm resize-y min-h-[120px] focus:outline-none focus:ring-2 focus:ring-blue-400"
            value={draft[activeField]}
            onChange={(e) =>
              setDraft((d) => ({ ...d, [activeField]: e.target.value }))
            }
          />
        ) : (
          <div className="min-h-[60px] text-sm leading-relaxed">
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

        {/* OCR extract row */}
        <div className="flex items-center gap-2 pt-1 border-t border-gray-100">
          <button
            onClick={runOcr}
            disabled={ocrLoading}
            className="px-3 py-1.5 bg-orange-600 text-white rounded text-xs font-medium hover:bg-orange-700 disabled:opacity-40"
            title={`Run OCR on the stored ${activeField === "content_latex" ? "question" : "mark scheme"} images`}
          >
            {ocrLoading ? "Extracting…" : "⟳ Extract LaTeX from images"}
          </button>
          {ocrError && (
            <span className="text-xs text-red-500">{ocrError}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── QuestionReviewCard ──────────────────────────────────────────────────────

function QuestionReviewCard({
  question,
  onVerify,
}: {
  question: Question;
  onVerify: (id: string, v: boolean) => void;
}) {
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

  const pagePaths = question.page_image_paths ?? [];
  const hasExtractedImages = question.has_question_images || question.has_markscheme_images;
  // Filter images client-side by the selected image_type
  const questionImages = allQuestionImages.filter((img) => img.image_type === imageType);

  async function expand() {
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

  async function toggleVerified() {
    const next = !verified;
    setVerifiedState(next);
    await setVerified(question.id, next);
    onVerify(question.id, next);
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
    <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
      {/* Header */}
      <button
        className="w-full flex items-center gap-3 px-5 py-3 bg-white hover:bg-gray-50 transition-colors text-left"
        onClick={() => (expanded ? setExpanded(false) : expand())}
      >
        <span className="font-mono font-semibold text-sm text-gray-800">
          {question.code}
        </span>
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
          <span className="ml-auto text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
            ✓ All verified
          </span>
        )}
        <span className="ml-auto text-gray-400 text-xs">
          {expanded ? "▲" : "▼"}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-gray-200 grid grid-cols-2 gap-0 min-h-[500px]">
          {/* Left: image viewer */}
          <div className="border-r border-gray-200 flex flex-col bg-gray-50">
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
            <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
              {loadingUrls ? (
                <span className="text-gray-400 text-sm">Loading…</span>
              ) : currentPageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={currentPageUrl}
                  alt={`Page ${pageIndex + 1}`}
                  className="max-w-full shadow-sm border border-gray-200 rounded"
                />
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
                parts.map((part) => (
                  <PartEditor
                    key={part.id}
                    part={part}
                    questionId={question.id}
                    pageImageUrl={currentPageUrl}
                    activeField={activeField}
                    onSave={handleSave}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ReviewClient (root) ─────────────────────────────────────────────────────

export default function ReviewClient({
  initialQuestions,
}: {
  initialQuestions: Question[];
}) {
  const [questions, setQuestions] = useState(initialQuestions);
  const [filterVerified, setFilterVerified] = useState<"all" | "verified" | "unverified">("unverified");
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

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <input
          type="text"
          placeholder="Search by code…"
          value={codeSearch}
          onChange={(e) => setCodeSearch(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-blue-400"
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
            />
          ))}
        </div>
      )}
    </div>
  );
}
