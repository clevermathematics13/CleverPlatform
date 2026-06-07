"use client";

import { useEffect, useRef, useState } from "react";
import {
  type AssignmentDraft,
  type ClaudeResponse,
  type FormattingRequirements,
  buildActivityGeneratorSystemPrompt,
  extractJsonObject,
  sanitizeDraft,
} from "@/lib/assignments";

// ── Types ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

type ImageMimeType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";
type PendingImage = { base64: string; mimeType: ImageMimeType; previewUrl: string; name: string };
type PendingPdf = { base64: string; name: string };

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  draftTitle?: string;
  imageCount?: number;
};

type SaveStatus = "idle" | "saving" | "saved" | "error";
type DriveConnectionStatus = "checking" | "connected" | "disconnected";
type DriveImportStatus = "idle" | "fetching" | "picking" | "done" | "error";

type Props = {
  gradeLevel: "Grade 9" | "Grade 10" | "Grade 11" | "Grade 12";
  formatting: FormattingRequirements;
  onDraftGenerated: (draft: AssignmentDraft) => void;
};

// ── Component ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function ActivityGeneratorPanel({ gradeLevel, formatting, onDraftGenerated }: Props) {
  const [description, setDescription] = useState("");
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastDraft, setLastDraft] = useState<AssignmentDraft | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [isExpanded, setIsExpanded] = useState(true);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [pendingPdfs, setPendingPdfs] = useState<PendingPdf[]>([]);
  const historyRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pickerLoadingRef = useRef(false);

  // ── Google Drive connection state ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

  const [driveStatus, setDriveStatus] = useState<DriveConnectionStatus>("checking");
  const [showDriveInput, setShowDriveInput] = useState(false);
  const [driveUrl, setDriveUrl] = useState("");
  const [driveImportStatus, setDriveImportStatus] = useState<DriveImportStatus>("idle");
  const [driveImportError, setDriveImportError] = useState<string | null>(null);

  // Check Drive connection on mount, and whenever the tab regains focus
  // (so connecting in another tab is reflected automatically).
  useEffect(() => {
    async function checkDrive() {
      try {
        const res = await fetch("/api/assignments/drive-status");
        if (res.ok) {
          const data = (await res.json()) as { connected: boolean };
          setDriveStatus(data.connected ? "connected" : "disconnected");
        } else {
          setDriveStatus("disconnected");
        }
      } catch {
        setDriveStatus("disconnected");
      }
    }

    void checkDrive();

    // Re-check when the user returns to this tab after OAuth redirect
    const onFocus = () => void checkDrive();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  function handleConnectDrive() {
    // Opens the OAuth flow in the same tab; on return the focus listener
    // above will re-check and flip the status to connected.
    window.location.href = "/api/questions/connect-drive";
  }

  // ── Google Picker (file browser) ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

  async function openGooglePicker() {
    // Prevent double-loading
    if (pickerLoadingRef.current) return;
    pickerLoadingRef.current = true;
    setDriveImportStatus("picking");
    setDriveImportError(null);

    try {
      // Get the Google access token from our secure endpoint
      const tokenRes = await fetch("/api/assignments/google-picker-token");
      if (!tokenRes.ok) {
        throw new Error("Failed to get authentication token");
      }
      const { token } = (await tokenRes.json()) as { token: string };

      // Load the standard gapi loader if not already present.
      // NOTE: "picker-api.js" is not a real Google URL. The correct approach is
      // to load api.js (the gapi loader) then call gapi.load("picker", ...).
      if (!(window as any).gapi) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://apis.google.com/js/api.js";
          script.async = true;
          script.onerror = () => reject(new Error("Failed to load Google API"));
          script.onload = () => resolve();
          document.head.appendChild(script);
        });
      }

      // Load the picker module via gapi if not already present
      if (!(window as any).gapi?.picker) {
        await new Promise<void>((resolve, reject) => {
          (window as any).gapi.load("picker", {
            callback: () => resolve(),
            onerror: () => reject(new Error("Failed to load Picker module")),
            timeout: 10000,
            ontimeout: () => reject(new Error("Picker load timed out")),
          });
        });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gapi = (window as any).gapi;
      if (!gapi?.picker) {
        throw new Error("Google Picker API not available after loading");
      }

      // ViewId.PDFS does not exist — use DocsView with a MIME type filter instead
      const docsView = new gapi.picker.DocsView(gapi.picker.ViewId.DOCS);
      docsView.setMimeTypes("application/pdf,image/jpeg,image/png,image/gif,image/webp");

      const picker = new gapi.picker.PickerBuilder()
        .addView(docsView)
        .setOAuthToken(token)
        .setLocale("en")
        .setCallback((data: any) => {
          pickerLoadingRef.current = false;
          if (data.action === "cancel") {
            setDriveImportStatus("idle");
            return;
          }
          if (data.action === "picked" && data.docs && data.docs.length > 0) {
            setDriveImportStatus("fetching");
            setDriveImportError(null);
            // Import the first selected file
            const doc = data.docs[0];
            void importDriveFile(doc.id);
          }
        })
        .build();

      picker.setVisible(true);
    } catch (err) {
      pickerLoadingRef.current = false;
      const msg = err instanceof Error ? err.message : "Failed to open file picker";
      setDriveImportError(msg);
      setDriveImportStatus("idle");
    }
  }

  async function importDriveFile(fileId: string) {
    try {
      const res = await fetch("/api/assignments/fetch-drive-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId }),
      });

      const data = (await res.json()) as {
        base64?: string;
        name?: string;
        sizeMb?: number;
        error?: string;
      };

      if (!res.ok || !data.base64) {
        throw new Error(data.error ?? `Drive fetch failed (${res.status})`);
      }

      setPendingPdfs((prev) => [
        ...prev,
        { base64: data.base64!, name: data.name ?? "document.pdf" },
      ]);

      setDriveImportStatus("done");
      setDriveUrl("");
      setShowDriveInput(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Drive import failed";
      setDriveImportError(msg);
      setDriveImportStatus("error");
    }
  }

  // ── Google Drive PDF import (URL fallback) ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

  async function handleDriveImport() {
    const input = driveUrl.trim();
    if (!input) return;

    setDriveImportStatus("fetching");
    setDriveImportError(null);
    await importDriveFile(input);
  }

  // ── Local file handling ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

  function addImageFile(file: File) {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1]!;
      setPendingImages((prev) => [
        ...prev,
        { base64, mimeType: file.type as ImageMimeType, previewUrl: dataUrl, name: file.name || "image" },
      ]);
    };
    reader.readAsDataURL(file);
  }

  function addPdfFile(file: File) {
    if (file.type !== "application/pdf") return;
    if (file.size > 3 * 1024 * 1024) {
      setError(
        `PDF "${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB — too large for direct upload. Use Google Drive import instead.`
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1]!;
      setPendingPdfs((prev) => [...prev, { base64, name: file.name || "document.pdf" }]);
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
    Array.from(e.target.files ?? []).forEach((file) => {
      if (file.type === "application/pdf") addPdfFile(file);
      else addImageFile(file);
    });
    e.target.value = "";
  }

  function removeImage(idx: number) {
    setPendingImages((prev) => prev.filter((_, i) => i !== idx));
  }

  // ── Generate / Refine ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

  async function handleGenerate() {
    const userText = description.trim();
    if ((!userText && pendingImages.length === 0 && pendingPdfs.length === 0) || isGenerating) return;

    setIsGenerating(true);
    setError(null);
    setSaveStatus("idle");
    const snapshotImages = [...pendingImages];
    const snapshotPdfs = [...pendingPdfs];
    setPendingImages([]);
    setPendingPdfs([]);

    const attachmentCount = snapshotImages.length + snapshotPdfs.length;

    const nextHistory: ChatMessage[] = [
      ...history,
      { role: "user", content: userText, imageCount: attachmentCount || undefined },
    ];
    setHistory(nextHistory);
    setDescription("");

    const apiMessages = nextHistory.map((m) => {
      if (m === nextHistory[nextHistory.length - 1] && (snapshotImages.length > 0 || snapshotPdfs.length > 0)) {
        return {
          role: m.role,
          content: [
            ...snapshotPdfs.map((pdf) => ({
              type: "document" as const,
              source: { type: "base64" as const, media_type: "application/pdf" as const, data: pdf.base64 },
            })),
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
        let errorMsg = `Generation failed (${res.status})`;
        try {
          const data = (await res.json()) as { error?: string };
          errorMsg = data.error ?? errorMsg;
        } catch {
          const text = await res.text().catch(() => "");
          if (text) errorMsg = text;
        }
        throw new Error(errorMsg);
      }

      const data = (await res.json()) as ClaudeResponse;
      const rawText = data.content?.find((b) => b.type === "text")?.text ?? "";
      const json = extractJsonObject(rawText);
      const parsed = JSON.parse(json) as AssignmentDraft;
      const sanitized = sanitizeDraft(parsed);

      setLastDraft(sanitized);
      onDraftGenerated(sanitized);

      setHistory([
        ...nextHistory,
        { role: "assistant", content: rawText, draftTitle: sanitized.title },
      ]);

      setTimeout(() => {
        if (historyRef.current) {
          historyRef.current.scrollTop = historyRef.current.scrollHeight;
        }
      }, 50);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unexpected error";
      setError(msg);
      setHistory(history);
      setDescription(userText);
      setPendingImages(snapshotImages);
      setPendingPdfs(snapshotPdfs);
    } finally {
      setIsGenerating(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleGenerate();
    }
  }

  function handleDriveKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); void handleDriveImport(); }
    if (e.key === "Escape") {
      setShowDriveInput(false);
      setDriveUrl("");
      setDriveImportError(null);
      setDriveImportStatus("idle");
    }
  }

  // ── Save ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!lastDraft || saveStatus === "saving") return;
    setSaveStatus("saving");
    const allUserPrompts = history.filter((m) => m.role === "user").map((m) => m.content).join(" → ");
    try {
      const res = await fetch("/api/assignments/templates/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateName: lastDraft.title,
          gradeLevel,
          documentKind: "activity-generator",
          formattingRequirements: formatting,
          assignmentInput: { description: allUserPrompts, draft: lastDraft },
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

  // ── Render ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

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
        <span className="text-sm font-bold text-indigo-300 uppercase tracking-wider">AI Activity Generator</span>
        <span className="ml-1 rounded-full border border-indigo-500/40 bg-indigo-500/20 px-2 py-0.5 text-[10px] font-semibold text-indigo-300">
          Claude
        </span>
        {lastDraft && (
          <span className="ml-1 rounded-full border border-green-500/40 bg-green-500/10 px-2 py-0.5 text-[10px] text-green-300">
            ✓ active
          </span>
        )}
        <span className="ml-auto text-xs text-da-muted/60">{isExpanded ? "▲" : "▼"}</span>
      </button>

      {isExpanded && (
        <div className="space-y-3 border-t border-indigo-500/20 px-4 pb-4 pt-3">

          {/* ── File upload options (Google Drive + Computer) ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */}
          <div className="space-y-2">
            {driveStatus === "checking" && (
              <div className="flex items-center gap-2 rounded-lg border border-da-border/30 bg-da-bg/30 px-3 py-2">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border border-da-muted border-t-transparent flex-shrink-0" />
                <p className="text-[10px] text-da-muted">Checking Drive connection…</p>
              </div>
            )}

            {driveStatus === "disconnected" && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                <span className="text-base flex-shrink-0">📂</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-amber-300">Connect Google Drive</p>
                  <p className="text-[10px] text-amber-300/70 leading-tight">Import large PDFs directly from Drive with no size limits.</p>
                </div>
                <button
                  type="button"
                  onClick={handleConnectDrive}
                  className="flex-shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-600 transition-colors whitespace-nowrap"
                >
                  Connect
                </button>
              </div>
            )}

            {driveStatus === "connected" && (
              <div className="flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/10 px-3 py-2">
                <span className="text-xs text-green-400">✅</span>
                <p className="flex-1 text-[10px] font-medium text-green-300">Google Drive connected</p>
                <button
                  type="button"
                  onClick={() => void openGooglePicker()}
                  disabled={isGenerating || driveImportStatus === "picking"}
                  className="flex-shrink-0 rounded border border-green-500/30 bg-green-500/10 px-2.5 py-1 text-[10px] font-semibold text-green-300 hover:bg-green-500/20 transition-colors disabled:opacity-40 whitespace-nowrap"
                >
                  {driveImportStatus === "picking" ? "Opening picker…" : "📂 Browse Drive"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (driveStatus !== "connected") return;
                    setShowDriveInput((v) => !v);
                    setDriveImportError(null);
                    setDriveImportStatus("idle");
                  }}
                  disabled={isGenerating}
                  className="flex-shrink-0 rounded border border-green-500/30 bg-green-500/10 px-2 py-1 text-[10px] font-semibold text-green-300 hover:bg-green-500/20 transition-colors disabled:opacity-40 whitespace-nowrap"
                >
                  {showDriveInput ? "Cancel" : "🔗 Paste URL"}
                </button>
              </div>
            )}

            {/* Drive URL input panel */}
            {driveStatus === "connected" && showDriveInput && (
              <div className="rounded-md border border-indigo-500/30 bg-da-bg/50 p-2.5 space-y-1.5">
                <p className="text-[10px] text-da-muted leading-relaxed">
                  Paste a Google Drive file URL or file ID — any size PDF is supported.
                </p>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={driveUrl}
                    onChange={(e) => {
                      setDriveUrl(e.target.value);
                      setDriveImportError(null);
                      setDriveImportStatus("idle");
                    }}
                    onKeyDown={handleDriveKeyDown}
                    placeholder="https://drive.google.com/file/d/…"
                    disabled={driveImportStatus === "fetching"}
                    autoFocus
                    className="flex-1 rounded border border-indigo-500/30 bg-da-bg/60 px-2.5 py-1.5 text-xs text-da-text placeholder-da-muted/50 focus:border-indigo-400/60 focus:outline-none disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => void handleDriveImport()}
                    disabled={!driveUrl.trim() || driveImportStatus === "fetching"}
                    className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors"
                  >
                    {driveImportStatus === "fetching" ? "Fetching…" : "Import"}
                  </button>
                </div>
                {driveImportError && (
                  <p className="text-[10px] text-red-400 leading-relaxed">{driveImportError}</p>
                )}
              </div>
            )}

            {/* Drive picker error (shown below the connected bar) */}
            {driveStatus === "connected" && !showDriveInput && driveImportError && (
              <p className="rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[10px] text-red-400 leading-relaxed">
                {driveImportError}
              </p>
            )}
          </div>

          {/* Upload from Computer button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isGenerating}
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2.5 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/15 transition-colors disabled:opacity-50"
          >
            💻 Upload from Computer
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            className="hidden"
            onChange={handleFileChange}
          />
          <p className="text-[10px] text-da-muted/60 text-center">Images or PDFs up to 3 MB</p>

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
                        <span className="ml-1 text-indigo-400">[+{msg.imageCount} file{msg.imageCount > 1 ? "s" : ""}]</span>
                      ) : null}
                    </span>
                  </div>
                ) : (
                  <div key={i} className="flex items-start gap-2 text-xs text-indigo-300">
                    <span className="mt-0.5 shrink-0 text-green-400 font-bold">✓</span>
                    <span className="italic">Generated: &ldquo;{msg.draftTitle}&rdquo;</span>
                  </div>
                )
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
            {/* Pending attachments */}
            {(pendingImages.length > 0 || pendingPdfs.length > 0) && (
              <div className="flex flex-wrap gap-2">
                {pendingImages.map((img, i) => (
                  <div key={`img-${i}`} className="relative group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.previewUrl} alt={img.name} className="h-16 w-16 rounded-md object-cover border border-indigo-500/40" />
                    <button type="button" onClick={() => removeImage(i)}
                      className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-red-500 text-white text-[10px] leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {pendingPdfs.map((pdf, i) => (
                  <div key={`pdf-${i}`} className="relative group flex items-center gap-1.5 rounded-md border border-indigo-500/40 bg-da-bg/50 px-2 py-1">
                    <span className="text-xs">📄</span>
                    <span className="max-w-[120px] truncate text-xs text-da-text">{pdf.name}</span>
                    <button type="button" onClick={() => setPendingPdfs((prev) => prev.filter((_, j) => j !== i))}
                      className="ml-1 text-red-400 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Textarea */}
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
              className="w-full resize-none rounded-md border border-indigo-500/30 bg-da-bg/50 px-3 py-2.5 text-sm text-da-text placeholder-da-muted/50 focus:border-indigo-400/60 focus:outline-none disabled:opacity-50"
            />
            <div className="text-[10px] text-da-muted/60 text-center">Ctrl+Enter to send</div>
          </div>

          {/* Error */}
          {error && (
            <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={isGenerating || (!description.trim() && pendingImages.length === 0 && pendingPdfs.length === 0)}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-indigo-500/60 bg-indigo-600/30 px-4 py-2 text-sm font-semibold text-indigo-200 transition-colors hover:bg-indigo-600/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isGenerating ? (
                <><span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />Generating…</>
              ) : (
                <>⚡ {isRefinement ? "Refine Activity" : "Generate Activity"}</>
              )}
            </button>

            {lastDraft && (
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saveStatus === "saving" || saveStatus === "saved"}
                className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                  saveStatus === "saved" ? "border-green-500/40 bg-green-500/10 text-green-300"
                  : saveStatus === "error" ? "border-red-500/40 bg-red-500/10 text-red-300"
                  : "border-da-border bg-da-bg/40 text-da-muted hover:text-da-text"
                }`}
              >
                {saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "✓ Saved" : saveStatus === "error" ? "Save failed" : "💾 Save"}
              </button>
            )}

            {hasHistory && (
              <button
                type="button"
                onClick={() => {
                  setHistory([]); setLastDraft(null); setSaveStatus("idle"); setError(null);
                  setPendingImages([]); setPendingPdfs([]);
                  setDriveUrl(""); setShowDriveInput(false);
                  setDriveImportStatus("idle"); setDriveImportError(null);
                }}
                className="rounded-lg border border-da-border bg-da-bg/40 px-3 py-2 text-xs text-da-muted hover:text-da-text transition-colors"
              >
                ↻ New
              </button>
            )}
          </div>

          {/* Feature tags */}
          {!hasHistory && (
            <div className="flex flex-wrap gap-1.5">
              {["Marks auto-assigned", "CCSS standards tagged", "Answer key generated", "Iterative refinement", "Google Drive support"].map(
                (tag) => (
                  <span key={tag} className="rounded-full border border-indigo-500/20 bg-indigo-500/10 px-2 py-0.5 text-[10px] text-indigo-400/80">
                    {tag}
                  </span>
                )
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
