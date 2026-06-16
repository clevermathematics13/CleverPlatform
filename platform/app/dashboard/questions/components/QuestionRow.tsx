"use client";

import { useState, useEffect, useRef } from "react";
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

// ── Helpers ────────────────────────────────────────────────────────────────────────────

const HINT_TOOLTIP = `LaTeX math: $x^2$, $\\frac{a}{b}$, $\\sqrt{x}$
Text: plain words work directly
Use ^ for powers: x^2, e^(-x), (x+1)^3
Colors: any CSS hex or named colour`.trim();

async function readClipboardImage(): Promise<File | null> {
  try {
    if (!navigator.clipboard?.read) return null;
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imgType = item.types.find((t) => t.startsWith("image/"));
      if (imgType) {
        const blob = await item.getType(imgType);
        const ext = imgType.split("/")[1] ?? "png";
        return new File([blob], `clipboard.${ext}`, { type: imgType });
      }
    }
    return null;
  } catch {
    return null;
  }
}

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
  savedExamWithQuestion: import("./types").SavedExam | null;
  onOpenSavedExam: (exam: import("./types").SavedExam) => void;
  onOpenEditor?: () => void;
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

  const [editingPartId, setEditingPartId] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<"marks" | "label" | "latex" | null>(null);
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

  const convertImagesToLatex = async (imageType: "question" | "markscheme") => {
    setConvertingLatex(imageType);
    setConvertLatexError(null);
    try {
      const field = imageType === "question" ? "parts_draft_latex" : "parts_draft_markscheme_latex";
      const res = await fetch("/api/questions/ocr-latex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: question.id, field }),
      });
      const data = await res.json();
      if (data.error) { setConvertLatexError(data.error); return; }
      onRefresh();
    } catch (e: unknown) {
      setConvertLatexError(e instanceof Error ? e.message : "Conversion failed");
    } finally {
      setConvertingLatex(null);
    }
  };

  const renderLatexPreview = (latex: string): string => {
    if (!latex) return "";
    try { return katex.renderToString(latex, { throwOnError: false, displayMode: false }); }
    catch { return latex; }
  };

  const questionImages = images.filter((i) => i.image_type === "question").sort((a, b) => a.sort_order - b.sort_order);
  const msImages = images.filter((i) => i.image_type === "markscheme").sort((a, b) => a.sort_order - b.sort_order);

  const questionLatex = question.question_parts
    .filter((p) => (p.content_latex ?? p.latex ?? "").trim())
    .map((p) => ({ label: p.part_label, latex: (p.content_latex ?? p.latex)! }));

  const msLatex = question.question_parts
    .filter((p) => (p.markscheme_latex ?? "").trim())
    .map((p) => ({ label: p.part_label, latex: p.markscheme_latex! }));

  return (
    <>
      {!hideCollapsedRow && <tr
        className={`cursor-pointer hover:bg-blue-50 transition-colors ${expanded ? "bg-blue-50" : ""}`}
        onClick={() => { if (expanded) onClose(); else onOpen(); }}
      >
        <td className="px-4 py-2">
          <div className="flex items-center gap-1.5">
            {hasDocLinkConflict && (
              <span className="inline-flex items-center rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700" title="Question doc and markscheme doc are the same file \u2014 links need to be fixed">\u26a0 conflict</span>
            )}
            {onOpenEditor ? (
              <button type="button" onClick={(e) => { e.stopPropagation(); onOpenEditor(); }} title="Open Question Studio"
                className={`font-mono text-sm font-semibold hover:underline hover:text-indigo-700 transition-colors ${expanded ? "text-blue-700" : "text-blue-900"}`}>
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
        <td className="px-4 py-2 text-center text-sm text-gray-700">{question.timezone ?? "\u2014"}</td>
        <td className="px-4 py-2 text-center text-sm text-gray-700">{question.question_parts.length}</td>
        <td className="px-4 py-2 text-center text-sm font-semibold text-gray-800">
          {inQueue && editingQueueMarks ? (
            <input type="number" min={0} max={99} value={queueMarksDraft} onClick={(e) => e.stopPropagation()}
              onChange={(e) => setQueueMarksDraft(e.target.value)}
              onBlur={() => { const v = parseInt(queueMarksDraft); if (!isNaN(v) && v >= 0) onQueueMarksChange(question.id, v); setEditingQueueMarks(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") { const v = parseInt(queueMarksDraft); if (!isNaN(v) && v >= 0) onQueueMarksChange(question.id, v); setEditingQueueMarks(false); } if (e.key === "Escape") setEditingQueueMarks(false); e.stopPropagation(); }}
              className="w-12 rounded border border-blue-300 px-1 py-0.5 text-center text-sm font-semibold" autoFocus />
          ) : (
            <span onClick={(e) => { if (inQueue) { e.stopPropagation(); setQueueMarksDraft(String(totalMarks)); setEditingQueueMarks(true); } }}
              title={inQueue ? "Click to override marks for this exam" : undefined}
              className={inQueue ? "cursor-pointer hover:text-blue-600 underline decoration-dotted" : ""}>
              {totalMarks}
            </span>
          )}
        </td>
        <td className="px-4 py-2 text-center">
          <div className="flex items-center justify-center gap-1.5">
            <span className={`text-xs font-semibold ${question.has_question_images ? "text-emerald-600" : "text-gray-300"}`} title={question.has_question_images ? "Question images extracted" : "No question images"}>\ud83d\udcc4 Q</span>
            <span className={`text-xs font-semibold ${question.has_markscheme_images ? "text-emerald-600" : "text-gray-300"}`} title={question.has_markscheme_images ? "Markscheme images extracted" : "No markscheme images"}>\ud83d\udcdd MS</span>
          </div>
        </td>
        <td className="px-4 py-2 text-center" onClick={(e) => e.stopPropagation()}>
          {showSection ? (
            <div className="flex items-center justify-center gap-1">
              <button type="button" onClick={() => { onUpdateSection("A"); setShowSectionPrompt(false); }} disabled={savingSection}
                className={`rounded px-2 py-0.5 text-xs font-bold transition-colors ${question.section === "A" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-blue-100"}`}>A</button>
              <button type="button" onClick={() => { onUpdateSection("B"); setShowSectionPrompt(false); }} disabled={savingSection}
                className={`rounded px-2 py-0.5 text-xs font-bold transition-colors ${question.section === "B" ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-indigo-100"}`}>B</button>
            </div>
          ) : (<span className="text-xs text-gray-400">\u2014</span>)}
        </td>
        {testBuilderOpen && (
          <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
            {question.has_question_images ? (
              inQueue ? (
                <button type="button" disabled title="Already in current exam" className="rounded-full w-7 h-7 text-sm font-bold transition-colors bg-indigo-100 text-indigo-400 cursor-default">\u2713</button>
              ) : savedExamWithQuestion ? (
                <button type="button" onClick={() => onOpenSavedExam(savedExamWithQuestion)} title={`Already in "${savedExamWithQuestion.name}" \u2014 click to open`}
                  className="rounded-full w-7 h-7 text-sm font-bold transition-colors bg-green-100 text-green-700 hover:bg-green-200 border border-green-300">\u2713</button>
              ) : (
                <button type="button" onClick={onAddToQueue} title="Add to exam" className="rounded-full w-7 h-7 text-sm font-bold transition-colors bg-indigo-600 text-white hover:bg-indigo-700">+</button>
              )
            ) : (<span className="text-xs text-gray-300" title="No images extracted">\u2014</span>)}
          </td>
        )}
        <td className="px-2 py-2 text-center" onClick={(e) => e.stopPropagation()}>
          <div className="relative inline-block">
            <button type="button" title={question.note ? `Note: ${question.note}` : "Add note"}
              onClick={() => { setNoteDraft(question.note ?? ""); setShowNotePanel((v) => !v); }}
              className={`rounded-full w-6 h-6 text-xs transition-colors ${question.note ? "bg-amber-100 text-amber-700 hover:bg-amber-200" : "bg-gray-100 text-gray-400 hover:bg-gray-200"}`}>
              {question.note ? "\ud83d\udcac" : "\u25cb"}
            </button>
            {showNotePanel && createPortal(
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowNotePanel(false)}>
                <div className="bg-white rounded-xl shadow-2xl p-4 w-80 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
                  <h3 className="text-sm font-bold text-gray-800">Note for {question.code}</h3>
                  <textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="Add a note about this question..."
                    className="rounded border border-gray-300 px-2 py-1.5 text-sm resize-none h-24 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  <div className="flex gap-2 justify-end">
                    <button type="button" onClick={() => setShowNotePanel(false)} className="rounded px-3 py-1 text-xs font-semibold border border-gray-300 text-gray-600 hover:bg-gray-100">Cancel</button>
                    <button type="button" onClick={saveNote} disabled={savingNote} className="rounded px-3 py-1 text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">{savingNote ? "Saving\u2026" : "Save"}</button>
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
          <td colSpan={hideCollapsedRow ? 1 : testBuilderOpen ? 11 : 10} className="px-0 py-0 bg-blue-50">
            <div className="border-t border-blue-200 px-4 py-3 space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <button type="button" onClick={() => setMinimized((v) => !v)}
                  className="rounded border border-blue-300 bg-white px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50">
                  {minimized ? "\u25bc Expand" : "\u25b2 Minimise"}
                </button>
                {!hideCollapsedRow && (
                  <button type="button" onClick={onClose} className="rounded border border-blue-300 bg-white px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50">\u2715 Close</button>
                )}
                {!editingLinks && (
                  <button type="button" onClick={() => { setLinkDraftQ(question.google_doc_id ?? ""); setLinkDraftMS(question.google_ms_id ?? ""); setEditingLinks(true); }}
                    className={`rounded border px-2.5 py-1 text-xs font-semibold ${hasDocLinkConflict ? "border-red-400 bg-red-50 text-red-700 hover:bg-red-100" : "border-blue-300 bg-white text-blue-700 hover:bg-blue-50"}`}>
                    {hasDocLinkConflict ? "\u26a0 Fix Links" : "\ud83d\udd17 Edit Doc Links"}
                  </button>
                )}
                <button type="button" onClick={deleteQuestion} disabled={deletingQuestion}
                  className="rounded border border-red-300 bg-white px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
                  {deletingQuestion ? "Deleting\u2026" : "\ud83d\uddd1 Delete"}
                </button>
              </div>

              {!minimized && (
                <div className="space-y-4">
                  {editingLinks && (
                    <div className="rounded-lg border border-blue-200 bg-white p-3 space-y-2">
                      <p className="text-xs font-bold text-blue-800">Edit Google Doc Links</p>
                      {hasDocLinkConflict && (<p className="text-xs font-semibold text-red-700 bg-red-50 rounded px-2 py-1">\u26a0 Q doc and MS doc are the same file \u2014 this will cause extraction errors. Clear one of them.</p>)}
                      <label className="flex flex-col gap-0.5">
                        <span className="text-[11px] font-semibold text-blue-700">\ud83d\udcc4 Question Doc URL or ID</span>
                        <input type="text" value={linkDraftQ} onChange={(e) => setLinkDraftQ(e.target.value)} placeholder="https://docs.google.com/document/d/\u2026 or doc ID"
                          className="rounded border border-blue-300 px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-400 w-full max-w-xl" />
                      </label>
                      <label className="flex flex-col gap-0.5">
                        <span className="text-[11px] font-semibold text-green-700">\ud83d\udcdd Markscheme Doc URL or ID</span>
                        <input type="text" value={linkDraftMS} onChange={(e) => setLinkDraftMS(e.target.value)} placeholder="https://docs.google.com/document/d/\u2026 or doc ID (leave blank to unlink)"
                          className="rounded border border-green-300 px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-green-400 w-full max-w-xl" />
                      </label>
                      <div className="flex gap-2">
                        <button type="button" onClick={saveLinks} disabled={savingLinks} className="rounded bg-blue-600 px-3 py-1 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50">{savingLinks ? "Saving\u2026" : "Save Links"}</button>
                        <button type="button" onClick={() => { setEditingLinks(false); setLinkDraftQ(question.google_doc_id ?? ""); setLinkDraftMS(question.google_ms_id ?? ""); }} disabled={savingLinks}
                          className="rounded border border-gray-300 px-3 py-1 text-xs font-bold text-gray-600 hover:bg-gray-100 disabled:opacity-50">Cancel</button>
                      </div>
                      {linkSaveResult && <p className={`text-xs font-semibold ${linkSaveResult.startsWith("Error") ? "text-red-600" : "text-green-700"}`}>{linkSaveResult}</p>}
                    </div>
                  )}

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
                        onRefresh={onRefresh} renderLatexPreview={renderLatexPreview} />
                    ))}
                  </div>

                  {addingPart ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 space-y-2">
                      <p className="text-xs font-bold text-emerald-800">Add New Part</p>
                      <div className="flex gap-2 flex-wrap items-end">
                        <div>
                          <label className="block text-[11px] font-semibold text-emerald-700 mb-0.5">Part label</label>
                          <input type="text" value={newPartLabel} onChange={(e) => setNewPartLabel(e.target.value)} placeholder="e.g. a, b, i"
                            className="rounded border border-emerald-300 px-2 py-1 text-xs w-20 focus:outline-none focus:ring-1 focus:ring-emerald-400" />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-emerald-700 mb-0.5">Marks</label>
                          <input type="number" min={0} max={99} value={newPartMarks} onChange={(e) => setNewPartMarks(e.target.value)}
                            className="rounded border border-emerald-300 px-2 py-1 text-xs w-16 focus:outline-none focus:ring-1 focus:ring-emerald-400" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-emerald-700 mb-0.5">LaTeX (optional)</label>
                        <textarea value={newPartLatex} onChange={(e) => setNewPartLatex(e.target.value)} placeholder="Question text in LaTeX\u2026" rows={2}
                          className="rounded border border-emerald-300 px-2 py-1 text-xs w-full max-w-xl font-mono resize-none focus:outline-none focus:ring-1 focus:ring-emerald-400" />
                      </div>
                      {newPartError && <p className="text-xs text-red-600">{newPartError}</p>}
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
                          {savingNewPart ? "Saving\u2026" : "Add Part"}
                        </button>
                        <button type="button" onClick={() => { setAddingPart(false); setNewPartError(null); }}
                          className="rounded border border-gray-300 px-3 py-1 text-xs font-bold text-gray-600 hover:bg-gray-100">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setAddingPart(true)}
                      className="rounded-lg border-2 border-dashed border-emerald-300 bg-white px-4 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50 w-full">
                      + Add Part
                    </button>
                  )}

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
                    onConvertLatex={convertImagesToLatex} />
                </div>
              )}
            </div>
          </td>
        </tr>
      )}

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
              <button type="button" onClick={() => { setPrimaryWarningDialog(null); }} className="rounded px-3 py-1.5 text-sm font-semibold bg-red-600 text-white hover:bg-red-700">Remove anyway</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// ── QuestionPartRow ───────────────────────────────────────────────────────────────────────────────

function QuestionPartRow({
  part, partIdx, question, commandTerms, onUpdateCommandTerm, onAddCustomTerm,
  availableSubtopics, onUpdateSubtopics, editingPartId, editingField, editDraft, savingField,
  confirmDeletePartId, deletingPartId, dragOverCode, setEditingPartId, setEditingField, setEditDraft,
  savePartField, setConfirmDeletePartId, setDeletingPartId, setDragOverCode,
  primaryWarningDialog, setPrimaryWarningDialog, onRefresh, renderLatexPreview,
}: {
  part: QuestionPart; partIdx: number; question: Question; commandTerms: string[];
  onUpdateCommandTerm: (partId: string, commandTerm: string | null) => void;
  onAddCustomTerm: (term: string) => void; availableSubtopics: Subtopic[];
  onUpdateSubtopics: (partId: string, codes: string[], primaryCode?: string | null) => void;
  editingPartId: string | null; editingField: "marks" | "label" | "latex" | null;
  editDraft: string; savingField: boolean; confirmDeletePartId: string | null;
  deletingPartId: string | null; dragOverCode: string | null;
  setEditingPartId: (id: string | null) => void;
  setEditingField: (f: "marks" | "label" | "latex" | null) => void;
  setEditDraft: (v: string) => void;
  savePartField: (partId: string, field: "marks" | "label" | "latex", value: string) => Promise<void>;
  setConfirmDeletePartId: (id: string | null) => void; setDeletingPartId: (id: string | null) => void;
  setDragOverCode: (code: string | null) => void;
  primaryWarningDialog: { labels: string; plural: boolean } | null;
  setPrimaryWarningDialog: (v: { labels: string; plural: boolean } | null) => void;
  onRefresh: () => void; renderLatexPreview: (latex: string) => string;
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

  const partLatex = part.content_latex ?? part.latex ?? null;

  return (
    <div className={`rounded-lg border bg-white p-3 space-y-2 ${isEditing ? "border-blue-400 shadow-sm" : "border-gray-200"}`}>
      <div className="flex items-center gap-2 flex-wrap">
        {isEditing && editingField === "label" ? (
          <div className="flex items-center gap-1">
            <input type="text" value={editDraft} onChange={(e) => setEditDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") savePartField(part.id, "label", editDraft); if (e.key === "Escape") { setEditingPartId(null); setEditingField(null); } }}
              className="w-16 rounded border border-blue-300 px-1.5 py-0.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-400" autoFocus />
            <button type="button" onClick={() => savePartField(part.id, "label", editDraft)} disabled={savingField} className="rounded bg-blue-600 px-2 py-0.5 text-xs text-white font-bold disabled:opacity-50">{savingField ? "\u2026" : "\u2713"}</button>
            <button type="button" onClick={() => { setEditingPartId(null); setEditingField(null); }} className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600">\u2715</button>
          </div>
        ) : (
          <button type="button" onClick={() => { setEditingPartId(part.id); setEditingField("label"); setEditDraft(part.part_label ?? ""); }} title="Click to edit part label"
            className="rounded bg-gray-100 px-2 py-0.5 text-xs font-mono font-bold text-gray-700 hover:bg-blue-100 hover:text-blue-700">
            {part.part_label ? `(${part.part_label})` : `Part ${partIdx + 1}`}
          </button>
        )}
        {isEditing && editingField === "marks" ? (
          <div className="flex items-center gap-1">
            <input type="number" min={0} max={99} value={editDraft} onChange={(e) => setEditDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") savePartField(part.id, "marks", editDraft); if (e.key === "Escape") { setEditingPartId(null); setEditingField(null); } }}
              className="w-14 rounded border border-blue-300 px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-400" autoFocus />
            <button type="button" onClick={() => savePartField(part.id, "marks", editDraft)} disabled={savingField} className="rounded bg-blue-600 px-2 py-0.5 text-xs text-white font-bold disabled:opacity-50">{savingField ? "\u2026" : "\u2713"}</button>
            <button type="button" onClick={() => { setEditingPartId(null); setEditingField(null); }} className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600">\u2715</button>
          </div>
        ) : (
          <button type="button" onClick={() => { setEditingPartId(part.id); setEditingField("marks"); setEditDraft(String(part.marks)); }} title="Click to edit marks"
            className="rounded bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-800 hover:bg-blue-100">
            {part.marks} {part.marks === 1 ? "mark" : "marks"}
          </button>
        )}
        <div className="flex gap-1">
          {(part.mark_types ?? []).map((mt) => (
            <span key={mt} className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${mt === "M" ? "bg-blue-100 text-blue-800" : mt === "A" ? "bg-green-100 text-green-800" : mt === "R" ? "bg-purple-100 text-purple-800" : mt === "AG" ? "bg-gray-100 text-gray-700" : "bg-gray-100 text-gray-600"}`}>{mt}</span>
          ))}
        </div>
        <div className="relative" ref={dropdownRef}>
          <button type="button" onClick={() => setShowTermDropdown((v) => !v)}
            className={`rounded px-2 py-0.5 text-xs font-semibold transition-colors ${part.command_term ? "bg-teal-100 text-teal-800 hover:bg-teal-200" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
            {part.command_term ?? "No term"}
          </button>
          {showTermDropdown && (
            <div className="absolute left-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-lg shadow-lg w-52 max-h-64 overflow-y-auto">
              <div className="p-1.5 border-b border-gray-100">
                <button type="button" onClick={() => { onUpdateCommandTerm(part.id, null); setShowTermDropdown(false); }} className="w-full text-left px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 rounded italic">\u2014 Remove term</button>
              </div>
              {commandTerms.map((term) => (
                <button key={term} type="button" onClick={() => { onUpdateCommandTerm(part.id, term); setShowTermDropdown(false); }}
                  className={`w-full text-left px-2 py-1 text-xs hover:bg-blue-50 rounded ${part.command_term === term ? "font-bold text-blue-700 bg-blue-50" : "text-gray-700"}`}>{term}</button>
              ))}
              <div className="p-1.5 border-t border-gray-100 flex gap-1">
                <input type="text" value={newTerm} onChange={(e) => setNewTerm(e.target.value)} placeholder="Custom term\u2026"
                  className="flex-1 rounded border border-gray-300 px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                  onKeyDown={(e) => { if (e.key === "Enter" && newTerm.trim()) { onAddCustomTerm(newTerm.trim()); onUpdateCommandTerm(part.id, newTerm.trim()); setNewTerm(""); setShowTermDropdown(false); } }} />
                <button type="button" onClick={() => { if (newTerm.trim()) { onAddCustomTerm(newTerm.trim()); onUpdateCommandTerm(part.id, newTerm.trim()); setNewTerm(""); setShowTermDropdown(false); } }}
                  className="rounded bg-blue-600 px-2 text-xs text-white font-bold hover:bg-blue-700">+</button>
              </div>
            </div>
          )}
        </div>
        {confirmDeletePartId === part.id ? (
          <div className="flex items-center gap-1 ml-auto">
            <span className="text-xs text-red-700 font-semibold">Delete this part?</span>
            <button type="button" disabled={deletingPartId === part.id}
              onClick={async () => { setDeletingPartId(part.id); try { await fetch("/api/questions/part-metadata", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ partId: part.id }) }); onRefresh(); } finally { setDeletingPartId(null); setConfirmDeletePartId(null); } }}
              className="rounded bg-red-600 px-2 py-0.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50">{deletingPartId === part.id ? "\u2026" : "Yes"}</button>
            <button type="button" onClick={() => setConfirmDeletePartId(null)} className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-100">No</button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmDeletePartId(part.id)} className="ml-auto rounded border border-red-200 bg-white px-2 py-0.5 text-xs text-red-500 hover:bg-red-50">\ud83d\uddd1</button>
        )}
      </div>

      {isEditing && editingField === "latex" ? (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-blue-700">Edit LaTeX</span>
            <span className="text-[10px] text-gray-400 cursor-help" title={HINT_TOOLTIP}>\u24d8</span>
          </div>
          <textarea value={editDraft} onChange={(e) => setEditDraft(e.target.value)} rows={3}
            className="w-full rounded border border-blue-300 px-2 py-1 text-xs font-mono resize-y focus:outline-none focus:ring-1 focus:ring-blue-400 max-w-2xl" />
          {editDraft && (
            <div className="text-xs text-gray-600 bg-gray-50 rounded border border-gray-200 px-2 py-1 max-w-2xl">
              <span className="font-semibold text-gray-500 text-[10px]">Preview: </span>
              <span dangerouslySetInnerHTML={{ __html: renderLatexPreview(editDraft) }} />
            </div>
          )}
          <div className="flex gap-1.5">
            <button type="button" onClick={() => savePartField(part.id, "latex", editDraft)} disabled={savingField} className="rounded bg-blue-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50">{savingField ? "Saving\u2026" : "Save"}</button>
            <button type="button" onClick={() => { setEditingPartId(null); setEditingField(null); }} className="rounded border border-gray-300 px-2.5 py-1 text-xs font-bold text-gray-600 hover:bg-gray-100">Cancel</button>
          </div>
        </div>
      ) : (
        partLatex && (
          <div className="text-sm cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5 group"
            onClick={() => { setEditingPartId(part.id); setEditingField("latex"); setEditDraft(partLatex); }} title="Click to edit LaTeX">
            <LatexRenderer latex={partLatex} />
            <span className="ml-1 text-[10px] text-gray-400 opacity-0 group-hover:opacity-100">\u270f</span>
          </div>
        )
      )}
      {!partLatex && !isEditing && (
        <button type="button" onClick={() => { setEditingPartId(part.id); setEditingField("latex"); setEditDraft(""); }} className="text-xs text-gray-400 hover:text-blue-600 italic">+ Add LaTeX content</button>
      )}

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
              className={`flex items-center gap-0.5 rounded-full border text-[11px] font-semibold px-2 py-0.5 cursor-grab active:cursor-grabbing transition-colors ${dragOverCode === code ? "border-blue-500 bg-blue-100" : isPrimary ? "border-emerald-400 bg-emerald-50 text-emerald-800" : "border-blue-200 bg-blue-50 text-blue-800"}`}>
              {isPrimary && <span className="text-emerald-600 text-[9px] mr-0.5">\u2605</span>}
              <button type="button" title={`Set "${code}" as primary subtopic`} onClick={() => onUpdateSubtopics(part.id, currentCodes, code)} className="hover:text-emerald-700">{code}</button>
              {sub && <span className="text-gray-500 hidden sm:inline ml-0.5">\u2014 {sub.descriptor.slice(0, 25)}{sub.descriptor.length > 25 ? "\u2026" : ""}</span>}
              <button type="button" onClick={() => handleRemoveSubtopic(code)} className="ml-1 rounded-full hover:bg-red-100 hover:text-red-600 text-gray-400 w-3.5 h-3.5 flex items-center justify-center text-[10px] font-bold">\u00d7</button>
            </div>
          );
        })}
        <div className="relative" ref={subtopicDropdownRef}>
          <button type="button" onClick={() => { setShowSubtopicDropdown((v) => !v); setSubtopicSearch(""); }}
            className="rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[11px] text-gray-500 hover:border-blue-400 hover:text-blue-600">
            + subtopic
          </button>
          {showSubtopicDropdown && (
            <div className="absolute left-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-lg shadow-lg w-72 max-h-64 overflow-y-auto">
              <div className="p-1.5 border-b border-gray-100 sticky top-0 bg-white">
                <input type="text" value={subtopicSearch} onChange={(e) => setSubtopicSearch(e.target.value)} placeholder="Search subtopics\u2026"
                  className="w-full rounded border border-gray-300 px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" autoFocus />
              </div>
              {Object.entries(filteredSubtopicsBySection).map(([sec, subs]) => (
                <div key={sec}>
                  <div className="px-2 py-1 text-[10px] font-bold text-gray-500 bg-gray-50 sticky top-9">{sec}. {SECTION_NAMES[Number(sec)]}</div>
                  {subs.map((sub) => (
                    <button key={sub.code} type="button"
                      onClick={() => { const newCodes = [...currentCodes, sub.code]; onUpdateSubtopics(part.id, newCodes); setShowSubtopicDropdown(false); setSubtopicSearch(""); }}
                      className="w-full text-left px-3 py-1 text-xs hover:bg-blue-50 text-gray-700">
                      <span className="font-mono font-semibold text-blue-700">{sub.code}</span>
                      <span className="text-gray-500 ml-1">\u2014 {sub.descriptor}</span>
                    </button>
                  ))}
                </div>
              ))}
              {Object.keys(filteredSubtopicsBySection).length === 0 && (<p className="px-3 py-2 text-xs text-gray-400 italic">No subtopics found</p>)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── ImageSection ─────────────────────────────────────────────────────────────
// Each image type group (Question / Markscheme) renders as a horizontally-paired
// block: [image stack] | [LaTeX panel], both columns independently scrollable.
// The paired layout always renders for both groups so the Markscheme section
// is always visible and actionable, even before images are extracted.

type LatexEntry = { label: string | null; latex: string };

function ImageSection({
  question, questionImages, msImages,
  questionLatex, msLatex,
  extracting, driveConnected, onExtractImages,
  hasTroubleshooting, troubleshootingCopied, onCopyTroubleshooting,
  deletingImageIds, uploadingImage, onDeleteImage, onDeleteAllImages, onReorderImages, onUploadImage,
  convertingLatex, convertLatexError, onConvertLatex,
}: {
  question: Question; questionImages: QuestionImage[]; msImages: QuestionImage[];
  questionLatex: LatexEntry[]; msLatex: LatexEntry[];
  extracting: boolean; driveConnected: boolean; onExtractImages: () => void;
  hasTroubleshooting: boolean; troubleshootingCopied: boolean; onCopyTroubleshooting: () => void;
  deletingImageIds: Set<string>; uploadingImage: boolean;
  onDeleteImage: (imageId: string) => void; onDeleteAllImages: () => void;
  onReorderImages: (imageType: "question" | "markscheme", orderedIds: string[]) => void;
  onUploadImage: (imageType: "question" | "markscheme", file: File) => void;
  convertingLatex: "question" | "markscheme" | null;
  convertLatexError: string | null;
  onConvertLatex: (imageType: "question" | "markscheme") => void;
}) {
  const [dragOverImageId, setDragOverImageId] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const qFileRef = useRef<HTMLInputElement>(null);
  const msFileRef = useRef<HTMLInputElement>(null);

  const allImages: (QuestionImage & { section: "question" | "markscheme" })[] = [
    ...questionImages.map((img) => ({ ...img, section: "question" as const })),
    ...msImages.map((img) => ({ ...img, section: "markscheme" as const })),
  ];

  const openLightbox = (imgId: string) => {
    const idx = allImages.findIndex((img) => img.id === imgId);
    if (idx >= 0) setLightboxIndex(idx);
  };
  const closeLightbox = () => setLightboxIndex(null);
  const prevImage = () => setLightboxIndex((i) => (i !== null && i > 0 ? i - 1 : i));
  const nextImage = () => setLightboxIndex((i) => (i !== null && i < allImages.length - 1 ? i + 1 : i));

  useEffect(() => {
    if (lightboxIndex === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") prevImage();
      if (e.key === "ArrowRight") nextImage();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [lightboxIndex]);

  const currentLightboxImage = lightboxIndex !== null ? allImages[lightboxIndex] : null;

  const handleSmartUpload = async (type: "question" | "markscheme", fileRef: React.RefObject<HTMLInputElement | null>) => {
    const clipFile = await readClipboardImage();
    if (clipFile) { onUploadImage(type, clipFile); } else { fileRef.current?.click(); }
  };

  const groups: {
    label: string;
    type: "question" | "markscheme";
    imgs: QuestionImage[];
    latex: LatexEntry[];
    fileRef: React.RefObject<HTMLInputElement | null>;
    accentBorder: string;
    accentHeader: string;
    accentText: string;
    convertLabel: string;
  }[] = [
    {
      label: "Question", type: "question", imgs: questionImages, latex: questionLatex,
      fileRef: qFileRef,
      accentBorder: "border-indigo-200", accentHeader: "bg-indigo-50 border-b border-indigo-200",
      accentText: "text-indigo-700", convertLabel: "Convert question images to LaTeX",
    },
    {
      label: "Markscheme", type: "markscheme", imgs: msImages, latex: msLatex,
      fileRef: msFileRef,
      accentBorder: "border-emerald-200", accentHeader: "bg-emerald-50 border-b border-emerald-200",
      accentText: "text-emerald-700", convertLabel: "Convert markscheme images to LaTeX",
    },
  ];

  // Height shared across both columns in each paired row so they align
  const PANEL_HEIGHT = "480px";

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs font-bold text-gray-700">Images</p>
        <div className="flex items-center gap-2 flex-wrap">
          {driveConnected && (
            <button type="button" onClick={onExtractImages} disabled={extracting}
              className="rounded border border-blue-300 bg-white px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50">
              {extracting ? "Extracting\u2026" : "\u21bb Extract from Docs"}
            </button>
          )}
          {hasTroubleshooting && (
            <button type="button" onClick={onCopyTroubleshooting}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">
              {troubleshootingCopied ? "\u2713 Copied" : "Copy Report"}
            </button>
          )}
          {(questionImages.length > 0 || msImages.length > 0) && (
            <button type="button" onClick={onDeleteAllImages} className="rounded border border-red-300 bg-white px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50">\ud83d\uddd1 Delete All</button>
          )}
        </div>
      </div>

      {/* Per-type paired rows — always rendered for both Question and Markscheme */}
      {groups.map(({ label, type, imgs, latex, fileRef, accentBorder, accentHeader, accentText, convertLabel }) => (
        <div key={type} className="space-y-1">
          {/* Row header with upload button */}
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold text-gray-600">{label}</p>
            <div className="flex items-center gap-1.5">
              <input ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) { onUploadImage(type, f); e.target.value = ""; } }} />
              <button type="button" disabled={uploadingImage} title="Paste clipboard image, or click to choose a file"
                onClick={() => handleSmartUpload(type, fileRef)}
                className="rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                {uploadingImage ? "Uploading\u2026" : "\ud83d\udccb Upload"}
              </button>
            </div>
          </div>

          {/* Horizontal pair: image column + LaTeX column — always rendered, each scrolls independently */}
          <div className="flex gap-3 items-stretch">

            {/* Image column — fixed height, scrolls independently */}
            <div
              className="overflow-y-auto flex flex-col gap-3 min-w-0"
              style={{ width: "50%", height: PANEL_HEIGHT }}
            >
                {imgs.length > 0 ? imgs.map((img) => (
                  <div key={img.id} draggable
                    onDragStart={(e) => { e.dataTransfer.setData("text/plain", img.id); e.dataTransfer.effectAllowed = "move"; }}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverImageId(img.id); }}
                    onDragLeave={() => setDragOverImageId(null)}
                    onDrop={(e) => {
                      e.preventDefault(); setDragOverImageId(null);
                      const draggedId = e.dataTransfer.getData("text/plain");
                      if (draggedId === img.id) return;
                      const ids = imgs.map((i) => i.id);
                      const fromIdx = ids.indexOf(draggedId); const toIdx = ids.indexOf(img.id);
                      if (fromIdx < 0 || toIdx < 0) return;
                      const newOrder = [...ids]; newOrder.splice(fromIdx, 1); newOrder.splice(toIdx, 0, draggedId);
                      onReorderImages(type, newOrder);
                    }}
                    className={`relative group rounded-xl overflow-hidden border-2 transition-all bg-white shadow-sm shrink-0 ${
                      dragOverImageId === img.id ? "border-blue-500 scale-[1.02] cursor-grabbing" : "border-gray-200 hover:border-blue-400 hover:shadow-xl cursor-pointer"
                    }`}
                    onClick={(e) => { if ((e.target as HTMLElement).closest("button")) return; openLightbox(img.id); }}
                  >
                    <img
                      src={img.url ?? (img.storage_path.startsWith("http") ? img.storage_path : undefined)}
                      alt={`${label} ${img.sort_order + 1}`}
                      className="block max-w-full w-full h-auto"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-all flex items-center justify-center pointer-events-none">
                      <span className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 text-white text-sm font-semibold px-3 py-1.5 rounded-full">\ud83d\udd0d Click to enlarge</span>
                    </div>
                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button type="button" onClick={() => onDeleteImage(img.id)} disabled={deletingImageIds.has(img.id)}
                        className="rounded-full bg-red-600 text-white w-8 h-8 text-sm font-bold flex items-center justify-center hover:bg-red-700 disabled:opacity-50 shadow-lg">
                        {deletingImageIds.has(img.id) ? "\u2026" : "\u00d7"}
                      </button>
                    </div>
                    <div className="absolute bottom-2 left-2 bg-black/60 rounded-full px-2.5 py-1 text-xs text-white font-semibold shadow">
                      {img.sort_order + 1} of {imgs.length}
                    </div>
                  </div>
                )) : (
                  /* Empty state — shown when no images extracted yet for this type */
                  <div className={`flex flex-col items-center justify-center h-full rounded-xl border-2 border-dashed ${
                    type === "markscheme" ? "border-emerald-200 bg-emerald-50/40" : "border-indigo-200 bg-indigo-50/40"
                  }`}>
                    <span className="text-2xl mb-2">{type === "markscheme" ? "\ud83d\udcdd" : "\ud83d\udcc4"}</span>
                    <p className="text-xs text-gray-400 font-medium text-center px-3">No {label.toLowerCase()} images yet</p>
                    {driveConnected && (
                      <p className="text-[10px] text-gray-400 mt-1 text-center px-3">Use \u201cExtract from Docs\u201d or \u201cUpload\u201d</p>
                    )}
                  </div>
                )}
              </div>

              {/* LaTeX column — same fixed height, scrolls independently */}
              <div
                className={`overflow-y-auto rounded-xl border ${accentBorder} bg-white shadow-sm flex-1 min-w-0`}
                style={{ height: PANEL_HEIGHT }}
              >
                {/* Sticky header inside the scrolling column */}
                <div className={`sticky top-0 z-10 ${accentHeader} px-3 py-2`}>
                  <span className={`text-[11px] font-bold ${accentText} tracking-wide uppercase`}>{label} LaTeX</span>
                </div>
                {latex.length > 0 ? (
                  <div className="divide-y divide-gray-100">
                    {latex.map(({ label: partLabel, latex: tex }, i) => (
                      <div key={i} className="px-3 py-2.5 space-y-1">
                        {partLabel && (
                          <span className={`inline-block text-[10px] font-bold font-mono ${accentText} bg-opacity-10 rounded px-1.5 py-0.5 bg-current`} style={{ opacity: 1 }}>
                            <span className={`${accentText} opacity-100`}>({partLabel})</span>
                          </span>
                        )}
                        <div className="text-sm leading-relaxed text-gray-800 overflow-x-auto">
                          <LatexRenderer latex={tex} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-4 py-4 space-y-3">
                    <p className="text-xs text-gray-500 leading-snug">
                      No LaTeX stored. Convert the image to extract it.
                    </p>
                    {imgs.length > 0 && (
                      <button type="button" disabled={convertingLatex !== null}
                        onClick={() => onConvertLatex(type)}
                        className={`w-full rounded-lg border px-3 py-2 text-xs font-semibold hover:opacity-90 disabled:opacity-50 text-left ${
                          type === "question"
                            ? "border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                            : "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                        }`}>
                        {convertingLatex === type ? "Converting\u2026" : convertLabel}
                      </button>
                    )}
                    {convertLatexError && convertingLatex === null && (
                      <p className="text-xs text-red-600 font-semibold">{convertLatexError}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}

      {!driveConnected && questionImages.length === 0 && msImages.length === 0 && (
        <p className="text-xs text-gray-400 italic">Connect Google Drive to extract images from question documents.</p>
      )}

      {/* Lightbox */}
      {currentLightboxImage && createPortal(
        <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/85" onClick={closeLightbox}>
          <button type="button" onClick={(e) => { e.stopPropagation(); prevImage(); }} disabled={lightboxIndex === 0}
            className="absolute left-4 top-1/2 -translate-y-1/2 z-10 rounded-full bg-white/20 hover:bg-white/40 disabled:opacity-20 disabled:cursor-not-allowed text-white w-14 h-14 flex items-center justify-center text-3xl font-bold transition-all shadow-xl border border-white/30"
            title="Previous (\u2190)">\u2039</button>

          <div className="relative flex flex-col items-center" style={{ maxWidth: "88vw", maxHeight: "90vh" }} onClick={(e) => e.stopPropagation()}>
            <img
              src={currentLightboxImage.url ?? (currentLightboxImage.storage_path.startsWith("http") ? currentLightboxImage.storage_path : undefined)}
              alt={currentLightboxImage.alt_text ?? "Enlarged image"}
              style={{ maxWidth: "88vw", maxHeight: "82vh", objectFit: "contain" }}
              className="rounded-lg shadow-2xl bg-white"
            />
            <div className="mt-3 flex items-center gap-4 bg-black/60 rounded-full px-5 py-2 text-white text-sm font-semibold">
              <span>{currentLightboxImage.section === "question" ? "\ud83d\udcc4 Question" : "\ud83d\udcdd Markscheme"}</span>
              <span className="text-white/50">\u00b7</span>
              <span>{(lightboxIndex ?? 0) + 1} / {allImages.length}</span>
              <span className="text-white/50">\u00b7</span>
              <span className="text-white/70 text-xs">\u2190 \u2192 to navigate \u00b7 Esc to close</span>
            </div>
            {allImages.length > 1 && (
              <div className="mt-2 flex gap-1.5">
                {allImages.map((_, i) => (
                  <button key={i} type="button" onClick={(e) => { e.stopPropagation(); setLightboxIndex(i); }}
                    className={`rounded-full transition-all ${i === lightboxIndex ? "w-4 h-2.5 bg-white" : "w-2.5 h-2.5 bg-white/40 hover:bg-white/70"}`}
                    title={`Image ${i + 1}`} />
                ))}
              </div>
            )}
          </div>

          <button type="button" onClick={(e) => { e.stopPropagation(); nextImage(); }} disabled={lightboxIndex === allImages.length - 1}
            className="absolute right-4 top-1/2 -translate-y-1/2 z-10 rounded-full bg-white/20 hover:bg-white/40 disabled:opacity-20 disabled:cursor-not-allowed text-white w-14 h-14 flex items-center justify-center text-3xl font-bold transition-all shadow-xl border border-white/30"
            title="Next (\u2192)">\u203a</button>
        </div>,
        document.body
      )}
    </div>
  );
}
