"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import LatexRenderer from "@/components/LatexRenderer";
import { CommandTermCombobox } from "./CommandTermCombobox";
import { DraftPartsPanel } from "./DraftPartsPanel";
import type { DraftPartsPanelHandle } from "./DraftPartsPanel";
import { PartEditor } from "./PartEditor";
import { StemEditor } from "./StemEditor";
import {
  canonicalCommandTerm,
  createPartMetadata,
  DEFAULT_COMMAND_TERMS,
  getSignedUrls,
  listPartMetadataVersions,
  revertPartMetadata,
  saveLatex,
  savePartMetadata,
  saveDraftLatex,
  saveStemLatex,
  setVerified,
} from "./review-types";
import type { DraftField, Field, PartMetadataPayload, PartMetadataVersion, Question, QuestionImage, QuestionPart, StemField } from "./review-types";

export function QuestionReviewCard({
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
