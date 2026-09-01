"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import "katex/dist/katex.min.css";
import { ImageSection } from "./ImageSection";
import { useMarkAttribution } from "./useMarkAttribution";
import type {
  Question,
  QuestionPart,
  QuestionImage,
  Subtopic,
} from "./types";

// -- Helpers --------------------------------------------------------------

export function QuestionRow({
  question,
  expanded,
  onOpen,
  onClose,
  totalMarks,
  commandTerms,
  onUpdateCommandTerm,
  onAddCustomTerm,
  availableSubtopics,
  onUpdateSubtopics,
  images,
  extracting,
  driveConnected,
  onExtractImages,
  hasTroubleshooting,
  troubleshootingCopied,
  onCopyTroubleshooting,
  deletingImageIds,
  uploadingImage,
  onDeleteImage,
  onDeleteAllImages,
  onReorderImages,
  onUploadImage,
  testBuilderOpen,
  inQueue,
  onAddToQueue,
  savedExamWithQuestion,
  onOpenSavedExam,
  onOpenEditor,
  hideCollapsedRow,
  externalMinimized,
  savingSection,
  onUpdateSection,
  onRefresh,
  onQueueMarksChange,
}: {
  question: Question;
  expanded: boolean;
  onOpen: () => void;
  onClose: () => void;
  totalMarks: number;
  commandTerms: string[];
  onUpdateCommandTerm: (partId: string, commandTerm: string | null) => void;
  onAddCustomTerm: (term: string) => void;
  availableSubtopics: Subtopic[];
  onUpdateSubtopics: (partId: string, codes: string[], primaryCode?: string | null) => void;
  images: QuestionImage[];
  extracting: boolean;
  driveConnected: boolean;
  onExtractImages: () => void;
  hasTroubleshooting: boolean;
  troubleshootingCopied: boolean;
  onCopyTroubleshooting: () => void;
  deletingImageIds: Set<string>;
  uploadingImage: boolean;
  onDeleteImage: (imageId: string) => void;
  onDeleteAllImages: () => void;
  onReorderImages: (imageType: "question" | "markscheme", orderedIds: string[]) => void;
  onUploadImage: (imageType: "question" | "markscheme", file: File) => void;
  testBuilderOpen: boolean;
  inQueue: boolean;
  onAddToQueue: () => void;
  savedExamWithQuestion: import("./types").SavedExam | null;
  onOpenSavedExam: (exam: import("./types").SavedExam) => void;
  onOpenEditor?: () => void;
  hideCollapsedRow?: boolean;
  externalMinimized?: boolean;
  savingSection: boolean;
  onUpdateSection: (section: "A" | "B") => void;
  onRefresh: () => void;
  onQueueMarksChange: (questionId: string, marks: number) => void;
}) {
  const showSection = question.paper !== 3;
  const hasDocLinkConflict = question.google_ms_id !== null && question.google_doc_id === question.google_ms_id;
  const [showSectionPrompt, setShowSectionPrompt] = useState(false);
  const [primaryWarningDialog, setPrimaryWarningDialog] = useState<{ labels: string; plural: boolean } | null>(null);
  const [internalMinimized, setInternalMinimized] = useState(false);
  const expandedRef = useRef(expanded);
  useEffect(() => { expandedRef.current = expanded; }, [expanded]);

  const minimized = externalMinimized !== undefined ? externalMinimized : internalMinimized;
  const [partsCollapsed, setPartsCollapsed] = useState(false);

  const [editingPartId, setEditingPartId] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<"marks" | "label" | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [savingField, setSavingField] = useState(false);
  const [addingPart, setAddingPart] = useState(false);
  const [newPartLabel, setNewPartLabel] = useState("");
  const [newPartMarks, setNewPartMarks] = useState("1");
  const [newPartLatex, setNewPartLatex] = useState("");
  const [savingNewPart, setSavingNewPart] = useState(false);
  const [newPartError, setNewPartError] = useState<string | null>(null);
  const [deletingPartId, setDeletingPartId] = useState<string | null>(null);
  const [confirmDeletePartId, setConfirmDeletePartId] = useState<string | null>(null);
  const [editingQueueMarks, setEditingQueueMarks] = useState(false);
  const [queueMarksDraft, setQueueMarksDraft] = useState("");
  const [editingLinks, setEditingLinks] = useState(false);
  const [linkDraftQ, setLinkDraftQ] = useState(question.google_doc_id ?? "");
  const [linkDraftMS, setLinkDraftMS] = useState(question.google_ms_id ?? "");
  const [savingLinks, setSavingLinks] = useState(false);
  const [linkSaveResult, setLinkSaveResult] = useState<string | null>(null);
  const [dragOverCode, setDragOverCode] = useState<string | null>(null);
  const [showNotePanel, setShowNotePanel] = useState(false);
  const [noteDraft, setNoteDraft] = useState(question.note ?? "");
  const [savingNote, setSavingNote] = useState(false);
  const [deletingQuestion, setDeletingQuestion] = useState(false);
  const [convertingLatex, setConvertingLatex] = useState<"question" | "markscheme" | null>(null);
  const [convertLatexError, setConvertLatexError] = useState<string | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [classifyResult, setClassifyResult] = useState<string | null>(null);

  const savePartField = async (partId: string, field: "marks" | "label", value: string) => {
    setSavingField(true);
    try {
      const body: Record<string, string | number> = { partId };
      if (field === "marks") body.marks = parseInt(value) || 0;
      else if (field === "label") body.partLabel = value.trim();
      const res = await fetch("/api/questions/part-metadata", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) { console.error("Save failed:", data.error); return; }
      if (field === "marks" && data.marks !== undefined) {
        onQueueMarksChange(question.id, question.question_parts.reduce((sum, p) => sum + (p.id === partId ? data.marks : p.marks), 0));
      }
      onRefresh();
    } finally {
      setSavingField(false);
      setEditingPartId(null);
      setEditingField(null);
    }
  };

  const saveLinks = async () => {
    setSavingLinks(true);
    setLinkSaveResult(null);
    try {
      const extractDocId = (input: string): string => {
        const match = input.match(/\/d\/([\w-]+)/);
        return match ? match[1] : input.trim();
      };
      const docId = extractDocId(linkDraftQ);
      const msId = linkDraftMS.trim() ? extractDocId(linkDraftMS) : null;
      const res = await fetch("/api/questions/doc-links", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: question.id, googleDocId: docId || null, googleMsId: msId }),
      });
      const data = await res.json();
      if (data.error) { setLinkSaveResult(`Error: ${data.error}`); return; }
      setLinkSaveResult("Saved");
      setTimeout(() => { setLinkSaveResult(null); setEditingLinks(false); }, 1000);
      onRefresh();
    } finally { setSavingLinks(false); }
  };

  const saveNote = async () => {
    setSavingNote(true);
    try {
      const res = await fetch("/api/questions/note", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: question.id, note: noteDraft.trim() || null }),
      });
      const data = await res.json();
      if (!data.error) { setShowNotePanel(false); onRefresh(); }
    } finally { setSavingNote(false); }
  };

  const deleteQuestion = async () => {
    if (!confirm(`Permanently delete question ${question.code}? This cannot be undone.`)) return;
    setDeletingQuestion(true);
    try {
      const res = await fetch(`/api/questions?id=${question.id}`, { method: "DELETE" });
      if (res.ok) onRefresh();
    } finally { setDeletingQuestion(false); }
  };

  // Auto-classification: send the question's stored LaTeX to the server, which runs
  // IB_CLASSIFY_SYSTEM and non-destructively fills in subtopic codes, the primary
  // (★) subtopic, and command terms per part. Restores the pre-June-2026 behaviour
  // that was lost in the Question Studio rewrite. Non-destructive + idempotent, so
  // it is safe to re-run.
  const classifyQuestion = async (opts?: { silent?: boolean }) => {
    setClassifying(true);
    if (!opts?.silent) setClassifyResult(null);
    try {
      const res = await fetch("/api/questions/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: question.id }),
      });
      const data = await res.json();
      if (data.error) { setClassifyResult(`Error: ${data.error}`); return; }
      if (data.note) {
        setClassifyResult(data.note);
      } else {
        const n = Array.isArray(data.classified) ? data.classified.length : 0;
        const changed = typeof data.changedCount === "number" ? data.changedCount : n;
        setClassifyResult(`Classified ${n} part${n === 1 ? "" : "s"}${changed !== n ? ` (${changed} updated)` : ""}`);
      }
      onRefresh();
    } catch (e: unknown) {
      setClassifyResult(e instanceof Error ? e.message : "Classification failed");
    } finally {
      setClassifying(false);
    }
  };

  const convertImagesToLatex = async (imageType: "question" | "markscheme") => {
    setConvertingLatex(imageType);
    setConvertLatexError(null);
    try {
      // NOTE: use the legacy content_latex / markscheme_latex fields — these are
      // what the LaTeX panel in ImageSection actually reads via question.question_parts.
      // The parts_draft_* fields write to ib_questions instead and were never
      // connected to this view, which caused "Re-extract" to appear to do nothing
      // (stale LaTeX from an old extraction kept rendering).
      const field = imageType === "question" ? "content_latex" : "markscheme_latex";
      const res = await fetch("/api/questions/ocr-latex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: question.id, field }),
      });
      const data = await res.json();
      if (data.error) { setConvertLatexError(data.error); return; }
      // After extracting the QUESTION, automatically classify subtopics + command
      // terms. classifyQuestion is non-destructive and calls onRefresh() itself.
      // For markscheme extraction we just refresh; the teacher can re-run
      // classification with the button to fold in the improved mark-scheme context.
      if (imageType === "question") {
        await classifyQuestion({ silent: true });
      } else {
        onRefresh();
      }
    } catch (e: unknown) {
      setConvertLatexError(e instanceof Error ? e.message : "Conversion failed");
    } finally {
      setConvertingLatex(null);
    }
  };

  const questionImages = images.filter((i) => i.image_type === "question").sort((a, b) => a.sort_order - b.sort_order);
  const msImages = images.filter((i) => i.image_type === "markscheme").sort((a, b) => a.sort_order - b.sort_order);

  const questionLatex = question.question_parts
    .filter((p) => (p.content_latex ?? p.latex ?? "").trim())
    .map((p) => ({ partId: p.id, label: p.part_label, latex: (p.content_latex ?? p.latex)! }));

  // Mark-level subtopic attribution — renders a clickable tag on each markscheme
  // mark token (A1, M1, R1, …) indicating which subtopic that mark assesses. The
  // hook + LatexRenderer support survived the June 2026 UI rewrite, but the wiring
  // that connects them was dropped; reconnecting it here restores the inline
  // attribution tags in the markscheme LaTeX panel. Tags only appear once a part
  // has subtopics assigned (classify the question first).
  const { makeMarkAttributionRenderer } = useMarkAttribution(
    question.question_parts,
    availableSubtopics,
  );

  const msLatex = question.question_parts
    .filter((p) => (p.markscheme_latex ?? "").trim())
    .map((p) => ({
      partId: p.id,
      label: p.part_label,
      latex: p.markscheme_latex!,
      renderMarkAttribution: makeMarkAttributionRenderer(p, p.markscheme_latex!),
    }));

  // Persist a manual edit made in ImageSection's LaTeX panel — writes to
  // content_latex (question side) or markscheme_latex (isMarkscheme) via the
  // shared part-metadata PATCH endpoint, then refreshes so the rendered
  // panel and any dependent state (mark-attribution tokens, etc.) pick up
  // the new text.
  const saveImageLatex = async (
    partId: string,
    isMarkscheme: boolean,
    value: string,
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch("/api/questions/part-metadata", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partId,
          latex: value,
          ...(isMarkscheme ? { latexField: "markscheme_latex" } : {}),
        }),
      });
      const data = await res.json();
      if (data.error) return { ok: false, error: data.error };
      onRefresh();
      return { ok: true };
    } catch (e: unknown) {
      return { ok: false, error: e instanceof Error ? e.message : "Save failed" };
    }
  };

  return (
    <>
      {!hideCollapsedRow && <tr
        className={`cursor-pointer hover:bg-blue-500/15 transition-colors ${expanded ? "bg-blue-500/15" : ""}`}
        onClick={() => { if (expanded) onClose(); else onOpen(); }}
      >
        <td className="px-4 py-2">
          <div className="flex items-center gap-1.5">
            {hasDocLinkConflict && (
              <span className="inline-flex items-center rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold text-red-300" title="Question doc and markscheme doc are the same file — links need to be fixed">⚠ conflict</span>
            )}
            {onOpenEditor ? (
              <button type="button" onClick={(e) => { e.stopPropagation(); onOpenEditor(); }} title="Open Question Studio"
                className={`font-mono text-sm font-semibold hover:underline hover:text-indigo-300 transition-colors ${expanded ? "text-blue-300" : "text-blue-300"}`}>
                {question.code}
              </button>
            ) : (
              <span className={`font-mono text-sm font-semibold ${expanded ? "text-blue-300" : "text-blue-300"}`}>{question.code}</span>
            )}
          </div>
        </td>
        <td className="px-4 py-2 text-center text-sm text-da-text">{question.session}</td>
        <td className="px-4 py-2 text-center text-sm text-da-text">P{question.paper}</td>
        <td className="px-4 py-2 text-center">
          <span className={`px-2.5 py-0.5 rounded-full font-semibold text-xs ${question.level === "AHL" ? "bg-purple-500/15 text-purple-300" : "bg-green-500/15 text-green-300"}`}>
            {question.level === "AHL" ? "HL" : "SL"}
          </span>
        </td>
        <td className="px-4 py-2 text-center text-sm text-da-text">{question.timezone ?? "—"}</td>
        <td className="px-4 py-2 text-center text-sm text-da-text">{question.question_parts.length}</td>
        <td className="px-4 py-2 text-center text-sm font-semibold text-da-text">
          {inQueue && editingQueueMarks ? (
            <input type="number" min={0} max={99} value={queueMarksDraft} onClick={(e) => e.stopPropagation()}
              onChange={(e) => setQueueMarksDraft(e.target.value)}
              onBlur={() => { const v = parseInt(queueMarksDraft); if (!isNaN(v) && v >= 0) onQueueMarksChange(question.id, v); setEditingQueueMarks(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") { const v = parseInt(queueMarksDraft); if (!isNaN(v) && v >= 0) onQueueMarksChange(question.id, v); setEditingQueueMarks(false); } if (e.key === "Escape") setEditingQueueMarks(false); e.stopPropagation(); }}
              className="w-12 rounded border border-blue-400/40 px-1 py-0.5 text-center text-sm font-semibold" autoFocus />
          ) : (
            <span onClick={(e) => { if (inQueue) { e.stopPropagation(); setQueueMarksDraft(String(totalMarks)); setEditingQueueMarks(true); } }}
              title={inQueue ? "Click to override marks for this exam" : undefined}
              className={inQueue ? "cursor-pointer hover:text-blue-300 underline decoration-dotted" : ""}>
              {totalMarks}
            </span>
          )}
        </td>
        <td className="px-4 py-2 text-center" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-center gap-1.5">
            {question.google_doc_id ? (
              <a href={`https://docs.google.com/document/d/${question.google_doc_id}`} target="_blank" rel="noopener noreferrer"
                title={question.has_question_images ? "Question images extracted — open doc" : "Open question doc"}
                className={`text-xs font-semibold hover:underline ${question.has_question_images ? "text-emerald-300" : "text-blue-400"}`}>
                Q
              </a>
            ) : (
              <span className="text-xs font-semibold text-da-muted" title="No question doc linked">Q</span>
            )}
            {question.google_ms_id ? (
              <a href={`https://docs.google.com/document/d/${question.google_ms_id}`} target="_blank" rel="noopener noreferrer"
                title={question.has_markscheme_images ? "Markscheme images extracted — open doc" : "Open markscheme doc"}
                className={`text-xs font-semibold hover:underline ${question.has_markscheme_images ? "text-emerald-300" : "text-green-400"}`}>
                MS
              </a>
            ) : (
              <span className="text-xs font-semibold text-da-muted" title="No markscheme doc linked">MS</span>
            )}
          </div>
        </td>
        <td className="px-4 py-2 text-center" onClick={(e) => e.stopPropagation()}>
          {showSection ? (
            <div className="flex items-center justify-center gap-1">
              <button type="button" onClick={() => { onUpdateSection("A"); setShowSectionPrompt(false); }} disabled={savingSection}
                className={`rounded px-2 py-0.5 text-xs font-bold transition-colors ${question.section === "A" ? "bg-blue-600 text-white" : "bg-da-hover text-da-muted hover:bg-blue-500/15"}`}>A</button>
              <button type="button" onClick={() => { onUpdateSection("B"); setShowSectionPrompt(false); }} disabled={savingSection}
                className={`rounded px-2 py-0.5 text-xs font-bold transition-colors ${question.section === "B" ? "bg-indigo-600 text-white" : "bg-da-hover text-da-muted hover:bg-indigo-500/15"}`}>B</button>
            </div>
          ) : (<span className="text-xs text-da-muted">—</span>)}
        </td>
        {testBuilderOpen && (
          <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
            {question.has_question_images ? (
              inQueue ? (
                <button type="button" disabled title="Already in current exam" className="rounded-full w-7 h-7 text-sm font-bold transition-colors bg-indigo-500/15 text-indigo-400 cursor-default">✓</button>
              ) : savedExamWithQuestion ? (
                <button type="button" onClick={() => onOpenSavedExam(savedExamWithQuestion)} title={`Already in "${savedExamWithQuestion.name}" — click to open`}
                  className="rounded-full w-7 h-7 text-sm font-bold transition-colors bg-green-500/15 text-green-300 hover:bg-green-500/25 border border-green-400/40">✓</button>
              ) : (
                <button type="button" onClick={onAddToQueue} title="Add to exam" className="rounded-full w-7 h-7 text-sm font-bold transition-colors bg-indigo-600 text-white hover:bg-indigo-700">+</button>
              )
            ) : (<span className="text-xs text-da-muted" title="No images extracted">—</span>)}
          </td>
        )}
        <td className="px-2 py-2 text-center" onClick={(e) => e.stopPropagation()}>
          <div className="relative inline-block">
            <button type="button" title={question.note ? `Note: ${question.note}` : "Add note"}
              onClick={() => { setNoteDraft(question.note ?? ""); setShowNotePanel((v) => !v); }}
              className={`rounded-full w-6 h-6 text-xs transition-colors ${question.note ? "bg-amber-500/15 text-amber-300 hover:bg-amber-500/25" : "bg-da-hover text-da-muted hover:bg-gray-200"}`}>
              {question.note ? "💬" : "○"}
            </button>
            {showNotePanel && createPortal(
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowNotePanel(false)}>
                <div className="bg-da-surface rounded-xl shadow-2xl p-4 w-80 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
                  <h3 className="text-sm font-bold text-da-text">Note for {question.code}</h3>
                  <textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="Add a note about this question..."
                    className="rounded border border-da-border px-2 py-1.5 text-sm resize-none h-24 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  <div className="flex gap-2 justify-end">
                    <button type="button" onClick={() => setShowNotePanel(false)} className="rounded px-3 py-1 text-xs font-semibold border border-da-border text-da-muted hover:bg-da-hover">Cancel</button>
                    <button type="button" onClick={saveNote} disabled={savingNote} className="rounded px-3 py-1 text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">{savingNote ? "Saving…" : "Save"}</button>
                  </div>
                  {question.note && (<button type="button" onClick={() => { setNoteDraft(""); }} className="text-xs text-red-500 hover:underline text-left">Clear note</button>)}
                </div>
              </div>,
              document.body
            )}
          </div>
        </td>
      </tr>}

      {expanded && (
        <tr>
          <td colSpan={hideCollapsedRow ? 1 : testBuilderOpen ? 11 : 10} className="px-0 py-0 bg-blue-500/15">
            <div className="border-t border-blue-400/40 px-4 py-3 space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                {!hideCollapsedRow && (
                  <button type="button" onClick={() => setInternalMinimized((v) => !v)}
                    className="rounded border border-blue-400/40 bg-da-surface px-2.5 py-1 text-xs font-semibold text-blue-300 hover:bg-blue-500/15">
                    {internalMinimized ? "▼ Expand" : "▲ Minimise"}
                  </button>
                )}
                {!hideCollapsedRow && (
                  <button type="button" onClick={onClose} className="rounded border border-blue-400/40 bg-da-surface px-2.5 py-1 text-xs font-semibold text-blue-300 hover:bg-blue-500/15">✕ Close</button>
                )}
                {!editingLinks && (
                  <button type="button" onClick={() => { setLinkDraftQ(question.google_doc_id ?? ""); setLinkDraftMS(question.google_ms_id ?? ""); setEditingLinks(true); }}
                    className={`rounded border px-2.5 py-1 text-xs font-semibold ${hasDocLinkConflict ? "border-red-400 bg-red-500/15 text-red-300 hover:bg-red-500/15" : "border-blue-400/40 bg-da-surface text-blue-300 hover:bg-blue-500/15"}`}>
                    {hasDocLinkConflict ? "⚠ Fix Links" : "🔗 Edit Doc Links"}
                  </button>
                )}
                {question.google_doc_id && (
                  <a href={`https://docs.google.com/document/d/${question.google_doc_id}`} target="_blank" rel="noopener noreferrer"
                    className="rounded border border-blue-400/40 bg-da-surface px-2.5 py-1 text-xs font-semibold text-blue-300 hover:bg-blue-500/15 hover:underline">
                    📄 Open Q Doc
                  </a>
                )}
                {question.google_ms_id && (
                  <a href={`https://docs.google.com/document/d/${question.google_ms_id}`} target="_blank" rel="noopener noreferrer"
                    className="rounded border border-green-400/40 bg-da-surface px-2.5 py-1 text-xs font-semibold text-green-300 hover:bg-green-500/15 hover:underline">
                    📝 Open MS Doc
                  </a>
                )}
                <button type="button" onClick={() => classifyQuestion()} disabled={classifying}
                  className="rounded border border-teal-400/40 bg-da-surface px-2.5 py-1 text-xs font-semibold text-teal-300 hover:bg-teal-500/15 disabled:opacity-50">
                  {classifying ? "Classifying…" : "✦ Auto-classify"}
                </button>
                {classifyResult && (
                  <span className={`text-xs font-semibold ${classifyResult.startsWith("Error") ? "text-red-300" : "text-teal-300"}`}>{classifyResult}</span>
                )}
                <button type="button" onClick={deleteQuestion} disabled={deletingQuestion}
                  className="rounded border border-red-400/40 bg-da-surface px-2.5 py-1 text-xs font-semibold text-red-300 hover:bg-red-500/15 disabled:opacity-50">
                  {deletingQuestion ? "Deleting…" : "🗑 Delete"}
                </button>
              </div>

              {!minimized && (
                <div className="space-y-4">
                  {editingLinks && (
                    <div className="rounded-lg border border-blue-400/40 bg-da-surface p-3 space-y-2">
                      <p className="text-xs font-bold text-blue-300">Edit Google Doc Links</p>
                      {hasDocLinkConflict && (<p className="text-xs font-semibold text-red-300 bg-red-500/15 rounded px-2 py-1">⚠ Q doc and MS doc are the same file — this will cause extraction errors. Clear one of them.</p>)}
                      <label className="flex flex-col gap-0.5">
                        <span className="text-[11px] font-semibold text-blue-300">📄 Question Doc URL or ID</span>
                        <input type="text" value={linkDraftQ} onChange={(e) => setLinkDraftQ(e.target.value)} placeholder="https://docs.google.com/document/d/… or doc ID"
                          className="rounded border border-blue-400/40 px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-400 w-full max-w-xl" />
                      </label>
                      <label className="flex flex-col gap-0.5">
                        <span className="text-[11px] font-semibold text-green-300">📝 Markscheme Doc URL or ID</span>
                        <input type="text" value={linkDraftMS} onChange={(e) => setLinkDraftMS(e.target.value)} placeholder="https://docs.google.com/document/d/… or doc ID (leave blank to unlink)"
                          className="rounded border border-green-400/40 px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-green-400 w-full max-w-xl" />
                      </label>
                      <div className="flex gap-2">
                        <button type="button" onClick={saveLinks} disabled={savingLinks} className="rounded bg-blue-600 px-3 py-1 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50">{savingLinks ? "Saving…" : "Save Links"}</button>
                        <button type="button" onClick={() => { setEditingLinks(false); setLinkDraftQ(question.google_doc_id ?? ""); setLinkDraftMS(question.google_ms_id ?? ""); }} disabled={savingLinks}
                          className="rounded border border-da-border px-3 py-1 text-xs font-bold text-da-muted hover:bg-da-hover disabled:opacity-50">Cancel</button>
                      </div>
                      {linkSaveResult && <p className={`text-xs font-semibold ${linkSaveResult.startsWith("Error") ? "text-red-300" : "text-green-300"}`}>{linkSaveResult}</p>}
                    </div>
                  )}

                  {!partsCollapsed && (<>
                  <div className="space-y-3">
                    {question.question_parts.map((part, partIdx) => (
                      <QuestionPartRow key={part.id} part={part} partIdx={partIdx} question={question} commandTerms={commandTerms}
                        onUpdateCommandTerm={onUpdateCommandTerm} onAddCustomTerm={onAddCustomTerm}
                        availableSubtopics={availableSubtopics} onUpdateSubtopics={onUpdateSubtopics}
                        editingPartId={editingPartId} editingField={editingField} editDraft={editDraft}
                        savingField={savingField} confirmDeletePartId={confirmDeletePartId} deletingPartId={deletingPartId}
                        dragOverCode={dragOverCode} setEditingPartId={setEditingPartId} setEditingField={setEditingField}
                        setEditDraft={setEditDraft} savePartField={savePartField} setConfirmDeletePartId={setConfirmDeletePartId}
                        setDeletingPartId={setDeletingPartId} setDragOverCode={setDragOverCode}
                        primaryWarningDialog={primaryWarningDialog} setPrimaryWarningDialog={setPrimaryWarningDialog}
                        onRefresh={onRefresh} />
                    ))}
                  </div>

                  {addingPart ? (
                    <div className="rounded-lg border border-emerald-400/40 bg-emerald-500/15 p-3 space-y-2">
                      <p className="text-xs font-bold text-emerald-300">Add New Part</p>
                      <div className="flex gap-2 flex-wrap items-end">
                        <div>
                          <label className="block text-[11px] font-semibold text-emerald-300 mb-0.5">Part label</label>
                          <input type="text" value={newPartLabel} onChange={(e) => setNewPartLabel(e.target.value)} placeholder="e.g. a, b, i"
                            className="rounded border border-emerald-400/40 px-2 py-1 text-xs w-20 focus:outline-none focus:ring-1 focus:ring-emerald-400" />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-emerald-300 mb-0.5">Marks</label>
                          <input type="number" min={0} max={99} value={newPartMarks} onChange={(e) => setNewPartMarks(e.target.value)}
                            className="rounded border border-emerald-400/40 px-2 py-1 text-xs w-16 focus:outline-none focus:ring-1 focus:ring-emerald-400" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-emerald-300 mb-0.5">LaTeX (optional)</label>
                        <textarea value={newPartLatex} onChange={(e) => setNewPartLatex(e.target.value)} placeholder="Question text in LaTeX…" rows={2}
                          className="rounded border border-emerald-400/40 px-2 py-1 text-xs w-full max-w-xl font-mono resize-none focus:outline-none focus:ring-1 focus:ring-emerald-400" />
                      </div>
                      {newPartError && <p className="text-xs text-red-300">{newPartError}</p>}
                      <div className="flex gap-2">
                        <button type="button" disabled={savingNewPart}
                          onClick={async () => {
                            const marks = parseInt(newPartMarks);
                            if (isNaN(marks) || marks < 0) { setNewPartError("Marks must be a non-negative number"); return; }
                            setSavingNewPart(true); setNewPartError(null);
                            try {
                              const res = await fetch("/api/questions/add-part", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ questionId: question.id, partLabel: newPartLabel.trim() || null, marks, latex: newPartLatex.trim() || null }) });
                              const data = await res.json();
                              if (data.error) { setNewPartError(data.error); return; }
                              setAddingPart(false); setNewPartLabel(""); setNewPartMarks("1"); setNewPartLatex(""); onRefresh();
                            } finally { setSavingNewPart(false); }
                          }}
                          className="rounded bg-emerald-600 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                          {savingNewPart ? "Saving…" : "Add Part"}
                        </button>
                        <button type="button" onClick={() => { setAddingPart(false); setNewPartError(null); }}
                          className="rounded border border-da-border px-3 py-1 text-xs font-bold text-da-muted hover:bg-da-hover">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setAddingPart(true)}
                      className="rounded-lg border-2 border-dashed border-emerald-400/40 bg-da-surface px-4 py-2 text-xs font-bold text-emerald-300 hover:bg-emerald-500/15 w-full">
                      + Add Part
                    </button>
                  )}
                  </>)}

                  {/* ImageSection owns the paired image+LaTeX layout */}
                  <ImageSection
                    question={question} questionImages={questionImages} msImages={msImages}
                    questionLatex={questionLatex} msLatex={msLatex}
                    extracting={extracting} driveConnected={driveConnected} onExtractImages={onExtractImages}
                    hasTroubleshooting={hasTroubleshooting} troubleshootingCopied={troubleshootingCopied}
                    onCopyTroubleshooting={onCopyTroubleshooting} deletingImageIds={deletingImageIds}
                    uploadingImage={uploadingImage} onDeleteImage={onDeleteImage} onDeleteAllImages={onDeleteAllImages}
                    onReorderImages={onReorderImages} onUploadImage={onUploadImage}
                    convertingLatex={convertingLatex} convertLatexError={convertLatexError}
                    onConvertLatex={convertImagesToLatex}
                    partsCollapsed={partsCollapsed} onToggleParts={() => setPartsCollapsed((v) => !v)}
                    onSaveLatex={saveImageLatex} />
                </div>
              )}
            </div>
          </td>
        </tr>
      )}

      {primaryWarningDialog && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-da-surface rounded-xl shadow-2xl p-5 w-80 flex flex-col gap-3">
            <h3 className="text-sm font-bold text-da-text">Remove primary subtopic?</h3>
            <p className="text-sm text-da-muted">
              {primaryWarningDialog.plural
                ? `The subtopic${primaryWarningDialog.labels ? "s " + primaryWarningDialog.labels : ""} you're removing include the primary subtopic for this part. The primary will be cleared.`
                : `You're removing the primary subtopic${primaryWarningDialog.labels ? " (" + primaryWarningDialog.labels + ")" : ""} for this part. The primary will be cleared.`}
            </p>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setPrimaryWarningDialog(null)} className="rounded px-3 py-1.5 text-sm font-semibold border border-da-border text-da-text hover:bg-da-hover">Cancel</button>
              <button type="button" onClick={() => { setPrimaryWarningDialog(null); }} className="rounded px-3 py-1.5 text-sm font-semibold bg-red-600 text-white hover:bg-red-700">Remove anyway</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// -- QuestionPartRow ---------------------------------------------------------

function QuestionPartRow({
  part, partIdx, question, commandTerms, onUpdateCommandTerm, onAddCustomTerm,
  availableSubtopics, onUpdateSubtopics, editingPartId, editingField, editDraft, savingField,
  confirmDeletePartId, deletingPartId, dragOverCode, setEditingPartId, setEditingField, setEditDraft,
  savePartField, setConfirmDeletePartId, setDeletingPartId, setDragOverCode,
  primaryWarningDialog, setPrimaryWarningDialog, onRefresh,
}: {
  part: QuestionPart; partIdx: number; question: Question; commandTerms: string[];
  onUpdateCommandTerm: (partId: string, commandTerm: string | null) => void;
  onAddCustomTerm: (term: string) => void; availableSubtopics: Subtopic[];
  onUpdateSubtopics: (partId: string, codes: string[], primaryCode?: string | null) => void;
  editingPartId: string | null; editingField: "marks" | "label" | null;
  editDraft: string; savingField: boolean; confirmDeletePartId: string | null;
  deletingPartId: string | null; dragOverCode: string | null;
  setEditingPartId: (id: string | null) => void;
  setEditingField: (f: "marks" | "label" | null) => void;
  setEditDraft: (v: string) => void;
  savePartField: (partId: string, field: "marks" | "label", value: string) => Promise<void>;
  setConfirmDeletePartId: (id: string | null) => void; setDeletingPartId: (id: string | null) => void;
  setDragOverCode: (code: string | null) => void;
  primaryWarningDialog: { labels: string; plural: boolean } | null;
  setPrimaryWarningDialog: (v: { labels: string; plural: boolean } | null) => void;
  onRefresh: () => void;
}) {
  const [showTermDropdown, setShowTermDropdown] = useState(false);
  const [newTerm, setNewTerm] = useState("");
  const [showSubtopicDropdown, setShowSubtopicDropdown] = useState(false);
  const [subtopicSearch, setSubtopicSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const subtopicDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setShowTermDropdown(false);
      if (subtopicDropdownRef.current && !subtopicDropdownRef.current.contains(e.target as Node)) setShowSubtopicDropdown(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const currentCodes = part.subtopic_codes ?? [];
  const SECTION_NAMES: Record<number, string> = { 1: "Number & Algebra", 2: "Functions", 3: "Geometry & Trigonometry", 4: "Statistics & Probability", 5: "Calculus" };
  const subtopicsBySection = availableSubtopics.reduce((acc, s) => { if (!acc[s.section]) acc[s.section] = []; acc[s.section].push(s); return acc; }, {} as Record<number, Subtopic[]>);
  const filteredSubtopicsBySection = Object.entries(subtopicsBySection).reduce((acc, [sec, subs]) => {
    const filtered = subs.filter((s) => !currentCodes.includes(s.code) && (subtopicSearch === "" || s.code.toLowerCase().includes(subtopicSearch.toLowerCase()) || s.descriptor.toLowerCase().includes(subtopicSearch.toLowerCase())));
    if (filtered.length > 0) acc[Number(sec)] = filtered;
    return acc;
  }, {} as Record<number, Subtopic[]>);
  const isEditing = editingPartId === part.id;
  const handleRemoveSubtopic = (codeToRemove: string) => {
    const isPrimary = codeToRemove === part.primary_subtopic_code;
    if (isPrimary) { const label = availableSubtopics.find((s) => s.code === codeToRemove)?.code ?? codeToRemove; setPrimaryWarningDialog({ labels: label, plural: false }); return; }
    onUpdateSubtopics(part.id, currentCodes.filter((c) => c !== codeToRemove));
  };

  return (
    <div className={`rounded-lg border bg-da-surface p-3 space-y-2 ${isEditing ? "border-blue-400 shadow-sm" : "border-da-border"}`}>
      <div className="flex items-center gap-2 flex-wrap">
        {isEditing && editingField === "label" ? (
          <div className="flex items-center gap-1">
            <input type="text" value={editDraft} onChange={(e) => setEditDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") savePartField(part.id, "label", editDraft); if (e.key === "Escape") { setEditingPartId(null); setEditingField(null); } }}
              className="w-16 rounded border border-blue-400/40 px-1.5 py-0.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-400" autoFocus />
            <button type="button" onClick={() => savePartField(part.id, "label", editDraft)} disabled={savingField} className="rounded bg-blue-600 px-2 py-0.5 text-xs text-white font-bold disabled:opacity-50">{savingField ? "…" : "✓"}</button>
            <button type="button" onClick={() => { setEditingPartId(null); setEditingField(null); }} className="rounded border border-da-border px-2 py-0.5 text-xs text-da-muted">✕</button>
          </div>
        ) : (
          <button type="button" onClick={() => { setEditingPartId(part.id); setEditingField("label"); setEditDraft(part.part_label ?? ""); }} title="Click to edit part label"
            className="rounded bg-da-hover px-2 py-0.5 text-xs font-mono font-bold text-da-text hover:bg-blue-500/15 hover:text-blue-300">
            {part.part_label ? `(${part.part_label})` : `Part ${partIdx + 1}`}
          </button>
        )}
        {isEditing && editingField === "marks" ? (
          <div className="flex items-center gap-1">
            <input type="number" min={0} max={99} value={editDraft} onChange={(e) => setEditDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") savePartField(part.id, "marks", editDraft); if (e.key === "Escape") { setEditingPartId(null); setEditingField(null); } }}
              className="w-14 rounded border border-blue-400/40 px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-400" autoFocus />
            <button type="button" onClick={() => savePartField(part.id, "marks", editDraft)} disabled={savingField} className="rounded bg-blue-600 px-2 py-0.5 text-xs text-white font-bold disabled:opacity-50">{savingField ? "…" : "✓"}</button>
            <button type="button" onClick={() => { setEditingPartId(null); setEditingField(null); }} className="rounded border border-da-border px-2 py-0.5 text-xs text-da-muted">✕</button>
          </div>
        ) : (
          <button type="button" onClick={() => { setEditingPartId(part.id); setEditingField("marks"); setEditDraft(String(part.marks)); }} title="Click to edit marks"
            className="rounded bg-blue-500/15 px-2 py-0.5 text-xs font-semibold text-blue-300 hover:bg-blue-500/15">
            {part.marks} {part.marks === 1 ? "mark" : "marks"}
          </button>
        )}
        <div className="flex gap-1">
          {(part.mark_types ?? []).map((mt) => (
            <span key={mt} className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${mt === "M" ? "bg-blue-500/15 text-blue-300" : mt === "A" ? "bg-green-500/15 text-green-300" : mt === "R" ? "bg-purple-500/15 text-purple-300" : mt === "AG" ? "bg-da-hover text-da-text" : "bg-da-hover text-da-muted"}`}>{mt}</span>
          ))}
        </div>
        <div className="relative" ref={dropdownRef}>
          <button type="button" onClick={() => setShowTermDropdown((v) => !v)}
            className={`rounded px-2 py-0.5 text-xs font-semibold transition-colors ${part.command_term ? "bg-teal-500/15 text-teal-300 hover:bg-teal-500/25" : "bg-da-hover text-da-muted hover:bg-gray-200"}`}>
            {part.command_term ?? "No term"}
          </button>
          {showTermDropdown && (
            <div className="absolute left-0 top-full mt-1 z-30 bg-da-surface border border-da-border rounded-lg shadow-lg w-52 max-h-64 overflow-y-auto">
              <div className="p-1.5 border-b border-da-border">
                <button type="button" onClick={() => { onUpdateCommandTerm(part.id, null); setShowTermDropdown(false); }} className="w-full text-left px-2 py-1 text-xs text-da-muted hover:bg-da-hover rounded italic">— Remove term</button>
              </div>
              {commandTerms.map((term) => (
                <button key={term} type="button" onClick={() => { onUpdateCommandTerm(part.id, term); setShowTermDropdown(false); }}
                  className={`w-full text-left px-2 py-1 text-xs hover:bg-blue-500/15 rounded ${part.command_term === term ? "font-bold text-blue-300 bg-blue-500/15" : "text-da-text"}`}>{term}</button>
              ))}
              <div className="p-1.5 border-t border-da-border flex gap-1">
                <input type="text" value={newTerm} onChange={(e) => setNewTerm(e.target.value)} placeholder="Custom term…"
                  className="flex-1 rounded border border-da-border px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                  onKeyDown={(e) => { if (e.key === "Enter" && newTerm.trim()) { onAddCustomTerm(newTerm.trim()); onUpdateCommandTerm(part.id, newTerm.trim()); setNewTerm(""); setShowTermDropdown(false); } }} />
                <button type="button" onClick={() => { if (newTerm.trim()) { onAddCustomTerm(newTerm.trim()); onUpdateCommandTerm(part.id, newTerm.trim()); setNewTerm(""); setShowTermDropdown(false); } }}
                  className="rounded bg-blue-600 px-2 text-xs text-white font-bold hover:bg-blue-700">+</button>
              </div>
            </div>
          )}
        </div>
        {confirmDeletePartId === part.id ? (
          <div className="flex items-center gap-1 ml-auto">
            <span className="text-xs text-red-300 font-semibold">Delete this part?</span>
            <button type="button" disabled={deletingPartId === part.id}
              onClick={async () => { setDeletingPartId(part.id); try { await fetch("/api/questions/part-metadata", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ partId: part.id }) }); onRefresh(); } finally { setDeletingPartId(null); setConfirmDeletePartId(null); } }}
              className="rounded bg-red-600 px-2 py-0.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50">{deletingPartId === part.id ? "…" : "Yes"}</button>
            <button type="button" onClick={() => setConfirmDeletePartId(null)} className="rounded border border-da-border px-2 py-0.5 text-xs text-da-muted hover:bg-da-hover">No</button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmDeletePartId(part.id)} className="ml-auto rounded border border-red-400/40 bg-da-surface px-2 py-0.5 text-xs text-red-500 hover:bg-red-500/15">🗑</button>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {currentCodes.map((code) => {
          const sub = availableSubtopics.find((s) => s.code === code);
          const isPrimary = code === part.primary_subtopic_code;
          return (
            <div key={code} draggable
              onDragStart={(e) => { e.dataTransfer.setData("text/plain", code); e.dataTransfer.effectAllowed = "move"; }}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverCode(code); }}
              onDragLeave={() => setDragOverCode(null)}
              onDrop={(e) => {
                e.preventDefault(); setDragOverCode(null);
                const draggedCode = e.dataTransfer.getData("text/plain");
                if (draggedCode === code || !currentCodes.includes(draggedCode)) return;
                const newOrder = [...currentCodes]; const fromIdx = newOrder.indexOf(draggedCode); const toIdx = newOrder.indexOf(code);
                newOrder.splice(fromIdx, 1); newOrder.splice(toIdx, 0, draggedCode);
                onUpdateSubtopics(part.id, newOrder, part.primary_subtopic_code);
              }}
              className={`flex items-center gap-0.5 rounded-full border text-[11px] font-semibold px-2 py-0.5 cursor-grab active:cursor-grabbing transition-colors ${dragOverCode === code ? "border-blue-500 bg-blue-500/15" : isPrimary ? "border-emerald-400 bg-emerald-500/15 text-emerald-300" : "border-blue-400/40 bg-blue-500/15 text-blue-300"}`}>
              {isPrimary && <span className="text-emerald-300 text-[9px] mr-0.5">★</span>}
              <button type="button" title={`Set "${code}" as primary subtopic`} onClick={() => onUpdateSubtopics(part.id, currentCodes, code)} className="hover:text-emerald-300">{code}</button>
              {sub && <span className="text-da-muted hidden sm:inline ml-0.5">— {sub.descriptor.slice(0, 25)}{sub.descriptor.length > 25 ? "…" : ""}</span>}
              <button type="button" onClick={() => handleRemoveSubtopic(code)} className="ml-1 rounded-full hover:bg-red-500/15 hover:text-red-300 text-da-muted w-3.5 h-3.5 flex items-center justify-center text-[10px] font-bold">×</button>
            </div>
          );
        })}
        <div className="relative" ref={subtopicDropdownRef}>
          <button type="button" onClick={() => { setShowSubtopicDropdown((v) => !v); setSubtopicSearch(""); }}
            className="rounded-full border border-dashed border-da-border px-2 py-0.5 text-[11px] text-da-muted hover:border-blue-400 hover:text-blue-300">
            + subtopic
          </button>
          {showSubtopicDropdown && (
            <div className="absolute left-0 top-full mt-1 z-30 bg-da-surface border border-da-border rounded-lg shadow-lg w-72 max-h-64 overflow-y-auto">
              <div className="p-1.5 border-b border-da-border sticky top-0 bg-da-surface">
                <input type="text" value={subtopicSearch} onChange={(e) => setSubtopicSearch(e.target.value)} placeholder="Search subtopics…"
                  className="w-full rounded border border-da-border px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" autoFocus />
              </div>
              {Object.entries(filteredSubtopicsBySection).map(([sec, subs]) => (
                <div key={sec}>
                  <div className="px-2 py-1 text-[10px] font-bold text-da-muted bg-da-hover sticky top-9">{sec}. {SECTION_NAMES[Number(sec)]}</div>
                  {subs.map((sub) => (
                    <button key={sub.code} type="button"
                      onClick={() => { const newCodes = [...currentCodes, sub.code]; onUpdateSubtopics(part.id, newCodes); setShowSubtopicDropdown(false); setSubtopicSearch(""); }}
                      className="w-full text-left px-3 py-1 text-xs hover:bg-blue-500/15 text-da-text">
                      <span className="font-mono font-semibold text-blue-300">{sub.code}</span>
                      <span className="text-da-muted ml-1">— {sub.descriptor}</span>
                    </button>
                  ))}
                </div>
              ))}
              {Object.keys(filteredSubtopicsBySection).length === 0 && (<p className="px-3 py-2 text-xs text-da-muted italic">No subtopics found</p>)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
