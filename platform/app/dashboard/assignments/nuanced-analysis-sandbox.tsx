"use client";

/**
 * NuancedAnalysisSandbox
 * ──────────────────────
 * Full sandbox for creating, editing, and exporting Nuanced Analysis packets.
 *
 * Features:
 *   - AI-powered activity generator (ActivityGeneratorPanel)
 *   - Live NuancedAnalysisPreview with in-place editing
 *   - Global answer-box line count control
 *   - "Download PDF (Typst)" button → /api/typst-render via DocumentOrchestratorService
 *   - Marks/marks-column toggle, answer key toggle
 *   - Teacher's Companion toggle for the PDF export
 */

import { useState, useCallback } from "react";
import type { AssignmentDraft, FormattingRequirements } from "@/lib/assignments";
import { NuancedAnalysisPreview } from "./nuanced-analysis-preview";
import { ActivityGeneratorPanel } from "./activity-generator";
import { EditTemplateModal } from "./edit-template-modal";
import { DocumentOrchestratorService } from "@/lib/document-orchestrator-nuanced";

// ── Default formatting ────────────────────────────────────────────────────────

const DEFAULT_FORMATTING: FormattingRequirements = {
  schoolName: "CleverPlatform Mathematics",
  teacherName: "",
  includeNameLine: true,
  includeDateLine: true,
  includeMarksColumn: true,
  includeAnswerKey: false,
  fontSize: 11,
  lineSpacing: "relaxed",
  pageMarginsMm: 16,
  numberingStyle: "numeric",
  answerBoxLines: 5,
  answerStyle: "boxes",
};

// ── Minimal default draft (shown before first generation) ─────────────────────

const DEFAULT_DRAFT: AssignmentDraft = {
  title: "Nuanced Analysis",
  subtitle: "IBDP Mathematics — Analysis & Approaches HL",
  instructions: [
    "Read the Command Terms glossary before starting. Tear it off and keep it beside you.",
    "Complete Parts in order. Each Part's micro-box tells you what prior knowledge you need.",
    "Compulsory core: ★ and ★★ questions. ★★★ questions are optional challenge extensions.",
    "Show all working unless the command term is Write down or State.",
  ],
  sections: [
    {
      heading: "Part 0 — Activating Prior Knowledge",
      questions: [
        {
          prompt:
            "★ Write down the key result or definition from the prerequisite topic that this analysis builds on.",
          marks: 2,
          tier: 1,
        },
        {
          prompt: "★ Describe, in one sentence, the geometric meaning of that result.",
          marks: 2,
          tier: 1,
        },
      ],
    },
    {
      heading: "Part 1 — Conjecture",
      prerequisiteBox: { items: ["Result from Part 0"] },
      questions: [
        {
          prompt:
            "★ Use specific numerical values to investigate the key relationship. Write down your results in a table.",
          marks: 3,
          tier: 1,
        },
        {
          prompt: "★★ Show that your conjecture holds in the general case. Show every logical step.",
          marks: 4,
          tier: 2,
        },
      ],
    },
  ],
  tokProvocations: [
    {
      id: "tok1",
      body: "When a mathematical model perfectly predicts a physical phenomenon, does that make the model true, or merely useful?",
    },
    {
      id: "tok2",
      body: "If a result can be proven in two completely different ways, what does that say about the nature of mathematical truth?",
    },
  ],
  internationalMindedness: {
    body: "The results explored here have roots in contributions from mathematicians across many cultures and centuries. Understanding this history enriches our appreciation of how mathematics develops.",
  },
  commandTerms: [
    { term: "Write down", definition: "A short answer with no working required." },
    { term: "Show that", definition: "Obtain a stated result; every logical step must appear." },
    { term: "Prove", definition: "Establish truth by a rigorous, complete chain of reasoning." },
  ],
};

// ── Download helpers ──────────────────────────────────────────────────────────

type PdfStatus = "idle" | "building" | "error";

async function downloadTypstPdf(
  draft: AssignmentDraft,
  includeTeacherCompanion: boolean
): Promise<string | null> {
  const orchResult = DocumentOrchestratorService.build(draft, undefined, {
    includeTeacherCompanion,
    includeAnswerKey: false,
  });

  if (!orchResult.success) return orchResult.error;

  const res = await fetch("/api/typst-render", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(orchResult.payload),
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    return err.error ?? `HTTP ${res.status}`;
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${draft.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return null;
}

// ── NuancedAnalysisSandbox ────────────────────────────────────────────────────

export function NuancedAnalysisSandbox() {
  const [draft, setDraft] = useState<AssignmentDraft>(DEFAULT_DRAFT);
  const [formatting, setFormatting] = useState<FormattingRequirements>(DEFAULT_FORMATTING);
  const [globalAnswerLines, setGlobalAnswerLines] = useState(5);
  const [includeTeacherCompanion, setIncludeTeacherCompanion] = useState(false);
  const [pdfStatus, setPdfStatus] = useState<PdfStatus>("idle");
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);

  const handleDraftGenerated = useCallback((d: AssignmentDraft) => {
    setDraft(d);
  }, []);

  const handleDraftChange = useCallback((d: AssignmentDraft) => {
    setDraft(d);
  }, []);

  async function handleDownloadPdf() {
    setPdfStatus("building");
    setPdfError(null);
    try {
      const err = await downloadTypstPdf(draft, includeTeacherCompanion);
      if (err) {
        setPdfError(err);
        setPdfStatus("error");
      } else {
        setPdfStatus("idle");
      }
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : "Unknown error");
      setPdfStatus("error");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── AI generator panel ──────────────────────────────────────────────── */}
      <ActivityGeneratorPanel
        gradeLevel="Grade 12"
        formatting={formatting}
        onDraftGenerated={handleDraftGenerated}
      />

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-da-border bg-da-bg/40 px-4 py-2">
        {/* Answer box lines */}
        <label className="flex items-center gap-1.5 text-xs text-da-muted">
          Answer lines
          <input
            type="number"
            min={2}
            max={20}
            value={globalAnswerLines}
            onChange={(e) => setGlobalAnswerLines(Math.max(2, Math.min(20, Number(e.target.value))))}
            className="w-10 rounded border border-da-border/50 bg-da-bg/30 px-1 py-0.5 text-center text-xs text-da-text focus:outline-none"
          />
        </label>

        {/* Marks column */}
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-da-muted">
          <input
            type="checkbox"
            checked={formatting.includeMarksColumn}
            onChange={(e) =>
              setFormatting((f) => ({ ...f, includeMarksColumn: e.target.checked }))
            }
            className="rounded"
          />
          Show marks
        </label>

        {/* Answer key */}
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-da-muted">
          <input
            type="checkbox"
            checked={formatting.includeAnswerKey}
            onChange={(e) =>
              setFormatting((f) => ({ ...f, includeAnswerKey: e.target.checked }))
            }
            className="rounded"
          />
          Answer key
        </label>

        {/* Teacher's companion in PDF */}
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-da-muted">
          <input
            type="checkbox"
            checked={includeTeacherCompanion}
            onChange={(e) => setIncludeTeacherCompanion(e.target.checked)}
            className="rounded"
          />
          Include Teacher&apos;s Companion
        </label>

        <div className="ml-auto flex items-center gap-2">
          {pdfStatus === "error" && pdfError && (
            <span className="max-w-xs truncate text-xs text-red-400" title={pdfError}>
              {pdfError}
            </span>
          )}
          <button
            type="button"
            onClick={() => setTemplateModalOpen(true)}
            className="rounded-lg border border-da-border bg-da-bg/60 px-3 py-1.5 text-xs font-semibold text-da-text transition-colors hover:bg-da-bg"
          >
            ✎ Edit Template
          </button>
          <button
            type="button"
            onClick={() => void handleDownloadPdf()}
            disabled={pdfStatus === "building"}
            className="rounded-lg border border-da-accent/70 bg-da-accent/20 px-3 py-1.5 text-xs font-semibold text-da-text transition-colors hover:bg-da-accent/30 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pdfStatus === "building" ? "Building PDF…" : "⬇ Download PDF"}
          </button>
        </div>
      </div>

      {/* ── Live preview ──────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-da-border bg-white p-4 shadow-sm print:border-0 print:shadow-none">
        <NuancedAnalysisPreview
          draft={draft}
          formatting={formatting}
          onDraftChange={handleDraftChange}
          globalAnswerLines={globalAnswerLines}
          gradeLevel="Grade 12"
        />
      </div>

      {/* ── Edit Template modal ──────────────────────────────────────────────── */}
      <EditTemplateModal
        open={templateModalOpen}
        onClose={() => setTemplateModalOpen(false)}
      />
    </div>
  );
}
