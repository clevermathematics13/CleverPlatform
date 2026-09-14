"use client";

/**
 * FormativeAssessmentSandbox
 * --------------------------
 * Creator for a standalone assessment, FORMATIVE OR SUMMATIVE: a fixed-format
 * test with LEVEL bands, numbered questions/subparts each carrying a printed
 * mark value and a free-text M/A/R/FT mark scheme, plus paper-wide marking
 * principles and a reteach guide.
 *
 * The kind is one control at the top, and everything that follows from it is
 * in lib/assessment-kind.ts: exam conditions printed on both PDFs, hints
 * stripped, a boundary set required, self-assessment forced on, and every
 * below-high-confidence AI grade held for the teacher. Authoring a summative
 * is otherwise the same job as authoring a formative, deliberately -- the
 * teacher who has written one already knows how to write the other.
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

import { useEffect, useMemo, useState } from "react";
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
  ASSESSMENT_KINDS,
  allowedCourses,
  applyKindFormatting,
  applyKindRules,
  countHints,
  resolveRequireSelfAssessment,
  retargetCalculatorPolicy,
  type AssessmentKind,
} from "@/lib/assessment-kind";
import { CALCULATOR_POLICY_OPTIONS, marksLabel } from "@/lib/exam-conditions";
import {
  SOURCE_KIND_LABELS,
  SOURCE_TEXT_TOTAL,
  type SourceMaterialSummary,
} from "@/lib/source-materials";
import {
  editorSnapshot,
  needsDiscardConfirmation,
  loadButtonState,
} from "./load-saved-assessment";
import { formatSavedDate } from "./format-date";
import type { RubricFinding } from "@/lib/rubric-validator";
import { createClient } from "@/lib/supabase/client";

type CourseOption = { id: string; name: string };
type BoundarySetOption = { id: string; name: string };
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
  assessmentKind: AssessmentKind;
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


/**
 * Everything this grade has been taught, as the picker lists it.
 *
 * Null on failure for the same reason the saved list is: the picker is a way to
 * make a better paper, not the way to make one, and a failed fetch must not put
 * an error banner over a creator that still works.
 */
async function fetchSourceMaterials(
  grade: string,
): Promise<{ materials: SourceMaterialSummary[]; warnings: string[] } | null> {
  try {
    const res = await fetch(`/api/source-materials?grade=${encodeURIComponent(grade)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { materials?: SourceMaterialSummary[]; warnings?: string[] };
    return { materials: data.materials ?? [], warnings: data.warnings ?? [] };
  } catch {
    return null;
  }
}

// Moved to lib/formative-assessment-pdf-body.ts when the save route started
// rendering these PDFs server-side: both sides must format a paper identically,
// or the archived copy is not the one the teacher previewed.
const DEFAULT_FORMATTING: FormattingRequirements = DEFAULT_ASSESSMENT_FORMATTING;

/**
 * The starting title for each kind, and the set this component is allowed to
 * overwrite when the kind changes. A title the teacher has typed is theirs; a
 * default left untouched is just the wrong word on the cover, and "Formative
 * Assessment 1" printed on a paper that counts is the kind of thing nobody
 * notices until it is photocopied.
 */
const DEFAULT_TITLES: Record<AssessmentKind, string> = {
  formative: "Formative Assessment 1",
  summative: "Summative Assessment 1",
};

const DEFAULT_DRAFT: AssignmentDraft = {
  title: DEFAULT_TITLES.formative,
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
  const [kind, setKind] = useState<AssessmentKind>("formative");
  const [boundarySets, setBoundarySets] = useState<BoundarySetOption[]>([]);
  const [boundarySetId, setBoundarySetId] = useState("");
  const [materials, setMaterials] = useState<SourceMaterialSummary[]>([]);
  /**
   * Origins the catalogue could not read. Shown rather than swallowed: an
   * empty list reads as "you have not uploaded anything", which is the wrong
   * thing to believe when the truth is that the query failed.
   */
  const [materialWarnings, setMaterialWarnings] = useState<string[]>([]);
  const [materialsFailed, setMaterialsFailed] = useState(false);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
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
   *
   * State rather than a ref: the open button's label depends on it, so saving
   * or loading has to re-render.
   */
  const [cleanSnapshot, setCleanSnapshot] = useState(
    editorSnapshot(DEFAULT_DRAFT, DEFAULT_FORMATTING, "formative"),
  );
  const currentSnapshot = useMemo(
    () => editorSnapshot(draft, formatting, kind),
    [draft, formatting, kind],
  );
  const hasUnsavedWork = currentSnapshot !== cleanSnapshot;
  const openButton = loadButtonState({
    loadId,
    savedTestId,
    hasUnsavedWork,
    isLoading: isLoadingSaved,
  });

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

  // Same shape again. A summative needs one of these or its mark reports as a
  // raw score with an approximate band rather than a grade; Grade 9 has its
  // own set, separate from the DP progression sets.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const { data } = await supabase.from("grade_boundary_sets").select("id, name").order("name");
      if (!cancelled && data) setBoundarySets(data as BoundarySetOption[]);
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

  // Re-fetched when the grade changes, because the catalogue is filtered by it.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await fetchSourceMaterials(gradeLevel);
      if (cancelled) return;
      if (!result) {
        setMaterialsFailed(true);
        return;
      }
      setMaterials(result.materials);
      setMaterialWarnings(result.warnings);
      setMaterialsFailed(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [gradeLevel]);

  // Narrowed to the classes these papers are for, plus whatever a loaded
  // assessment is already saved against -- see allowedCourses.
  const offeredCourses = useMemo(
    () => allowedCourses(courses, savedTestId ? courseId || null : null),
    [courses, courseId, savedTestId],
  );
  const courseName = useMemo(
    () => courses.find((c) => c.id === courseId)?.name ?? "",
    [courses, courseId],
  );

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

  /**
   * Switch between formative and summative.
   *
   * Does everything the switch implies rather than only setting a flag: the
   * cover conditions go on or come off, the hints go (a summative prints
   * whatever it is handed), self-assessment is forced on, and a title still
   * sitting at the other kind's default is renamed. A control that changes one
   * thing and leaves five others to be remembered is a control that gets a
   * formative saved as a summative.
   */
  function changeKind(next: AssessmentKind) {
    if (next === kind) return;
    setKind(next);
    setFormatting((f) => applyKindFormatting(next, f, { gradeLevel, courseName }));
    setRequireSelfAssessment((current) => resolveRequireSelfAssessment(next, current));
    setDraft((d) => {
      const stripped = applyKindRules(next, d);
      const other: AssessmentKind = next === "summative" ? "formative" : "summative";
      return d.title.trim() === DEFAULT_TITLES[other]
        ? { ...stripped, title: DEFAULT_TITLES[next] }
        : stripped;
    });
    setNotice(
      next === "summative"
        ? "Switched to summative. Exam conditions now print on the paper and the mark scheme, hints are removed, " +
            "self-assessment is required, and a grade boundary set has to be chosen before you can save. " +
            "Check the calculator policy -- it starts at this grade's own rule."
        : "Switched to formative. The exam conditions have been cleared from the cover.",
    );
  }

  const hintsOnPaper = useMemo(() => countHints(draft), [draft]);

  /**
   * Change the grade this paper is for, and with it the calculator rule.
   *
   * Wrapped rather than a bare setState because the rule is derived from the
   * grade: a Grade 9 paper starts permitting a graphing calculator, and
   * correcting the grade after switching to summative has to move it. What the
   * teacher chose themselves is left alone -- retargetCalculatorPolicy decides.
   */
  function changeGradeContext(next: { gradeLevel?: string; courseId?: string }) {
    const prev = { gradeLevel, courseName };
    const nextGrade = next.gradeLevel ?? gradeLevel;
    const nextCourseName =
      next.courseId !== undefined
        ? courses.find((c) => c.id === next.courseId)?.name ?? ""
        : courseName;

    if (next.gradeLevel !== undefined) setGradeLevel(next.gradeLevel);
    if (next.courseId !== undefined) setCourseId(next.courseId);

    setFormatting((f) => ({
      ...f,
      calculatorPolicy: retargetCalculatorPolicy(f.calculatorPolicy, prev, {
        gradeLevel: nextGrade,
        courseName: nextCourseName,
      }),
    }));
  }

  const selectedSources = useMemo(
    () => materials.filter((m) => selectedSourceIds.includes(m.id)),
    [materials, selectedSourceIds],
  );
  const selectedChars = selectedSources.reduce((sum, m) => sum + m.approxChars, 0);

  function toggleSource(id: string) {
    setSelectedSourceIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  }

  /**
   * Add a file to the catalogue.
   *
   * Tagged with the grade on screen, which is what the catalogue filters on --
   * upload a Grade 9 study guide while the grade says Grade 9 and it is there
   * the next time this tab opens.
   */
  async function uploadSourceMaterial(file: File) {
    setIsUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("gradeLevel", gradeLevel);
      if (courseId) form.append("courseId", courseId);

      const res = await fetch("/api/source-materials", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        material?: { id: string; title: string; pageCount: number | null; usable: boolean };
      };
      if (!res.ok || !data.material) throw new Error(data.error ?? `Upload failed (${res.status})`);

      const refreshed = await fetchSourceMaterials(gradeLevel);
      if (refreshed) {
        setMaterials(refreshed.materials);
        setMaterialWarnings(refreshed.warnings);
      }
      // Selected on arrival: uploading it is the act of choosing it.
      setSelectedSourceIds((prev) => [...prev, data.material!.id]);
      setNotice(
        data.material.usable
          ? `Added "${data.material.title}" and selected it.`
          : `Added "${data.material.title}", but no text could be read out of it -- it will not reach the ` +
              "generator. A scan with no text layer usually needs OCR first.",
      );
    } catch (err) {
      setError(`Upload failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setIsUploading(false);
    }
  }

  async function generateWithAi() {
    setIsGenerating(true);
    setError(null);
    try {
      // The chosen material's text, resolved now rather than held in the page.
      // Empty string when nothing is selected, so the prompt is unchanged from
      // what it was before any of this existed.
      let sourcePrompt = "";
      if (selectedSourceIds.length > 0) {
        const res = await fetch("/api/source-materials/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: selectedSourceIds }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          prompt?: string;
          truncated?: string[];
          dropped?: string[];
        };
        if (!res.ok) throw new Error(data.error ?? `Could not read the source material (${res.status})`);
        sourcePrompt = data.prompt ?? "";
        // Said out loud: a paper built from half a study guide, silently, is
        // one whose gaps look like the model's judgement.
        const cut = [
          ...(data.truncated ?? []).map((t) => `${t} (shortened)`),
          ...(data.dropped ?? []).map((t) => `${t} (not used)`),
        ];
        if (cut.length > 0) {
          setNotice(`Source material over the prompt limit: ${cut.join(", ")}.`);
        }
      }

      const response = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: buildFormativeAssessmentSystemPrompt(kind),
          messages: [
            {
              role: "user",
              content:
                buildFormativeAssessmentUserPrompt({
                  gradeLevel,
                  topic,
                  totalMarks: totalMarksTarget,
                  levelCount,
                  contextNotes: contextNotes || undefined,
                  kind,
                }) + sourcePrompt,
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
      // applyKindRules on the way out of the model as well as on the way into
      // the save: rule S1 tells it not to write hints on a summative, and this
      // is what makes that true rather than likely.
      setDraft(applyKindRules(kind, sanitizeDraft(parsed)));
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
        current: currentSnapshot,
        clean: cleanSnapshot,
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
        assessmentKind?: AssessmentKind;
        boundarySetId?: string | null;
        pdfsArchived?: boolean;
      };
      if (!res.ok || !data.draft) throw new Error(data.error ?? `Load failed (${res.status})`);

      const loadedKind: AssessmentKind = data.assessmentKind === "summative" ? "summative" : "formative";
      setDraft(data.draft);
      if (data.formatting) setFormatting(data.formatting);
      setCourseId(data.courseId ?? "");
      setRequireSelfAssessment(data.requireSelfAssessment !== false);
      setKind(loadedKind);
      setBoundarySetId(data.boundarySetId ?? "");
      setSavedTestId(loadId);
      setPdfsArchived(Boolean(data.pdfsArchived));
      // Findings belong to the draft that produced them; carrying them over
      // would pin another paper's defects to this one.
      setRubricFindings([]);
      setRubricBlocked(false);
      setLoadConfirm(false);
      setCleanSnapshot(
        editorSnapshot(data.draft, data.formatting ?? DEFAULT_FORMATTING, loadedKind),
      );
      const what = loadedKind === "summative" ? "summative" : "formative";
      setNotice(
        data.formattingSource === "default"
          ? `Loaded "${data.name ?? "assessment"}" (${what}). It was saved before layout settings were kept, so those are back to the defaults -- check them before exporting.`
          : `Loaded "${data.name ?? "assessment"}" (${what}). Saving writes back to this same test.`,
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
    // Checked here as well as in the route. The route is the guarantee; this
    // is so the teacher finds out before a save that renders two PDFs.
    if (kind === "summative" && !boundarySetId) {
      setError(
        "Choose a grade boundary set before saving a summative -- without one the mark reports as a raw " +
          "score with an approximate band instead of a grade.",
      );
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
          assessmentKind: kind,
          ...(boundarySetId ? { boundarySetId } : {}),
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
        hintsRemoved?: number;
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
      // The route strips hints from a summative before storing it, so the
      // editor has to follow -- and the clean snapshot has to be taken from
      // the STRIPPED draft, or the editor is permanently one hint away from
      // what was saved and never stops warning about unsaved work.
      const storedDraft = (data.hintsRemoved ?? 0) > 0 ? applyKindRules(kind, draft) : draft;
      if (storedDraft !== draft) setDraft(storedDraft);
      setSavedTestId(data.test?.id ?? null);
      setPdfsArchived(data.pdfs === "archived");
      // This is now the saved state, so loading something else no longer has
      // unsaved work to warn about. Refresh the picker too: a first save adds
      // a row to it, and a re-save moves this one's totals.
      setCleanSnapshot(editorSnapshot(storedDraft, formatting, kind));
      if (data.test?.id) setLoadId(data.test.id);
      void fetchSavedAssessments().then((list) => {
        if (list) setSaved(list);
      });
      const warnings = data.rubric?.summary.warnings ?? 0;
      const saved =
        data.testItems === "synced"
          ? "Saved -- ready to grade scanned student papers."
          : "Saved, but syncing gradeable items failed -- try saving again.";
      // Said out loud rather than done quietly: a hint the teacher wrote and
      // then did not see on the paper is a change they are entitled to know
      // about, even though it is the right change.
      const stripped =
        (data.hintsRemoved ?? 0) > 0
          ? ` ${data.hintsRemoved} hint(s) were removed -- a summative does not print them.`
          : "";
      // A failed archive is called out rather than folded into the notice: the
      // whole point of archiving on save is that nobody has to remember, so a
      // save that did not archive must not read as a clean success.
      const archive =
        data.pdfs === "archived"
          ? " Student paper and mark scheme archived."
          : ` The PDFs were NOT archived (${data.pdfsError ?? "unknown error"}) -- save again to retry, or download them below and keep a copy.`;
      setNotice(
        warnings > 0
          ? `${saved}${archive}${stripped} ${warnings} mark scheme warning(s) below -- worth a look before the class sits it.`
          : `${saved}${archive}${stripped}`,
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
          {/* First control on the page. Everything below it -- what the model
              is asked for, what prints on the cover, what a batch accept is
              allowed to write -- depends on the answer, so it is not something
              to find after writing the paper. */}
          <div className="rounded-xl border border-da-border bg-da-bg/40 p-4 space-y-3">
            <h2 className="text-lg font-semibold font-serif text-da-text">What is this?</h2>
            <div className="grid grid-cols-2 gap-2">
              {ASSESSMENT_KINDS.map((option) => {
                const active = kind === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => changeKind(option.value)}
                    aria-pressed={active}
                    className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                      active
                        ? "border-da-accent/70 bg-da-accent/20 text-da-text"
                        : "border-da-border bg-da-hover text-da-muted hover:border-da-accent/60"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-da-muted">
              {ASSESSMENT_KINDS.find((o) => o.value === kind)?.blurb}
            </p>
          </div>

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
                      {s.assessmentKind === "summative" ? "[Summative] " : ""}
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
                  disabled={openButton.disabled}
                  className="w-full rounded-lg border border-da-border bg-da-hover px-4 py-2 text-sm font-semibold text-da-text transition-colors hover:border-da-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {openButton.label}
                </button>
              )}
            </div>
          )}

          {/* Above "Generate with AI" because it is an input to it: what the
              class was taught decides what the paper can fairly ask. */}
          <div className="rounded-xl border border-da-border bg-da-bg/40 p-4 space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold font-serif text-da-text">Source material</h2>
              <span className="text-xs text-da-muted">
                {selectedSourceIds.length > 0
                  ? `${selectedSourceIds.length} selected`
                  : `${materials.length} for ${gradeLevel}`}
              </span>
            </div>
            <p className="text-xs text-da-muted">
              Tick what this paper should be built from. Questions are written from the wording,
              notation and worked examples in what you choose.
            </p>

            {(materialsFailed || materialWarnings.length > 0) && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-200">
                {materialsFailed
                  ? "The catalogue could not be loaded, so this list is empty for a reason that is not you. Reload the page."
                  : materialWarnings.join(" ")}
              </p>
            )}

            {materials.length === 0 ? (
              <p className="text-xs text-da-muted">
                {materialsFailed
                  ? "Nothing to show while the catalogue is unavailable."
                  : `Nothing catalogued for ${gradeLevel} yet. Add a file below.`}
              </p>
            ) : (
              <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                {materials.map((m) => {
                  const checked = selectedSourceIds.includes(m.id);
                  return (
                    <label
                      key={m.id}
                      className={`flex cursor-pointer gap-2.5 rounded-md border px-2.5 py-2 text-sm transition-colors ${
                        checked
                          ? "border-da-accent/60 bg-da-accent/10"
                          : "border-da-border bg-da-bg/30 hover:border-da-accent/40"
                      } ${m.usable ? "" : "opacity-60"}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!m.usable}
                        onChange={() => toggleSource(m.id)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-amber-500 disabled:cursor-not-allowed"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-da-text/90">{m.title}</span>
                        <span className="block text-[11px] text-da-muted">
                          {SOURCE_KIND_LABELS[m.kind]}
                          {m.courseName ? ` - ${m.courseName}` : ""} - {m.detail}
                        </span>
                      </span>
                      {m.downloadPath && (
                        <a
                          href={m.downloadPath}
                          onClick={(e) => e.stopPropagation()}
                          className="shrink-0 self-center text-[11px] text-da-muted underline hover:text-da-text"
                        >
                          open
                        </a>
                      )}
                    </label>
                  );
                })}
              </div>
            )}

            {selectedChars > 0 && (
              <p
                className={`text-[11px] ${
                  selectedChars > SOURCE_TEXT_TOTAL ? "text-amber-300" : "text-da-muted"
                }`}
              >
                About {Math.round(selectedChars / 1000)}k characters selected
                {selectedChars > SOURCE_TEXT_TOTAL
                  ? ` -- past the ${Math.round(SOURCE_TEXT_TOTAL / 1000)}k ceiling, so the later ones will be shortened or skipped.`
                  : ", comfortably inside what the model reads in one pass."}
              </p>
            )}

            <label className="block space-y-1">
              <span className="text-xs font-medium text-da-muted">Add a file</span>
              <input
                type="file"
                accept="application/pdf,text/plain,text/markdown"
                disabled={isUploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadSourceMaterial(file);
                  e.target.value = "";
                }}
                className="w-full rounded-md border border-da-border bg-da-bg/40 px-2.5 py-2 text-xs text-da-text file:mr-2 file:rounded file:border-0 file:bg-da-hover file:px-2 file:py-1 file:text-xs file:text-da-text disabled:cursor-not-allowed disabled:opacity-60"
              />
              <span className="block text-[11px] text-da-muted">
                {isUploading
                  ? "Reading the file…"
                  : `Saved against ${gradeLevel}. PDFs are read for their text; a scan with no text layer cannot be used.`}
              </span>
            </label>
          </div>

          <div className="rounded-xl border border-da-border bg-da-bg/40 p-4 space-y-3">
            <h2 className="text-lg font-semibold font-serif text-da-text">Generate with AI</h2>
            <LabeledInput
              label="Grade level"
              value={gradeLevel}
              onChange={(v) => changeGradeContext({ gradeLevel: v })}
            />
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
              {isGenerating
                ? "Generating…"
                : selectedSourceIds.length > 0
                  ? `Generate From ${selectedSourceIds.length} Source${selectedSourceIds.length === 1 ? "" : "s"}`
                  : "Generate With AI"}
            </button>
          </div>

          <div className="rounded-xl border border-da-border bg-da-bg/40 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-da-amber uppercase tracking-wide">Save &amp; Grade</h3>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-da-muted">Course</span>
              <select
                value={courseId}
                onChange={(e) => changeGradeContext({ courseId: e.target.value })}
                className="w-full rounded-md border border-da-border bg-da-bg/40 px-2.5 py-2 text-sm text-da-text focus:border-da-accent/60 focus:outline-none"
              >
                <option value="">Select a course…</option>
                {offeredCourses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            {kind === "summative" && (
              <label className="block space-y-1">
                <span className="text-xs font-medium text-da-muted">Grade boundary set</span>
                <select
                  value={boundarySetId}
                  onChange={(e) => setBoundarySetId(e.target.value)}
                  className="w-full rounded-md border border-da-border bg-da-bg/40 px-2.5 py-2 text-sm text-da-text focus:border-da-accent/60 focus:outline-none"
                >
                  <option value="">Select a boundary set…</option>
                  {boundarySets.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <span className="block text-[11px] text-da-muted">
                  Grade 9 has its own set. Without one the mark reports as a raw score with an
                  approximate band, not a grade.
                </span>
              </label>
            )}
            <ToggleField
              label="Require self-assessment before releasing Clev's Marks"
              checked={requireSelfAssessment}
              onChange={setRequireSelfAssessment}
              disabled={kind === "summative"}
            />
            {kind === "summative" && (
              <p className="text-[11px] text-da-muted">
                Required on a summative, and not a choice: students judge their own work before they
                see the marks you approved.
              </p>
            )}
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

          {kind === "summative" && (
            // Prints on the paper AND on the mark scheme, from one place --
            // see lib/exam-conditions.ts. The marker needs the calculator rule
            // as much as the student does.
            <div className="rounded-xl border border-da-border bg-da-bg/40 p-4 space-y-3">
              <h3 className="text-sm font-semibold text-da-amber uppercase tracking-wide">
                Exam Conditions
              </h3>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-da-muted">Calculator policy</span>
                <select
                  value={formatting.calculatorPolicy ?? "not-permitted"}
                  onChange={(e) =>
                    setFormatting((f) => ({
                      ...f,
                      calculatorPolicy: e.target.value as NonNullable<
                        FormattingRequirements["calculatorPolicy"]
                      >,
                    }))
                  }
                  className="w-full rounded-md border border-da-border bg-da-bg/40 px-2.5 py-2 text-sm text-da-text focus:border-da-accent/60 focus:outline-none"
                >
                  {CALCULATOR_POLICY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <LabeledInput
                  label="Time allowed (min)"
                  type="number"
                  value={String(formatting.timeAllowedMinutes ?? "")}
                  onChange={(v) =>
                    setFormatting((f) => ({
                      ...f,
                      timeAllowedMinutes: Number(v) > 0 ? Number(v) : undefined,
                    }))
                  }
                />
                <ToggleField
                  label="Print total marks"
                  checked={formatting.showTotalMarks !== false}
                  onChange={(c) => setFormatting((f) => ({ ...f, showTotalMarks: c }))}
                />
              </div>
              <LabeledTextArea
                label="Academic honesty line"
                value={formatting.academicHonestyLine ?? ""}
                onChange={(v) => setFormatting((f) => ({ ...f, academicHonestyLine: v }))}
                rows={3}
              />
              <p className="text-[11px] text-da-muted">
                Printed on the student paper and on the mark scheme. The total is{" "}
                {marksLabel(totalMarks)}, counted from the questions below.
              </p>
              {hintsOnPaper > 0 && (
                <p className="text-[11px] text-amber-300">
                  {hintsOnPaper} hint(s) are still on this draft and will be removed when it is
                  saved -- a summative does not print them.
                </p>
              )}
            </div>
          )}

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

function ToggleField({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (c: boolean) => void;
  /** Shown as on and not editable -- for a setting the kind of paper decides. */
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-center justify-between rounded-md border border-da-border bg-da-bg/30 px-2.5 py-2 text-sm ${
        disabled ? "opacity-70" : ""
      }`}
    >
      <span className="text-da-text/90">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-amber-500 disabled:cursor-not-allowed"
      />
    </label>
  );
}
