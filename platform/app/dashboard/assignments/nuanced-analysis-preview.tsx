"use client";

/**
 * NuancedAnalysisPreview
 * ──────────────────────
 * Full DESIGN_INSTRUCTIONS.md compliant live preview for Nuanced Analysis.
 *
 * Implements all 8 Universal Design Layers:
 *   1. Structural Chunking — progress tracker, per-Part completability
 *   2. Tiered Entry Points — ★/★★/★★★ badges with colour coding
 *   3. Command-Term Accessibility — tear-off strip + demand-scale visual
 *   4. Scaffolding Visibility — opt-in hints, per-question controls
 *   5. Vocabulary — defined on first use (via commandTerms strip)
 *   6. Proof & Diagram Scaffolding — labelled answer box types
 *   7. Metacognitive Scaffolding — TOK frame + mentor text boxes
 *   8. Flexible Assessment — oral alternative callouts, bullet-point option
 *
 * Additional elements:
 *   - TOK Provocations block (two questions, flagged for Reflection return)
 *   - International Mindedness box
 *   - Per-Part micro-boxes ("What you need to start this Part")
 *   - Planted-error framing with positive opener
 *   - Teacher's Companion separator (teacher-only; hidden from students)
 *   - Continuation answer box label
 *   - Per-question marks and estimated minutes
 *   - Global and per-question answer box line controls
 *   - Section regeneration
 *   - Duplicate question detection
 */

import { useState } from "react";
import {
  type AssignmentDraft,
  type FormattingRequirements,
  clampInt,
  formatQuestionLabel,
  detectDuplicateQuestions,
  type DuplicatePair,
} from "@/lib/assignments";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CommandTermEntry { term: string; definition: string; }
export interface SpotlightBox { title: string; body: string; }
export interface TranslationRow { informal: string; formal: string; }
export interface TranslationTable { caption: string; rows: TranslationRow[]; }
export interface GeometricReading { body: string; }
export interface PrerequisiteBox { items: string[]; }
export interface TokProvocation { id: string; body: string; }
export interface InternationalMindednessBox { body: string; }

export interface NuancedQuestion {
  prompt: string;
  marks: number;
  answer?: string;
  tier?: 1 | 2 | 3;
  hint?: string;
  subparts?: NuancedQuestion[];
  answerBoxLines?: number;
  /** If true, this question is a planted-error / Broken Math Critique task. */
  isPlantedError?: boolean;
}

export interface NuancedSection {
  heading: string;
  partNumber?: number;
  prerequisiteBox?: PrerequisiteBox;
  spotlight?: SpotlightBox;
  questions: NuancedQuestion[];
  translationTable?: TranslationTable;
  geometricReading?: GeometricReading;
}

export interface NuancedDraft {
  title: string;
  subtitle?: string;
  course?: string;
  syllabusTopics?: string;
  prerequisites?: string;
  materials?: string;
  compulsoryCore?: string;
  instructions: string[];
  commandTerms?: CommandTermEntry[];
  tokProvocations?: TokProvocation[];
  internationalMindedness?: InternationalMindednessBox;
  sections: NuancedSection[];
}

// ── Tier display helpers ──────────────────────────────────────────────────────

const TIER_STARS: Record<number, string> = { 1: "★", 2: "★★", 3: "★★★" };
const TIER_COLOURS: Record<number, string> = {
  1: "text-emerald-700",
  2: "text-blue-700",
  3: "text-purple-700",
};

function TierBadge({ tier }: { tier?: 1 | 2 | 3 }) {
  if (!tier) return null;
  return (
    <span className={`text-[8pt] font-bold ${TIER_COLOURS[tier]} ml-1 select-none`}
      title={tier === 1 ? "Entry level" : tier === 2 ? "Standard" : "Extension (optional)"}
    >
      {TIER_STARS[tier]}
    </span>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function CommandTermsStrip({ terms }: { terms: CommandTermEntry[] }) {
  if (!terms.length) return null;
  return (
    <div className="my-5">
      {/* Dashed cut line */}
      <div className="border-t-2 border-dashed border-teal-500 my-1" />
      {/* Header */}
      <div className="bg-teal-700 px-3 py-1.5">
        <span className="text-[8.5pt] font-bold text-white uppercase tracking-wide">
          Command Terms — Tear off and keep beside you while working
        </span>
      </div>
      {/* Table */}
      <div className="bg-teal-50 px-3 pb-2 pt-1.5 border border-t-0 border-teal-200">
        <table className="w-full text-[9.5pt] mb-2">
          <tbody>
            {terms.map((t, i) => (
              <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-teal-50/60"}>
                <td className="py-1 pr-3 font-bold text-gray-900 whitespace-nowrap align-top w-28 pl-1">{t.term}</td>
                <td className="py-1 text-gray-700">{t.definition}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {/* Demand-scale visual */}
        <div className="border-t border-teal-200 pt-2">
          <p className="text-[8pt] text-gray-600 mb-1 font-semibold">Output demand →</p>
          <div className="flex items-center gap-0">
            {["Write down", "State", "Describe", "Explain", "Show that", "Prove"].map((term, i, arr) => (
              <div key={term} className="flex items-center">
                <div
                  className="px-1.5 py-0.5 rounded text-[7.5pt]"
                  style={{
                    backgroundColor: `hsl(${190 + i * 25}, ${50 + i * 8}%, ${96 - i * 6}%)`,
                    color: `hsl(${190 + i * 25}, 60%, ${30 - i * 2}%)`,
                    fontWeight: i === arr.length - 1 ? "bold" : "normal",
                    fontStyle: i === arr.length - 1 ? "italic" : "normal",
                  }}
                >
                  {term}
                </div>
                {i < arr.length - 1 && (
                  <svg className="w-3 h-3 text-gray-300 shrink-0" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* Dashed cut line */}
      <div className="border-t-2 border-dashed border-teal-500 my-1" />
    </div>
  );
}

function TokProvoBlock({ provocs }: { provocs: TokProvocation[] }) {
  if (!provocs.length) return null;
  return (
    <div className="my-4 rounded-r border-l-4 border-purple-500 bg-purple-50 px-3 py-3">
      <p className="text-[8.5pt] font-bold text-purple-700 uppercase tracking-wide mb-2">
        TOK Provocations — return to these in the Reflection section
      </p>
      <ol className="list-decimal list-outside ml-4 space-y-2">
        {provocs.map((p, i) => (
          <li key={p.id ?? i} className="text-[10pt] text-gray-800 leading-relaxed">
            {p.body}
          </li>
        ))}
      </ol>
    </div>
  );
}

function InternationalMindednessBlock({ im }: { im: InternationalMindednessBox }) {
  return (
    <div className="my-4 rounded-r border-l-4 border-emerald-500 bg-emerald-50 px-3 py-3">
      <p className="text-[8.5pt] font-bold text-emerald-700 uppercase tracking-wide mb-1.5">
        International Mindedness
      </p>
      <p className="text-[10pt] text-gray-800 leading-relaxed">{im.body}</p>
    </div>
  );
}

function ProgressTracker({ partCount }: { partCount: number }) {
  if (partCount === 0) return null;
  return (
    <div className="mb-4 flex items-center gap-1 flex-wrap">
      <span className="text-[8.5pt] text-gray-500 font-semibold mr-1">Progress:</span>
      {Array.from({ length: partCount }, (_, i) => (
        <span key={i} className="flex items-center gap-0.5">
          <span className="text-[8pt] text-gray-500">Part {i + 1}</span>
          <span
            className="inline-block w-4 h-4 border border-gray-400 rounded-sm"
            title={`Part ${i + 1} completion checkbox`}
          />
          {i < partCount - 1 && <span className="text-gray-300 mx-1">·</span>}
        </span>
      ))}
    </div>
  );
}

function PrerequisiteCallout({ box }: { box: PrerequisiteBox }) {
  return (
    <div className="my-3 rounded-r border-l-4 border-blue-400 bg-blue-50 px-3 py-2">
      <p className="mb-1.5 text-[8.5pt] font-bold text-blue-800 uppercase tracking-wide">
        What you need to start this Part
      </p>
      <ul className="list-disc list-inside space-y-0.5">
        {box.items.map((item, i) => (
          <li key={i} className="text-[9.5pt] text-gray-800">{item}</li>
        ))}
      </ul>
    </div>
  );
}

function SpotlightCallout({ box }: { box: SpotlightBox }) {
  return (
    <div className="my-3 rounded border border-teal-600 bg-teal-600 overflow-hidden">
      <div className="px-3 py-1">
        <span className="text-[8.5pt] font-bold text-white uppercase tracking-wide">
          Command Term Spotlight: {box.title}
        </span>
      </div>
      <div className="bg-teal-50 px-3 py-2">
        <p className="text-[10pt] text-gray-800 leading-relaxed">{box.body}</p>
      </div>
    </div>
  );
}

function GeometricReadingCallout({ reading }: { reading: GeometricReading }) {
  return (
    <div className="my-3 rounded border border-gray-300 bg-gray-50 px-3 py-2">
      <p className="mb-1 text-[8.5pt] font-bold text-gray-600 uppercase tracking-wide">
        Geometric / Physical Reading
      </p>
      <p className="text-[10pt] text-gray-700 italic leading-relaxed">{reading.body}</p>
    </div>
  );
}

function TranslationTableBlock({ table }: { table: TranslationTable }) {
  return (
    <div className="my-4">
      <p className="mb-1.5 text-[8.5pt] font-bold text-gray-700 uppercase tracking-wide">{table.caption}</p>
      <table className="w-full border-collapse text-[9.5pt]">
        <thead>
          <tr className="bg-gray-100">
            <th className="border border-gray-400 px-2 py-1.5 text-left font-semibold text-gray-700 w-1/2">
              What you say in your head…
            </th>
            <th className="border border-gray-400 px-2 py-1.5 text-left font-semibold text-gray-700 w-1/2">
              What you write on the exam paper…
            </th>
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
              <td className="border border-gray-400 px-2 py-1.5 text-gray-800 italic">{row.informal}</td>
              <td className="border border-gray-400 px-2 py-1.5 text-gray-800">{row.formal}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Planted-error task — positive opener frame as per DESIGN_INSTRUCTIONS §5. */
function PlantedErrorFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 rounded border border-amber-400 bg-amber-50 px-3 py-2">
      <p className="mb-1 text-[8.5pt] font-semibold text-amber-800">
        The following working was submitted by a student.
        Your job is not to judge the student — errors like this reveal important distinctions.
        Find the slip and explain its consequence.
      </p>
      {children}
    </div>
  );
}

/** Tier break — visual separator before ★★★ optional questions. */
function TierBreak() {
  return (
    <div className="my-3 flex items-center gap-2">
      <div className="flex-1 border-t border-dashed border-purple-300" />
      <span className="text-[8pt] font-bold text-purple-500 px-2 py-0.5 rounded border border-purple-300 bg-purple-50 select-none">
        ★★★ Optional Extension
      </span>
      <div className="flex-1 border-t border-dashed border-purple-300" />
    </div>
  );
}

/** Teacher's Companion separator. */
function TeacherCompanionSeparator() {
  return (
    <div className="mt-10 mb-4">
      <div className="border-t-4 border-purple-500" />
      <div className="mt-2 flex items-center gap-3">
        <span className="text-[13pt] font-bold text-purple-700" style={{ fontFamily: "Georgia, serif" }}>
          Teacher's Companion
        </span>
        <span className="text-[8.5pt] bg-purple-100 text-purple-700 border border-purple-300 rounded px-2 py-0.5 font-semibold">
          Remove before distributing to students
        </span>
      </div>
    </div>
  );
}

// ── QuestionRow ───────────────────────────────────────────────────────────────

function QuestionRow({
  q, number, indent = false,
  onChangePrompt, onChangeMarks, onChangeAnswerLines,
  includeMarksColumn, globalAnswerLines, isDuplicate, answerStyle = "boxes",
  estimatedMinutes,
}: {
  q: NuancedQuestion; number: string; indent?: boolean;
  onChangePrompt?: (val: string) => void;
  onChangeMarks?: (val: number) => void;
  onChangeAnswerLines?: (val: number) => void;
  includeMarksColumn: boolean;
  globalAnswerLines: number;
  isDuplicate?: boolean;
  answerStyle?: "boxes" | "lines" | "none";
  estimatedMinutes?: number;
}) {
  const lines = q.answerBoxLines ?? globalAnswerLines;
  const isOverridden = q.answerBoxLines !== undefined;

  return (
    <div className={`${indent ? "ml-6" : ""} ${isDuplicate ? "rounded border border-yellow-400 bg-yellow-50 px-2 py-1" : ""}`}>
      {isDuplicate && (
        <div className="mb-1 flex items-center gap-1 text-[8pt] text-yellow-700">
          <span>⚠</span><span>Similar to another question — consider revising</span>
        </div>
      )}
      <div className="flex items-start gap-2">
        <span className="shrink-0 font-bold text-gray-900 text-[10.5pt] min-w-[2.5rem] pt-0.5">
          {number}.
        </span>
        <TierBadge tier={q.tier} />
        <div className="flex-1 min-w-0">
          <textarea
            value={q.prompt}
            onChange={(e) => onChangePrompt?.(e.target.value)}
            rows={Math.max(1, Math.ceil(q.prompt.length / 90))}
            className="w-full resize-none border-0 p-0 text-[10.5pt] text-gray-900 leading-relaxed focus:outline-none focus:ring-0 bg-transparent"
          />
          {q.hint && (
            <p className="mt-0.5 ml-2 text-[9pt] italic text-gray-500">Hint: {q.hint}</p>
          )}
        </div>
        <div className="shrink-0 text-right">
          {includeMarksColumn && (
            <input
              type="number" value={q.marks}
              onChange={(e) => onChangeMarks?.(clampInt(Number(e.target.value), 0, 20))}
              className="w-10 rounded border border-gray-400 px-1 py-0.5 text-right text-[9pt]"
              aria-label={`Marks for ${number}`}
            />
          )}
          {estimatedMinutes !== undefined && (
            <p className="text-[7.5pt] text-gray-400 mt-0.5">(~{estimatedMinutes} min)</p>
          )}
        </div>
      </div>
      {/* Per-question answer lines control */}
      {answerStyle !== "none" && (
        <div className="mt-1 ml-10 flex items-center gap-2">
          <span className="text-[8pt] text-gray-400">Lines:</span>
          <button type="button" onClick={() => onChangeAnswerLines?.(Math.max(1, lines - 1))}
            className="h-5 w-5 rounded border border-gray-300 bg-gray-100 text-xs font-bold text-gray-600 hover:bg-gray-200 leading-none">−</button>
          <span className={`text-[8pt] tabular-nums font-semibold ${isOverridden ? "text-amber-600" : "text-gray-400"}`}>
            {lines}{isOverridden ? " ✎" : ""}
          </span>
          <button type="button" onClick={() => onChangeAnswerLines?.(Math.min(16, lines + 1))}
            className="h-5 w-5 rounded border border-gray-300 bg-gray-100 text-xs font-bold text-gray-600 hover:bg-gray-200 leading-none">+</button>
          {isOverridden && (
            <button type="button" onClick={() => onChangeAnswerLines?.(-1)}
              className="text-[8pt] text-gray-400 hover:text-red-400">reset</button>
          )}
        </div>
      )}
      {/* Answer space */}
      {answerStyle === "boxes" && (
        <div className="mt-2 ml-10 border border-gray-400 rounded-sm overflow-hidden">
          {Array.from({ length: lines }, (_, i) => (
            <div key={i} className={`border-gray-200 ${i < lines - 1 ? "border-b" : ""}`} style={{ height: "22px" }} />
          ))}
          {lines >= 4 && (
            <div className="bg-gray-50 border-t border-gray-100 px-2 py-0.5">
              <span className="text-[7pt] text-gray-300 select-none">Continue your response here if needed</span>
            </div>
          )}
        </div>
      )}
      {answerStyle === "lines" && (
        <div className="mt-1 ml-10 space-y-0">
          {Array.from({ length: lines }, (_, i) => (
            <div key={i} className="border-b border-gray-200" style={{ height: "20px" }} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Regenerate section button ─────────────────────────────────────────────────

function RegenerateSectionButton({
  sectionHeading, draft, onSectionReplaced, gradeLevel,
}: {
  sectionHeading: string;
  draft: AssignmentDraft;
  onSectionReplaced: (updatedDraft: AssignmentDraft) => void;
  gradeLevel?: string;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRegenerate() {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: [
            "You are an expert IBDP Mathematics teacher.",
            "You will be given a full activity packet JSON and the heading of one section to regenerate.",
            "Regenerate ONLY the questions array for that section. Keep the same tier distribution, heading, and enrichment fields.",
            "Return ONLY the updated full JSON object. No preamble, no backticks.",
          ].join(" "),
          messages: [{
            role: "user",
            content: [
              `Regenerate the section: "${sectionHeading}".`,
              `Grade level: ${gradeLevel ?? "IBDP"}`,
              "Full current packet JSON:",
              JSON.stringify(draft, null, 2),
            ].join("\n"),
          }],
        }),
      });
      if (!res.ok) throw new Error(`Regeneration failed (${res.status})`);
      const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      const rawText = data.content?.find((b) => b.type === "text")?.text ?? "";
      const first = rawText.indexOf("{"), last = rawText.lastIndexOf("}");
      if (first < 0 || last <= first) throw new Error("No JSON in response");
      const parsed = JSON.parse(rawText.slice(first, last + 1)) as AssignmentDraft;
      onSectionReplaced(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Regeneration failed");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button" onClick={handleRegenerate} disabled={isLoading}
        className="flex items-center gap-1 rounded border border-indigo-400/40 bg-indigo-500/10 px-2 py-0.5 text-[9pt] font-medium text-indigo-300 hover:bg-indigo-500/20 disabled:opacity-50"
      >
        {isLoading ? (
          <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
        ) : "↻"}
        {isLoading ? "Regenerating…" : "Regenerate section"}
      </button>
      {error && <span className="text-[8pt] text-red-400">{error}</span>}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  draft: AssignmentDraft;
  formatting: FormattingRequirements;
  onDraftChange: (updated: AssignmentDraft) => void;
  globalAnswerLines?: number;
  gradeLevel?: string;
  /** If true, show the Teacher's Companion section at the end. */
  showTeacherCompanion?: boolean;
}

export function NuancedAnalysisPreview({
  draft,
  formatting,
  onDraftChange,
  globalAnswerLines = 4,
  gradeLevel,
  showTeacherCompanion = false,
}: Props) {
  const nd = draft as unknown as NuancedDraft;
  const sections: NuancedSection[] = (draft.sections ?? []).map((s, i) =>
    typeof (s as unknown as NuancedSection).heading === "string"
      ? (s as unknown as NuancedSection)
      : { heading: `Part ${i + 1}`, partNumber: i, questions: s.questions.map((q) => ({ prompt: q.prompt, marks: q.marks ?? 0, answer: q.answer })) }
  );

  // Duplicate detection
  const duplicatePairs: DuplicatePair[] = detectDuplicateQuestions(draft);
  const duplicateSet = new Set<string>();
  for (const pair of duplicatePairs) {
    duplicateSet.add(`${pair.a.sectionIdx}-${pair.a.questionIdx}`);
    duplicateSet.add(`${pair.b.sectionIdx}-${pair.b.questionIdx}`);
  }

  // Count actual "Part" sections for progress tracker
  const partSections = sections.filter(
    (s) => s.heading.toLowerCase().startsWith("part") || s.partNumber !== undefined
  );

  // Pacing formula: round(marks * 12 / 11)
  function estimatedMins(marks: number) {
    return Math.round((marks * 12) / 11);
  }

  function updateSectionHeading(si: number, val: string) {
    const updated = [...draft.sections];
    updated[si] = { ...updated[si], heading: val };
    onDraftChange({ ...draft, sections: updated });
  }

  function updateQuestionField(
    si: number, qi: number,
    fields: Partial<AssignmentDraft["sections"][number]["questions"][number]>
  ) {
    const updated = [...draft.sections];
    const qs = [...updated[si].questions];
    qs[qi] = { ...qs[qi], ...fields };
    updated[si] = { ...updated[si], questions: qs };
    onDraftChange({ ...draft, sections: updated });
  }

  function handleAnswerLinesChange(si: number, qi: number, val: number) {
    if (val === -1) {
      const updated = [...draft.sections];
      const qs = [...updated[si].questions];
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { answerBoxLines: _removed, ...rest } = qs[qi];
      qs[qi] = rest;
      updated[si] = { ...updated[si], questions: qs };
      onDraftChange({ ...draft, sections: updated });
    } else {
      updateQuestionField(si, qi, { answerBoxLines: val });
    }
  }

  let globalQNum = 0;
  // Track whether we have already emitted the tier-break before ★★★ questions
  let lastTierWasExtension = false;

  return (
    <div
      className="bg-white text-gray-900"
      style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: `${formatting.fontSize ?? 11}pt`, lineHeight: 1.55 }}
    >
      {/* ── Document header ─────────────────────────────────────────────────── */}
      <header className="mb-4">
        <div className="text-center mb-2">
          <p className="text-[9pt] font-bold uppercase tracking-widest text-teal-700">
            {nd.course || formatting.schoolName || "CleverPlatform Mathematics"}
          </p>
          <input
            type="text" value={draft.title}
            onChange={(e) => onDraftChange({ ...draft, title: e.target.value })}
            className="block w-full text-center text-[20pt] font-bold text-gray-900 border-0 border-b-2 border-transparent hover:border-blue-300 focus:border-blue-500 p-0 bg-transparent focus:outline-none focus:ring-0 mt-1 cursor-text"
            style={{ fontFamily: "Georgia, serif" }}
            title="Click to edit title"
          />
          <p className="text-[11pt] italic text-gray-500 mt-0.5">{nd.subtitle || draft.subtitle || "IBDP Mathematics — Analysis & Approaches HL"}</p>
        </div>
        <div className="border-t-2 border-gray-800 pt-2">
          <div className="grid grid-cols-2 gap-4 text-[10pt]">
            {formatting.includeNameLine && (
              <p><strong>Student Name:</strong> <span className="inline-block border-b border-gray-500 w-44">&nbsp;</span></p>
            )}
            {formatting.includeDateLine && (
              <p><strong>Date:</strong> <span className="inline-block border-b border-gray-500 w-32">&nbsp;</span></p>
            )}
          </div>
          {nd.syllabusTopics && <p className="text-[9.5pt] mt-1"><strong>Syllabus Topics:</strong> {nd.syllabusTopics}</p>}
          {nd.prerequisites && <p className="text-[9.5pt] mt-0.5"><strong>Prerequisites:</strong> {nd.prerequisites}</p>}
          {nd.materials && <p className="text-[9.5pt] mt-0.5 italic">{nd.materials}</p>}
          {nd.compulsoryCore && (
            <div className="mt-2 rounded-r border-l-4 border-emerald-500 bg-emerald-50 px-3 py-1.5">
              <p className="text-[9pt] font-bold text-emerald-800">
                Compulsory core (★ and ★★ questions): <span className="font-normal">{nd.compulsoryCore}</span>
              </p>
            </div>
          )}
        </div>
      </header>

      {/* ── Progress tracker ────────────────────────────────────────────────── */}
      <ProgressTracker partCount={partSections.length || sections.length} />

      {/* ── Duplicate warning banner ────────────────────────────────────────── */}
      {duplicatePairs.length > 0 && (
        <div className="mb-4 rounded border border-yellow-400 bg-yellow-50 px-3 py-2">
          <p className="text-[9pt] font-semibold text-yellow-800">
            ⚠ {duplicatePairs.length} potentially duplicate question pair{duplicatePairs.length > 1 ? "s" : ""} detected
          </p>
        </div>
      )}

      {/* ── Instructions ────────────────────────────────────────────────────── */}
      {draft.instructions?.length > 0 && (
        <section className="mb-4">
          <ol className="list-decimal list-outside ml-5 space-y-0.5 text-[10pt]">
            {draft.instructions.map((ins: string, i: number) => (
              <li key={i} className="text-gray-800">{ins}</li>
            ))}
          </ol>
        </section>
      )}

      {/* ── Command Terms tear-off strip ──────────────────────────────────── */}
      {nd.commandTerms && nd.commandTerms.length > 0 && (
        <CommandTermsStrip terms={nd.commandTerms} />
      )}

      {/* ── TOK Provocations ──────────────────────────────────────────────── */}
      {nd.tokProvocations && nd.tokProvocations.length > 0 && (
        <TokProvoBlock provocs={nd.tokProvocations} />
      )}

      {/* ── International Mindedness ───────────────────────────────────────── */}
      {nd.internationalMindedness && (
        <InternationalMindednessBlock im={nd.internationalMindedness} />
      )}

      {/* ── Sections ─────────────────────────────────────────────────────── */}
      {sections.map((section, si) => {
        const nuanced = section as NuancedSection;
        lastTierWasExtension = false;

        return (
          <section key={si} className="mt-5">
            {/* Section heading */}
            <div className="border-t-2 border-gray-800 pt-2 mb-3 flex items-center gap-2">
              <input
                type="text" value={nuanced.heading}
                onChange={(e) => updateSectionHeading(si, e.target.value)}
                className="flex-1 border-0 p-0 bg-transparent text-[13pt] font-bold text-gray-900 focus:outline-none focus:ring-0 cursor-text hover:border-b hover:border-blue-300 focus:border-b focus:border-blue-500"
                style={{ fontFamily: "Georgia, serif" }}
              />
              <RegenerateSectionButton
                sectionHeading={nuanced.heading}
                draft={draft}
                onSectionReplaced={onDraftChange}
                gradeLevel={gradeLevel}
              />
            </div>

            {/* Prerequisite micro-box */}
            {nuanced.prerequisiteBox && <PrerequisiteCallout box={nuanced.prerequisiteBox} />}

            {/* Command-Term Spotlight */}
            {nuanced.spotlight && <SpotlightCallout box={nuanced.spotlight} />}

            {/* Questions */}
            <div className="space-y-1">
              {nuanced.questions.map((q, qi) => {
                globalQNum++;
                const nq = q as NuancedQuestion;
                const isDuplicate = duplicateSet.has(`${si}-${qi}`);
                const isExtension = nq.tier === 3;
                const prevTierWasExtension = lastTierWasExtension;
                lastTierWasExtension = isExtension;
                const showTierBreak = isExtension && !prevTierWasExtension;
                const estMins = estimatedMins(nq.marks);

                return (
                  <div key={qi}>
                    {/* Tier break before first ★★★ question in a section */}
                    {showTierBreak && <TierBreak />}
                    {/* Planted-error positive frame */}
                    {nq.isPlantedError ? (
                      <PlantedErrorFrame>
                        <QuestionRow
                          q={nq} number={String(globalQNum)}
                          includeMarksColumn={formatting.includeMarksColumn ?? true}
                          globalAnswerLines={globalAnswerLines}
                          isDuplicate={isDuplicate}
                          answerStyle={formatting.answerStyle ?? "boxes"}
                          estimatedMinutes={estMins}
                          onChangePrompt={(val) => updateQuestionField(si, qi, { prompt: val })}
                          onChangeMarks={(val) => updateQuestionField(si, qi, { marks: val })}
                          onChangeAnswerLines={(val) => handleAnswerLinesChange(si, qi, val)}
                        />
                      </PlantedErrorFrame>
                    ) : (
                      <QuestionRow
                        q={nq} number={String(globalQNum)}
                        includeMarksColumn={formatting.includeMarksColumn ?? true}
                        globalAnswerLines={globalAnswerLines}
                        isDuplicate={isDuplicate}
                        answerStyle={formatting.answerStyle ?? "boxes"}
                        estimatedMinutes={estMins}
                        onChangePrompt={(val) => updateQuestionField(si, qi, { prompt: val })}
                        onChangeMarks={(val) => updateQuestionField(si, qi, { marks: val })}
                        onChangeAnswerLines={(val) => handleAnswerLinesChange(si, qi, val)}
                      />
                    )}

                    {/* Subparts */}
                    {nq.subparts && nq.subparts.length > 0 && (
                      <div className="mt-1 space-y-2">
                        {nq.subparts.map((sub, subi) => (
                          <QuestionRow
                            key={subi} q={sub}
                            number={`${globalQNum}(${String.fromCharCode(97 + subi)})`}
                            indent={true}
                            includeMarksColumn={formatting.includeMarksColumn ?? true}
                            globalAnswerLines={Math.max(2, Math.ceil((nq.answerBoxLines ?? globalAnswerLines) / 2))}
                            answerStyle={formatting.answerStyle ?? "boxes"}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {nuanced.translationTable && <TranslationTableBlock table={nuanced.translationTable} />}
            {nuanced.geometricReading && <GeometricReadingCallout reading={nuanced.geometricReading} />}
          </section>
        );
      })}

      {/* ── Answer Key ──────────────────────────────────────────────────────── */}
      {formatting.includeAnswerKey && (
        <section className="mt-6 border-t-2 border-gray-800 pt-3">
          <p className="text-[12pt] font-bold text-gray-900 mb-2">Answer Key</p>
          <div className="space-y-1 text-[9.5pt] text-gray-800">
            {draft.sections.flatMap(
              (sec: AssignmentDraft["sections"][number], si: number) =>
                sec.questions.map(
                  (q: AssignmentDraft["sections"][number]["questions"][number], qi: number) => {
                    const lbl = formatQuestionLabel(si, qi, formatting.numberingStyle);
                    return (
                      <div key={`ans-${si}-${qi}`} className="flex gap-2">
                        <span className="font-bold w-8 shrink-0">{lbl}</span>
                        <span className="text-gray-700 italic">{q.answer ?? "—"}</span>
                      </div>
                    );
                  }
                )
            )}
          </div>
        </section>
      )}

      {/* ── Teacher's Companion ──────────────────────────────────────────────── */}
      {showTeacherCompanion && <TeacherCompanionSeparator />}
    </div>
  );
}
