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

// ── Types ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

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

  const [driveStatus, setDriveStatus] = useState<DriveConnectionStatus>("checking");
  const [showDriveInput, setShowDriveInput] = useState(false);
  const [driveUrl, setDriveUrl] = useState("");
  const [driveImportStatus, setDriveImportStatus] = useState<DriveImportStatus>("idle");
  const [driveImportError, setDriveImportError] = useState<string | null>(null);

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
    const onFocus = () => void checkDrive();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  function handleConnectDrive() {
    window.location.href = "/api/questions/connect-drive";
  }

  async function openGooglePicker() {
    if (pickerLoadingRef.current) return;
    pickerLoadingRef.current = true;
    setDriveImportStatus("picking");
    setDriveImportError(null);

    try {
      // ── 1. Fetch OAuth token AND API key from our server ──────────────
      const tokenRes = await fetch("/api/assignments/google-picker-token");
      if (!tokenRes.ok) {
        const errData = (await tokenRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(errData.error ?? "Failed to get authentication token");
      }
      const { token, apiKey } = (await tokenRes.json()) as { token: string; apiKey: string };

      if (!apiKey) throw new Error("Google Picker API key not configured");

      // ── 2. Load the gapi script if not already loaded ─────────────────
      if (!(window as unknown as { gapi?: unknown }).gapi) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://apis.google.com/js/api.js";
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("Failed to load Google API"));
          document.head.appendChild(script);
        });
      }

      // ── 3. Load picker library ────────────────────────────────────────
      const gapi = (window as unknown as { gapi: { load: (lib: string, cb: () => void) => void; client?: unknown } }).gapi;
      await new Promise<void>((resolve) => gapi.load("picker", resolve));

      // ── 4. Build and show the picker ──────────────────────────────────
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pickerLib = ((window as any).google as any).picker as any;

      const view = new pickerLib.DocsView(pickerLib.ViewId.DOCS);
      view.setMimeTypes("application/pdf");

      const picker = new pickerLib.PickerBuilder()
        .addView(view)
        .setOAuthToken(token)
        .setDeveloperKey(apiKey)
        .setCallback(async (data: { action: string; docs?: Array<{ id: string; name: string }> }) => {
          if (data.action === pickerLib.Action.PICKED && data.docs?.[0]) {
            const file = data.docs[0];
            setDriveImportStatus("fetching");
            await fetchDriveFile(file.id, file.name);
          } else if (data.action === pickerLib.Action.CANCEL) {
            setDriveImportStatus("idle");
          }
        })
        .build();

      picker.setVisible(true);
    } catch (err) {
      setDriveImportError(err instanceof Error ? err.message : "Google Picker failed");
      setDriveImportStatus("error");
    } finally {
      pickerLoadingRef.current = false;
    }
  }

  async function fetchDriveFile(fileId: string, fileName: string) {
    setDriveImportStatus("fetching");
    setDriveImportError(null);
    try {
      const res = await fetch("/api/assignments/fetch-drive-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId }),
      });
      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errData.error ?? `Failed to fetch file (${res.status})`);
      }
      const data = (await res.json()) as { base64: string; mimeType: string };
      setPendingPdfs((prev) => [...prev, { base64: data.base64, name: fileName }]);
      setDriveImportStatus("done");
      setShowDriveInput(false);
    } catch (err) {
      setDriveImportError(err instanceof Error ? err.message : "Failed to fetch from Drive");
      setDriveImportStatus("error");
    }
  }

  async function handleFetchDriveUrl() {
    if (!driveUrl.trim()) return;
    setDriveImportStatus("fetching");
    setDriveImportError(null);
    try {
      const res = await fetch("/api/assignments/fetch-drive-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: driveUrl.trim() }),
      });
      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errData.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { base64: string; mimeType: string; fileName?: string };
      const name = data.fileName ?? driveUrl.split("/").pop() ?? "drive-file.pdf";
      setPendingPdfs((prev) => [...prev, { base64: data.base64, name }]);
      setDriveUrl("");
      setShowDriveInput(false);
      setDriveImportStatus("done");
    } catch (err) {
      setDriveImportError(err instanceof Error ? err.message : "Fetch failed");
      setDriveImportStatus("error");
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const newImages: PendingImage[] = [];
    const newPdfs: PendingPdf[] = [];
    for (const file of files) {
      const base64 = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res((r.result as string).split(",")[1]);
        r.onerror = () => rej(new Error("Read failed"));
        r.readAsDataURL(file);
      });
      if (file.type === "application/pdf") {
        newPdfs.push({ base64, name: file.name });
      } else {
        newImages.push({ base64, mimeType: file.type as ImageMimeType, previewUrl: URL.createObjectURL(file), name: file.name });
      }
    }
    setPendingImages((prev) => [...prev, ...newImages]);
    setPendingPdfs((prev) => [...prev, ...newPdfs]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSend() {
    if (!description.trim() && !pendingImages.length && !pendingPdfs.length) return;
    setIsGenerating(true);
    setError(null);

    const userContent: Array<{ type: string; text?: string; source?: unknown }> = [];
    for (const img of pendingImages) {
      userContent.push({ type: "image", source: { type: "base64", media_type: img.mimeType, data: img.base64 } });
    }
    for (const pdf of pendingPdfs) {
      userContent.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.base64 } });
    }
    if (description.trim()) {
      userContent.push({ type: "text", text: description.trim() });
    }

    const nextHistory: ChatMessage[] = [...history, {
      role: "user",
      content: description.trim(),
      imageCount: pendingImages.length + pendingPdfs.length,
    }];

    setHistory(nextHistory);
    setDescription("");
    setPendingImages([]);
    setPendingPdfs([]);

    try {
      const messages = [
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: userContent },
      ];

      const res = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: buildActivityGeneratorSystemPrompt(gradeLevel, formatting),
          messages,
        }),
      });

      if (!res.ok) {
        let errorMsg = `Request failed (${res.status})`;
        try {
          const errData = (await res.json()) as { error?: string };
          if (errData.error) errorMsg = errData.error;
        } catch {
          const text = await res.text().catch(() => "");
          if (text) errorMsg = text;
        }
        throw new Error(errorMsg);
      }

      const data = (await res.json()) as ClaudeResponse;
      const rawText = data.content?.find((b: { type: string; text?: string }) => b.type === "text")?.text ?? "";
      const json = extractJsonObject(rawText);
      const parsed = JSON.parse(json) as AssignmentDraft;
      const sanitized = sanitizeDraft(parsed);

      setLastDraft(sanitized);
      onDraftGenerated(sanitized);
      setHistory([...nextHistory, { role: "assistant", content: rawText, draftTitle: sanitized.title }]);

      setTimeout(() => {
        if (historyRef.current) historyRef.current.scrollTop = historyRef.current.scrollHeight;
      }, 50);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unexpected error";
      setError(msg);
      setHistory(nextHistory);
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleSaveTemplate() {
    if (!lastDraft) return;
    setSaveStatus("saving");
    try {
      const res = await fetch("/api/assignments/templates/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateName: lastDraft.title || "Untitled",
          gradeLevel,
          documentKind: "activity-sheet",
          formattingRequirements: formatting,
          assignmentInput: { title: lastDraft.title, topic: "", learningGoals: "", contextNotes: "", questionCount: 10, challengeMix: "balanced", includeRealWorldContext: true, tone: "clear", gradeLevel, documentKind: "activity-sheet" },
        }),
      });
      setSaveStatus(res.ok ? "saved" : "error");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 2000);
    }
  }

  const driveButtonLabel =
    driveStatus === "checking" ? "Checking…"
    : driveStatus === "connected" ? "📎 Import from Drive"
    : "Connect Drive";

  return (
    <div className="rounded-xl border border-da-border bg-da-bg/40">
      {/* Header / toggle */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold text-da-amber uppercase tracking-wide">AI Activity Generator</span>
        <span className="text-da-muted text-xs">{isExpanded ? "▲ hide" : "▼ show"}</span>
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 space-y-3">
          {/* Chat history */}
          {history.length > 0 && (
            <div ref={historyRef} className="max-h-56 overflow-y-auto space-y-2 rounded-lg border border-da-border bg-da-bg/30 p-3">
              {history.map((msg, i) => (
                <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`rounded-lg px-3 py-1.5 text-xs max-w-[80%] ${
                    msg.role === "user"
                      ? "bg-da-accent/20 text-da-text border border-da-accent/30"
                      : "bg-da-bg/60 text-da-muted border border-da-border/40"
                  }`}>
                    {msg.role === "user" && msg.imageCount && msg.imageCount > 0 && (
                      <span className="mr-1 text-da-muted">📎×{msg.imageCount}</span>
                    )}
                    {msg.role === "assistant" && msg.draftTitle
                      ? <span>✅ Generated: <em>{msg.draftTitle}</em></span>
                      : msg.content.slice(0, 120) + (msg.content.length > 120 ? "…" : "")}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pending attachments */}
          {(pendingImages.length > 0 || pendingPdfs.length > 0) && (
            <div className="flex flex-wrap gap-1">
              {pendingImages.map((img, i) => (
                <div key={i} className="relative h-12 w-12 rounded border border-da-border overflow-hidden group">
                  <img src={img.previewUrl} alt={img.name} className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setPendingImages((prev) => prev.filter((_: PendingImage, j: number) => j !== i))}
                    className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 text-white text-xs font-bold"
                  >✕</button>
                </div>
              ))}
              {pendingPdfs.map((pdf, i) => (
                <div key={i} className="flex items-center gap-1 rounded border border-da-border bg-da-bg/60 px-2 py-1 text-[10px] text-da-muted group">
                  <span>📄</span>
                  <span className="max-w-[80px] truncate">{pdf.name}</span>
                  <button
                    type="button"
                    onClick={() => setPendingPdfs((prev: PendingPdf[]) => prev.filter((_: PendingPdf, j: number) => j !== i))}
                    className="text-da-muted/50 hover:text-red-400 font-bold ml-1"
                  >✕</button>
                </div>
              ))}
            </div>
          )}

          {/* Drive import row */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={driveStatus === "connected" ? openGooglePicker : handleConnectDrive}
              disabled={driveImportStatus === "fetching" || driveImportStatus === "picking" || driveStatus === "checking"}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                driveStatus === "connected"
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                  : "border-da-border/50 bg-da-bg/30 text-da-muted hover:bg-da-hover"
              }`}
            >
              {driveImportStatus === "fetching" ? "Fetching…" : driveImportStatus === "picking" ? "Opening picker…" : driveButtonLabel}
            </button>
            {driveStatus === "connected" && (
              <button
                type="button"
                onClick={() => setShowDriveInput(!showDriveInput)}
                className="rounded-lg border border-da-border/50 bg-da-bg/30 px-2 py-1.5 text-[10px] text-da-muted hover:bg-da-hover transition-colors"
                title="Paste a Drive URL instead"
              >URL</button>
            )}
            {driveImportStatus === "done" && <span className="text-[10px] text-emerald-400">✓ Imported</span>}
            {driveImportStatus === "error" && driveImportError && <span className="text-[10px] text-red-400">{driveImportError}</span>}
          </div>

          {showDriveInput && (
            <div className="flex gap-2">
              <input
                type="text"
                value={driveUrl}
                onChange={(e) => setDriveUrl(e.target.value)}
                placeholder="Paste Google Drive PDF URL…"
                className="flex-1 rounded-lg border border-da-border/50 bg-da-bg/30 px-2 py-1.5 text-xs text-da-text placeholder-da-muted/50 focus:border-da-accent/60 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleFetchDriveUrl}
                disabled={!driveUrl.trim() || driveImportStatus === "fetching"}
                className="rounded-lg border border-da-border/50 bg-da-bg/30 px-3 py-1.5 text-xs font-medium text-da-text hover:bg-da-hover disabled:opacity-50 transition-colors"
              >
                {driveImportStatus === "fetching" ? "Fetching…" : "Fetch"}
              </button>
            </div>
          )}

          {/* Input + send */}
          <div className="flex gap-2 items-end">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
              placeholder={history.length === 0
                ? `Describe an activity for ${gradeLevel}… (Enter to send, Shift+Enter for newline)`
                : "Follow-up or refinement…"}
              rows={2}
              className="flex-1 rounded-lg border border-da-border/50 bg-da-bg/30 px-3 py-2 text-sm text-da-text placeholder-da-muted/50 focus:border-da-accent/60 focus:outline-none resize-none"
            />
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-lg border border-da-border/50 bg-da-bg/30 p-2 text-da-muted hover:bg-da-hover transition-colors"
                title="Attach image or PDF"
              >📎</button>
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={isGenerating || (!description.trim() && !pendingImages.length && !pendingPdfs.length)}
                className="rounded-lg border border-da-accent/70 bg-da-accent/20 px-3 py-2 text-xs font-semibold text-da-text transition-colors hover:bg-da-accent/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isGenerating ? "…" : "Send"}
              </button>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            className="hidden"
            onChange={handleFileUpload}
          />

          {error && (
            <p className="text-xs text-red-400 border border-red-500/30 bg-red-500/10 rounded px-2 py-1">{error}</p>
          )}

          {lastDraft && (
            <button
              type="button"
              onClick={() => void handleSaveTemplate()}
              disabled={saveStatus === "saving"}
              className="w-full rounded-lg border border-da-border/50 bg-da-bg/30 px-3 py-1.5 text-xs font-medium text-da-muted transition-colors hover:bg-da-hover disabled:opacity-50"
            >
              {saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "✓ Saved as template" : saveStatus === "error" ? "Save failed" : "Save as template"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
