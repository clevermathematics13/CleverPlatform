"use client";

/**
 * NuancedAnalysisSandbox
 * ----------------------
 * Full sandbox for creating, editing, and exporting Nuanced Analysis packets.
 *
 * Features:
 *   - Grade + course + section selection (was hardcoded to Grade 12)
 *   - Continuity-aware generation: prior packets in the selected course are
 *     loaded and prepended to the generator's system prompt
 *   - AI-powered activity generator (ActivityGeneratorPanel)
 *   - Live NuancedAnalysisPreview with in-place editing
 *   - "Download PDF (Typst)" via DocumentOrchestratorService
 *   - "Save as Nuanced Analysis": writes the packet to public.nuanced_analyses
 *     and commits its continuity digest, after teacher confirmation
 *
 * On the two save paths
 * ---------------------
 * The generator panel's own "Save template" button still writes to
 * assignment_templates. That is a draft store and stays as-is — it is how a
 * work-in-progress is parked. Saving as a Nuanced Analysis is a different act:
 * it declares the packet taught, records what it covered, and makes the next
 * packet's generation depend on it. Only the second one touches continuity.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AssignmentDraft, FormattingRequirements } from "@/lib/assignments";
import {
  draftDigestFromDraft,
  diffVocabularyAgainstContinuity,
  collectCandidateVocabulary,
  type PacketDigest,
  type UnitSequenceEntry,
  type VocabularyCandidate,
} from "@/lib/na-continuity";
import { createClient } from "@/lib/supabase/client";
import { NuancedAnalysisPreview } from "./nuanced-analysis-preview";
import { ActivityGeneratorPanel } from "./activity-generator";
import { EditTemplateModal } from "./edit-template-modal";
import { ContinuityDigestModal } from "./continuity-digest-modal";
import { DocumentOrchestratorService } from "@/lib/document-orchestrator-nuanced";

type GradeLevel = "Grade 9" | "Grade 10" | "Grade 11" | "Grade 12";

const GRADE_LEVELS: GradeLevel[] = ["Grade 9", "Grade 10", "Grade 11", "Grade 12"];

type CourseOption = { id: string; name: string };

type ContinuityState = {
  hasContinuity: boolean;
  packetCount: number;
  unitSequence: UnitSequenceEntry[];
  /** Full prior-packet digests, needed to diff this packet's candidate
   *  vocabulary against what has already been introduced in the course. */
  packets: PacketDigest[];
  nextSection: string | null;
  context: string;
};

// ---- Default formatting ----

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

// ---- Minimal default draft (shown before first generation) ----
//
// WHY THIS IS FULLY WORKED RATHER THAN A TEMPLATE SKELETON: every question
// here once read like "Write down the key result or definition from the
// prerequisite topic that this analysis builds on" - a placeholder wearing
// the costume of a question. It names no topic, no result, no numbers, so a
// student cannot answer it and a teacher previewing the tool sees a broken
// example of the format. Worse, it repeatedly got mistaken for AI output
// during debugging (it is not - it never leaves this file), sending several
// rounds of prompt fixes after the wrong target.
//
// The rule this file must hold to is the same one the generator's own
// system prompt enforces (see DESIGN RULE 0, SELF-CONTAINMENT, in
// platform/lib/assignments.ts): a student reading ONLY this page must be
// able to answer every question with no outside knowledge. Nothing here may
// refer to "the prerequisite topic", "that result", "the key relationship",
// or "your conjecture" unless this same page has already stated it
// concretely. If this default is ever edited, keep it a real, answerable
// mini-packet - named function, real numbers, explicitly stated conjecture.
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
      prerequisiteBox: {
        items: [
          "Laws of logarithms: log(ab) = log a + log b",
          "Evaluating logarithms with a given base",
        ],
      },
      questions: [
        {
          prompt: "★ Write down the value of $log_2 8$.",
          marks: 1,
          tier: 1,
        },
        {
          prompt:
            "★ Given that $log_10 2 approx 0.301$ and $log_10 3 approx 0.477$, find $log_10 6$ without using a calculator.",
          marks: 2,
          tier: 1,
        },
        {
          prompt:
            "★ State the law of logarithms that allows $log a + log b$ to be written as a single logarithm.",
          marks: 1,
          tier: 1,
        },
      ],
    },
    {
      heading: "Part 1 — Conjecture",
      prerequisiteBox: {
        items: ["The law $log(a b) = log a + log b$ from Part 0, Q3"],
      },
      questions: [
        {
          prompt:
            "★ Evaluate $log_2 4 + log_2 8$ and $log_2 32$. Write down what you notice about the two answers.",
          marks: 3,
          tier: 1,
        },
        {
          prompt:
            "★★ A student conjectures that $log_b x + log_b y = log_b (x y)$ for all positive $x$ and $y$. Show that this conjecture is true, using the definition $log_b x = m$ means $b^m = x$. Show every logical step.",
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

// ---- Download helpers ----

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

// ---- NuancedAnalysisSandbox ----

export function NuancedAnalysisSandbox() {
  const [draft, setDraft] = useState<AssignmentDraft>(DEFAULT_DRAFT);
  const [formatting, setFormatting] = useState<FormattingRequirements>(DEFAULT_FORMATTING);
  const [globalAnswerLines, setGlobalAnswerLines] = useState(5);
  const [includeTeacherCompanion, setIncludeTeacherCompanion] = useState(false);
  const [pdfStatus, setPdfStatus] = useState<PdfStatus>("idle");
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);

  // ---- Course / grade / section targeting ----
  const [gradeLevel, setGradeLevel] = useState<GradeLevel>("Grade 12");
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [courseId, setCourseId] = useState<string>("");
  const [sectionCode, setSectionCode] = useState<string>("");
  const [continuity, setContinuity] = useState<ContinuityState | null>(null);
  const [continuityLoading, setContinuityLoading] = useState(false);

  // ---- Save-as-Nuanced-Analysis flow ----
  const [digestModalOpen, setDigestModalOpen] = useState(false);
  const [pendingDigest, setPendingDigest] = useState<PacketDigest | null>(null);
  const [pendingVocabCandidates, setPendingVocabCandidates] = useState<VocabularyCandidate[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  // Course list. Read directly through the browser Supabase client, consistent
  // with the other dashboard clients — RLS already scopes this to the teacher.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const { data } = await supabase.from("courses").select("id, name").order("name");
      if (!cancelled && data) setCourses(data as CourseOption[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Continuity for the selected course. Refetched when the course changes so
  // the generator never runs against a stale picture of what has been taught.
  useEffect(() => {
    if (!courseId) {
      setContinuity(null);
      return;
    }
    let cancelled = false;
    setContinuityLoading(true);
    void (async () => {
      try {
        const res = await fetch(
          `/api/nuanced-analyses/continuity?courseId=${encodeURIComponent(courseId)}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as ContinuityState;
        if (cancelled) return;
        setContinuity(data);
        // Default the section to the first one not yet marked done.
        if (data.nextSection) setSectionCode((s) => s || data.nextSection!);
      } catch {
        if (!cancelled) setContinuity(null);
      } finally {
        if (!cancelled) setContinuityLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  // The continuity block passed to the generator is rebuilt per target section,
  // because a section-specific note (e.g. "this section's prep already shipped")
  // only applies to the section actually being generated.
  const [sectionContext, setSectionContext] = useState<string>("");
  useEffect(() => {
    if (!courseId || !sectionCode) {
      setSectionContext(continuity?.context ?? "");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/nuanced-analyses/continuity?courseId=${encodeURIComponent(courseId)}&section=${encodeURIComponent(sectionCode)}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as ContinuityState;
        if (!cancelled) setSectionContext(data.context);
      } catch {
        /* fall back to the unscoped context already in state */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId, sectionCode, continuity]);

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

  function openDigestModal() {
    setSaveError(null);
    setSaveNotice(null);
    const priorPackets = continuity?.packets ?? [];
    setPendingDigest(draftDigestFromDraft(draft, { section: sectionCode }, priorPackets));
    setPendingVocabCandidates(
      diffVocabularyAgainstContinuity(collectCandidateVocabulary(draft), priorPackets),
    );
    setDigestModalOpen(true);
  }

  async function handleConfirmSave(digest: PacketDigest) {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/nuanced-analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId,
          gradeLevel,
          sectionCode,
          draft,
          digest,
          commitContinuity: true,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        continuity?: string;
        continuityError?: string;
      };

      if (!res.ok && res.status !== 207) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      setDigestModalOpen(false);

      // 207: packet saved, continuity write failed. Say so plainly rather than
      // reporting a clean success — the teacher needs to know the next packet
      // will not see this one.
      if (data.continuity === "failed") {
        setSaveNotice(
          `Packet saved, but the continuity record was not updated (${data.continuityError ?? "unknown error"}). The next packet will not know about this one until it is retried.`,
        );
      } else {
        setSaveNotice(`Saved ${sectionCode} and updated continuity.`);
      }

      // Refresh continuity so the section picker advances.
      const refreshed = await fetch(
        `/api/nuanced-analyses/continuity?courseId=${encodeURIComponent(courseId)}`,
      );
      if (refreshed.ok) setContinuity((await refreshed.json()) as ContinuityState);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  // A specific reason string, not just a boolean, so the toolbar can show
  // the teacher exactly what's blocking Save instead of a silently disabled
  // button whose only explanation was a hover-only title attribute (easy to
  // miss entirely, and unreachable on touch devices). Empty string = ready.
  //
  // The required section-code FORMAT is grade-dependent, mirroring
  // app/api/nuanced-analyses/route.ts's sectionRegexFor exactly: Grade 9/10
  // keeps the MYP rolling-bundle format ("A.1", "B.4"); Grade 11/12 (IBDP)
  // uses "S3E11" / "S2E7" (Season/Episode) instead, deliberately distinct so
  // a code can never be ambiguous about which grade band it came from. If
  // this pattern ever needs to change, update the server's copy too - the
  // server is the authority (it rejects a mismatched save outright), this
  // is only here so the teacher sees the problem before submitting.
  const isIbdpGrade = gradeLevel === "Grade 11" || gradeLevel === "Grade 12";
  const sectionFormatExample = isIbdpGrade
    ? "S3E11 or S2E7 (Season/Episode)"
    : "A.3";
  const sectionFormatRe = isIbdpGrade ? /^S\d{1,2}E\d{1,3}$/ : /^[A-Z]{1,2}\.\d{1,2}$/;
  const saveBlockedReason = !courseId
    ? "Select a course to save this packet."
    : !sectionCode.trim()
      ? `Enter a section code (e.g. ${sectionFormatExample}) to save this packet.`
      : !sectionFormatRe.test(sectionCode)
        ? `Section code "${sectionCode}" doesn't match the required format for ${gradeLevel} (e.g. ${sectionFormatExample}).`
        : "";
  const canSave = saveBlockedReason === "";

  const sectionOptions = useMemo(
    () => continuity?.unitSequence ?? [],
    [continuity],
  );

  return (
    <div className="flex flex-col gap-4">
      {/* ---- Targeting bar ---- */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-da-border bg-da-bg/40 px-4 py-2.5">
        <label className="flex items-center gap-1.5 text-xs text-da-muted">
          Grade
          <select
            value={gradeLevel}
            onChange={(e) => setGradeLevel(e.target.value as GradeLevel)}
            className="rounded border border-da-border/50 bg-da-bg/30 px-2 py-1 text-xs text-da-text focus:outline-none"
          >
            {GRADE_LEVELS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-xs text-da-muted">
          Course
          <select
            value={courseId}
            onChange={(e) => {
              setCourseId(e.target.value);
              setSectionCode("");
            }}
            className="rounded border border-da-border/50 bg-da-bg/30 px-2 py-1 text-xs text-da-text focus:outline-none"
          >
            <option value="">— none (no continuity) —</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-xs text-da-muted">
          Section
          {sectionOptions.length > 0 ? (
            <select
              value={sectionCode}
              onChange={(e) => setSectionCode(e.target.value)}
              className="rounded border border-da-border/50 bg-da-bg/30 px-2 py-1 text-xs text-da-text focus:outline-none"
            >
              <option value="">— select —</option>
              {sectionOptions.map((u) => (
                <option key={u.section} value={u.section}>
                  {u.section} — {u.title}
                  {u.status === "done" ? " ✓" : ""}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={sectionCode}
              onChange={(e) => setSectionCode(e.target.value.toUpperCase())}
              placeholder={isIbdpGrade ? "e.g. S3E11" : "e.g. A.3"}
              className="w-16 rounded border border-da-border/50 bg-da-bg/30 px-2 py-1 text-xs text-da-text focus:outline-none"
            />
          )}
        </label>

        <div className="ml-auto text-xs">
          {continuityLoading && <span className="text-da-muted">Loading continuity…</span>}
          {!continuityLoading && continuity?.hasContinuity && (
            <span className="text-emerald-400">
              ● Continuity active — {continuity.packetCount} prior packet
              {continuity.packetCount === 1 ? "" : "s"} in context
            </span>
          )}
          {!continuityLoading && courseId && !continuity?.hasContinuity && (
            <span className="text-amber-400">● No prior packets — generating cold</span>
          )}
          {!continuityLoading && !courseId && (
            <span className="text-da-muted">No course selected — continuity off</span>
          )}
        </div>
      </div>

      {saveNotice && (
        <div className="rounded-lg border border-da-border bg-da-bg/40 px-4 py-2 text-xs text-da-text">
          {saveNotice}
        </div>
      )}

      {/* ---- AI generator panel ---- */}
      <ActivityGeneratorPanel
        gradeLevel={gradeLevel}
        formatting={formatting}
        onDraftGenerated={handleDraftGenerated}
        continuityContext={sectionContext || undefined}
      />

      {/* ---- Toolbar ---- */}
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
          {saveBlockedReason && (
            <span className="max-w-xs text-xs text-amber-400" title={saveBlockedReason}>
              {saveBlockedReason}
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
            onClick={openDigestModal}
            disabled={!canSave}
            title={
              canSave
                ? "Save to nuanced_analyses and update this course's continuity record"
                : saveBlockedReason
            }
            className="rounded-lg border border-da-border bg-da-bg/60 px-3 py-1.5 text-xs font-semibold text-da-text transition-colors hover:bg-da-bg disabled:cursor-not-allowed disabled:opacity-50"
          >
            ⌸ Save as Nuanced Analysis
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

      {/* ---- Live preview ---- */}
      <div className="rounded-xl border border-da-border bg-white p-4 shadow-sm print:border-0 print:shadow-none">
        <NuancedAnalysisPreview
          draft={draft}
          formatting={formatting}
          onDraftChange={handleDraftChange}
          globalAnswerLines={globalAnswerLines}
          gradeLevel={gradeLevel}
        />
      </div>

      {/* ---- Edit Template modal ---- */}
      <EditTemplateModal
        open={templateModalOpen}
        onClose={() => setTemplateModalOpen(false)}
      />

      {/* ---- Continuity digest confirmation ---- */}
      <ContinuityDigestModal
        open={digestModalOpen}
        initial={pendingDigest}
        vocabularyCandidates={pendingVocabCandidates}
        sectionCode={sectionCode}
        saving={saving}
        error={saveError}
        onCancel={() => setDigestModalOpen(false)}
        onConfirm={(d) => void handleConfirmSave(d)}
      />
    </div>
  );
}
