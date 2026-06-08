"use client";

/**
 * NuancedAnalysisPreview
 * ──────────────────────
 * Full DESIGN_INSTRUCTIONS.md compliant rendering of a Nuanced Analysis draft.
 *
 * Features:
 *   1. Structural Chunking — progress tracker, per-Part completability
 *   2. Command-Terms Tear-Off Strip — teal box with demand-scale gradient
 *   3. TOK Provocations — purple callout with numbered questions
 *   4. International Mindedness — emerald callout
 *   5. Per-Part micro-boxes (prerequisite knowledge gate)
 *   6. Answer boxes with configurable line count
 *   7. Tier badges (★/★★/★★★) in colour
 *   8. Teacher's Companion section (grey separator)
 *   9. In-place editing of title, headings, and question text
 *  10. Duplicate detection warning banner
 */

import { useMemo, useRef } from "react";
import type { AssignmentDraft, FormattingRequirements } from "@/lib/assignments";
import { LatexRenderer } from "@/components/LatexRenderer";

// ── Types ─────────────────────────────────────────────────────────────────────

type NuancedDraftFields = {
  course?: string;
  syllabusTopics?: string;
  prerequisites?: string;
  materials?: string;
  commandTerms?: Array<{ term: string; definition: string }>;
  tokProvocations?: Array<{ id?: string; question: string }>;
  internationalMindedness?: { body: string };
  compulsoryCore?: string;
};

type Question = {
  prompt: string;
  marks?: number;
  answer?: string;
  tier?: 1 | 2 | 3;
  hint?: string;
  subparts?: Array<{ prompt: string; marks?: number; hint?: string; tier?: 1 | 2 | 3 }>;
  answerBoxLines?: number;
  prerequisiteBox?: { items: string[] };
  spotlight?: { title: string; body: string };
  translationTable?: { caption: string; rows: Array<{ informal: string; formal: string }> };
};

type Section = {
  heading: string;
  questions: Question[];
  prerequisiteBox?: { items: string[] };
};

// ── Constants ──────────────────────────────────────────────────────────────────

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

const TIER_COLOURS: Record<1 | 2 | 3, string> = {
  1: "text-emerald-700 bg-emerald-50 border-emerald-300",
  2: "text-blue-700 bg-blue-50 border-blue-300",
  3: "text-purple-700 bg-purple-50 border-purple-300",
};

const TIER_LABEL: Record<1 | 2 | 3, string> = {
  1: "★",
  2: "★★",
  3: "★★★",
};

// ── Helper sub-components ──────────────────────────────────────────────────────

function TierBadge({ tier }: { tier: 1 | 2 | 3 }) {
  return (
    <span className={`text-[8pt] font-bold ${TIER_COLOURS[tier]} ml-1 select-none`}
      style={{ border: "1px solid", padding: "1px 4px", borderRadius: 3 }}>
      {TIER_LABEL[tier]}
    </span>
  );
}

function CommandTermsStrip({ terms }: { terms: Array<{ term: string; definition: string }> }) {
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
        {/* Demand scale visual */}
        <div className="border-t border-teal-200 pt-2">
          <p className="text-[8pt] text-gray-600 mb-1 font-semibold">Output demand →</p>
          <div className="flex items-center gap-0">
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
                    <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
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

function TokProvocations({ provocations }: { provocations: Array<{ id?: string; question: string }> }) {
  if (!provocations.length) return null;
  return (
    <div className="my-4 rounded-r border-l-4 border-purple-500 bg-purple-50 px-3 py-3">
      <p className="text-[8.5pt] font-bold text-purple-700 uppercase tracking-wide mb-2">
        Theory of Knowledge Provocations
      </p>
      <ol className="list-decimal list-outside ml-4 space-y-2">
        {provocations.map((p, i) => (
          <li key={p.id ?? i} className="text-[10pt] text-gray-800 leading-relaxed">
            <LatexRenderer content={p.question} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function IntlMindedness({ im }: { im: { body: string } }) {
  if (!im.body) return null;
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

// Keep ProgressTracker available but unused in the default render
void ProgressTracker;

function PrerequisiteBox({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="mb-3 rounded-r border-l-4 border-amber-400 bg-amber-50 px-3 py-2">
      <p className="text-[8.5pt] font-bold text-amber-800 uppercase tracking-wide mb-1">
        What you need to start this Part
      </p>
      <ul className="list-disc list-inside space-y-0.5">
        {items.map((item, i) => (
          <li key={i} className="text-[9.5pt] text-gray-700">{item}</li>
        ))}
      </ul>
    </div>
  );
}

function AnswerBox({ lines }: { lines: number }) {
  if (lines <= 0) return null;
  return (
    <div className="mt-2 rounded border border-gray-300 bg-gray-50 overflow-hidden">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className={`border-gray-200 ${i < lines - 1 ? "border-b" : ""}`} style={{ height: "22px" }} />
      ))}
    </div>
  );
}

// ── Question renderer ──────────────────────────────────────────────────────────

function QuestionBlock({
  q, qIdx, sectionIdx, formatting, globalAnswerLines, onPromptChange,
}: {
  q: Question;
  qIdx: number;
  sectionIdx: number;
  formatting: FormattingRequirements;
  globalAnswerLines: number;
  onPromptChange?: (val: string) => void;
}) {
  const label = formatting.numberingStyle === "lettered"
    ? String.fromCharCode(97 + qIdx)
    : `${sectionIdx + 1}.${qIdx + 1}`;

  const answerLines = q.answerBoxLines ?? globalAnswerLines;

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="mb-4">
      {q.prerequisiteBox && <PrerequisiteBox items={q.prerequisiteBox.items} />}
      {q.spotlight && (
        <div className="mb-2 rounded-r border-l-4 border-blue-400 bg-blue-50 px-3 py-2">
          <p className="text-[9pt] font-bold text-blue-800 mb-0.5">{q.spotlight.title}</p>
          <p className="text-[10pt] text-gray-700"><LatexRenderer content={q.spotlight.body} /></p>
        </div>
      )}
      <div className="flex gap-2 items-start">
        <span className="text-[9pt] text-gray-500 font-mono shrink-0 mt-1 w-9 text-right">{label}</span>
        <div className="flex-1 min-w-0">
          {formatting.includeMarksColumn ? (
            <div className="flex gap-2 items-start">
              <div className="flex-1 min-w-0">
                {onPromptChange ? (
                  <textarea
                    ref={textareaRef}
                    defaultValue={q.prompt}
                    rows={Math.max(2, Math.ceil(q.prompt.length / 90))}
                    onChange={(e) => onPromptChange(e.target.value)}
                    className="w-full resize-none border-0 p-0 text-[10.5pt] text-gray-900 leading-relaxed focus:outline-none focus:ring-0 bg-transparent"
                  />
                ) : (
                  <p className="text-[10.5pt] text-gray-900 leading-relaxed">
                    <LatexRenderer content={q.prompt} />
                  </p>
                )}
                {q.tier && <TierBadge tier={q.tier} />}
                {q.hint && (
                  <p className="text-[8.5pt] italic text-gray-400 mt-0.5">Hint: {q.hint}</p>
                )}
              </div>
              <span className="text-[9pt] text-gray-500 shrink-0 font-mono whitespace-nowrap">
                [{q.marks ?? 0}]
              </span>
            </div>
          ) : (
            <div>
              {onPromptChange ? (
                <textarea
                  ref={textareaRef}
                  defaultValue={q.prompt}
                  rows={Math.max(2, Math.ceil(q.prompt.length / 90))}
                  onChange={(e) => onPromptChange(e.target.value)}
                  className="w-full resize-none border-0 p-0 text-[10.5pt] text-gray-900 leading-relaxed focus:outline-none focus:ring-0 bg-transparent"
                />
              ) : (
                <p className="text-[10.5pt] text-gray-900 leading-relaxed">
                  <LatexRenderer content={q.prompt} />
                </p>
              )}
              {q.tier && <TierBadge tier={q.tier} />}
              {q.hint && (
                <p className="text-[8.5pt] italic text-gray-400 mt-0.5">Hint: {q.hint}</p>
              )}
            </div>
          )}
          {/* Subparts */}
          {q.subparts?.map((sp, si) => (
            <div key={si} className="mt-2 ml-4 flex gap-2 items-start">
              <span className="text-[9pt] text-gray-400 font-mono shrink-0 mt-1">
                ({String.fromCharCode(105 + si)})
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex gap-2 items-start">
                  <p className="flex-1 text-[10pt] text-gray-800 leading-relaxed">
                    <LatexRenderer content={sp.prompt} />
                  </p>
                  {sp.marks != null && formatting.includeMarksColumn && (
                    <span className="text-[9pt] text-gray-500 shrink-0 font-mono whitespace-nowrap">
                      [{sp.marks}]
                    </span>
                  )}
                </div>
                {sp.tier && <TierBadge tier={sp.tier} />}
                {sp.hint && <p className="text-[8.5pt] italic text-gray-400 mt-0.5">Hint: {sp.hint}</p>}
              </div>
            </div>
          ))}
          {/* Answer box */}
          {formatting.answerStyle !== "none" && <AnswerBox lines={answerLines} />}
          {/* Continuation line */}
          {answerLines > 0 && (
            <p className="text-[7.5pt] text-gray-400 italic mt-0.5 text-right">
              Continue on next page if needed
            </p>
          )}
          {/* Answer key */}
          {formatting.includeAnswerKey && q.answer && (
            <div className="mt-1 rounded border border-green-200 bg-green-50 px-2 py-1">
              <span className="text-[8.5pt] text-green-800 font-semibold">Answer: </span>
              <span className="text-[8.5pt] text-green-700">{q.answer}</span>
            </div>
          )}
          {/* Translation table */}
          {q.translationTable && (
            <table className="mt-2 w-full text-[9pt] border border-gray-200">
              <caption className="text-left text-[8.5pt] text-gray-500 italic mb-1">
                {q.translationTable.caption}
              </caption>
              <thead>
                <tr className="bg-gray-100">
                  <th className="text-left px-2 py-1 font-semibold">Informal</th>
                  <th className="text-left px-2 py-1 font-semibold">Formal</th>
                </tr>
              </thead>
              <tbody>
                {q.translationTable.rows.map((r, ri) => (
                  <tr key={ri} className={ri % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                    <td className="px-2 py-1 border-t border-gray-100">{r.informal}</td>
                    <td className="px-2 py-1 border-t border-gray-100">{r.formal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main NuancedAnalysisPreview component ──────────────────────────────────────

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

  const nd = draft as AssignmentDraft & NuancedDraftFields;

  // Detect "Part N" sections for structural logic
  const sections = draft.sections ?? [];
  const partSections = useMemo(
    () => sections.filter((s) => /^Part\s+\d+/i.test(s.heading)),
    [sections]
  );

  // Find duplicate question prompts
  const allPrompts = useMemo(() => {
    const acc: string[] = [];
    for (const sec of sections) {
      for (const q of sec.questions) {
        acc.push(q.prompt.trim().toLowerCase().slice(0, 80));
      }
    }
    return acc;
  }, [sections]);

  const duplicatePairs = useMemo(() => {
    const seen = new Map<string, number>();
    const dupes: number[] = [];
    allPrompts.forEach((p, i) => {
      if (seen.has(p)) dupes.push(seen.get(p)!, i);
      else seen.set(p, i);
    });
    return dupes;
  }, [allPrompts]);

  function updateSection(si: number, heading: string) {
    if (!onDraftChange) return;
    const sections = [...draft.sections];
    sections[si] = { ...sections[si], heading };
    onDraftChange({ ...draft, sections });
  }

  function updateQuestionPrompt(si: number, qi: number, prompt: string) {
    if (!onDraftChange) return;
    const sections = [...draft.sections];
    const questions = [...sections[si].questions];
    questions[qi] = { ...questions[qi], prompt };
    sections[si] = { ...sections[si], questions };
    onDraftChange({ ...draft, sections });
  }

  // Detect teacher companion boundary
  const teacherCompanionIdx = sections.findIndex(
    (s) => /teacher.{0,10}companion/i.test(s.heading)
  );

  return (
    <div
      className="font-serif text-gray-900 max-w-[794px] mx-auto"
      style={{ fontFamily: "'Times New Roman', Times, serif" }}
    >
      {/* ── Document Header ──────────────────────────────────────────────────── */}
      <header className="mb-6">
        <div className="text-center mb-3">
          <p className="text-[9pt] font-bold uppercase tracking-widest text-teal-700 mb-1">
            {nd.course || "IBDP Mathematics AA HL"}
          </p>
          <input
            type="text"
            defaultValue={draft.title}
            onChange={(e) => onDraftChange?.({ ...draft, title: e.target.value })}
            className="block w-full text-center text-[20pt] font-bold text-gray-900 border-0 border-b-2 border-transparent hover:border-blue-300 focus:border-blue-500 p-0 bg-transparent focus:outline-none focus:ring-0 mt-1 cursor-text"
            title="Click to edit title"
          />
          <p className="text-[11pt] italic text-gray-500 mt-0.5">{nd.subtitle || draft.subtitle || "IBDP Mathematics — Analysis & Approaches HL"}</p>
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
            {draft.instructions.map((ins, i) => (
              <li key={i}>{ins}</li>
            ))}
          </ol>
        </section>
      )}

      {/* ── Command Terms strip ──────────────────────────────────────────────── */}
      {nd.commandTerms?.length ? (
        <CommandTermsStrip terms={nd.commandTerms} />
      ) : null}

      {/* ── TOK Provocations ────────────────────────────────────────────────── */}
      {nd.tokProvocations?.length ? (
        <TokProvocations provocations={nd.tokProvocations} />
      ) : null}

      {/* ── International Mindedness ─────────────────────────────────────────── */}
      {nd.internationalMindedness ? (
        <IntlMindedness im={nd.internationalMindedness} />
      ) : null}

      {/* ── Sections ────────────────────────────────────────────────────────── */}
      {sections.map((section, si) => {
        const isTeacherSection = teacherCompanionIdx !== -1 && si >= teacherCompanionIdx;
        const sec = section as Section;

        return (
          <section key={si} className="mb-6">
            {/* Teacher Companion separator */}
            {si === teacherCompanionIdx && (
              <div className="my-6 flex items-center gap-2">
                <div className="flex-1 border-t-2 border-dashed border-gray-400" />
                <span className="text-[8pt] font-bold uppercase tracking-widest text-gray-400 bg-white px-2">
                  Teacher&apos;s Companion — Do Not Distribute
                </span>
                <div className="flex-1 border-t-2 border-dashed border-gray-400" />
              </div>
            )}

            {/* Section heading */}
            <div className={`mb-3 ${isTeacherSection ? "bg-gray-100 px-2 py-1 rounded" : ""}`}>
              <input
                type="text"
                defaultValue={section.heading}
                onChange={(e) => updateSection(si, e.target.value)}
                className="flex-1 border-0 p-0 bg-transparent text-[13pt] font-bold text-gray-900 focus:outline-none focus:ring-0 cursor-text hover:border-b hover:border-blue-300 focus:border-b focus:border-blue-500"
                title="Click to edit section heading"
              />
              {isTeacherSection && (
                <button
                  type="button"
                  onClick={() => {/* future regenerate logic */}}
                  className="ml-2 text-[8pt] text-gray-400 hover:text-teal-600 border border-gray-300 hover:border-teal-400 rounded px-1.5 py-0.5 transition-colors"
                >
                  ↺Regenerate section
                </button>
              )}
            </div>

            {/* Per-section prerequisite box */}
            {sec.prerequisiteBox && <PrerequisiteBox items={sec.prerequisiteBox.items} />}

            {/* Questions */}
            {section.questions.map((q, qi) => (
              <QuestionBlock
                key={qi}
                q={q}
                qIdx={qi}
                sectionIdx={si}
                formatting={formatting}
                globalAnswerLines={globalAnswerLines}
                onPromptChange={onDraftChange ? (val) => updateQuestionPrompt(si, qi, val) : undefined}
              />
            ))}
          </section>
        );
      })}

      {/* ── Part progress tracker (hidden in default student view) ──────────── */}
      {/* Note: ProgressTracker component is defined above but not rendered    */}
      {/* in the default view. Remove this comment to show it:                 */}
      {/* <ProgressTracker partCount={partSections.length || sections.length} /> */}
      {void partSections}
    </div>
  );
}
