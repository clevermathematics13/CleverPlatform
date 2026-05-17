"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import LatexRenderer from "@/components/LatexRenderer";
import { splitDraftIntoParts } from "../review/split-draft-into-parts";
import { parseMarksFromLatex } from "./question-utils";
import type { ExtractPlan, QuestionImage } from "./types";

export function ExtractionReviewModal({
  plan: initialPlan,
  questionCode,
  images,
  onConfirm,
  onCancel,
}: {
  plan: ExtractPlan;
  questionCode: string;
  images: QuestionImage[];
  onConfirm: (plan: ExtractPlan) => void;
  onCancel: () => void;
}) {
  type StepSpec =
    | { kind: "parts" }
    | { kind: "stem" }
    | { kind: "whole" }
    | { kind: "part"; label: string };

  const [plan, setPlan] = useState<ExtractPlan>(initialPlan);
  const [stepIdx, setStepIdx] = useState(0);
  const [labelsText, setLabelsText] = useState(
    initialPlan.isWholeQuestion ? "" : initialPlan.finalLabels.join(", "),
  );
  const [showDebug, setShowDebug] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [zoom, setZoom] = useState(100);

  function buildSteps(p: ExtractPlan): StepSpec[] {
    const s: StepSpec[] = [{ kind: "parts" }];
    if (p.isWholeQuestion) {
      s.push({ kind: "whole" });
    } else {
      s.push({ kind: "stem" });
      for (const label of p.finalLabels) {
        s.push({ kind: "part", label });
      }
    }
    return s;
  }

  const steps = buildSteps(plan);
  const currentStep = steps[stepIdx];
  const isLast = stepIdx > 0 && stepIdx >= steps.length - 1;

  function handleNext() {
    let planToUse = plan;
    if (stepIdx === 0) {
      const newLabels = labelsText
        .split(/[\s,]+/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (newLabels.length === 0) {
        const newPartMarks = new Map<string, number>();
        newPartMarks.set("", plan.partMarks?.get("") ?? parseMarksFromLatex(plan.qDraft) ?? 1);
        planToUse = {
          ...plan,
          finalLabels: [],
          isWholeQuestion: true,
          stemQ: "",
          stemMS: "",
          splitQ: new Map(),
          splitMS: new Map(),
          partMarks: newPartMarks,
        };
      } else {
        const { stem: stemQ, parts: splitQ } = splitDraftIntoParts(plan.qDraft, newLabels);
        const { stem: stemMS, parts: splitMS } = splitDraftIntoParts(plan.msDraft, newLabels);
        const newPartMarks = new Map<string, number>();
        for (const label of newLabels) {
          const sq = splitQ.get(label) ?? "";
          const sm = splitMS.get(label) ?? "";
          newPartMarks.set(label, plan.partMarks?.get(label) ?? parseMarksFromLatex(sq || sm) ?? 1);
        }
        planToUse = { ...plan, finalLabels: newLabels, isWholeQuestion: false, stemQ, stemMS, splitQ, splitMS, partMarks: newPartMarks };
      }
      setPlan(planToUse);
    }
    const stepsForPlan = buildSteps(planToUse);
    const nextIdx = stepIdx + 1;
    if (nextIdx >= stepsForPlan.length) {
      onConfirm(planToUse);
    } else {
      setStepIdx(nextIdx);
      setShowDebug(false);
    }
  }

  function handleBack() {
    setStepIdx((s) => Math.max(0, s - 1));
    setShowDebug(false);
  }

  function handleConfirmAll() {
    let planToUse = plan;
    if (stepIdx === 0) {
      const newLabels = labelsText
        .split(/[\s,]+/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (newLabels.length === 0) {
        const newPartMarks = new Map<string, number>();
        newPartMarks.set("", plan.partMarks?.get("") ?? parseMarksFromLatex(plan.qDraft) ?? 1);
        planToUse = {
          ...plan,
          finalLabels: [],
          isWholeQuestion: true,
          stemQ: "",
          stemMS: "",
          splitQ: new Map(),
          splitMS: new Map(),
          partMarks: newPartMarks,
        };
      } else {
        const { stem: stemQ, parts: splitQ } = splitDraftIntoParts(plan.qDraft, newLabels);
        const { stem: stemMS, parts: splitMS } = splitDraftIntoParts(plan.msDraft, newLabels);
        const newPartMarks = new Map<string, number>();
        for (const label of newLabels) {
          const sq = splitQ.get(label) ?? "";
          const sm = splitMS.get(label) ?? "";
          newPartMarks.set(label, plan.partMarks?.get(label) ?? parseMarksFromLatex(sq || sm) ?? 1);
        }
        planToUse = { ...plan, finalLabels: newLabels, isWholeQuestion: false, stemQ, stemMS, splitQ, splitMS, partMarks: newPartMarks };
      }
    }
    onConfirm(planToUse);
  }

  const debugText = [
    `=== Extraction Review — ${questionCode} ===`,
    ``,
    `=== OCR Output ===`,
    `Question LaTeX length: ${plan.qDraft.length} chars`,
    `Mark scheme LaTeX length: ${plan.msDraft.length} chars`,
    ``,
    `=== Label Detection ===`,
    `Claude returned labels: ${plan.debug.claudeLabels.length > 0 ? plan.debug.claudeLabels.join(", ") : "(none)"}`,
    `OCR-detected labels: ${plan.debug.detectedLabels.length > 0 ? plan.debug.detectedLabels.join(", ") : "(none)"}`,
    `Candidate labels (before guards): ${plan.debug.candidateLabels.length > 0 ? plan.debug.candidateLabels.join(", ") : "(none)"}`,
    `Split probe found parts: ${plan.debug.splitProbeKeys.length > 0 ? plan.debug.splitProbeKeys.join(", ") : "(none)"}`,
    `Inferred labels: ${plan.debug.inferredLabels.length > 0 ? plan.debug.inferredLabels.join(", ") : "(none)"}`,
    `Final labels after guards: ${plan.finalLabels.length > 0 ? plan.finalLabels.join(", ") : "(whole question)"}`,
    ``,
    `=== Guard Flags ===`,
    `hasExplicitPartEnvironment: ${plan.debug.hasExplicitPartEnvironment}`,
    `canTrustClaudeMultipartWithoutExplicit: ${plan.debug.canTrustClaudeMultipart}`,
    `isSuspiciousSingleA: ${plan.debug.isSuspiciousSingleA}`,
    `strongUniqueLabels: ${plan.debug.strongUniqueLabels.length > 0 ? plan.debug.strongUniqueLabels.join(", ") : "(none)"}`,
    plan.debug.saveGuardBlocked
      ? `saveGuard: BLOCKED — ${plan.debug.saveGuardReason}`
      : `saveGuard: not triggered`,
    ``,
    `=== Extraction Log ===`,
    ...plan.debug.logLines,
    ``,
    `=== Raw Question OCR (first 800 chars) ===`,
    plan.qDraft.slice(0, 800),
    ``,
    `=== Raw Mark Scheme OCR (first 800 chars) ===`,
    plan.msDraft.slice(0, 800),
  ].join("\n");

  let stepTitle = "";
  let stepContent: React.ReactNode = null;

  if (currentStep.kind === "parts") {
    stepTitle = `Step 1 of ${steps.length}: Confirm part structure`;
    stepContent = (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-700">
          The extractor identified these part labels. Edit if incorrect, or clear to save as a whole question.
        </p>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">
            Part labels (comma-separated, e.g.{" "}
            <code className="bg-gray-100 px-1 rounded">a, b, ci, cii</code>)
          </label>
          <input
            type="text"
            value={labelsText}
            onChange={(e) => setLabelsText(e.target.value)}
            placeholder="Leave empty for whole question"
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          {!labelsText.trim() && (
            <p className="mt-1 text-xs text-amber-600">No labels — will save as whole question.</p>
          )}
        </div>
        <div className="rounded bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800 space-y-1">
          <p className="font-semibold">How these parts were determined:</p>
          <ul className="ml-3 list-disc space-y-0.5">
            <li>
              Claude AI returned labels:{" "}
              <code className="bg-blue-100 px-0.5 rounded">
                {plan.debug.claudeLabels.join(", ") || "(none)"}
              </code>
            </li>
            <li>
              OCR regex detected:{" "}
              <code className="bg-blue-100 px-0.5 rounded">
                {plan.debug.detectedLabels.join(", ") || "(none)"}
              </code>
            </li>
            <li>
              Split probe found:{" "}
              <code className="bg-blue-100 px-0.5 rounded">
                {plan.debug.splitProbeKeys.join(", ") || "(none)"}
              </code>
            </li>
            <li>
              Explicit part markers (IBPart/item/line-start):{" "}
              <strong>{plan.debug.hasExplicitPartEnvironment ? "Yes ✓" : "No"}</strong>
            </li>
            <li>
              Claude multipart trusted without explicit markers:{" "}
              <strong>
                {plan.debug.canTrustClaudeMultipart
                  ? "Yes (Claude ≥ 2 AND split probe ≥ 2)"
                  : "No"}
              </strong>
            </li>
            {plan.debug.isSuspiciousSingleA && (
              <li className="text-amber-700">
                ⚠ Single &apos;(a)&apos; looked incidental — collapsed to whole question
              </li>
            )}
            {plan.debug.saveGuardBlocked && (
              <li className="text-red-700">⚠ Save guard triggered: {plan.debug.saveGuardReason}</li>
            )}
          </ul>
        </div>
      </div>
    );
  } else if (currentStep.kind === "stem") {
    stepTitle = `Step ${stepIdx + 1} of ${steps.length}: Confirm stem`;
    stepContent = (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-500">
          The stem is shared text appearing before the first part label.
        </p>
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-1">Question stem (rendered):</p>
          <div className="rounded bg-gray-50 border border-gray-200 p-3 max-h-32 overflow-y-auto">
            {plan.stemQ
              ? <LatexRenderer latex={plan.stemQ} />
              : <span className="text-gray-400 text-xs">(empty — no stem)</span>
            }
          </div>
          <textarea
            className="mt-1 w-full rounded bg-gray-900 text-green-300 px-2 py-1 text-xs font-mono resize-y min-h-[60px] focus:outline-none focus:ring-2 focus:ring-indigo-400"
            value={plan.stemQ}
            onChange={(e) => setPlan((p) => ({ ...p, stemQ: e.target.value }))}
            spellCheck={false}
          />
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-1">Mark scheme stem (rendered):</p>
          <div className="rounded bg-gray-50 border border-gray-200 p-3 max-h-28 overflow-y-auto">
            {plan.stemMS
              ? <LatexRenderer latex={plan.stemMS} />
              : <span className="text-gray-400 text-xs">(empty)</span>
            }
          </div>
          <textarea
            className="mt-1 w-full rounded bg-gray-900 text-green-300 px-2 py-1 text-xs font-mono resize-y min-h-[60px] focus:outline-none focus:ring-2 focus:ring-indigo-400"
            value={plan.stemMS}
            onChange={(e) => setPlan((p) => ({ ...p, stemMS: e.target.value }))}
            spellCheck={false}
          />
        </div>
      </div>
    );
  } else if (currentStep.kind === "whole") {
    stepTitle = `Step ${stepIdx + 1} of ${steps.length}: Confirm whole question`;
    stepContent = (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-500">No parts detected — will be saved as a single whole question.</p>
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold text-gray-700">Total marks:</label>
          <input
            type="number"
            min={1}
            max={100}
            className="w-20 rounded border border-indigo-300 px-2 py-1 text-sm font-bold text-center focus:outline-none focus:ring-2 focus:ring-indigo-400"
            value={plan.partMarks?.get("") ?? 1}
            onChange={(e) => setPlan((p) => {
              const next = new Map(p.partMarks ?? []);
              next.set("", Math.max(1, parseInt(e.target.value) || 1));
              return { ...p, partMarks: next };
            })}
          />
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-1">Question LaTeX (rendered):</p>
          <div className="rounded bg-gray-50 border border-gray-200 p-3 max-h-40 overflow-y-auto">
            <LatexRenderer latex={plan.qDraft} />
          </div>
          <textarea
            className="mt-1 w-full rounded bg-gray-900 text-green-300 px-2 py-1 text-xs font-mono resize-y min-h-[80px] focus:outline-none focus:ring-2 focus:ring-indigo-400"
            value={plan.qDraft}
            onChange={(e) => setPlan((p) => ({ ...p, qDraft: e.target.value }))}
            spellCheck={false}
          />
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-1">Mark scheme (rendered):</p>
          <div className="rounded bg-gray-50 border border-gray-200 p-3 max-h-32 overflow-y-auto">
            <LatexRenderer latex={plan.msDraft} />
          </div>
          <textarea
            className="mt-1 w-full rounded bg-gray-900 text-green-300 px-2 py-1 text-xs font-mono resize-y min-h-[80px] focus:outline-none focus:ring-2 focus:ring-indigo-400"
            value={plan.msDraft}
            onChange={(e) => setPlan((p) => ({ ...p, msDraft: e.target.value }))}
            spellCheck={false}
          />
        </div>
      </div>
    );
  } else if (currentStep.kind === "part") {
    const label = currentStep.label;
    const qContent = plan.splitQ.get(label) ?? "";
    const msContent = plan.splitMS.get(label) ?? "";
    stepTitle = `Step ${stepIdx + 1} of ${steps.length}: Part (${label})`;
    stepContent = (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold text-gray-700">Marks for part ({label}):</label>
          <input
            type="number"
            min={1}
            max={100}
            className="w-20 rounded border border-indigo-300 px-2 py-1 text-sm font-bold text-center focus:outline-none focus:ring-2 focus:ring-indigo-400"
            value={plan.partMarks?.get(label) ?? 1}
            onChange={(e) => setPlan((p) => {
              const next = new Map(p.partMarks ?? []);
              next.set(label, Math.max(1, parseInt(e.target.value) || 1));
              return { ...p, partMarks: next };
            })}
          />
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-1">
            Question — part ({label}) (rendered):
          </p>
          <div className="rounded bg-gray-50 border border-gray-200 p-3 max-h-36 overflow-y-auto">
            {qContent
              ? <LatexRenderer latex={qContent} />
              : <span className="text-gray-400 text-xs">(empty)</span>
            }
          </div>
          <textarea
            className="mt-1 w-full rounded bg-gray-900 text-green-300 px-2 py-1 text-xs font-mono resize-y min-h-[70px] focus:outline-none focus:ring-2 focus:ring-indigo-400"
            value={qContent}
            onChange={(e) => setPlan((p) => {
              const next = new Map(p.splitQ);
              next.set(label, e.target.value);
              return { ...p, splitQ: next };
            })}
            spellCheck={false}
          />
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-1">
            Mark scheme — part ({label}) (rendered):
          </p>
          <div className="rounded bg-gray-50 border border-gray-200 p-3 max-h-32 overflow-y-auto">
            {msContent
              ? <LatexRenderer latex={msContent} />
              : <span className="text-gray-400 text-xs">(empty)</span>
            }
          </div>
          <textarea
            className="mt-1 w-full rounded bg-gray-900 text-green-300 px-2 py-1 text-xs font-mono resize-y min-h-[70px] focus:outline-none focus:ring-2 focus:ring-indigo-400"
            value={msContent}
            onChange={(e) => setPlan((p) => {
              const next = new Map(p.splitMS);
              next.set(label, e.target.value);
              return { ...p, splitMS: next };
            })}
            spellCheck={false}
          />
        </div>
      </div>
    );
  }

  const qImages = images.filter((i) => i.image_type === "question").sort((a, b) => a.sort_order - b.sort_order);
  const msImages = images.filter((i) => i.image_type === "markscheme").sort((a, b) => a.sort_order - b.sort_order);

  const wizardFooter = (
    <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-100 shrink-0">
      <button
        type="button"
        onClick={onCancel}
        className="rounded-lg px-4 py-2 text-sm font-medium text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors border border-gray-200"
      >
        Cancel extraction
      </button>
      <div className="flex gap-2">
        {stepIdx > 0 && (
          <button
            type="button"
            onClick={handleBack}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors border border-gray-200"
          >
            ← Back
          </button>
        )}
        {!isLast && (
          <button
            type="button"
            onClick={handleConfirmAll}
            className="rounded-lg px-4 py-2 text-sm font-medium text-green-700 hover:bg-green-50 transition-colors border border-green-300"
            title="Accept all remaining steps as-is and save directly"
          >
            Save all →
          </button>
        )}
        <button
          type="button"
          onClick={handleNext}
          className="rounded-lg px-5 py-2 text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-sm"
        >
          {isLast ? "Save to database" : stepIdx === 0 ? "Confirm parts →" : "OK, next →"}
        </button>
      </div>
    </div>
  );

  const modal = minimized ? (
    /* ── Minimized bar ── */
    <div className="fixed bottom-0 left-0 right-0 z-[80] bg-white border-t-2 border-blue-400 shadow-xl px-5 py-2 flex items-center gap-4">
      <span className="font-mono font-bold text-blue-900 text-sm">{questionCode}</span>
      <span className="text-xs text-gray-500 truncate">{stepTitle}</span>
      <div className="flex gap-1.5 mx-2 shrink-0">
        {steps.map((_, i) => (
          <span key={i} className={`rounded-full w-2 h-2 transition-colors ${i < stepIdx ? "bg-green-400" : i === stepIdx ? "bg-blue-500" : "bg-gray-300"}`} />
        ))}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <button type="button" onClick={() => setMinimized(false)} className="rounded px-3 py-1.5 text-xs font-bold bg-blue-100 text-blue-800 hover:bg-blue-200 transition-colors">▲ Restore</button>
        <button type="button" onClick={onCancel} className="rounded w-7 h-7 flex items-center justify-center text-sm font-bold bg-gray-100 text-gray-700 hover:bg-red-100 hover:text-red-700 transition-colors">✕</button>
      </div>
    </div>
  ) : (
    /* ── Full-screen split layout ── */
    <div className="fixed inset-0 z-[80] flex flex-col bg-white">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 bg-gray-900 text-white shadow-md shrink-0">
        <span className="font-mono font-bold text-base">{questionCode}</span>
        <span className="text-sm text-gray-400 truncate">{stepTitle}</span>
        <div className="flex gap-1.5 mx-2 shrink-0">
          {steps.map((_, i) => (
            <span key={i} className={`rounded-full w-2.5 h-2.5 transition-colors ${i < stepIdx ? "bg-green-400" : i === stepIdx ? "bg-blue-400" : "bg-gray-600"}`} />
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => setMinimized(true)} className="rounded px-3 py-1.5 text-xs font-bold bg-gray-700 hover:bg-gray-600 text-white transition-colors">— Minimize</button>
          <button type="button" onClick={onCancel} className="rounded px-3 py-1.5 text-xs font-bold bg-red-600 hover:bg-red-500 text-white transition-colors">✕ Cancel</button>
        </div>
      </div>

      {/* Split body */}
      <div className="flex-1 overflow-hidden flex">

        {/* ── Left pane: images ── */}
        <div className="w-1/2 border-r border-gray-200 flex flex-col overflow-hidden">
          {/* Zoom toolbar */}
          <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-gray-100 bg-gray-50">
            <span className="text-xs font-semibold text-gray-600 mr-1">Zoom:</span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(25, z - 25))}
              className="w-6 h-6 rounded bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold text-sm flex items-center justify-center transition-colors"
            >−</button>
            <span className="text-xs font-mono w-12 text-center text-gray-700">{zoom}%</span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(400, z + 25))}
              className="w-6 h-6 rounded bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold text-sm flex items-center justify-center transition-colors"
            >+</button>
            <button type="button" onClick={() => setZoom(100)} className="text-xs text-gray-400 hover:text-gray-600 ml-2 underline">Reset</button>
            <span className="ml-auto text-xs text-gray-400">{qImages.length}Q · {msImages.length}MS</span>
          </div>
          {/* Scrollable images */}
          <div className="flex-1 overflow-auto p-4 bg-gray-50">
            {qImages.length === 0 && msImages.length === 0 ? (
              <div className="text-center text-gray-400 text-sm mt-16">No images loaded</div>
            ) : (
              <>
                {qImages.length > 0 && (
                  <div className="mb-6">
                    <p className="text-xs font-bold text-blue-700 uppercase tracking-wide mb-2">Question</p>
                    <div className="space-y-3">
                      {qImages.map((img) => img.url ? (
                        <img key={img.id} src={img.url} alt={img.alt_text ?? "Question image"} style={{ width: `${zoom}%` }} className="block rounded shadow-sm border border-gray-200" />
                      ) : null)}
                    </div>
                  </div>
                )}
                {msImages.length > 0 && (
                  <div>
                    <p className="text-xs font-bold text-green-700 uppercase tracking-wide mb-2">Mark Scheme</p>
                    <div className="space-y-3">
                      {msImages.map((img) => img.url ? (
                        <img key={img.id} src={img.url} alt={img.alt_text ?? "Markscheme image"} style={{ width: `${zoom}%` }} className="block rounded shadow-sm border border-gray-200" />
                      ) : null)}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Right pane: wizard ── */}
        <div className="w-1/2 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-6 py-4">{stepContent}</div>
          <div className="px-6 pb-3 shrink-0">
            <button type="button" onClick={() => setShowDebug((v) => !v)} className="text-xs text-gray-400 hover:text-gray-600 underline">
              {showDebug ? "Hide" : "Show"} troubleshooting info
            </button>
            {showDebug && (
              <pre className="mt-2 rounded bg-gray-900 text-green-300 text-xs p-3 overflow-auto max-h-40 font-mono whitespace-pre-wrap">{debugText}</pre>
            )}
          </div>
          {wizardFooter}
        </div>

      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
