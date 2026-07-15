"use client";

/**
 * EditTemplateModal
 * ─────────────────
 * The "Edit Template" flow for the Nuanced Analysis pedagogical spec
 * (NuancedAnalysisSpec — the validated JSON that defines what every generated
 * packet must contain: the three-phase flipped/in-class/take-home spine, the
 * packet order, the eight design layers, planted errors, TOK, reflection, the
 * Teacher's Companion contract, and so on).
 *
 * Two ways to edit:
 *   1. "Claude assistant" (primary): describe the change in plain language →
 *      /api/nuanced-analysis-spec/edit (claude-opus-4-5) proposes a validated
 *      updated spec → review which sections changed → Save or Discard.
 *   2. "Raw JSON" (advanced): edit the spec JSON directly; parsing is checked
 *      locally, full Zod validation happens on save.
 *
 * Nothing is persisted until the explicit Save, which PUTs to
 * /api/nuanced-analysis-spec (canonical scope) — the same spec the generator
 * loads, so saved changes drive the very next packet generation.
 *
 * This component is fully self-contained (new file) so it cannot disturb any
 * existing sandbox UI.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { NuancedAnalysisSpec } from "@/lib/nuanced-analysis-spec.schema";

// ── API response shapes ───────────────────────────────────────────────────────

type SpecSource = "own" | "canonical" | "builtin";

type GetSpecResponse = {
  spec: NuancedAnalysisSpec;
  source: SpecSource;
  rowId: string | null;
  specVersion: string;
  checklist: string[];
  compiledPromptChars: number;
  error?: string;
};

type EditSpecResponse = {
  success?: boolean;
  spec?: NuancedAnalysisSpec;
  changedSections?: string[];
  specVersion?: string;
  checklist?: string[];
  error?: string;
  detail?: string;
  fieldErrors?: Record<string, string>;
};

type PutSpecResponse = {
  success?: boolean;
  rowId?: string;
  specVersion?: string;
  checklist?: string[];
  error?: string;
  fieldErrors?: Record<string, string>;
};

type AppliedEdit = { instruction: string; changedSections: string[] };

const SOURCE_LABEL: Record<SpecSource, string> = {
  own: "Your course variant",
  canonical: "Shared canonical template",
  builtin: "Built-in default (not yet in database)",
};

function formatFieldErrors(fieldErrors?: Record<string, string>): string | null {
  if (!fieldErrors) return null;
  const entries = Object.entries(fieldErrors).slice(0, 6);
  const lines = entries.map(([path, msg]) => `${path}: ${msg}`);
  const more = Object.keys(fieldErrors).length - entries.length;
  return lines.join(" • ") + (more > 0 ? ` • …and ${more} more` : "");
}

// ── Component ─────────────────────────────────────────────────────────────────

export function EditTemplateModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  // Loaded baseline (what is saved right now)
  const [baseSpec, setBaseSpec] = useState<NuancedAnalysisSpec | null>(null);
  const [source, setSource] = useState<SpecSource>("builtin");
  const [specVersion, setSpecVersion] = useState<string>("");
  const [checklist, setChecklist] = useState<string[]>([]);
  const [promptChars, setPromptChars] = useState<number>(0);

  // Pending (proposed but unsaved) spec
  const [draftSpec, setDraftSpec] = useState<NuancedAnalysisSpec | null>(null);
  const [changedSections, setChangedSections] = useState<string[]>([]);
  const [appliedEdits, setAppliedEdits] = useState<AppliedEdit[]>([]);

  // UI state
  const [tab, setTab] = useState<"assistant" | "json">("assistant");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveDone, setSaveDone] = useState(false);
  const [rawJson, setRawJson] = useState("");
  const [rawJsonError, setRawJsonError] = useState<string | null>(null);

  /** The spec the next action operates on: pending draft if present, else baseline. */
  const workingSpec = draftSpec ?? baseSpec;
  const hasPending = draftSpec !== null;

  const loadSpec = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setSaveDone(false);
    try {
      const res = await fetch("/api/nuanced-analysis-spec");
      const data = (await res.json()) as GetSpecResponse;
      if (!res.ok || data.error) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setBaseSpec(data.spec);
      setSource(data.source);
      setSpecVersion(data.specVersion);
      setChecklist(data.checklist);
      setPromptChars(data.compiledPromptChars);
      setDraftSpec(null);
      setChangedSections([]);
      setAppliedEdits([]);
      setRawJson(JSON.stringify(data.spec, null, 2));
      setRawJsonError(null);
      setEditError(null);
      setSaveError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load the template.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void loadSpec();
  }, [open, loadSpec]);

  async function handleClaudeEdit() {
    if (!workingSpec || instruction.trim().length === 0) return;
    setEditing(true);
    setEditError(null);
    setSaveDone(false);
    try {
      const res = await fetch("/api/nuanced-analysis-spec/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: instruction.trim(), spec: workingSpec }),
      });
      const data = (await res.json()) as EditSpecResponse;
      if (!res.ok || !data.success || !data.spec) {
        const fieldPart = formatFieldErrors(data.fieldErrors);
        throw new Error(
          [data.error, data.detail, fieldPart].filter(Boolean).join(" — ") ||
            `HTTP ${res.status}`,
        );
      }
      setDraftSpec(data.spec);
      setChangedSections((prev) =>
        Array.from(new Set([...prev, ...(data.changedSections ?? [])])),
      );
      setAppliedEdits((prev) => [
        ...prev,
        { instruction: instruction.trim(), changedSections: data.changedSections ?? [] },
      ]);
      if (data.checklist) setChecklist(data.checklist);
      if (data.specVersion) setSpecVersion(data.specVersion);
      setRawJson(JSON.stringify(data.spec, null, 2));
      setInstruction("");
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "The edit failed.");
    } finally {
      setEditing(false);
    }
  }

  function handleStageRawJson() {
    setRawJsonError(null);
    setSaveDone(false);
    try {
      const parsed = JSON.parse(rawJson) as NuancedAnalysisSpec;
      setDraftSpec(parsed);
      setChangedSections(["(edited as raw JSON)"]);
      setAppliedEdits((prev) => [
        ...prev,
        { instruction: "Raw JSON edit", changedSections: [] },
      ]);
    } catch (e) {
      setRawJsonError(
        e instanceof Error ? `Not valid JSON: ${e.message}` : "Not valid JSON.",
      );
    }
  }

  async function handleSave() {
    if (!draftSpec) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/nuanced-analysis-spec", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec: draftSpec, scope: "canonical" }),
      });
      const data = (await res.json()) as PutSpecResponse;
      if (!res.ok || !data.success) {
        const fieldPart = formatFieldErrors(data.fieldErrors);
        throw new Error(
          [data.error, fieldPart].filter(Boolean).join(" — ") || `HTTP ${res.status}`,
        );
      }
      // Saved draft becomes the new baseline.
      setBaseSpec(draftSpec);
      setDraftSpec(null);
      setChangedSections([]);
      setAppliedEdits([]);
      setSource("canonical");
      if (data.specVersion) setSpecVersion(data.specVersion);
      if (data.checklist) setChecklist(data.checklist);
      setSaveDone(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  function handleDiscard() {
    setDraftSpec(null);
    setChangedSections([]);
    setAppliedEdits([]);
    setEditError(null);
    setSaveError(null);
    setSaveDone(false);
    if (baseSpec) setRawJson(JSON.stringify(baseSpec, null, 2));
  }

  const checklistPreview = useMemo(() => checklist.slice(0, 13), [checklist]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Edit Nuanced Analysis template"
    >
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-da-border bg-da-bg shadow-2xl">
        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-3 border-b border-da-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-da-text">
              Edit Nuanced Analysis Template
            </h2>
            <p className="mt-0.5 text-xs text-da-muted">
              {SOURCE_LABEL[source]} · version {specVersion || "—"} · compiles to{" "}
              {promptChars.toLocaleString()} prompt characters
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-da-border px-2 py-1 text-xs text-da-muted transition-colors hover:bg-da-bg/60 hover:text-da-text"
          >
            ✕ Close
          </button>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && <p className="text-xs text-da-muted">Loading template…</p>}

          {loadError && (
            <div className="rounded-lg border border-red-400/40 bg-red-400/10 px-3 py-2 text-xs text-red-400">
              {loadError}{" "}
              <button type="button" onClick={() => void loadSpec()} className="underline">
                Retry
              </button>
            </div>
          )}

          {!loading && !loadError && workingSpec && (
            <>
              {/* Tabs */}
              <div className="mb-4 flex gap-1 rounded-lg border border-da-border bg-da-bg/40 p-1 text-xs">
                <button
                  type="button"
                  onClick={() => setTab("assistant")}
                  className={`flex-1 rounded-md px-3 py-1.5 font-semibold transition-colors ${
                    tab === "assistant"
                      ? "bg-da-accent/25 text-da-text"
                      : "text-da-muted hover:text-da-text"
                  }`}
                >
                  ✦ Claude assistant
                </button>
                <button
                  type="button"
                  onClick={() => setTab("json")}
                  className={`flex-1 rounded-md px-3 py-1.5 font-semibold transition-colors ${
                    tab === "json"
                      ? "bg-da-accent/25 text-da-text"
                      : "text-da-muted hover:text-da-text"
                  }`}
                >
                  {"{ }"} Raw JSON
                </button>
              </div>

              {tab === "assistant" && (
                <div className="flex flex-col gap-4">
                  {/* What the template enforces */}
                  <div className="rounded-xl border border-da-border bg-da-bg/40 px-4 py-3">
                    <p className="mb-2 text-xs font-semibold text-da-text">
                      Every generated packet must include
                    </p>
                    <ul className="grid gap-1 text-xs text-da-muted sm:grid-cols-2">
                      {checklistPreview.map((item) => (
                        <li key={item} className="flex gap-1.5">
                          <span className="text-da-accent">•</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Instruction box */}
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-da-text">
                      Describe the change
                    </label>
                    <textarea
                      value={instruction}
                      onChange={(e) => setInstruction(e.target.value)}
                      rows={3}
                      placeholder='e.g. "Make the flipped-classroom phase 20 minutes and require a Desmos task in every packet" or "Add a design-layer rule that every Part ends with a one-line summary box"'
                      className="w-full rounded-lg border border-da-border bg-da-bg/30 px-3 py-2 text-xs text-da-text placeholder:text-da-muted/60 focus:outline-none"
                    />
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleClaudeEdit()}
                        disabled={editing || instruction.trim().length === 0}
                        className="rounded-lg border border-da-accent/70 bg-da-accent/20 px-3 py-1.5 text-xs font-semibold text-da-text transition-colors hover:bg-da-accent/30 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {editing ? "Claude is editing…" : "✦ Apply with Claude (Opus)"}
                      </button>
                      <span className="text-[11px] text-da-muted">
                        Structure is protected — the result is validated before you can save.
                      </span>
                    </div>
                    {editError && (
                      <p className="mt-2 rounded-lg border border-red-400/40 bg-red-400/10 px-3 py-2 text-xs text-red-400">
                        {editError}
                      </p>
                    )}
                  </div>

                  {/* Session edits */}
                  {appliedEdits.length > 0 && (
                    <div className="rounded-xl border border-da-border bg-da-bg/40 px-4 py-3">
                      <p className="mb-1.5 text-xs font-semibold text-da-text">
                        Pending edits this session
                      </p>
                      <ol className="flex flex-col gap-1 text-xs text-da-muted">
                        {appliedEdits.map((edit, i) => (
                          <li key={`${i}-${edit.instruction}`} className="flex gap-1.5">
                            <span className="text-da-accent">{i + 1}.</span>
                            <span>
                              {edit.instruction}
                              {edit.changedSections.length > 0 && (
                                <span className="text-da-muted/70">
                                  {" "}
                                  → {edit.changedSections.join(", ")}
                                </span>
                              )}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </div>
              )}

              {tab === "json" && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-da-muted">
                    Direct edit of the template JSON. Structure and limits are enforced by
                    validation when you save — invalid changes are rejected with the exact
                    field errors.
                  </p>
                  <textarea
                    value={rawJson}
                    onChange={(e) => setRawJson(e.target.value)}
                    spellCheck={false}
                    rows={18}
                    className="w-full rounded-lg border border-da-border bg-da-bg/30 px-3 py-2 font-mono text-[11px] leading-relaxed text-da-text focus:outline-none"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleStageRawJson}
                      className="rounded-lg border border-da-border bg-da-bg/60 px-3 py-1.5 text-xs font-semibold text-da-text transition-colors hover:bg-da-bg"
                    >
                      Stage JSON changes
                    </button>
                    {rawJsonError && <span className="text-xs text-red-400">{rawJsonError}</span>}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2 border-t border-da-border px-5 py-3">
          {hasPending && (
            <span className="rounded-full border border-da-accent/50 bg-da-accent/15 px-2.5 py-1 text-[11px] font-semibold text-da-text">
              Unsaved changes
              {changedSections.length > 0 && `: ${changedSections.join(", ")}`}
            </span>
          )}
          {saveDone && !hasPending && (
            <span className="rounded-full border border-emerald-400/50 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-400">
              Saved — the next generated packet uses this template
            </span>
          )}
          {saveError && (
            <span className="max-w-md truncate text-xs text-red-400" title={saveError}>
              {saveError}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {hasPending && (
              <button
                type="button"
                onClick={handleDiscard}
                disabled={saving}
                className="rounded-lg border border-da-border px-3 py-1.5 text-xs font-semibold text-da-muted transition-colors hover:bg-da-bg/60 hover:text-da-text disabled:opacity-60"
              >
                Discard
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!hasPending || saving}
              className="rounded-lg border border-da-accent/70 bg-da-accent/20 px-3 py-1.5 text-xs font-semibold text-da-text transition-colors hover:bg-da-accent/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save template"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
