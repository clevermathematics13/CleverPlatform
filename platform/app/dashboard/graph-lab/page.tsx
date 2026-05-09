"use client";

import dynamic from "next/dynamic";
import { useState, useRef, useCallback, useEffect } from "react";
import { encodeGraphSpec, type IbGraphSpec } from "@/components/IbGraph";

const IbGraph = dynamic(() => import("@/components/IbGraph"), { ssr: false });
const GRAPH_LAB_IMAGES_STORAGE_KEY = "graph-lab:images:v1";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExtractResult {
  graphSpec: IbGraphSpec;
  graphMeta: Record<string, unknown>;
  warnings: string[];
  feedback: string[];
  metadata?: Record<string, unknown>;
  pass1Raw?: string;
  pass2Raw?: string;
}

interface ExtractFailure {
  status: number;
  error: string;
  warnings: string[];
  feedback: string[];
  graphSpec?: IbGraphSpec;
  graphMeta?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  pass1Raw?: string;
  pass2Raw?: string;
}

interface ExtractRequestContext {
  endpoint: string;
  requestedAt: string;
  requestId: string;
  cacheBypassNonce: string;
  imageCount: number;
  firstImageMimeType?: string;
  firstImageBase64Chars: number;
  firstImageHash: string;
}

interface ExtractSnapshot {
  status: number;
  ok: boolean;
  error?: string;
  warnings: string[];
  feedback: string[];
  graphSpec?: IbGraphSpec;
  graphMeta?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  requestContext?: ExtractRequestContext;
  pass1Raw?: string;
  pass2Raw?: string;
}

interface GraphMetaLite {
  domain?: [number, number];
  keyPoints?: Array<{ x: number; y: number; label?: string }>;
  description?: string;
  equations?: string[];
  xIntercepts?: { x: number }[];
  yIntercepts?: { y: number }[];
  verticalAsymptotes?: number[];
  horizontalAsymptotes?: string[];
  markschemeHints?: string[];
}

interface WindowConfidenceContext {
  status?: number;
  error?: string;
  warnings?: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // strip the data URL prefix, keep only the base64 part
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function hashStringFNV1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function buildRequestId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${rand}`;
}

function formatBound(value: number): string {
  const rounded = Number(value.toFixed(6));
  if (Object.is(rounded, -0)) return "0";
  return String(rounded);
}

function formatInterval(interval: [number, number] | null): string {
  if (!interval) return "(unavailable)";
  return `[${formatBound(interval[0])},${formatBound(interval[1])}]`;
}

function normalizeInterval(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

function computeGraphDomain(spec: IbGraphSpec, graphMeta?: GraphMetaLite | null): [number, number] | null {
  if (
    Array.isArray(graphMeta?.domain) &&
    graphMeta.domain.length === 2 &&
    Number.isFinite(graphMeta.domain[0]) &&
    Number.isFinite(graphMeta.domain[1])
  ) {
    return normalizeInterval(graphMeta.domain[0], graphMeta.domain[1]);
  }

  const xs: number[] = [];
  for (const el of spec.elements) {
    if ((el.type === "line" || el.type === "fn") && typeof el.xMin === "number" && typeof el.xMax === "number") {
      xs.push(el.xMin, el.xMax);
    } else if (el.type === "point") {
      xs.push(el.x);
    }
  }

  if (xs.length === 0) return null;
  return [Math.min(...xs), Math.max(...xs)];
}

function computeSegmentDomain(spec: IbGraphSpec): [number, number] | null {
  const xs: number[] = [];
  for (const el of spec.elements) {
    if ((el.type === "line" || el.type === "fn") && typeof el.xMin === "number" && typeof el.xMax === "number") {
      xs.push(el.xMin, el.xMax);
    }
  }
  if (xs.length === 0) return null;
  return [Math.min(...xs), Math.max(...xs)];
}

function computePointSupportedDomain(spec: IbGraphSpec): [number, number] | null {
  const xs = spec.elements
    .filter((el): el is Extract<IbGraphSpec["elements"][number], { type: "point" }> => el.type === "point")
    .map((p) => p.x)
    .filter((x) => Number.isFinite(x));

  if (xs.length < 2) return null;
  return [Math.min(...xs), Math.max(...xs)];
}

function computeGraphRange(spec: IbGraphSpec, graphMeta?: GraphMetaLite | null): [number, number] | null {
  const ys: number[] = [];

  if (Array.isArray(graphMeta?.keyPoints)) {
    for (const p of graphMeta.keyPoints) {
      if (Number.isFinite(p?.y)) ys.push(p.y);
    }
  }

  for (const el of spec.elements) {
    if (el.type === "point" && Number.isFinite(el.y)) ys.push(el.y);
  }

  if (ys.length === 0) return null;
  return [Math.min(...ys), Math.max(...ys)];
}

function buildWindowReadout(
  spec: IbGraphSpec | null,
  graphMeta?: GraphMetaLite | null,
  confidenceContext?: WindowConfidenceContext | null
): string {
  if (!spec) {
    return "Window\nx-axis: (unavailable)\ny-axis: (unavailable)\n\nGraph domain: (unavailable)\nGraph range: (unavailable)\nConfidence: unknown";
  }

  const windowX =
    Array.isArray(spec.xRange) && spec.xRange.length === 2 && Number.isFinite(spec.xRange[0]) && Number.isFinite(spec.xRange[1])
      ? normalizeInterval(spec.xRange[0], spec.xRange[1])
      : null;
  const windowY =
    Array.isArray(spec.yRange) && spec.yRange.length === 2 && Number.isFinite(spec.yRange[0]) && Number.isFinite(spec.yRange[1])
      ? normalizeInterval(spec.yRange[0], spec.yRange[1])
      : null;

  const domain = computeGraphDomain(spec, graphMeta);
  const range = computeGraphRange(spec, graphMeta);
  const segmentDomain = computeSegmentDomain(spec);
  const pointDomain = computePointSupportedDomain(spec);
  const domainMismatch =
    !!segmentDomain &&
    !!pointDomain &&
    (Math.abs(segmentDomain[0] - pointDomain[0]) > 1e-6 || Math.abs(segmentDomain[1] - pointDomain[1]) > 1e-6);

  const warnings = confidenceContext?.warnings ?? [];
  const hasUncertaintyWarning = warnings.some((w) => {
    const lower = w.toLowerCase();
    return (
      lower.includes("extraction uncertainty gate triggered") ||
      lower.includes("domain mismatch detected") ||
      lower.includes("manual review required")
    );
  });

  const uncertainStatus = confidenceContext?.status === 422;
  const uncertainError = (confidenceContext?.error ?? "").toLowerCase().includes("manual review required");
  const confidenceForcedLow = uncertainStatus || uncertainError || hasUncertaintyWarning;

  const confidenceLine = domainMismatch
    ? `Confidence: LOW (segment domain ${formatInterval(segmentDomain)} vs point-supported ${formatInterval(pointDomain)})`
    : confidenceForcedLow
      ? "Confidence: LOW (extraction returned uncertainty signals; manual endpoint review required)"
      : "Confidence: normal";

  return [
    "Window",
    `x-axis: ${formatInterval(windowX)}`,
    `y-axis: ${formatInterval(windowY)}`,
    "",
    `Graph domain: ${formatInterval(domain)}`,
    `Graph range: ${formatInterval(range)}`,
    confidenceLine,
  ].join("\n");
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function GraphLabPage() {
  const [images, setImages] = useState<Array<{ fileName: string; mimeType: string; b64: string; url: string }>>([]);
  const [imagesRestored, setImagesRestored] = useState(false);
  const [freshValidationMode, setFreshValidationMode] = useState(true);
  const [questionLatex, setQuestionLatex] = useState("");
  const [msLatex, setMsLatex] = useState("");

  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractFailure, setExtractFailure] = useState<ExtractFailure | null>(null);
  const [extractSnapshot, setExtractSnapshot] = useState<ExtractSnapshot | null>(null);
  const [failureCopied, setFailureCopied] = useState(false);
  const [debugCopied, setDebugCopied] = useState(false);
  const [windowCopied, setWindowCopied] = useState(false);
  const [result, setResult] = useState<ExtractResult | null>(null);

  const [specJson, setSpecJson] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showPass1, setShowPass1] = useState(false);
  const [showPass2, setShowPass2] = useState(false);

  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (freshValidationMode) {
      setImagesRestored(true);
      return;
    }
    try {
      const raw = localStorage.getItem(GRAPH_LAB_IMAGES_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Array<{ fileName: string; mimeType: string; b64: string }>;
      if (!Array.isArray(parsed) || parsed.length === 0) return;
      const restored = parsed
        .filter((img) => typeof img?.b64 === "string" && typeof img?.mimeType === "string" && typeof img?.fileName === "string")
        .map((img) => ({
          fileName: img.fileName,
          mimeType: img.mimeType,
          b64: img.b64,
          url: `data:${img.mimeType};base64,${img.b64}`,
        }));
      if (restored.length > 0) {
        requestAnimationFrame(() => setImages(restored));
      }
    } catch {
      // Ignore malformed saved image payloads.
    } finally {
      setImagesRestored(true);
    }
  }, [freshValidationMode]);

  useEffect(() => {
    if (!imagesRestored) return;
    if (freshValidationMode) {
      try {
        localStorage.removeItem(GRAPH_LAB_IMAGES_STORAGE_KEY);
      } catch {
        // Ignore storage quota / browser privacy restrictions.
      }
      return;
    }
    try {
      if (images.length === 0) {
        localStorage.removeItem(GRAPH_LAB_IMAGES_STORAGE_KEY);
        return;
      }
      localStorage.setItem(
        GRAPH_LAB_IMAGES_STORAGE_KEY,
        JSON.stringify(images.map((img) => ({ fileName: img.fileName, mimeType: img.mimeType, b64: img.b64 })))
      );
    } catch {
      // Ignore storage quota / browser privacy restrictions.
    }
  }, [images, imagesRestored, freshValidationMode]);

  // ── Image selection ──────────────────────────────────────────────────────
  const addFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    const entries = await Promise.all(
      arr.map(async (file) => ({
        fileName: file.name,
        mimeType: file.type || "image/png",
        b64: await fileToBase64(file),
        url: "",
      }))
    );
    setImages((prev) => [
      ...prev,
      ...entries.map((entry) => ({
        ...entry,
        url: `data:${entry.mimeType};base64,${entry.b64}`,
      })),
    ]);
  }, []);

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) void addFiles(e.target.files);
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files) void addFiles(e.dataTransfer.files);
  };

  const removeImage = (idx: number) => {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  };

  // ── Extraction ───────────────────────────────────────────────────────────
  async function runExtract() {
    if (!images.length) return;
    const requestId = buildRequestId("graph-lab");
    const cacheBypassNonce = buildRequestId("nonce");
    const firstImageHash = hashStringFNV1a(images[0]?.b64 ?? "");
    const requestContext: ExtractRequestContext = {
      endpoint: "/api/graph-lab",
      requestedAt: new Date().toISOString(),
      requestId,
      cacheBypassNonce,
      imageCount: images.length,
      firstImageMimeType: images[0]?.mimeType,
      firstImageBase64Chars: images[0]?.b64?.length ?? 0,
      firstImageHash,
    };
    setExtracting(true);
    setExtractError(null);
    setExtractFailure(null);
    setExtractSnapshot(null);
    setDebugCopied(false);
    setResult(null);
    setParseError(null);
    try {
      const res = await fetch(`/api/graph-lab?nonce=${encodeURIComponent(cacheBypassNonce)}`, {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store, no-cache, max-age=0",
          Pragma: "no-cache",
          "X-Request-Id": requestId,
          "X-Input-Hash": firstImageHash,
        },
        body: JSON.stringify({
          images: images.map((i) => i.b64),
          mediaType: images[0].mimeType === "image/jpeg" ? "image/jpeg" : "image/png",
          questionLatex,
          msLatex,
        }),
      });
      const data = (await res.json()) as ExtractResult & {
        error?: string;
        warnings?: string[];
        feedback?: string[];
        graphSpec?: IbGraphSpec;
        graphMeta?: Record<string, unknown>;
        pass1Raw?: string;
        pass2Raw?: string;
      };
      if (!res.ok) {
        const failure: ExtractFailure = {
          status: res.status,
          error: data.error ?? "Extraction failed",
          warnings: data.warnings ?? [],
          feedback: data.feedback ?? [],
          graphSpec: data.graphSpec,
          graphMeta: data.graphMeta,
          metadata: data.metadata,
          pass1Raw: data.pass1Raw,
          pass2Raw: data.pass2Raw,
        };
        setExtractError(data.error ?? "Extraction failed");
        setExtractFailure(failure);
        setExtractSnapshot({
          status: failure.status,
          ok: false,
          error: failure.error,
          warnings: failure.warnings,
          feedback: failure.feedback,
          graphSpec: failure.graphSpec,
          graphMeta: failure.graphMeta,
          metadata: failure.metadata,
          requestContext,
          pass1Raw: failure.pass1Raw,
          pass2Raw: failure.pass2Raw,
        });
        // Still populate specJson if we have a graphSpec (e.g., for 422 uncertain responses)
        if (failure.graphSpec) {
          setSpecJson(JSON.stringify(failure.graphSpec, null, 2));
        }
        return;
      }
      setResult(data);
      setExtractSnapshot({
        status: res.status,
        ok: true,
        warnings: Array.isArray(data.warnings) ? data.warnings : [],
        feedback: Array.isArray(data.feedback) ? data.feedback : [],
        graphSpec: data.graphSpec,
        graphMeta: data.graphMeta,
        metadata: data.metadata,
        requestContext,
        pass1Raw: data.pass1Raw,
        pass2Raw: data.pass2Raw,
      });
      setSpecJson(JSON.stringify(data.graphSpec, null, 2));
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unexpected error";
      setExtractError(message);
      setExtractSnapshot({
        status: 0,
        ok: false,
        error: message,
        warnings: [],
        feedback: ["Retry extraction and verify vertices/domains manually before using the graph marker."],
        requestContext,
      });
    } finally {
      setExtracting(false);
    }
  }

  async function runExtractCV() {
    if (!images.length) return;
    const requestId = buildRequestId("graph-lab-cv");
    const cacheBypassNonce = buildRequestId("nonce");
    const firstImageHash = hashStringFNV1a(images[0]?.b64 ?? "");
    const requestContext: ExtractRequestContext = {
      endpoint: "/api/graph-lab-cv",
      requestedAt: new Date().toISOString(),
      requestId,
      cacheBypassNonce,
      imageCount: images.length,
      firstImageMimeType: images[0]?.mimeType,
      firstImageBase64Chars: images[0]?.b64?.length ?? 0,
      firstImageHash,
    };
    setExtracting(true);
    setExtractError(null);
    setExtractFailure(null);
    setExtractSnapshot(null);
    setDebugCopied(false);
    setResult(null);
    setParseError(null);
    try {
      const res = await fetch(`/api/graph-lab-cv?nonce=${encodeURIComponent(cacheBypassNonce)}`, {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store, no-cache, max-age=0",
          Pragma: "no-cache",
          "X-Request-Id": requestId,
          "X-Input-Hash": firstImageHash,
        },
        body: JSON.stringify({
          images: images.map((i) => i.b64),
          mediaType: images[0].mimeType === "image/jpeg" ? "image/jpeg" : "image/png",
        }),
      });
      const data = (await res.json()) as ExtractResult & {
        error?: string;
        warnings?: string[];
        feedback?: string[];
        graphSpec?: IbGraphSpec;
        graphMeta?: Record<string, unknown>;
        metadata?: Record<string, unknown>;
      };
      if (!res.ok) {
        const failure: ExtractFailure = {
          status: res.status,
          error: data.error ?? "CV extraction failed",
          warnings: data.warnings ?? [],
          feedback: data.feedback ?? [],
          graphSpec: data.graphSpec,
          graphMeta: data.graphMeta,
          metadata: data.metadata,
        };
        setExtractError(data.error ?? "CV extraction failed");
        setExtractFailure(failure);
        setExtractSnapshot({
          status: failure.status,
          ok: false,
          error: failure.error,
          warnings: failure.warnings,
          feedback: failure.feedback,
          graphSpec: failure.graphSpec,
          graphMeta: failure.graphMeta,
          metadata: failure.metadata,
          requestContext,
        });
        if (failure.graphSpec) {
          setSpecJson(JSON.stringify(failure.graphSpec, null, 2));
        }
        return;
      }
      setResult(data);
      setExtractSnapshot({
        status: res.status,
        ok: true,
        warnings: Array.isArray(data.warnings) ? data.warnings : [],
        feedback: Array.isArray(data.feedback) ? data.feedback : [],
        graphSpec: data.graphSpec,
        graphMeta: data.graphMeta,
        metadata: data.metadata,
        requestContext,
      });
      setSpecJson(JSON.stringify(data.graphSpec, null, 2));
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unexpected error";
      setExtractError(message);
      setExtractSnapshot({
        status: 0,
        ok: false,
        error: message,
        warnings: [],
        feedback: ["CV extraction error: check browser console for details"],
        requestContext,
      });
    } finally {
      setExtracting(false);
    }
  }

  // ── Parse / preview ──────────────────────────────────────────────────────
  // Pure — no state side-effects, safe to call during render.
  function tryParseSpec(json: string): IbGraphSpec | null {
    try { return JSON.parse(json) as IbGraphSpec; } catch { return null; }
  }

  function copyMarker() {
    const s = tryParseSpec(specJson);
    if (!s) return;
    const marker = encodeGraphSpec(s);
    void navigator.clipboard.writeText(marker).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function formatFailureReport(failure: ExtractFailure): string {
    const lines: string[] = [];
    lines.push(`Status: ${failure.status}`);
    lines.push("");
    lines.push(`Error: ${failure.error}`);
    lines.push("");
    lines.push("Warnings");
    if (failure.warnings.length > 0) {
      lines.push(...failure.warnings);
    } else {
      lines.push("(none)");
    }
    lines.push("");
    lines.push("Improvement feedback");
    if (failure.feedback.length > 0) {
      lines.push(...failure.feedback);
    } else {
      lines.push("(none)");
    }
    if (failure.graphSpec) {
      lines.push("");
      lines.push("Returned graphSpec JSON");
      lines.push(JSON.stringify(failure.graphSpec, null, 2));
    }
    if (failure.graphMeta) {
      lines.push("");
      lines.push("Returned graphMeta JSON");
      lines.push(JSON.stringify(failure.graphMeta, null, 2));
    }
    if (failure.pass1Raw) {
      lines.push("");
      lines.push("Pass 1 raw output");
      lines.push(failure.pass1Raw);
    }
    if (failure.pass2Raw) {
      lines.push("");
      lines.push("Pass 2 raw output");
      lines.push(failure.pass2Raw);
    }
    return lines.join("\n");
  }

  function copyFailureReport() {
    if (!extractFailure) return;
    const text = formatFailureReport(extractFailure);
    void navigator.clipboard.writeText(text).then(() => {
      setFailureCopied(true);
      setTimeout(() => setFailureCopied(false), 2000);
    });
  }

  function summariseRenderedSegments(spec?: IbGraphSpec): string {
    if (!spec?.elements?.length) return "(none)";
    const segs = spec.elements
      .filter((el): el is Extract<IbGraphSpec["elements"][number], { type: "line" | "fn" }> => el.type === "line" || el.type === "fn")
      .map((el, i) => `${i + 1}. ${el.type} on [${typeof el.xMin === "number" ? el.xMin : "?"}, ${typeof el.xMax === "number" ? el.xMax : "?"}] => ${el.expr}`);
    return segs.length > 0 ? segs.join("\n") : "(none)";
  }

  function formatDebugPacket(snapshot: ExtractSnapshot): string {
    const lines: string[] = [];
    lines.push("Graph Lab extraction debug packet");
    lines.push(`Status: ${snapshot.status} (${snapshot.ok ? "ok" : "error"})`);
    lines.push("");
    if (snapshot.error) {
      lines.push("Error");
      lines.push(snapshot.error);
      lines.push("");
    }
    lines.push("Warnings");
    lines.push(snapshot.warnings.length > 0 ? snapshot.warnings.map((w) => `- ${w}`).join("\n") : "(none)");
    lines.push("");
    lines.push("Improvement feedback");
    lines.push(snapshot.feedback.length > 0 ? snapshot.feedback.map((f) => `- ${f}`).join("\n") : "(none)");
    lines.push("");
    lines.push("Rendered segment summary");
    lines.push(summariseRenderedSegments(snapshot.graphSpec));
    lines.push("");
    lines.push("Window / domain-range QA");
    lines.push(
      buildWindowReadout(
        snapshot.graphSpec ?? null,
        (snapshot.graphMeta as GraphMetaLite | undefined) ?? null,
        { status: snapshot.status, error: snapshot.error, warnings: snapshot.warnings }
      )
    );
    if (snapshot.requestContext) {
      lines.push("");
      lines.push("Request context");
      lines.push(JSON.stringify(snapshot.requestContext, null, 2));
    }
    if (snapshot.metadata) {
      lines.push("");
      lines.push("Execution diagnostics");
      lines.push(JSON.stringify(snapshot.metadata, null, 2));
    }
    if (snapshot.graphSpec) {
      lines.push("");
      lines.push("Rendered graphSpec JSON");
      lines.push(JSON.stringify(snapshot.graphSpec, null, 2));
    }
    if (snapshot.graphMeta) {
      lines.push("");
      lines.push("Rendered graphMeta JSON");
      lines.push(JSON.stringify(snapshot.graphMeta, null, 2));
    }
    if (snapshot.pass1Raw) {
      lines.push("");
      lines.push("Pass 1 raw output");
      lines.push(snapshot.pass1Raw);
    }
    if (snapshot.pass2Raw) {
      lines.push("");
      lines.push("Pass 2 raw output");
      lines.push(snapshot.pass2Raw);
    }
    return lines.join("\n");
  }

  function copyDebugPacket() {
    if (!extractSnapshot) return;
    const text = formatDebugPacket(extractSnapshot);
    void navigator.clipboard.writeText(text).then(() => {
      setDebugCopied(true);
      setTimeout(() => setDebugCopied(false), 2000);
    });
  }

  function copyWindowOutput() {
    void navigator.clipboard.writeText(windowReadout).then(() => {
      setWindowCopied(true);
      setTimeout(() => setWindowCopied(false), 2000);
    });
  }

  const spec = specJson ? tryParseSpec(specJson) : null;
  const activeGraphMeta = (result?.graphMeta || extractSnapshot?.graphMeta) as GraphMetaLite | null;
  const windowReadout = buildWindowReadout(spec, activeGraphMeta, {
    status: extractSnapshot?.status,
    error: extractSnapshot?.error,
    warnings: extractSnapshot?.warnings,
  });

  return (
    <div className="min-h-screen bg-gray-50 p-6" suppressHydrationWarning>
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3" suppressHydrationWarning>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-1">Graph Lab</h1>
            <p className="text-sm text-gray-500">
              Upload any graph image, run 2-pass Claude extraction, refine the JSON, and copy the{" "}
              <code className="bg-gray-100 px-1 rounded text-xs">{"[[GRAPH_JSON:...]]"}</code> marker
              to paste into any LaTeX content box.
            </p>
          </div>
          <button
            type="button"
            onClick={copyMarker}
            disabled={!specJson || !!parseError}
            className={`shrink-0 px-3 py-2 rounded text-xs font-bold transition-colors ${
              !specJson || !!parseError
                ? "bg-gray-300 text-gray-600 cursor-not-allowed"
                : "bg-green-600 text-white hover:bg-green-700"
            }`}
            suppressHydrationWarning
          >
            {copied ? "✓ Copied" : "Copy"}
          </button>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6" suppressHydrationWarning>
          {/* ── Left column: inputs ─────────────────────────────────────── */}
          <div className="flex flex-col gap-4" suppressHydrationWarning>

            {/* Image drop zone */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">
                Graph Images
              </h2>
              <div
                ref={dropRef}
                onDrop={onDrop}
                onDragOver={(e) => e.preventDefault()}
                className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
                onClick={() => document.getElementById("graph-lab-file-input")?.click()}
              >
                <p className="text-sm text-gray-500">
                  Drop image(s) here or <span className="text-blue-600 underline">click to browse</span>
                </p>
                <p className="text-xs text-gray-400 mt-1">PNG, JPEG — can drop multiple (e.g. both pages)</p>
              </div>
              <input
                id="graph-lab-file-input"
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={onFileInput}
              />

              {images.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {images.map((img, idx) => (
                    <div key={idx} className="relative group">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.url}
                        alt={`Image ${idx + 1}`}
                        className="w-32 h-24 object-contain rounded border border-gray-200 bg-white"
                      />
                      <button
                        type="button"
                        onClick={() => removeImage(idx)}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white text-xs font-bold leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        ×
                      </button>
                      <p className="text-center text-[10px] text-gray-400 mt-0.5">
                        {img.fileName.slice(0, 18)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Optional context */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">
                Optional Context <span className="font-normal normal-case text-gray-400">(improves Pass 2 verification)</span>
              </h2>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Question LaTeX</label>
              <textarea
                rows={3}
                value={questionLatex}
                onChange={(e) => setQuestionLatex(e.target.value)}
                placeholder="Paste question LaTeX here…"
                className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs font-mono resize-y focus:outline-none focus:ring-1 focus:ring-blue-400"
                suppressHydrationWarning
              />
              <label className="block text-xs font-semibold text-gray-600 mt-2 mb-1">Markscheme LaTeX</label>
              <textarea
                rows={3}
                value={msLatex}
                onChange={(e) => setMsLatex(e.target.value)}
                placeholder="Paste markscheme LaTeX here…"
                className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs font-mono resize-y focus:outline-none focus:ring-1 focus:ring-blue-400"
                suppressHydrationWarning
              />
            </div>

            {/* Extract button */}
            <div className="flex flex-wrap items-center gap-2">
              <label className="w-full flex items-center gap-2 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={freshValidationMode}
                  onChange={(e) => setFreshValidationMode(e.target.checked)}
                  className="rounded border-gray-300"
                />
                Fresh validation mode (no image restore, no local caching)
              </label>
              <button
                type="button"
                onClick={() => void runExtractCV()}
                disabled={extracting || images.length === 0}
                className="flex-1 min-w-55 rounded-lg py-3 text-sm font-bold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                suppressHydrationWarning
              >
                {extracting ? (
                  <><span className="inline-block w-4 h-4 border-2 border-green-200 border-t-white rounded-full animate-spin" /> Extracting (CV)…</>
                ) : (
                  "🎯 Extract Graph (CV - Deterministic)"
                )}
              </button>
              <button
                type="button"
                onClick={() => void runExtract()}
                disabled={extracting || images.length === 0}
                className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-3 text-xs font-bold text-amber-700 hover:bg-amber-50"
                suppressHydrationWarning
              >
                {extracting ? "Extracting…" : "Claude LLM (Alt)"}
              </button>
              {extractSnapshot && (
                <button
                  type="button"
                  onClick={copyDebugPacket}
                  className="shrink-0 rounded-lg border border-indigo-300 bg-white px-3 py-2.5 text-xs font-bold text-indigo-700 hover:bg-indigo-50"
                >
                  {debugCopied ? "✓ Copied" : "Copy Graph Debug Packet"}
                </button>
              )}
            </div>

            {extractError && (
              <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
                {extractError}
              </div>
            )}

            {extractFailure && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-bold text-red-800">
                    {extractFailure.status === 422
                      ? "Continuity gate rejected this extraction"
                      : "Extraction failed"}
                  </p>
                  <button
                    type="button"
                    onClick={copyFailureReport}
                    className="rounded px-2.5 py-1 text-[11px] font-bold bg-red-600 text-white hover:bg-red-700"
                  >
                    {failureCopied ? "✓ Copied" : "Copy Full Failure Report"}
                  </button>
                </div>

                <details>
                  <summary className="cursor-pointer text-xs font-bold text-red-800">
                    Click for details
                  </summary>
                <div className="mt-2 space-y-2">
                  <p className="text-xs text-red-700">
                    <span className="font-semibold">Status:</span> {extractFailure.status}
                  </p>
                  <p className="text-xs text-red-700">
                    <span className="font-semibold">Error:</span> {extractFailure.error}
                  </p>

                  {extractFailure.warnings.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-red-800">Warnings</p>
                      <ul className="list-disc ml-4 space-y-0.5">
                        {extractFailure.warnings.map((w, i) => (
                          <li key={i} className="text-xs text-red-700">{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {extractFailure.feedback.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-red-800">Improvement feedback</p>
                      <ul className="list-disc ml-4 space-y-0.5">
                        {extractFailure.feedback.map((tip, i) => (
                          <li key={i} className="text-xs text-red-700">{tip}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {extractFailure.graphSpec && (
                    <details>
                      <summary className="cursor-pointer text-xs font-semibold text-red-800">Returned graphSpec JSON</summary>
                      <pre className="mt-1 rounded bg-white border border-red-100 p-2 text-[10px] leading-relaxed overflow-x-auto whitespace-pre-wrap max-h-56 text-red-900">
                        {JSON.stringify(extractFailure.graphSpec, null, 2)}
                      </pre>
                    </details>
                  )}

                  {extractFailure.graphMeta && (
                    <details>
                      <summary className="cursor-pointer text-xs font-semibold text-red-800">Returned graphMeta JSON</summary>
                      <pre className="mt-1 rounded bg-white border border-red-100 p-2 text-[10px] leading-relaxed overflow-x-auto whitespace-pre-wrap max-h-56 text-red-900">
                        {JSON.stringify(extractFailure.graphMeta, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
                </details>
              </div>
            )}

            {/* Warnings */}
            {result && result.warnings.length > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
                <p className="text-xs font-bold text-amber-700 mb-1">Verification warnings</p>
                <ul className="list-disc ml-4 space-y-0.5">
                  {result.warnings.map((w, i) => <li key={i} className="text-xs text-amber-700">{w}</li>)}
                </ul>
              </div>
            )}

            {extractSnapshot && extractSnapshot.feedback.length > 0 && (
              <div className="rounded-lg border border-blue-300 bg-blue-50 px-4 py-3">
                <p className="text-xs font-bold text-blue-700 mb-1">Suggested improvements (always review)</p>
                <ul className="list-disc ml-4 space-y-0.5">
                  {extractSnapshot.feedback.map((tip, i) => <li key={i} className="text-xs text-blue-700">{tip}</li>)}
                </ul>
              </div>
            )}

            {/* Raw Claude outputs */}
            {result?.pass1Raw && (
              <details open={showPass1} onToggle={(e) => setShowPass1((e.currentTarget as HTMLDetailsElement).open)}>
                <summary className="cursor-pointer text-xs font-semibold text-gray-500 hover:text-gray-700">
                  {showPass1 ? "▾" : "▸"} Pass 1 raw output
                </summary>
                <pre className="mt-1 rounded bg-gray-50 border border-gray-200 p-2 text-[10px] leading-relaxed overflow-x-auto whitespace-pre-wrap max-h-60">
                  {result.pass1Raw}
                </pre>
              </details>
            )}
            {result?.pass2Raw && (
              <details open={showPass2} onToggle={(e) => setShowPass2((e.currentTarget as HTMLDetailsElement).open)}>
                <summary className="cursor-pointer text-xs font-semibold text-gray-500 hover:text-gray-700">
                  {showPass2 ? "▾" : "▸"} Pass 2 raw output
                </summary>
                <pre className="mt-1 rounded bg-gray-50 border border-gray-200 p-2 text-[10px] leading-relaxed overflow-x-auto whitespace-pre-wrap max-h-60">
                  {result.pass2Raw}
                </pre>
              </details>
            )}
          </div>

          {/* ── Right column: editor + preview ──────────────────────────── */}
          <div className="flex flex-col gap-4" suppressHydrationWarning>

            {/* JSON editor */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-2" suppressHydrationWarning>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">
                  Graph Spec JSON
                </h2>
                <button
                  type="button"
                  onClick={copyMarker}
                  disabled={!specJson || !!parseError}
                  className="ml-auto rounded px-3 py-1.5 text-xs font-bold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                  suppressHydrationWarning
                >
                  {copied ? "✓ Copied!" : "Copy [[GRAPH_JSON:…]] marker"}
                </button>
              </div>

              {parseError && (
                <p className="text-xs text-red-600 font-mono">{parseError}</p>
              )}

              <textarea
                rows={22}
                value={specJson}
                onChange={(e) => {
                setSpecJson(e.target.value);
                try { JSON.parse(e.target.value); setParseError(null); }
                catch (err) { setParseError(String(err)); }
              }}
                spellCheck={false}
                placeholder={'{\n  "xRange": [-5, 5],\n  "yRange": [-5, 5],\n  "elements": []\n}'}
                className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs font-mono resize-y focus:outline-none focus:ring-1 focus:ring-blue-400"
                suppressHydrationWarning
              />

              {/* GraphMeta panel */}
              {(result?.graphMeta || extractSnapshot?.graphMeta) && (() => {
                const m = (result?.graphMeta || extractSnapshot?.graphMeta) as GraphMetaLite;
                return (
                  <details className="text-xs text-gray-600">
                    <summary className="cursor-pointer font-semibold text-gray-500 hover:text-gray-700">Graph metadata (from Claude)</summary>
                    <div className="mt-2 rounded bg-gray-50 border border-gray-100 p-3 space-y-1">
                      {m.description && <p><span className="font-semibold">Description:</span> {m.description}</p>}
                      {m.equations?.length ? <p><span className="font-semibold">Equations:</span> {m.equations.join(", ")}</p> : null}
                      {m.xIntercepts?.length ? <p><span className="font-semibold">x-intercepts:</span> {m.xIntercepts.map((i) => i.x).join(", ")}</p> : null}
                      {m.yIntercepts?.length ? <p><span className="font-semibold">y-intercepts:</span> {m.yIntercepts.map((i) => i.y).join(", ")}</p> : null}
                      {m.verticalAsymptotes?.length ? <p><span className="font-semibold">Vertical asymptotes:</span> {m.verticalAsymptotes.join(", ")}</p> : null}
                      {m.horizontalAsymptotes?.length ? <p><span className="font-semibold">Horizontal asymptotes:</span> {m.horizontalAsymptotes.join(", ")}</p> : null}
                      {m.markschemeHints?.length ? (
                        <div>
                          <p className="font-semibold">Mark-scheme hints:</p>
                          <ul className="list-disc ml-4">
                            {m.markschemeHints.map((h, i) => <li key={i}>{h}</li>)}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  </details>
                );
              })()}

              <div className="rounded border border-gray-200 bg-gray-50 p-3">
                <div className="mb-1 flex items-center gap-2">
                  <p className="text-xs font-semibold text-gray-600">Window / Domain / Range QA</p>
                  <button
                    type="button"
                    onClick={copyWindowOutput}
                    className="ml-auto rounded border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-bold text-gray-700 hover:bg-gray-100"
                  >
                    {windowCopied ? "✓ Copied" : "Copy Window Output"}
                  </button>
                </div>
                <textarea
                  value={windowReadout}
                  readOnly
                  rows={7}
                  className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-xs font-mono resize-y focus:outline-none"
                  suppressHydrationWarning
                />
              </div>
            </div>

            {/* Live preview + image comparison */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-4">
              <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Preview</h2>

              <div>
                <p className="text-xs font-semibold text-gray-500 mb-1">Rendered graph</p>
                {spec ? (
                  <div className="flex justify-center">
                    <div style={{ width: "min(100%, 380px)" }}>
                      <IbGraph spec={spec} />
                    </div>
                  </div>
                ) : specJson ? (
                  <p className="text-xs text-red-500 italic">Fix JSON to see preview</p>
                ) : (
                  <p className="text-xs text-gray-400 italic">Extract or type JSON above</p>
                )}
              </div>

              {images.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1">
                    Source image{images.length > 1 ? "s" : ""} (for comparison)
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {images.map((img, idx) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={idx}
                        src={img.url}
                        alt={`Source ${idx + 1}`}
                        className="max-w-full rounded border border-gray-200 object-contain bg-white"
                        style={{ maxHeight: 300 }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
