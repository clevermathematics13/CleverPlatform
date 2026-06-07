"use client";

/**
 * NuancedAnalysisPreview
 * ──────────────────────
 * Live editable preview of an AssignmentDraft with:
 *  - Per-question answer box line count override (± spinner)
 *  - Answer style: bordered boxes, bare lines, or no space
 *  - Inline duplicate-question warnings
 *  - Per-section Regenerate button
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

export interface NuancedQuestion {
  prompt: string;
  marks: number;
  answer?: string;
  tier?: 1 | 2 | 3;
  hint?: string;
  subparts?: NuancedQuestion[];
  answerBoxLines?: number;
}

export interface NuancedSection {
  heading: string;
  prerequisiteBox?: PrerequisiteBox;
  spotlight?: SpotlightBox;
  questions: NuancedQuestion[];
  translationTable?: TranslationTable;
  geometricReading?: GeometricReading;
}

export interface NuancedDraft {
  title: string; subtitle?: string; course?: string; syllabusTopics?: string;
  prerequisites?: string; materials?: string; instructions: string[];
  commandTerms?: CommandTermEntry[]; sections: NuancedSection[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function tierStars(tier?: 1 | 2 | 3): string {
  if (tier === 1) return "★ ";
  if (tier === 2) return "★★ ";
  if (tier === 3) return "★★★ ";
  return "";
}

function adaptSection(s: AssignmentDraft["sections"][number], idx: number): NuancedSection {
  return {
    heading: s.heading || `Part ${idx + 1}`,
    questions: s.questions.map((q) => ({ prompt: q.prompt, marks: q.marks ?? 0, answer: q.answer, answerBoxLines: q.answerBoxLines })),
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SpotlightCallout({ box }: { box: SpotlightBox }) {
  return (
    <div className="my-3 rounded border border-teal-600 bg-teal-600 overflow-hidden">
      <div className="px-3 py-1"><span className="text-xs font-bold text-white uppercase tracking-wide">Command Term Spotlight: {box.title}</span></div>
      <div className="bg-teal-50 px-3 py-2"><p className="text-[10.5pt] text-gray-800 leading-relaxed">{box.body}</p></div>
    </div>
  );
}

function PrerequisiteCallout({ box }: { box: PrerequisiteBox }) {
  return (
    <div className="my-3 rounded border border-blue-400 bg-blue-50 px-3 py-2">
      <p className="mb-1 text-[9pt] font-bold text-blue-800 uppercase tracking-wide">What you need to start this Part</p>
      <ul className="list-disc list-inside space-y-0.5">
        {box.items.map((item, i) => <li key={i} className="text-[10pt] text-gray-800">{item}</li>)}
      </ul>
    </div>
  );
}

function GeometricReadingCallout({ reading }: { reading: GeometricReading }) {
  return (
    <div className="my-3 rounded border border-gray-300 bg-gray-50 px-3 py-2">
      <p className="mb-0.5 text-[9pt] font-bold text-gray-600 uppercase tracking-wide">Geometric / Physical Reading</p>
      <p className="text-[10.5pt] text-gray-700 italic leading-relaxed">{reading.body}</p>
    </div>
  );
}

function TranslationTableBlock({ table }: { table: TranslationTable }) {
  return (
    <div className="my-3">
      <p className="mb-1 text-[9pt] font-bold text-gray-700 uppercase tracking-wide">{table.caption}</p>
      <table className="w-full border-collapse text-[10pt]">
        <thead>
          <tr className="bg-gray-100">
            <th className="border border-gray-400 px-2 py-1 text-left font-semibold text-gray-700 w-1/2">What you say in your head…</th>
            <th className="border border-gray-400 px-2 py-1 text-left font-semibold text-gray-700 w-1/2">What you write on the exam paper…</th>
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i} className={i % 2 === 1 ? "bg-gray-50" : "bg-white"}>
              <td className="border border-gray-400 px-2 py-1 text-gray-800 italic">{row.informal}</td>
              <td className="border border-gray-400 px-2 py-1 text-gray-800">{row.formal}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CommandTermsStrip({ terms }: { terms: CommandTermEntry[] }) {
  if (!terms.length) return null;
  return (
    <div className="my-4 border-y-2 border-gray-400">
      <div className="bg-teal-600 px-3 py-1"><span className="text-xs font-bold text-white uppercase tracking-wide">Command Terms (tear-off strip)</span></div>
      <div className="bg-teal-50 px-3 py-2">
        <table className="w-full text-[9.5pt]">
          <tbody>
            {terms.map((t, i) => (
              <tr key={i}>
                <td className="py-0.5 pr-3 font-bold text-gray-900 whitespace-nowrap align-top w-28">{t.term}</td>
                <td className="py-0.5 text-gray-700">{t.definition}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 flex items-center gap-1 text-[8.5pt] text-gray-600">
          <span className="font-semibold">Output demand →</span>
          {["Write down", "State", "Describe", "Explain", "Show that", "Prove"].map((t, i, arr) => (
            <span key={t}><span className={i === arr.length - 1 ? "italic font-semibold" : "italic"}>{t}</span>{i < arr.length - 1 && <span> · </span>}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── QuestionRow with per-question answer box control ─────────────────────────

function QuestionRow({
  q, number, indent = false,
  onChangePrompt, onChangeMarks, onChangeAnswerLines,
  includeMarksColumn, globalAnswerLines, isDuplicate, answerStyle = "boxes",
}: {
  q: NuancedQuestion; number: string; indent?: boolean;
  onChangePrompt?: (val: string) => void;
  onChangeMarks?: (val: number) => void;
  onChangeAnswerLines?: (val: number) => void;
  includeMarksColumn: boolean;
  globalAnswerLines: number;
  isDuplicate?: boolean;
  answerStyle?: "boxes" | "lines" | "none";
}) {
  const lines = q.answerBoxLines ?? globalAnswerLines;
  const isOverridden = q.answerBoxLines !== undefined;

  return (
    <div className={`${indent ? "ml-6" : ""} ${isDuplicate ? "rounded border border-yellow-400 bg-yellow-50 px-2 py-1" : ""}`}>
      {isDuplicate && (
        <div className="mb-1 flex items-center gap-1 text-[8.5pt] text-yellow-700">
          <span>⚠</span>
          <span>Similar to another question — consider revising</span>
        </div>
      )}
      <div className="flex items-start gap-2">
        <span className="shrink-0 font-bold text-gray-900 text-[10.5pt] min-w-[2.5rem] pt-0.5">
          {tierStars(q.tier)}{number}.
        </span>
        <div className="flex-1 min-w-0">
          <textarea
            value={q.prompt}
            onChange={(e) => onChangePrompt?.(e.target.value)}
            rows={Math.max(1, Math.ceil(q.prompt.length / 90))}
            className="w-full resize-none border-0 p-0 text-[10.5pt] text-gray-900 leading-relaxed focus:outline-none focus:ring-0 bg-transparent"
          />
          {q.hint && <p className="mt-0.5 ml-2 text-[9.5pt] italic text-gray-500">Hint: {q.hint}</p>}
        </div>
        {includeMarksColumn && (
          <input
            type="number" value={q.marks}
            onChange={(e) => onChangeMarks?.(clampInt(Number(e.target.value), 0, 20))}
            className="w-10 shrink-0 rounded border border-gray-400 px-1 py-0.5 text-right text-[9.5pt]"
            aria-label={`Marks for ${number}`}
          />
        )}
      </div>
      {/* Answer box lines per-question control */}
      {answerStyle !== "none" && (
      <div className="mt-1 ml-10 flex items-center gap-2">
        <span className="text-[8.5pt] text-gray-400">Lines:</span>
        <button
          type="button"
          onClick={() => onChangeAnswerLines?.(Math.max(1, lines - 1))}
          className="h-5 w-5 rounded border border-gray-300 bg-gray-100 text-xs font-bold text-gray-600 hover:bg-gray-200 leading-none"
          aria-label="Fewer answer lines"
        >−</button>
        <span className={`text-[8.5pt] tabular-nums font-semibold ${isOverridden ? "text-amber-600" : "text-gray-400"}`}>
          {lines}{isOverridden ? " ✎" : ""}
        </span>
        <button
          type="button"
          onClick={() => onChangeAnswerLines?.(Math.min(16, lines + 1))}
          className="h-5 w-5 rounded border border-gray-300 bg-gray-100 text-xs font-bold text-gray-600 hover:bg-gray-200 leading-none"
          aria-label="More answer lines"
        >+</button>
        {isOverridden && (
          <button
            type="button"
            onClick={() => onChangeAnswerLines?.(-1)}
            className="text-[8pt] text-gray-400 hover:text-red-400"
            aria-label="Reset to global"
          >reset</button>
        )}
        {/* Ruled preview */}
        <div className="ml-2 flex items-end gap-px opacity-40">
          {Array.from({ length: Math.min(lines, 8) }, (_, i) => (
            <div key={i} className="w-3 border-b border-gray-600" style={{ height: `${6 + i * 2}px` }} />
          ))}
          {lines > 8 && <span className="text-[8pt] text-gray-400">+{lines - 8}</span>}
        </div>
      </div>
      )}
      {/* Answer space — boxes, lines, or none */}
      {answerStyle === "boxes" && (
        <div className="mt-2 ml-10 border border-gray-400 rounded-sm overflow-hidden">
          {Array.from({ length: lines }, (_, i) => (
            <div key={i} className={`border-gray-200 ${i < lines - 1 ? "border-b" : ""}`} style={{ height: "22px" }} />
          ))}
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
            "Regenerate ONLY the questions array for that section. Keep the same tier distribution, same heading, same enrichment fields (prerequisiteBox, spotlight, etc.).",
            "Return ONLY the updated full JSON object (same structure, same fields). No preamble, no backticks.",
          ].join(" "),
          messages: [{
            role: "user",
            content: [
              `Regenerate the section with heading: "${sectionHeading}".`,
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
        type="button"
        onClick={handleRegenerate}
        disabled={isLoading}
        title={`Regenerate questions in "${sectionHeading}"`}
        className="flex items-center gap-1 rounded border border-indigo-400/40 bg-indigo-500/10 px-2 py-0.5 text-[9pt] font-medium text-indigo-300 transition-colors hover:bg-indigo-500/20 disabled:opacity-50"
      >
        {isLoading ? (
          <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
        ) : "↻"}
        {isLoading ? "Regenerating…" : "Regenerate section"}
      </button>
      {error && <span className="text-[8.5pt] text-red-400">{error}</span>}
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
}

export function NuancedAnalysisPreview({ draft, formatting, onDraftChange, globalAnswerLines = 4, gradeLevel }: Props) {
  const nd = draft as unknown as NuancedDraft;
  const sections: NuancedSection[] = (draft.sections ?? []).map((s, i) =>
    typeof (s as unknown as NuancedSection).heading === "string"
      ? (s as unknown as NuancedSection)
      : adaptSection(s, i)
  );

  // Duplicate detection
  const duplicatePairs: DuplicatePair[] = detectDuplicateQuestions(draft);
  const duplicateSet = new Set<string>();
  for (const pair of duplicatePairs) {
    duplicateSet.add(`${pair.a.sectionIdx}-${pair.a.questionIdx}`);
    duplicateSet.add(`${pair.b.sectionIdx}-${pair.b.questionIdx}`);
  }

  function updateSectionHeading(si: number, val: string) {
    const updated = [...draft.sections];
    updated[si] = { ...updated[si], heading: val };
    onDraftChange({ ...draft, sections: updated });
  }

  function updateQuestionField(si: number, qi: number, fields: Partial<AssignmentDraft["sections"][number]["questions"][number]>) {
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

  return (
    <div
      className="bg-white text-gray-900"
      style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: `${formatting.fontSize ?? 11}pt`, lineHeight: 1.55 }}
    >
      {/* Document header */}
      <header className="mb-4">
        <div className="flex items-start justify-between mb-1">
          <div className="text-[10pt] text-gray-800 space-y-0.5">
            {formatting.includeNameLine && <p><strong>Student Name:</strong> <span className="inline-block border-b border-gray-600 w-48">&nbsp;</span></p>}
            {formatting.includeDateLine && <p><strong>Date:</strong> <span className="inline-block border-b border-gray-600 w-36">&nbsp;</span></p>}
            {nd.course && <p><strong>Course:</strong> {nd.course}</p>}
            {nd.syllabusTopics && <p><strong>Syllabus Topic(s):</strong> {nd.syllabusTopics}</p>}
          </div>
          <div className="text-right text-[8.5pt] text-gray-400 italic border border-gray-200 rounded px-2 py-1">CleverMathematics</div>
        </div>
        <div className="border-t border-gray-400 pt-3 mt-2 text-center">
          <p className="text-[9pt] font-bold uppercase tracking-widest text-gray-600">{formatting.schoolName || "CleverPlatform Mathematics"}</p>
          <input
            type="text" value={draft.title}
            onChange={(e) => onDraftChange({ ...draft, title: e.target.value })}
            className="block w-full text-center text-[20pt] font-bold text-gray-900 border-0 p-0 bg-transparent focus:outline-none focus:ring-0 mt-1"
            style={{ fontFamily: "Georgia, serif" }}
          />
          <p className="text-[11pt] italic text-gray-600 mt-0.5">{nd.subtitle || draft.subtitle || "Mastery Packet: IBDP Mathematics AA HL"}</p>
        </div>
      </header>

      {/* Duplicate warning banner */}
      {duplicatePairs.length > 0 && (
        <div className="mb-4 rounded border border-yellow-400 bg-yellow-50 px-3 py-2">
          <p className="text-[9.5pt] font-semibold text-yellow-800">⚠ {duplicatePairs.length} potentially duplicate question pair{duplicatePairs.length > 1 ? "s" : ""} detected</p>
          <ul className="mt-1 space-y-1">
            {duplicatePairs.map((pair, i) => (
              <li key={i} className="text-[8.5pt] text-yellow-700">
                <span className="font-medium">Q{pair.a.sectionIdx + 1}.{pair.a.questionIdx + 1}</span> and{" "}
                <span className="font-medium">Q{pair.b.sectionIdx + 1}.{pair.b.questionIdx + 1}</span>{" "}
                are {pair.similarity}% similar — <span className="italic truncate max-w-[300px] inline-block align-bottom">{pair.a.prompt.slice(0, 60)}{pair.a.prompt.length > 60 ? "…" : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Instructions */}
      {draft.instructions?.length > 0 && (
        <section className="mb-4">
          <p className="font-bold text-[11pt] text-gray-900 mb-1">Instructions</p>
          <ol className="list-decimal list-outside ml-5 space-y-0.5 text-[10.5pt]">
            {draft.instructions.map((ins, i) => <li key={i} className="text-gray-800">{ins}</li>)}
          </ol>
        </section>
      )}

      {/* Command Terms strip */}
      {nd.commandTerms && nd.commandTerms.length > 0 && <CommandTermsStrip terms={nd.commandTerms} />}

      {/* Sections */}
      {sections.map((section, si) => {
        const nuanced = section as NuancedSection;
        return (
          <section key={si} className="mt-5">
            <div className="border-t-2 border-gray-800 pt-2 mb-3 flex items-center gap-2">
              <input
                type="text" value={nuanced.heading}
                onChange={(e) => updateSectionHeading(si, e.target.value)}
                className="flex-1 border-0 p-0 bg-transparent text-[13pt] font-bold text-gray-900 focus:outline-none focus:ring-0"
                style={{ fontFamily: "Georgia, serif" }}
              />
              <RegenerateSectionButton
                sectionHeading={nuanced.heading}
                draft={draft}
                onSectionReplaced={onDraftChange}
                gradeLevel={gradeLevel}
              />
            </div>
            {nuanced.prerequisiteBox && <PrerequisiteCallout box={nuanced.prerequisiteBox} />}
            {nuanced.spotlight && <SpotlightCallout box={nuanced.spotlight} />}
            <div className="space-y-1">
              {nuanced.questions.map((q, qi) => {
                globalQNum++;
                const nq = q as NuancedQuestion;
                const isDuplicate = duplicateSet.has(`${si}-${qi}`);
                return (
                  <div key={qi}>
                    <QuestionRow
                      q={nq} number={String(globalQNum)}
                      includeMarksColumn={formatting.includeMarksColumn ?? true}
                      globalAnswerLines={globalAnswerLines}
                      isDuplicate={isDuplicate}
                      answerStyle={formatting.answerStyle ?? "boxes"}
                      onChangePrompt={(val) => updateQuestionField(si, qi, { prompt: val })}
                      onChangeMarks={(val) => updateQuestionField(si, qi, { marks: val })}
                      onChangeAnswerLines={(val) => handleAnswerLinesChange(si, qi, val)}
                    />
                    {nq.subparts && nq.subparts.length > 0 && (
                      <div className="mt-1 space-y-2">
                        {nq.subparts.map((sub, subi) => (
                          <QuestionRow
                            key={subi} q={sub}
                            number={`${globalQNum}(${String.fromCharCode(97 + subi)})`}
                            indent includeMarksColumn={formatting.includeMarksColumn ?? true}
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

      {/* Answer Key */}
      {formatting.includeAnswerKey && (
        <section className="mt-6 border-t-2 border-gray-800 pt-3">
          <p className="text-[12pt] font-bold text-gray-900 mb-2">Answer Key</p>
          <div className="space-y-1 text-[9.5pt] text-gray-800">
            {draft.sections.flatMap((sec, si) =>
              sec.questions.map((q, qi) => {
                const lbl = formatQuestionLabel(si, qi, formatting.numberingStyle);
                return (
                  <div key={`ans-${si}-${qi}`} className="flex gap-2">
                    <span className="font-bold w-8 shrink-0">{lbl}</span>
                    <span className="text-gray-700 italic">{q.answer ?? "—"}</span>
                  </div>
                );
              })
            )}
          </div>
        </section>
      )}
    </div>
  );
}
