"use client";

/**
 * NuancedAnalysisPreview
 * ──────────────────────
 * Renders an AssignmentDraft as a live, editable preview that matches the
 * "Polynomial Analysis" PDF visual design exactly:
 *
 *  • Bold serif title, centred, with school header + subtitle
 *  • Name / Date underline fields
 *  • Numbered instructions list
 *  • Command-Terms tear-off strip (teal box, table + demand scale)
 *  • Per-section: full-width rule + bold "Part N — Title" header
 *  • Prerequisite / "What you need" micro-box before questions
 *  • Command-Term Spotlight callout (teal fill) inside parts
 *  • Star-tiered (★ ★★ ★★★) question labels
 *  • Marks box in right margin
 *  • Italic hint lines
 *  • Translation tables (two-column bordered)
 *  • Geometric/Physical Reading callout (grey fill) at part end
 */

import { type AssignmentDraft, type FormattingRequirements, clampInt, formatQuestionLabel } from "@/lib/assignments";

// ── Types for extended draft fields ──────────────────────────────────────────

export interface CommandTermEntry {
  term: string;
  definition: string;
}

export interface SpotlightBox {
  title: string;   // e.g. "Sketch vs. Draw"
  body: string;    // paragraph body
}

export interface TranslationRow {
  informal: string;
  formal: string;
}

export interface TranslationTable {
  caption: string;
  rows: TranslationRow[];
}

export interface GeometricReading {
  body: string;
}

export interface PrerequisiteBox {
  items: string[]; // bullet points, max 4
}

export interface NuancedQuestion {
  prompt: string;
  marks: number;
  answer?: string;
  tier?: 1 | 2 | 3;           // 1=★  2=★★  3=★★★
  hint?: string;
  subparts?: NuancedQuestion[]; // (a), (b), (c) …
}

export interface NuancedSection {
  heading: string;            // "Part 1 — Graphical Foundations"
  prerequisiteBox?: PrerequisiteBox;
  spotlight?: SpotlightBox;
  questions: NuancedQuestion[];
  translationTable?: TranslationTable;
  geometricReading?: GeometricReading;
}

/** Extended draft — all optional fields are backward-compatible */
export interface NuancedDraft {
  title: string;
  subtitle?: string;
  course?: string;
  syllabusTopics?: string;
  prerequisites?: string;
  materials?: string;
  instructions: string[];
  commandTerms?: CommandTermEntry[];
  sections: NuancedSection[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function tierStars(tier?: 1 | 2 | 3): string {
  if (tier === 1) return "★ ";
  if (tier === 2) return "★★ ";
  if (tier === 3) return "★★★ ";
  return "";
}

// Map a flat AssignmentDraft section to NuancedSection so the component works
// with data produced by the existing AI prompt (no extended fields yet).
function adaptSection(s: AssignmentDraft["sections"][number], idx: number): NuancedSection {
  return {
    heading: s.heading || `Part ${idx + 1}`,
    questions: s.questions.map((q) => ({
      prompt: q.prompt,
      marks: q.marks ?? 0,
      answer: q.answer,
    })),
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SpotlightCallout({ box }: { box: SpotlightBox }) {
  return (
    <div className="my-3 rounded border border-teal-600 bg-teal-600 overflow-hidden">
      <div className="px-3 py-1">
        <span className="text-xs font-bold text-white uppercase tracking-wide">
          Command Term Spotlight: {box.title}
        </span>
      </div>
      <div className="bg-teal-50 px-3 py-2">
        <p className="text-[10.5pt] text-gray-800 leading-relaxed">{box.body}</p>
      </div>
    </div>
  );
}

function PrerequisiteCallout({ box }: { box: PrerequisiteBox }) {
  return (
    <div className="my-3 rounded border border-blue-400 bg-blue-50 px-3 py-2">
      <p className="mb-1 text-[9pt] font-bold text-blue-800 uppercase tracking-wide">
        What you need to start this Part
      </p>
      <ul className="list-disc list-inside space-y-0.5">
        {box.items.map((item, i) => (
          <li key={i} className="text-[10pt] text-gray-800">{item}</li>
        ))}
      </ul>
    </div>
  );
}

function GeometricReadingCallout({ reading }: { reading: GeometricReading }) {
  return (
    <div className="my-3 rounded border border-gray-300 bg-gray-50 px-3 py-2">
      <p className="mb-0.5 text-[9pt] font-bold text-gray-600 uppercase tracking-wide">
        Geometric / Physical Reading
      </p>
      <p className="text-[10.5pt] text-gray-700 italic leading-relaxed">{reading.body}</p>
    </div>
  );
}

function TranslationTableBlock({ table }: { table: TranslationTable }) {
  return (
    <div className="my-3">
      <p className="mb-1 text-[9pt] font-bold text-gray-700 uppercase tracking-wide">
        {table.caption}
      </p>
      <table className="w-full border-collapse text-[10pt]">
        <thead>
          <tr className="bg-gray-100">
            <th className="border border-gray-400 px-2 py-1 text-left font-semibold text-gray-700 w-1/2">
              What you say in your head…
            </th>
            <th className="border border-gray-400 px-2 py-1 text-left font-semibold text-gray-700 w-1/2">
              What you write on the exam paper…
            </th>
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
      <div className="bg-teal-600 px-3 py-1">
        <span className="text-xs font-bold text-white uppercase tracking-wide">
          Command Terms (tear-off strip)
        </span>
      </div>
      <div className="bg-teal-50 px-3 py-2">
        <table className="w-full text-[9.5pt]">
          <tbody>
            {terms.map((t, i) => (
              <tr key={i}>
                <td className="py-0.5 pr-3 font-bold text-gray-900 whitespace-nowrap align-top w-28">
                  {t.term}
                </td>
                <td className="py-0.5 text-gray-700">{t.definition}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 flex items-center gap-1 text-[8.5pt] text-gray-600">
          <span className="font-semibold">Output demand →</span>
          <span className="italic">Write down</span>
          <span>·</span>
          <span className="italic">State</span>
          <span>·</span>
          <span className="italic">Describe</span>
          <span>·</span>
          <span className="italic">Explain</span>
          <span>·</span>
          <span className="italic">Show that</span>
          <span>·</span>
          <span className="italic font-semibold">Prove</span>
        </div>
      </div>
    </div>
  );
}

function QuestionRow({
  q,
  number,
  indent = false,
  onChangePrompt,
  onChangeMarks,
  includeMarksColumn,
}: {
  q: NuancedQuestion;
  number: string;
  indent?: boolean;
  onChangePrompt?: (val: string) => void;
  onChangeMarks?: (val: number) => void;
  includeMarksColumn: boolean;
}) {
  return (
    <div className={`flex items-start gap-2 ${indent ? "ml-6" : ""}`}>
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
        {q.hint && (
          <p className="mt-0.5 ml-2 text-[9.5pt] italic text-gray-500">
            <em>Hint: {q.hint}</em>
          </p>
        )}
      </div>
      {includeMarksColumn && (
        <div className="shrink-0 ml-2">
          <input
            type="number"
            value={q.marks}
            onChange={(e) => onChangeMarks?.(clampInt(Number(e.target.value), 0, 20))}
            className="w-10 rounded border border-gray-400 px-1 py-0.5 text-right text-[9.5pt] text-gray-800"
            aria-label={`Marks for ${number}`}
          />
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  draft: AssignmentDraft;
  formatting: FormattingRequirements;
  onDraftChange: (updated: AssignmentDraft) => void;
}

export function NuancedAnalysisPreview({ draft, formatting, onDraftChange }: Props) {
  const nd = draft as unknown as NuancedDraft;
  const sections: NuancedSection[] = (draft.sections ?? []).map((s, i) =>
    (s as unknown as NuancedSection).questions !== undefined &&
    typeof (s as unknown as NuancedSection).heading === "string"
      ? (s as unknown as NuancedSection)
      : adaptSection(s, i)
  );

  function updateSectionHeading(si: number, val: string) {
    const updated = [...draft.sections];
    updated[si] = { ...updated[si], heading: val };
    onDraftChange({ ...draft, sections: updated });
  }

  function updateQuestionPrompt(si: number, qi: number, val: string) {
    const updated = [...draft.sections];
    const qs = [...updated[si].questions];
    qs[qi] = { ...qs[qi], prompt: val };
    updated[si] = { ...updated[si], questions: qs };
    onDraftChange({ ...draft, sections: updated });
  }

  function updateQuestionMarks(si: number, qi: number, val: number) {
    const updated = [...draft.sections];
    const qs = [...updated[si].questions];
    qs[qi] = { ...qs[qi], marks: val };
    updated[si] = { ...updated[si], questions: qs };
    onDraftChange({ ...draft, sections: updated });
  }

  let globalQNum = 0;

  return (
    <div
      className="bg-white text-gray-900"
      style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: `${formatting.fontSize ?? 11}pt`, lineHeight: 1.55 }}
    >
      {/* ── Document header ──────────────────────────────────────────────── */}
      <header className="mb-4">
        <div className="flex items-start justify-between mb-1">
          <div className="text-[10pt] text-gray-800 space-y-0.5">
            {formatting.includeNameLine && (
              <p><strong>Student Name:</strong> <span className="inline-block border-b border-gray-600 w-48">&nbsp;</span></p>
            )}
            {formatting.includeDateLine && (
              <p><strong>Date:</strong> <span className="inline-block border-b border-gray-600 w-36">&nbsp;</span></p>
            )}
            {nd.course && <p><strong>Course:</strong> {nd.course}</p>}
            {nd.syllabusTopics && <p><strong>Syllabus Topic(s):</strong> {nd.syllabusTopics}</p>}
          </div>
          <div className="text-right text-[8.5pt] text-gray-400 italic border border-gray-200 rounded px-2 py-1">
            CleverMathematics
          </div>
        </div>
        <div className="border-t border-gray-400 pt-3 mt-2 text-center">
          <p className="text-[9pt] font-bold uppercase tracking-widest text-gray-600">
            {formatting.schoolName || "CleverPlatform Mathematics"}
          </p>
          <input
            type="text"
            value={draft.title}
            onChange={(e) => onDraftChange({ ...draft, title: e.target.value })}
            className="block w-full text-center text-[20pt] font-bold text-gray-900 border-0 p-0 bg-transparent focus:outline-none focus:ring-0 mt-1"
            style={{ fontFamily: "Georgia, serif" }}
          />
          <p className="text-[11pt] italic text-gray-600 mt-0.5">
            {nd.subtitle || draft.subtitle || "Mastery Packet: IBDP Mathematics AA HL"}
          </p>
        </div>
      </header>

      {/* ── Instructions ─────────────────────────────────────────────────── */}
      {draft.instructions?.length > 0 && (
        <section className="mb-4">
          <p className="font-bold text-[11pt] text-gray-900 mb-1">Instructions</p>
          <ol className="list-decimal list-outside ml-5 space-y-0.5 text-[10.5pt]">
            {draft.instructions.map((ins, i) => (
              <li key={i} className="text-gray-800">{ins}</li>
            ))}
          </ol>
        </section>
      )}

      {/* ── Command Terms tear-off strip ─────────────────────────────────── */}
      {nd.commandTerms && nd.commandTerms.length > 0 && (
        <CommandTermsStrip terms={nd.commandTerms} />
      )}

      {/* ── Sections / Parts ─────────────────────────────────────────────── */}
      {sections.map((section, si) => {
        const nuanced = section as NuancedSection;
        return (
          <section key={si} className="mt-5">
            <div className="border-t-2 border-gray-800 pt-2 mb-3">
              <input
                type="text"
                value={nuanced.heading}
                onChange={(e) => updateSectionHeading(si, e.target.value)}
                className="w-full border-0 p-0 bg-transparent text-[13pt] font-bold text-gray-900 focus:outline-none focus:ring-0"
                style={{ fontFamily: "Georgia, serif" }}
              />
            </div>
            {nuanced.prerequisiteBox && (
              <PrerequisiteCallout box={nuanced.prerequisiteBox} />
            )}
            {nuanced.spotlight && (
              <SpotlightCallout box={nuanced.spotlight} />
            )}
            <div className="space-y-3">
              {nuanced.questions.map((q, qi) => {
                globalQNum += 1;
                const label = String(globalQNum);
                const nq = q as NuancedQuestion;
                return (
                  <div key={qi}>
                    <QuestionRow
                      q={nq}
                      number={label}
                      includeMarksColumn={formatting.includeMarksColumn ?? true}
                      onChangePrompt={(val) => updateQuestionPrompt(si, qi, val)}
                      onChangeMarks={(val) => updateQuestionMarks(si, qi, val)}
                    />
                    {nq.subparts && nq.subparts.length > 0 && (
                      <div className="mt-1 space-y-2">
                        {nq.subparts.map((sub, subi) => {
                          const sublabel = `${label}(${String.fromCharCode(97 + subi)})`;
                          return (
                            <QuestionRow
                              key={subi}
                              q={sub}
                              number={sublabel}
                              indent
                              includeMarksColumn={formatting.includeMarksColumn ?? true}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {nuanced.translationTable && (
              <TranslationTableBlock table={nuanced.translationTable} />
            )}
            {nuanced.geometricReading && (
              <GeometricReadingCallout reading={nuanced.geometricReading} />
            )}
          </section>
        );
      })}

      {/* ── Answer Key ───────────────────────────────────────────────────── */}
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
