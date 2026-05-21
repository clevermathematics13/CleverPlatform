"use client";

import { useRef, useState } from "react";
import {
  type AssignmentDraft,
  type ClaudeResponse,
  type FormattingRequirements,
  buildActivityGeneratorSystemPrompt,
  extractJsonObject,
  sanitizeDraft,
} from "@/lib/assignments";

// ── Types ─────────────────────────────────────────────────────────────────────

type PendingImage = { base64: string; mimeType: string; previewUrl: string; name: string };

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  draftTitle?: string; // short label shown in history for assistant turns
  imageCount?: number; // number of images attached to this user message
};

type SaveStatus = "idle" | "saving" | "saved" | "error";

type Props = {
  gradeLevel: "Grade 9" | "Grade 10" | "Grade 11" | "Grade 12";
  formatting: FormattingRequirements;
  onDraftGenerated: (draft: AssignmentDraft) => void;
};

// ── Component ─────────────────────────────────────────────────────────────────

export function ActivityGeneratorPanel({ gradeLevel, formatting, onDraftGenerated }: Props) {
  const [description, setDescription] = useState("");
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastDraft, setLastDraft] = useState<AssignmentDraft | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [isExpanded, setIsExpanded] = useState(true);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const historyRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Image handling ─────────────────────────────────────────────────────────

  function addImageFile(file: File) {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1];
      setPendingImages((prev) => [
        ...prev,
        { base64, mimeType: file.type, previewUrl: dataUrl, name: file.name || "image" },
      ]);
    };
    reader.readAsDataURL(file);
  }

  function handlePaste(e: React.ClipboardEvent) {
    const imageItems = Array.from(e.clipboardData.items).filter((item) =>
      item.type.startsWith("image/")
    );
    if (imageItems.length === 0) return;
    e.preventDefault();
    imageItems.forEach((item) => {
      const file = item.getAsFile();
      if (file) addImageFile(file);
    });
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    Array.from(e.target.files ?? []).forEach(addImageFile);
    e.target.value = "";
  }

  function removeImage(idx: number) {
    setPendingImages((prev) => prev.filter((_, i) => i !== idx));
  }

  // ── Generate / Refine ──────────────────────────────────────────────────────

  async function handleGenerate() {
    const userText = description.trim();
    if ((!userText && pendingImages.length === 0) || isGenerating) return;

    setIsGenerating(true);
    setError(null);
    setSaveStatus("idle");
    const snapshotImages = [...pendingImages];
    setPendingImages([]);

    // Optimistically add user message to history
    const nextHistory: ChatMessage[] = [
      ...history,
      { role: "user", content: userText, imageCount: snapshotImages.length || undefined },
    ];
    setHistory(nextHistory);
    setDescription("");

    // Build messages for Claude: send full conversation so it can refine prior drafts
    const apiMessages = nextHistory.map((m) => {
      // Attach images to this user turn
      if (m === nextHistory[nextHistory.length - 1] && snapshotImages.length > 0) {
        return {
          role: m.role,
          content: [
            ...snapshotImages.map((img) => ({
              type: "image" as const,
              source: { type: "base64" as const, media_type: img.mimeType, data: img.base64 },
            })),
            ...(userText ? [{ type: "text" as const, text: userText }] : []),
          ],
        };
      }
      return { role: m.role, content: m.content };
    });

    try {
      const res = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: buildActivityGeneratorSystemPrompt(gradeLevel),
          messages: apiMessages,
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `Generation failed (${res.status})`);
      }

      const data = (await res.json()) as ClaudeResponse;
      const rawText = data.content?.find((b) => b.type === "text")?.text ?? "";
      const json = extractJsonObject(rawText);
      const parsed = JSON.parse(json) as AssignmentDraft;
      const sanitized = sanitizeDraft(parsed);

      setLastDraft(sanitized);
      onDraftGenerated(sanitized);

      // Store full raw JSON as assistant message so Claude can refine it in follow-ups
      setHistory([
        ...nextHistory,
        { role: "assistant", content: rawText, draftTitle: sanitized.title },
      ]);

      // Scroll history to bottom
      setTimeout(() => {
        if (historyRef.current) {
          historyRef.current.scrollTop = historyRef.current.scrollHeight;
        }
      }, 50);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unexpected error";
      setError(msg);
      // Revert last user message on failure
      setHistory(history);
      setDescription(userText);
      setPendingImages(snapshotImages);
    } finally {
      setIsGenerating(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleGenerate();
    }
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!lastDraft || saveStatus === "saving") return;
    setSaveStatus("saving");

    const allUserPrompts = history
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join(" → ");

    try {
      const res = await fetch("/api/assignments/templates/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateName: lastDraft.title,
          gradeLevel,
          documentKind: "activity-generator",
          formattingRequirements: formatting,
          assignmentInput: {
            description: allUserPrompts,
            draft: lastDraft,
          },
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Save failed");
      }

      setSaveStatus("saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setSaveStatus("error");
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const hasHistory = history.length > 0;
  const isRefinement = hasHistory;

  return (
    <div className="rounded-xl border-2 border-indigo-500/50 bg-gradient-to-b from-indigo-950/50 to-da-bg/20 shadow-lg shadow-indigo-950/20">
      {/* Header */}
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left"
      >
        <span className="text-base" aria-hidden>⚡</span>
        <span className="text-sm font-bold text-indigo-300 uppercase tracking-wider">
          AI Activity Generator
        </span>
        <span className="ml-1 rounded-full border border-indigo-500/40 bg-indigo-500/20 px-2 py-0.5 text-[10px] font-semibold text-indigo-300">
          Claude
        </span>
        {lastDraft && (
          <span className="ml-1 rounded-full border border-green-500/40 bg-green-500/10 px-2 py-0.5 text-[10px] text-green-300">
            ✓ active
          </span>
        )}
        <span className="ml-auto text-xs text-da-muted/60">
          {isExpanded ? "▲" : "▼"}
        </span>
      </button>

      {isExpanded && (
        <div className="space-y-3 border-t border-indigo-500/20 px-4 pb-4 pt-3">
          {/* Description */}
          {!hasHistory && (
            <p className="text-xs text-da-muted leading-relaxed">
              Describe any mathematics activity in plain English. Claude generates a complete,
              mark-schemed, CCSS-tagged activity sheet instantly — bypassing the form below.
              Type again to refine iteratively.
            </p>
          )}

          {/* Conversation history */}
          {hasHistory && (
            <div
              ref={historyRef}
              className="max-h-36 overflow-y-auto rounded-lg border border-indigo-500/20 bg-da-bg/40 p-2.5 space-y-1.5"
            >
              {history.map((msg, i) =>
                msg.role === "user" ? (
                  <div key={i} className="flex items-start gap-2 text-xs text-da-text/90">
                    <span className="mt-0.5 shrink-0 text-indigo-400 font-bold">▶</span>
                    <span className="line-clamp-2">
                      {msg.content}
                      {msg.imageCount ? (
                        <span className="ml-1 text-indigo-400">[+{msg.imageCount} image{msg.imageCount > 1 ? "s" : ""}]</span>
                      ) : null}
                    </span>
                  </div>
                ) : (
                  <div key={i} className="flex items-start gap-2 text-xs text-indigo-300">
                    <span className="mt-0.5 shrink-0 text-green-400 font-bold">✓</span>
                    <span className="italic">
                      Generated: &ldquo;{msg.draftTitle}&rdquo;
                    </span>
                  </div>
                ),
              )}
              {isGenerating && (
                <div className="flex items-center gap-2 text-xs text-indigo-400/70 italic">
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                  Thinking...
                </div>
              )}
            </div>
          )}

          {/* Input area */}
          <div className="space-y-2">
            {/* Pending image thumbnails */}
            {pendingImages.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {pendingImages.map((img, i) => (
                  <div key={i} className="relative group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.previewUrl}
                      alt={img.name}
                      className="h-16 w-16 rounded-md object-cover border border-indigo-500/40"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(i)}
                      className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-red-500 text-white text-[10px] leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="relative">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={
                  isRefinement
                    ? "Describe what to change or add… (Ctrl+Enter to refine)"
                    : 'e.g. "A Grade 9 activity on solving two-step linear equations with 10 questions, two real-world word problems, one error-analysis question, increasing difficulty, exam tone."'
                }
                rows={isRefinement ? 2 : 3}
                disabled={isGenerating}
                className="w-full resize-none rounded-md border border-indigo-500/30 bg-da-bg/50 px-3 py-2.5 pr-10 text-sm text-da-text placeholder-da-muted/50 focus:border-indigo-400/60 focus:outline-none disabled:opacity-50"
              />
              {/* Attach image button */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isGenerating}
                title="Attach image (or paste a screenshot)"
                className="absolute bottom-2 right-2 text-indigo-400/60 hover:text-indigo-300 transition-colors disabled:opacity-40"
              >
                📎
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFileChange}
              />
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={isGenerating || (!description.trim() && pendingImages.length === 0)}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-indigo-500/60 bg-indigo-600/30 px-4 py-2 text-sm font-semibold text-indigo-200 transition-colors hover:bg-indigo-600/40 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isGenerating ? (
                  <>
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                    Generating…
                  </>
                ) : isRefinement ? (
                  "↺ Refine Activity"
                ) : (
                  "⚡ Generate Activity"
                )}
              </button>

              {lastDraft && (
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saveStatus === "saving" || saveStatus === "saved"}
                  className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                    saveStatus === "saved"
                      ? "border-green-500/50 bg-green-500/20 text-green-300"
                      : "border-da-border/60 bg-da-bg/30 text-da-text hover:bg-da-hover"
                  }`}
                >
                  {saveStatus === "saving"
                    ? "Saving…"
                    : saveStatus === "saved"
                      ? "✓ Saved"
                      : "Save Activity"}
                </button>
              )}

              {hasHistory && (
                <button
                  type="button"
                  onClick={() => {
                    setHistory([]);
                    setLastDraft(null);
                    setSaveStatus("idle");
                    setError(null);
                  }}
                  className="rounded-lg border border-da-border/40 px-3 py-2 text-xs text-da-muted hover:text-da-text transition-colors"
                  title="Start over"
                >
                  ✕ Reset
                </button>
              )}
            </div>
          </div>

          {/* Error */}
          {error && (
            <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}

          {/* Feature hints */}
          {!hasHistory && (
            <div className="flex flex-wrap gap-1.5">
              {[
                "Marks auto-assigned",
                "CCSS standards tagged",
                "Answer key generated",
                "Iterative refinement",
              ].map((hint) => (
                <span
                  key={hint}
                  className="rounded-full border border-indigo-500/20 bg-indigo-500/10 px-2 py-0.5 text-[10px] text-indigo-400/80"
                >
                  {hint}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
