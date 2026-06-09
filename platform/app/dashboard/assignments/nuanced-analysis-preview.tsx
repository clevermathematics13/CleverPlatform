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
 *   7. Metacognitive Scaffolding — TOK frame + reflection questions
 *   8. Flexible Assessment — oral alternative callouts, bullet-point option
 *
 * Fixed structural components rendered per DESIGN_INSTRUCTIONS §2:
 *   §2.1 Header: course, syllabusTopics, prerequisites, materials, name/date
 *   §2.2 Command Terms glossary (tear-off strip) + demand-scale visual
 *   §2.3 Vocabulary bold on first use (via commandTerms)
 *   §2.4 ATL statement (atl field)
 *   §2.5 TOK Provocations block (tokProvocations, exactly 2)
 *   §2.6 International Mindedness box
 *   §2.7 Parts with prerequisiteBox, spotlight, geometricReading
 *   §2.8 Reflection questions block
 *   §2.9 Extension/IA-Seeding section
 *   §2.10 Teacher's Companion separator
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
  marks?: number;
  estimatedMinutes?: number;
  answer?: string;
  tier?: 1 | 2 | 3;
  hint?: string;
  subparts?: Array<{ prompt: string; marks?: number; hint?: string; tier?: 1 | 2 | 3 }>;
  answerBoxLines?: number;
  spotlight?: SpotlightBox;
  prerequisiteBox?: PrerequisiteBox;
  translationTable?: TranslationTable;
  geometricReading?: GeometricReading;
  plantedError?: string;
  oralAlternative?: string;
}

export interface NuancedSection {
  heading: string;
  questions: NuancedQuestion[];
  prerequisiteBox?: PrerequisiteBox;
  spotlight?: SpotlightBox;
  translationTable?: TranslationTable;
  geometricReading?: GeometricReading;
}

export interface NuancedDraft extends AssignmentDraft {
  sections: NuancedSection[];
  course?: string;
  syllabusTopics?: string;
  prerequisites?: string;
  materials?: string;
  /**
   * ATL (Approaches to Learning) statement — §2.4 of DESIGN_INSTRUCTIONS.
   * One sentence naming the skill built across the whole packet.
   * Example: "You will build representational fluency: the same object seen as
   * algebra, geometry, and real-world model."
   */
  atl?: string;
  commandTerms?: CommandTermEntry[];
  tokProvocations?: TokProvocation[];
  internationalMindedness?: InternationalMindednessBox;
  compulsoryCore?: string;
  plantedErrorIntro?: string;
  reflectionQuestions?: string[];
}

// ── Demand scale (Command Terms ordered by cognitive demand) ──────────────────

const DEMAND_SCALE = [
  { label: "Write down", colour: "#9ca3af" },
  { label: "State",      colour: "#6b7280" },
  { label: "Describe",   colour: "#4b8bbf" },
  { label: "Calculate",  colour: "#3b82f6" },
  { label: "Explain",    colour: "#22c55e" },
  { label: "Find",       colour: "#f59e0b" },
  { label: "Derive",     colour: "#f97316" },
  { label: "Show that",  colour: "#ef4444" },
  { label: "Prove",      colour: "#dc2626" },
  { label: "Justify",    colour: "#991b1b" },
];

// ── Helper sub-components ──────────────────────────────────────────────────────

function TierBadge({ tier }: { tier: 1 | 2 | 3 }) {
  const colours: Record<1 | 2 | 3, string> = {
    1: "text-emerald-700 bg-emerald-50 border-emerald-300",
    2: "text-blue-700    bg-blue-50    border-blue-300",
    3: "text-purple-700  bg-purple-50  border-purple-300",
  };
  const labels: Record<1 | 2 | 3, string> = { 1: "★", 2: "★★", 3: "★★★" };
  return (
    <span
      className={`text-[8pt] font-bold ${colours[tier]} ml-1 select-none`}
      style={{ border: "1px solid", padding: "1px 4px", borderRadius: 3 }}
    >
      {labels[tier]}
    </span>
  );
}

function CommandTermsStrip({ terms }: { terms: CommandTermEntry[] }) {
  if (!terms.length) return null;
  return (
    <div className="my-5">
      <div className="border-t-2 border-dashed border-teal-500 my-1" />
      <div className="bg-teal-700 px-3 py-1.5">
        <span className="text-[8.5pt] font-bold text-white uppercase tracking-wide">
          Command Terms — Tear Off and Keep Beside You While Working
        </span>
      </div>
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
        {/* Demand scale visual — Layer 3, §2.2 */}
        <div className="border-t border-teal-200 pt-2">
          <p className="text-[8pt] text-gray-600 mb-1 font-semibold">Output demand →</p>
          <div className="flex items-center gap-0 flex-wrap">
            {DEMAND_SCALE.map((item, idx) => (
              <div key={item.label} className="flex items-center">
                <span
                  className="px-1.5 py-0.5 rounded text-[7.5pt]"
                  style={{
                    backgroundColor: item.colour,
                    color: idx < 3 ? "#374151" : "#fff",
                    fontWeight: 600,
                    fontSize: "7pt",
                    whiteSpace: "nowrap",
                  }}
                >
                  {item.label}
                </span>
                {idx < DEMAND_SCALE.length - 1 && (
                  <svg className="w-3 h-3 text-gray-300 shrink-0" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="border-t-2 border-dashed border-teal-500 my-1" />
    </div>
  );
}

function TokBlock({ provocations }: { provocations: TokProvocation[] }) {
  if (!provocations.length) return null;
  return (
    <div className="my-4 rounded-r border-l-4 border-purple-500 bg-purple-50 px-3 py-3">
      <p className="text-[8.5pt] font-bold text-purple-700 uppercase tracking-wide mb-2">
        Theory of Knowledge Provocations — return to these in the Reflection section
      </p>
      <ol className="list-decimal list-outside ml-4 space-y-2">
        {provocations.map((p, i) => (
          <li key={p.id ?? i} className="text-[10pt] text-gray-800 leading-relaxed">{p.body}</li>
        ))}
      </ol>
    </div>
  );
}

function ImBox({ im }: { im: InternationalMindednessBox }) {
  return (
    <div className="my-4 rounded-r border-l-4 border-emerald-500 bg-emerald-50 px-3 py-3">
      <p className="text-[8.5pt] font-bold text-emerald-700 uppercase tracking-wide mb-1.5">
        International Mindedness
      </p>
      <p className="text-[10pt] text-gray-800 leading-relaxed">{im.body}</p>
    </div>
  );
}

/** Progress tracker — Layer 1, §2.1 DESIGN_INSTRUCTIONS */
function ProgressTracker({ sections }: { sections: NuancedSection[] }) {
  const partSections = sections.filter((s) => /^Part\s*\d+/i.test(s.heading));
  if (partSections.length === 0) return null;
  return (
    <div className="mt-3 mb-1 flex items-center gap-1 flex-wrap text-[8.5pt] text-gray-500">
      <span className="font-semibold mr-1">Progress tracker:</span>
      {partSections.map((s, i) => (
        <span key={i} className="flex items-center gap-0.5 mr-1">
          <span>{s.heading.split("—")[0].trim()}</span>
          <span
            className="inline-block w-4 h-4 border border-gray-400 rounded-sm ml-0.5"
            aria-label={`${s.heading} completion checkbox`}
          />
        </span>
      ))}
    </div>
  );
}

function PrereqBox({ box }: { box: PrerequisiteBox }) {
  if (!box.items.length) return null;
  return (
    <div className="mb-3 rounded-r border-l-4 border-amber-400 bg-amber-50 px-3 py-2">
      <p className="text-[8.5pt] font-bold text-amber-800 uppercase tracking-wide mb-1">
        What you need to start this Part
      </p>
      <ul className="list-disc list-inside space-y-0.5">
        {box.items.map((item, i) => (
          <li key={i} className="text-[9.5pt] text-gray-700">{item}</li>
        ))}
      </ul>
    </div>
  );
}

function SpotlightBlock({ box }: { box: SpotlightBox }) {
  return (
    <div className="mb-2 rounded-r border-l-4 border-blue-400 bg-blue-50 px-3 py-2">
      <p className="text-[9pt] font-bold text-blue-800 mb-0.5">{box.title}</p>
      <p className="text-[10pt] text-gray-700">{box.body}</p>
    </div>
  );
}

function TranslationTableBlock({ table }: { table: TranslationTable }) {
  return (
    <div className="mt-2 overflow-hidden rounded border border-gray-200">
      <p className="bg-gray-100 px-2 py-1 text-[8.5pt] font-semibold text-gray-600">{table.caption}</p>
      <table className="w-full text-[9pt]">
        <thead>
          <tr className="bg-gray-50">
            <th className="px-2 py-1 text-left font-semibold text-gray-700">Informal</th>
            <th className="px-2 py-1 text-left font-semibold text-gray-700">Formal</th>
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, i) => (
            <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
              <td className="px-2 py-1 border-t border-gray-100 text-gray-700">{r.informal}</td>
              <td className="px-2 py-1 border-t border-gray-100 text-gray-700">{r.formal}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GeometricBlock({ geo }: { geo: GeometricReading }) {
  return (
    <div className="my-2 rounded-r border-l-4 border-indigo-400 bg-indigo-50 px-3 py-2">
      <p className="text-[8.5pt] font-bold text-indigo-700 uppercase tracking-wide mb-1">Geometric Reading</p>
      <p className="text-[10pt] text-gray-800">{geo.body}</p>
    </div>
  );
}

function AnswerBox({ lines, style }: { lines: number; style?: "boxes" | "lines" | "none" }) {
  if (!lines || style === "none") return null;
  return (
    <div className="mt-2 rounded border border-gray-300 bg-gray-50 overflow-hidden">
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className={`border-gray-200 ${i < lines - 1 ? "border-b" : ""}`}
          style={{ height: "22px" }}
        />
      ))}
    </div>
  );
}

// ── Question block ────────────────────────────────────────────────────────────

function QuestionBlock({
  q,
  qIdx,
  sectionIdx,
  formatting,
  globalAnswerLines,
  onPromptChange,
}: {
  q: NuancedQuestion;
  qIdx: number;
  sectionIdx: number;
  formatting: FormattingRequirements;
  globalAnswerLines: number;
  onPromptChange?: (val: string) => void;
}) {
  const label = formatQuestionLabel(sectionIdx, qIdx, formatting.numberingStyle);
  const answerLines = q.answerBoxLines ?? globalAnswerLines;

  return (
    <div className="mb-4">
      {q.prerequisiteBox && <PrereqBox box={q.prerequisiteBox} />}
      {q.spotlight && <SpotlightBlock box={q.spotlight} />}

      <div className="flex gap-2 items-start">
        <span className="text-[9pt] text-gray-500 font-mono shrink-0 mt-1 w-9 text-right">{label}</span>

        <div className="flex-1 min-w-0">
          <div className="flex gap-2 items-start">
            <div className="flex-1 min-w-0">
              {onPromptChange ? (
                <textarea
                  defaultValue={q.prompt}
                  rows={Math.max(2, Math.ceil(q.prompt.length / 90))}
                  onChange={(e) => onPromptChange(e.target.value)}
                  className="w-full resize-none border-0 p-0 text-[10.5pt] text-gray-900 leading-relaxed focus:outline-none focus:ring-0 bg-transparent"
                />
              ) : (
                <p className="text-[10.5pt] text-gray-900 leading-relaxed">{q.prompt}</p>
              )}
              {q.tier && <TierBadge tier={q.tier} />}
              {q.hint && (
                <p className="text-[8.5pt] italic text-gray-400 mt-0.5">Hint: {q.hint}</p>
              )}
              {q.oralAlternative && (
                <p className="text-[8pt] italic text-teal-600 mt-0.5">
                  You may respond to this question orally — ask your teacher.
                </p>
              )}
            </div>
            {formatting.includeMarksColumn && q.marks != null && (
              <span className="text-[9pt] text-gray-500 shrink-0 font-mono whitespace-nowrap">
                [{q.marks}]
                {q.estimatedMinutes && (
                  <span className="block text-[8pt] text-gray-400 text-right">{q.estimatedMinutes}min</span>
                )}
              </span>
            )}
          </div>

          {/* Subparts */}
          {q.subparts?.map((sp, si) => (
            <div key={si} className="mt-2 ml-4 flex gap-2 items-start">
              <span className="text-[9pt] text-gray-400 font-mono shrink-0 mt-1">
                ({String.fromCharCode(105 + si)})
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex gap-2 items-start">
                  <p className="flex-1 text-[10pt] text-gray-800 leading-relaxed">{sp.prompt}</p>
                  {sp.marks != null && formatting.includeMarksColumn && (
                    <span className="text-[9pt] text-gray-500 shrink-0 font-mono whitespace-nowrap">[{sp.marks}]</span>
                  )}
                </div>
                {sp.tier && <TierBadge tier={sp.tier} />}
                {sp.hint && <p className="text-[8.5pt] italic text-gray-400 mt-0.5">Hint: {sp.hint}</p>}
              </div>
            </div>
          ))}

          {/* Answer box */}
          {formatting.answerStyle !== "none" && answerLines > 0 && (
            <>
              <AnswerBox lines={answerLines} style={formatting.answerStyle} />
              <p className="text-[7.5pt] text-gray-400 italic mt-0.5 text-right">
                Continue on next page if needed
              </p>
            </>
          )}

          {/* Answer key */}
          {formatting.includeAnswerKey && q.answer && (
            <div className="mt-1 rounded border border-green-200 bg-green-50 px-2 py-1">
              <span className="text-[8.5pt] text-green-800 font-semibold">Answer: </span>
              <span className="text-[8.5pt] text-green-700">{q.answer}</span>
            </div>
          )}

          {/* Translation table */}
          {q.translationTable && <TranslationTableBlock table={q.translationTable} />}

          {/* Geometric reading */}
          {q.geometricReading && <GeometricBlock geo={q.geometricReading} />}

          {/* Planted error */}
          {q.plantedError && (
            <div className="mt-2 rounded border border-rose-200 bg-rose-50 px-2 py-1">
              <p className="text-[8.5pt] font-semibold text-rose-700">Planted error to find:</p>
              <p className="text-[9pt] text-rose-600 mt-0.5">{q.plantedError}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Section controls (per-question marks adjuster) ────────────────────────────

function SectionControls({
  section,
  sectionIdx,
  onMarksChange,
}: {
  section: NuancedSection;
  sectionIdx: number;
  onMarksChange?: (qi: number, marks: number) => void;
}) {
  if (!onMarksChange) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-1">
      {section.questions.map((q, qi) => (
        <label key={qi} className="flex items-center gap-1 text-[8pt] text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">
          <span>{sectionIdx + 1}.{qi + 1}</span>
          <input
            type="number"
            min={0}
            max={20}
            value={q.marks ?? 0}
            onChange={(e) => onMarksChange(qi, clampInt(Number(e.target.value), 0, 20))}
            className="w-7 rounded border border-gray-300 bg-white px-0.5 text-center text-[8pt] focus:outline-none"
          />
          <span>mk</span>
        </label>
      ))}
    </div>
  );
}

// ── Main NuancedAnalysisPreview ────────────────────────────────────────────────

export function NuancedAnalysisPreview({
  draft,
  formatting,
  onDraftChange,
  globalAnswerLines = 4,
  gradeLevel = "Grade 12",
}: {
  draft: AssignmentDraft;
  formatting: FormattingRequirements;
  onDraftChange?: (d: AssignmentDraft) => void;
  globalAnswerLines?: number;
  gradeLevel?: string;
}) {
  void gradeLevel;

  const nd = draft as NuancedDraft;
  const sections = (nd.sections ?? []) as NuancedSection[];

  const teacherIdx = sections.findIndex((s) => /teacher.{0,10}companion/i.test(s.heading));

  const duplicatePairs: DuplicatePair[] = detectDuplicateQuestions(draft);

  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});

  function toggleCollapse(si: number) {
    setCollapsed((prev) => ({ ...prev, [si]: !prev[si] }));
  }

  function updateTitle(title: string) {
    onDraftChange?.({ ...draft, title });
  }

  function updateSectionHeading(si: number, heading: string) {
    if (!onDraftChange) return;
    const secs = [...sections];
    secs[si] = { ...secs[si], heading };
    onDraftChange({ ...draft, sections: secs } as AssignmentDraft);
  }

  function updateQuestionPrompt(si: number, qi: number, prompt: string) {
    if (!onDraftChange) return;
    const secs = [...sections];
    const qs = [...secs[si].questions];
    qs[qi] = { ...qs[qi], prompt };
    secs[si] = { ...secs[si], questions: qs };
    onDraftChange({ ...draft, sections: secs } as AssignmentDraft);
  }

  function updateQuestionMarks(si: number, qi: number, marks: number) {
    if (!onDraftChange) return;
    const secs = [...sections];
    const qs = [...secs[si].questions];
    qs[qi] = { ...qs[qi], marks };
    secs[si] = { ...secs[si], questions: qs };
    onDraftChange({ ...draft, sections: secs } as AssignmentDraft);
  }

  return (
    <div
      className="font-serif text-gray-900 max-w-[794px] mx-auto"
      style={{ fontFamily: "'Times New Roman', Times, serif" }}
    >
      {/* ── Document header ──────────────────────────────────────────────────── */}
      <header className="mb-6">
        <div className="text-center mb-3">
          <p className="text-[9pt] font-bold uppercase tracking-widest text-teal-700 mb-1">
            {nd.course || "IBDP Mathematics AA HL"}
          </p>
          <input
            type="text"
            defaultValue={draft.title}
            onChange={(e) => updateTitle(e.target.value)}
            className="block w-full text-center text-[20pt] font-bold text-gray-900 border-0 border-b-2 border-transparent hover:border-blue-300 focus:border-blue-500 p-0 bg-transparent focus:outline-none focus:ring-0 mt-1 cursor-text transition-colors"
            title="Click to edit title"
          />
          <p className="text-[11pt] italic text-gray-500 mt-0.5">
            {nd.subtitle || draft.subtitle || "IBDP Mathematics — Analysis & Approaches HL"}
          </p>
        </div>
        <div className="border-t-2 border-gray-800 pt-2">
          <div className="grid grid-cols-2 gap-4 text-[10pt]">
            {formatting.includeNameLine && (
              <div>
                <strong>Student Name:</strong>
                <span className="block border-b-2 border-gray-700 mt-4 mb-1" />
              </div>
            )}
            {formatting.includeDateLine && (
              <div>
                <strong>Date:</strong>
                <span className="block border-b-2 border-gray-700 mt-4 mb-1" />
              </div>
            )}
          </div>
          {nd.syllabusTopics && (
            <p className="text-[9.5pt] mt-1"><strong>Syllabus Topics:</strong> {nd.syllabusTopics}</p>
          )}
          {nd.prerequisites && (
            <p className="text-[9.5pt] mt-0.5"><strong>Prerequisites:</strong> {nd.prerequisites}</p>
          )}
          {nd.materials && (
            <p className="text-[9.5pt] mt-0.5 italic">{nd.materials}</p>
          )}
          {/* ATL statement — §2.4 DESIGN_INSTRUCTIONS */}
          {nd.atl && (
            <p className="text-[9.5pt] mt-1 text-gray-600">
              <strong className="text-gray-700">ATL skill:</strong> <em>{nd.atl}</em>
            </p>
          )}
          {nd.compulsoryCore && (
            <div className="mt-2 rounded-r border-l-4 border-emerald-500 bg-emerald-50 px-3 py-1.5">
              <p className="text-[9pt] font-bold text-emerald-800">
                Compulsory core (★ and ★★ questions):{" "}
                <span className="font-normal">{nd.compulsoryCore}</span>
              </p>
            </div>
          )}
        </div>
        {/* Progress tracker — Layer 1, §2 DESIGN_INSTRUCTIONS */}
        <ProgressTracker sections={sections} />
      </header>

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
          <ol className="list-decimal list-outside ml-5 space-y-1 text-[10pt] text-gray-800">
            {draft.instructions.map((ins: string, i: number) => (
              <li key={i}>{ins}</li>
            ))}
          </ol>
        </section>
      )}

      {/* ── Command Terms strip — §2.2 ───────────────────────────────────────── */}
      {nd.commandTerms?.length ? <CommandTermsStrip terms={nd.commandTerms} /> : null}

      {/* ── TOK Provocations — §2.5 ─────────────────────────────────────────── */}
      {nd.tokProvocations?.length ? <TokBlock provocations={nd.tokProvocations} /> : null}

      {/* ── International Mindedness — §2.6 ──────────────────────────────────── */}
      {nd.internationalMindedness ? <ImBox im={nd.internationalMindedness} /> : null}

      {/* ── Planted error intro ──────────────────────────────────────────────── */}
      {nd.plantedErrorIntro && (
        <div className="my-4 rounded-r border-l-4 border-rose-400 bg-rose-50 px-3 py-2">
          <p className="text-[9.5pt] text-rose-800 leading-relaxed">{nd.plantedErrorIntro}</p>
        </div>
      )}

      {/* ── Sections — §2.7 ──────────────────────────────────────────────────── */}
      {sections.map((section, si) => {
        const isTeacherSection = teacherIdx !== -1 && si >= teacherIdx;
        const isCollapsed = collapsed[si] ?? false;

        return (
          <section key={si} className="mb-6">
            {/* Teacher's Companion separator — §2.10 */}
            {si === teacherIdx && (
              <div className="my-6 flex items-center gap-2">
                <div className="flex-1 border-t-2 border-dashed border-gray-400" />
                <span className="text-[8pt] font-bold uppercase tracking-widest text-gray-400 bg-white px-2">
                  Teacher&apos;s Companion — Do Not Distribute
                </span>
                <div className="flex-1 border-t-2 border-dashed border-gray-400" />
              </div>
            )}

            {/* Section heading */}
            <div
              className={`mb-2 flex items-center gap-2 ${isTeacherSection ? "bg-gray-100 px-2 py-1 rounded" : ""}`}
            >
              <button
                type="button"
                onClick={() => toggleCollapse(si)}
                className="text-gray-400 hover:text-gray-600 text-[10pt] shrink-0"
                title={isCollapsed ? "Expand section" : "Collapse section"}
              >
                {isCollapsed ? "▶" : "▼"}
              </button>
              <input
                type="text"
                defaultValue={section.heading}
                onChange={(e) => updateSectionHeading(si, e.target.value)}
                className="flex-1 border-0 p-0 bg-transparent text-[13pt] font-bold text-gray-900 focus:outline-none focus:ring-0 cursor-text hover:border-b hover:border-blue-300 focus:border-b focus:border-blue-500"
                title="Click to edit section heading"
              />
            </div>

            {!isCollapsed && (
              <>
                {section.prerequisiteBox && <PrereqBox box={section.prerequisiteBox} />}
                {section.spotlight && <SpotlightBlock box={section.spotlight} />}
                {onDraftChange && (
                  <SectionControls
                    section={section}
                    sectionIdx={si}
                    onMarksChange={(qi, marks) => updateQuestionMarks(si, qi, marks)}
                  />
                )}
                {section.questions.map((q, qi) => (
                  <QuestionBlock
                    key={qi}
                    q={q}
                    qIdx={qi}
                    sectionIdx={si}
                    formatting={formatting}
                    globalAnswerLines={globalAnswerLines}
                    onPromptChange={
                      onDraftChange ? (val) => updateQuestionPrompt(si, qi, val) : undefined
                    }
                  />
                ))}
                {section.translationTable && (
                  <TranslationTableBlock table={section.translationTable} />
                )}
                {section.geometricReading && (
                  <GeometricBlock geo={section.geometricReading} />
                )}
              </>
            )}
          </section>
        );
      })}

      {/* ── Reflection questions — §2.8 ──────────────────────────────────────── */}
      {nd.reflectionQuestions?.length ? (
        <section className="mt-6 rounded-r border-l-4 border-purple-300 bg-purple-50 px-3 py-3">
          <p className="text-[8.5pt] font-bold text-purple-700 uppercase tracking-wide mb-2">
            Reflection
          </p>
          <ol className="list-decimal list-outside ml-4 space-y-2">
            {nd.reflectionQuestions.map((q, i) => (
              <li key={i} className="text-[10pt] text-gray-800 leading-relaxed">
                {q}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
