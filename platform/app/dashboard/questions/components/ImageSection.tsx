"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import LatexRenderer from "@/components/LatexRenderer";
import type { Question, QuestionImage } from "./types";

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

type LatexEntry = { label: string | null; latex: string };

// Height of each independently-scrolling panel column.
// The outer modal scrolls to reach this section; once here each column scrolls on its own.
const PANEL_H = "70vh";

export function ImageSection({
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
  const [activeTab, setActiveTab] = useState<"question" | "markscheme">("question");
  const [dragOverImageId, setDragOverImageId] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const qFileRef = useRef<HTMLInputElement>(null);
  const msFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (msImages.length > 0 && questionImages.length === 0) setActiveTab("markscheme");
  }, [msImages.length, questionImages.length]);

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

  const groups = [
    {
      label: "Question", type: "question" as const, imgs: questionImages, latex: questionLatex, fileRef: qFileRef,
      accentBorder: "border-indigo-200", accentHeader: "bg-indigo-50 border-b border-indigo-200",
      accentText: "text-indigo-700", convertLabel: "Convert question images to LaTeX",
      tabActive: "bg-indigo-600 text-white", tabInactive: "text-indigo-600 hover:bg-indigo-50",
    },
    {
      label: "Markscheme", type: "markscheme" as const, imgs: msImages, latex: msLatex, fileRef: msFileRef,
      accentBorder: "border-emerald-200", accentHeader: "bg-emerald-50 border-b border-emerald-200",
      accentText: "text-emerald-700", convertLabel: "Convert markscheme images to LaTeX",
      tabActive: "bg-emerald-600 text-white", tabInactive: "text-emerald-600 hover:bg-emerald-50",
    },
  ];

  const active = groups.find((g) => g.type === activeTab)!;
  const { label, type, imgs, latex, fileRef, accentBorder, accentHeader, accentText, convertLabel } = active;

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs font-bold text-gray-700">Images</p>
        <div className="flex items-center gap-2 flex-wrap">
          {driveConnected && (
            <button type="button" onClick={onExtractImages} disabled={extracting}
              className="rounded border border-blue-300 bg-white px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50">
              {extracting ? "Extracting…" : "↻ Extract from Docs"}
            </button>
          )}
          {hasTroubleshooting && (
            <button type="button" onClick={onCopyTroubleshooting}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">
              {troubleshootingCopied ? "✓ Copied" : "Copy Report"}
            </button>
          )}
          {(questionImages.length > 0 || msImages.length > 0) && (
            <button type="button" onClick={onDeleteAllImages}
              className="rounded border border-red-300 bg-white px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50">
              🗑 Delete All
            </button>
          )}
        </div>
      </div>

      {/* Tabs + upload button */}
      <div className="flex items-center gap-1 border-b border-gray-200">
        {groups.map((g) => (
          <button
            key={g.type}
            type="button"
            onClick={() => setActiveTab(g.type)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-t-md border border-b-0 transition-colors ${
              activeTab === g.type
                ? g.tabActive + " border-gray-200 -mb-px"
                : g.tabInactive + " border-transparent"
            }`}
          >
            {g.type === "question" ? "📄" : "📝"} {g.label}
            {g.imgs.length > 0 && (
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                activeTab === g.type ? "bg-white/30" : g.type === "question" ? "bg-indigo-100 text-indigo-700" : "bg-emerald-100 text-emerald-700"
              }`}>
                {g.imgs.length}
              </span>
            )}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1.5 pb-1">
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) { onUploadImage(type, f); e.target.value = ""; } }} />
          <button type="button" disabled={uploadingImage}
            title="Paste clipboard image, or click to choose a file"
            onClick={() => handleSmartUpload(type, fileRef)}
            className="rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
            {uploadingImage ? "Uploading…" : "📋 Upload"}
          </button>
        </div>
      </div>

      {/* Panel: both columns independently scrollable at PANEL_H */}
      <div className="flex gap-3" style={{ height: PANEL_H }}>

        {/* Image column — scrolls independently */}
        <div className="overflow-y-auto flex flex-col gap-3 min-w-0" style={{ width: "50%" }}>
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
              <img src={img.url ?? (img.storage_path.startsWith("http") ? img.storage_path : undefined)}
                alt={`${label} ${img.sort_order + 1}`} className="block max-w-full w-full h-auto" />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-all flex items-center justify-center pointer-events-none">
                <span className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 text-white text-sm font-semibold px-3 py-1.5 rounded-full">
                  🔍 Click to enlarge
                </span>
              </div>
              <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button type="button" onClick={() => onDeleteImage(img.id)} disabled={deletingImageIds.has(img.id)}
                  className="rounded-full bg-red-600 text-white w-8 h-8 text-sm font-bold flex items-center justify-center hover:bg-red-700 disabled:opacity-50 shadow-lg">
                  {deletingImageIds.has(img.id) ? "…" : "×"}
                </button>
              </div>
              <div className="absolute bottom-2 left-2 bg-black/60 rounded-full px-2.5 py-1 text-xs text-white font-semibold shadow">
                {img.sort_order + 1} of {imgs.length}
              </div>
            </div>
          )) : (
            <div className={`flex flex-col items-center justify-center h-full rounded-xl border-2 border-dashed ${
              type === "markscheme" ? "border-emerald-200 bg-emerald-50/40" : "border-indigo-200 bg-indigo-50/40"
            }`}>
              <span className="text-2xl mb-2">{type === "markscheme" ? "📝" : "📄"}</span>
              <p className="text-xs text-gray-400 font-medium text-center px-3">No {label.toLowerCase()} images yet</p>
              {driveConnected && <p className="text-[10px] text-gray-400 mt-1 text-center px-3">Use "Extract from Docs" or "Upload"</p>}
            </div>
          )}
        </div>

        {/* LaTeX column — scrolls independently, sticky header */}
        <div className={`overflow-y-auto rounded-xl border ${accentBorder} bg-white shadow-sm flex-1 min-w-0`}>
          <div className={`sticky top-0 z-10 ${accentHeader} px-3 py-2`}>
            <span className={`text-[11px] font-bold ${accentText} tracking-wide uppercase`}>{label} LaTeX</span>
          </div>
          {latex.length > 0 ? (
            <div className="divide-y divide-gray-100">
              {latex.map(({ label: partLabel, latex: tex }, i) => (
                <div key={i} className="px-3 py-2.5 space-y-1">
                  {partLabel && (
                    <span className={`inline-block text-[10px] font-bold font-mono ${accentText} bg-opacity-10 rounded px-1.5 py-0.5 bg-current`}
                      style={{ opacity: 1 }}>
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
              <p className="text-xs text-gray-500 leading-snug">No LaTeX stored. Convert the image to extract it.</p>
              {imgs.length > 0 && (
                <button type="button" disabled={convertingLatex !== null}
                  onClick={() => onConvertLatex(type)}
                  className={`w-full rounded-lg border px-3 py-2 text-xs font-semibold hover:opacity-90 disabled:opacity-50 text-left ${
                    type === "question"
                      ? "border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                      : "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                  }`}>
                  {convertingLatex === type ? "Converting…" : convertLabel}
                </button>
              )}
              {convertLatexError && convertingLatex === null && (
                <p className="text-xs text-red-600 font-semibold">{convertLatexError}</p>
              )}
            </div>
          )}
        </div>

      </div>

      {!driveConnected && questionImages.length === 0 && msImages.length === 0 && (
        <p className="text-xs text-gray-400 italic">Connect Google Drive to extract images from question documents.</p>
      )}

      {currentLightboxImage && createPortal(
        <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/85" onClick={closeLightbox}>
          <button type="button" onClick={(e) => { e.stopPropagation(); prevImage(); }} disabled={lightboxIndex === 0}
            className="absolute left-4 top-1/2 -translate-y-1/2 z-10 rounded-full bg-white/20 hover:bg-white/40 disabled:opacity-20 disabled:cursor-not-allowed text-white w-14 h-14 flex items-center justify-center text-3xl font-bold transition-all shadow-xl border border-white/30"
            title="Previous (←)">‹</button>
          <div className="relative flex flex-col items-center" style={{ maxWidth: "88vw", maxHeight: "90vh" }}
            onClick={(e) => e.stopPropagation()}>
            <img
              src={currentLightboxImage.url ?? (currentLightboxImage.storage_path.startsWith("http") ? currentLightboxImage.storage_path : undefined)}
              alt={currentLightboxImage.alt_text ?? "Enlarged image"}
              style={{ maxWidth: "88vw", maxHeight: "82vh", objectFit: "contain" }}
              className="rounded-lg shadow-2xl bg-white"
            />
            <div className="mt-3 flex items-center gap-4 bg-black/60 rounded-full px-5 py-2 text-white text-sm font-semibold">
              <span>{currentLightboxImage.section === "question" ? "📄 Question" : "📝 Markscheme"}</span>
              <span className="text-white/50">·</span>
              <span>{(lightboxIndex ?? 0) + 1} / {allImages.length}</span>
              <span className="text-white/50">·</span>
              <span className="text-white/70 text-xs">← → to navigate · Esc to close</span>
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
            title="Next (→)">›</button>
        </div>,
        document.body
      )}
    </div>
  );
}
