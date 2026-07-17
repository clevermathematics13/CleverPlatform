"use client";

import { useEffect, useRef, useState } from "react";
import {
  type AssignmentDraft,
  type ClaudeResponse,
  type FormattingRequirements,
  buildActivityGeneratorSystemPrompt,
  parseAssignmentDraftJson,
} from "@/lib/assignments";
import {
  type CommandTermIssue,
  validateDraftCommandTerms,
} from "@/lib/command-term-validator";
import {
  type NumberingIssue,
  validateDraftNumbering,
} from "@/lib/numbering-validator";
import { createClient } from "@/lib/supabase/client";

// ── Types ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

type ImageMimeType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";
type AttachmentStatus = "uploading" | "ready" | "error";
// Attachments now live in Supabase Storage (bucket "uploads", under
// activity-generator/{userId}/...) rather than as inline base64. Vercel
// serverless functions cap request AND response bodies at ~4.5 MB, which a
// handful of source PDFs blew straight through. `path` is null until the
// browser-to-Storage upload finishes; only attachments with a path are sent.
type PendingImage = { id: string; path: string | null; mimeType: ImageMimeType; previewUrl: string; name: string; status: AttachmentStatus; error?: string };
type PendingPdf = { id: string; path: string | null; name: string; status: AttachmentStatus; error?: string };

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  draftTitle?: string;
  imageCount?: number;
};

type SaveStatus = "idle" | "saving" | "saved" | "error";
type DriveConnectionStatus = "checking" | "connected" | "disconnected";
type DriveImportStatus = "idle" | "fetching" | "picking" | "done" | "error";
type GenerationProgress = { phase: string; charCount?: number };

type Props = {
  gradeLevel: "Grade 9" | "Grade 10" | "Grade 11" | "Grade 12";
  formatting: FormattingRequirements;
  onDraftGenerated: (draft: AssignmentDraft) => void;
};

const UPLOADS_BUCKET = "uploads";

/** Keep storage paths predictable and safe: strip anything that isn't
 *  alphanumeric, dot, dash, or underscore. */
function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(-120);
}

type StreamOutcome =
  | { status: "done"; message: ClaudeResponse }
  | { status: "error"; message: string }
  | { status: "disconnected" };

/**
 * Reads one SSE response until it signals completion/error, or the
 * connection ends without either. Increments chunkCountRef for every frame
 * successfully parsed, so a caller can resume from exactly that position if
 * the connection dropped mid-generation.
 *
 * Frames look like:
 *   event: progress\ndata: {"phase":"resolving-attachments"}\n\n
 *   event: progress\ndata: {"phase":"first-half:thinking"}\n\n
 *   event: progress\ndata: {"phase":"first-half:writing","charCount":1234}\n\n
 *   event: progress\ndata: {"phase":"second-half:thinking"}\n\n
 *   event: progress\ndata: {"phase":"second-half:writing","charCount":5678}\n\n
 *   event: done\ndata: {"message": <full ClaudeResponse>}\n\n
 *   event: error\ndata: {"message": "..."}\n\n
 */
async function readOneStream(
  res: Response,
  onProgress: (info: GenerationProgress) => void,
  chunkCountRef: { current: number },
): Promise<StreamOutcome> {
  const reader = res.body?.getReader();
  if (!reader) {
    // No streaming body support in this environment — fall back to a plain
    // JSON parse rather than hanging forever.
    return { status: "done", message: (await res.json()) as ClaudeResponse };
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });

    let sepIndex: number;
    while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
      const rawFrame = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);
      const eventMatch = rawFrame.match(/^event: (.+)$/m);
      const dataMatch = rawFrame.match(/^data: (.+)$/m);
      if (!eventMatch || !dataMatch) continue;

      let data: unknown;
      try {
        data = JSON.parse(dataMatch[1]);
      } catch {
        continue;
      }
      chunkCountRef.current++;

      if (eventMatch[1] === "progress") {
        onProgress(data as GenerationProgress);
      } else if (eventMatch[1] === "done") {
        return { status: "done", message: (data as { message: ClaudeResponse }).message };
      } else if (eventMatch[1] === "error") {
        return { status: "error", message: (data as { message?: string }).message ?? "Claude API error" };
      }
    }

    if (done) break;
  }

  return { status: "disconnected" };
}

// Each connection to /api/claude (or a resume reconnect) can stay open for
// up to that route's own ~300s ceiling before Vercel cuts it — see
// platform/app/api/claude/route.ts's comments for why. 6 reconnects covers
// up to ~30 minutes of total generation time, comfortably more than a
// two-pass Nuanced Analysis packet should ever need, while still giving up
// eventually if something is genuinely stuck rather than just slow.
const MAX_RECONNECTS = 6;

/**
 * Reads the SSE stream /api/claude returns, reconnecting to
 * /api/claude/resume/[runId] if the connection drops before a 'done'/
 * 'error' chunk arrives. Generation runs as a durable Vercel Workflow (see
 * platform/workflows/nuanced-analysis-generation.ts) whose steps combined
 * can genuinely take longer than a single Vercel Function invocation's
 * ~300s ceiling, even though every individual step stays comfortably under
 * it — the proxying connection itself is what gets cut off, not the
 * underlying generation. Reconnecting and resuming from the last received
 * chunk (via the SDK's own run.getReadable({ startIndex }) resumption) is
 * the documented fix for exactly this, not a failure state — so a dropped
 * connection here is expected and recovered from silently rather than
 * shown to the user as an error, unless every reconnect attempt is
 * exhausted.
 */
async function readClaudeStream(
  initialRes: Response,
  onProgress: (info: GenerationProgress) => void,
): Promise<ClaudeResponse> {
  const runId = initialRes.headers.get("x-workflow-run-id");
  const chunkCountRef = { current: 0 };
  let res = initialRes;

  for (let attempt = 0; attempt <= MAX_RECONNECTS; attempt++) {
    const outcome = await readOneStream(res, onProgress, chunkCountRef);

    if (outcome.status === "done") return outcome.message;
    if (outcome.status === "error") throw new Error(outcome.message);

    // Disconnected without a completion signal — expected for long
    // generations. Reconnect and resume, if we have a run to resume.
    if (!runId) {
      throw new Error(
        "The connection closed before generation finished, and no resumable run ID was available to reconnect. Try again, and if it repeats, send fewer attachments in one message.",
      );
    }
    if (attempt === MAX_RECONNECTS) break;

    const resumeRes = await fetch(`/api/claude/resume/${runId}?startIndex=${chunkCountRef.current}`);
    if (!resumeRes.ok) {
      let errorMsg = `Could not resume generation (${resumeRes.status})`;
      try {
        const errData = (await resumeRes.json()) as { error?: string };
        if (errData.error) errorMsg = errData.error;
      } catch {
        // ignore — fall back to the generic message above
      }
      throw new Error(errorMsg);
    }
    res = resumeRes;
  }

  throw new Error(
    "Generation is taking unusually long and kept disconnecting. Check back in a few minutes, or try again with fewer attachments.",
  );
}

// ── Component ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function ActivityGeneratorPanel({ gradeLevel, formatting, onDraftGenerated }: Props) {
  const [description, setDescription] = useState("");
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastDraft, setLastDraft] = useState<AssignmentDraft | null>(null);
  // Command-term validator results for the most recent draft. Non-empty means
  // at least one question/subpart prompt contains zero recognized IB command
  // terms — the exact silent failure that shipped 8 instruction-less
  // questions in one packet. Warn loudly instead of letting it reach a PDF.
  const [commandTermIssues, setCommandTermIssues] = useState<CommandTermIssue[]>([]);
  // Numbering-integrity results for the most recent draft. Non-empty means
  // the numbers the model embedded in its own prompts/headings have gaps,
  // duplicates, or go backwards — the "1... 5, 6" symptom of questions
  // silently dropped between the two generation passes.
  const [numberingIssues, setNumberingIssues] = useState<NumberingIssue[]>([]);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [isExpanded, setIsExpanded] = useState(true);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [pendingPdfs, setPendingPdfs] = useState<PendingPdf[]>([]);
  const historyRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pickerLoadingRef = useRef(false);
  // Attachment ids removed from the UI while their upload was still in
  // flight. When the upload finally resolves, we delete the orphaned
  // storage object instead of re-inserting it into state.
  const removedWhileUploadingRef = useRef<Set<string>>(new Set());

  const [driveStatus, setDriveStatus] = useState<DriveConnectionStatus>("checking");
  const [showDriveInput, setShowDriveInput] = useState(false);
  const [driveUrl, setDriveUrl] = useState("");
  const [driveImportStatus, setDriveImportStatus] = useState<DriveImportStatus>("idle");
  const [driveImportError, setDriveImportError] = useState<string | null>(null);

  // formatting accepted for future use
  void formatting;

  const isAnyAttachmentUploading =
    pendingImages.some((p) => p.status === "uploading") || pendingPdfs.some((p) => p.status === "uploading");
  const hasAttachmentErrors =
    pendingImages.some((p) => p.status === "error") || pendingPdfs.some((p) => p.status === "error");

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
      const tokenRes = await fetch("/api/assignments/google-picker-token");
      if (!tokenRes.ok) {
        const errData = (await tokenRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(errData.error ?? "Failed to get authentication token");
      }
      const { token, apiKey } = (await tokenRes.json()) as { token: string; apiKey: string };

      if (!apiKey) throw new Error("Google Picker API key not configured");

      if (!(window as unknown as { gapi?: unknown }).gapi) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://apis.google.com/js/api.js";
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("Failed to load Google API"));
          document.head.appendChild(script);
        });
      }

      const gapi = (window as unknown as { gapi: { load: (lib: string, cb: () => void) => void; client?: unknown } }).gapi;
      await new Promise<void>((resolve) => gapi.load("picker", resolve));

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
    const id = crypto.randomUUID();
    setPendingPdfs((prev) => [...prev, { id, path: null, name: fileName, status: "uploading" }]);
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
      // The route now stages the file in Supabase Storage server-side and
      // returns a path instead of base64 (a large Drive PDF could otherwise
      // exceed Vercel's ~4.5 MB response-body cap on the way back).
      const data = (await res.json()) as { path: string; name: string; sizeMb: number };
      if (removedWhileUploadingRef.current.has(id)) {
        removedWhileUploadingRef.current.delete(id);
        const supabase = createClient();
        void supabase.storage.from(UPLOADS_BUCKET).remove([data.path]);
      } else {
        setPendingPdfs((prev) => prev.map((p) => (p.id === id ? { ...p, path: data.path, name: data.name, status: "ready" } : p)));
      }
      setDriveImportStatus("done");
      setShowDriveInput(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch from Drive";
      setPendingPdfs((prev) => prev.map((p) => (p.id === id ? { ...p, status: "error", error: message } : p)));
      setDriveImportError(message);
      setDriveImportStatus("error");
    }
  }

  async function handleFetchDriveUrl() {
    if (!driveUrl.trim()) return;
    setDriveImportStatus("fetching");
    setDriveImportError(null);
    const id = crypto.randomUUID();
    const placeholderName = driveUrl.split("/").pop() ?? "drive-file.pdf";
    setPendingPdfs((prev) => [...prev, { id, path: null, name: placeholderName, status: "uploading" }]);
    try {
      const res = await fetch("/api/assignments/fetch-drive-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The route parses a Drive file ID out of a full URL too, so the
        // pasted URL goes in the same fileId field it already expects.
        body: JSON.stringify({ fileId: driveUrl.trim() }),
      });
      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errData.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { path: string; name: string; sizeMb: number };
      if (removedWhileUploadingRef.current.has(id)) {
        removedWhileUploadingRef.current.delete(id);
        const supabase = createClient();
        void supabase.storage.from(UPLOADS_BUCKET).remove([data.path]);
      } else {
        setPendingPdfs((prev) => prev.map((p) => (p.id === id ? { ...p, path: data.path, name: data.name, status: "ready" } : p)));
      }
      setDriveUrl("");
      setShowDriveInput(false);
      setDriveImportStatus("done");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Fetch failed";
      setPendingPdfs((prev) => prev.map((p) => (p.id === id ? { ...p, status: "error", error: message } : p)));
      setDriveImportError(message);
      setDriveImportStatus("error");
    }
  }

  /** Upload one selected file straight to Supabase Storage from the browser,
   *  updating the matching pending-attachment entry as it progresses. */
  async function uploadAttachment(file: File, id: string, isPdf: boolean) {
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const path = `activity-generator/${user.id}/${Date.now()}-${sanitizeFileName(file.name)}`;
      const { error: uploadError } = await supabase.storage
        .from(UPLOADS_BUCKET)
        .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
      if (uploadError) throw uploadError;

      if (removedWhileUploadingRef.current.has(id)) {
        // User removed this attachment before the upload finished — don't
        // resurrect it in state, just clean up the now-orphaned object.
        removedWhileUploadingRef.current.delete(id);
        void supabase.storage.from(UPLOADS_BUCKET).remove([path]);
        return;
      }

      if (isPdf) {
        setPendingPdfs((prev) => prev.map((p) => (p.id === id ? { ...p, path, status: "ready" } : p)));
      } else {
        setPendingImages((prev) => prev.map((p) => (p.id === id ? { ...p, path, status: "ready" } : p)));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      if (isPdf) {
        setPendingPdfs((prev) => prev.map((p) => (p.id === id ? { ...p, status: "error", error: message } : p)));
      } else {
        setPendingImages((prev) => prev.map((p) => (p.id === id ? { ...p, status: "error", error: message } : p)));
      }
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!files.length) return;

    for (const file of files) {
      const id = crypto.randomUUID();
      if (file.type === "application/pdf") {
        setPendingPdfs((prev) => [...prev, { id, path: null, name: file.name, status: "uploading" }]);
        void uploadAttachment(file, id, true);
      } else {
        const previewUrl = URL.createObjectURL(file);
        setPendingImages((prev) => [
          ...prev,
          { id, path: null, mimeType: file.type as ImageMimeType, previewUrl, name: file.name, status: "uploading" },
        ]);
        void uploadAttachment(file, id, false);
      }
    }
  }

  function removePendingImage(id: string) {
    setPendingImages((prev) => {
      const item = prev.find((p) => p.id === id);
      if (item?.path) {
        const supabase = createClient();
        void supabase.storage.from(UPLOADS_BUCKET).remove([item.path]);
      } else if (item) {
        removedWhileUploadingRef.current.add(id);
      }
      return prev.filter((p) => p.id !== id);
    });
  }

  function removePendingPdf(id: string) {
    setPendingPdfs((prev) => {
      const item = prev.find((p) => p.id === id);
      if (item?.path) {
        const supabase = createClient();
        void supabase.storage.from(UPLOADS_BUCKET).remove([item.path]);
      } else if (item) {
        removedWhileUploadingRef.current.add(id);
      }
      return prev.filter((p) => p.id !== id);
    });
  }

  async function handleSend() {
    if (!description.trim() && !pendingImages.length && !pendingPdfs.length) return;
    if (isAnyAttachmentUploading) {
      setError("Attachments are still uploading — wait for them to finish before sending.");
      return;
    }
    if (hasAttachmentErrors) {
      setError("Some attachments failed to upload. Remove them (✕) or retry before sending.");
      return;
    }

    setIsGenerating(true);
    setGenerationProgress(null);
    setError(null);
    setCommandTermIssues([]);
    setNumberingIssues([]);

    // Attachments are referenced by their Supabase Storage path, not inline
    // base64 — /api/claude resolves them server-side. This keeps the wire
    // payload tiny regardless of how many or how large the source PDFs are.
    const userContent: Array<{ type: string; text?: string; path?: string; mimeType?: string }> = [];
    for (const img of pendingImages) {
      if (img.path) userContent.push({ type: "image_ref", path: img.path, mimeType: img.mimeType });
    }
    for (const pdf of pendingPdfs) {
      if (pdf.path) userContent.push({ type: "document_ref", path: pdf.path });
    }
    if (description.trim()) {
      userContent.push({ type: "text", text: description.trim() });
    }

    console.log(
      `[activity-generator] sending ${pendingImages.length} image ref(s), ${pendingPdfs.length} pdf ref(s) — payload is path references only, no size limit to watch here.`,
    );

    // Build the API message list — Anthropic rejects empty content strings.
    // Prior history assistant turns store display text; rebuild with safe fallbacks.
    const messages = [
      ...history
        .filter((m) => typeof m.content === "string" ? m.content.trim().length > 0 : true)
        .map((m) => ({
          role: m.role,
          content: m.role === "assistant"
            ? (m.draftTitle ? `Generated draft: ${m.draftTitle}` : (m.content.trim() || "Draft generated."))
            : (m.content.trim() || "[attachment only]"),
        })),
      {
        role: "user" as const,
        // Ensure the current user turn always has at least one text block
        content: userContent.length > 0
          ? userContent
          : [{ type: "text", text: description.trim() || "Please refine the previous draft." }],
      },
    ];

    const requestBody = JSON.stringify({
      system: buildActivityGeneratorSystemPrompt(gradeLevel),
      messages,
    });

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
      const res = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
      });

      if (!res.ok) {
        // Attachment-resolution and auth/validation failures return a plain
        // JSON error (not a stream) so they land here, same as before.
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

      // A successful response is now an SSE stream of progress frames ending
      // in a 'done' (or 'error') frame. readClaudeStream transparently
      // reconnects (via /api/claude/resume) if this connection is cut off
      // before generation finishes — see its doc comment for why that's
      // expected rather than a failure.
      const data = await readClaudeStream(res, setGenerationProgress);
      const stopReason = (data as { stop_reason?: string }).stop_reason;
      const rawText = data.content?.find((b: { type: string; text?: string }) => b.type === "text")?.text ?? "";

      // parseAssignmentDraftJson extracts the JSON object, repairs the two
      // most common ways this model breaks it (unescaped quotes from the
      // required Typst quoted-operator syntax, and stray backslashes/control
      // characters), then parses and sanitizes it. Throws a descriptive
      // Error — including a max_tokens-specific message — if it still can't
      // be parsed after repair; full diagnostics go to the console.
      const sanitized: AssignmentDraft = parseAssignmentDraftJson(rawText, stopReason);

      // Fail loud on instruction-less prompts BEFORE the teacher downloads a
      // broken PDF. The draft still renders (warnings, not a hard block), so
      // a single flagged question can be regenerated or edited by hand.
      setCommandTermIssues(validateDraftCommandTerms(sanitized));

      // Same fail-loud policy for numbering integrity: if the model embedded
      // question numbers or Part headings whose sequence has gaps, duplicates,
      // or goes backwards, questions were likely dropped between the two
      // generation passes — warn before the packet is downloaded.
      setNumberingIssues(validateDraftNumbering(sanitized));

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
      setGenerationProgress(null);
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
          documentKind: "investigation",
          formattingRequirements: formatting,
          assignmentInput: {
            title: lastDraft.title,
            topic: (lastDraft as { syllabusTopics?: string }).syllabusTopics ?? "",
            learningGoals: "",
            contextNotes: "",
            questionCount: lastDraft.sections.reduce((s, sec) => s + sec.questions.length, 0),
            challengeMix: "challenge-forward",
            includeRealWorldContext: true,
            tone: "exam-style",
            gradeLevel,
            documentKind: "investigation",
          },
          // Persist the full draft so the editor and sandbox can reload it
          draftContent: lastDraft,
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

  const generatingLabel = !isGenerating
    ? null
    : generationProgress?.phase === "resolving-attachments"
      ? "Reading attachments…"
      : generationProgress?.phase === "first-half:thinking"
        ? "Thinking through the source material (part 1 of 2)…"
        : generationProgress?.phase === "first-half:writing"
          ? `Writing the first half… ${generationProgress.charCount?.toLocaleString() ?? ""} characters so far`
          : generationProgress?.phase === "second-half:thinking"
            ? "Thinking through the source material (part 2 of 2)…"
            : generationProgress?.phase === "second-half:writing"
              ? `Finishing the second half… ${generationProgress.charCount?.toLocaleString() ?? ""} characters so far`
              : "Starting…";

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
              {pendingImages.map((img) => (
                <div
                  key={img.id}
                  className={`relative h-12 w-12 rounded border overflow-hidden group ${
                    img.status === "error" ? "border-red-500/60" : "border-da-border"
                  }`}
                  title={img.status === "error" ? img.error : img.status === "uploading" ? "Uploading…" : img.name}
                >
                  <img src={img.previewUrl} alt={img.name} className="h-full w-full object-cover" />
                  {img.status === "uploading" && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                      <span className="h-3 w-3 animate-pulse rounded-full bg-white/80" />
                    </div>
                  )}
                  {img.status === "error" && (
                    <div className="absolute inset-0 flex items-center justify-center bg-red-900/60 text-white text-xs font-bold">!</div>
                  )}
                  <button
                    type="button"
                    onClick={() => removePendingImage(img.id)}
                    className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 text-white text-xs font-bold"
                  >✕</button>
                </div>
              ))}
              {pendingPdfs.map((pdf) => (
                <div
                  key={pdf.id}
                  className={`flex items-center gap-1 rounded border bg-da-bg/60 px-2 py-1 text-[10px] group ${
                    pdf.status === "error" ? "border-red-500/60 text-red-300" : "border-da-border text-da-muted"
                  }`}
                  title={pdf.status === "error" ? pdf.error : undefined}
                >
                  <span>{pdf.status === "uploading" ? "⏳" : pdf.status === "error" ? "⚠️" : "📄"}</span>
                  <span className="max-w-[80px] truncate">{pdf.name}</span>
                  <button
                    type="button"
                    onClick={() => removePendingPdf(pdf.id)}
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
                disabled={
                  isGenerating ||
                  isAnyAttachmentUploading ||
                  (!description.trim() && !pendingImages.length && !pendingPdfs.length)
                }
                title={isAnyAttachmentUploading ? "Waiting for attachments to finish uploading…" : undefined}
                className="rounded-lg border border-da-accent/70 bg-da-accent/20 px-3 py-2 text-xs font-semibold text-da-text transition-colors hover:bg-da-accent/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isGenerating ? "…" : isAnyAttachmentUploading ? "⏳" : "Send"}
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

          {generatingLabel && (
            <p className="text-xs text-da-muted flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-da-accent" />
              {generatingLabel}
            </p>
          )}

          {error && (
            <p className="text-xs text-red-400 border border-red-500/30 bg-red-500/10 rounded px-2 py-1">{error}</p>
          )}

          {commandTermIssues.length > 0 && (
            <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-300">
              <p className="font-semibold">
                ⚠ {commandTermIssues.length} question{commandTermIssues.length === 1 ? "" : "s"} missing an IB command term
              </p>
              <p className="mt-0.5 text-amber-300/80">
                These prompts contain setup text but no recognized instruction (Find, Sketch, Show that, …).
                Regenerate them or edit the prompt before downloading.
              </p>
              <ul className="mt-1 space-y-0.5">
                {commandTermIssues.map((issue) => (
                  <li key={issue.location} className="text-amber-200/90">
                    <span className="font-medium">{issue.location}:</span>{" "}
                    <span className="italic text-amber-300/70">“{issue.promptTail}”</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {numberingIssues.length > 0 && (
            <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-300">
              <p className="font-semibold">
                ⚠ {numberingIssues.length} numbering problem{numberingIssues.length === 1 ? "" : "s"} in this draft
              </p>
              <p className="mt-0.5 text-amber-300/80">
                The question/Part numbers in the generated content have gaps, duplicates, or run backwards —
                questions may have been dropped during generation. Regenerate, or fix the numbering by hand before downloading.
              </p>
              <ul className="mt-1 space-y-0.5">
                {numberingIssues.map((issue, i) => (
                  <li key={`${issue.kind}-${i}`} className="text-amber-200/90">
                    <span className="font-medium">{issue.location}:</span>{" "}
                    <span className="text-amber-300/70">{issue.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {lastDraft && (
            <button
              type="button"
              onClick={() => void handleSaveTemplate()}
              disabled={saveStatus === "saving"}
              className="w-full rounded-lg border border-da-border/50 bg-da-bg/30 px-3 py-1.5 text-xs font-medium text-da-muted transition-colors hover:bg-da-hover disabled:opacity-50"
            >
              {saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "✓ Saved as Nuanced Analysis" : saveStatus === "error" ? "Save failed" : "Save as Nuanced Analysis"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
