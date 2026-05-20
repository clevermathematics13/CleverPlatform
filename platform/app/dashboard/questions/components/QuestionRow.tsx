"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import LatexRenderer from "@/components/LatexRenderer";
import { IB_CORRECTION_SYSTEM, IB_CLASSIFY_SYSTEM, parseMSTokens } from "@/lib/latex-utils";
import { contextTermHighlightsFromFlags, deriveCommandTermFlags } from "@/lib/command-term-flags";
import { readJsonSafely } from "@/lib/http-json";
import { encodeGraphSpec, GRAPH_MARKER_RE, EXAMPLE_SPEC, type IbGraphSpec } from "@/components/IbGraph";
const IbGraph = dynamic(() => import("@/components/IbGraph"), { ssr: false });
import { ExtractionReviewModal } from "./ExtractionReviewModal";
import { ImageGroup } from "./ImageGroup";
import { SubtopicEditor } from "./SubtopicEditor";
import { CommandTermSelect } from "./CommandTermSelect";
import { splitDraftIntoParts } from "../review/split-draft-into-parts";
import {
  hasExplicitTopLevelPartStructure,
  shouldTrustMultipartWithoutExplicit,
  shouldBlockPartAutoSave,
} from "../part-structure";
import {
  mergeHighlightTerms,
  detectCommandTerms,
  primaryCommandTerm,
  filterPriorLearning,
  parseMarksFromLatex,
  normalizePartLabelKey,
  romanSubpartStem,
  DEFAULT_COMMAND_TERMS,
  chooseCommandTerm,
  chooseCommandTerms,
  detectPartLabels,
} from "./question-utils";
import { useMarkAttribution } from "./useMarkAttribution";
import type {
  Question,
  QuestionPart,
  QuestionImage,
  Subtopic,
  GraphImageCrop,
  GraphExtractFailure,
  GraphExtractSnapshot,
  ExtractPlan,
} from "./types";

const GRAPH_ELEMENT_REFERENCE = `Supported element types:

{ "type": "fn",         "expr": "x^2 - 2",          "color": "#1a56db", "dashed": false, "label": "f(x)", "xMin": -3, "xMax": 3 }
{ "type": "vasymptote", "x": 2,                      "label": "x = 2" }
{ "type": "hasymptote", "y": -1,                     "label": "y = -1" }
{ "type": "line",       "expr": "2*x + 1",           "dashed": true,    "label": "tangent" }
{ "type": "point",      "x": 2, "y": 3,              "label": "(2, 3)", "open": false }
{ "type": "guide",      "x": 2, "y": 3 }
{ "type": "shade",      "expr1": "x^2", "expr2": "2*x", "xMin": 0, "xMax": 2, "color": "#1a56db" }
{ "type": "parametric", "xt": "cos(t)", "yt": "sin(t)", "tMin": 0, "tMax": 6.28, "color": "#e02424" }
{ "type": "label",      "x": 1, "y": 2,              "text": "A" }

Expr functions: sin cos tan arcsin arccos arctan ln log sqrt abs exp
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

  // Guard close: if section is required but not set, show inline prompt instead.
  const handleClose = () => {
    if (graphEditorOpen && graphSpecDirty) {
      if (!confirm("You have unsaved graph edits. Close anyway? (Click \"Save \u2192 Stem\" or \"Save \u2192 Parts Draft\" first to keep them.)")) return;
    }
    // Warn if any parts have multiple subtopics but no primary (★) selected
    const missingPrimary = question.question_parts.filter(
      (p) => (p.subtopic_codes?.length ?? 0) > 1 && !p.primary_subtopic_code
    );
    if (missingPrimary.length > 0) {
      const labels = missingPrimary
        .map((p) => (p.part_label ? `part (${p.part_label})` : "the whole question"))
        .join(", ");
      const plural = missingPrimary.length === 1;
      setPrimaryWarningDialog({ labels, plural });
      return;
    }
    proceedClose();
  };

  const proceedClose = () => {
    if (showSection && question.section === null) {
      setShowSectionPrompt(true);
    } else {
      setShowSectionPrompt(false);
      onClose();
    }
  };

  const handleRowClick = () => {
    if (!expanded) {
      onOpen();
      return;
    }
    handleClose();
  };
  const [parts, setParts] = useState<QuestionPart[]>(
    [...(question.question_parts ?? [])].sort((a, b) => a.sort_order - b.sort_order)
  );
  const [latexDrafts, setLatexDrafts] = useState<Record<string, { content_latex: string; markscheme_latex: string }>>(() => {
    const d: Record<string, { content_latex: string; markscheme_latex: string }> = {};
    question.question_parts.forEach((p) => {
      d[p.id] = { content_latex: p.content_latex ?? "", markscheme_latex: p.markscheme_latex ?? "" };
    });
    return d;
  });
  const [editingLatex, setEditingLatex] = useState<{ partId: string; field: "content_latex" | "markscheme_latex" } | null>(null);
  const [savingLatex, setSavingLatex] = useState(false);
  const [extractingLatexField, setExtractingLatexField] = useState<{ partId: string; field: "content_latex" | "markscheme_latex" } | null>(null);
  const [collapsedPartCards, setCollapsedPartCards] = useState<Set<string>>(() => {
    const s = new Set<string>();
    (question.question_parts ?? []).forEach((p) => {
      s.add(`${p.id}-content_latex`);
      s.add(`${p.id}-markscheme_latex`);
    });
    return s;
  });
  const [claudeInstruction, setClaudeInstruction] = useState<Record<string, string>>({}); // key: `${partId}-${field}`
  const [claudeLoading, setClaudeLoading] = useState<Record<string, boolean>>({});

  const { makeMarkAttributionRenderer } = useMarkAttribution(
    question.question_parts,
    availableSubtopics,
  );

  const togglePartCard = (cardKey: string) => {
    setCollapsedPartCards((prev) => {
      const next = new Set(prev);
      if (next.has(cardKey)) next.delete(cardKey);
      else next.add(cardKey);
      return next;
    });
  };

  // Full-question extraction state
  const [fullExtractState, setFullExtractState] = useState<"idle" | "confirm" | "running" | "reviewing">("idle");
  const [fullExtractLog, setFullExtractLog] = useState<string[]>([]);
  const [fullExtractError, setFullExtractError] = useState<string | null>(null);
  const [fullExtractCopied, setFullExtractCopied] = useState(false);
  const [extractLogCollapsed, setExtractLogCollapsed] = useState(false);
  const [extractPlan, setExtractPlan] = useState<ExtractPlan | null>(null);

  // Stem state (no separate edit for each field — share the same edit pattern)
  const [stemLatex, setStemLatex] = useState(question.stem_latex ?? "");
  const [stemMsLatex, setStemMsLatex] = useState(question.stem_markscheme_latex ?? "");
  const [stemDraftQ, setStemDraftQ] = useState(question.stem_latex ?? "");
  const [stemDraftMS, setStemDraftMS] = useState(question.stem_markscheme_latex ?? "");
  const [editingStem, setEditingStem] = useState<"stem_latex" | "stem_markscheme_latex" | null>(null);
  const [savingStem, setSavingStem] = useState(false);

  async function saveStem(field: "stem_latex" | "stem_markscheme_latex") {
    const value = field === "stem_latex" ? stemDraftQ : stemDraftMS;
    setSavingStem(true);
    try {
      await fetch("/api/questions/stem-update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: question.id, field, value }),
      });
      if (field === "stem_latex") setStemLatex(value);
      else setStemMsLatex(value);
      setEditingStem(null);
    } finally {
      setSavingStem(false);
    }
  }

  // Whole-question editor state (used when there are no labelled parts)
  const _wholeQPart = question.question_parts.find((p) => !p.part_label || p.part_label.trim() === "");
  const [wholeQDraft, setWholeQDraft] = useState(_wholeQPart?.content_latex ?? "");
  const [wholeMSDraft, setWholeMSDraft] = useState(_wholeQPart?.markscheme_latex ?? "");
  const [editingWhole, setEditingWhole] = useState<"q" | "ms" | null>(null);
  const [savingWhole, setSavingWhole] = useState(false);

  const [unlinkingDoc, setUnlinkingDoc] = useState<"q" | "ms" | null>(null);
  const [editingLinks, setEditingLinks] = useState(false);
  const [linkDraftQ, setLinkDraftQ] = useState(question.google_doc_id ?? "");
  const [linkDraftMS, setLinkDraftMS] = useState(question.google_ms_id ?? "");
  const [savingLinks, setSavingLinks] = useState(false);

  function extractDocId(urlOrId: string): string {
    const m = urlOrId.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : urlOrId.trim();
  }

  async function saveLinks() {
    setSavingLinks(true);
    try {
      const newDocId = extractDocId(linkDraftQ) || null;
      const newMsId = extractDocId(linkDraftMS) || null;
      await Promise.all([
        fetch("/api/questions/doc-link", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: question.id, field: "google_doc_id", value: newDocId }),
        }),
        fetch("/api/questions/doc-link", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: question.id, field: "google_ms_id", value: newMsId }),
        }),
      ]);
      setEditingLinks(false);
      onRefresh();
    } finally {
      setSavingLinks(false);
    }
  }

  async function unlinkDoc(field: "q" | "ms") {
    setUnlinkingDoc(field);
    try {
      await fetch("/api/questions/doc-link", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: question.id,
          field: field === "q" ? "google_doc_id" : "google_ms_id",
          value: null,
        }),
      });
      onRefresh();
    } finally {
      setUnlinkingDoc(null);
    }
  }

  // ── Clear stem ──────────────────────────────────────────────────────────
  const [clearingStem, setClearingStem] = useState(false);
  async function clearStem() {
    setClearingStem(true);
    try {
      await Promise.all([
        fetch("/api/questions/stem-update", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: question.id, field: "stem_latex", value: "" }),
        }),
        fetch("/api/questions/stem-update", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: question.id, field: "stem_markscheme_latex", value: "" }),
        }),
      ]);
      setStemLatex("");
      setStemMsLatex("");
      setStemDraftQ("");
      setStemDraftMS("");
      setEditingStem(null);
      onRefresh();
    } finally {
      setClearingStem(false);
    }
  }

  const [clearingAllLatex, setClearingAllLatex] = useState(false);
  async function clearAllLatex() {
    setClearingAllLatex(true);
    try {
      await Promise.all([
        fetch("/api/questions/stem-update", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: question.id, field: "stem_latex", value: "" }),
        }),
        fetch("/api/questions/stem-update", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: question.id, field: "stem_markscheme_latex", value: "" }),
        }),
        ...parts.map((p) =>
          fetch(`/api/questions/part-metadata?partId=${encodeURIComponent(p.id)}`, {
            method: "DELETE",
          })
        ),
      ]);

      setStemLatex("");
      setStemMsLatex("");
      setStemDraftQ("");
      setStemDraftMS("");
      setEditingStem(null);
      setWholeQDraft("");
      setWholeMSDraft("");
      setEditingWhole(null);
      setEditingLatex(null);
      setLatexDrafts({});
      setParts([]);
      onRefresh();
    } finally {
      setClearingAllLatex(false);
    }
  }

  // ── Delete part ─────────────────────────────────────────────────────────
  const [deletingPartId, setDeletingPartId] = useState<string | null>(null);
  async function deletePart(partId: string) {
    setDeletingPartId(partId);
    try {
      const res = await fetch(`/api/questions/part-metadata?partId=${encodeURIComponent(partId)}`, {
        method: "DELETE",
      });
      if (!res.ok) return;
      setParts((prev) => prev.filter((p) => p.id !== partId));
      onRefresh();
    } finally {
      setDeletingPartId(null);
    }
  }

  // ── Reset as whole question (clear stem + delete all labeled parts) ──────
  const [resettingWhole, setResettingWhole] = useState(false);
  async function resetAsWholeQuestion() {
    setResettingWhole(true);
    try {
      // 1. Clear stem fields
      await Promise.all([
        fetch("/api/questions/stem-update", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: question.id, field: "stem_latex", value: "" }),
        }),
        fetch("/api/questions/stem-update", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: question.id, field: "stem_markscheme_latex", value: "" }),
        }),
      ]);
      setStemLatex("");
      setStemMsLatex("");
      setStemDraftQ("");
      setStemDraftMS("");
      setEditingStem(null);

      // 2. Delete all labeled parts
      const labeledParts = parts.filter((p) => p.part_label && p.part_label.trim() !== "");
      await Promise.all(
        labeledParts.map((p) =>
          fetch(`/api/questions/part-metadata?partId=${encodeURIComponent(p.id)}`, { method: "DELETE" })
        )
      );
      setParts((prev) => prev.filter((p) => !p.part_label || p.part_label.trim() === ""));
      onRefresh();
    } finally {
      setResettingWhole(false);
    }
  }

  // ── Graph editor state ──────────────────────────────────────────────────
  const [graphEditorOpen, setGraphEditorOpen] = useState(false);
  const [graphSpecJson, setGraphSpecJson] = useState(() => JSON.stringify(EXAMPLE_SPEC, null, 2));
  const [graphSpecDirty, setGraphSpecDirty] = useState(false);
  const [graphSavingField, setGraphSavingField] = useState<"stem_latex" | "parts_draft_latex" | null>(null);
  const [graphCopiedMarker, setGraphCopiedMarker] = useState<string | null>(null);
  const [graphMarkerCopied, setGraphMarkerCopied] = useState(false);
  const [graphParseError, setGraphParseError] = useState<string | null>(null);
  const [graphExtracting, setGraphExtracting] = useState(false);
  const [graphExtractError, setGraphExtractError] = useState<string | null>(null);
  const [graphExtractFailure, setGraphExtractFailure] = useState<GraphExtractFailure | null>(null);
  const [graphExtractSnapshot, setGraphExtractSnapshot] = useState<GraphExtractSnapshot | null>(null);
  const [graphFailureCopied, setGraphFailureCopied] = useState(false);
  const [graphDebugCopied, setGraphDebugCopied] = useState(false);
  const [graphExtractWarnings, setGraphExtractWarnings] = useState<string[]>([]);
  const [graphExtractFeedback, setGraphExtractFeedback] = useState<string[]>([]);
  const [graphSourceImageB64, setGraphSourceImageB64] = useState<string | null>(null);
  const [graphMeta, setGraphMeta] = useState<Record<string, unknown> | null>(null);
  const [showCorrectionInput, setShowCorrectionInput] = useState(false);
  const [correctionJson, setCorrectionJson] = useState("");
  const [correctionParseError, setCorrectionParseError] = useState<string | null>(null);
  const [graphCrops, setGraphCrops] = useState<GraphImageCrop[]>([]);
  const [graphCropsLoading, setGraphCropsLoading] = useState(false);
  const [graphCropsError, setGraphCropsError] = useState<string | null>(null);
  const [deletingGraphCropIds, setDeletingGraphCropIds] = useState<Set<string>>(new Set());
  const [savingAsGraphCropIds, setSavingAsGraphCropIds] = useState<Set<string>>(new Set());

  const fetchGraphCrops = useCallback(async () => {
    setGraphCropsLoading(true);
    setGraphCropsError(null);
    try {
      const res = await fetch(`/api/questions/graph-crops?questionId=${encodeURIComponent(question.id)}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to load graph images");
      }
      setGraphCrops(Array.isArray(data.crops) ? (data.crops as GraphImageCrop[]) : []);
    } catch (e) {
      setGraphCropsError(e instanceof Error ? e.message : "Failed to load graph images");
      setGraphCrops([]);
    } finally {
      setGraphCropsLoading(false);
    }
  }, [question.id]);

  async function deleteGraphCrop(cropId: string) {
    setDeletingGraphCropIds((prev) => new Set(prev).add(cropId));
    try {
      const res = await fetch(`/api/questions/graph-crops/${encodeURIComponent(cropId)}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Failed to delete graph image");
      }
      setGraphCrops((prev) => prev.filter((crop) => crop.id !== cropId));
    } catch (e) {
      setGraphCropsError(e instanceof Error ? e.message : "Failed to delete graph image");
    } finally {
      setDeletingGraphCropIds((prev) => {
        const next = new Set(prev);
        next.delete(cropId);
        return next;
      });
    }
  }

  async function saveImageAsGraphCrop(img: QuestionImage) {
    if (!img.url) return;
    setSavingAsGraphCropIds((prev) => new Set(prev).add(img.id));
    setGraphCropsError(null);
    try {
      const resp = await fetch(img.url);
      if (!resp.ok) throw new Error("Failed to fetch image");
      const blob = await resp.blob();
      const mimeType = blob.type || "image/png";
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const res = await fetch("/api/questions/graph-crops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionImageId: img.id,
          data: base64,
          mimeType,
          extractor: "manual",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Failed to save graph image");
      }
      await fetchGraphCrops();
    } catch (e) {
      setGraphCropsError(e instanceof Error ? e.message : "Failed to save graph image");
    } finally {
      setSavingAsGraphCropIds((prev) => {
        const next = new Set(prev);
        next.delete(img.id);
        return next;
      });
    }
  }

  function formatGraphExtractFailureReport(failure: GraphExtractFailure): string {
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
    return lines.join("\n");
  }

  function summariseRenderedSegments(spec?: IbGraphSpec): string {
    if (!spec?.elements?.length) return "(none)";
    const segmentLines = spec.elements
      .filter((el): el is Extract<IbGraphSpec["elements"][number], { type: "line" | "fn" }> => el.type === "line" || el.type === "fn")
      .map((el, idx) => {
        const left = typeof el.xMin === "number" ? String(el.xMin) : "?";
        const right = typeof el.xMax === "number" ? String(el.xMax) : "?";
        return `${idx + 1}. ${el.type} on [${left}, ${right}] => ${el.expr}`;
      });

    const points = spec.elements
      .filter((el): el is Extract<IbGraphSpec["elements"][number], { type: "point" }> => el.type === "point")
      .map((p) => `(${p.x}, ${p.y})${p.open ? " open" : ""}`);

    const lines: string[] = [];
    lines.push("Segments");
    lines.push(segmentLines.length > 0 ? segmentLines.join("\n") : "(none)");
    lines.push("");
    lines.push("Explicit points");
    lines.push(points.length > 0 ? points.join(", ") : "(none)");
    return lines.join("\n");
  }

  function formatGraphExtractDebugPacket(snapshot: GraphExtractSnapshot): string {
    const lines: string[] = [];
    lines.push("Graph extraction debug packet");
    lines.push(`Question code: ${question.code}`);
    lines.push(`Question id: ${question.id}`);
    lines.push(`Extractor status: ${snapshot.status} (${snapshot.ok ? "ok" : "error"})`);
    lines.push("");

    if (snapshot.error) {
      lines.push("Extractor error");
      lines.push(snapshot.error);
      lines.push("");
    }

    lines.push("Warnings");
    if (snapshot.warnings.length > 0) {
      lines.push(...snapshot.warnings.map((w) => `- ${w}`));
    } else {
      lines.push("(none)");
    }

    lines.push("");
    lines.push("Improvement feedback");
    if (snapshot.feedback.length > 0) {
      lines.push(...snapshot.feedback.map((f) => `- ${f}`));
    } else {
      lines.push("(none)");
    }

    lines.push("");
    lines.push("Rendered graph summary");
    lines.push(summariseRenderedSegments(snapshot.graphSpec));

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

    lines.push("");
    lines.push("Required correction output format");
    lines.push("Return ONLY JSON with this shape:");
    lines.push(`{\n  \"graphSpec\": {\n    \"xRange\": [number, number],\n    \"yRange\": [number, number],\n    \"elements\": []\n  },\n  \"graphMeta\": {\n    \"description\": \"...\",\n    \"equations\": [],\n    \"xIntercepts\": [],\n    \"yIntercepts\": [],\n    \"verticalAsymptotes\": [],\n    \"horizontalAsymptotes\": [],\n    \"keyPoints\": [],\n    \"domain\": [number, number],\n    \"markschemeHints\": []\n  },\n  \"warnings\": []\n}`);

    return lines.join("\n");
  }

  function copyGraphExtractFailureReport() {
    if (!graphExtractFailure) return;
    const text = formatGraphExtractFailureReport(graphExtractFailure);
    void navigator.clipboard.writeText(text).then(() => {
      setGraphFailureCopied(true);
      setTimeout(() => setGraphFailureCopied(false), 2000);
    });
  }

  function copyGraphExtractDebugPacket() {
    if (!graphExtractSnapshot) return;
    const text = formatGraphExtractDebugPacket(graphExtractSnapshot);
    void navigator.clipboard.writeText(text).then(() => {
      setGraphDebugCopied(true);
      setTimeout(() => setGraphDebugCopied(false), 2000);
    });
  }

  function applyCorrection() {
    setCorrectionParseError(null);
    try {
      const parsed = JSON.parse(correctionJson) as {
        graphSpec?: IbGraphSpec;
        graphMeta?: Record<string, unknown>;
        warnings?: string[];
      };
      if (!parsed.graphSpec) {
        setCorrectionParseError("JSON must have a \"graphSpec\" key.");
        return;
      }
      setGraphSpecJson(JSON.stringify(parsed.graphSpec, null, 2));
      setGraphSpecDirty(true);
      setGraphParseError(null);
      if (Array.isArray(parsed.warnings)) setGraphExtractWarnings(parsed.warnings);
      setShowCorrectionInput(false);
      setCorrectionJson("");
    } catch (e) {
      setCorrectionParseError(String(e));
    }
  }

  async function extractGraphFromImage() {
    setGraphExtracting(true);
    setGraphExtractError(null);
    setGraphExtractFailure(null);
    setGraphExtractSnapshot(null);
    setGraphDebugCopied(false);
    setGraphExtractWarnings([]);
    setGraphExtractFeedback([]);
    setGraphSourceImageB64(null);
    setGraphMeta(null);
    try {
      const res = await fetch("/api/questions/graph-extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: question.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        const snapshot: GraphExtractSnapshot = {
          status: res.status,
          ok: false,
          error: data.error ?? "Graph extraction failed",
          warnings: (data.warnings as string[] | undefined) ?? [],
          feedback: (data.feedback as string[] | undefined) ?? [],
          graphSpec: data.graphSpec as IbGraphSpec | undefined,
          graphMeta: data.graphMeta as Record<string, unknown> | undefined,
        };
        setGraphExtractError(snapshot.error ?? "Graph extraction failed");
        setGraphExtractFailure({
          status: snapshot.status,
          error: snapshot.error ?? "Graph extraction failed",
          warnings: snapshot.warnings,
          feedback: snapshot.feedback,
          graphSpec: snapshot.graphSpec,
          graphMeta: snapshot.graphMeta,
        });
        setGraphExtractSnapshot(snapshot);
        if (Array.isArray(data.warnings) && data.warnings.length > 0) {
          setGraphExtractWarnings(data.warnings as string[]);
        }
        if (Array.isArray(data.feedback) && data.feedback.length > 0) {
          setGraphExtractFeedback(data.feedback as string[]);
        }
        if (data.sourceImageBase64) setGraphSourceImageB64(data.sourceImageBase64 as string);
        if (data.graphMeta) setGraphMeta(data.graphMeta as Record<string, unknown>);
        return;
      }

      const snapshot: GraphExtractSnapshot = {
        status: res.status,
        ok: true,
        warnings: Array.isArray(data.warnings) ? (data.warnings as string[]) : [],
        feedback: Array.isArray(data.feedback) ? (data.feedback as string[]) : [],
        graphSpec: data.graphSpec as IbGraphSpec | undefined,
        graphMeta: data.graphMeta as Record<string, unknown> | undefined,
      };
      setGraphExtractSnapshot(snapshot);

      if (data.graphSpec) {
        setGraphSpecJson(JSON.stringify(data.graphSpec, null, 2));
        setGraphSpecDirty(true);
        setGraphParseError(null);
      }
      if (data.graphMeta) setGraphMeta(data.graphMeta as Record<string, unknown>);
      if (snapshot.warnings.length > 0) setGraphExtractWarnings(snapshot.warnings);
      if (snapshot.feedback.length > 0) {
        setGraphExtractFeedback(snapshot.feedback);
      } else {
        setGraphExtractFeedback([
          "Review each segment endpoint and boundary continuity manually; refine graphSpec if any vertex appears off-grid.",
        ]);
      }
      if (data.sourceImageBase64) setGraphSourceImageB64(data.sourceImageBase64 as string);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unexpected error";
      setGraphExtractError(message);
      setGraphExtractSnapshot({
        status: 0,
        ok: false,
        error: message,
        warnings: [],
        feedback: [
          "Retry extraction, then validate all segment equations from snapped vertex pairs before saving to LaTeX.",
        ],
      });
      setGraphExtractFeedback([
        "Retry extraction, then validate all segment equations from snapped vertex pairs before saving to LaTeX.",
      ]);
    } finally {
      setGraphExtracting(false);
    }
  }

  function parseGraphDraft(): IbGraphSpec | null {
    try {
      const parsed = JSON.parse(graphSpecJson) as IbGraphSpec;
      setGraphParseError(null);
      return parsed;
    } catch (e) {
      setGraphParseError(String(e));
      return null;
    }
  }

  async function saveGraphToField(targetField: "stem_latex" | "parts_draft_latex") {
    const spec = parseGraphDraft();
    if (!spec) return;
    const marker = encodeGraphSpec(spec);
    // Find the current value of the target field and append or replace the marker
    const currentValue: string =
      targetField === "stem_latex"
        ? (question.stem_latex ?? "")
        : (question.parts_draft_latex ?? "");
    // Replace any existing GRAPH_JSON marker or append
    GRAPH_MARKER_RE.lastIndex = 0;
    const hasExisting = GRAPH_MARKER_RE.test(currentValue);
    GRAPH_MARKER_RE.lastIndex = 0;
    const newValue = hasExisting
      ? currentValue.replace(GRAPH_MARKER_RE, marker)
      : `${currentValue.trim()}\n\n${marker}`;
    setGraphSavingField(targetField);
    try {
      await fetch("/api/questions/stem-update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: question.id, field: targetField, value: newValue }),
      });
      onRefresh();
    } finally {
      setGraphSavingField(null);
      setGraphSpecDirty(false);
    }
  }

  async function saveWholeQuestion(field: "q" | "ms") {
    const value = field === "q" ? wholeQDraft : wholeMSDraft;
    setSavingWhole(true);
    try {
      // Reuse the existing null-label part if one already exists; only create if missing
      const latexField = field === "q" ? "content_latex" : "markscheme_latex";
      let partId: string;
      let existingPart = parts.find((p) => !p.part_label || p.part_label.trim() === "");
      if (existingPart) {
        partId = existingPart.id;
      } else {
        const createRes = await fetch("/api/questions/part-metadata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: question.id, partLabel: null, marks: null, commandTerm: null, subtopicCodes: [] }),
        });
        const createData = await createRes.json() as { part?: QuestionPart; error?: string };
        if (!createRes.ok || !createData.part) throw new Error(createData.error ?? "Failed to create part");
        existingPart = { ...createData.part, content_latex: null, markscheme_latex: null, latex_verified: null };
        partId = existingPart.id;
      }
      // Save the LaTeX
      await fetch("/api/questions/latex-update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partId, field: latexField, value }),
      });
      const withLatex = { ...existingPart, [latexField]: value || null };
      setParts([withLatex]);
      setLatexDrafts((d) => ({ ...d, [partId]: { ...d[partId], content_latex: d[partId]?.content_latex ?? "", markscheme_latex: d[partId]?.markscheme_latex ?? "", [latexField]: value } }));
      setEditingWhole(null);
    } finally {
      setSavingWhole(false);
    }
  }

  const [addPartOpen, setAddPartOpen] = useState(false);
  const [newPartDraft, setNewPartDraft] = useState({ partLabel: "", marks: "1", commandTerm: "", subtopicCodes: "" });
  const [pendingParts, setPendingParts] = useState<{ partLabel: string; marks: string; commandTerm: string; subtopicCodes: string }[]>([]);
  const [committingParts, setCommittingParts] = useState(false);
  const [addPartError, setAddPartError] = useState<string | null>(null);

  function stagePart() {
    setPendingParts((prev) => [...prev, { ...newPartDraft }]);
    setNewPartDraft({ partLabel: "", marks: "1", commandTerm: "", subtopicCodes: "" });
    setAddPartError(null);
  }

  function removePending(idx: number) {
    setPendingParts((prev) => prev.filter((_, i) => i !== idx));
  }

  async function commitParts() {
    if (pendingParts.length === 0) return;
    setCommittingParts(true);
    setAddPartError(null);
    const errors: string[] = [];
    for (const draft of pendingParts) {
      try {
        const res = await fetch("/api/questions/part-metadata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            questionId: question.id,
            partLabel: draft.partLabel || null,
            marks: parseInt(draft.marks, 10) || 1,
            commandTerm: draft.commandTerm || null,
            subtopicCodes: draft.subtopicCodes.split(",").map((s) => s.trim()).filter(Boolean),
          }),
        });
        const data = await res.json() as { error?: string; part?: QuestionPart };
        if (!res.ok) { errors.push(data.error ?? "Failed to add part"); continue; }
        const created = { ...data.part!, content_latex: null, markscheme_latex: null, latex_verified: null };
        setParts((prev) => [...prev, created].sort((a, b) => a.sort_order - b.sort_order));
        setLatexDrafts((d) => ({ ...d, [created.id]: { content_latex: "", markscheme_latex: "" } }));
      } catch (err) {
        errors.push(err instanceof Error ? err.message : "Failed");
      }
    }
    setCommittingParts(false);
    if (errors.length > 0) {
      setAddPartError(errors.join("; "));
    } else {
      setPendingParts([]);
      setAddPartOpen(false);
    }
  }

  // Determine whether there is any existing LaTeX content (parts or implied stems)
  function hasExistingContent() {
    return parts.some(
      (p) => (p.content_latex && p.content_latex.trim()) || (p.markscheme_latex && p.markscheme_latex.trim())
    );
  }

  function copyFullExtractDebugOutput() {
    if (fullExtractLog.length === 0 && !fullExtractError) return;
    const lines = [
      "LaTeX extractor debug output",
      `Captured at: ${new Date().toISOString()}`,
      `Question code: ${question.code}`,
      `Question id: ${question.id}`,
      `Extractor state: ${fullExtractState}`,
      "",
      "Progress log",
      ...(fullExtractLog.length > 0 ? fullExtractLog.map((msg, i) => `${i + 1}. ${msg}`) : ["(empty)"]),
      "",
      "Error",
      fullExtractError ?? "(none)",
    ];

    void navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setFullExtractCopied(true);
      setTimeout(() => setFullExtractCopied(false), 2000);
    });
  }

  async function runFullExtract() {
    setFullExtractState("running");
    setExtractLogCollapsed(false);
    setFullExtractLog([]);
    setFullExtractError(null);
    setFullExtractCopied(false);
    const log: string[] = [];
    const push = (msg: string) => {
      log.push(msg);
      setFullExtractLog([...log]);
    };

    try {
      const hasQ = images.some((i) => i.image_type === "question");
      const hasMS = images.some((i) => i.image_type === "markscheme");
      let qDraft = "";
      let msDraft = "";

      // ── Always run the full multi-part pipeline ─────────────────────────
      // The isWholeQuestion fallback at the end handles genuinely single-part
      // questions. Bypassing OCR+Claude here prevented part detection entirely.

      if (hasQ) {
        push("Extracting LaTeX from question images (OCR)…");
        const res = await fetch("/api/questions/ocr-latex", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: question.id, field: "parts_draft_latex" }),
        });
        if (res.ok) {
          const d = await res.json();
          qDraft = d.latex ?? "";
          push(`Question OCR complete (${qDraft.length} chars).`);
        } else {
          push("⚠ Question OCR unavailable — using empty draft.");
        }
      } else {
        push("No question images found — skipping question OCR.");
      }

      if (hasMS) {
        push("Extracting LaTeX from mark scheme images (OCR)…");
        const res = await fetch("/api/questions/ocr-latex", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: question.id, field: "parts_draft_markscheme_latex" }),
        });
        if (res.ok) {
          const d = await res.json();
          msDraft = d.latex ?? "";
          push(`Mark scheme OCR complete (${msDraft.length} chars).`);
        } else {
          push("⚠ Mark scheme OCR unavailable — using empty draft.");
        }
      } else {
        push("No mark scheme images found — skipping MS OCR.");
      }

      if (!qDraft && !msDraft) {
        throw new Error("No OCR output produced. Make sure images are uploaded.");
      }

      // Claude classification
      push("Analysing question structure with Claude…");
      let claudeParts: { label: string; marks: number; commandTerm: string; primarySubtopicCode?: string; subtopicCodes: string[] }[] = [];
      try {
        const subtopicList = availableSubtopics.map((s) => `${s.code}: ${s.descriptor}`).join("\n");
        const labelHint = parts.length > 0 && parts[0].part_label
          ? parts.map((p) => p.part_label ?? "").join(", ") + " (top-level only — detect nested (i)(ii) sub-parts and emit combined labels ai, aii, bi, bii etc.)"
          : "unknown — determine from LaTeX; always split (i)(ii) sub-parts into combined labels ai, aii etc.";
        const clRes = await fetch("/api/claude", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system: IB_CLASSIFY_SYSTEM,
            messages: [{
              role: "user",
              content: `Question LaTeX:\n\`\`\`\n${qDraft}\n\`\`\`\n\nMark Scheme LaTeX:\n\`\`\`\n${msDraft}\n\`\`\`\n\nAvailable subtopics:\n${subtopicList}\n\nKnown part labels (if any): ${labelHint}`,
            }],
          }),
        });
        if (clRes.ok) {
          const data = await readJsonSafely<{ content?: { text?: string }[] }>(clRes);
          const text: string = data?.content?.[0]?.text ?? "";
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) claudeParts = JSON.parse(jsonMatch[0]).parts ?? [];
          push(`Claude identified ${claudeParts.length} part(s): ${claudeParts.map((p) => p.label || "whole").join(", ")}.`);
        }
      } catch {
        push("⚠ Claude classification failed — part structure inferred from OCR labels.");
      }

      const detectedLabels = detectPartLabels(qDraft || msDraft);
      const claudeLabels = claudeParts.map((p) => (p.label ?? "").trim()).filter(Boolean);
      const claudeCountLabels =
        claudeLabels.length === 0 && claudeParts.length > 1
          ? Array.from({ length: claudeParts.length }, (_, i) => String.fromCharCode(97 + i))
          : [];
      const candidateLabels = claudeLabels.length > 0 ? claudeLabels : (detectedLabels.length > 0 ? detectedLabels : claudeCountLabels);
      // Probe using the full combined text (question + mark scheme) so that the
      // mark scheme's explicit (a)/(b) line-start markers are visible to the splitter.
      // Using only qDraft || msDraft caused failures when the question OCR was short
      // and only contained inline references like "result from part (a)".
      const combinedDraft = `${qDraft}\n\n${msDraft}`;
      const splitProbe = splitDraftIntoParts(combinedDraft, candidateLabels);
      const inferredLabels = candidateLabels.length > 0 ? candidateLabels : Array.from(splitProbe.parts.keys());
      let finalLabels = Array.from(new Set(inferredLabels.map((l) => l.trim()).filter(Boolean)));

      // Guard against false positives: OCR text like "where (a) ..." can be
      // misread as a single part label. Only trust a lone "a" when structure
      // markers clearly indicate multipart formatting.
      const hasExplicitPartEnvironment = hasExplicitTopLevelPartStructure(combinedDraft);
      const strongLabelMatches = Array.from(
        combinedDraft.matchAll(/(?:^|\n)\s*\(([a-z](?:i|ii|iii|iv|v)?)\)\s+/gi),
      );
      const strongUniqueLabels = new Set(strongLabelMatches.map((m) => (m[1] ?? "").toLowerCase()));

      const canTrustClaudeMultipartWithoutExplicit =
        !hasExplicitPartEnvironment
        && shouldTrustMultipartWithoutExplicit({
          claudeLabelsCount: claudeLabels.length,
          splitProbePartsCount: splitProbe.parts.size,
        });

      // If no explicit top-level part markers exist, force whole-question mode.
      // This prevents synthetic fallback labels like "a" from unlabeled OCR blocks.
      if (!hasExplicitPartEnvironment && finalLabels.length > 0 && !canTrustClaudeMultipartWithoutExplicit) {
        push("No explicit top-level part labels found; using whole-question mode.");
        finalLabels = [];
      } else if (canTrustClaudeMultipartWithoutExplicit) {
        push("No explicit top-level markers found, but Claude labels + extracted part structure support multipart extraction.");
      }

      const isSuspiciousSingleA =
        finalLabels.length === 1
        && normalizePartLabelKey(finalLabels[0]) === "a"
        && !hasExplicitPartEnvironment
        && strongUniqueLabels.size < 2;
      if (isSuspiciousSingleA) {
        push("Single '(a)' marker looked incidental; using whole-question mode.");
        finalLabels = [];
      }

      if (claudeLabels.length === 0 && finalLabels.length > 0) {
        const source = detectedLabels.length > 0 ? "OCR text" : (claudeCountLabels.length > 0 ? "Claude part count" : "structure inference");
        push(`Claude returned no labels; inferred ${finalLabels.length} part label(s) from ${source}: ${finalLabels.join(", ")}.`);
      }

      // Split the drafts using final labels (Claude, OCR-detected, or inferred)
      const { stem: stemQ, parts: splitQ } = splitDraftIntoParts(qDraft, finalLabels);
      const { stem: stemMS, parts: splitMS } = splitDraftIntoParts(msDraft, finalLabels);

      const expectedExistingLabels = parts
        .map((p) => (p.part_label ?? "").trim())
        .filter(Boolean);
      const saveGuard = shouldBlockPartAutoSave({
        expectedLabels: expectedExistingLabels,
        splitQuestion: splitQ,
        splitMarkscheme: splitMS,
      });

      // Build the extraction plan and launch the step-by-step review wizard.
      // No data is written to the database until the user confirms all steps.
      // Pre-seed editable marks from Claude data or \hfill [N] inference.
      const partMarks = new Map<string, number>();
      if (finalLabels.length === 0) {
        const cpMeta = claudeParts[0];
        const m = (typeof cpMeta?.marks === "number" && cpMeta.marks > 0)
          ? cpMeta.marks : parseMarksFromLatex(qDraft) ?? 1;
        partMarks.set("", m);
      } else {
        for (const label of finalLabels) {
          const normLabel = normalizePartLabelKey(label);
          const cp = claudeParts.find((p) => normalizePartLabelKey(p.label ?? "") === normLabel);
          const sq = splitQ.get(label) ?? "";
          const sm = splitMS.get(label) ?? "";
          const m = (typeof cp?.marks === "number" && cp.marks > 0)
            ? cp.marks : parseMarksFromLatex(sq || sm) ?? 1;
          partMarks.set(label, m);
        }
      }
      const extractionPlan: ExtractPlan = {
        qDraft,
        msDraft,
        finalLabels,
        isWholeQuestion: finalLabels.length === 0,
        stemQ,
        stemMS,
        splitQ,
        splitMS,
        claudeParts,
        partMarks,
        debug: {
          claudeLabels,
          detectedLabels,
          candidateLabels,
          inferredLabels,
          hasExplicitPartEnvironment,
          canTrustClaudeMultipart: canTrustClaudeMultipartWithoutExplicit,
          isSuspiciousSingleA,
          strongUniqueLabels: Array.from(strongUniqueLabels),
          splitProbeKeys: Array.from(splitProbe.parts.keys()),
          saveGuardBlocked: finalLabels.length > 0 && saveGuard.block,
          saveGuardReason: saveGuard.reason,
          logLines: [...log],
        },
      };
      push("Extraction complete — saving…");
      void commitExtractPlan(extractionPlan);
    } catch (e) {
      setFullExtractError(e instanceof Error ? e.message : "Unexpected error");
      setFullExtractState("idle");
    }
  }

  async function commitExtractPlan(plan: ExtractPlan) {
    setFullExtractState("running");
    setExtractLogCollapsed(false);
    setFullExtractError(null);
    const push = (msg: string) => {
      setFullExtractLog((prev) => [...prev, msg]);
    };

    try {
      const { finalLabels, qDraft, msDraft, stemQ, stemMS, splitQ, splitMS, claudeParts } = plan;
      const claudeLabels = plan.debug.claudeLabels;

      // Whole-question path: no labels from Claude/OCR/inference.
      if (plan.isWholeQuestion) {
        const cpMeta = claudeParts[0]; // may be undefined if claudeParts is empty
        const extractedWholeTerm = chooseCommandTerm({
          questionLatex: qDraft,
          markschemeLatex: msDraft,
          claudeCommandTerm: cpMeta?.commandTerm ?? null,
        });
        const extractedWholeTerms = chooseCommandTerms({
          questionLatex: qDraft,
          markschemeLatex: msDraft,
          claudeCommandTerm: cpMeta?.commandTerm ?? null,
        });
        push("No part structure found — treating as whole question…");
        push(`Claude subtopics: ${cpMeta?.subtopicCodes?.length ? cpMeta.subtopicCodes.join(", ") : "(none returned)"}`);
        // Find or create a null-label (whole-question) part
        let wholePartId: string;
        const existingWhole = parts.find((p) => !p.part_label || p.part_label.trim() === "");
        const wholeMarks = plan.partMarks?.get("") ?? ((typeof cpMeta?.marks === "number" && cpMeta.marks > 0) ? cpMeta.marks : parseMarksFromLatex(qDraft) ?? existingWhole?.marks ?? 1);
        if (existingWhole) {
          wholePartId = existingWhole.id;
          const effectiveSubtopics = cpMeta?.subtopicCodes?.length ? cpMeta.subtopicCodes : (existingWhole.subtopic_codes ?? []);
          push(`Subtopics saved: ${effectiveSubtopics.length ? effectiveSubtopics.join(", ") : "(none)"}${!cpMeta?.subtopicCodes?.length && existingWhole.subtopic_codes?.length ? " (kept from existing part)" : ""}`);
          // Always update marks + metadata (even when cpMeta is absent)
          await fetch("/api/questions/part-metadata", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              partId: wholePartId,
              marks: wholeMarks,
              commandTerm: extractedWholeTerm,
              commandTerms: extractedWholeTerms,
              sourceLatex: qDraft,
              subtopicCodes: effectiveSubtopics,
            }),
          });
        } else {
          const effectiveSubtopics = cpMeta?.subtopicCodes ?? [];
          push(`Subtopics saved: ${effectiveSubtopics.length ? effectiveSubtopics.join(", ") : "(none — new part, Claude returned nothing)"}`);
          const createRes = await fetch("/api/questions/part-metadata", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              questionId: question.id,
              partLabel: null,
              marks: wholeMarks,
              commandTerm: extractedWholeTerm,
              commandTerms: extractedWholeTerms,
              sourceLatex: qDraft,
              subtopicCodes: effectiveSubtopics,
            }),
          });
          if (!createRes.ok) throw new Error("Failed to create whole-question part");
          const { part: created } = await createRes.json();
          if (!created?.id) throw new Error("Part creation returned no id");
          wholePartId = created.id;
        }
        await Promise.all([
          fetch("/api/questions/latex-update", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ partId: wholePartId, field: "content_latex", value: qDraft }),
          }),
          fetch("/api/questions/latex-update", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ partId: wholePartId, field: "markscheme_latex", value: msDraft }),
          }),
        ]);
        const wholePart: QuestionPart = existingWhole
          ? { ...existingWhole, marks: wholeMarks, content_latex: qDraft || null, markscheme_latex: msDraft || null }
          : { id: wholePartId, part_label: "", marks: wholeMarks, subtopic_codes: cpMeta?.subtopicCodes ?? [], command_term: extractedWholeTerm, sort_order: 0, content_latex: qDraft || null, markscheme_latex: msDraft || null, latex_verified: null };
        setParts([wholePart]);
        setLatexDrafts({ [wholePartId]: { content_latex: qDraft, markscheme_latex: msDraft } });
        setWholeQDraft(qDraft);
        setWholeMSDraft(msDraft);
        push("Done! Whole question LaTeX saved.");
        onQueueMarksChange(question.id, wholeMarks);
        onRefresh();
        setTimeout(() => { setFullExtractState("idle"); setExtractLogCollapsed(true); }, 3000);
        return;
      }

      // Multi-part path: save stem only when there are actual parts
      push("Saving stems…");
      await Promise.all([
        fetch("/api/questions/stem-update", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: question.id, field: "stem_latex", value: stemQ }),
        }),
        fetch("/api/questions/stem-update", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: question.id, field: "stem_markscheme_latex", value: stemMS }),
        }),
      ]);
      setStemLatex(stemQ);
      setStemDraftQ(stemQ);
      setStemMsLatex(stemMS);
      setStemDraftMS(stemMS);

      // For each identified part label: find existing or create, then save LaTeX
      push("Saving parts…");
      const newParts: QuestionPart[] = [];
      const labelPlans = finalLabels.map((label, idx) => {
        const normalizedLabel = normalizePartLabelKey(label);
        const cpByLabel = claudeParts.find((p) => normalizePartLabelKey(p.label ?? "") === normalizedLabel);
        const cpByOrder = claudeLabels.length === 0 && claudeParts.length > 1 ? claudeParts[idx] : undefined;
        const cp = cpByLabel ?? cpByOrder;
        const splitQForLabel = splitQ.get(label) ?? "";
        const splitMSForLabel = splitMS.get(label) ?? "";
        const perPartTerms = chooseCommandTerms({
          questionLatex: splitQForLabel,
          markschemeLatex: splitMSForLabel,
          claudeCommandTerm: cp?.commandTerm ?? null,
        });
        return {
          idx,
          label,
          normalizedLabel,
          cp,
          splitQForLabel,
          splitMSForLabel,
          stem: romanSubpartStem(label),
          perPartTerms,
        };
      });

      const familyTerms = new Map<string, string[]>();
      const familySourceLatex = new Map<string, string>();
      const familyMembers = new Map<string, typeof labelPlans>();
      for (const lp of labelPlans) {
        if (!lp.stem) continue;
        const current = familyMembers.get(lp.stem) ?? [];
        current.push(lp);
        familyMembers.set(lp.stem, current);
      }
      for (const [stem, members] of familyMembers.entries()) {
        if (members.length < 2) continue;
        const combinedQ = members.map((m) => m.splitQForLabel).filter(Boolean).join("\n");
        const combinedMS = members.map((m) => m.splitMSForLabel).filter(Boolean).join("\n");
        const combinedTerms = mergeHighlightTerms(...members.map((m) => m.perPartTerms));
        const canonicalCombinedTerms = combinedTerms
          .map((term) => DEFAULT_COMMAND_TERMS.find((t) => t.toLowerCase() === term.toLowerCase()))
          .filter((t): t is string => Boolean(t));
        const primary = chooseCommandTerm({
          questionLatex: combinedQ,
          markschemeLatex: combinedMS,
          claudeCommandTerm: members[0]?.cp?.commandTerm ?? null,
        });
        familyTerms.set(stem, mergeHighlightTerms([primary], canonicalCombinedTerms));
        familySourceLatex.set(stem, combinedQ || members[0]?.splitQForLabel || "");
      }

      for (const lp of labelPlans) {
        const { label, normalizedLabel, cp, splitQForLabel, splitMSForLabel, stem, perPartTerms } = lp;
        const existing = parts.find((p) => normalizePartLabelKey(p.part_label ?? "") === normalizedLabel);
        let partId: string;
        const canonicalTerms = stem && familyTerms.has(stem) ? (familyTerms.get(stem) ?? perPartTerms) : perPartTerms;
        const canonicalTerm = canonicalTerms[0] ?? chooseCommandTerm({
          questionLatex: splitQForLabel,
          markschemeLatex: splitMSForLabel,
          claudeCommandTerm: cp?.commandTerm ?? null,
        });
        const sourceForMetadata = stem && familySourceLatex.has(stem)
          ? (familySourceLatex.get(stem) ?? splitQForLabel)
          : splitQForLabel;
        const exceptionFlags = deriveCommandTermFlags({ commandTerm: canonicalTerm, sourceLatex: sourceForMetadata });

        if (existing) {
          // Update metadata
          await fetch("/api/questions/part-metadata", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              partId: existing.id,
              partLabel: label,
              marks: plan.partMarks?.get(label) ?? ((typeof cp?.marks === "number" && cp.marks > 0) ? cp.marks : parseMarksFromLatex(splitQForLabel || splitMSForLabel) ?? existing.marks),
              commandTerm: canonicalTerm,
              commandTerms: canonicalTerms,
              sourceLatex: sourceForMetadata,
              subtopicCodes: cp?.subtopicCodes?.length ? cp.subtopicCodes : existing.subtopic_codes,
              primarySubtopicCode: cp?.primarySubtopicCode ?? null,
            }),
          });
          partId = existing.id;
          newParts.push({
            ...existing,
            part_label: label,
            marks: plan.partMarks?.get(label) ?? ((typeof cp?.marks === "number" && cp.marks > 0) ? cp.marks : parseMarksFromLatex(splitQForLabel || splitMSForLabel) ?? existing.marks),
            command_term: canonicalTerm,
            command_terms: canonicalTerms,
            ...exceptionFlags,
            subtopic_codes: cp?.subtopicCodes?.length ? cp.subtopicCodes : existing.subtopic_codes,
            primary_subtopic_code: cp?.primarySubtopicCode ?? existing.primary_subtopic_code ?? null,
            content_latex: splitQForLabel || null,
            markscheme_latex: splitMSForLabel || null,
          });
        } else {
          // Create new part
          const res = await fetch("/api/questions/part-metadata", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              questionId: question.id,
              partLabel: label,
              marks: plan.partMarks?.get(label) ?? ((typeof cp?.marks === "number" && cp.marks > 0) ? cp.marks : parseMarksFromLatex(splitQForLabel || splitMSForLabel) ?? null),
              commandTerm: canonicalTerm,
              commandTerms: canonicalTerms,
              sourceLatex: sourceForMetadata,
              subtopicCodes: cp?.subtopicCodes ?? [],
              primarySubtopicCode: cp?.primarySubtopicCode ?? null,
            }),
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            push(`⚠ Failed to create part ${label || "(whole)"}: ${errData.error ?? res.status}`);
            continue;
          }
          const { part: created } = await res.json();
          if (!created?.id) { push(`⚠ Part ${label} creation returned no id`); continue; }
          partId = created.id;
          newParts.push({
            ...created,
            part_label: label,
            marks: plan.partMarks?.get(label) ?? ((typeof cp?.marks === "number" && cp.marks > 0) ? cp.marks : parseMarksFromLatex(splitQForLabel || splitMSForLabel) ?? created.marks),
            command_term: canonicalTerm,
            command_terms: canonicalTerms,
            ...exceptionFlags,
            subtopic_codes: cp?.subtopicCodes ?? created.subtopic_codes,
            primary_subtopic_code: cp?.primarySubtopicCode ?? created.primary_subtopic_code ?? null,
            content_latex: splitQForLabel || null,
            markscheme_latex: splitMSForLabel || null,
          });
        }

        // Save LaTeX for the part
        await Promise.all([
          fetch("/api/questions/latex-update", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ partId, field: "content_latex", value: splitQForLabel }),
          }),
          fetch("/api/questions/latex-update", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ partId, field: "markscheme_latex", value: splitMSForLabel }),
          }),
        ]);
      }

      if (finalLabels.length > 0) {
        const wholeQuestionParts = parts.filter((p) => !p.part_label || p.part_label.trim() === "");
        if (wholeQuestionParts.length > 0) {
          await Promise.all(
            wholeQuestionParts.map((p) =>
              fetch(`/api/questions/part-metadata?partId=${encodeURIComponent(p.id)}`, { method: "DELETE" })
            )
          );
        }
      }

      // Update local state — merge: keep any existing parts not touched by extraction,
      // plus all newly created / updated parts
      const updatedById: Record<string, QuestionPart> = {};
      newParts.forEach((p) => { updatedById[p.id] = p; });
      const mergedParts = parts
        .map((p) => updatedById[p.id] ?? p)  // update existing in-place
        .concat(newParts.filter((p) => !parts.some((ep) => ep.id === p.id)));  // add truly new
      const sortedMerged = (finalLabels.length > 0
        ? mergedParts.filter((p) => p.part_label && p.part_label.trim() !== "")
        : mergedParts
      ).sort((a, b) => a.sort_order - b.sort_order);
      setParts(sortedMerged);
      const newDrafts: Record<string, { content_latex: string; markscheme_latex: string }> = {};
      sortedMerged.forEach((p) => {
        newDrafts[p.id] = {
          content_latex: p.content_latex ?? "",
          markscheme_latex: p.markscheme_latex ?? "",
        };
      });
      setLatexDrafts(newDrafts);

      if (finalLabels.length > 0 && newParts.length === 0) {
        throw new Error("No parts were saved. Existing parts may use labels with different formatting (for example b(i) vs bi).");
      }

      push("Done! All LaTeX extracted and saved.");
      // Refresh parent question list so data stays in sync
      onQueueMarksChange(question.id, sortedMerged.reduce((s, p) => s + p.marks, 0));
      onRefresh();
      setTimeout(() => { setFullExtractState("idle"); setExtractLogCollapsed(true); }, 3000);
    } catch (e) {
      setFullExtractError(e instanceof Error ? e.message : "Unexpected error");
      setFullExtractState("idle");
    }
  }

  async function extractLatexFromImages(partId: string, field: "content_latex" | "markscheme_latex") {
    setExtractingLatexField({ partId, field });
    // Switch to edit mode immediately so the user sees the result land
    setEditingLatex({ partId, field });
    try {
      const draftField = field === "content_latex" ? "parts_draft_latex" : "parts_draft_markscheme_latex";
      const res = await fetch("/api/questions/ocr-latex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: question.id, field: draftField }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const fullLatex: string = data.latex ?? "";
      if (!fullLatex) return;
      // Split by part labels and pick this part's slice
      const partLabels = parts.map((p) => p.part_label ?? "");
      const { stem, parts: splitMap } = splitDraftIntoParts(fullLatex, partLabels);
      const thisPart = parts.find((p) => p.id === partId);
      const thisLabel = thisPart?.part_label ?? "";
      // Use normalized label matching first; this handles labels like b(i) vs bi.
      const splitByNormalized = Array.from(splitMap.entries()).find(
        ([k]) => normalizePartLabelKey(k) === normalizePartLabelKey(thisLabel)
      )?.[1];
      // Use the split slice if found, otherwise fall back to stem (single-part question)
      const extracted = splitByNormalized ?? splitMap.get(thisLabel) ?? stem ?? fullLatex;
      setLatexDrafts((d) => ({
        ...d,
        [partId]: { ...d[partId], [field]: extracted },
      }));
    } finally {
      setExtractingLatexField(null);
    }
  }

  async function runClaude(partId: string, field: "content_latex" | "markscheme_latex") {
    const key = `${partId}-${field}`;
    const instruction = claudeInstruction[key] ?? "";
    if (!instruction.trim()) return;
    setClaudeLoading((l) => ({ ...l, [key]: true }));
    const currentLatex = latexDrafts[partId]?.[field] ?? "";
    try {
      const res = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: IB_CORRECTION_SYSTEM,
          messages: [{
            role: "user",
            content: `Here is the current LaTeX for this question part:\n\n\`\`\`\n${currentLatex}\n\`\`\`\n\nInstruction: ${instruction}\n\nReturn ONLY the corrected LaTeX, nothing else.`,
          }],
        }),
      });
      const data = await readJsonSafely<{ content?: { text?: string }[] }>(res);
      const corrected: string = data?.content?.[0]?.text ?? "";
      if (corrected) {
        setLatexDrafts((d) => ({ ...d, [partId]: { ...d[partId], [field]: corrected.trim() } }));
        setEditingLatex({ partId, field });
      }
    } finally {
      setClaudeLoading((l) => ({ ...l, [key]: false }));
      setClaudeInstruction((c) => ({ ...c, [key]: "" }));
    }
  }

  async function saveLatex(partId: string, field: "content_latex" | "markscheme_latex") {
    const value = latexDrafts[partId]?.[field] ?? "";
    setSavingLatex(true);
    try {
      const res = await fetch("/api/questions/latex-update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partId, field, value }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setParts((prev) => prev.map((p) => (p.id === partId ? { ...p, [field]: value || null } : p)));
      setEditingLatex(null);
    } finally {
      setSavingLatex(false);
    }
  }

  // Close modal on Escape key
  useEffect(() => {
    if (!expanded) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [expanded, handleClose]);

  useEffect(() => {
    if (!expanded) return;
    void fetchGraphCrops();
  }, [expanded, fetchGraphCrops]);

  // True when the question has at least one part with a letter label (a, b, c…)
  const hasLabeledParts = parts.some((p) => p.part_label && p.part_label.trim() !== "");
  const sortedLabeledParts = [...parts]
    .filter((p) => p.part_label && p.part_label.trim() !== "")
    .sort((a, b) => a.sort_order - b.sort_order);

  const buildCombinedLatex = (field: "content_latex" | "markscheme_latex") => {
    const stem = (field === "content_latex" ? stemLatex : stemMsLatex).trim();
    const partBlocks = sortedLabeledParts
      .map((p) => (p[field] ?? "").trim())
      .filter(Boolean)
      .map((body) => `\\begin{IBPart}\n${body}\n\\end{IBPart}`);
    return [stem, ...partBlocks].filter(Boolean).join("\n\n").trim();
  };

  return (
    <>
      <tr
        className="cursor-pointer hover:bg-blue-50 transition-colors"
        onClick={handleRowClick}
      >
        <td className="px-4 py-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleRowClick();
            }}
            className="font-bold text-blue-900 hover:underline"
            title="Open question details"
          >
            {question.code}
          </button>
        </td>
        <td className="px-4 py-2 text-center text-sm font-semibold text-gray-800">
          {question.session}
        </td>
        <td className="px-4 py-2 text-center text-sm font-semibold text-gray-800">
          P{question.paper}
        </td>
        <td className="px-4 py-2 text-center">
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${
              question.level === "AHL"
                ? "bg-purple-100 text-purple-800"
                : "bg-green-100 text-green-800"
            }`}
          >
            {question.level === "AHL" ? "HL" : question.level}
          </span>
        </td>
        <td className="px-4 py-2 text-center text-sm font-semibold text-gray-800">
          {question.timezone}
        </td>
        <td className="px-4 py-2 text-center text-sm font-bold text-blue-900">
          {question.question_parts.length}
        </td>
        <td className="px-4 py-2 text-center text-sm font-bold text-blue-900">
          {totalMarks}
        </td>
        <td className="px-4 py-2 text-center">
          <div className="flex items-center justify-center gap-2">
            <a
              href={`https://docs.google.com/document/d/${question.google_doc_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline text-xs font-semibold"
              onClick={(e) => e.stopPropagation()}
              title="Question images"
            >
              📄 Q
            </a>
            {question.google_ms_id && (
              <a
                href={`https://docs.google.com/document/d/${question.google_ms_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-green-600 hover:underline text-xs font-semibold"
                onClick={(e) => e.stopPropagation()}
                title="Markscheme images"
              >
                📝 MS
              </a>
            )}
          </div>
        </td>
        {/* Section badge (editable for P1/P2) */}
        <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
          {showSection ? (
            <div className="flex items-center justify-center gap-1">
              <button
                type="button"
                disabled={savingSection}
                onClick={() => onUpdateSection("A")}
                className={`rounded px-1.5 py-0.5 text-xs font-bold transition-colors ${
                  question.section === "A"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-500 hover:bg-blue-100"
                }`}
              >
                A
              </button>
              <button
                type="button"
                disabled={savingSection}
                onClick={() => onUpdateSection("B")}
                className={`rounded px-1.5 py-0.5 text-xs font-bold transition-colors ${
                  question.section === "B"
                    ? "bg-orange-500 text-white"
                    : "bg-gray-100 text-gray-500 hover:bg-orange-100"
                }`}
              >
                B
              </button>
            </div>
          ) : (
            <span className="text-xs text-gray-400">—</span>
          )}
        </td>
        {/* Add to test button */}
        {testBuilderOpen && (
          <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
            {question.has_question_images ? (
              <button
                type="button"
                onClick={onAddToQueue}
                disabled={inQueue}
                title={inQueue ? "Already in queue" : "Add to test"}
                className={`rounded-full w-7 h-7 text-sm font-bold transition-colors ${
                  inQueue
                    ? "bg-indigo-100 text-indigo-400 cursor-default"
                    : "bg-indigo-600 text-white hover:bg-indigo-700"
                }`}
              >
                {inQueue ? "✓" : "+"}
              </button>
            ) : (
              <span className="text-xs text-gray-300" title="No images extracted">—</span>
            )}
          </td>
        )}
      </tr>
      {expanded && typeof document !== "undefined" && createPortal(
        <>
        {/* ── Extraction review wizard ── */}
        {extractPlan && (
          <ExtractionReviewModal
            plan={extractPlan}
            questionCode={question.code}
            images={images}
            onConfirm={(confirmedPlan) => {
              setExtractPlan(null);
              void commitExtractPlan(confirmedPlan);
            }}
            onCancel={() => {
              setExtractPlan(null);
              setFullExtractState("idle");
              setFullExtractLog([]);
            }}
          />
        )}
        {/* ── Primary subtopic warning overlay ── */}
        {primaryWarningDialog && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
            <div className="bg-white rounded-2xl shadow-2xl border border-amber-300 p-6 w-96 flex flex-col gap-4">
              <div>
                <p className="text-base font-bold text-gray-900 mb-1">No primary subtopic selected</p>
                <p className="text-sm text-gray-600">
                  {primaryWarningDialog.plural
                    ? `${primaryWarningDialog.labels} has`
                    : `${primaryWarningDialog.labels} have`}{" "}
                  multiple subtopics but no primary (★) selected.
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setPrimaryWarningDialog(null)}
                  className="flex-1 rounded-lg bg-green-600 text-white font-bold py-2 text-sm hover:bg-green-700 transition-colors"
                >
                  Fix
                </button>
                <button
                  type="button"
                  onClick={() => { setPrimaryWarningDialog(null); proceedClose(); }}
                  className="flex-1 rounded-lg bg-red-600 text-white font-bold py-2 text-sm hover:bg-red-700 transition-colors"
                >
                  Ignore
                </button>
              </div>
            </div>
          </div>
        )}
        {/* ── Section prompt overlay ── */}
        {showSectionPrompt && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
            <div className="bg-white rounded-2xl shadow-2xl border border-amber-300 p-6 w-80 flex flex-col gap-4">
              <div>
                <p className="text-base font-bold text-gray-900 mb-1">Pick a section before closing</p>
                <p className="text-sm text-gray-500">
                  <span className="font-mono font-semibold text-blue-800">{question.code}</span> is P{question.paper} — assign it to Section A or B first.
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => { onUpdateSection("A"); setShowSectionPrompt(false); onClose(); }}
                  className="flex-1 rounded-lg bg-blue-600 text-white font-bold py-2 text-sm hover:bg-blue-700 transition-colors"
                >
                  Section A
                </button>
                <button
                  type="button"
                  onClick={() => { onUpdateSection("B"); setShowSectionPrompt(false); onClose(); }}
                  className="flex-1 rounded-lg bg-orange-500 text-white font-bold py-2 text-sm hover:bg-orange-600 transition-colors"
                >
                  Section B
                </button>
              </div>
              <button
                type="button"
                onClick={() => { setShowSectionPrompt(false); onClose(); }}
                className="text-xs text-gray-400 hover:text-gray-600 underline text-center"
              >
                Close without picking
              </button>
            </div>
          </div>
        )}
        {minimized ? (
          /* ── Minimized bar ── */
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t-2 border-blue-300 shadow-xl px-5 py-2 flex items-center gap-4">
            <span className="font-mono font-bold text-blue-900 text-sm">{question.code}</span>
            <span className="text-xs text-gray-500">
              {question.session} · P{question.paper} · {question.level} · TZ{question.timezone}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMinimized(false)}
                title="Restore editor"
                className="rounded px-3 py-1.5 text-xs font-bold bg-blue-100 text-blue-800 hover:bg-blue-200 transition-colors"
              >
                ▲ Restore
              </button>
              <button
                type="button"
                onClick={handleClose}
                title="Close editor"
                className="rounded w-7 h-7 flex items-center justify-center text-sm font-bold bg-gray-100 text-gray-700 hover:bg-red-100 hover:text-red-700 transition-colors"
              >
                ✕
              </button>
            </div>
          </div>
        ) : (
          /* ── Full-screen modal ── */
          <div className="fixed inset-0 z-50 flex flex-col bg-white overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-4 px-5 py-3 bg-blue-900 text-white shadow-md shrink-0">
              <span className="font-mono font-bold text-lg">{question.code}</span>
              <span className="text-sm text-blue-200">
                {question.session} · P{question.paper} · {question.level} · TZ{question.timezone}
              </span>
              {(() => {
                const editorMarks = parts.reduce((s, p) => s + p.marks, 0);
                const mpm = question.level === "SL" ? 9 / 8 : 12 / 11;
                return editorMarks > 0 ? (
                  <span className="text-xs bg-blue-700 rounded-full px-2.5 py-0.5 font-semibold text-blue-100">
                    {editorMarks} marks · ≈{Math.round(editorMarks * mpm)} min
                  </span>
                ) : null;
              })()}
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMinimized(true)}
                  title="Minimize"
                  className="rounded px-3 py-1.5 text-xs font-bold bg-blue-700 hover:bg-blue-600 text-white transition-colors"
                >
                  — Minimize
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  title="Close"
                  className="rounded px-3 py-1.5 text-xs font-bold bg-red-600 hover:bg-red-500 text-white transition-colors"
                >
                  ✕ Close
                </button>
              </div>
            </div>
            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto bg-blue-50 p-6 flex flex-col gap-6">

                {/* ── Question metadata ── */}
                <div className="bg-white rounded-xl border border-blue-200 px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
                  <span className="text-xs font-bold text-blue-900 uppercase tracking-wide mr-1">Question details</span>
                  {/* Pills */}
                  <span className="px-2.5 py-0.5 bg-blue-50 rounded-full text-blue-800 font-semibold text-xs">{question.session}</span>
                  <span className="px-2.5 py-0.5 bg-blue-50 rounded-full text-blue-800 font-semibold text-xs">Paper {question.paper}</span>
                  <span className={`px-2.5 py-0.5 rounded-full font-semibold text-xs ${question.level === "AHL" ? "bg-purple-100 text-purple-800" : "bg-green-100 text-green-800"}`}>
                    {question.level === "AHL" ? "HL" : question.level}
                  </span>
                  <span className="px-2.5 py-0.5 bg-blue-50 rounded-full text-blue-800 font-semibold text-xs">{question.timezone}</span>
                  {question.curriculum?.length > 0 && (
                    <span className="px-2.5 py-0.5 bg-gray-100 rounded-full text-gray-700 font-semibold text-xs">{question.curriculum.join(", ")}</span>
                  )}
                  {question.difficulty != null && (
                    <span className="px-2.5 py-0.5 bg-yellow-50 rounded-full text-yellow-800 font-semibold text-xs">Difficulty {question.difficulty}</span>
                  )}
                  {/* Section A/B (only for P1/P2) */}
                  {showSection && (
                    <>
                      <span className="text-xs font-bold text-blue-900 ml-1">Section:</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={savingSection}
                          onClick={() => onUpdateSection("A")}
                          className={`rounded px-2 py-0.5 text-xs font-bold transition-colors ${
                            question.section === "A"
                              ? "bg-blue-600 text-white"
                              : "bg-gray-100 text-gray-500 hover:bg-blue-100"
                          }`}
                        >
                          A
                        </button>
                        <button
                          type="button"
                          disabled={savingSection}
                          onClick={() => onUpdateSection("B")}
                          className={`rounded px-2 py-0.5 text-xs font-bold transition-colors ${
                            question.section === "B"
                              ? "bg-orange-500 text-white"
                              : "bg-gray-100 text-gray-500 hover:bg-orange-100"
                          }`}
                        >
                          B
                        </button>
                        {savingSection && <span className="text-xs text-gray-400">Saving…</span>}
                      </div>
                    </>
                  )}
                  {/* Source docs */}
                  <div className="flex flex-wrap items-center gap-3 ml-1">
                    <span className="text-xs font-bold text-blue-900">Source docs:</span>
                    {hasDocLinkConflict && !editingLinks && (
                      <span className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-800">
                        Question doc and markscheme doc are the same file. Fix the question doc link before extracting.
                      </span>
                    )}
                    {editingLinks ? (
                      <div className="flex flex-col gap-2 w-full mt-1">
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
                          <button
                            type="button"
                            onClick={saveLinks}
                            disabled={savingLinks}
                            className="rounded bg-blue-600 px-3 py-1 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            {savingLinks ? "Saving…" : "Save Links"}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setEditingLinks(false); setLinkDraftQ(question.google_doc_id ?? ""); setLinkDraftMS(question.google_ms_id ?? ""); }}
                            disabled={savingLinks}
                            className="rounded border border-gray-300 px-3 py-1 text-xs font-bold text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {question.google_doc_id ? (
                          <span className="inline-flex items-center gap-1">
                            <a
                              href={`https://docs.google.com/document/d/${question.google_doc_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"
                            >
                              📄 Question Doc
                            </a>
                            <button
                              type="button"
                              onClick={() => unlinkDoc("q")}
                              disabled={unlinkingDoc !== null}
                              title="Unlink question doc"
                              className="ml-0.5 text-xs text-gray-400 hover:text-red-500 disabled:opacity-40"
                            >
                              {unlinkingDoc === "q" ? "…" : "×"}
                            </button>
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400 italic">No question doc linked</span>
                        )}
                        {question.google_ms_id ? (
                          <span className="inline-flex items-center gap-1">
                            <a
                              href={`https://docs.google.com/document/d/${question.google_ms_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs font-semibold text-green-600 hover:underline"
                            >
                              📝 Markscheme Doc
                            </a>
                            <button
                              type="button"
                              onClick={() => unlinkDoc("ms")}
                              disabled={unlinkingDoc !== null}
                              title="Unlink markscheme doc"
                              className="ml-0.5 text-xs text-gray-400 hover:text-red-500 disabled:opacity-40"
                            >
                              {unlinkingDoc === "ms" ? "…" : "×"}
                            </button>
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400 italic">No markscheme doc linked</span>
                        )}
                        <button
                          type="button"
                          onClick={() => { setLinkDraftQ(question.google_doc_id ?? ""); setLinkDraftMS(question.google_ms_id ?? ""); setEditingLinks(true); }}
                          className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-0.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 hover:text-blue-700"
                        >
                          ✏️ Edit Links
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* ── Graph Editor ── */}
                <div className="border-t border-blue-100 pt-3 order-3">
                  <button
                    type="button"
                    onClick={() => setGraphEditorOpen((o) => !o)}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-700 hover:text-indigo-900"
                  >
                    <span>{graphEditorOpen ? "▾" : "▸"}</span>
                    <span>📈 Graph Editor</span>
                  </button>
                  {graphEditorOpen && (
                    <div className="mt-3 space-y-3">
                      {/* ── Extract from image controls ── */}
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={extractGraphFromImage}
                          disabled={graphExtracting || images.filter(i => i.image_type === "question").length === 0}
                          className="inline-flex items-center gap-1.5 rounded bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-50"
                          title={images.filter(i => i.image_type === "question").length === 0 ? "Extract question images first" : ""}
                        >
                          {graphExtracting ? "Extracting graph…" : "🔍 Extract Graph from Image"}
                        </button>
                        {graphExtractSnapshot && (
                          <button
                            type="button"
                            onClick={copyGraphExtractDebugPacket}
                            className="inline-flex items-center gap-1 rounded border border-indigo-300 bg-white px-2.5 py-1.5 text-[11px] font-bold text-indigo-700 hover:bg-indigo-50"
                            title="Copy extracted graph details and required correction output format"
                          >
                            {graphDebugCopied ? "✓ Copied" : "Copy Graph Debug Packet"}
                          </button>
                        )}
                        {graphExtractSnapshot && (
                          <button
                            type="button"
                            onClick={() => { setShowCorrectionInput((v) => !v); setCorrectionParseError(null); }}
                            className="inline-flex items-center gap-1 rounded border border-emerald-400 bg-white px-2.5 py-1.5 text-[11px] font-bold text-emerald-700 hover:bg-emerald-50"
                          >
                            {showCorrectionInput ? "✕ Cancel" : "✏ Paste Correction"}
                          </button>
                        )}
                        {graphExtracting && (
                          <span className="text-xs text-violet-600 italic">
                            Running 2-pass analysis (this may take ~30 s)…
                          </span>
                        )}
                        {graphExtractError && (
                          <span className="text-xs text-red-600 font-semibold">
                            {graphExtractError}
                            {graphExtractFailure?.status === 422 ? " (continuity gate)" : ""}
                          </span>
                        )}
                      </div>

                      {graphExtractFailure && (
                        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-xs font-bold text-red-800">
                              {graphExtractFailure.status === 422
                                ? "Continuity gate rejected this extraction"
                                : "Graph extraction failed"}
                            </p>
                            <button
                              type="button"
                              onClick={copyGraphExtractFailureReport}
                              className="rounded px-2.5 py-1 text-[11px] font-bold bg-red-600 text-white hover:bg-red-700"
                            >
                              {graphFailureCopied ? "✓ Copied" : "Copy Full Failure Report"}
                            </button>
                          </div>

                          <details>
                            <summary className="cursor-pointer text-xs font-bold text-red-800">
                              Click for details
                            </summary>
                          <div className="mt-2 space-y-1">
                            <p className="text-xs text-red-700"><span className="font-semibold">Status:</span> {graphExtractFailure.status}</p>
                            <p className="text-xs text-red-700"><span className="font-semibold">Error:</span> {graphExtractFailure.error}</p>

                            {graphExtractFailure.warnings.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-red-800">Warnings</p>
                                <ul className="list-disc ml-4 space-y-0.5">
                                  {graphExtractFailure.warnings.map((w, i) => (
                                    <li key={i} className="text-xs text-red-700">{w}</li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {graphExtractFailure.graphSpec && (
                              <details>
                                <summary className="cursor-pointer text-xs font-semibold text-red-800">Returned graphSpec JSON</summary>
                                <pre className="mt-1 rounded bg-white border border-red-100 p-2 text-[10px] leading-relaxed overflow-x-auto whitespace-pre-wrap max-h-56 text-red-900">
                                  {JSON.stringify(graphExtractFailure.graphSpec, null, 2)}
                                </pre>
                              </details>
                            )}

                            {graphExtractFailure.graphMeta && (
                              <details>
                                <summary className="cursor-pointer text-xs font-semibold text-red-800">Returned graphMeta JSON</summary>
                                <pre className="mt-1 rounded bg-white border border-red-100 p-2 text-[10px] leading-relaxed overflow-x-auto whitespace-pre-wrap max-h-56 text-red-900">
                                  {JSON.stringify(graphExtractFailure.graphMeta, null, 2)}
                                </pre>
                              </details>
                            )}
                          </div>
                          </details>
                        </div>
                      )}

                      {/* ── Extraction warnings ── */}
                      {graphExtractWarnings.length > 0 && (
                        <div className="rounded border border-yellow-300 bg-yellow-50 px-3 py-2 space-y-1">
                          <p className="text-xs font-bold text-yellow-800">⚠ Verification notices</p>
                          {graphExtractWarnings.map((w, i) => (
                            <p key={i} className="text-xs text-yellow-700">{w}</p>
                          ))}
                        </div>
                      )}

                      {/* ── Paste correction panel ── */}
                      {showCorrectionInput && (
                        <div className="rounded border border-emerald-300 bg-emerald-50 px-3 py-3 space-y-2">
                          <p className="text-xs font-bold text-emerald-800">✏ Paste corrected JSON</p>
                          <p className="text-[11px] text-emerald-700">
                            Paste the JSON returned by the AI (must have a <code className="bg-white px-0.5 rounded">graphSpec</code> key, optionally <code className="bg-white px-0.5 rounded">graphMeta</code> and <code className="bg-white px-0.5 rounded">warnings</code>).
                          </p>
                          <textarea
                            rows={10}
                            value={correctionJson}
                            onChange={(e) => { setCorrectionJson(e.target.value); setCorrectionParseError(null); }}
                            spellCheck={false}
                            placeholder={'{\n  "graphSpec": { ... },\n  "graphMeta": { ... },\n  "warnings": []\n}'}
                            className="w-full rounded border border-emerald-300 px-2 py-1.5 font-mono text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-white"
                          />
                          {correctionParseError && (
                            <p className="text-xs text-red-600">{correctionParseError}</p>
                          )}
                          <button
                            type="button"
                            onClick={applyCorrection}
                            disabled={!correctionJson.trim()}
                            className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
                          >
                            Apply → Load into Graph Editor
                          </button>
                        </div>
                      )}

                      {graphExtractFeedback.length > 0 && (
                        <div className="rounded border border-blue-300 bg-blue-50 px-3 py-2 space-y-1">
                          <p className="text-xs font-bold text-blue-800">🛠 Suggested improvements (always review)</p>
                          {graphExtractFeedback.map((tip, i) => (
                            <p key={i} className="text-xs text-blue-700">{tip}</p>
                          ))}
                        </div>
                      )}

                      {/* ── Graph metadata (from extraction) ── */}
                      {graphMeta && (
                        <details className="rounded border border-indigo-200 bg-indigo-50 px-3 py-2">
                          <summary className="cursor-pointer text-xs font-bold text-indigo-800">📊 Extracted graph metadata</summary>
                          <div className="mt-2 space-y-1 text-xs text-indigo-900">
                            {(graphMeta.description as string) && (
                              <p><span className="font-semibold">Description:</span> {graphMeta.description as string}</p>
                            )}
                            {(graphMeta.equations as string[])?.length > 0 && (
                              <p><span className="font-semibold">Equations:</span> {(graphMeta.equations as string[]).join(", ")}</p>
                            )}
                            {(graphMeta.xIntercepts as Array<{x:number;label?:string}>)?.length > 0 && (
                              <p><span className="font-semibold">x-intercepts:</span> {(graphMeta.xIntercepts as Array<{x:number;label?:string}>).map(p => p.label ?? `(${p.x},0)`).join(", ")}</p>
                            )}
                            {(graphMeta.yIntercepts as Array<{y:number;label?:string}>)?.length > 0 && (
                              <p><span className="font-semibold">y-intercepts:</span> {(graphMeta.yIntercepts as Array<{y:number;label?:string}>).map(p => p.label ?? `(0,${p.y})`).join(", ")}</p>
                            )}
                            {(graphMeta.verticalAsymptotes as number[])?.length > 0 && (
                              <p><span className="font-semibold">Vertical asymptotes:</span> x = {(graphMeta.verticalAsymptotes as number[]).join(", x = ")}</p>
                            )}
                            {(graphMeta.horizontalAsymptotes as string[])?.length > 0 && (
                              <p><span className="font-semibold">Horizontal asymptotes:</span> {(graphMeta.horizontalAsymptotes as string[]).join(", ")}</p>
                            )}
                            {(graphMeta.markschemeHints as string[])?.length > 0 && (
                              <div>
                                <p className="font-semibold">Mark-scheme hints:</p>
                                <ul className="list-disc ml-4">
                                  {(graphMeta.markschemeHints as string[]).map((h, i) => <li key={i}>{h}</li>)}
                                </ul>
                              </div>
                            )}
                          </div>
                        </details>
                      )}

                      {/* ── Main editor + preview grid ── */}
                      <div className="grid grid-cols-2 gap-4">
                        {/* Left: JSON spec editor */}
                        <div className="flex flex-col gap-2">
                          <p className="text-xs text-gray-500">
                            Define the graph as JSON.{" "}
                            <a
                              href="https://github.com/nicolewhite/algebra.js"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline text-indigo-500"
                            >
                              Expressions
                            </a>{" "}
                            support: <code className="text-xs bg-gray-100 px-1 rounded">x^2</code>,{" "}
                            <code className="text-xs bg-gray-100 px-1 rounded">sin(x)</code>,{" "}
                            <code className="text-xs bg-gray-100 px-1 rounded">ln(x)</code>,{" "}
                            <code className="text-xs bg-gray-100 px-1 rounded">e^x</code>,{" "}
                            <code className="text-xs bg-gray-100 px-1 rounded">sqrt(x)</code>, etc.
                          </p>
                          <textarea
                            rows={16}
                            value={graphSpecJson}
                            onChange={(e) => { setGraphSpecJson(e.target.value); setGraphSpecDirty(true); setGraphParseError(null); }}
                            spellCheck={false}
                            className="w-full rounded border border-gray-300 px-2 py-1.5 font-mono text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                          />
                          {graphParseError && (
                            <p className="text-xs text-red-600">{graphParseError}</p>
                          )}
                          <div className="flex gap-2 flex-wrap">
                            <button
                              type="button"
                              onClick={() => saveGraphToField("stem_latex")}
                              disabled={graphSavingField !== null}
                              className="rounded bg-indigo-600 px-3 py-1 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
                            >
                              {graphSavingField === "stem_latex" ? "Saving…" : "Save → Stem"}
                            </button>
                            <button
                              type="button"
                              onClick={() => saveGraphToField("parts_draft_latex")}
                              disabled={graphSavingField !== null}
                              className="rounded bg-blue-600 px-3 py-1 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                              {graphSavingField === "parts_draft_latex" ? "Saving…" : "Save → Parts Draft"}
                            </button>
                            <button
                              type="button"
                              onClick={() => { setGraphSpecJson(JSON.stringify(EXAMPLE_SPEC, null, 2)); setGraphSpecDirty(false); setGraphParseError(null); }}
                              className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
                            >
                              Reset to example
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                try {
                                  const spec = JSON.parse(graphSpecJson) as IbGraphSpec;
                                  const marker = encodeGraphSpec(spec);
                                  void navigator.clipboard.writeText(marker).then(() => {
                                    setGraphCopiedMarker(marker);
                                    setGraphMarkerCopied(true);
                                    setTimeout(() => setGraphMarkerCopied(false), 2000);
                                  });
                                } catch {
                                  setGraphParseError("Invalid JSON — fix errors before copying");
                                }
                              }}
                              className="rounded border border-violet-300 bg-violet-50 px-3 py-1 text-xs font-bold text-violet-700 hover:bg-violet-100"
                            >
                              {graphMarkerCopied ? "✓ Copied!" : "📋 Copy Graph LaTeX"}
                            </button>
                          </div>
                          <details className="text-xs text-gray-500">
                            <summary className="cursor-pointer font-semibold text-gray-600">Element reference</summary>
                            <pre className="mt-1 rounded bg-gray-50 p-2 text-[10px] leading-relaxed overflow-x-auto whitespace-pre-wrap">{GRAPH_ELEMENT_REFERENCE}</pre>
                          </details>
                        </div>

                        {/* Right: live preview + optional image comparison */}
                        <div className="flex flex-col gap-3">
                          <div>
                            <p className="text-xs font-semibold text-gray-600 mb-1">Live preview (LaTeX-rendered graph)</p>
                            {(() => {
                              try {
                                const spec = JSON.parse(graphSpecJson) as IbGraphSpec;
                                return <IbGraph spec={spec} />;
                              } catch {
                                return <p className="text-xs text-gray-400 italic">Fix JSON to see preview</p>;
                              }
                            })()}
                          </div>
                          {/* Source image comparison */}
                          {graphSourceImageB64 && (
                            <div>
                              <p className="text-xs font-semibold text-gray-600 mb-1">Original image (for comparison)</p>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={`data:image/png;base64,${graphSourceImageB64}`}
                                alt="Source question image"
                                className="w-full rounded border border-gray-200 object-contain bg-white"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Images + Parts & LaTeX side-by-side ── */}
                <div className="h-[640px] grid grid-cols-2 gap-6 order-2">

                {/* ── Images (left column) ── */}
                <div className="bg-white rounded-xl border border-blue-200 p-5 overflow-y-auto">
                  <div className="flex items-center gap-3 mb-3">
                    <h2 className="text-sm font-bold text-blue-900 uppercase tracking-wide">Images</h2>
                    {!driveConnected ? (
                      <a
                        href="/api/questions/connect-drive"
                        className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800 hover:bg-amber-100"
                        title="Google Drive not connected — click to authorize"
                      >
                        🔗 Connect Drive to Extract
                      </a>
                    ) : hasDocLinkConflict ? (
                      <button
                        type="button"
                        disabled
                        className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800 opacity-90"
                        title="Question doc and markscheme doc are the same file"
                      >
                        Fix doc links first
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onExtractImages(); }}
                        disabled={extracting}
                        className="rounded-lg border border-blue-400 bg-white px-3 py-1 text-xs font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                      >
                        {extracting ? "Extracting…" : images.length > 0 ? "Re-extract" : "Extract from Docs"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={hasTroubleshooting ? onCopyTroubleshooting : () => alert("Click \"Extract from Docs\" first to collect diagnostics, then copy.")}
                      className={`rounded-lg border px-3 py-1 text-xs font-bold transition-colors ${hasTroubleshooting ? "border-amber-400 bg-amber-50 text-amber-800 hover:bg-amber-100" : "border-slate-300 bg-white text-slate-500 hover:bg-slate-50"}`}
                      title={hasTroubleshooting ? "Copy extract diagnostics for troubleshooting" : "Run Extract from Docs first to collect diagnostics"}
                    >
                      {troubleshootingCopied ? "✓ Copied!" : hasTroubleshooting ? "📋 Copy Debug Info" : "📋 Copy Debug Info"}
                    </button>
                    {images.length > 0 && (
                      <span className="text-xs text-gray-500">
                        {images.filter(i => i.image_type === "question").length} question,{" "}
                        {images.filter(i => i.image_type === "markscheme").length} markscheme
                      </span>
                    )}
                    {images.length > 0 && (
                      <button
                        type="button"
                        onClick={() => onDeleteAllImages()}
                        disabled={deletingImageIds.size > 0}
                        className="rounded-lg border border-red-300 bg-red-50 px-3 py-1 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-50"
                        title="Delete all images from storage and database"
                      >
                        {deletingImageIds.size > 0 ? "Deleting…" : "🗑 Delete Images"}
                      </button>
                    )}
                  </div>
                  <div className="space-y-4">
                    <ImageGroup
                      label="Question"
                      labelColor="blue"
                      questionId={question.id}
                      imageType="question"
                      images={images.filter(i => i.image_type === "question")}
                      deletingImageIds={deletingImageIds}
                      uploading={uploadingImage}
                      onDelete={onDeleteImage}
                      onReorder={(orderedIds) => onReorderImages("question", orderedIds)}
                      onUpload={(file) => onUploadImage("question", file)}
                      onSaveAsGraphImage={saveImageAsGraphCrop}
                      savingAsGraphImageIds={savingAsGraphCropIds}
                    />
                    <ImageGroup
                      label="Markscheme"
                      labelColor="green"
                      questionId={question.id}
                      imageType="markscheme"
                      images={images.filter(i => i.image_type === "markscheme")}
                      deletingImageIds={deletingImageIds}
                      uploading={uploadingImage}
                      onDelete={onDeleteImage}
                      onReorder={(orderedIds) => onReorderImages("markscheme", orderedIds)}
                      onUpload={(file) => onUploadImage("markscheme", file)}
                    />

                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-xs font-semibold text-violet-800 mb-1">Graph Images</p>
                        <button
                          type="button"
                          onClick={() => void fetchGraphCrops()}
                          disabled={graphCropsLoading}
                          className="rounded border border-violet-300 bg-white px-2 py-0.5 text-[11px] font-bold text-violet-700 hover:bg-violet-50 disabled:opacity-50"
                        >
                          {graphCropsLoading ? "Refreshing…" : "Refresh"}
                        </button>
                        <span className="text-xs text-gray-500">{graphCrops.length} saved</span>
                      </div>

                      {graphCropsError && (
                        <p className="text-xs text-red-600 mb-2">{graphCropsError}</p>
                      )}

                      {graphCrops.length === 0 ? (
                        <p className="text-xs text-gray-400 italic">No graph images saved for this question yet.</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {graphCrops.map((crop, idx) => {
                            const part = parts.find((p) => p.id === crop.part_id);
                            const partLabel = part?.part_label?.trim() ? `part ${part.part_label.toLowerCase()}` : crop.part_id ? "part linked" : "No part";
                            const isDeleting = deletingGraphCropIds.has(crop.id);
                            return (
                              <div key={crop.id} className="relative group rounded border border-violet-200 bg-white p-1">
                                <a
                                  href={crop.url ?? "#"}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={crop.url ?? ""}
                                    alt={`Graph crop ${idx + 1}`}
                                    className={`h-24 w-24 rounded object-cover border border-violet-100 ${isDeleting ? "opacity-40" : ""}`}
                                  />
                                </a>
                                <div className="mt-1 max-w-24 space-y-0.5">
                                  <p className="truncate text-[10px] font-semibold text-violet-800">{partLabel}</p>
                                  <p className="truncate text-[10px] text-gray-500">{crop.extractor ?? "manual"}</p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (confirm("Delete this graph image? This cannot be undone.")) {
                                      void deleteGraphCrop(crop.id);
                                    }
                                  }}
                                  disabled={isDeleting}
                                  className="absolute top-1 right-1 hidden group-hover:flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white hover:bg-red-500 disabled:opacity-50"
                                  title="Delete graph image"
                                >
                                  {isDeleting ? "…" : "×"}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* ── Parts & LaTeX (right column) ── */}
                <div className="bg-white rounded-xl border border-blue-200 p-5 overflow-y-auto">
                  <div className="flex items-center gap-3 mb-4 flex-wrap">
                    <h2 className="text-sm font-bold text-blue-900 uppercase tracking-wide">
                      Parts &amp; LaTeX
                      <span className="ml-2 font-normal text-gray-400 normal-case">({parts.length} part{parts.length !== 1 ? "s" : ""})</span>
                    </h2>
                    {/* Full-question Extract LaTeX button */}
                    {(images.some((i) => i.image_type === "question") || images.some((i) => i.image_type === "markscheme")) && (
                      <button
                        type="button"
                        onClick={() => void runFullExtract()}
                        disabled={fullExtractState === "running"}
                        className="rounded px-3 py-1.5 text-xs font-bold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 flex items-center gap-1.5 transition-colors"
                      >
                        {fullExtractState === "running" ? (
                          <><span className="inline-block w-3 h-3 border-2 border-amber-200 border-t-white rounded-full animate-spin" /> Extracting…</>
                        ) : fullExtractState === "reviewing" ? (
                          "Reviewing…"
                        ) : (
                          "⟳ Extract LaTeX"
                        )}
                      </button>
                    )}
                    {/* Reset as whole question — removes stem + all labeled parts */}
                    {hasLabeledParts && (
                      <button
                        type="button"
                        onClick={() => { if (confirm("Reset as whole question? This will clear the stem and delete ALL labeled parts.")) void resetAsWholeQuestion(); }}
                        disabled={resettingWhole}
                        className="rounded px-3 py-1.5 text-xs font-bold border border-red-300 text-red-600 bg-white hover:bg-red-50 disabled:opacity-50 transition-colors"
                      >
                        {resettingWhole ? "Resetting…" : "↺ Reset as Whole Question"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm("Clear all LaTeX and delete all parts for this question? This will erase stem + all part LaTeX and remove all parts. This cannot be undone.")) {
                          void clearAllLatex();
                        }
                      }}
                      disabled={clearingAllLatex || fullExtractState === "running" || fullExtractState === "reviewing"}
                      className="rounded px-3 py-1.5 text-xs font-bold border border-red-300 text-red-600 bg-white hover:bg-red-50 disabled:opacity-50 transition-colors"
                    >
                      {clearingAllLatex ? "Clearing…" : "🧹 Clear LaTeX"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAddPartOpen(!addPartOpen)}
                      className="ml-auto rounded px-3 py-1.5 text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                    >
                      + Add Part
                    </button>
                    {/* Expand / Collapse all part cards */}
                    {parts.length > 0 && (
                      <>
                        <button
                          type="button"
                          onClick={() => setCollapsedPartCards(new Set())}
                          className="rounded px-3 py-1.5 text-xs font-bold border border-gray-300 text-gray-600 bg-white hover:bg-gray-50 transition-colors"
                        >
                          ↕ Expand All
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const allKeys: string[] = [];
                            parts.forEach((p) => {
                              allKeys.push(`${p.id}-content_latex`, `${p.id}-markscheme_latex`);
                            });
                            setCollapsedPartCards(new Set(allKeys));
                          }}
                          className="rounded px-3 py-1.5 text-xs font-bold border border-gray-300 text-gray-600 bg-white hover:bg-gray-50 transition-colors"
                        >
                          ↕ Collapse All
                        </button>
                      </>
                    )}
                  </div>

                  {/* Confirm overwrite dialog */}
                  {fullExtractState === "confirm" && (
                    <div className="mb-4 rounded-lg border border-orange-300 bg-orange-50 p-4 space-y-3">
                      <p className="text-sm font-semibold text-orange-800">
                        ⚠ This question already has LaTeX content. Extracting will <strong>overwrite all existing part and stem LaTeX</strong> with newly extracted data.
                      </p>
                      <p className="text-xs text-orange-600">
                        Part structure will be re-determined from the images. Existing parts not found in the new extraction will be left unchanged.
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void runFullExtract()}
                          className="rounded px-4 py-1.5 text-xs font-bold bg-orange-600 text-white hover:bg-orange-700"
                        >
                          Yes, overwrite with extracted LaTeX
                        </button>
                        <button
                          type="button"
                          onClick={() => setFullExtractState("idle")}
                          className="rounded px-4 py-1.5 text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Extraction progress / log */}
                  {(fullExtractState === "running" || fullExtractState === "reviewing" || fullExtractLog.length > 0 || !!fullExtractError) && (
                    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/40 p-3 space-y-1.5">
                      <div
                        className="mb-1 flex items-center justify-between gap-2 cursor-pointer select-none"
                        onClick={() => setExtractLogCollapsed((v) => !v)}
                        title={extractLogCollapsed ? "Show extractor log" : "Collapse extractor log"}
                      >
                        <p className="text-[11px] font-semibold text-amber-900 flex items-center gap-1">
                          <span className="text-amber-600 text-[10px]">{extractLogCollapsed ? "▶" : "▼"}</span>
                          Extractor debug output
                          {extractLogCollapsed && fullExtractLog.length > 0 && (
                            <span className="ml-1 text-[10px] font-normal text-amber-700">({fullExtractLog.length} steps)</span>
                          )}
                        </p>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); copyFullExtractDebugOutput(); }}
                          disabled={fullExtractLog.length === 0 && !fullExtractError}
                          className="rounded border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                          title="Copy LaTeX extractor progress log and error"
                        >
                          {fullExtractCopied ? "✓ Copied" : "📋 Copy Debug Output"}
                        </button>
                      </div>
                      {!extractLogCollapsed && (
                        <>
                          {fullExtractLog.map((msg, i) => (
                            <p key={i} className="text-xs text-gray-600 flex items-start gap-1.5">
                              <span className="text-green-500 shrink-0 mt-0.5">✓</span>{msg}
                            </p>
                          ))}
                          {fullExtractState === "running" && (
                            <p className="text-xs text-amber-700 flex items-center gap-1.5">
                              <span className="inline-block w-3 h-3 border-2 border-amber-400 border-t-amber-700 rounded-full animate-spin" />
                              Working…
                            </p>
                          )}
                          {fullExtractError && (
                            <p className="text-xs text-red-600 font-medium">⚠ {fullExtractError}</p>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {/* Add part form */}
                  {addPartOpen && (
                    <div className="mb-5 p-4 bg-blue-50 rounded-lg border border-blue-200 space-y-3">
                      <h3 className="text-xs font-bold text-blue-900">New Part</h3>
                      {/* Input row */}
                      <div className="grid grid-cols-4 gap-3">
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-semibold text-gray-700">Label</span>
                          <input
                            type="text"
                            value={newPartDraft.partLabel}
                            onChange={(e) => setNewPartDraft((d) => ({ ...d, partLabel: e.target.value }))}
                            placeholder="a, b, c…"
                            className="border border-gray-300 rounded px-2 py-1.5 text-sm text-gray-900 focus:outline-none text-gray-900 focus:ring-2 focus:ring-blue-400"
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-semibold text-gray-700">Marks</span>
                          <input
                            type="number"
                            min={0}
                            value={newPartDraft.marks}
                            onChange={(e) => setNewPartDraft((d) => ({ ...d, marks: e.target.value }))}
                            className="border border-gray-300 rounded px-2 py-1.5 text-sm text-gray-900 focus:outline-none text-gray-900 focus:ring-2 focus:ring-blue-400"
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-semibold text-gray-700">Command Term</span>
                          <select
                            value={newPartDraft.commandTerm}
                            onChange={(e) => setNewPartDraft((d) => ({ ...d, commandTerm: e.target.value }))}
                            className="border border-gray-300 rounded px-2 py-1.5 text-sm text-gray-900 focus:outline-none text-gray-900 focus:ring-2 focus:ring-blue-400"
                          >
                            <option value="">— none —</option>
                            {DEFAULT_COMMAND_TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-semibold text-gray-700">Subtopic codes (comma-separated)</span>
                          <input
                            type="text"
                            value={newPartDraft.subtopicCodes}
                            onChange={(e) => setNewPartDraft((d) => ({ ...d, subtopicCodes: e.target.value }))}
                            placeholder="5.1.1, 5.1.2…"
                            className="border border-gray-300 rounded px-2 py-1.5 text-sm text-gray-900 focus:outline-none text-gray-900 focus:ring-2 focus:ring-blue-400"
                          />
                        </label>
                      </div>

                      {/* Add Part button — stages locally, stays open */}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={stagePart}
                          className="rounded px-3 py-1.5 text-xs font-bold bg-blue-600 text-white hover:bg-blue-700"
                        >
                          + Add Part
                        </button>
                        <button
                          type="button"
                          onClick={() => { setAddPartOpen(false); setPendingParts([]); setAddPartError(null); }}
                          className="rounded px-3 py-1.5 text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200"
                        >
                          Cancel
                        </button>
                      </div>

                      {/* Staged parts list */}
                      {pendingParts.length > 0 && (
                        <div className="space-y-1.5 pt-2 border-t border-blue-200">
                          <p className="text-xs font-semibold text-blue-800">Staged ({pendingParts.length}):</p>
                          {pendingParts.map((p, i) => (
                            <div key={i} className="flex items-center gap-3 bg-white rounded-lg border border-blue-100 px-3 py-2 text-xs">
                              <span className="font-bold text-blue-900 w-6">{p.partLabel || "—"}</span>
                              <span className="text-gray-600">{p.marks} mark{p.marks !== "1" ? "s" : ""}</span>
                              {p.commandTerm && <span className="text-gray-500">{p.commandTerm}</span>}
                              {p.subtopicCodes && <span className="text-gray-400">{p.subtopicCodes}</span>}
                              <button
                                type="button"
                                onClick={() => removePending(i)}
                                className="ml-auto text-red-400 hover:text-red-600 font-bold"
                              >✕</button>
                            </div>
                          ))}
                          {addPartError && <p className="text-xs text-red-600">{addPartError}</p>}
                          <button
                            type="button"
                            onClick={commitParts}
                            disabled={committingParts}
                            className="mt-1 rounded px-4 py-2 text-xs font-bold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                          >
                            {committingParts ? "Saving…" : `Commit ${pendingParts.length} part${pendingParts.length !== 1 ? "s" : ""} to database`}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Stem section (only when there are labelled parts) ── */}
                  {hasLabeledParts && (stemLatex || stemMsLatex || editingStem !== null) && (
                    <div className="border border-indigo-200 rounded-lg overflow-hidden mb-4">
                      <div className="bg-indigo-50 px-4 py-2.5 flex items-center gap-3 border-b border-indigo-200">
                        <span className="font-bold text-sm text-indigo-900">Stem</span>
                        <div className="flex gap-1 ml-2">
                          <button
                            type="button"
                            onClick={() => setEditingStem("stem_latex")}
                            className={`px-2 py-0.5 rounded text-xs font-medium border ${editingStem === "stem_latex" ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-indigo-700 border-indigo-300 hover:bg-indigo-50"}`}
                          >Question</button>
                        </div>
                        <button
                          type="button"
                          onClick={() => { if (confirm("Clear both stem fields? This cannot be undone.")) clearStem(); }}
                          disabled={clearingStem}
                          className="ml-1 px-2 py-0.5 rounded text-xs font-medium border border-red-300 text-red-600 bg-white hover:bg-red-50 disabled:opacity-50"
                          title="Clear stem_latex and stem_markscheme_latex from the database"
                        >{clearingStem ? "Clearing…" : "Clear Stem"}</button>
                        {editingStem && (
                          <div className="ml-auto flex gap-2">
                            <button
                              type="button"
                              onClick={() => saveStem(editingStem)}
                              disabled={savingStem}
                              className="px-3 py-1 rounded text-xs font-bold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                            >{savingStem ? "Saving…" : "Save"}</button>
                            <button
                              type="button"
                              onClick={() => { setEditingStem(null); setStemDraftQ(stemLatex); setStemDraftMS(stemMsLatex); }}
                              className="px-3 py-1 rounded text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200"
                            >Cancel</button>
                          </div>
                        )}
                      </div>
                      <div className="p-4 bg-white">
                        {editingStem === "stem_latex" ? (
                          <>
                            {graphCopiedMarker && (
                              <div className="mb-1.5 flex justify-end">
                                <button
                                  type="button"
                                  onClick={() => setStemDraftQ((v) => v + "\n" + graphCopiedMarker)}
                                  className="rounded border border-violet-300 bg-violet-50 px-2.5 py-0.5 text-[11px] font-bold text-violet-700 hover:bg-violet-100"
                                >⊕ Insert Graph</button>
                              </div>
                            )}
                            <textarea
                              className="w-full border border-gray-300 rounded p-2 text-xs font-mono text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                              rows={6}
                              value={stemDraftQ}
                              onChange={(e) => setStemDraftQ(e.target.value)}
                            />
                          </>
                        ) : editingStem === "stem_markscheme_latex" ? (
                          <>
                            {graphCopiedMarker && (
                              <div className="mb-1.5 flex justify-end">
                                <button
                                  type="button"
                                  onClick={() => setStemDraftMS((v) => v + "\n" + graphCopiedMarker)}
                                  className="rounded border border-violet-300 bg-violet-50 px-2.5 py-0.5 text-[11px] font-bold text-violet-700 hover:bg-violet-100"
                                >⊕ Insert Graph</button>
                              </div>
                            )}
                            <textarea
                              className="w-full border border-gray-300 rounded p-2 text-xs font-mono text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                              rows={6}
                              value={stemDraftMS}
                              onChange={(e) => setStemDraftMS(e.target.value)}
                            />
                          </>
                        ) : (
                          <div className="space-y-4">
                            <div>
                              {stemLatex
                                ? <LatexRenderer latex={stemLatex} />
                                : <p className="text-xs text-gray-400 italic">—</p>}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {!hasLabeledParts ? (
                    /* ── Whole question editor (no labelled parts) ── */
                    (() => {
                      const wholePart = parts[0]; // the null-label part, if it exists
                      return (
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      {/* Header: command term + subtopics */}
                      <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 space-y-2" onClick={(e) => e.stopPropagation()}>
                        <div className="flex flex-wrap items-center gap-4">
                          {wholePart && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-semibold text-gray-500">Subtopics:</span>
                              <SubtopicEditor
                                codes={wholePart.subtopic_codes}
                                available={availableSubtopics}
                                primaryCode={wholePart.primary_subtopic_code ?? null}
                                onPrimaryChange={(code) => {
                                  onUpdateSubtopics(wholePart.id, wholePart.subtopic_codes, code);
                                  setParts((prev) => prev.map((p) => (p.id === wholePart.id ? { ...p, primary_subtopic_code: code } : p)));
                                }}
                                onChange={(codes) => {
                                  onUpdateSubtopics(wholePart.id, codes);
                                  setParts((prev) => prev.map((p) => (p.id === wholePart.id ? { ...p, subtopic_codes: codes } : p)));
                                }}
                              />
                            </div>
                          )}
                        </div>

                      </div>
                      <div className="divide-y divide-gray-100">
                        {(["q", "ms"] as const).map((field) => {
                          const label = field === "q" ? "Question LaTeX" : "Markscheme LaTeX";
                          const draft = field === "q" ? wholeQDraft : wholeMSDraft;
                          const setDraft = field === "q" ? setWholeQDraft : setWholeMSDraft;
                          const isEditing = editingWhole === field;
                          return (
                            <div key={field} className="p-4 space-y-3">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-gray-600">{label}</span>
                                {!isEditing && (
                                  <button
                                    type="button"
                                    onClick={() => setEditingWhole(field)}
                                    className="rounded px-2 py-0.5 text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200"
                                  >Edit</button>
                                )}
                                {isEditing && (
                                  <div className="flex gap-1">
                                    <button
                                      type="button"
                                      onClick={() => saveWholeQuestion(field)}
                                      disabled={savingWhole}
                                      className="rounded px-2 py-0.5 text-xs font-bold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                                    >{savingWhole ? "Saving…" : "Save"}</button>
                                    <button
                                      type="button"
                                      onClick={() => { setEditingWhole(null); setDraft(""); }}
                                      className="rounded px-2 py-0.5 text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200"
                                    >Cancel</button>
                                  </div>
                                )}
                              </div>
                              {isEditing ? (
                                <>
                                  {graphCopiedMarker && (
                                    <div className="mb-1.5 flex justify-end">
                                      <button
                                        type="button"
                                        onClick={() => setDraft((v) => v + "\n" + graphCopiedMarker)}
                                        className="rounded border border-violet-300 bg-violet-50 px-2.5 py-0.5 text-[11px] font-bold text-violet-700 hover:bg-violet-100"
                                      >⊕ Insert Graph</button>
                                    </div>
                                  )}
                                  <textarea
                                    className="w-full border border-gray-300 rounded p-2 text-xs font-mono text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
                                    rows={8}
                                    value={draft}
                                    onChange={(e) => setDraft(e.target.value)}
                                    autoFocus
                                  />
                                </>
                              ) : draft ? (
                                <LatexRenderer
                                  latex={draft}
                                  stripMarkAnnotations={field === "q"}
                                  highlightCommandTerm={field === "q" ? (wholePart ? primaryCommandTerm(wholePart) : null) : null}
                                  highlightContextTerms={field === "q" ? mergeHighlightTerms(
                                    contextTermHighlightsFromFlags(wholePart ?? null, wholePart?.instructional_context_terms ?? []),
                                    wholePart?.command_terms?.slice(1) ?? [],
                                    detectCommandTerms(draft),
                                  ) : []}
                                />
                              ) : (
                                <p className="text-xs text-gray-400 italic">No LaTeX — click Edit or ⟳ Extract to add</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                      );
                    })()
                  ) : (
                    <div className="space-y-6">
                      {([
                        { key: "content_latex", title: "Question", emptyHint: "No question LaTeX — click Edit or ⟳ Extract to add" },
                        { key: "markscheme_latex", title: "Mark scheme", emptyHint: "No markscheme LaTeX — click Edit or ⟳ Extract to add" },
                      ] as const).map((section) => (
                        <div key={section.key} className="space-y-3">
                          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-600">{section.title}</h3>
                          <div className="space-y-4">
                            {parts.map((part) => {
                              const partLabel = part.part_label ? `part ${part.part_label.toLowerCase()}` : "Whole question";
                              const field = section.key;
                              const isEditing = editingLatex?.partId === part.id && editingLatex.field === field;
                              const isExtracting = extractingLatexField?.partId === part.id && extractingLatexField.field === field;
                              const fieldLabel = field === "content_latex" ? "Question LaTeX" : "Markscheme LaTeX";
                              const draft = latexDrafts[part.id]?.[field] ?? "";
                              const saved = part[field] ?? "";
                              const claudeKey = `${part.id}-${field}`;
                              const cardKey = `${part.id}-${field}`;
                              const isCollapsed = collapsedPartCards.has(cardKey);
                              const hasImages = field === "content_latex"
                                ? images.some((i) => i.image_type === "question")
                                : images.some((i) => i.image_type === "markscheme");

                              return (
                                <div key={`${part.id}-${field}`} className="border border-gray-200 rounded-lg overflow-hidden">
                                  <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 space-y-2" onClick={(e) => e.stopPropagation()}>
                                    <div className="flex flex-wrap items-center gap-3">
                                      <button
                                        type="button"
                                        className="text-base text-gray-500 hover:text-gray-700 leading-none shrink-0"
                                        onClick={() => togglePartCard(cardKey)}
                                        title={isCollapsed ? "Expand this part" : "Collapse this part"}
                                      >
                                        {isCollapsed ? "▸" : "▾"}
                                      </button>
                                      <span className="font-bold text-sm text-blue-900">{partLabel}</span>
                                      <span className="text-xs text-gray-500 font-medium">[{part.marks} mark{part.marks !== 1 ? "s" : ""}]</span>
                                      {part.latex_verified && (
                                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">✓ Verified</span>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => { if (confirm(`Delete ${partLabel}? This cannot be undone.`)) deletePart(part.id); }}
                                        disabled={deletingPartId === part.id}
                                        className="ml-auto w-6 h-6 flex items-center justify-center rounded text-red-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 transition-colors shrink-0"
                                        title="Delete this part"
                                      >{deletingPartId === part.id ? "…" : "×"}</button>
                                    </div>
                                    {/* Second row: subtopics */}
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-xs font-semibold text-gray-500">Subtopics:</span>
                                      <SubtopicEditor
                                        codes={part.subtopic_codes}
                                        available={availableSubtopics}
                                        primaryCode={part.primary_subtopic_code ?? null}
                                        onPrimaryChange={(code) => {
                                          onUpdateSubtopics(part.id, part.subtopic_codes, code);
                                          setParts((prev) => prev.map((p) => (p.id === part.id ? { ...p, primary_subtopic_code: code } : p)));
                                        }}
                                        onChange={(codes) => {
                                          onUpdateSubtopics(part.id, codes);
                                          setParts((prev) => prev.map((p) => (p.id === part.id ? { ...p, subtopic_codes: codes } : p)));
                                        }}
                                      />
                                    </div>
                                  </div>

                                  {!isCollapsed && <div className="p-4 space-y-3">
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs font-semibold text-gray-600">{fieldLabel}</span>
                                      <div className="flex gap-1 items-center">
                                        {field === "markscheme_latex" && part.subtopic_codes.length >= 1 && !isEditing && (
                                          <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mr-1">Attribution</span>
                                        )}
                                        {hasImages && !isEditing && (
                                          <button
                                            type="button"
                                            onClick={() => extractLatexFromImages(part.id, field)}
                                            disabled={isExtracting}
                                            title="Extract LaTeX from uploaded images using OCR"
                                            className="rounded px-2 py-0.5 text-xs font-bold bg-amber-100 text-amber-800 hover:bg-amber-200 disabled:opacity-50 flex items-center gap-1"
                                          >
                                            {isExtracting ? (
                                              <><span className="inline-block w-3 h-3 border-2 border-amber-400 border-t-amber-700 rounded-full animate-spin" /> Extracting…</>
                                            ) : (
                                              "⟳ Extract"
                                            )}
                                          </button>
                                        )}
                                        {isEditing ? (
                                          <div className="flex gap-1">
                                            <button
                                              type="button"
                                              onClick={() => saveLatex(part.id, field)}
                                              disabled={savingLatex}
                                              className="rounded px-2 py-0.5 text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                                            >
                                              {savingLatex ? "Saving…" : "Save"}
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setEditingLatex(null);
                                                setLatexDrafts((d) => ({ ...d, [part.id]: { ...d[part.id], [field]: saved } }));
                                              }}
                                              className="rounded px-2 py-0.5 text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200"
                                            >
                                              Cancel
                                            </button>
                                          </div>
                                        ) : (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setEditingLatex({ partId: part.id, field });
                                              setLatexDrafts((d) => ({ ...d, [part.id]: { ...d[part.id], [field]: saved } }));
                                            }}
                                            className="rounded px-2 py-0.5 text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200"
                                          >
                                            Edit
                                          </button>
                                        )}
                                      </div>
                                    </div>

                                    {isEditing ? (
                                      <>
                                        {isExtracting && (
                                          <p className="text-xs text-amber-600 italic flex items-center gap-1">
                                            <span className="inline-block w-3 h-3 border-2 border-amber-400 border-t-amber-700 rounded-full animate-spin" />
                                            Running OCR on images…
                                          </p>
                                        )}
                                        {graphCopiedMarker && (
                                          <div className="mb-1.5 flex justify-end">
                                            <button
                                              type="button"
                                              onClick={() => setLatexDrafts((d) => ({ ...d, [part.id]: { ...d[part.id], [field]: (d[part.id]?.[field] ?? "") + "\n" + graphCopiedMarker } }))}
                                              className="rounded border border-violet-300 bg-violet-50 px-2.5 py-0.5 text-[11px] font-bold text-violet-700 hover:bg-violet-100"
                                            >⊕ Insert Graph</button>
                                          </div>
                                        )}
                                        <textarea
                                          className="w-full border border-gray-300 rounded p-2 text-xs font-mono resize-y min-h-24 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
                                          value={draft}
                                          onChange={(e) => setLatexDrafts((d) => ({ ...d, [part.id]: { ...d[part.id], [field]: e.target.value } }))}
                                          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void saveLatex(part.id, field); } }}
                                        />
                                        <div className="flex gap-2 pt-1 border-t border-gray-100">
                                          <input
                                            type="text"
                                            placeholder="Correction for Claude, e.g. 'fix the fraction in line 2'…"
                                            value={claudeInstruction[claudeKey] ?? ""}
                                            onChange={(e) => setClaudeInstruction((c) => ({ ...c, [claudeKey]: e.target.value }))}
                                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void runClaude(part.id, field); } }}
                                            className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-400"
                                          />
                                          <button
                                            type="button"
                                            onClick={() => void runClaude(part.id, field)}
                                            disabled={claudeLoading[claudeKey] || !(claudeInstruction[claudeKey] ?? "").trim()}
                                            className="rounded px-2 py-1 text-xs font-bold bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-40"
                                          >
                                            {claudeLoading[claudeKey] ? "…" : "Ask Claude"}
                                          </button>
                                        </div>
                                      </>
                                    ) : saved ? (
                                      <div className="flex gap-3 items-start text-sm leading-relaxed min-h-8">
                                        <div className="flex-1">
                                          <LatexRenderer
                                            latex={saved}
                                            stripMarkAnnotations={field === "content_latex"}
                                            highlightCommandTerm={field === "content_latex" ? primaryCommandTerm(part) : null}
                                            highlightContextTerms={field === "content_latex" ? mergeHighlightTerms(
                                              contextTermHighlightsFromFlags(part, part.instructional_context_terms ?? []),
                                              part.command_terms?.slice(1) ?? [],
                                              detectCommandTerms(saved),
                                            ) : []}
                                            renderMarkAttribution={field === "markscheme_latex" && part.subtopic_codes.length >= 1
                                              ? makeMarkAttributionRenderer(part, saved)
                                              : undefined}
                                          />
                                        </div>
                                      </div>
                                    ) : (
                                      <p className="text-xs text-gray-400 italic">{section.emptyHint}</p>
                                    )}
                                  </div>}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                </div>{/* end grid */}
            </div>
          </div>
        )}
        </>,
        document.body
      )}
    </>
  );
}