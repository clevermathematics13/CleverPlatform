"use client";

import { useState } from "react";
import type { QuestionImage } from "./types";

export function ImageGroup({
  label,
  labelColor,
  questionId,
  imageType,
  images,
  deletingImageIds,
  uploading,
  onDelete,
  onReorder,
  onUpload,
  onSaveAsGraphImage,
  savingAsGraphImageIds,
}: {
  label: string;
  labelColor: "blue" | "green";
  questionId: string;
  imageType: "question" | "markscheme";
  images: QuestionImage[];
  deletingImageIds: Set<string>;
  uploading: boolean;
  onDelete: (imageId: string) => void;
  onReorder: (orderedIds: string[]) => void;
  onUpload: (file: File) => void;
  onSaveAsGraphImage?: (img: QuestionImage) => void;
  savingAsGraphImageIds?: Set<string>;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const borderColor = labelColor === "blue" ? "border-blue-200" : "border-green-200";
  const hoverBorderColor = labelColor === "blue" ? "hover:border-blue-500" : "hover:border-green-500";
  const labelClass = labelColor === "blue"
    ? "text-xs font-semibold text-blue-800 mb-1"
    : "text-xs font-semibold text-green-800 mb-1";

  const handlePaste = (e: React.ClipboardEvent) => {
    e.stopPropagation();
    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find((item) => item.type.startsWith("image/"));
    if (imageItem) {
      const file = imageItem.getAsFile();
      if (file) onUpload(file);
    }
  };

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    // Try to read image from clipboard API on click
    if (navigator.clipboard && "read" in navigator.clipboard) {
      try {
        const items = await navigator.clipboard.read();
        for (const clipItem of items) {
          const imageType = clipItem.types.find((t) => t.startsWith("image/"));
          if (imageType) {
            const blob = await clipItem.getType(imageType);
            const ext = imageType.split("/")[1] ?? "png";
            const file = new File([blob], `pasted-image.${ext}`, { type: imageType });
            onUpload(file);
            return;
          }
        }
      } catch {
        // Permission denied or no image — fall through to focus so Ctrl+V works
      }
    }
    (e.currentTarget as HTMLDivElement).focus();
  };

  const moveImage = (from: number, to: number) => {
    const newOrder = [...images];
    const [moved] = newOrder.splice(from, 1);
    newOrder.splice(to, 0, moved);
    onReorder(newOrder.map((i) => i.id));
  };

  // Suppress unused variable warning - questionId and imageType are passed for
  // potential future use (e.g. analytics, accessibility labels)
  void questionId;
  void imageType;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <p className={labelClass}>{label}</p>
        {uploading && (
          <span className="text-xs text-gray-400 italic">Uploading…</span>
        )}
      </div>

      <div
        tabIndex={0}
        className={`rounded-lg border-2 border-dashed p-2 min-h-[60px] transition-colors outline-none focus:ring-2 cursor-pointer ${
          labelColor === "blue"
            ? "border-blue-200 bg-blue-50/30 focus:ring-blue-400"
            : "border-green-200 bg-green-50/30 focus:ring-green-400"
        }`}
        onPaste={handlePaste}
        onClick={handleClick}
      >
        {images.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-2">
            📋 Click to paste image from clipboard
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {images.map((img, idx) => (
              <div
                key={img.id}
                className="relative group w-full"
              >
                {/* Up arrow (top-left) — hidden for first image */}
                {idx > 0 && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); moveImage(idx, idx - 1); }}
                    className="absolute top-1 left-1 z-10 opacity-0 group-hover:opacity-100 inline-flex h-5 w-5 items-center justify-center rounded bg-black/50 text-white text-xs hover:bg-black/70 transition-opacity"
                    title="Move up"
                  >
                    ↑
                  </button>
                )}

                {/* Down arrow (bottom-left) — hidden for last image */}
                {idx < images.length - 1 && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); moveImage(idx, idx + 1); }}
                    className="absolute bottom-1 left-1 z-10 opacity-0 group-hover:opacity-100 inline-flex h-5 w-5 items-center justify-center rounded bg-black/50 text-white text-xs hover:bg-black/70 transition-opacity"
                    title="Move down"
                  >
                    ↓
                  </button>
                )}

                {/* Image */}
                <a
                  href={img.url ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="block w-full"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url ?? ""}
                    alt={img.alt_text ?? `${label} image ${idx + 1}`}
                    className={`w-full rounded border bg-white p-1 ${borderColor} ${hoverBorderColor} hover:shadow-md transition-all ${
                      deletingImageIds.has(img.id) ? "opacity-40" : ""
                    }`}
                    draggable={false}
                  />
                </a>

                {/* Download button (bottom-right) */}
                <a
                  href={img.url ?? "#"}
                  download
                  onClick={(e) => e.stopPropagation()}
                  className={`absolute bottom-1 z-10 inline-flex h-5 w-5 items-center justify-center rounded bg-white/95 text-[11px] text-gray-700 shadow-sm ring-1 ring-gray-300 hover:bg-white opacity-0 group-hover:opacity-100 transition-opacity ${onSaveAsGraphImage ? "right-7" : "right-1"}`}
                  title="Download image"
                >
                  🖼
                </a>

                {/* Save as graph image button (bottom-right) */}
                {onSaveAsGraphImage && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onSaveAsGraphImage(img); }}
                    disabled={savingAsGraphImageIds?.has(img.id)}
                    className="absolute bottom-1 right-1 z-10 opacity-0 group-hover:opacity-100 inline-flex h-5 w-5 items-center justify-center rounded bg-violet-600/90 text-[11px] text-white shadow-sm hover:bg-violet-700 disabled:opacity-50 transition-opacity"
                    title="Save as graph image"
                  >
                    {savingAsGraphImageIds?.has(img.id) ? "…" : "📊"}
                  </button>
                )}

                {/* Delete button (top-right) */}
                {confirmingDelete === img.id ? (
                  <div
                    className="absolute inset-0 flex flex-col items-center justify-center bg-red-900/80 rounded gap-1 z-20"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="text-white text-xs font-bold">Delete?</span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        disabled={deletingImageIds.has(img.id)}
                        onClick={() => { onDelete(img.id); setConfirmingDelete(null); }}
                        className="rounded bg-red-500 text-white text-xs font-bold px-2 py-0.5 hover:bg-red-400 disabled:opacity-50"
                      >
                        {deletingImageIds.has(img.id) ? "…" : "Yes"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingDelete(null)}
                        className="rounded bg-gray-200 text-gray-800 text-xs font-bold px-2 py-0.5 hover:bg-gray-300"
                      >
                        No
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); setConfirmingDelete(img.id); }}
                    className="absolute top-1 right-1 z-10 opacity-0 group-hover:opacity-100 rounded-full w-5 h-5 flex items-center justify-center bg-red-600 text-white text-xs font-bold hover:bg-red-500 transition-opacity"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Always show paste hint below images if there are some */}
        {images.length > 0 && (
          <p className="text-xs text-gray-400 mt-1 text-center">
            📋 Paste an image to add
          </p>
        )}
      </div>
    </div>
  );
}
