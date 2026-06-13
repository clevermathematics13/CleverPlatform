"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import katex from "katex";
import "katex/dist/katex.min.css";
import LatexRenderer from "@/components/LatexRenderer";
import type {
  Question,
  QuestionPart,
  QuestionImage,
  Subtopic,
} from "./types";

// ── Helpers ──────────────────────────────────────────────────────────────────

const HINT_TOOLTIP = `LaTeX math: $x^2$, $\\frac{a}{b}$, $\\sqrt{x}$
Text: plain words work directly
Use ^ for powers: x^2, e^(-x), (x+1)^3
Colors: any CSS hex or named colour`.trim();

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
  /** A saved exam (for the current course) that already contains this question. */
  savedExamWithQuestion: import("./types").SavedExam | null;
  onOpenSavedExam: (exam: import("./types").SavedExam) => void;
  /** Open this question as a full-editor modal overlay. */
  onOpenEditor?: () => void;
  /** When rendered inside a modal that already shows header info, suppress the collapsed table row. */
  hideCollapsedRow?: boolean;
  savingSection: boolean;
  onUpdateSection: (section: "A" | "B") => void;
  onRefresh: () => void;
  onQueueMarksChange: (questionId: string, marks: number) => void;
}) {
  const showSection = question.paper !== 3;
  const hasDocLinkConflict = question.google_ms_id !== null && question.google_doc_id === question.google_ms_id;
  const [showSectionPrompt, setShowSectionPrompt] = useState(false);
  const [primaryWarningDialog, setPrimaryWarningDialog] = useState<{ labels: string; plural: boolean } | null>(null);
  const [minimized, setMinimized] = useState(false);
  const expandedRef = useRef(expanded);
  useEffect(() => { expandedRef.current = expanded; }, [expanded]);

  // ── Part editing state ───────────────────────────────────────────────────
  const [editingPartId, setEditingPartId] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<"marks" | "label" | "latex" | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [savingField, setSavingField] = useState(false);

  // ── New part state ───────────────────────────────────────────────────────
  const [addingPart, setAddingPart] = useState(false);
  const [newPartLabel, setNewPartLabel] = useState("");
  const [newPartMarks, setNewPartMarks] = useState("1");
  const [newPartLatex, setNewPartLatex] = useState("");
  const [savingNewPart, setSavingNewPart] = useState(false);
  const [newPartError, setNewPartError] = useState<string | null>(null);

  // ── Delete part state ────────────────────────────────────────────────────
  const [deletingPartId, setDeletingPartId] = useState<string | null>(null);
  const [confirmDeletePartId, setConfirmDeletePartId] = useState<string | null>(null);

  // ── Marks override for queue ─────────────────────────────────────────────
  const [editingQueueMarks, setEditingQueueMarks] = useState(false);
  const [queueMarksDraft, setQueueMarksDraft] = useState("");

  // ── Google Doc link editing ──────────────────────────────────────────────
  const [editingLinks, setEditingLinks] = useState(false);
  const [linkDraftQ, setLinkDraftQ] = useState(question.google_doc_id ?? "");
  const [linkDraftMS, setLinkDraftMS] = useState(question.google_ms_id ?? "");
  const [savingLinks, setSavingLinks] = useState(false);
  const [linkSaveResult, setLinkSaveResult] = useState<string | null>(null);

  // ── Subtopic drag-reorder ────────────────────────────────────────────────
  const [dragOverCode, setDragOverCode] = useState<string | null>(null);

  // ── Note / comment state ─────────────────────────────────────────────────
  const [showNotePanel, setShowNotePanel] = useState(false);
  const [noteDraft, setNoteDraft] = useState(question.note ?? "");
  const [savingNote, setSavingNote] = useState(false);
  const [deletingQuestion, setDeletingQuestion] = useState(false);

  const savePartField = async (partId: string, field: "marks" | "label" | "latex", value: string) => {
    setSavingField(true);
    try {
      const body: Record<string, string | number> = { partId };
      if (field === "marks") body.marks = parseInt(value) || 0;
      else if (field === "label") body.partLabel = value.trim();
      else if (field === "latex") body.latex = value.trim();
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
        const match = input.match(/\/d\/(([\w-]+)/);
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

  const renderLatexPreview = (latex: string): string => {
    if (!latex) return "";
    try { return katex.renderToString(latex, { throwOnError: false, displayMode: false }); }
    catch { return latex; }
  };

  const questionImages = images.filter((i) => i.image_type === "question").sort((a, b) => a.sort_order - b.sort_order);
  const msImages = images.filter((i) => i.image_type === "markscheme").sort((a, b) => a.sort_order - b.sort_order);

  return (
    <>
      {/* ── Collapsed row — hidden when rendered inside a modal that already has its own header ── */}
      {!hideCollapsedRow && <tr
        className={`cursor-pointer hover:bg-blue-50 transition-colors ${expanded ? "bg-blue-50" : ""}`}
        onClick={() => { if (expanded) onClose(); else onOpen(); }}
      >
        <td className="px-4 py-2">
          <div className="flex items-center gap-1.5">
            {hasDocLinkConflict && (
              <span className="inline-flex items-center rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700" title="Question doc and markscheme doc are the same file — links need to be fixed">⚠ conflict</span>
            )}
            {onOpenEditor ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onOpenEditor(); }}
                title="Open full editor"
                className={`font-mono text-sm font-semibold hover:underline hover:text-indigo-700 transition-colors ${expanded ? "text-blue-700" : "text-blue-900"}`}
              >
                {question.code}
              </button>
            ) : (
              <span className={`font-mono text-sm font-semibold ${expanded ? "text-blue-700" : "text-blue-900"}`}>{question.code}</span>
            )}
          </div>
        </td>
        <td className="px-4 py-2 text-center text-sm text-gray-700">{question.session}</td>
        <td className="px-4 py-2 text-center text-sm text-gray-700">P{question.paper}</td>
        <td className="px-4 py-2 text-center">
          <span className={`px-2.5 py-0.5 rounded-full font-semibold text-xs ${question.level === "AHL" ? "bg-purple-100 text-purple-800" : "bg-green-100 text-green-800"}`}>
            {question.level === "AHL" ? "HL" : "SL"}
          </span>
        </td>
        <td className="px-4 py-2 text-center text-sm text-gray-700">{question.timezone ?? "—"}</td>
        <td className="px-4 py-2 text-center text-sm text-gray-700">{question.question_parts.length}</td>
        <td className="px-4 py-2 text-center text-sm font-semibold text-gray-800">
          {inQueue && editingQueueMarks ? (
            <input
              type="number"
              min={0}
              max={99}
              value={queueMarksDraft}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setQueueMarksDraft(e.target.value)}
              onBlur={() => {
                const v = parseInt(queueMarksDraft);
                if (!isNaN(v) && v >= 0) onQueueMarksChange(question.id, v);
                setEditingQueueMarks(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { const v = parseInt(queueMarksDraft); if (!isNaN(v) && v >= 0) onQueueMarksChange(question.id, v); setEditingQueueMarks(false); }
                if (e.key === "Escape") setEditingQueueMarks(false);
                e.stopPropagation();
              }}
              className="w-12 rounded border border-blue-300 px-1 py-0.5 text-center text-sm font-semibold"
              autoFocus
            />
          ) : (
            <span
              onClick={(e) => { if (inQueue) { e.stopPropagation(); setQueueMarksDraft(String(totalMarks)); setEditingQueueMarks(true); } }}
              title={inQueue ? "Click to override marks for this exam" : undefined}
              className={inQueue ? "cursor-pointer hover:text-blue-600 underline decoration-dotted" : ""}
            >
              {totalMarks}
            </span>
          )}
        </td>
        <td className="px-4 py-2 text-center">
          <div className="flex items-center justify-center gap-1.5">
            <span className={`text-xs font-semibold ${question.has_question_images ? "text-emerald-600" : "text-gray-300"}`} title={question.has_question_images ? "Question images extracted" : "No question images"}>
              📄 Q
            </span>
            <span className={`text-xs font-semibold ${question.has_markscheme_images ? "text-emerald-600" : "text-gray-300"}`} title={question.has_markscheme_images ? "Markscheme images extracted" : "No markscheme images"}>
              📝 MS
            </span>
          </div>
        </td>
        <td className="px-4 py-2 text-center" onClick={(e) => e.stopPropagation()}>
          {showSection ? (
            <div className="flex items-center justify-center gap-1">
              <button
                type="button"
                onClick={() => { onUpdateSection("A"); setShowSectionPrompt(false); }}
                disabled={savingSection}
                className={`rounded px-2 py-0.5 text-xs font-bold transition-colors ${question.section === "A" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-blue-100"}`}
              >
                A
              </button>
              <button
                type="button"
                onClick={() => { onUpdateSection("B"); setShowSectionPrompt(false); }}
                disabled={savingSection}
                className={`rounded px-2 py-0.5 text-xs font-bold transition-colors ${question.section === "B" ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-indigo-100"}`}
              >
                B
              </button>
            </div>
          ) : (
            <span className="text-xs text-gray-400">—</span>
          )}
        </td>
        {/* Add to test button — 3 states */}
        {testBuilderOpen && (
          <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
            {question.has_question_images ? (
              inQueue ? (
                /* State 1: already in the active live queue */
                <button
                  type="button"
                  disabled
                  title="Already in current exam"
                  className="rounded-full w-7 h-7 text-sm font-bold transition-colors bg-indigo-100 text-indigo-400 cursor-default"
                >
                  ✓
                </button>
              ) : savedExamWithQuestion ? (
                /* State 2: in a saved exam for the selected course — click to open that exam */
                <button
                  type="button"
                  onClick={() => onOpenSavedExam(savedExamWithQuestion)}
                  title={`Already in "${savedExamWithQuestion.name}" — click to open`}
                  className="rounded-full w-7 h-7 text-sm font-bold transition-colors bg-green-100 text-green-700 hover:bg-green-200 border border-green-300"
                >
                  ✓
                </button>
              ) : (
                /* State 3: not in any exam — add it */
                <button
                  type="button"
                  onClick={onAddToQueue}
                  title="Add to exam"
                  className="rounded-full w-7 h-7 text-sm font-bold transition-colors bg-indigo-600 text-white hover:bg-indigo-700"
                >
                  +
                </button>
              )
            ) : (
              <span className="text-xs text-gray-300" title="No images extracted">—</span>
            )}
          </td>
        )}
        {/* Comment / notes button */}
        <td className="px-2 py-2 text-center" onClick={(e) => e.stopPropagation()}>
          <div className="relative inline-block">
            <button
              type="button"
              title={question.note ? `Note: ${question.note}` : "Add note"}
              onClick={() => { setNoteDraft(question.note ?? ""); setShowNotePanel((v) => !v); }}
              className={`rounded-full w-6 h-6 text-xs transition-colors ${question.note ? "bg-amber-100 text-amber-700 hover:bg-amber-200" : "bg-gray-100 text-gray-400 hover:bg-gray-200"}`}
            >
              {question.note ? "💬" : "○"}
            </button>
            {showNotePanel && createPortal(
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowNotePanel(false)}>
                <div className="bg-white rounded-xl shadow-2xl p-4 w-80 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
                  <h3 className="text-sm font-bold text-gray-800">Note for {question.code}</h3>
                  <textarea
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    placeholder="Add a note about this question..."
                    className="rounded border border-gray-300 px-2 py-1.5 text-sm resize-none h-24 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                  <div className="flex gap-2 justify-end">
                    <button type="button" onClick={() => setShowNotePanel(false)} className="rounded px-3 py-1 text-xs font-semibold border border-gray-300 text-gray-600 hover:bg-gray-100">Cancel</button>
                    <button type="button" onClick={saveNote} disabled={savingNote} className="rounded px-3 py-1 text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">{savingNote ? "Saving…" : "Save"}</button>
                  </div>
                  {question.note && (
                    <button type="button" onClick={() => { setNoteDraft(""); }} className="text-xs text-red-500 hover:underline text-left">Clear note</button>
                  )}
                </div>
              </div>,
              document.body
            )}
          </div>
        </td>
      </tr>}

      {/* ── Expanded detail row ── */}
      {expanded && (
        <tr>
          <td colSpan={hideCollapsedRow ? 1 : testBuilderOpen ? 11 : 10} className="px-0 py-0 bg-blue-50">
            <div className="border-t border-blue-200 px-4 py-3 space-y-4">

              {/* Toolbar */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setMinimized((v) => !v)}
                  className="rounded border border-blue-300 bg-white px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                >
                  {minimized ? "▼ Expand" : "▲ Minimise"}
                </button>
                {!hideCollapsedRow && (
                  <button type="button" onClick={onClose} className="rounded border border-blue-300 bg-white px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50">
                    ✕ Close
                  </button>
                )}
                {!editingLinks && (
                  <button
                    type="button"
                    onClick={() => { setLinkDraftQ(question.google_doc_id ?? ""); setLinkDraftMS(question.google_ms_id ?? ""); setEditingLinks(true); }}
                    className={`rounded border px-2.5 py-1 text-xs font-semibold ${hasDocLinkConflict ? "border-red-400 bg-red-50 text-red-700 hover:bg-red-100" : "border-blue-300 bg-white text-blue-700 hover:bg-blue-50"}`}
                  >
                    {hasDocLinkConflict ? "⚠ Fix Links" : "🔗 Edit Doc Links"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={deleteQuestion}
                  disabled={deletingQuestion}
                  className="rounded border border-red-300 bg-white px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  {deletingQuestion ? "Deleting…" : "🗑 Delete"}
                </button>
              </div>

              {!minimized && (
                <>
                  {/* Doc link editor */}
                  {editingLinks && (
                    <div className="rounded-lg border border-blue-200 bg-white p-3 space-y-2">
                      <p className="text-xs font-bold text-blue-800">Edit Google Doc Links</p>
                      {hasDocLinkConflict && (
                        <p className="text-xs font-semibold text-red-700 bg-red-50 rounded px-2 py-1">⚠ Q doc and MS doc are the same file — this will cause extraction errors. Clear one of them.</p>
                      )}
                      <label className="flex flex-col gap-0.5">
                        <span className="text-[11px] font-semibold text-blue-700">📄 Question Doc URL or ID</span>
                        <input
                          type="text"
                          value={linkDraftQ}
                          onChange={(e) => setLinkDraftQ(e.target.value)}
                          placeholder="https://docs.google.com/document/d/… or doc ID"
                          className="rounded border border-blue-300 px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-400 w-full max-w-xl"
                        />
                      </label>
                      <label className="flex flex-col gap-0.5">
                        <span className="text-[11px] font-semibold text-green-700">📝 Markscheme Doc URL or ID</span>
                        <input
                          type="text"
                          value={linkDraftMS}
                          onChange={(e) => setLinkDraftMS(e.target.value)}
                          placeholder="https://docs.google.com/document/d/… or doc ID (leave blank to unlink)"
                          className="rounded border border-green-300 px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-green-400 w-full max-w-xl"
                        />
                      </label>
                      <div className="flex gap-2">
                        <button type="button" onClick={saveLinks} disabled={savingLinks} className="rounded bg-blue-600 px-3 py-1 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50">{savingLinks ? "Saving…" : "Save Links"}</button>
                        <button type="button" onClick={() => { setEditingLinks(false); setLinkDraftQ(question.google_doc_id ?? ""); setLinkDraftMS(question.google_ms_id ?? ""); }} disabled={savingLinks} className="rounded border border-gray-300 px-3 py-1 text-xs font-bold text-gray-600 hover:bg-gray-100 disabled:opacity-50">Cancel</button>
                      </div>
                      {linkSaveResult && <p className={`text-xs font-semibold ${linkSaveResult.startsWith("Error") ? "text-red-600" : "text-green-700"}`}>{linkSaveResult}</p>}
                    </div>
                  )}

                  {/* Question parts */}
                  <div className="space-y-3">
                    {question.question_parts.map((part, partIdx) => (
                      <QuestionPartRow
                        key={part.id}
                        part={part}
                        partIdx={partIdx}
                        question={question}
                        commandTerms={commandTerms}
                        onUpdateCommandTerm={onUpdateCommandTerm}
                        onAddCustomTerm={onAddCustomTerm}
                        availableSubtopics={availableSubtopics}
                        onUpdateSubtopics={onUpdateSubtopics}
                        editingPartId={editingPartId}
                        editingField={editingField}
                        editDraft={editDraft}
                        savingField={savingField}
                        confirmDeletePartId={confirmDeletePartId}
                        deletingPartId={deletingPartId}
                        dragOverCode={dragOverCode}
                        setEditingPartId={setEditingPartId}
                        setEditingField={setEditingField}
                        setEditDraft={setEditDraft}
                        savePartField={savePartField}
                        setConfirmDeletePartId={setConfirmDeletePartId}
                        setDeletingPartId={setDeletingPartId}
                        setDragOverCode={setDragOverCode}
                        primaryWarningDialog={primaryWarningDialog}
                        setPrimaryWarningDialog={setPrimaryWarningDialog}
                        onRefresh={onRefresh}
                        renderLatexPreview={renderLatexPreview}
                      />
                    ))}
                  </div>

                  {/* Add part form */}
                  {addingPart ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 space-y-2">
                      <p className="text-xs font-bold text-emerald-800">Add New Part</p>
                      <div className="flex gap-2 flex-wrap items-end">
                        <div>
                          <label className="block text-[11px] font-semibold text-emerald-700 mb-0.5">Part label</label>
                          <input type="text" value={newPartLabel} onChange={(e) => setNewPartLabel(e.target.value)} placeholder="e.g. a, b, i" className="rounded border border-emerald-300 px-2 py-1 text-xs w-20 focus:outline-none focus:ring-1 focus:ring-emerald-400" />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-emerald-700 mb-0.5">Marks</label>
                          <input type="number" min={0} max={99} value={newPartMarks} onChange={(e) => setNewPartMarks(e.target.value)} className="rounded border border-emerald-300 px-2 py-1 text-xs w-16 focus:outline-none focus:ring-1 focus:ring-emerald-400" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-emerald-700 mb-0.5">LaTeX (optional)</label>
                        <textarea value={newPartLatex} onChange={(e) => setNewPartLatex(e.target.value)} placeholder="Question text in LaTeX…" rows={2} className="rounded border border-emerald-300 px-2 py-1 text-xs w-full max-w-xl font-mono resize-none focus:outline-none focus:ring-1 focus:ring-emerald-400" />
                      </div>
                      {newPartError && <p className="text-xs text-red-600">{newPartError}</p>}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={savingNewPart}
                          onClick={async () => {
                            const marks = parseInt(newPartMarks);
                            if (isNaN(marks) || marks < 0) { setNewPartError("Marks must be a non-negative number"); return; }
                            setSavingNewPart(true); setNewPartError(null);
                            try {
                              const res = await fetch("/api/questions/add-part", {
                                method: "POST", headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ questionId: question.id, partLabel: newPartLabel.trim() || null, marks, latex: newPartLatex.trim() || null }),
                              });
                              const data = await res.json();
                              if (data.error) { setNewPartError(data.error); return; }
                              setAddingPart(false); setNewPartLabel(""); setNewPartMarks("1"); setNewPartLatex("");
                              onRefresh();
                            } finally { setSavingNewPart(false); }
                          }}
                          className="rounded bg-emerald-600 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          {savingNewPart ? "Saving…" : "Add Part"}
                        </button>
                        <button type="button" onClick={() => { setAddingPart(false); setNewPartError(null); }} className="rounded border border-gray-300 px-3 py-1 text-xs font-bold text-gray-600 hover:bg-gray-100">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setAddingPart(true)}
                      className="rounded-lg border-2 border-dashed border-emerald-300 bg-white px-4 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50 w-full"
                    >
                      + Add Part
                    </button>
                  )}

                  {/* Images section */}
                  <ImageSection
                    question={question}
                    questionImages={questionImages}
                    msImages={msImages}
                    extracting={extracting}
                    driveConnected={driveConnected}
                    onExtractImages={onExtractImages}
                    hasTroubleshooting={hasTroubleshooting}
                    troubleshootingCopied={troubleshootingCopied}
                    onCopyTroubleshooting={onCopyTroubleshooting}
                    deletingImageIds={deletingImageIds}
                    uploadingImage={uploadingImage}
                    onDeleteImage={onDeleteImage}
                    onDeleteAllImages={onDeleteAllImages}
                    onReorderImages={onReorderImages}
                    onUploadImage={onUploadImage}
                  />
                </>
              )}
            </div>
          </td>
        </tr>
      )}

      {/* Primary subtopic warning dialog */}
      {primaryWarningDialog && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-xl shadow-2xl p-5 w-80 flex flex-col gap-3">
            <h3 className="text-sm font-bold text-gray-800">Remove primary subtopic?</h3>
            <p className="text-sm text-gray-600">
              {primaryWarningDialog.plural
                ? `The subtopic${primaryWarningDialog.labels ? "s " + primaryWarningDialog.labels : ""} you're removing include the primary subtopic for this part. The primary will be cleared.`
                : `You're removing the primary subtopic${primaryWarningDialog.labels ? " (" + primaryWarningDialog.labels + ")" : ""} for this part. The primary will be cleared.`}
            </p>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setPrimaryWarningDialog(null)} className="rounded px-3 py-1.5 text-sm font-semibold border border-gray-300 text-gray-700 hover:bg-gray-100">Cancel</button>
              <button
                type="button"
                onClick={() => {
                  setPrimaryWarningDialog(null);
                }}
                className="rounded px-3 py-1.5 text-sm font-semibold bg-red-600 text-white hover:bg-red-700"
              >
                Remove anyway
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// ── QuestionPartRow sub-component ─────────────────────────────────────────────

function QuestionPartRow({
  part,
  partIdx,
  question,
  commandTerms,
  onUpdateCommandTerm,
  onAddCustomTerm,
  availableSubtopics,
  onUpdateSubtopics,
  editingPartId,
  editingField,
  editDraft,
  savingField,
  confirmDeletePartId,
  deletingPartId,
  dragOverCode,
  setEditingPartId,
  setEditingField,
  setEditDraft,
  savePartField,
  setConfirmDeletePartId,
  setDeletingPartId,
  setDragOverCode,
  primaryWarningDialog,
  setPrimaryWarningDialog,
  onRefresh,
  renderLatexPreview,
}: {
  part: QuestionPart;
  partIdx: number;
  question: Question;
  commandTerms: string[];
  onUpdateCommandTerm: (partId: string, commandTerm: string | null) => void;
  onAddCustomTerm: (term: string) => void;
  availableSubtopics: Subtopic[];
  onUpdateSubtopics: (partId: string, codes: string[], primaryCode?: string | null) => void;
  editingPartId: string | null;
  editingField: "marks" | "label" | "latex" | null;
  editDraft: string;
  savingField: boolean;
  confirmDeletePartId: string | null;
  deletingPartId: string | null;
  dragOverCode: string | null;
  setEditingPartId: (id: string | null) => void;
  setEditingField: (f: "marks" | "label" | "latex" | null) => void;
  setEditDraft: (v: string) => void;
  savePartField: (partId: string, field: "marks" | "label" | "latex", value: string) => Promise<void>;
  setConfirmDeletePartId: (id: string | null) => void;
  setDeletingPartId: (id: string | null) => void;
  setDragOverCode: (code: string | null) => void;
  primaryWarningDialog: { labels: string; plural: boolean } | null;
  setPrimaryWarningDialog: (v: { labels: string; plural: boolean } | null) => void;
  onRefresh: () => void;
  renderLatexPreview: (latex: string) => string;
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

  const SECTION_NAMES: Record<number, string> = {
    1: "Number & Algebra", 2: "Functions", 3: "Geometry & Trigonometry",
    4: "Statistics & Probability", 5: "Calculus",
  };

  const subtopicsBySection = availableSubtopics.reduce((acc, s) => {
    if (!acc[s.section]) acc[s.section] = [];
    acc[s.section].push(s);
    return acc;
  }, {} as Record<number, Subtopic[]>);

  const filteredSubtopicsBySection = Object.entries(subtopicsBySection).reduce((acc, [sec, subs]) => {
    const filtered = subs.filter(
      (s) => !currentCodes.includes(s.code) && (
        subtopicSearch === "" || s.code.toLowerCase().includes(subtopicSearch.toLowerCase()) || s.descriptor.toLowerCase().includes(subtopicSearch.toLowerCase())
      )
    );
    if (filtered.length > 0) acc[Number(sec)] = filtered;
    return acc;
  }, {} as Record<number, Subtopic[]>);

  const isEditing = editingPartId === part.id;

  const handleRemoveSubtopic = (codeToRemove: string) => {
    const isPrimary = codeToRemove === part.primary_subtopic_code;
    if (isPrimary) {
      const label = availableSubtopics.find((s) => s.code === codeToRemove)?.code ?? codeToRemove;
      setPrimaryWarningDialog({ labels: label, plural: false });
      return;
    }
    onUpdateSubtopics(part.id, currentCodes.filter((c) => c !== codeToRemove));
  };

  return (
    <div className={`rounded-lg border bg-white p-3 space-y-2 ${isEditing ? "border-blue-400 shadow-sm" : "border-gray-200"}`}>
      {/* Part header */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Part label */}
        {isEditing && editingField === "label" ? (
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") savePartField(part.id, "label", editDraft); if (e.key === "Escape") { setEditingPartId(null); setEditingField(null); } }}
              className="w-16 rounded border border-blue-300 px-1.5 py-0.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-400"
              autoFocus
            />
            <button type="button" onClick={() => savePartField(part.id, "label", editDraft)} disabled={savingField} className="rounded bg-blue-600 px-2 py-0.5 text-xs text-white font-bold disabled:opacity-50">{savingField ? "…" : "✓"}</button>
            <button type="button" onClick={() => { setEditingPartId(null); setEditingField(null); }} className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600">✕</button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => { setEditingPartId(part.id); setEditingField("label"); setEditDraft(part.part_label ?? ""); }}
            title="Click to edit part label"
            className="rounded bg-gray-100 px-2 py-0.5 text-xs font-mono font-bold text-gray-700 hover:bg-blue-100 hover:text-blue-700"
          >
            {part.part_label ? `(${part.part_label})` : `Part ${partIdx + 1}`}
          </button>
        )}

        {/* Marks */}
        {isEditing && editingField === "marks" ? (
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={0}
              max={99}
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") savePartField(part.id, "marks", editDraft); if (e.key === "Escape") { setEditingPartId(null); setEditingField(null); } }}
              className="w-14 rounded border border-blue-300 px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-400"
              autoFocus
            />
            <button type="button" onClick={() => savePartField(part.id, "marks", editDraft)} disabled={savingField} className="rounded bg-blue-600 px-2 py-0.5 text-xs text-white font-bold disabled:opacity-50">{savingField ? "…" : "✓"}</button>
            <button type="button" onClick={() => { setEditingPartId(null); setEditingField(null); }} className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600">✕</button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => { setEditingPartId(part.id); setEditingField("marks"); setEditDraft(String(part.marks)); }}
            title="Click to edit marks"
            className="rounded bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-800 hover:bg-blue-100"
          >
            {part.marks} {part.marks === 1 ? "mark" : "marks"}
          </button>
        )}

        {/* Mark type badges */}
        <div className="flex gap-1">
          {(part.mark_types ?? []).map((mt) => (
            <span key={mt} className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
              mt === "M" ? "bg-blue-100 text-blue-800" :
              mt === "A" ? "bg-green-100 text-green-800" :
              mt === "R" ? "bg-purple-100 text-purple-800" :
              mt === "AG" ? "bg-gray-100 text-gray-700" :
              "bg-gray-100 text-gray-600"
            }`}>{mt}</span>
          ))}
        </div>

        {/* Command term */}
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setShowTermDropdown((v) => !v)}
            className={`rounded px-2 py-0.5 text-xs font-semibold transition-colors ${
              part.command_term
                ? "bg-teal-100 text-teal-800 hover:bg-teal-200"
                : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            {part.command_term ?? "No term"}
          </button>
          {showTermDropdown && (
            <div className="absolute left-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-lg shadow-lg w-52 max-h-64 overflow-y-auto">
              <div className="p-1.5 border-b border-gray-100">
                <button
                  type="button"
                  onClick={() => { onUpdateCommandTerm(part.id, null); setShowTermDropdown(false); }}
                  className="w-full text-left px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 rounded italic"
                >
                  — Remove term
                </button>
              </div>
              {commandTerms.map((term) => (
                <button
                  key={term}
                  type="button"
                  onClick={() => { onUpdateCommandTerm(part.id, term); setShowTermDropdown(false); }}
                  className={`w-full text-left px-2 py-1 text-xs hover:bg-blue-50 rounded ${part.command_term === term ? "font-bold text-blue-700 bg-blue-50" : "text-gray-700"}`}
                >
                  {term}
                </button>
              ))}
              <div className="p-1.5 border-t border-gray-100 flex gap-1">
                <input
                  type="text"
                  value={newTerm}
                  onChange={(e) => setNewTerm(e.target.value)}
                  placeholder="Custom term…"
                  className="flex-1 rounded border border-gray-300 px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                  onKeyDown={(e) => { if (e.key === "Enter" && newTerm.trim()) { onAddCustomTerm(newTerm.trim()); onUpdateCommandTerm(part.id, newTerm.trim()); setNewTerm(""); setShowTermDropdown(false); } }}
                />
                <button
                  type="button"
                  onClick={() => { if (newTerm.trim()) { onAddCustomTerm(newTerm.trim()); onUpdateCommandTerm(part.id, newTerm.trim()); setNewTerm(""); setShowTermDropdown(false); } }}
                  className="rounded bg-blue-600 px-2 text-xs text-white font-bold hover:bg-blue-700"
                >+</button>
              </div>
            </div>
          )}
        </div>

        {/* Delete part */}
        {confirmDeletePartId === part.id ? (
          <div className="flex items-center gap-1 ml-auto">
            <span className="text-xs text-red-700 font-semibold">Delete this part?</span>
            <button
              type="button"
              disabled={deletingPartId === part.id}
              onClick={async () => {
                setDeletingPartId(part.id);
                try {
                  await fetch("/api/questions/part-metadata", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ partId: part.id }) });
                  onRefresh();
                } finally { setDeletingPartId(null); setConfirmDeletePartId(null); }
              }}
              className="rounded bg-red-600 px-2 py-0.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {deletingPartId === part.id ? "…" : "Yes"}
            </button>
            <button type="button" onClick={() => setConfirmDeletePartId(null)} className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-100">No</button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDeletePartId(part.id)}
            className="ml-auto rounded border border-red-200 bg-white px-2 py-0.5 text-xs text-red-500 hover:bg-red-50"
          >
            🗑
          </button>
        )}
      </div>

      {/* LaTeX content */}
      {isEditing && editingField === "latex" ? (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-blue-700">Edit LaTeX</span>
            <span className="text-[10px] text-gray-400 cursor-help" title={HINT_TOOLTIP}>ⓘ</span>
          </div>
          <textarea
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            rows={3}
            className="w-full rounded border border-blue-300 px-2 py-1 text-xs font-mono resize-y focus:outline-none focus:ring-1 focus:ring-blue-400 max-w-2xl"
          />
          {editDraft && (
            <div className="text-xs text-gray-600 bg-gray-50 rounded border border-gray-200 px-2 py-1 max-w-2xl">
              <span className="font-semibold text-gray-500 text-[10px]">Preview: </span>
              <span dangerouslySetInnerHTML={{ __html: renderLatexPreview(editDraft) }} />
            </div>
          )}
          <div className="flex gap-1.5">
            <button type="button" onClick={() => savePartField(part.id, "latex", editDraft)} disabled={savingField} className="rounded bg-blue-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50">{savingField ? "Saving…" : "Save"}</button>
            <button type="button" onClick={() => { setEditingPartId(null); setEditingField(null); }} className="rounded border border-gray-300 px-2.5 py-1 text-xs font-bold text-gray-600 hover:bg-gray-100">Cancel</button>
          </div>
        </div>
      ) : (
        part.latex && (
          <div
            className="text-sm cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5 group"
            onClick={() => { setEditingPartId(part.id); setEditingField("latex"); setEditDraft(part.latex ?? ""); }}
            title="Click to edit LaTeX"
          >
            <LatexRenderer latex={part.latex} />
            <span className="ml-1 text-[10px] text-gray-400 opacity-0 group-hover:opacity-100">✏</span>
          </div>
        )
      )}
      {!part.latex && !isEditing && (
        <button
          type="button"
          onClick={() => { setEditingPartId(part.id); setEditingField("latex"); setEditDraft(""); }}
          className="text-xs text-gray-400 hover:text-blue-600 italic"
        >
          + Add LaTeX content
        </button>
      )}

      {/* Subtopics */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {currentCodes.map((code) => {
          const sub = availableSubtopics.find((s) => s.code === code);
          const isPrimary = code === part.primary_subtopic_code;
          return (
            <div
              key={code}
              draggable
              onDragStart={(e) => { e.dataTransfer.setData("text/plain", code); e.dataTransfer.effectAllowed = "move"; }}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverCode(code); }}
              onDragLeave={() => setDragOverCode(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverCode(null);
                const draggedCode = e.dataTransfer.getData("text/plain");
                if (draggedCode === code || !currentCodes.includes(draggedCode)) return;
                const newOrder = [...currentCodes];
                const fromIdx = newOrder.indexOf(draggedCode);
                const toIdx = newOrder.indexOf(code);
                newOrder.splice(fromIdx, 1);
                newOrder.splice(toIdx, 0, draggedCode);
                onUpdateSubtopics(part.id, newOrder, part.primary_subtopic_code);
              }}
              className={`flex items-center gap-0.5 rounded-full border text-[11px] font-semibold px-2 py-0.5 cursor-grab active:cursor-grabbing transition-colors ${
                dragOverCode === code ? "border-blue-500 bg-blue-100" :
                isPrimary ? "border-emerald-400 bg-emerald-50 text-emerald-800" : "border-blue-200 bg-blue-50 text-blue-800"
              }`}
            >
              {isPrimary && <span className="text-emerald-600 text-[9px] mr-0.5">★</span>}
              <button
                type="button"
                title={`Set "${code}" as primary subtopic`}
                onClick={() => onUpdateSubtopics(part.id, currentCodes, code)}
                className="hover:text-emerald-700"
              >
                {code}
              </button>
              {sub && <span className="text-gray-500 hidden sm:inline ml-0.5">— {sub.descriptor.slice(0, 25)}{sub.descriptor.length > 25 ? "…" : ""}</span>}
              <button
                type="button"
                onClick={() => handleRemoveSubtopic(code)}
                className="ml-1 rounded-full hover:bg-red-100 hover:text-red-600 text-gray-400 w-3.5 h-3.5 flex items-center justify-center text-[10px] font-bold"
              >
                ×
              </button>
            </div>
          );
        })}

        {/* Add subtopic dropdown */}
        <div className="relative" ref={subtopicDropdownRef}>
          <button
            type="button"
            onClick={() => { setShowSubtopicDropdown((v) => !v); setSubtopicSearch(""); }}
            className="rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[11px] text-gray-500 hover:border-blue-400 hover:text-blue-600"
          >
            + subtopic
          </button>
          {showSubtopicDropdown && (
            <div className="absolute left-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-lg shadow-lg w-72 max-h-64 overflow-y-auto">
              <div className="p-1.5 border-b border-gray-100 sticky top-0 bg-white">
                <input
                  type="text"
                  value={subtopicSearch}
                  onChange={(e) => setSubtopicSearch(e.target.value)}
                  placeholder="Search subtopics…"
                  className="w-full rounded border border-gray-300 px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                  autoFocus
                />
              </div>
              {Object.entries(filteredSubtopicsBySection).map(([sec, subs]) => (
                <div key={sec}>
                  <div className="px-2 py-1 text-[10px] font-bold text-gray-500 bg-gray-50 sticky top-9">{sec}. {SECTION_NAMES[Number(sec)]}</div>
                  {subs.map((sub) => (
                    <button
                      key={sub.code}
                      type="button"
                      onClick={() => {
                        const newCodes = [...currentCodes, sub.code];
                        onUpdateSubtopics(part.id, newCodes);
                        setShowSubtopicDropdown(false);
                        setSubtopicSearch("");
                      }}
                      className="w-full text-left px-3 py-1 text-xs hover:bg-blue-50 text-gray-700"
                    >
                      <span className="font-mono font-semibold text-blue-700">{sub.code}</span>
                      <span className="text-gray-500 ml-1">— {sub.descriptor}</span>
                    </button>
                  ))}
                </div>
              ))}
              {Object.keys(filteredSubtopicsBySection).length === 0 && (
                <p className="px-3 py-2 text-xs text-gray-400 italic">No subtopics found</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── ImageSection sub-component ────────────────────────────────────────────────

function ImageSection({
  question,
  questionImages,
  msImages,
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
}: {
  question: Question;
  questionImages: QuestionImage[];
  msImages: QuestionImage[];
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
}) {
  const [dragOverImageId, setDragOverImageId] = useState<string | null>(null);
  const [enlargedImageId, setEnlargedImageId] = useState<string | null>(null);
  const qFileRef = useRef<HTMLInputElement>(null);
  const msFileRef = useRef<HTMLInputElement>(null);

  const enlargedImage = [...questionImages, ...msImages].find((img) => img.id === enlargedImageId);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setEnlargedImageId(null); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs font-bold text-gray-700">Images</p>
        <div className="flex items-center gap-2 flex-wrap">
          {driveConnected && (
            <button
              type="button"
              onClick={onExtractImages}
              disabled={extracting}
              className="rounded border border-blue-300 bg-white px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
            >
              {extracting ? "Extracting…" : "↻ Extract from Docs"}
            </button>
          )}
          {hasTroubleshooting && (
            <button
              type="button"
              onClick={onCopyTroubleshooting}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              title="Copy extraction troubleshooting report"
            >
              {troubleshootingCopied ? "✓ Copied" : "Copy Report"}
            </button>
          )}
          {(questionImages.length > 0 || msImages.length > 0) && (
            <button
              type="button"
              onClick={onDeleteAllImages}
              className="rounded border border-red-300 bg-white px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
            >
              🗑 Delete All
            </button>
          )}
        </div>
      </div>

      {[
        { label: "Question", imgs: questionImages, type: "question" as const, fileRef: qFileRef },
        { label: "Markscheme", imgs: msImages, type: "markscheme" as const, fileRef: msFileRef },
      ].map(({ label, imgs, type, fileRef }) => (
        <div key={type}>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[11px] font-semibold text-gray-600">{label}</p>
            <div className="flex items-center gap-1.5">
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { onUploadImage(type, f); e.target.value = ""; } }} />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploadingImage}
                className="rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                {uploadingImage ? "Uploading…" : "+ Upload"}
              </button>
            </div>
          </div>
          {imgs.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {imgs.map((img) => (
                <div
                  key={img.id}
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData("text/plain", img.id); e.dataTransfer.effectAllowed = "move"; }}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverImageId(img.id); }}
                  onDragLeave={() => setDragOverImageId(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverImageId(null);
                    const draggedId = e.dataTransfer.getData("text/plain");
                    if (draggedId === img.id) return;
                    const sameType = imgs.filter((i) => i.image_type === type);
                    const ids = sameType.map((i) => i.id);
                    const fromIdx = ids.indexOf(draggedId);
                    const toIdx = ids.indexOf(img.id);
                    if (fromIdx < 0 || toIdx < 0) return;
                    const newOrder = [...ids];
                    newOrder.splice(fromIdx, 1);
                    newOrder.splice(toIdx, 0, draggedId);
                    onReorderImages(type, newOrder);
                  }}
                  className={`relative group rounded-lg overflow-hidden border-2 transition-all ${dragOverImageId === img.id ? "border-blue-500 scale-105 cursor-grabbing" : "border-gray-200 hover:border-blue-400 hover:shadow-lg cursor-pointer"}`}
                  style={{ width: "100%", height: 380 }}
                  onClick={(e) => { if ((e.target as HTMLElement).closest("button")) return; setEnlargedImageId(img.id); }}
                >
                  <img
                    src={img.url ?? (img.storage_path.startsWith("http") ? img.storage_path : undefined)}
                    alt={`${label} ${img.sort_order + 1}`}
                    className="w-full h-full object-contain bg-white"
                  />
                  <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => onDeleteImage(img.id)}
                      disabled={deletingImageIds.has(img.id)}
                      className="rounded-full bg-red-600 text-white w-6 h-6 text-xs font-bold flex items-center justify-center hover:bg-red-700 disabled:opacity-50"
                    >
                      {deletingImageIds.has(img.id) ? "…" : "×"}
                    </button>
                  </div>
                  <div className="absolute bottom-1 left-1 bg-black/60 rounded px-2 py-1 text-xs text-white font-semibold">
                    {img.sort_order + 1}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400 italic">No {label.toLowerCase()} images</p>
          )}
        </div>
      ))}

      {!driveConnected && questionImages.length === 0 && msImages.length === 0 && (
        <p className="text-xs text-gray-400 italic">Connect Google Drive to extract images from question documents.</p>
      )}

      {/* Image lightbox / enlargement modal */}
      {enlargedImage && createPortal(
        <div
          className="fixed inset-0 z-[400] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setEnlargedImageId(null)}
        >
          <div
            className="relative max-w-4xl max-h-[90vh] bg-white rounded-lg shadow-2xl overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setEnlargedImageId(null)}
              className="absolute top-3 right-3 z-10 rounded-full bg-red-600 text-white w-8 h-8 font-bold flex items-center justify-center hover:bg-red-700 text-lg"
              title="Close (Esc)"
            >
              ✕
            </button>
            <img
              src={enlargedImage.url ?? (enlargedImage.storage_path.startsWith("http") ? enlargedImage.storage_path : undefined)}
              alt={enlargedImage.alt_text ?? "Enlarged image"}
              className="w-full h-full object-contain"
            />
            <div className="absolute bottom-3 left-3 bg-black/60 rounded px-2 py-1 text-xs text-white font-semibold">
              {enlargedImage.image_type === "question" ? "Question" : "Markscheme"} — {enlargedImage.sort_order + 1}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
