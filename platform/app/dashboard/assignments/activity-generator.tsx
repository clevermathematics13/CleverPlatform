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
import {
  type TokIssue,
  validateDraftTokProvocations,
} from "@/lib/tok-provocation-validator";
import { createClient } from "@/lib/supabase/client";
// Moved out of this file so every /api/claude caller can read the stream the
// route actually returns -- see claude-stream.ts.
import {
  readClaudeStream,
  GenerationStillRunningError,
  type GenerationProgress,
} from "@/lib/claude-stream";
// A generation outlives this tab. The ticket is how the tab finds it again.
import {
  readTicketForGrade,
  saveTicket,
  clearTicket,
} from "@/lib/generation-ticket";

// ---- Types ----

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

type Props = {
  gradeLevel: "Grade 9" | "Grade 10" | "Grade 11" | "Grade 12";
  formatting: FormattingRequirements;
  onDraftGenerated: (draft: AssignmentDraft) => void;
  /**
   * Prompt block describing what prior packets in this course already taught,
   * built server-side by /api/nuanced-analyses/continuity. Prepended to the
   * system prompt so the model does not re-teach settled material, re-spend a
   * TOK provocation, or pre-empt a skill reserved for a later section.
   * Undefined for the first packet in a course, or when no course is selected.
   */
  continuityContext?: string;
  /**
   * The course family's generation lessons, sent by the same route: what
   * marking real scripts showed a packet should do differently. Undefined for
   * a course with none, or when no course is selected.
   */
  lessons?: string;
};

const UPLOADS_BUCKET = "uploads";

/** Keep storage paths predictable and safe: strip anything that isn't
 *  alphanumeric, dot, dash, or underscore. */
function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(-120);
}


// ---- Component ----

export function ActivityGeneratorPanel({ gradeLevel, formatting, onDraftGenerated, continuityContext, lessons }: Props) {
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
  // TOK-provocation results for the most recent draft, on DP packets only.
  // Non-empty means a provocation arrived that could have been written
  // without reading the packet -- the exact bolted-on TOK the bar in
  // lib/tok-provocations.ts exists to prevent. Empty on Grade 9/10, which
  // are not held to that bar.
  const [tokIssues, setTokIssues] = useState<TokIssue[]>([]);
  // A run this panel started that is still going, or has finished while the
  // teacher was away. Deliberately NOT wired into isGenerating: a ticket must
  // never disable the Send button on a page load days later.
  const [pendingRun, setPendingRun] = useState<
    | { kind: "running"; since: number }
    | { kind: "ready"; generationId: string; rawText: string; prompt: string }
    | { kind: "failed"; message: string }
    | null
  >(null);
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

  // ---- Collecting a run that finished while nobody was watching -----------
  //
  // WHY THIS IS NOT A MOUNT EFFECT. Closing a laptop lid suspends the tab; it
  // does not unmount the page. So the literal case this exists for -- start a
  // packet, shut the lid, open it later -- never fires a mount. It needs
  // visibilitychange, and `online` for the wifi-drop case.
  //
  // WHY IT OFFERS RATHER THAN LOADS. Delivering straight into the sandbox
  // would overwrite whatever the teacher has since typed or edited, minutes
  // after they stopped expecting anything. The recovered packet waits behind
  // one click instead.
  useEffect(() => {
    let cancelled = false;

    async function collect() {
      if (cancelled || isGenerating) return;
      const now = Date.now();
      const ticket = readTicketForGrade(gradeLevel, now);
      if (!ticket) return;

      let status: {
        status?: string;
        text?: string | null;
        error?: string | null;
      } | null = null;
      try {
        const res = await fetch(`/api/claude/status/${ticket.generationId}`);
        if (!res.ok) return; // Unreachable says nothing; keep the ticket.
        status = await res.json();
      } catch {
        return; // Offline. The run is fine; try again on the next wake.
      }
      if (cancelled || !status) return;

      if (status.status === "succeeded" && status.text) {
        // Clear FIRST. If the text turns out to be unparseable, a ticket left
        // in place would re-throw on every page load from now on.
        clearTicket(ticket.generationId, now);
        setPendingRun({
          kind: "ready",
          generationId: ticket.generationId,
          rawText: status.text,
          prompt: ticket.prompt,
        });
      } else if (status.status === "failed") {
        clearTicket(ticket.generationId, now);
        setPendingRun({ kind: "failed", message: status.error ?? "The generation failed on the server." });
      } else if (status.status === "running") {
        setPendingRun({ kind: "running", since: ticket.startedAt });
      }
    }

    void collect();
    const onWake = () => {
      if (document.visibilityState === "visible") void collect();
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);
    window.addEventListener("focus", onWake);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, [gradeLevel, isGenerating]);

  /** Hand a recovered packet to the sandbox, on the teacher's say-so. */
  function loadRecovered(rawText: string, prompt: string) {
    try {
      const sanitized = parseAssignmentDraftJson(rawText);
      setCommandTermIssues(validateDraftCommandTerms(sanitized));
      setNumberingIssues(validateDraftNumbering(sanitized));
      setTokIssues(validateDraftTokProvocations(sanitized, gradeLevel));
      setLastDraft(sanitized);
      onDraftGenerated(sanitized);
      // Both turns, not just the packet: a history starting with an assistant
      // message is rejected outright by the API on the next refinement.
      setHistory([
        { role: "user", content: prompt },
        { role: "assistant", content: rawText, draftTitle: sanitized.title },
      ]);
      setPendingRun(null);
      setError(null);
    } catch (err) {
      setPendingRun(null);
      setError(
        `That generation finished but could not be read back: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
      );
    }
  }

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
      system: buildActivityGeneratorSystemPrompt(gradeLevel, continuityContext, lessons),
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
      // reconnects (via /api/claude/resume) if this connection is cut off,
      // and independently polls /api/claude/status for the run's real state,
      // so a finished packet is delivered even if every socket dies.
      // Write the handle down BEFORE reading a single byte. Everything after
      // this line can fail in a way that loses the connection but not the run,
      // and this is what makes the run findable afterwards.
      const generationId = res.headers.get("x-generation-id");
      if (generationId) {
        saveTicket(
          {
            v: 1,
            generationId,
            runId: res.headers.get("x-workflow-run-id"),
            startedAt: Date.now(),
            gradeLevel,
            prompt: description.trim(),
          },
          Date.now(),
        );
      }

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

      // And for TOK: the bar tells the model what a provocation has to be,
      // this reports the part of it a machine can decide. Warnings only, and
      // deliberately quiet -- see the validator's header on why this one is
      // biased toward under-flagging.
      setTokIssues(validateDraftTokProvocations(sanitized, gradeLevel));

      setLastDraft(sanitized);
      onDraftGenerated(sanitized);
      setHistory([...nextHistory, { role: "assistant", content: rawText, draftTitle: sanitized.title }]);
      // Delivered. Nothing left to come back for.
      if (generationId) clearTicket(generationId, Date.now());
      setPendingRun(null);

      setTimeout(() => {
        if (historyRef.current) historyRef.current.scrollTop = historyRef.current.scrollHeight;
      }, 50);
    } catch (err) {
      // A generation that is still running is NOT an error, and must never be
      // shown as one. The run is durable: it finishes on the server whether or
      // not this tab, this connection or this laptop is still around.
      if (err instanceof GenerationStillRunningError) {
        setPendingRun({ kind: "running", since: Date.now() });
        setHistory(nextHistory);
      } else {
        const msg = err instanceof Error ? err.message : "Unexpected error";
        setError(msg);
        setHistory(nextHistory);
      }
    } finally {
      setIsGenerating(false);
      setGenerationProgress(null);
    }
  }

  // WARNING (2026-08-19): this saves to public.assignment_templates via
  // /api/assignments/templates/create — a plain, un-tracked draft store, NOT
  // public.nuanced_analyses. It will NOT show up in "Manage Saved Packets",
  // will NOT get a course_id/section_code, and will NOT update continuity.
  // This function's button used to be labelled "Save as Nuanced Analysis" —
  // identical wording to the REAL Nuanced-Analysis-save button in
  // nuanced-analysis-sandbox.tsx (which posts to /api/nuanced-analyses and IS
  // what Manage Saved Packets reads). A teacher's packet landed here twice
  // with a "saved" confirmation shown, and never appeared in Manage because
  // it never touched nuanced_analyses. See nuanced-analysis-sandbox.tsx's
  // handleConfirmSave for the save flow that actually belongs to "Nuanced
  // Analysis" packets — this one is only for parking an in-progress draft.
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

          {isGenerating && (
            <p className="text-[11px] text-da-muted/80">
              Generating on the server. You can close this tab or shut the laptop — the packet will be waiting
              here when you come back.
            </p>
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

          {pendingRun?.kind === "ready" && (
            <div className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1.5 text-xs text-emerald-300">
              <p className="font-semibold">A packet finished while you were away</p>
              <p className="mt-0.5 text-emerald-300/80">
                It generated in the background and is waiting on the server. Loading it replaces whatever is in the
                preview below.
              </p>
              <button
                type="button"
                onClick={() => loadRecovered(pendingRun.rawText, pendingRun.prompt)}
                className="mt-1.5 rounded-lg border border-emerald-400/60 bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-100 transition-colors hover:bg-emerald-500/30"
              >
                Load it
              </button>
              <button
                type="button"
                onClick={() => setPendingRun(null)}
                className="ml-2 rounded-lg border border-da-border/50 px-3 py-1 text-xs text-da-muted transition-colors hover:bg-da-hover"
              >
                Not now
              </button>
            </div>
          )}

          {pendingRun?.kind === "running" && (
            <div className="rounded border border-sky-500/40 bg-sky-500/10 px-2 py-1.5 text-xs text-sky-300">
              <p className="font-semibold">Still generating on the server</p>
              <p className="mt-0.5 text-sky-300/80">
                This packet is being built in the background. You can close this tab, or shut the laptop — it will
                keep going, and it will be waiting here when you come back.
              </p>
            </div>
          )}

          {pendingRun?.kind === "failed" && (
            <div className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs text-red-400">
              <p className="font-semibold">A background generation failed</p>
              <p className="mt-0.5 text-red-400/80">{pendingRun.message}</p>
              <button
                type="button"
                onClick={() => setPendingRun(null)}
                className="mt-1.5 rounded-lg border border-da-border/50 px-3 py-1 text-xs text-da-muted transition-colors hover:bg-da-hover"
              >
                Dismiss
              </button>
            </div>
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
                    <span className="italic text-amber-300/70">"{issue.promptTail}"</span>
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
                The numbers in this draft do not line up: a question/Part sequence has gaps, duplicates or runs
                backwards, or the prose cites a question this packet does not have. Questions may have been dropped
                during generation, or the model miscounted its own list. Regenerate, or fix the numbering by hand
                before downloading.
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

          {tokIssues.length > 0 && (
            <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-300">
              <p className="font-semibold">
                ⚠ {tokIssues.length} TOK issue{tokIssues.length === 1 ? "" : "s"} in this draft
              </p>
              <p className="mt-0.5 text-amber-300/80">
                A provocation that names nothing from this packet could have been written without reading it.
                Ask for a rewrite citing the rule below — the generator keeps the draft and revises it.
              </p>
              <ul className="mt-1 space-y-0.5">
                {tokIssues.map((issue, i) => (
                  <li key={`${issue.kind}-${i}`} className="text-amber-200/90">
                    <span className="font-medium">{issue.location}</span>{" "}
                    <span className="text-amber-300/60">({issue.rule})</span>{" "}
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
              title="Parks a draft copy in your Templates list. This is NOT a Nuanced Analysis save — it has no course, section, or continuity tracking, and will not appear in Manage Saved Packets. Use the 'Save as Nuanced Analysis' button below the preview for that."
              className="w-full rounded-lg border border-da-border/50 bg-da-bg/30 px-3 py-1.5 text-xs font-medium text-da-muted transition-colors hover:bg-da-hover disabled:opacity-50"
            >
              {saveStatus === "saving" ? "Saving draft…" : saveStatus === "saved" ? "✓ Draft saved (not a Nuanced Analysis — see below)" : saveStatus === "error" ? "Save failed" : "Save draft (not a Nuanced Analysis)"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
