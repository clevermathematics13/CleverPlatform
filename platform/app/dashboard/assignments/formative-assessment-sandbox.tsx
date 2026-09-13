"use client";

/**
 * FormativeAssessmentSandbox
 * --------------------------
 * Creator for a standalone Formative Assessment: a fixed-format test with
 * LEVEL bands, numbered questions/subparts each carrying a printed mark
 * value and a free-text M/A/R/FT mark scheme, plus paper-wide marking
 * principles and a reteach guide.
 *
 * Deliberately distinct from Nuanced Analysis (NuancedAnalysisSandbox) and
 * self-contained rather than reusing NuancedAnalysisPreview — that shared
 * editor has no concept of markScheme/requiresWorking/estimatedMinutes/
 * reteachGuide, and extending it for this format would
 * risk regressions in the NA/DP/generic-sandbox flows that depend on it.
 *
 * Save writes a gradeable `tests` row via POST /api/formative-assessments
 * (lib/formative-assessment-bridge.ts derives test_items from the draft),
 * so the saved assessment immediately works with the existing, unmodified
 * batch AI-grading UI at /dashboard/tests/[id]/ai-grade.
 *
 * A saved assessment can be reopened here. Until the picker existed,
 * `savedTestId` was only ever set by a save in the same browser session, so
 * closing the tab stranded a paper that `tests.custom_content` had held all
 * along -- Formative Assessment 1 was sat by 50 students and had no way back
 * into the editor. GET /api/formative-assessments lists them and
 * GET /api/formative-assessments/[testId] returns one to load.
 */

import { useEffect, useRef, useState } from "react";
import type {
  AssignmentDraft,
  AssignmentSection,
  AssignmentQuestion,
  FormattingRequirements,
  ReteachGuideEntry,
} from "@/lib/assignments";
import { sanitizeDraft, extractJsonObject } from "@/lib/assignments";
import {
  buildFormativeAssessmentSystemPrompt,
  buildFormativeAssessmentUserPrompt,
} from "@/lib/formative-assessment-prompt";
import {
  DEFAULT_ASSESSMENT_FORMATTING,
  buildFormativeAssessmentPdfBody,
} from "@/lib/formative-assessment-pdf-body";
import {
  editorSnapshot,
  needsDiscardConfirmation,
  isAlreadyOpen,
  formatSavedDate,
} from "./load-saved-assessment";
import type { RubricFinding } from "@/lib/rubric-validator";
import { createClient } from "@/lib/supabase/client";

type CourseOption = { id: string; name: string };
type ClaudeResponse = { content?: Array<{ type: string; text?: string }> };

/** One row of GET /api/formative-assessments, for the load picker. */
type SavedAssessment = {
  id: string;
  name: string;
  courseName: string;
  totalMarks: number | null;
  createdAt: string;
  pdfsGeneratedAt: string | null;
  itemCount: number;
};

/**
 * The saved assessments, or null if the list could not be fetched.
 *
 * Null rather than a throw: the picker is an extra way in, not the way in, so
 * a failed list leaves the last good one on screen and puts no error banner
 * over a sandbox that still works.
 */
async function fetchSavedAssessments(): Promise<SavedAssessment[] | null> {
  try {
    const res = await fetch("/api/formative-assessments");
    if (!res.ok) return null;
    const data = (await res.json()) as { assessments?: SavedAssessment[] };
    return data.assessments ?? [];
  } catch {
    return null;
  }
}


// Moved to lib/formative-assessment-pdf-body.ts when the save route started
// rendering these PDFs server-side: both sides must format a paper identically,
// or the archived copy is not the one the teacher previewed.
const DEFAULT_FORMATTING: FormattingRequirements = DEFAULT_ASSESSMENT_FORMATTING;

const DEFAULT_DRAFT: AssignmentDraft = {
  title: "Formative Assessment 1",
  subtitle: "Grade 9 Mathematics",
  instructions: [
    "Answer every part. Each part shows how many marks it is worth.",
    "Write your final answer on the line marked Answer.",
  ],
  sections: [
    {
      heading: "LEVEL 1 -- READ THE STRUCTURE",
      estimatedMinutes: 10,
      questions: [
        {
          prompt: "Write down the coefficient of x in the expression 3x + 7.",
          marks: 1,
          answer: "3",
          markScheme: "A1 for the correct value, sign included.",
          requiresWorking: false,
        },
      ],
    },
  ],
  markingPrinciples: [
    "A bare correct answer earns no method marks where the command term is Solve, Show, Determine, or Hence.",
    "Accept equivalent correct forms unless a part specifies otherwise.",
  ],
  reteachGuide: [],
  showSectionScoreSummary: true,
};

function newQuestion(): AssignmentQuestion {
  return { prompt: "", marks: 1, answer: "", markScheme: "", requiresWorking: false };
}

function newSection(): AssignmentSection {
  return { heading: "LEVEL -- NEW LEVEL", estimatedMinutes: 10, questions: [newQuestion()] };
}

export function FormativeAssessmentSandbox() {
  const [draft, setDraft] = useState<AssignmentDraft>(DEFAULT_DRAFT);
  const [formatting, setFormatting] = useState<FormattingRequirements>(DEFAULT_FORMATTING);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [courseId, setCourseId] = useState("");
  const [gradeLevel, setGradeLevel] = useState("Grade 9");
  const [topic, setTopic] = useState("Algebraic language, expressions, equations");
  const [totalMarksTarget, setTotalMarksTarget] = useState(50);
  const [levelCount, setLevelCount] = useState(4);
  const [contextNotes, setContextNotes] = useState("");
  const [savedTestId, setSavedTestId] = useState<string | null>(null);
  const [pdfsArchived, setPdfsArchived] = useState(false);
  const [requireSelfAssessment, setRequireSelfAssessment] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingMs, setIsExportingMs] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rubricFindings, setRubricFindings] = useState<RubricFinding[]>([]);
  const [rubricBlocked, setRubricBlocked] = useState(false);
  const [saved, setSaved] = useState<SavedAssessment[]>([]);
  const [loadId, setLoadId] = useState("");
  const [isLoadingSaved, setIsLoadingSaved] = useState(false);
  const [loadConfirm, setLoadConfirm] = useState(false);

  /**
   * What the editor looked like when it was last saved or loaded. Loading
   * replaces everything on screen, so this is what tells us whether that would
   * discard real work -- the alternative, confirming every time, trains a
   * teacher to click through the one prompt that matters.
   */
  const cleanSnapshot = useRef(editorSnapshot(DEFAULT_DRAFT, DEFAULT_FORMATTING));

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const { data } = await supabase.from("courses").select("id, name").eq("archived", false).order("name");
      if (!cancelled && data) setCourses(data as CourseOption[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Same shape as the courses fetch above -- the set happens inside the async
  // IIFE behind a cancelled guard, not in the effect body.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await fetchSavedAssessments();
      if (!cancelled && list) setSaved(list);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const totalMarks = draft.sections.reduce((sum, section) => sum + sectionMarks(section), 0);

  function sectionMarks(section: AssignmentSection): number {
    return section.questions.reduce((sum, q) => {
      if (q.subparts && q.subparts.length > 0) return sum + q.subparts.reduce((s, sp) => s + (sp.marks ?? 0), 0);
      return sum + (q.marks ?? 0);
    }, 0);
  }

  function updateSection(index: number, updater: (s: AssignmentSection) => AssignmentSection) {
    setDraft((d) => ({ ...d, sections: d.sections.map((s, i) => (i === index ? updater(s) : s)) }));
  }

  function updateQuestion(sIdx: number, qIdx: number, updater: (q: AssignmentQuestion) => AssignmentQuestion) {
    updateSection(sIdx, (s) => ({ ...s, questions: s.questions.map((q, i) => (i === qIdx ? updater(q) : q)) }));
  }

  async function generateWithAi() {
    setIsGenerating(true);
    setError(null);
    try {
      const response = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: buildFormativeAssessmentSystemPrompt(),
          messages: [
            {
              role: "user",
              content: buildFormativeAssessmentUserPrompt({
                gradeLevel,
                topic,
                totalMarks: totalMarksTarget,
                levelCount,
                contextNotes: contextNotes || undefined,
              }),
            },
          ],
        }),
      });
      if (!response.ok) {
        const d = (await response.json()) as { error?: string };
        throw new Error(d.error ?? `AI request failed with status ${response.status}`);
      }
      const data = (await response.json()) as ClaudeResponse;
      const rawText = data.content?.find((block) => block.type === "text")?.text ?? "";
      const json = extractJsonObject(rawText);
      const parsed = JSON.parse(json) as AssignmentDraft;
      setDraft(sanitizeDraft(parsed));
      // A generated draft is new work, not an edit of whatever was open: it
      // saves to a new test, and the archive on screen is not its archive.
      setSavedTestId(null);
      setPdfsArchived(false);
      setNotice(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected AI generation error.");
    } finally {
      setIsGenerating(false);
    }
  }

  function buildPdfBody(isMarkScheme: boolean) {
    return buildFormativeAssessmentPdfBody(draft, formatting, isMarkScheme);
  }

  async function downloadPdf(endpoint: string, isMarkScheme: boolean, setBusy: (b: boolean) => void, suffix: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPdfBody(isMarkScheme)),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${(draft.title || "assessment").replace(/[^a-z0-9]/gi, "_")}${suffix}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(`Export failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Reopen a saved assessment.
   *
   * Restores everything the save wrote, not just the questions: the formatting
   * decides what the PDFs look like, and the course and self-assessment gate
   * are what make the reloaded draft save back over the same test instead of
   * forking a second copy of it.
   */
  async function handleLoad() {
    if (!loadId) return;

    if (
      needsDiscardConfirmation({
        current: editorSnapshot(draft, formatting),
        clean: cleanSnapshot.current,
        confirmed: loadConfirm,
      })
    ) {
      setLoadConfirm(true);
      return;
    }

    setIsLoadingSaved(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/formative-assessments/${loadId}`);
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        name?: string;
        courseId?: string | null;
        draft?: AssignmentDraft;
        formatting?: FormattingRequirements;
        formattingSource?: "stored" | "default";
        requireSelfAssessment?: boolean;
        pdfsArchived?: boolean;
      };
      if (!res.ok || !data.draft) throw new Error(data.error ?? `Load failed (${res.status})`);

      setDraft(data.draft);
      if (data.formatting) setFormatting(data.formatting);
      setCourseId(data.courseId ?? "");
      setRequireSelfAssessment(data.requireSelfAssessment !== false);
      setSavedTestId(loadId);
      setPdfsArchived(Boolean(data.pdfsArchived));
      // Findings belong to the draft that produced them; carrying them over
      // would pin another paper's defects to this one.
      setRubricFindings([]);
      setRubricBlocked(false);
      setLoadConfirm(false);
      cleanSnapshot.current = editorSnapshot(
        data.draft,
        data.formatting ?? DEFAULT_FORMATTING,
      );
      setNotice(
        data.formattingSource === "default"
          ? `Loaded "${data.name ?? "assessment"}". It was saved before layout settings were kept, so those are back to the defaults -- check them before exporting.`
          : `Loaded "${data.name ?? "assessment"}". Saving writes back to this same test.`,
      );
    } catch (err) {
      setError(`Load failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setIsLoadingSaved(false);
    }
  }

  /**
   * `acknowledge` re-sends a save the rubric gate refused. The teacher has to
   * have seen the findings to get the button that sets it, which is the whole
   * point -- a defect that is merely logged somewhere gets marked against
   * fifty students anyway.
   */
  async function handleSave(acknowledge = false) {
    if (!courseId) {
      setError("Select a course before saving -- this is what makes the assessment gradeable.");
      return;
    }
    setIsSaving(true);
    setError(null);
    setNotice(null);
    if (!acknowledge) setRubricBlocked(false);
    try {
      const res = await fetch("/api/formative-assessments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          testId: savedTestId ?? undefined,
          courseId,
          draft,
          requireSelfAssessment,
          // Sent so the archived PDFs are the paper on screen, not a
          // default-formatted lookalike.
          formatting,
          ...(acknowledge ? { acknowledgeRubricFindings: true } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        test?: { id: string };
        testItems?: string;
        pdfs?: "archived" | "failed";
        pdfsError?: string;
        rubric?: { findings: RubricFinding[]; summary: { blocking: number; warnings: number } };
      };

      setRubricFindings(data.rubric?.findings ?? []);

      if (res.status === 422 && data.rubric) {
        // Not an error the teacher caused -- a review step. Kept out of the
        // red error box so it does not read as "your work was lost".
        setRubricBlocked(true);
        return;
      }
      if (!res.ok) throw new Error(data.error ?? `Save failed (${res.status})`);

      setRubricBlocked(false);
      setSavedTestId(data.test?.id ?? null);
      setPdfsArchived(data.pdfs === "archived");
      // This is now the saved state, so loading something else no longer has
      // unsaved work to warn about. Refresh the picker too: a first save adds
      // a row to it, and a re-save moves this one's totals.
      cleanSnapshot.current = editorSnapshot(draft, formatting);
      if (data.test?.id) setLoadId(data.test.id);
      void fetchSavedAssessments().then((list) => {
        if (list) setSaved(list);
      });
      const warnings = data.rubric?.summary.warnings ?? 0;
      const saved =
        data.testItems === "synced"
          ? "Saved -- ready to grade scanned student papers."
          : "Saved, but syncing gradeable items failed -- try saving again.";
      // A failed archive is called out rather than folded into the notice: the
      // whole point of archiving on save is that nobody has to remember, so a
      // save that did not archive must not read as a clean success.
      const archive =
        data.pdfs === "archived"
          ? " Student paper and mark scheme archived."
          : ` The PDFs were NOT archived (${data.pdfsError ?? "unknown error"}) -- save again to retry, or download them below and keep a copy.`;
      setNotice(
        warnings > 0
          ? `${saved}${archive} ${warnings} mark scheme warning(s) below -- worth a look before the class sits it.`
          : `${saved}${archive}`,
      );
    } catch (err) {
      setError(`Save failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-da-border bg-da-surface/80 p-6 shadow-lg shadow-black/30">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        {/* -- Left panel: generation + settings -- */}
        <div className="space-y-5">
          {/* Above "Generate with AI" on purpose: resuming an existing paper is
              the first question when you open this tab, and answering it after
              generating one means throwing that generation away. */}
          {saved.length > 0 && (
            <div className="rounded-xl border border-da-border bg-da-bg/40 p-4 space-y-3">
              <h2 className="text-lg font-semibold font-serif text-da-text">Open a saved assessment</h2>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-da-muted">
                  Saved assessments
                </span>
                <select
                  value={loadId}
                  onChange={(e) => {
                    setLoadId(e.target.value);
                    setLoadConfirm(false);
                  }}
                  className="rounded-lg border border-da-border bg-da-bg px-3 py-2 text-sm text-da-text"
                >
                  <option value="">Select one…</option>
                  {saved.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} — {s.courseName} — {s.itemCount} parts
                      {s.totalMarks ? `/${s.totalMarks} marks` : ""} — {formatSavedDate(s.createdAt)}
                    </option>
                  ))}
                </select>
              </label>
              {loadConfirm ? (
                <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                  <p className="text-xs text-amber-200">
                    The editor has changes that are not saved. Opening this assessment replaces them.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void handleLoad()}
                      disabled={isLoadingSaved}
                      className="rounded-lg border border-amber-500/50 bg-amber-500/20 px-3 py-2 text-xs font-semibold text-amber-100 transition-colors hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isLoadingSaved ? "Opening…" : "Discard and open"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setLoadConfirm(false)}
                      disabled={isLoadingSaved}
                      className="rounded-lg border border-da-border bg-da-hover px-3 py-2 text-xs font-semibold text-da-text transition-colors hover:border-da-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Keep editing
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleLoad()}
                  disabled={!loadId || isLoadingSaved || isAlreadyOpen(loadId, savedTestId)}
                  className="w-full rounded-lg border border-da-border bg-da-hover px-4 py-2 text-sm font-semibold text-da-text transition-colors hover:border-da-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isLoadingSaved
                    ? "Opening…"
                    : isAlreadyOpen(loadId, savedTestId)
                      ? "Already open"
                      : "Open in the editor"}
                </button>
              )}
            </div>
          )}

          <div className="rounded-xl border border-da-border bg-da-bg/40 p-4 space-y-3">
            <h2 className="text-lg font-semibold font-serif text-da-text">Generate with AI</h2>
            <LabeledInput label="Grade level" value={gradeLevel} onChange={setGradeLevel} />
            <LabeledInput label="Topic" value={topic} onChange={setTopic} />
            <div className="grid grid-cols-2 gap-3">
              <LabeledInput
                label="Target total marks"
                type="number"
                value={String(totalMarksTarget)}
                onChange={(v) => setTotalMarksTarget(Number(v) || 0)}
              />
              <LabeledInput
                label="Number of levels"
                type="number"
                value={String(levelCount)}
                onChange={(v) => setLevelCount(Number(v) || 1)}
              />
            </div>
            <LabeledTextArea label="Additional constraints" value={contextNotes} onChange={setContextNotes} rows={2} />
            <button
              type="button"
              onClick={generateWithAi}
              disabled={isGenerating}
              className="w-full rounded-lg border border-da-accent/70 bg-da-accent/20 px-4 py-2 text-sm font-semibold text-da-text transition-colors hover:bg-da-accent/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isGenerating ? "Generating…" : "Generate With AI"}
            </button>
          </div>

          <div className="rounded-xl border border-da-border bg-da-bg/40 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-da-amber uppercase tracking-wide">Save &amp; Grade</h3>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-da-muted">Course</span>
              <select
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
                className="w-full rounded-md border border-da-border bg-da-bg/40 px-2.5 py-2 text-sm text-da-text focus:border-da-accent/60 focus:outline-none"
              >
                <option value="">Select a course…</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <ToggleField
              label="Require self-assessment before releasing Clev's Marks"
              checked={requireSelfAssessment}
              onChange={setRequireSelfAssessment}
            />
            <button
              type="button"
              onClick={() => handleSave()}
              disabled={isSaving}
              className="w-full rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? "Saving…" : savedTestId ? "Save changes" : "Save as gradeable test"}
            </button>
            {savedTestId && (
              <a
                href={`/dashboard/tests/${savedTestId}/ai-grade`}
                className="block rounded-lg border border-da-border bg-da-hover px-4 py-2 text-center text-sm font-semibold text-da-text transition-colors hover:border-da-accent/60"
              >
                Upload scanned papers to grade →
              </a>
            )}
            {savedTestId && pdfsArchived && (
              // The archived copies, not a fresh render of whatever is in the
              // editor right now. These are what a teacher comes back for
              // months later, so they are the ones worth linking.
              <div className="flex gap-2">
                <a
                  href={`/api/formative-assessments/${savedTestId}/pdf?kind=paper`}
                  className="flex-1 rounded-lg border border-da-border bg-da-hover px-3 py-2 text-center text-xs font-semibold text-da-text transition-colors hover:border-da-accent/60"
                >
                  Archived paper ↓
                </a>
                <a
                  href={`/api/formative-assessments/${savedTestId}/pdf?kind=mark-scheme`}
                  className="flex-1 rounded-lg border border-violet-500/50 bg-violet-500/10 px-3 py-2 text-center text-xs font-semibold text-violet-200 transition-colors hover:bg-violet-500/20"
                >
                  Archived mark scheme ↓
                </a>
              </div>
            )}
            {notice && (
              <p className={`text-xs ${pdfsArchived ? "text-emerald-300" : "text-amber-300"}`}>{notice}</p>
            )}
          </div>

          <div className="rounded-xl border border-da-border bg-da-bg/40 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-da-amber uppercase tracking-wide">Title Page</h3>
            <LabeledInput label="Title" value={draft.title} onChange={(v) => setDraft((d) => ({ ...d, title: v }))} />
            <LabeledInput label="Subtitle" value={draft.subtitle} onChange={(v) => setDraft((d) => ({ ...d, subtitle: v }))} />
            <div className="grid grid-cols-2 gap-3">
              <ToggleField label="Name line" checked={formatting.includeNameLine} onChange={(c) => setFormatting((p) => ({ ...p, includeNameLine: c }))} />
              <ToggleField label="Block line" checked={!!formatting.includeBlockLine} onChange={(c) => setFormatting((p) => ({ ...p, includeBlockLine: c }))} />
              <ToggleField label="Date line" checked={formatting.includeDateLine} onChange={(c) => setFormatting((p) => ({ ...p, includeDateLine: c }))} />
              <ToggleField label="Section score box" checked={!!draft.showSectionScoreSummary} onChange={(c) => setDraft((d) => ({ ...d, showSectionScoreSummary: c }))} />
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => downloadPdf("/api/assignments/generate-pdf", false, setIsExporting, "")}
              disabled={isExporting}
              className="rounded-lg border border-da-border bg-da-hover px-4 py-2 text-sm font-semibold text-da-text transition-colors hover:border-da-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isExporting ? "Generating…" : "Download Student PDF"}
            </button>
            <button
              type="button"
              onClick={() => downloadPdf("/api/assignments/mark-scheme", true, setIsExportingMs, "_mark_scheme")}
              disabled={isExportingMs}
              className="rounded-lg border border-violet-500/50 bg-violet-500/10 px-4 py-2 text-sm font-semibold text-violet-200 transition-colors hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isExportingMs ? "Generating…" : "Download Mark Scheme"}
            </button>
          </div>

          {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}

          {rubricFindings.length > 0 && (
            <div
              className={`space-y-3 rounded-lg border px-3 py-3 ${
                rubricBlocked
                  ? "border-amber-500/50 bg-amber-500/10"
                  : "border-da-border bg-da-surface/60"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-da-text">
                    {rubricBlocked
                      ? "Review the mark scheme before saving"
                      : "Mark scheme notes"}
                  </p>
                  <p className="mt-0.5 text-xs text-da-muted">
                    {rubricBlocked
                      ? "These make the paper hard to mark consistently. Fixing them now is far cheaper than after a class has sat it."
                      : "Not blocking -- worth a look before the class sits it."}
                  </p>
                </div>
                {rubricBlocked && (
                  <button
                    type="button"
                    onClick={() => void handleSave(true)}
                    disabled={isSaving}
                    className="shrink-0 rounded-lg border border-da-border px-3 py-1.5 text-xs font-medium text-da-muted transition-colors hover:bg-da-hover disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSaving ? "Saving…" : "Save anyway"}
                  </button>
                )}
              </div>

              <ul className="space-y-1.5">
                {rubricFindings.map((f, i) => (
                  <li key={`${f.part}-${f.code}-${i}`} className="flex gap-2 text-xs">
                    <span
                      className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${
                        f.severity === "block"
                          ? "bg-amber-500/20 text-amber-200"
                          : "bg-da-hover text-da-muted"
                      }`}
                    >
                      {f.part}
                    </span>
                    <span className="text-da-muted">{f.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* -- Right panel: editable content -- */}
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl border border-da-border bg-da-bg/60 px-4 py-2.5">
            <span className="text-xs text-da-muted">Total marks</span>
            <span className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-sm font-bold tabular-nums text-amber-300">
              [{totalMarks}]
            </span>
          </div>

          {draft.sections.map((section, sIdx) => (
            <div key={sIdx} className="rounded-xl border border-da-border bg-da-bg/30 p-4 space-y-3">
              <div className="flex items-center gap-3">
                <input
                  value={section.heading}
                  onChange={(e) => updateSection(sIdx, (s) => ({ ...s, heading: e.target.value }))}
                  className="flex-1 rounded-md border border-da-border bg-da-bg/40 px-2.5 py-1.5 text-sm font-semibold text-da-text focus:border-da-accent/60 focus:outline-none"
                />
                <input
                  type="number"
                  value={section.estimatedMinutes ?? 0}
                  onChange={(e) => updateSection(sIdx, (s) => ({ ...s, estimatedMinutes: Number(e.target.value) || 0 }))}
                  className="w-20 rounded-md border border-da-border bg-da-bg/40 px-2 py-1.5 text-sm text-da-text focus:border-da-accent/60 focus:outline-none"
                  title="Suggested minutes"
                />
                <span className="text-xs text-da-muted">min · [{sectionMarks(section)}]</span>
                <button
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, sections: d.sections.filter((_, i) => i !== sIdx) }))}
                  className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-400 hover:bg-red-500/20"
                >
                  ✕
                </button>
              </div>

              {section.questions.map((question, qIdx) => (
                <QuestionEditor
                  key={qIdx}
                  question={question}
                  onChange={(updater) => updateQuestion(sIdx, qIdx, updater)}
                  onRemove={() => updateSection(sIdx, (s) => ({ ...s, questions: s.questions.filter((_, i) => i !== qIdx) }))}
                />
              ))}
              <button
                type="button"
                onClick={() => updateSection(sIdx, (s) => ({ ...s, questions: [...s.questions, newQuestion()] }))}
                className="w-full rounded-md border border-dashed border-da-border px-3 py-1.5 text-xs text-da-muted hover:border-da-accent/60 hover:text-da-text"
              >
                + Add question
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setDraft((d) => ({ ...d, sections: [...d.sections, newSection()] }))}
            className="w-full rounded-md border border-dashed border-da-border px-3 py-2 text-sm text-da-muted hover:border-da-accent/60 hover:text-da-text"
          >
            + Add level
          </button>

          <StringListEditor
            title="Marking Principles"
            items={draft.markingPrinciples ?? []}
            onChange={(items) => setDraft((d) => ({ ...d, markingPrinciples: items }))}
          />

          <ReteachGuideEditor
            entries={draft.reteachGuide ?? []}
            onChange={(entries) => setDraft((d) => ({ ...d, reteachGuide: entries }))}
          />
        </div>
      </div>
    </section>
  );
}

// -- Sub-editors ----------------------------------------------------------------------------------

function QuestionEditor({
  question,
  onChange,
  onRemove,
}: {
  question: AssignmentQuestion;
  onChange: (updater: (q: AssignmentQuestion) => AssignmentQuestion) => void;
  onRemove: () => void;
}) {
  const hasSubparts = Array.isArray(question.subparts) && question.subparts.length > 0;

  return (
    <div className="rounded-lg border border-da-border/60 bg-da-bg/20 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <textarea
          value={question.prompt}
          onChange={(e) => onChange((q) => ({ ...q, prompt: e.target.value }))}
          rows={2}
          placeholder="Question prompt"
          className="flex-1 rounded-md border border-da-border bg-da-bg/40 px-2.5 py-1.5 text-sm text-da-text focus:border-da-accent/60 focus:outline-none"
        />
        <button type="button" onClick={onRemove} className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-400 hover:bg-red-500/20">
          ✕
        </button>
      </div>

      {!hasSubparts && (
        <div className="grid grid-cols-[80px_1fr] gap-2">
          <input
            type="number"
            value={question.marks ?? 0}
            onChange={(e) => onChange((q) => ({ ...q, marks: Number(e.target.value) || 0 }))}
            className="rounded-md border border-da-border bg-da-bg/40 px-2 py-1.5 text-sm text-da-text focus:border-da-accent/60 focus:outline-none"
            title="Marks"
          />
          <input
            value={question.answer ?? ""}
            onChange={(e) => onChange((q) => ({ ...q, answer: e.target.value }))}
            placeholder="Answer"
            className="rounded-md border border-da-border bg-da-bg/40 px-2.5 py-1.5 text-sm text-da-text focus:border-da-accent/60 focus:outline-none"
          />
        </div>
      )}
      {!hasSubparts && (
        <textarea
          value={question.markScheme ?? ""}
          onChange={(e) => onChange((q) => ({ ...q, markScheme: e.target.value }))}
          rows={2}
          placeholder="Mark scheme (M/A/R/FT-coded marking notes)"
          className="w-full rounded-md border border-da-border bg-da-bg/40 px-2.5 py-1.5 text-xs text-da-text focus:border-da-accent/60 focus:outline-none"
        />
      )}
      {!hasSubparts && (
        <ToggleField
          label="Requires shown working"
          checked={!!question.requiresWorking}
          onChange={(c) => onChange((q) => ({ ...q, requiresWorking: c }))}
        />
      )}

      {hasSubparts &&
        question.subparts!.map((sp, spIdx) => (
          <div key={spIdx} className="ml-4 space-y-1 border-l-2 border-da-border/40 pl-3">
            <div className="flex items-start gap-2">
              <span className="mt-1.5 text-xs text-da-muted">({String.fromCharCode(97 + spIdx)})</span>
              <textarea
                value={sp.prompt}
                onChange={(e) =>
                  onChange((q) => ({
                    ...q,
                    subparts: q.subparts!.map((s, i) => (i === spIdx ? { ...s, prompt: e.target.value } : s)),
                  }))
                }
                rows={1}
                className="flex-1 rounded-md border border-da-border bg-da-bg/40 px-2.5 py-1.5 text-sm text-da-text focus:border-da-accent/60 focus:outline-none"
              />
              <input
                type="number"
                value={sp.marks ?? 0}
                onChange={(e) =>
                  onChange((q) => ({
                    ...q,
                    subparts: q.subparts!.map((s, i) => (i === spIdx ? { ...s, marks: Number(e.target.value) || 0 } : s)),
                  }))
                }
                className="w-16 rounded-md border border-da-border bg-da-bg/40 px-2 py-1.5 text-sm text-da-text focus:border-da-accent/60 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => onChange((q) => ({ ...q, subparts: q.subparts!.filter((_, i) => i !== spIdx) }))}
                className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-400 hover:bg-red-500/20"
              >
                ✕
              </button>
            </div>
            <textarea
              value={sp.markScheme ?? ""}
              onChange={(e) =>
                onChange((q) => ({
                  ...q,
                  subparts: q.subparts!.map((s, i) => (i === spIdx ? { ...s, markScheme: e.target.value } : s)),
                }))
              }
              rows={1}
              placeholder="Mark scheme"
              className="w-full rounded-md border border-da-border bg-da-bg/40 px-2.5 py-1.5 text-xs text-da-text focus:border-da-accent/60 focus:outline-none"
            />
          </div>
        ))}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() =>
            onChange((q) => ({
              ...q,
              subparts: [...(q.subparts ?? []), { prompt: "", marks: 1, answer: "", markScheme: "" }],
            }))
          }
          className="rounded-md border border-dashed border-da-border px-2 py-1 text-[11px] text-da-muted hover:border-da-accent/60 hover:text-da-text"
        >
          + Add subpart
        </button>
      </div>
    </div>
  );
}

function StringListEditor({
  title,
  items,
  onChange,
}: {
  title: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  return (
    <div className="rounded-xl border border-da-border bg-da-bg/30 p-4 space-y-2">
      <h3 className="text-sm font-semibold text-da-amber uppercase tracking-wide">{title}</h3>
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={item}
            onChange={(e) => onChange(items.map((it, idx) => (idx === i ? e.target.value : it)))}
            className="flex-1 rounded-md border border-da-border bg-da-bg/40 px-2.5 py-1.5 text-sm text-da-text focus:border-da-accent/60 focus:outline-none"
          />
          <button type="button" onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-400 hover:bg-red-500/20">
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, ""])}
        className="w-full rounded-md border border-dashed border-da-border px-3 py-1.5 text-xs text-da-muted hover:border-da-accent/60 hover:text-da-text"
      >
        + Add
      </button>
    </div>
  );
}

function ReteachGuideEditor({
  entries,
  onChange,
}: {
  entries: ReteachGuideEntry[];
  onChange: (entries: ReteachGuideEntry[]) => void;
}) {
  return (
    <div className="rounded-xl border border-da-border bg-da-bg/30 p-4 space-y-2">
      <h3 className="text-sm font-semibold text-da-amber uppercase tracking-wide">Reteach Guide</h3>
      {entries.map((entry, i) => (
        <div key={i} className="grid grid-cols-[96px_1fr_auto] gap-2">
          <input value={entry.questions} onChange={(e) => onChange(entries.map((it, idx) => (idx === i ? { ...it, questions: e.target.value } : it)))} placeholder="Q1, Q2"
            className="rounded-md border border-da-border bg-da-bg/40 px-2 py-1.5 text-xs text-da-text focus:border-da-accent/60 focus:outline-none" />
          <input value={entry.topic} onChange={(e) => onChange(entries.map((it, idx) => (idx === i ? { ...it, topic: e.target.value } : it)))} placeholder="What to reteach"
            className="rounded-md border border-da-border bg-da-bg/40 px-2.5 py-1.5 text-xs text-da-text focus:border-da-accent/60 focus:outline-none" />
          <button type="button" onClick={() => onChange(entries.filter((_, idx) => idx !== i))} className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-400 hover:bg-red-500/20">✕</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...entries, { questions: "", topic: "" }])}
        className="w-full rounded-md border border-dashed border-da-border px-3 py-1.5 text-xs text-da-muted hover:border-da-accent/60 hover:text-da-text">
        + Add row
      </button>
    </div>
  );
}

// -- Small reusable UI atoms (mirrors generic-pdf-sandbox.tsx's) ----------------------------------

function LabeledInput({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-da-muted">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-da-border bg-da-bg/40 px-2.5 py-2 text-sm text-da-text focus:border-da-accent/60 focus:outline-none" />
    </label>
  );
}

function LabeledTextArea({ label, value, onChange, rows }: { label: string; value: string; onChange: (v: string) => void; rows: number }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-da-muted">{label}</span>
      <textarea value={value} rows={rows} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-da-border bg-da-bg/40 px-2.5 py-2 text-sm text-da-text focus:border-da-accent/60 focus:outline-none" />
    </label>
  );
}

function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (c: boolean) => void }) {
  return (
    <label className="flex items-center justify-between rounded-md border border-da-border bg-da-bg/30 px-2.5 py-2 text-sm">
      <span className="text-da-text/90">{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-amber-500" />
    </label>
  );
}
