"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import LatexRenderer from "@/components/LatexRenderer";
import { AddQuestionWizard } from "./add-question-wizard";
import { splitDraftIntoParts } from "./review/split-draft-into-parts";
import { hasExplicitTopLevelPartStructure, shouldBlockPartAutoSave, shouldTrustMultipartWithoutExplicit } from "./part-structure";
import { IB_CORRECTION_SYSTEM, IB_CLASSIFY_SYSTEM } from "@/lib/latex-utils";
import { contextTermHighlightsFromFlags, deriveCommandTermFlags } from "@/lib/command-term-flags";
import { readJsonSafely } from "@/lib/http-json";
import { encodeGraphSpec, GRAPH_MARKER_RE, EXAMPLE_SPEC, type IbGraphSpec } from "@/components/IbGraph";

const IbGraph = dynamic(() => import("@/components/IbGraph"), { ssr: false });

const GRAPH_ELEMENT_REFERENCE = `Supported element types:

{ "type": "fn",         "expr": "x^2 - 2",          "color": "#1a56db", "dashed": false, "label": "f(x)", "xMin": -3, "xMax": 3 }
{ "type": "vasymptote", "x": 2,                      "label": "x = 2" }
{ "type": "hasymptote", "y": -1,                     "label": "y = -1" }
{ "type": "line",       "expr": "2*x + 1",           "dashed": true,    "label": "tangent" }
{ "type": "point",      "x": 2, "y": 3,              "label": "(2, 3)", "open": false }
{ "type": "guide",      "x": 2, "y": 3 }
{ "type": "shade",      "expr1": "x^2", "expr2": "2*x", "xMin": 0, "xMax": 2, "color": "#1a56db" }
{ "type": "parametric", "xt": "cos(t)", "yt": "sin(t)", "tMin": 0, "tMax": 6.28, "color": "#e02424" }
{ "type": "label",      "x": 1, "y": 2,              "text": "A" }

Expr functions: sin cos tan arcsin arccos arctan ln log sqrt abs exp
Use ^ for powers: x^2, e^(-x), (x+1)^3
Colors: any CSS hex or named colour`.trim();

interface QuestionPart {
  id: string;
  part_label: string;
  marks: number;
  subtopic_codes: string[];
  command_term: string | null;
  command_terms?: string[];
  instructional_context_terms?: string[];
  is_hence?: boolean;
  is_hence_or_otherwise?: boolean;
  is_using?: boolean;
  is_deduce?: boolean;
  is_verify?: boolean;
  sort_order: number;
  content_latex: string | null;
  markscheme_latex: string | null;
  latex_verified: boolean | null;
}

interface QuestionImage {
  id: string;
  image_type: "question" | "markscheme";
  storage_path: string;
  sort_order: number;
  alt_text: string | null;
  url: string | null;
}

interface GraphImageCrop {
  id: string;
  question_id: string;
  question_image_id: string;
  part_id: string | null;
  storage_path: string;
  crop_bbox: Record<string, unknown> | null;
  graph_spec: Record<string, unknown> | null;
  graph_meta: Record<string, unknown> | null;
  extractor: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  url: string | null;
}

interface Question {
  id: string;
  code: string;
  session: string;
  paper: number;
  level: string;
  timezone: string;
  difficulty: number | null;
  google_doc_id: string;
  google_ms_id: string | null;
  section: "A" | "B" | null;
  curriculum: string[];
  has_question_images: boolean;
  has_markscheme_images: boolean;
  stem_latex: string | null;
  stem_markscheme_latex: string | null;
  parts_draft_latex: string | null;
  parts_draft_markscheme_latex: string | null;
  question_parts: QuestionPart[];
}

interface Course {
  id: string;
  name: string;
}

interface TestQueueItem {
  id: string;
  code: string;
  section: "A" | "B" | null;
  curriculum: string[];
  hasQuestion: boolean;
  hasMarkscheme: boolean;
  marks: number;
}

interface ExamConfig {
  name: string;
  curriculum: "AA" | "AI";
  level: "HL" | "SL";
  paper: 1 | 2 | 3;
  courseId: string;
  date: string;
}

interface SavedExam {
  id: string;
  name: string;
  curriculum: "AA" | "AI";
  level: "HL" | "SL";
  paper: 1 | 2 | 3;
  course_id: string | null;
  exam_date: string | null;
  questions: TestQueueItem[];
  created_at: string;
  updated_at: string;
}

interface Subtopic {
  code: string;
  descriptor: string;
  section: number;
}

interface Filters {
  sessions: string[];
  timezones: string[];
  subtopics: Subtopic[];
}

interface GraphExtractFailure {
  status: number;
  error: string;
  warnings: string[];
  feedback: string[];
  graphSpec?: IbGraphSpec;
  graphMeta?: Record<string, unknown>;
}

interface GraphExtractSnapshot {
  status: number;
  ok: boolean;
  error?: string;
  warnings: string[];
  feedback: string[];
  graphSpec?: IbGraphSpec;
  graphMeta?: Record<string, unknown>;
}

interface DocExtractTroubleshooting {
  capturedAt: string;
  questionId: string;
  code: string;
  googleDocId: string | null;
  googleMsId: string | null;
  request: {
    endpoint: string;
    method: "POST";
    payload: Record<string, unknown>;
  };
  response: {
    ok: boolean;
    status: number;
    statusText: string;
    durationMs: number;
    body?: unknown;
    parseError?: string;
  };
  appContext: {
    driveConnected: boolean;
    globalError: string | null;
  };
}

interface ExtractPlan {
  qDraft: string;
  msDraft: string;
  finalLabels: string[];
  isWholeQuestion: boolean;
  stemQ: string;
  stemMS: string;
  splitQ: Map<string, string>;
  splitMS: Map<string, string>;
  claudeParts: { label: string; marks: number; commandTerm: string; subtopicCodes: string[] }[];
  /** Editable marks per part label (key="" for whole-question). Pre-seeded from
   *  Claude data or \hfill [N] inference; user can edit in the review wizard. */
  partMarks: Map<string, number>;
  debug: {
    claudeLabels: string[];
    detectedLabels: string[];
    candidateLabels: string[];
    inferredLabels: string[];
    hasExplicitPartEnvironment: boolean;
    canTrustClaudeMultipart: boolean;
    isSuspiciousSingleA: boolean;
    strongUniqueLabels: string[];
    splitProbeKeys: string[];
    saveGuardBlocked: boolean;
    saveGuardReason: string | null;
    logLines: string[];
  };
}

const SECTION_NAMES: Record<number, string> = {
  1: "Number & Algebra",
  2: "Functions",
  3: "Geometry & Trig",
  4: "Stats & Probability",
  5: "Calculus",
};

const DEFAULT_COMMAND_TERMS = [
  "Calculate",
  "Classify",
  "Comment",
  "Compare",
  "Complete",
  "Construct",
  "Copy",
  "Deduce",
  "Demonstrate",
  "Describe",
  "Determine",
  "Differentiate",
  "Distinguish",
  "Draw",
  "Estimate",
  "Evaluate",
  "Expand",
  "Explain",
  "Express",
  "Factorise",
  "Find",
  "Give",
  "Hence",
  "Identify",
  "Integrate",
  "Interpret",
  "Investigate",
  "Justify",
  "Label",
  "Let",
  "List",
  "Mark",
  "Measure",
  "Outline",
  "Plot",
  "Predict",
  "Prove",
  "Represent",
  "Show",
  "Simplify",
  "Sketch",
  "Solve",
  "State",
  "Suggest",
  "Trace",
  "Using",
  "Verify",
  "Write down",
];

/**
 * Infer the total mark value for a piece of LaTeX by summing all
 * `\hfill [N]` / `\hfill [N marks]` patterns (standard IB question notation).
 * Falls back to summing `[N marks]` lines found in markschemes, skipping
 * any line that contains "Total". Returns null when nothing is found.
 */
function parseMarksFromLatex(latex: string): number | null {
  if (!latex) return null;
  // Primary: \hfill [N] or \hfill [N marks]
  const hfillRe = /\\hfill\s*\[(\d+)(?:\s*marks?)?\]/gi;
  let total = 0;
  let found = false;
  let m: RegExpExecArray | null;
  while ((m = hfillRe.exec(latex)) !== null) {
    total += parseInt(m[1], 10);
    found = true;
  }
  if (found) return total > 0 ? total : null;
  // Fallback: [N marks] / [N mark] lines in markscheme (ignore "Total" lines)
  for (const line of latex.split("\n")) {
    if (/Total\s*\[/i.test(line)) continue;
    const mm = /\[(\d+)\s*marks?\]/i.exec(line);
    if (mm) { total += parseInt(mm[1], 10); found = true; }
  }
  return found && total > 0 ? total : null;
}

/**
 * Scan the question LaTeX for the first IB command term that appears as a
 * whole word (case-insensitive). Returns the canonical form or null.
 */
function detectCommandTerm(latex: string): string | null {
  if (!latex) return null;
  // Strip LaTeX commands so we match plain text
  const plain = latex.replace(/\\[a-zA-Z]+\{[^}]*\}/g, " ").replace(/[${}\\]/g, " ");
  // Longer terms first so "Write down" beats "Write", "Show that" etc.
  const sorted = [...DEFAULT_COMMAND_TERMS].sort((a, b) => b.length - a.length);
  for (const term of sorted) {
    const re = new RegExp(`\\b${term.replace(/ /g, "\\s+")}\\b`, "i");
    if (re.test(plain)) return term;
  }
  return null;
}

function inferFallbackCommandTerm(latex: string): string | null {
  if (!latex) return null;
  const plain = latex
    .replace(/\\[a-zA-Z]+\{[^}]*\}/g, " ")
    .replace(/[${}\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!plain) return null;

  // Common imperative starters seen in IB prompts where exact canonical term
  // may not appear verbatim (e.g. "Write the integer ..." -> "Write down").
  if (/^write\b/.test(plain)) return "Write down";
  if (/^show\b/.test(plain)) return "Show";
  if (/^find\b/.test(plain)) return "Find";
  if (/^calculate\b/.test(plain)) return "Calculate";
  if (/^state\b/.test(plain)) return "State";
  if (/^determine\b/.test(plain)) return "Determine";
  if (/^hence\b/.test(plain)) return "Hence";
  return null;
}

function chooseCommandTerm(input: {
  questionLatex: string;
  markschemeLatex?: string;
  claudeCommandTerm?: string | null;
}): string {
  const fromQuestion = detectCommandTerm(input.questionLatex);
  if (fromQuestion) return fromQuestion;
  const fallbackFromQuestion = inferFallbackCommandTerm(input.questionLatex);
  if (fallbackFromQuestion) return fallbackFromQuestion;
  const fromMarkscheme = detectCommandTerm(input.markschemeLatex ?? "");
  if (fromMarkscheme) return fromMarkscheme;
  const fallbackFromMarkscheme = inferFallbackCommandTerm(input.markschemeLatex ?? "");
  if (fallbackFromMarkscheme) return fallbackFromMarkscheme;
  const canonicalFromClaude = DEFAULT_COMMAND_TERMS.find(
    (t) => t.toLowerCase() === (input.claudeCommandTerm ?? "").toLowerCase(),
  );
  if (canonicalFromClaude) return canonicalFromClaude;
  return "State";
}

function chooseCommandTerms(input: {
  questionLatex: string;
  markschemeLatex?: string;
  claudeCommandTerm?: string | null;
}): string[] {
  const primary = chooseCommandTerm(input);
  const combined = mergeHighlightTerms(
    [primary],
    detectCommandTerms(input.questionLatex),
    detectCommandTerms(input.markschemeLatex ?? ""),
    input.claudeCommandTerm ? [input.claudeCommandTerm] : [],
  );
  const canonical = combined
    .map((term) => DEFAULT_COMMAND_TERMS.find((t) => t.toLowerCase() === term.toLowerCase()))
    .filter((t): t is string => Boolean(t));
  return mergeHighlightTerms([primary], canonical);
}

function detectCommandTerms(latex: string): string[] {
  if (!latex) return [];
  const plain = latex.replace(/\\[a-zA-Z]+\{[^}]*\}/g, " ").replace(/[${}\\]/g, " ");
  const sorted = [...DEFAULT_COMMAND_TERMS].sort((a, b) => b.length - a.length);
  const found: string[] = [];
  for (const term of sorted) {
    const re = new RegExp(`\\b${term.replace(/ /g, "\\s+")}\\b`, "i");
    if (re.test(plain)) found.push(term);
  }
  return found;
}

function mergeHighlightTerms(...groups: Array<string[] | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const term of group ?? []) {
      const t = term.trim();
      if (!t) continue;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}

function detectPartLabels(text: string): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  const re = /\(([a-z])\)(?=[\s\n\\$]|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      labels.push(m[1]);
    }
  }
  return labels;
}

function normalizePartLabelKey(label: string | null | undefined): string {
  if (!label) return "";
  return label.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function romanSubpartStem(label: string): string | null {
  const normalized = normalizePartLabelKey(label);
  const m = normalized.match(/^([a-z])(i|ii|iii|iv|v)$/);
  return m ? m[1] : null;
}

function primaryCommandTerm(part: Pick<QuestionPart, "command_term" | "command_terms">): string | null {
  return part.command_terms?.[0] ?? part.command_term ?? null;
}

export function QuestionBankClient({ initialDriveConnected = false }: { initialDriveConnected?: boolean }) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [filters, setFilters] = useState<Filters | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [customTerms, setCustomTerms] = useState<string[]>([]);
  const [questionImages, setQuestionImages] = useState<Record<string, QuestionImage[]>>({});
  const [extracting, setExtracting] = useState<Set<string>>(new Set());
  const [deletingImage, setDeletingImage] = useState<Set<string>>(new Set());
  const [uploadingImage, setUploadingImage] = useState<Set<string>>(new Set()); // keyed by questionId
  const [driveConnected, setDriveConnected] = useState(initialDriveConnected);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{
    found: number;
    updated: number;
    focused?: {
      code: string | null;
      status: string | null;
      requestedFocus?: { code: string | null; questionId: string | null };
      db: { id?: string; google_doc_id: string | null; google_ms_id: string | null } | null;
      needs: { doc: boolean; ms: boolean } | null;
      questionMatchCount: number;
      markschemeMatchCount: number;
      selectedQuestionDocId: string | null;
      selectedMarkschemeDocId: string | null;
      questionMatches: { id: string; name: string }[];
      markschemeMatches: { id: string; name: string }[];
      _debug?: {
        totalQuestionsLoaded: number;
        focusRequestedQuestionId: string | null;
        focusRequestedCode: string | null;
        idLookupResult: string;
        codeLookupResult: string;
        finalLookupResult: string;
        sampleIds: string[];
        codesContaining25M?: Array<{ id: string; code: string }>;
        codesContainingH6?: Array<{ id: string; code: string }>;
      };
    };
  } | null>(null);
  const [fixingLinks, setFixingLinks] = useState<false | "dryrun" | "apply">(false);
  const [fixLinksResult, setFixLinksResult] = useState<{
    dryRun: boolean;
    issuesFound: number;
    clearedGoogleDocId?: number;
    clearedGoogleMsId?: number;
    updatedRows?: number;
  } | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; updated: number; errors?: string[]; debug?: Record<string, unknown> } | null>(null);
  const [bulkExtracting, setBulkExtracting] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{
    completed: number;
    total: number;
    currentCode: string;
    totalImages: number;
    errors: number;
  } | null>(null);
  const [bulkErrors, setBulkErrors] = useState<{ code: string; error: string }[]>([]);
  const [bulkEventLog, setBulkEventLog] = useState<string[]>([]);
  const [showErrors, setShowErrors] = useState(false);
  const [docExtractTroubleshooting, setDocExtractTroubleshooting] = useState<Record<string, DocExtractTroubleshooting>>({});
  const [docTroubleshootingCopied, setDocTroubleshootingCopied] = useState<Set<string>>(new Set());
  const [bulkTroubleshootingCopied, setBulkTroubleshootingCopied] = useState(false);

  // ── ExamBuilder state ───────────────────────────────────────────────────────
  const [testBuilderOpen, setTestBuilderOpen] = useState(false);
  const [addQuestionOpen, setAddQuestionOpen] = useState(false);
  const [testQueue, setTestQueue] = useState<TestQueueItem[]>([]);
  const [examConfig, setExamConfig] = useState<ExamConfig>({
    name: "",
    curriculum: "AA",
    level: "HL",
    paper: 1,
    courseId: "",
    date: "",
  });
  const [courses, setCourses] = useState<Course[]>([]);
  // Set default courseId to 27AH if present and not already set
  useEffect(() => {
    if (courses.length > 0 && !examConfig.courseId) {
      const ah = courses.find((c) => c.name.toLowerCase().includes("27ah"));
      if (ah) {
        setExamConfig((prev) => ({ ...prev, courseId: ah.id }));
      }
    }
  }, [courses, examConfig.courseId]);
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);
  const [templateEdits, setTemplateEdits] = useState<Record<string, string>>({});
  const [savingSection, setSavingSection] = useState<Set<string>>(new Set());

  // ── Saved exams state ───────────────────────────────────────────────────────
  const [savedExams, setSavedExams] = useState<SavedExam[]>([]);
  const [showSavedExams, setShowSavedExams] = useState(false);
  const [savingExam, setSavingExam] = useState(false);
  const [loadingExams, setLoadingExams] = useState(false);
  const [activeExamId, setActiveExamId] = useState<string | null>(null);
  const [examDirty, setExamDirty] = useState(false);
  const [pendingAddQuestion, setPendingAddQuestion] = useState<Question | null>(null);

  // ── Random exam state ───────────────────────────────────────────────────────
  const [showRandomPanel, setShowRandomPanel] = useState(false);
  const [randomTargetMinutes, setRandomTargetMinutes] = useState(120);
  const [buildingRandom, setBuildingRandom] = useState(false);
  const [randomError, setRandomError] = useState<string | null>(null);
  const [courseIdError, setCourseIdError] = useState(false);
  const [pendingOpenQuestionId, setPendingOpenQuestionId] = useState<string | null>(null);

  // All available command terms (built-in + custom)
  const allCommandTerms = [...DEFAULT_COMMAND_TERMS, ...customTerms].sort(
    (a, b) => a.localeCompare(b)
  );

  // Load custom terms from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("custom-command-terms");
      if (saved) setCustomTerms(JSON.parse(saved));
    } catch {}
  }, []);

  // Detect Google Drive connection status from URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("drive_connected") === "true") {
      setDriveConnected(true);
      // Clean URL
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (params.get("drive_error")) {
      setError(`Google Drive connection failed: ${params.get("drive_error")}`);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // Filter state
  const [search, setSearch] = useState(() => {
    try { return localStorage.getItem("qbank-search") ?? ""; } catch { return ""; }
  });
  const [searchContent, setSearchContent] = useState(false);
  const [session, setSession] = useState("");
  const [paper, setPaper] = useState("");
  const [level, setLevel] = useState("");
  const [timezone, setTimezone] = useState("");
  const [subtopic, setSubtopic] = useState("");

  const pageSize = 50;

  // Load filter options on mount
  useEffect(() => {
    fetch("/api/questions/filters")
      .then((r) => r.json())
      .then((d: Filters) => setFilters(d))
      .catch(() => {});
  }, []);

  // Load questions
  const loadQuestions = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (searchContent) params.set("searchContent", "1");
    if (session) params.set("session", session);
    if (paper) params.set("paper", paper);
    if (level) params.set("level", level);
    if (timezone) params.set("timezone", timezone);
    if (subtopic) params.set("subtopic", subtopic);
    params.set("page", String(page));

    fetch(`/api/questions?${params}`)
      .then(async (r) => {
        const text = await r.text();
        let d: { error?: string; questions?: unknown[]; total?: number } = {};
        try { d = JSON.parse(text); } catch { setError(`Server error (${r.status}): non-JSON response`); setQuestions([]); setTotal(0); return; }
        if (d.error) {
          setError(d.error);
          setQuestions([]);
          setTotal(0);
        } else {
          setQuestions((d.questions ?? []) as Parameters<typeof setQuestions>[0]);
          setTotal(d.total ?? 0);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [search, searchContent, session, paper, level, timezone, subtopic, page]);

  useEffect(() => {
    loadQuestions();
  }, [loadQuestions]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [search, searchContent, session, paper, level, timezone, subtopic]);

  const openExpand = (id: string) => {
    setExpanded((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      if (!questionImages[id]) {
        loadImages(id);
      }
      return next;
    });
  };

  const closeExpand = (id: string) => {
    setExpanded((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const openQuestionFromQueue = (item: TestQueueItem) => {
    const visible = questions.find((q) => q.id === item.id);
    if (visible) {
      openExpand(item.id);
      return;
    }
    setPendingOpenQuestionId(item.id);
    setSearch(item.code);
    setSearchContent(false);
    setSession("");
    setPaper("");
    setLevel("");
    setTimezone("");
    setSubtopic("");
    setPage(1);
  };

  useEffect(() => {
    if (!pendingOpenQuestionId || loading) return;
    const found = questions.find((q) => q.id === pendingOpenQuestionId);
    if (!found) return;
    openExpand(found.id);
    setPendingOpenQuestionId(null);
  }, [pendingOpenQuestionId, questions, loading]);

  const loadImages = async (questionId: string) => {
    try {
      const res = await fetch(`/api/questions/images?questionId=${questionId}`);
      const data = await res.json();
      if (!data.error) {
        setQuestionImages((prev) => ({ ...prev, [questionId]: data.images ?? [] }));
      }
    } catch {}
  };

  const extractImages = async (question: Question) => {
    const requestStartedAt = Date.now();
    const endpoint = "/api/questions/extract-images";
    const payload = { questionId: question.id };
    if (question.google_ms_id && question.google_doc_id === question.google_ms_id) {
      const message = "Question doc and markscheme doc are the same file — question doc link needs to be fixed before extracting images.";
      setError(message);
      setDocExtractTroubleshooting((prev) => ({
        ...prev,
        [question.id]: {
          capturedAt: new Date().toISOString(),
          questionId: question.id,
          code: question.code,
          googleDocId: question.google_doc_id ?? null,
          googleMsId: question.google_ms_id ?? null,
          request: {
            endpoint,
            method: "POST",
            payload,
          },
          response: {
            ok: false,
            status: 400,
            statusText: "CLIENT_PRECHECK_FAILED",
            durationMs: 0,
            body: { error: message },
          },
          appContext: {
            driveConnected,
            globalError: error,
          },
        },
      }));
      return;
    }
    setExtracting((prev) => new Set(prev).add(question.id));
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      let data: unknown;
      let parseError: string | undefined;
      try {
        data = await res.json();
      } catch (e) {
        parseError = e instanceof Error ? e.message : "Failed to parse JSON response";
      }

      const durationMs = Date.now() - requestStartedAt;
      const report: DocExtractTroubleshooting = {
        capturedAt: new Date().toISOString(),
        questionId: question.id,
        code: question.code,
        googleDocId: question.google_doc_id ?? null,
        googleMsId: question.google_ms_id ?? null,
        request: {
          endpoint,
          method: "POST",
          payload,
        },
        response: {
          ok: res.ok,
          status: res.status,
          statusText: res.statusText,
          durationMs,
          body: data,
          parseError,
        },
        appContext: {
          driveConnected,
          globalError: error,
        },
      };
      setDocExtractTroubleshooting((prev) => ({ ...prev, [question.id]: report }));

      if (!data || typeof data !== "object") {
        setError(parseError ?? "Extraction failed: empty response");
        return;
      }

      const result = data as { error?: string };
      if (result.error) {
        if (result.error.includes("Google Drive not connected")) {
          setError("Google Drive not connected. Click 'Connect Google Drive' at the top first.");
        } else {
          setError(result.error);
        }
      } else {
        setDriveConnected(true);
        // Reload images for this question
        await loadImages(question.id);
      }
    } catch (e) {
      const durationMs = Date.now() - requestStartedAt;
      const message = e instanceof Error ? e.message : "Extraction failed";
      setDocExtractTroubleshooting((prev) => ({
        ...prev,
        [question.id]: {
          capturedAt: new Date().toISOString(),
          questionId: question.id,
          code: question.code,
          googleDocId: question.google_doc_id ?? null,
          googleMsId: question.google_ms_id ?? null,
          request: {
            endpoint,
            method: "POST",
            payload,
          },
          response: {
            ok: false,
            status: 0,
            statusText: "NETWORK_ERROR",
            durationMs,
            body: { error: message },
          },
          appContext: {
            driveConnected,
            globalError: error,
          },
        },
      }));
      setError(message);
    } finally {
      setExtracting((prev) => {
        const next = new Set(prev);
        next.delete(question.id);
        return next;
      });
    }
  };

  const formatTroubleshooting = (t: DocExtractTroubleshooting): string => {
    const lines: string[] = [];
    lines.push("Google Doc extraction troubleshooting report");
    lines.push(`Captured at: ${t.capturedAt}`);
    lines.push(`Question code: ${t.code}`);
    lines.push(`Question id: ${t.questionId}`);
    lines.push(`Google doc id: ${t.googleDocId ?? "(none)"}`);
    lines.push(`Google markscheme id: ${t.googleMsId ?? "(none)"}`);
    lines.push("");
    lines.push("Request");
    lines.push(`- Endpoint: ${t.request.endpoint}`);
    lines.push(`- Method: ${t.request.method}`);
    lines.push(`- Payload: ${JSON.stringify(t.request.payload)}`);
    lines.push("");
    lines.push("Response");
    lines.push(`- ok: ${t.response.ok}`);
    lines.push(`- status: ${t.response.status} ${t.response.statusText}`);
    lines.push(`- durationMs: ${t.response.durationMs}`);
    if (t.response.parseError) {
      lines.push(`- parseError: ${t.response.parseError}`);
    }
    lines.push("");
    lines.push("Response body");
    lines.push(typeof t.response.body === "undefined" ? "(empty)" : JSON.stringify(t.response.body, null, 2));
    lines.push("");
    lines.push("App context");
    lines.push(`- driveConnected (client): ${t.appContext.driveConnected}`);
    lines.push(`- current global error: ${t.appContext.globalError ?? "(none)"}`);
    return lines.join("\n");
  };

  const copyQuestionTroubleshooting = (questionId: string) => {
    const report = docExtractTroubleshooting[questionId];
    if (!report) return;
    const text = formatTroubleshooting(report);
    void navigator.clipboard.writeText(text).then(() => {
      setDocTroubleshootingCopied((prev) => {
        const next = new Set(prev);
        next.add(questionId);
        return next;
      });
      setTimeout(() => {
        setDocTroubleshootingCopied((prev) => {
          const next = new Set(prev);
          next.delete(questionId);
          return next;
        });
      }, 2000);
    });
  };

  const copyBulkTroubleshooting = () => {
    const perQuestionReports = Object.values(docExtractTroubleshooting);
    const text = [
      "Bulk extract troubleshooting report",
      `Captured at: ${new Date().toISOString()}`,
      `Location: ${window.location.href}`,
      `driveConnected: ${driveConnected}`,
      `bulkExtracting: ${bulkExtracting}`,
      `syncing: ${syncing}`,
      `importing: ${importing}`,
      `globalError: ${error ?? "(none)"}`,
      `search: ${search || "(none)"}`,
      `searchContent: ${searchContent}`,
      `session: ${session || "(none)"}`,
      `paper: ${paper || "(none)"}`,
      `level: ${level || "(none)"}`,
      `timezone: ${timezone || "(none)"}`,
      `subtopic: ${subtopic || "(none)"}`,
      `page: ${page}`,
      `visibleQuestions: ${questions.length}`,
      `totalQuestions: ${total}`,
      "",
      "Bulk progress",
      JSON.stringify(bulkProgress, null, 2),
      "",
      "Bulk errors",
      JSON.stringify(bulkErrors, null, 2),
      "",
      "Import result",
      JSON.stringify(importResult, null, 2),
      "",
      "Sync result",
      JSON.stringify(syncResult, null, 2),
      "",
      "Bulk event log",
      bulkEventLog.length > 0 ? bulkEventLog.join("\n") : "(no events recorded in this tab yet)",
      "",
      "Per-question extraction troubleshooting",
      perQuestionReports.length > 0
        ? perQuestionReports.map((r) => formatTroubleshooting(r)).join("\n\n==============================\n\n")
        : "(none captured)",
    ].join("\n");

    void navigator.clipboard.writeText(text).then(() => {
      setBulkTroubleshootingCopied(true);
      setTimeout(() => setBulkTroubleshootingCopied(false), 2000);
    });
  };

  const clearUICache = () => {
    if (!confirm("Clear all UI cache? This will reset questions, filters, and cached data. You'll need to reload the page.")) {
      return;
    }
    
    // Clear React state
    setQuestions([]);
    setTotal(0);
    setPage(1);
    setSearch("");
    setSearchContent(false);
    setSession("");
    setPaper("");
    setLevel("");
    setTimezone("");
    setSubtopic("");
    setFilters(null);
    setQuestionImages({});
    setExpanded(new Set());
    setBulkProgress(null);
    setBulkErrors([]);
    setSyncResult(null);
    setFixLinksResult(null);
    setImportResult(null);
    
    // Clear localStorage/sessionStorage
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (e) {
      console.warn("Could not clear storage:", e);
    }
    
    // Reload page after brief delay to show cleared state
    setTimeout(() => {
      window.location.reload();
    }, 500);
  };

  const deleteImage = async (questionId: string, imageId: string) => {
    setDeletingImage((prev) => new Set(prev).add(imageId));
    try {
      const res = await fetch(`/api/questions/images/${imageId}`, { method: "DELETE" });
      if (res.ok) {
        setQuestionImages((prev) => ({
          ...prev,
          [questionId]: (prev[questionId] ?? []).filter((i) => i.id !== imageId),
        }));
      }
    } finally {
      setDeletingImage((prev) => {
        const next = new Set(prev);
        next.delete(imageId);
        return next;
      });
    }
  };

  const reorderImages = async (
    questionId: string,
    imageType: "question" | "markscheme",
    orderedIds: string[]
  ) => {
    // Optimistic update
    setQuestionImages((prev) => {
      const current = prev[questionId] ?? [];
      const otherType = current.filter((i) => i.image_type !== imageType);
      const reordered = orderedIds.map((id, idx) => {
        const img = current.find((i) => i.id === id)!;
        return { ...img, sort_order: idx };
      });
      return { ...prev, [questionId]: [...otherType, ...reordered] };
    });
    // Persist each updated sort_order
    await Promise.all(
      orderedIds.map((id, idx) =>
        fetch(`/api/questions/images/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sortOrder: idx }),
        })
      )
    );
  };

  const uploadImage = async (
    questionId: string,
    imageType: "question" | "markscheme",
    file: File
  ) => {
    setUploadingImage((prev) => new Set(prev).add(questionId));
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await fetch("/api/questions/images/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId, imageType, data: base64, mimeType: file.type || "image/png" }),
      });
      const data = await res.json();
      if (data.image) {
        setQuestionImages((prev) => ({
          ...prev,
          [questionId]: [...(prev[questionId] ?? []), data.image],
        }));
      }
    } finally {
      setUploadingImage((prev) => {
        const next = new Set(prev);
        next.delete(questionId);
        return next;
      });
    }
  };

  const syncDriveLinks = async () => {
    setSyncing(true);
    setSyncResult(null);
    setError(null);
    try {
      // Prefer the exact visible row code so focused diagnostics don't drift from
      // free-text search input formatting.
      const focusQuestion = questions.length === 1 ? questions[0] : null;
      const focusCode = focusQuestion?.code ?? search.trim();
      const focusQuestionId = focusQuestion?.id ?? null;
      const res = await fetch("/api/admin/sync-drive-docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(focusCode ? { focusCode } : {}),
          ...(focusQuestionId ? { focusQuestionId } : {}),
        }),
      });
      const data = await res.json() as {
        found?: number;
        updated?: number;
        error?: string;
        focused?: {
          code: string | null;
          status: string | null;
          requestedFocus?: { code: string | null; questionId: string | null };
          db: { id?: string; google_doc_id: string | null; google_ms_id: string | null } | null;
          needs: { doc: boolean; ms: boolean } | null;
          questionMatchCount: number;
          markschemeMatchCount: number;
          selectedQuestionDocId: string | null;
          selectedMarkschemeDocId: string | null;
          questionMatches: { id: string; name: string }[];
          markschemeMatches: { id: string; name: string }[];
          _debug?: {
            totalQuestionsLoaded: number;
            focusRequestedQuestionId: string | null;
            focusRequestedCode: string | null;
            idLookupResult: string;
            codeLookupResult: string;
            finalLookupResult: string;
            sampleIds: string[];
            codesContaining25M?: Array<{ id: string; code: string }>;
            codesContainingH6?: Array<{ id: string; code: string }>;
          };
        };
      };
      if (!res.ok) {
        setError(data.error ?? "Sync failed");
      } else {
        setSyncResult({ found: data.found ?? 0, updated: data.updated ?? 0, focused: data.focused });
      }
    } catch {
      setError("Network error during sync");
    } finally {
      setSyncing(false);
    }
  };

  const fixConflictedLinks = async (dryRun: boolean) => {
    setFixingLinks(dryRun ? "dryrun" : "apply");
    setFixLinksResult(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/fix-conflicted-doc-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun, limit: 100 }),
      });
      const data = await res.json() as {
        error?: string;
        dryRun?: boolean;
        issuesFound?: number;
        conflictedCount?: number;
        updatedRows?: number;
        updated?: number;
        clearedGoogleDocId?: number;
        clearedGoogleMsId?: number;
      };
      if (!res.ok) {
        setError(data.error ?? "Fix conflicted links failed");
      } else {
        setFixLinksResult({
          dryRun: data.dryRun ?? dryRun,
          issuesFound: data.issuesFound ?? data.conflictedCount ?? 0,
          updatedRows: data.updatedRows ?? data.updated,
          clearedGoogleDocId: data.clearedGoogleDocId,
          clearedGoogleMsId: data.clearedGoogleMsId,
        });
      }
    } catch {
      setError("Network error during fix conflicted links");
    } finally {
      setFixingLinks(false);
    }
  };

  const importFromDrive = async () => {
    setImporting(true);
    setImportResult(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/import-from-drive", { method: "POST" });
      const data = await res.json() as { created?: number; updated?: number; error?: string; errors?: string[]; debug?: Record<string, unknown> };
      if (!res.ok) {
        setError(data.error ?? "Import failed");
      } else {
        setImportResult({ created: data.created ?? 0, updated: data.updated ?? 0, errors: data.errors, debug: data.debug });
      }
    } catch {
      setError("Network error during import");
    } finally {
      setImporting(false);
    }
  };

  const extractAllImages = async () => {
    setBulkExtracting(true);
    setBulkProgress({ completed: 0, total: 0, currentCode: "", totalImages: 0, errors: 0 });
    setBulkErrors([]);
    setBulkEventLog([]);
    setShowErrors(false);
    setError(null);

    const appendBulkEvent = (message: string) => {
      setBulkEventLog((prev) => {
        const next = [...prev, `[${new Date().toISOString()}] ${message}`];
        return next.length > 400 ? next.slice(next.length - 400) : next;
      });
    };

    appendBulkEvent("Bulk extraction started (skipExisting=true)");

    try {
      const res = await fetch("/api/questions/extract-all-images", {
        method: "POST",
        redirect: "manual",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skipExisting: true }),
      });

      // If redirected (e.g. to login), the user isn't authenticated
      if (res.type === "opaqueredirect" || res.status === 0) {
        setError("Session expired. Please refresh the page and try again.");
        appendBulkEvent("Session expired or redirected before stream opened");
        setBulkExtracting(false);
        setBulkProgress(null);
        return;
      }

      if (!res.ok) {
        try {
          const data = await res.json();
          setError(data.error ?? "Bulk extraction failed");
          appendBulkEvent(`Bulk extraction HTTP ${res.status}: ${data.error ?? "Bulk extraction failed"}`);
        } catch {
          setError(`Bulk extraction failed (HTTP ${res.status})`);
          appendBulkEvent(`Bulk extraction HTTP ${res.status} with non-JSON error body`);
        }
        setBulkExtracting(false);
        setBulkProgress(null);
        return;
      }

      if (!res.body) {
        setError("No response stream");
        appendBulkEvent("Bulk extraction returned no response body stream");
        setBulkExtracting(false);
        setBulkProgress(null);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.type === "start") {
              appendBulkEvent(`Stream start: total=${msg.total}`);
              setBulkProgress((p) => ({ ...p!, total: msg.total }));
            } else if (msg.type === "progress") {
              if (msg.error) {
                appendBulkEvent(`Progress ${msg.completed}/${msg.total} ${msg.code}: ERROR ${msg.error}`);
              }
              setBulkProgress((prev) => ({
                completed: msg.completed,
                total: msg.total,
                currentCode: msg.code,
                totalImages: (prev?.totalImages ?? 0) + msg.questionImages + msg.msImages,
                errors: msg.error ? (prev?.errors ?? 0) + 1 : (prev?.errors ?? 0),
              }));
              if (msg.error) {
                setBulkErrors((prev) => [...prev, { code: msg.code, error: msg.error }]);
              }
            } else if (msg.type === "done") {
              appendBulkEvent(`Done: totalQuestions=${msg.totalQuestions}, totalImages=${msg.totalImages}, errors=${msg.errors}`);
              setBulkProgress({
                completed: msg.totalQuestions,
                total: msg.totalQuestions,
                currentCode: "Done!",
                totalImages: msg.totalImages,
                errors: msg.errors,
              });
            } else if (msg.type === "error") {
              setError(msg.error);
              appendBulkEvent(`Stream error: ${msg.error}`);
            }
          } catch (parseErr) {
            console.error("Failed to parse stream line:", line, parseErr);
            appendBulkEvent(`Failed to parse stream line: ${line.slice(0, 180)}`);
          }
        }
      }

      setDriveConnected(true);
      appendBulkEvent("Bulk extraction stream finished successfully");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bulk extraction failed");
      appendBulkEvent(e instanceof Error ? `Exception: ${e.message}` : "Exception: Bulk extraction failed");
    } finally {
      setBulkExtracting(false);
    }
  };

  const clearFilters = () => {
    setSearch("");
    setSearchContent(false);
    setSession("");
    setPaper("");
    setLevel("");
    setTimezone("");
    setSubtopic("");
  };

  const addCustomTerm = (term: string) => {
    const trimmed = term.trim();
    if (!trimmed || allCommandTerms.includes(trimmed)) return;
    const updated = [...customTerms, trimmed];
    setCustomTerms(updated);
    try {
      localStorage.setItem("custom-command-terms", JSON.stringify(updated));
    } catch {}
  };

  const updateCommandTerm = async (partId: string, commandTerm: string | null) => {
    try {
      const res = await fetch("/api/questions/command-term", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partId, commandTerm }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        return;
      }
      setQuestions((prev) =>
        prev.map((q) => ({
          ...q,
          question_parts: q.question_parts.map((p) =>
            p.id === partId
              ? {
                ...p,
                ...(data.part ?? { command_term: commandTerm, command_terms: commandTerm ? [commandTerm] : [] }),
              }
              : p
          ),
        }))
      );
    } catch {
      setError("Failed to update command term");
    }
  };

  const updateSubtopics = async (partId: string, codes: string[]) => {
    // Optimistic update
    setQuestions((prev) =>
      prev.map((q) => ({
        ...q,
        question_parts: q.question_parts.map((p) =>
          p.id === partId ? { ...p, subtopic_codes: codes } : p
        ),
      }))
    );
    try {
      const res = await fetch("/api/questions/subtopics", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partId, subtopicCodes: codes }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        return;
      }
      setQuestions((prev) =>
        prev.map((q) => ({
          ...q,
          question_parts: q.question_parts.map((p) =>
            p.id === partId ? { ...p, subtopic_codes: data.subtopic_codes } : p
          ),
        }))
      );
    } catch {
      setError("Failed to update subtopics");
    }
  };

  // ── ExamBuilder handlers ────────────────────────────────────────────────────

  // Load courses once
  useEffect(() => {
    if (!testBuilderOpen || courses.length > 0) return;
    fetch("/api/courses")
      .then((r) => r.json())
      .then((d) => { if (d.courses) setCourses(d.courses); })
      .catch(() => {});
  }, [testBuilderOpen, courses.length]);

  const doAddToQueue = (q: Question) => {
    if (testQueue.find((item) => item.id === q.id)) return;
    setTestQueue((prev) => [
      ...prev,
      {
        id: q.id,
        code: q.code,
        section: q.section,
        curriculum: q.curriculum ?? ["AA"],
        hasQuestion: q.has_question_images,
        hasMarkscheme: q.has_markscheme_images,
        marks: q.question_parts.reduce((sum, p) => sum + p.marks, 0),
      },
    ]);
    setExamDirty(true);
  };

  const addToQueue = (q: Question) => {
    if (testQueue.find((item) => item.id === q.id)) return;
    if (activeExamId) {
      setPendingAddQuestion(q);
    } else {
      doAddToQueue(q);
    }
  };

  const confirmPendingAdd = async () => {
    if (!pendingAddQuestion) return;
    const q = pendingAddQuestion;
    // Build the updated queue synchronously so saveExam can use it
    const newItem: TestQueueItem = {
      id: q.id,
      code: q.code,
      section: q.section,
      curriculum: q.curriculum ?? ["AA"],
      hasQuestion: q.has_question_images,
      hasMarkscheme: q.has_markscheme_images,
      marks: q.question_parts.reduce((sum, p) => sum + p.marks, 0),
    };
    const newQueue = [...testQueue, newItem];
    setTestQueue(newQueue);
    setExamDirty(false);
    setPendingAddQuestion(null);
    // Immediately overwrite the saved exam with the updated queue
    await saveExam(newQueue);
  };

  const removeFromQueue = (id: string) => {
    setTestQueue((prev) => prev.filter((item) => item.id !== id));
    setExamDirty(true);
  };

  const updateQueueSection = (id: string, section: "A" | "B") => {
    setTestQueue((prev) =>
      prev.map((item) => (item.id === id ? { ...item, section } : item))
    );
    setExamDirty(true);
  };

  const autoSortQueue = () => {
    setTestQueue((prev) => {
      const a = prev.filter((q) => q.section === "A");
      const b = prev.filter((q) => q.section === "B");
      const other = prev.filter((q) => q.section !== "A" && q.section !== "B");
      return [...a, ...b, ...other];
    });
    setExamDirty(true);
  };

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    setTestQueue((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
    setExamDirty(true);
  };

  const updateSection = async (questionId: string, section: "A" | "B") => {
    setSavingSection((prev) => new Set(prev).add(questionId));
    try {
      const res = await fetch("/api/questions/section", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId, section }),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setQuestions((prev) =>
        prev.map((q) => (q.id === questionId ? { ...q, section } : q))
      );
    } catch {
      setError("Failed to update section");
    } finally {
      setSavingSection((prev) => {
        const next = new Set(prev);
        next.delete(questionId);
        return next;
      });
    }
  };

  const openPreview = (imageType: "question" | "markscheme") => {
    const config = {
      questionIds: testQueue.map((q) => q.id),
      imageType,
      examName: examConfig.name || "Exam",
      curriculum: examConfig.curriculum,
      level: examConfig.level,
      paper: examConfig.paper,
      courseId: examConfig.courseId,
      date: examConfig.date,
    };
    sessionStorage.setItem("testBuilderConfig", JSON.stringify(config));
    window.open("/dashboard/questions/test-preview", "_blank");
  };

  const saveTemplates = async () => {
    for (const [key, slideId] of Object.entries(templateEdits)) {
      const [curriculum, level, paper] = key.split("-");
      if (!slideId.trim()) continue;
      await fetch("/api/exam-templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ curriculum, level, paper: parseInt(paper), slide_presentation_id: slideId }),
      });
    }
    setShowTemplateEditor(false);
    setTemplateEdits({});
  };

  // ── Saved exam handlers ─────────────────────────────────────────────────────

  const fetchSavedExams = async () => {
    setLoadingExams(true);
    try {
      const res = await fetch("/api/exams");
      const data = await res.json();
      if (data.exams) setSavedExams(data.exams);
    } catch { /* ignore */ } finally {
      setLoadingExams(false);
    }
  };

  const toggleSavedExams = async () => {
    if (!showSavedExams && savedExams.length === 0) await fetchSavedExams();
    setShowSavedExams((v) => !v);
  };

  // Open ExamBuilder and saved exams panel on mount (client-only to avoid SSR/hydration mismatch
  // caused by the Dashlane extension injecting child nodes into form elements)
  useEffect(() => {
    setTestBuilderOpen(true);
    setShowSavedExams(true);
    fetchSavedExams();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveExam = async (queueOverride?: TestQueueItem[]) => {
    const queueToSave = queueOverride ?? testQueue;
    if (!examConfig.name.trim()) {
      alert("Please enter an exam name before saving.");
      return;
    }
    if (queueToSave.length === 0) {
      alert("Add at least one question before saving.");
      return;
    }
    setSavingExam(true);
    try {
      const payload = {
        name: examConfig.name,
        curriculum: examConfig.curriculum,
        level: examConfig.level,
        paper: examConfig.paper,
        course_id: examConfig.courseId || null,
        exam_date: examConfig.date || null,
        questions: queueToSave,
      };
      if (activeExamId) {
        await fetch("/api/exams", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: activeExamId, ...payload }),
        });
      } else {
        const res = await fetch("/api/exams", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (data.id) setActiveExamId(data.id);
      }
      setExamDirty(false);
      // Refresh saved exams list if visible
      if (showSavedExams) await fetchSavedExams();
    } catch { /* ignore */ } finally {
      setSavingExam(false);
    }
  };

  const loadExam = (exam: SavedExam) => {
    setTestQueue(exam.questions);
    setExamConfig({
      name: exam.name,
      curriculum: exam.curriculum,
      level: exam.level,
      paper: exam.paper,
      courseId: exam.course_id ?? "",
      date: exam.exam_date ?? "",
    });
    setActiveExamId(exam.id);
    setExamDirty(false);
    setShowSavedExams(false);
  };

  const deleteExam = async (id: string) => {
    if (!confirm("Delete this saved exam?")) return;
    await fetch(`/api/exams?id=${id}`, { method: "DELETE" });
    setSavedExams((prev) => prev.filter((e) => e.id !== id));
    if (activeExamId === id) setActiveExamId(null);
  };

  const buildRandomExam = async () => {
    if (!examConfig.courseId) {
      setCourseIdError(true);
      return;
    }
    setCourseIdError(false);
    setBuildingRandom(true);
    setRandomError(null);
    try {
      const res = await fetch("/api/questions/random", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId: examConfig.courseId,
          paper: examConfig.paper,
          targetMinutes: randomTargetMinutes,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setRandomError(data.error);
        return;
      }
      setTestQueue(data.questions ?? []);
      setActiveExamId(null);
      setShowRandomPanel(false);
    } catch (e: unknown) {
      setRandomError(e instanceof Error ? e.message : "Failed to build random exam");
    } finally {
      setBuildingRandom(false);
    }
  };

  const showSectionsInPanel =
    examConfig.paper !== 3 && examConfig.curriculum === "AA";

  const queueHasMarkscheme = testQueue.some((q) => q.hasMarkscheme);

  const totalPages = Math.ceil(total / pageSize);

  // Group subtopics by section
  const subtopicsBySection = (filters?.subtopics ?? []).reduce(
    (acc, s) => {
      if (!acc[s.section]) acc[s.section] = [];
      acc[s.section].push(s);
      return acc;
    },
    {} as Record<number, Subtopic[]>
  );

  const totalMarks = (q: Question) =>
    q.question_parts.reduce((sum, p) => sum + p.marks, 0);

  return (
    <div className={`flex gap-4 items-start ${testBuilderOpen ? "pr-0" : ""}`} suppressHydrationWarning>
      {/* ── Main question bank column ── */}
      <div className="flex-1 min-w-0 space-y-4" suppressHydrationWarning>
      {!testBuilderOpen && (
        <div>
          <h1 className="text-3xl font-extrabold text-blue-900 drop-shadow-sm">
            Question Bank
          </h1>
          <p className="mt-1 text-base font-medium text-blue-700">
            Browse, search, and filter IB questions.
          </p>
        </div>
      )}
      {/* Google Drive Connection & Bulk Extract */}
      {driveConnected ? (
        <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-sm font-semibold text-green-800">
              Google Drive connected
            </span>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={importFromDrive}
                disabled={importing || syncing || bulkExtracting}
                className="rounded-lg bg-violet-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-50"
                title="Create DB entries for Drive docs whose question codes are not yet in the database"
              >
                {importing ? "Importing…" : "Import Missing from Drive"}
              </button>
              <button
                type="button"
                onClick={syncDriveLinks}
                disabled={syncing || bulkExtracting || importing || !!fixingLinks}
                className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                title="Scan Drive folders and link Google Doc IDs to questions that are missing them"
              >
                {syncing ? "Syncing…" : "Sync Doc Links"}
              </button>
              <button
                type="button"
                onClick={() => fixConflictedLinks(true)}
                disabled={syncing || bulkExtracting || importing || !!fixingLinks}
                className="rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-sm font-bold text-amber-800 hover:bg-amber-50 disabled:opacity-50"
                title="Scan for wrong question/markscheme doc links using Drive folder ancestry"
              >
                {fixingLinks === "dryrun" ? "Scanning…" : "Dry Run Fix Links"}
              </button>
              <button
                type="button"
                onClick={() => fixConflictedLinks(false)}
                disabled={syncing || bulkExtracting || importing || !!fixingLinks}
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-50"
                title="Apply cleanup: clear wrong-field links before re-syncing"
              >
                {fixingLinks === "apply" ? "Applying…" : "Apply Fix Links"}
              </button>
              <button
                type="button"
                onClick={extractAllImages}
                disabled={bulkExtracting || syncing || importing || !!fixingLinks}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {bulkExtracting ? "Extracting…" : "Extract All Images from Docs"}
              </button>
              <button
                type="button"
                onClick={copyBulkTroubleshooting}
                className="rounded-lg border border-slate-400 bg-white px-3 py-1.5 text-sm font-bold text-slate-700 hover:bg-slate-100"
                title="Copy bulk extraction diagnostics and errors for troubleshooting"
              >
                {bulkTroubleshootingCopied ? "✓ Copied" : "Copy Logs"}
              </button>
              <button
                type="button"
                onClick={clearUICache}
                className="rounded-lg border border-red-400 bg-white px-3 py-1.5 text-sm font-bold text-red-700 hover:bg-red-50"
                title="Clear cached questions, filters, and storage. This will reload the page."
              >
                Clear UI Cache
              </button>
            </div>
          </div>
          {importResult && (
            <div className="mt-1 text-xs text-violet-700">
              <p>Import complete — {importResult.created} new question{importResult.created !== 1 ? "s" : ""} created, {importResult.updated} doc link{importResult.updated !== 1 ? "s" : ""} updated.</p>
              {importResult.errors && importResult.errors.length > 0 && (
                <p className="text-red-600">Errors: {importResult.errors.join("; ")}</p>
              )}
              {importResult.debug && (
                <details className="mt-1">
                  <summary className="cursor-pointer underline">Debug info</summary>
                  <pre className="mt-1 max-h-40 overflow-auto rounded bg-violet-50 p-2 text-[10px] text-violet-900 whitespace-pre-wrap">{JSON.stringify(importResult.debug, null, 2)}</pre>
                </details>
              )}
            </div>
          )}
          {syncResult && (
            <div className="mt-1 text-xs text-green-700 space-y-1">
              <p>
                Sync complete — {syncResult.found} doc link{syncResult.found !== 1 ? "s" : ""} found,{" "}
                {syncResult.updated} updated.
              </p>
              {syncResult.focused && (
                <div className="rounded border border-green-200 bg-white/80 p-2 text-[11px] text-slate-700">
                  <p>
                    Focused code <span className="font-mono font-semibold">{syncResult.focused.code}</span>: <span className="font-semibold">{syncResult.focused.status ?? "unknown"}</span>
                  </p>
                  <p>
                    DB Q={syncResult.focused.db?.google_doc_id ?? "null"}, MS={syncResult.focused.db?.google_ms_id ?? "null"};
                    needs Q={String(syncResult.focused.needs?.doc ?? false)}, MS={String(syncResult.focused.needs?.ms ?? false)}
                  </p>
                  <p>
                    Matches Q={syncResult.focused.questionMatchCount}, MS={syncResult.focused.markschemeMatchCount};
                    selected Q={syncResult.focused.selectedQuestionDocId ?? "null"}, MS={syncResult.focused.selectedMarkschemeDocId ?? "null"}
                  </p>
                  {syncResult.focused._debug && (
                    <div className="mt-2 pt-2 border-t border-green-200 text-[10px] text-slate-600">
                      <p>DEBUG: {syncResult.focused._debug.totalQuestionsLoaded} total questions in DB</p>
                      <p>
                        ID lookup (requested: {syncResult.focused._debug.focusRequestedQuestionId}): {syncResult.focused._debug.idLookupResult}
                      </p>
                      <p>
                        Code lookup (requested: "{syncResult.focused._debug.focusRequestedCode}"): {syncResult.focused._debug.codeLookupResult}
                      </p>
                      <p>Final result: {syncResult.focused._debug.finalLookupResult}</p>
                      <p>Sample DB IDs: {syncResult.focused._debug.sampleIds.slice(0, 2).join(", ")}</p>
                      {syncResult.focused._debug.codesContaining25M && syncResult.focused._debug.codesContaining25M.length > 0 && (
                        <div className="mt-1 pt-1 border-t border-green-200">
                          <p className="font-semibold">Questions with "25M" in DB:</p>
                          {syncResult.focused._debug.codesContaining25M.map((q) => (
                            <p key={q.id} className="text-[9px]">
                              {q.code} → ID: {q.id}
                            </p>
                          ))}
                        </div>
                      )}
                      {syncResult.focused._debug.codesContaining25M && syncResult.focused._debug.codesContaining25M.length === 0 && (
                        <p className="mt-1 pt-1 text-[9px] font-semibold text-red-600">⚠️ NO questions with "25M" found in DB!</p>
                      )}
                      {syncResult.focused._debug.codesContainingH6 && syncResult.focused._debug.codesContainingH6.length > 0 && (
                        <div className="mt-1 pt-1 border-t border-green-200">
                          <p className="font-semibold">Questions with "H_6" in DB:</p>
                          {syncResult.focused._debug.codesContainingH6.map((q) => (
                            <p key={q.id} className="text-[9px]">
                              {q.code} → ID: {q.id}
                            </p>
                          ))}
                        </div>
                      )}
                      {syncResult.focused._debug.codesContainingH6 && syncResult.focused._debug.codesContainingH6.length === 0 && (
                        <p className="mt-1 pt-1 text-[9px] font-semibold text-red-600">⚠️ NO questions with "H_6" found in DB!</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {fixLinksResult && (
            <p className="mt-1 text-xs text-amber-800">
              {fixLinksResult.dryRun
                ? `Fix dry run — ${fixLinksResult.issuesFound} issue(s) found.`
                : `Fix applied — ${fixLinksResult.updatedRows ?? 0} row(s), cleared Q=${fixLinksResult.clearedGoogleDocId ?? 0}, MS=${fixLinksResult.clearedGoogleMsId ?? 0}.`}
            </p>
          )}
          {bulkProgress && (
            <div className="mt-2">
              <div className="flex items-center justify-between text-xs text-gray-700 mb-1">
                <span>
                  {bulkProgress.completed} / {bulkProgress.total} questions
                  {bulkProgress.currentCode && ` — ${bulkProgress.currentCode}`}
                </span>
                <span>
                  {bulkProgress.totalImages} images extracted
                  {bulkProgress.errors > 0 && `, ${bulkProgress.errors} errors`}
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{
                    width: bulkProgress.total > 0
                      ? `${(bulkProgress.completed / bulkProgress.total) * 100}%`
                      : "0%",
                  }}
                />
              </div>
            </div>
          )}
          {bulkErrors.length > 0 && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowErrors((v) => !v)}
                className="text-xs font-semibold text-red-700 underline"
              >
                {showErrors ? "Hide" : "Show"} {bulkErrors.length} error{bulkErrors.length !== 1 ? "s" : ""}
              </button>
              {showErrors && (
                <div className="mt-1 max-h-48 overflow-y-auto rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
                  {bulkErrors.slice(0, 50).map((e, i) => (
                    <div key={i} className="py-0.5">
                      <span className="font-bold">{e.code}:</span> {e.error}
                    </div>
                  ))}
                  {bulkErrors.length > 50 && (
                    <div className="py-1 font-semibold">…and {bulkErrors.length - 50} more</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-amber-800">
            Connect Google Drive to extract images from question documents.
          </p>
          <a
            href="/api/questions/connect-drive"
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-blue-700"
          >
            Connect Google Drive
          </a>
        </div>
      )}

      {/* Filters */}
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
        <div suppressHydrationWarning className="flex flex-wrap items-end gap-3">
          {/* Search */}
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-bold text-blue-900 mb-1">
              {searchContent ? "Search LaTeX Content" : "Search Code"}
            </label>
            <input
                suppressHydrationWarning
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); try { localStorage.setItem("qbank-search", e.target.value); } catch {} }}
                placeholder={searchContent ? "e.g. \\binom, \\int..." : "e.g. 22M, TZ2, H_10..."}
                className="input-dark w-full rounded border-2 border-blue-300 px-3 py-1.5 text-base font-semibold text-blue-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-600"
              />
          </div>

          {/* Session */}
          <div>
            <label className="block text-sm font-bold text-blue-900 mb-1">
              Session
            </label>
            <select
              suppressHydrationWarning
              value={session}
              onChange={(e) => setSession(e.target.value)}
              className="input-dark rounded border-2 border-blue-300 px-3 py-1.5 text-sm font-semibold text-blue-900 bg-white"
            >
              <option value="">All</option>
              {(filters?.sessions ?? []).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {/* Paper */}
          <div>
            <label className="block text-sm font-bold text-blue-900 mb-1">
              Paper
            </label>
            <select
              suppressHydrationWarning
              value={paper}
              onChange={(e) => setPaper(e.target.value)}
              className="input-dark rounded border-2 border-blue-300 px-3 py-1.5 text-sm font-semibold text-blue-900 bg-white"
            >
              <option value="">All</option>
              <option value="1">Paper 1</option>
              <option value="2">Paper 2</option>
              <option value="3">Paper 3</option>
            </select>
          </div>

          {/* Level */}
          <div>
            <label className="block text-sm font-bold text-blue-900 mb-1">
              Level
            </label>
            <select
              suppressHydrationWarning
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              className="input-dark rounded border-2 border-blue-300 px-3 py-1.5 text-sm font-semibold text-blue-900 bg-white"
            >
              <option value="">All</option>
              <option value="AHL">HL</option>
              <option value="SL">SL</option>
            </select>
          </div>

          {/* Timezone */}
          <div>
            <label className="block text-sm font-bold text-blue-900 mb-1">
              Timezone
            </label>
            <select
              suppressHydrationWarning
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="input-dark rounded border-2 border-blue-300 px-3 py-1.5 text-sm font-semibold text-blue-900 bg-white"
            >
              <option value="">All</option>
              {(filters?.timezones ?? []).map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>

          {/* Subtopic */}
          <div className="min-w-[220px]">
            <label className="block text-sm font-bold text-blue-900 mb-1">
              Subtopic
            </label>
            <select
              suppressHydrationWarning
              value={subtopic}
              onChange={(e) => setSubtopic(e.target.value)}
              className="input-dark rounded border-2 border-blue-300 px-3 py-1.5 text-sm font-semibold text-blue-900 bg-white w-full"
            >
              <option value="">All</option>
              {Object.entries(subtopicsBySection).map(([sec, subs]) => (
                <optgroup
                  key={sec}
                  label={`${sec}. ${SECTION_NAMES[Number(sec)] ?? "Other"}`}
                >
                  {subs.map((st) => (
                    <option key={st.code} value={st.code}>
                      {st.code} — {st.descriptor}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Clear */}
          <button
            suppressHydrationWarning
            type="button"
            onClick={clearFilters}
            className="rounded-lg border-2 border-blue-400 bg-white px-3 py-1.5 text-sm font-bold text-blue-700 hover:bg-blue-100"
          >
            Clear
          </button>

          {/* LaTeX toggle */}
          <button
            suppressHydrationWarning
            type="button"
            title={searchContent ? "Searching LaTeX content — click to switch to code search" : "Click to search inside LaTeX content"}
            onClick={() => setSearchContent((v) => !v)}
            className={`rounded-lg border-2 px-3 py-1.5 text-sm font-bold transition-colors ${
              searchContent
                ? "border-purple-500 bg-purple-600 text-white"
                : "border-purple-300 bg-white text-purple-600 hover:bg-purple-50"
            }`}
          >
            LaTeX
          </button>
        </div>
      </div>

      {/* Error display */}
      {error && (
          <div className="flex items-start justify-between gap-2 rounded-lg border-2 border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-800">
            <span>Error: {error}</span>
            <button
              type="button"
              className="shrink-0 rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-200"
              onClick={() => {
                const log = `[${new Date().toISOString()}] Error: ${error}`;
                navigator.clipboard.writeText(log).catch(() => {});
              }}
            >
              Copy
            </button>
          </div>
      )}

      {/* Results header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <p className="text-base font-bold text-blue-900">
            {loading ? "Loading…" : `${total} question${total !== 1 ? "s" : ""} found`}
          </p>
          <button
            type="button"
            suppressHydrationWarning
            onClick={() => setAddQuestionOpen(true)}
            className="rounded-lg border-2 border-emerald-400 bg-white px-3 py-1.5 text-sm font-bold text-emerald-700 hover:bg-emerald-50"
          >
            + New Question
          </button>
          <button
            type="button"
            onClick={() => {
              setTestBuilderOpen((v) => {
                if (!v) window.dispatchEvent(new CustomEvent("exam-builder-open"));
                return !v;
              });
            }}
            className={`rounded-lg px-4 py-1.5 text-sm font-bold transition-colors ${
              testBuilderOpen
                ? "bg-indigo-600 text-white hover:bg-indigo-700"
                : "border-2 border-indigo-400 text-indigo-700 bg-white hover:bg-indigo-50"
            }`}
            suppressHydrationWarning
          >
            🏗 ExamBuilder{testQueue.length > 0 ? ` (${testQueue.length})` : ""}
          </button>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded border-2 border-blue-300 px-2 py-1 text-sm font-bold text-blue-900 disabled:opacity-40 hover:bg-blue-50"
            >
              ← Prev
            </button>
            <span className="text-sm font-semibold text-blue-800">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded border-2 border-blue-300 px-2 py-1 text-sm font-bold text-blue-900 disabled:opacity-40 hover:bg-blue-50"
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* Questions table */}
      <div className="overflow-hidden rounded-xl border border-blue-200 bg-white">
        <table className="min-w-full divide-y divide-blue-100">
          <thead className="bg-blue-50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-bold text-blue-900">
                Code
              </th>
              <th className="px-4 py-3 text-center text-sm font-bold text-blue-900">
                Session
              </th>
              <th className="px-4 py-3 text-center text-sm font-bold text-blue-900">
                Paper
              </th>
              <th className="px-4 py-3 text-center text-sm font-bold text-blue-900">
                Level
              </th>
              <th className="px-4 py-3 text-center text-sm font-bold text-blue-900">
                TZ
              </th>
              <th className="px-4 py-3 text-center text-sm font-bold text-blue-900">
                Parts
              </th>
              <th className="px-4 py-3 text-center text-sm font-bold text-blue-900">
                Marks
              </th>
              <th className="px-4 py-3 text-center text-sm font-bold text-blue-900">
                Images
              </th>
              <th className="px-4 py-3 text-center text-sm font-bold text-blue-900">
                Section
              </th>
              {testBuilderOpen && (
                <th className="px-3 py-3 text-center text-sm font-bold text-indigo-700">
                  Add
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {questions.map((q) => (
              <QuestionRow
                key={q.id}
                question={q}
                expanded={expanded.has(q.id)}
                onOpen={() => openExpand(q.id)}
                onClose={() => closeExpand(q.id)}
                totalMarks={totalMarks(q)}
                commandTerms={allCommandTerms}
                onUpdateCommandTerm={updateCommandTerm}
                onAddCustomTerm={addCustomTerm}
                availableSubtopics={filters?.subtopics ?? []}
                onUpdateSubtopics={updateSubtopics}
                images={questionImages[q.id] ?? []}
                extracting={extracting.has(q.id)}
                driveConnected={driveConnected}
                onExtractImages={() => extractImages(q)}
                hasTroubleshooting={!!docExtractTroubleshooting[q.id]}
                troubleshootingCopied={docTroubleshootingCopied.has(q.id)}
                onCopyTroubleshooting={() => copyQuestionTroubleshooting(q.id)}
                deletingImageIds={deletingImage}
                uploadingImage={uploadingImage.has(q.id)}
                onDeleteImage={(imageId) => deleteImage(q.id, imageId)}
                onReorderImages={(imageType, orderedIds) => reorderImages(q.id, imageType, orderedIds)}
                onUploadImage={(imageType, file) => uploadImage(q.id, imageType, file)}
                testBuilderOpen={testBuilderOpen}
                inQueue={!!testQueue.find((item) => item.id === q.id)}
                onAddToQueue={() => addToQueue(q)}
                savingSection={savingSection.has(q.id)}
                onUpdateSection={(section) => updateSection(q.id, section)}
                onRefresh={loadQuestions}
              />
            ))}
            {!loading && questions.length === 0 && (
              <tr>
                <td
                  colSpan={testBuilderOpen ? 10 : 9}
                  className="px-4 py-8 text-center text-base text-blue-700"
                >
                  No questions match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Bottom pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2 pb-4">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded border-2 border-blue-300 px-3 py-1 text-sm font-bold text-blue-900 disabled:opacity-40 hover:bg-blue-50"
          >
            ← Prev
          </button>
          <span className="text-sm font-semibold text-blue-800 py-1">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded border-2 border-blue-300 px-3 py-1 text-sm font-bold text-blue-900 disabled:opacity-40 hover:bg-blue-50"
          >
            Next →
          </button>
        </div>
      )}
      </div> {/* end main column */}

      {/* ── ExamBuilder Panel ── */}
      {testBuilderOpen && (
        <TestBuilderPanel
          queue={testQueue}
          examConfig={examConfig}
          courses={courses}
          showSections={showSectionsInPanel}
          queueHasMarkscheme={queueHasMarkscheme}
          showTemplateEditor={showTemplateEditor}
          templateEdits={templateEdits}
          onConfigChange={(updates) => {
            setExamConfig((prev) => ({ ...prev, ...updates }));
            setExamDirty(true);
          }}
          onRemove={removeFromQueue}
          onUpdateSection={updateQueueSection}
          onAutoSort={autoSortQueue}
          onMoveUp={handleMoveUp}
          onPreviewTest={() => openPreview("question")}
          onPreviewMS={() => openPreview("markscheme")}
          onClear={() => { setTestQueue([]); setActiveExamId(null); }}
          onToggleTemplateEditor={() => setShowTemplateEditor((v) => !v)}
          onTemplateEditChange={(key, val) =>
            setTemplateEdits((prev) => ({ ...prev, [key]: val }))
          }
          onSaveTemplates={saveTemplates}
          savedExams={savedExams}
          showSavedExams={showSavedExams}
          savingExam={savingExam}
          loadingExams={loadingExams}
          activeExamId={activeExamId}
          examDirty={examDirty}
          onSaveExam={saveExam}
          onToggleSavedExams={toggleSavedExams}
          onLoadExam={loadExam}
          onDeleteExam={deleteExam}
          showRandomPanel={showRandomPanel}
          randomTargetMinutes={randomTargetMinutes}
          buildingRandom={buildingRandom}
          randomError={randomError}
          courseIdError={courseIdError}
          onToggleRandomPanel={() => {
            setShowRandomPanel((v) => !v);
            setCourseIdError(false);
            setRandomError(null);
          }}
          onRandomTargetChange={setRandomTargetMinutes}
          onBuildRandom={buildRandomExam}
          onClearCourseIdError={() => setCourseIdError(false)}
          onOpenQuestionFromQueue={openQuestionFromQueue}
        />
      )}

      {/* ── Add Question Wizard ── */}
      {addQuestionOpen && (
        <AddQuestionWizard
          availableSubtopics={filters?.subtopics ?? []}
          commandTerms={allCommandTerms}
          onAddCustomTerm={addCustomTerm}
          onClose={() => setAddQuestionOpen(false)}
          onSaved={loadQuestions}
        />
      )}

      {/* ── Add-to-exam confirmation ── */}
      {pendingAddQuestion && (
        <AddToExamModal
          questionCode={pendingAddQuestion.code}
          onConfirm={confirmPendingAdd}
          onCancel={() => setPendingAddQuestion(null)}
          saving={savingExam}
        />
      )}
    </div>
  );
}


// ── Add-to-exam confirmation modal ───────────────────────────────────────────
function AddToExamModal({
  questionCode,
  onConfirm,
  onCancel,
  saving,
}: {
  questionCode: string;
  onConfirm: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl p-6 w-80 flex flex-col gap-4">
        <h2 className="text-base font-bold text-gray-800">Add to saved exam?</h2>
        <p className="text-sm text-gray-600">
          Adding <span className="font-mono font-semibold">{questionCode}</span> will overwrite the currently saved exam.
        </p>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-4 py-1.5 text-sm font-semibold border border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={saving}
            className="rounded px-4 py-1.5 text-sm font-semibold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving…" : "Overwrite"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}


// ── Extraction Review Modal ───────────────────────────────────────────────────
function ExtractionReviewModal({
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

function QuestionRow({
  question,
  expanded,
  onOpen,
  onClose,
  totalMarks,
  commandTerms,
  onUpdateCommandTerm,
  onAddCustomTerm,
  availableSubtopics,
  onUpdateSubtopics,
  images,
  extracting,
  driveConnected,
  onExtractImages,
  hasTroubleshooting,
  troubleshootingCopied,
  onCopyTroubleshooting,
  deletingImageIds,
  uploadingImage,
  onDeleteImage,
  onReorderImages,
  onUploadImage,
  testBuilderOpen,
  inQueue,
  onAddToQueue,
  savingSection,
  onUpdateSection,
  onRefresh,
}: {
  question: Question;
  expanded: boolean;
  onOpen: () => void;
  onClose: () => void;
  totalMarks: number;
  commandTerms: string[];
  onUpdateCommandTerm: (partId: string, commandTerm: string | null) => void;
  onAddCustomTerm: (term: string) => void;
  availableSubtopics: Subtopic[];
  onUpdateSubtopics: (partId: string, codes: string[]) => void;
  images: QuestionImage[];
  extracting: boolean;
  driveConnected: boolean;
  onExtractImages: () => void;
  hasTroubleshooting: boolean;
  troubleshootingCopied: boolean;
  onCopyTroubleshooting: () => void;
  deletingImageIds: Set<string>;
  uploadingImage: boolean;
  onDeleteImage: (imageId: string) => void;
  onReorderImages: (imageType: "question" | "markscheme", orderedIds: string[]) => void;
  onUploadImage: (imageType: "question" | "markscheme", file: File) => void;
  testBuilderOpen: boolean;
  inQueue: boolean;
  onAddToQueue: () => void;
  savingSection: boolean;
  onUpdateSection: (section: "A" | "B") => void;
  onRefresh: () => void;
}) {
  const showSection = question.paper !== 3;
  const hasDocLinkConflict = question.google_ms_id !== null && question.google_doc_id === question.google_ms_id;
  const [showSectionPrompt, setShowSectionPrompt] = useState(false);
  const [minimized, setMinimized] = useState(false);

  // Guard close: if section is required but not set, show inline prompt instead.
  const handleClose = () => {
    if (graphEditorOpen && graphSpecDirty) {
      if (!confirm("You have unsaved graph edits. Close anyway? (Click \"Save \u2192 Stem\" or \"Save \u2192 Parts Draft\" first to keep them.)")) return;
    }
    if (showSection && question.section === null) {
      setShowSectionPrompt(true);
    } else {
      setShowSectionPrompt(false);
      onClose();
    }
  };

  const handleRowClick = () => {
    if (!expanded) {
      onOpen();
      return;
    }
    handleClose();
  };
  const [parts, setParts] = useState<QuestionPart[]>(
    [...(question.question_parts ?? [])].sort((a, b) => a.sort_order - b.sort_order)
  );
  const [latexDrafts, setLatexDrafts] = useState<Record<string, { content_latex: string; markscheme_latex: string }>>(() => {
    const d: Record<string, { content_latex: string; markscheme_latex: string }> = {};
    question.question_parts.forEach((p) => {
      d[p.id] = { content_latex: p.content_latex ?? "", markscheme_latex: p.markscheme_latex ?? "" };
    });
    return d;
  });
  const [editingLatex, setEditingLatex] = useState<{ partId: string; field: "content_latex" | "markscheme_latex" } | null>(null);
  const [savingLatex, setSavingLatex] = useState(false);
  const [extractingLatexField, setExtractingLatexField] = useState<{ partId: string; field: "content_latex" | "markscheme_latex" } | null>(null);
  const [collapsedPartCards, setCollapsedPartCards] = useState<Set<string>>(new Set());
  const [claudeInstruction, setClaudeInstruction] = useState<Record<string, string>>({}); // key: `${partId}-${field}`
  const [claudeLoading, setClaudeLoading] = useState<Record<string, boolean>>({});

  const togglePartCard = (cardKey: string) => {
    setCollapsedPartCards((prev) => {
      const next = new Set(prev);
      if (next.has(cardKey)) next.delete(cardKey);
      else next.add(cardKey);
      return next;
    });
  };

  // Full-question extraction state
  const [fullExtractState, setFullExtractState] = useState<"idle" | "confirm" | "running" | "reviewing">("idle");
  const [fullExtractLog, setFullExtractLog] = useState<string[]>([]);
  const [fullExtractError, setFullExtractError] = useState<string | null>(null);
  const [fullExtractCopied, setFullExtractCopied] = useState(false);
  const [extractPlan, setExtractPlan] = useState<ExtractPlan | null>(null);

  // Stem state (no separate edit for each field — share the same edit pattern)
  const [stemLatex, setStemLatex] = useState(question.stem_latex ?? "");
  const [stemMsLatex, setStemMsLatex] = useState(question.stem_markscheme_latex ?? "");
  const [stemDraftQ, setStemDraftQ] = useState(question.stem_latex ?? "");
  const [stemDraftMS, setStemDraftMS] = useState(question.stem_markscheme_latex ?? "");
  const [editingStem, setEditingStem] = useState<"stem_latex" | "stem_markscheme_latex" | null>(null);
  const [savingStem, setSavingStem] = useState(false);

  async function saveStem(field: "stem_latex" | "stem_markscheme_latex") {
    const value = field === "stem_latex" ? stemDraftQ : stemDraftMS;
    setSavingStem(true);
    try {
      await fetch("/api/questions/stem-update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: question.id, field, value }),
      });
      if (field === "stem_latex") setStemLatex(value);
      else setStemMsLatex(value);
      setEditingStem(null);
    } finally {
      setSavingStem(false);
    }
  }

  // Whole-question editor state (used when there are no labelled parts)
  const _wholeQPart = question.question_parts.find((p) => !p.part_label || p.part_label.trim() === "");
  const [wholeQDraft, setWholeQDraft] = useState(_wholeQPart?.content_latex ?? "");
  const [wholeMSDraft, setWholeMSDraft] = useState(_wholeQPart?.markscheme_latex ?? "");
  const [editingWhole, setEditingWhole] = useState<"q" | "ms" | null>(null);
  const [savingWhole, setSavingWhole] = useState(false);

  const [unlinkingDoc, setUnlinkingDoc] = useState<"q" | "ms" | null>(null);
  const [editingLinks, setEditingLinks] = useState(false);
  const [linkDraftQ, setLinkDraftQ] = useState(question.google_doc_id ?? "");
  const [linkDraftMS, setLinkDraftMS] = useState(question.google_ms_id ?? "");
  const [savingLinks, setSavingLinks] = useState(false);

  function extractDocId(urlOrId: string): string {
    const m = urlOrId.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : urlOrId.trim();
  }

  async function saveLinks() {
    setSavingLinks(true);
    try {
      const newDocId = extractDocId(linkDraftQ) || null;
      const newMsId = extractDocId(linkDraftMS) || null;
      await Promise.all([
        fetch("/api/questions/doc-link", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: question.id, field: "google_doc_id", value: newDocId }),
        }),
        fetch("/api/questions/doc-link", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: question.id, field: "google_ms_id", value: newMsId }),
        }),
      ]);
      setEditingLinks(false);
      onRefresh();
    } finally {
      setSavingLinks(false);
    }
  }

  async function unlinkDoc(field: "q" | "ms") {
    setUnlinkingDoc(field);
    try {
      await fetch("/api/questions/doc-link", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: question.id,
          field: field === "q" ? "google_doc_id" : "google_ms_id",
          value: null,
        }),
      });
      onRefresh();
    } finally {
      setUnlinkingDoc(null);
    }
  }

  // ── Clear stem ──────────────────────────────────────────────────────────
  const [clearingStem, setClearingStem] = useState(false);
  async function clearStem() {
    setClearingStem(true);
    try {
      await Promise.all([
        fetch("/api/questions/stem-update", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: question.id, field: "stem_latex", value: "" }),
        }),
        fetch("/api/questions/stem-update", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: question.id, field: "stem_markscheme_latex", value: "" }),
        }),
      ]);
      setStemLatex("");
      setStemMsLatex("");
      setStemDraftQ("");
      setStemDraftMS("");
      setEditingStem(null);
      onRefresh();
    } finally {
      setClearingStem(false);
    }
  }

  const [clearingAllLatex, setClearingAllLatex] = useState(false);
  async function clearAllLatex() {
    setClearingAllLatex(true);
    try {
      await Promise.all([
        fetch("/api/questions/stem-update", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: question.id, field: "stem_latex", value: "" }),
        }),
        fetch("/api/questions/stem-update", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: question.id, field: "stem_markscheme_latex", value: "" }),
        }),
        ...parts.map((p) =>
          fetch(`/api/questions/part-metadata?partId=${encodeURIComponent(p.id)}`, {
            method: "DELETE",
          })
        ),
      ]);

      setStemLatex("");
      setStemMsLatex("");
      setStemDraftQ("");
      setStemDraftMS("");
      setEditingStem(null);
      setWholeQDraft("");
      setWholeMSDraft("");
      setEditingWhole(null);
      setEditingLatex(null);
      setLatexDrafts({});
      setParts([]);
      onRefresh();
    } finally {
      setClearingAllLatex(false);
    }
  }

  // ── Delete part ─────────────────────────────────────────────────────────
  const [deletingPartId, setDeletingPartId] = useState<string | null>(null);
  async function deletePart(partId: string) {
    setDeletingPartId(partId);
    try {
      const res = await fetch(`/api/questions/part-metadata?partId=${encodeURIComponent(partId)}`, {
        method: "DELETE",
      });
      if (!res.ok) return;
      setParts((prev) => prev.filter((p) => p.id !== partId));
      onRefresh();
    } finally {
      setDeletingPartId(null);
    }
  }

  // ── Reset as whole question (clear stem + delete all labeled parts) ──────
  const [resettingWhole, setResettingWhole] = useState(false);
  async function resetAsWholeQuestion() {
    setResettingWhole(true);
    try {
      // 1. Clear stem fields
      await Promise.all([
        fetch("/api/questions/stem-update", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: question.id, field: "stem_latex", value: "" }),
        }),
        fetch("/api/questions/stem-update", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: question.id, field: "stem_markscheme_latex", value: "" }),
        }),
      ]);
      setStemLatex("");
      setStemMsLatex("");
      setStemDraftQ("");
      setStemDraftMS("");
      setEditingStem(null);

      // 2. Delete all labeled parts
      const labeledParts = parts.filter((p) => p.part_label && p.part_label.trim() !== "");
      await Promise.all(
        labeledParts.map((p) =>
          fetch(`/api/questions/part-metadata?partId=${encodeURIComponent(p.id)}`, { method: "DELETE" })
        )
      );
      setParts((prev) => prev.filter((p) => !p.part_label || p.part_label.trim() === ""));
      onRefresh();
    } finally {
      setResettingWhole(false);
    }
  }

  // ── Graph editor state ──────────────────────────────────────────────────
  const [graphEditorOpen, setGraphEditorOpen] = useState(false);
  const [graphSpecJson, setGraphSpecJson] = useState(() => JSON.stringify(EXAMPLE_SPEC, null, 2));
  const [graphSpecDirty, setGraphSpecDirty] = useState(false);
  const [graphSavingField, setGraphSavingField] = useState<"stem_latex" | "parts_draft_latex" | null>(null);
  const [graphCopiedMarker, setGraphCopiedMarker] = useState<string | null>(null);
  const [graphMarkerCopied, setGraphMarkerCopied] = useState(false);
  const [graphParseError, setGraphParseError] = useState<string | null>(null);
  const [graphExtracting, setGraphExtracting] = useState(false);
  const [graphExtractError, setGraphExtractError] = useState<string | null>(null);
  const [graphExtractFailure, setGraphExtractFailure] = useState<GraphExtractFailure | null>(null);
  const [graphExtractSnapshot, setGraphExtractSnapshot] = useState<GraphExtractSnapshot | null>(null);
  const [graphFailureCopied, setGraphFailureCopied] = useState(false);
  const [graphDebugCopied, setGraphDebugCopied] = useState(false);
  const [graphExtractWarnings, setGraphExtractWarnings] = useState<string[]>([]);
  const [graphExtractFeedback, setGraphExtractFeedback] = useState<string[]>([]);
  const [graphSourceImageB64, setGraphSourceImageB64] = useState<string | null>(null);
  const [graphMeta, setGraphMeta] = useState<Record<string, unknown> | null>(null);
  const [showCorrectionInput, setShowCorrectionInput] = useState(false);
  const [correctionJson, setCorrectionJson] = useState("");
  const [correctionParseError, setCorrectionParseError] = useState<string | null>(null);
  const [graphCrops, setGraphCrops] = useState<GraphImageCrop[]>([]);
  const [graphCropsLoading, setGraphCropsLoading] = useState(false);
  const [graphCropsError, setGraphCropsError] = useState<string | null>(null);
  const [deletingGraphCropIds, setDeletingGraphCropIds] = useState<Set<string>>(new Set());
  const [savingAsGraphCropIds, setSavingAsGraphCropIds] = useState<Set<string>>(new Set());

  const fetchGraphCrops = useCallback(async () => {
    setGraphCropsLoading(true);
    setGraphCropsError(null);
    try {
      const res = await fetch(`/api/questions/graph-crops?questionId=${encodeURIComponent(question.id)}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to load graph images");
      }
      setGraphCrops(Array.isArray(data.crops) ? (data.crops as GraphImageCrop[]) : []);
    } catch (e) {
      setGraphCropsError(e instanceof Error ? e.message : "Failed to load graph images");
      setGraphCrops([]);
    } finally {
      setGraphCropsLoading(false);
    }
  }, [question.id]);

  async function deleteGraphCrop(cropId: string) {
    setDeletingGraphCropIds((prev) => new Set(prev).add(cropId));
    try {
      const res = await fetch(`/api/questions/graph-crops/${encodeURIComponent(cropId)}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Failed to delete graph image");
      }
      setGraphCrops((prev) => prev.filter((crop) => crop.id !== cropId));
    } catch (e) {
      setGraphCropsError(e instanceof Error ? e.message : "Failed to delete graph image");
    } finally {
      setDeletingGraphCropIds((prev) => {
        const next = new Set(prev);
        next.delete(cropId);
        return next;
      });
    }
  }

  async function saveImageAsGraphCrop(img: QuestionImage) {
    if (!img.url) return;
    setSavingAsGraphCropIds((prev) => new Set(prev).add(img.id));
    setGraphCropsError(null);
    try {
      const resp = await fetch(img.url);
      if (!resp.ok) throw new Error("Failed to fetch image");
      const blob = await resp.blob();
      const mimeType = blob.type || "image/png";
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const res = await fetch("/api/questions/graph-crops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionImageId: img.id,
          data: base64,
          mimeType,
          extractor: "manual",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Failed to save graph image");
      }
      await fetchGraphCrops();
    } catch (e) {
      setGraphCropsError(e instanceof Error ? e.message : "Failed to save graph image");
    } finally {
      setSavingAsGraphCropIds((prev) => {
        const next = new Set(prev);
        next.delete(img.id);
        return next;
      });
    }
  }

  function formatGraphExtractFailureReport(failure: GraphExtractFailure): string {
    const lines: string[] = [];
    lines.push(`Status: ${failure.status}`);
    lines.push("");
    lines.push(`Error: ${failure.error}`);
    lines.push("");
    lines.push("Warnings");
    if (failure.warnings.length > 0) {
      lines.push(...failure.warnings);
    } else {
      lines.push("(none)");
    }
    lines.push("");
    lines.push("Improvement feedback");
    if (failure.feedback.length > 0) {
      lines.push(...failure.feedback);
    } else {
      lines.push("(none)");
    }
    if (failure.graphSpec) {
      lines.push("");
      lines.push("Returned graphSpec JSON");
      lines.push(JSON.stringify(failure.graphSpec, null, 2));
    }
    if (failure.graphMeta) {
      lines.push("");
      lines.push("Returned graphMeta JSON");
      lines.push(JSON.stringify(failure.graphMeta, null, 2));
    }
    return lines.join("\n");
  }

  function summariseRenderedSegments(spec?: IbGraphSpec): string {
    if (!spec?.elements?.length) return "(none)";
    const segmentLines = spec.elements
      .filter((el): el is Extract<IbGraphSpec["elements"][number], { type: "line" | "fn" }> => el.type === "line" || el.type === "fn")
      .map((el, idx) => {
        const left = typeof el.xMin === "number" ? String(el.xMin) : "?";
        const right = typeof el.xMax === "number" ? String(el.xMax) : "?";
        return `${idx + 1}. ${el.type} on [${left}, ${right}] => ${el.expr}`;
      });

    const points = spec.elements
      .filter((el): el is Extract<IbGraphSpec["elements"][number], { type: "point" }> => el.type === "point")
      .map((p) => `(${p.x}, ${p.y})${p.open ? " open" : ""}`);

    const lines: string[] = [];
    lines.push("Segments");
    lines.push(segmentLines.length > 0 ? segmentLines.join("\n") : "(none)");
    lines.push("");
    lines.push("Explicit points");
    lines.push(points.length > 0 ? points.join(", ") : "(none)");
    return lines.join("\n");
  }

  function formatGraphExtractDebugPacket(snapshot: GraphExtractSnapshot): string {
    const lines: string[] = [];
    lines.push("Graph extraction debug packet");
    lines.push(`Question code: ${question.code}`);
    lines.push(`Question id: ${question.id}`);
    lines.push(`Extractor status: ${snapshot.status} (${snapshot.ok ? "ok" : "error"})`);
    lines.push("");

    if (snapshot.error) {
      lines.push("Extractor error");
      lines.push(snapshot.error);
      lines.push("");
    }

    lines.push("Warnings");
    if (snapshot.warnings.length > 0) {
      lines.push(...snapshot.warnings.map((w) => `- ${w}`));
    } else {
      lines.push("(none)");
    }

    lines.push("");
    lines.push("Improvement feedback");
    if (snapshot.feedback.length > 0) {
      lines.push(...snapshot.feedback.map((f) => `- ${f}`));
    } else {
      lines.push("(none)");
    }

    lines.push("");
    lines.push("Rendered graph summary");
    lines.push(summariseRenderedSegments(snapshot.graphSpec));

    if (snapshot.graphSpec) {
      lines.push("");
      lines.push("Rendered graphSpec JSON");
      lines.push(JSON.stringify(snapshot.graphSpec, null, 2));
    }

    if (snapshot.graphMeta) {
      lines.push("");
      lines.push("Rendered graphMeta JSON");
      lines.push(JSON.stringify(snapshot.graphMeta, null, 2));
    }

    lines.push("");
    lines.push("Required correction output format");
    lines.push("Return ONLY JSON with this shape:");
    lines.push(`{\n  \"graphSpec\": {\n    \"xRange\": [number, number],\n    \"yRange\": [number, number],\n    \"elements\": []\n  },\n  \"graphMeta\": {\n    \"description\": \"...\",\n    \"equations\": [],\n    \"xIntercepts\": [],\n    \"yIntercepts\": [],\n    \"verticalAsymptotes\": [],\n    \"horizontalAsymptotes\": [],\n    \"keyPoints\": [],\n    \"domain\": [number, number],\n    \"markschemeHints\": []\n  },\n  \"warnings\": []\n}`);

    return lines.join("\n");
  }

  function copyGraphExtractFailureReport() {
    if (!graphExtractFailure) return;
    const text = formatGraphExtractFailureReport(graphExtractFailure);
    void navigator.clipboard.writeText(text).then(() => {
      setGraphFailureCopied(true);
      setTimeout(() => setGraphFailureCopied(false), 2000);
    });
  }

  function copyGraphExtractDebugPacket() {
    if (!graphExtractSnapshot) return;
    const text = formatGraphExtractDebugPacket(graphExtractSnapshot);
    void navigator.clipboard.writeText(text).then(() => {
      setGraphDebugCopied(true);
      setTimeout(() => setGraphDebugCopied(false), 2000);
    });
  }

  function applyCorrection() {
    setCorrectionParseError(null);
    try {
      const parsed = JSON.parse(correctionJson) as {
        graphSpec?: IbGraphSpec;
        graphMeta?: Record<string, unknown>;
        warnings?: string[];
      };
      if (!parsed.graphSpec) {
        setCorrectionParseError("JSON must have a \"graphSpec\" key.");
        return;
      }
      setGraphSpecJson(JSON.stringify(parsed.graphSpec, null, 2));
      setGraphSpecDirty(true);
      setGraphParseError(null);
      if (Array.isArray(parsed.warnings)) setGraphExtractWarnings(parsed.warnings);
      setShowCorrectionInput(false);
      setCorrectionJson("");
    } catch (e) {
      setCorrectionParseError(String(e));
    }
  }

  async function extractGraphFromImage() {
    setGraphExtracting(true);
    setGraphExtractError(null);
    setGraphExtractFailure(null);
    setGraphExtractSnapshot(null);
    setGraphDebugCopied(false);
    setGraphExtractWarnings([]);
    setGraphExtractFeedback([]);
    setGraphSourceImageB64(null);
    setGraphMeta(null);
    try {
      const res = await fetch("/api/questions/graph-extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: question.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        const snapshot: GraphExtractSnapshot = {
          status: res.status,
          ok: false,
          error: data.error ?? "Graph extraction failed",
          warnings: (data.warnings as string[] | undefined) ?? [],
          feedback: (data.feedback as string[] | undefined) ?? [],
          graphSpec: data.graphSpec as IbGraphSpec | undefined,
          graphMeta: data.graphMeta as Record<string, unknown> | undefined,
        };
        setGraphExtractError(snapshot.error ?? "Graph extraction failed");
        setGraphExtractFailure({
          status: snapshot.status,
          error: snapshot.error ?? "Graph extraction failed",
          warnings: snapshot.warnings,
          feedback: snapshot.feedback,
          graphSpec: snapshot.graphSpec,
          graphMeta: snapshot.graphMeta,
        });
        setGraphExtractSnapshot(snapshot);
        if (Array.isArray(data.warnings) && data.warnings.length > 0) {
          setGraphExtractWarnings(data.warnings as string[]);
        }
        if (Array.isArray(data.feedback) && data.feedback.length > 0) {
          setGraphExtractFeedback(data.feedback as string[]);
        }
        if (data.sourceImageBase64) setGraphSourceImageB64(data.sourceImageBase64 as string);
        if (data.graphMeta) setGraphMeta(data.graphMeta as Record<string, unknown>);
        return;
      }

      const snapshot: GraphExtractSnapshot = {
        status: res.status,
        ok: true,
        warnings: Array.isArray(data.warnings) ? (data.warnings as string[]) : [],
        feedback: Array.isArray(data.feedback) ? (data.feedback as string[]) : [],
        graphSpec: data.graphSpec as IbGraphSpec | undefined,
        graphMeta: data.graphMeta as Record<string, unknown> | undefined,
      };
      setGraphExtractSnapshot(snapshot);

      if (data.graphSpec) {
        setGraphSpecJson(JSON.stringify(data.graphSpec, null, 2));
        setGraphSpecDirty(true);
        setGraphParseError(null);
      }
      if (data.graphMeta) setGraphMeta(data.graphMeta as Record<string, unknown>);
      if (snapshot.warnings.length > 0) setGraphExtractWarnings(snapshot.warnings);
      if (snapshot.feedback.length > 0) {
        setGraphExtractFeedback(snapshot.feedback);
      } else {
        setGraphExtractFeedback([
          "Review each segment endpoint and boundary continuity manually; refine graphSpec if any vertex appears off-grid.",
        ]);
      }
      if (data.sourceImageBase64) setGraphSourceImageB64(data.sourceImageBase64 as string);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unexpected error";
      setGraphExtractError(message);
      setGraphExtractSnapshot({
        status: 0,
        ok: false,
        error: message,
        warnings: [],
        feedback: [
          "Retry extraction, then validate all segment equations from snapped vertex pairs before saving to LaTeX.",
        ],
      });
      setGraphExtractFeedback([
        "Retry extraction, then validate all segment equations from snapped vertex pairs before saving to LaTeX.",
      ]);
    } finally {
      setGraphExtracting(false);
    }
  }

  function parseGraphDraft(): IbGraphSpec | null {
    try {
      const parsed = JSON.parse(graphSpecJson) as IbGraphSpec;
      setGraphParseError(null);
      return parsed;
    } catch (e) {
      setGraphParseError(String(e));
      return null;
    }
  }

  async function saveGraphToField(targetField: "stem_latex" | "parts_draft_latex") {
    const spec = parseGraphDraft();
    if (!spec) return;
    const marker = encodeGraphSpec(spec);
    // Find the current value of the target field and append or replace the marker
    const currentValue: string =
      targetField === "stem_latex"
        ? (question.stem_latex ?? "")
        : (question.parts_draft_latex ?? "");
    // Replace any existing GRAPH_JSON marker or append
    GRAPH_MARKER_RE.lastIndex = 0;
    const hasExisting = GRAPH_MARKER_RE.test(currentValue);
    GRAPH_MARKER_RE.lastIndex = 0;
    const newValue = hasExisting
      ? currentValue.replace(GRAPH_MARKER_RE, marker)
      : `${currentValue.trim()}\n\n${marker}`;
    setGraphSavingField(targetField);
    try {
      await fetch("/api/questions/stem-update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: question.id, field: targetField, value: newValue }),
      });
      onRefresh();
    } finally {
      setGraphSavingField(null);
      setGraphSpecDirty(false);
    }
  }

  async function saveWholeQuestion(field: "q" | "ms") {
    const value = field === "q" ? wholeQDraft : wholeMSDraft;
    setSavingWhole(true);
    try {
      // Reuse the existing null-label part if one already exists; only create if missing
      const latexField = field === "q" ? "content_latex" : "markscheme_latex";
      let partId: string;
      let existingPart = parts.find((p) => !p.part_label || p.part_label.trim() === "");
      if (existingPart) {
        partId = existingPart.id;
      } else {
        const createRes = await fetch("/api/questions/part-metadata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: question.id, partLabel: null, marks: null, commandTerm: null, subtopicCodes: [] }),
        });
        const createData = await createRes.json() as { part?: QuestionPart; error?: string };
        if (!createRes.ok || !createData.part) throw new Error(createData.error ?? "Failed to create part");
        existingPart = { ...createData.part, content_latex: null, markscheme_latex: null, latex_verified: null };
        partId = existingPart.id;
      }
      // Save the LaTeX
      await fetch("/api/questions/latex-update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partId, field: latexField, value }),
      });
      const withLatex = { ...existingPart, [latexField]: value || null };
      setParts([withLatex]);
      setLatexDrafts((d) => ({ ...d, [partId]: { ...d[partId], content_latex: d[partId]?.content_latex ?? "", markscheme_latex: d[partId]?.markscheme_latex ?? "", [latexField]: value } }));
      setEditingWhole(null);
    } finally {
      setSavingWhole(false);
    }
  }

  const [addPartOpen, setAddPartOpen] = useState(false);
  const [newPartDraft, setNewPartDraft] = useState({ partLabel: "", marks: "1", commandTerm: "", subtopicCodes: "" });
  const [pendingParts, setPendingParts] = useState<{ partLabel: string; marks: string; commandTerm: string; subtopicCodes: string }[]>([]);
  const [committingParts, setCommittingParts] = useState(false);
  const [addPartError, setAddPartError] = useState<string | null>(null);

  function stagePart() {
    setPendingParts((prev) => [...prev, { ...newPartDraft }]);
    setNewPartDraft({ partLabel: "", marks: "1", commandTerm: "", subtopicCodes: "" });
    setAddPartError(null);
  }

  function removePending(idx: number) {
    setPendingParts((prev) => prev.filter((_, i) => i !== idx));
  }

  async function commitParts() {
    if (pendingParts.length === 0) return;
    setCommittingParts(true);
    setAddPartError(null);
    const errors: string[] = [];
    for (const draft of pendingParts) {
      try {
        const res = await fetch("/api/questions/part-metadata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            questionId: question.id,
            partLabel: draft.partLabel || null,
            marks: parseInt(draft.marks, 10) || 1,
            commandTerm: draft.commandTerm || null,
            subtopicCodes: draft.subtopicCodes.split(",").map((s) => s.trim()).filter(Boolean),
          }),
        });
        const data = await res.json() as { error?: string; part?: QuestionPart };
        if (!res.ok) { errors.push(data.error ?? "Failed to add part"); continue; }
        const created = { ...data.part!, content_latex: null, markscheme_latex: null, latex_verified: null };
        setParts((prev) => [...prev, created].sort((a, b) => a.sort_order - b.sort_order));
        setLatexDrafts((d) => ({ ...d, [created.id]: { content_latex: "", markscheme_latex: "" } }));
      } catch (err) {
        errors.push(err instanceof Error ? err.message : "Failed");
      }
    }
    setCommittingParts(false);
    if (errors.length > 0) {
      setAddPartError(errors.join("; "));
    } else {
      setPendingParts([]);
      setAddPartOpen(false);
    }
  }

  // Determine whether there is any existing LaTeX content (parts or implied stems)
  function hasExistingContent() {
    return parts.some(
      (p) => (p.content_latex && p.content_latex.trim()) || (p.markscheme_latex && p.markscheme_latex.trim())
    );
  }

  function copyFullExtractDebugOutput() {
    if (fullExtractLog.length === 0 && !fullExtractError) return;
    const lines = [
      "LaTeX extractor debug output",
      `Captured at: ${new Date().toISOString()}`,
      `Question code: ${question.code}`,
      `Question id: ${question.id}`,
      `Extractor state: ${fullExtractState}`,
      "",
      "Progress log",
      ...(fullExtractLog.length > 0 ? fullExtractLog.map((msg, i) => `${i + 1}. ${msg}`) : ["(empty)"]),
      "",
      "Error",
      fullExtractError ?? "(none)",
    ];

    void navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setFullExtractCopied(true);
      setTimeout(() => setFullExtractCopied(false), 2000);
    });
  }

  async function runFullExtract() {
    setFullExtractState("running");
    setFullExtractLog([]);
    setFullExtractError(null);
    setFullExtractCopied(false);
    const log: string[] = [];
    const push = (msg: string) => {
      log.push(msg);
      setFullExtractLog([...log]);
    };

    try {
      const hasQ = images.some((i) => i.image_type === "question");
      const hasMS = images.some((i) => i.image_type === "markscheme");
      let qDraft = "";
      let msDraft = "";

      // ── Always run the full multi-part pipeline ─────────────────────────
      // The isWholeQuestion fallback at the end handles genuinely single-part
      // questions. Bypassing OCR+Claude here prevented part detection entirely.

      if (hasQ) {
        push("Extracting LaTeX from question images (OCR)…");
        const res = await fetch("/api/questions/ocr-latex", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: question.id, field: "parts_draft_latex" }),
        });
        if (res.ok) {
          const d = await res.json();
          qDraft = d.latex ?? "";
          push(`Question OCR complete (${qDraft.length} chars).`);
        } else {
          push("⚠ Question OCR unavailable — using empty draft.");
        }
      } else {
        push("No question images found — skipping question OCR.");
      }

      if (hasMS) {
        push("Extracting LaTeX from mark scheme images (OCR)…");
        const res = await fetch("/api/questions/ocr-latex", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: question.id, field: "parts_draft_markscheme_latex" }),
        });
        if (res.ok) {
          const d = await res.json();
          msDraft = d.latex ?? "";
          push(`Mark scheme OCR complete (${msDraft.length} chars).`);
        } else {
          push("⚠ Mark scheme OCR unavailable — using empty draft.");
        }
      } else {
        push("No mark scheme images found — skipping MS OCR.");
      }

      if (!qDraft && !msDraft) {
        throw new Error("No OCR output produced. Make sure images are uploaded.");
      }

      // Claude classification
      push("Analysing question structure with Claude…");
      let claudeParts: { label: string; marks: number; commandTerm: string; subtopicCodes: string[] }[] = [];
      try {
        const subtopicList = availableSubtopics.map((s) => `${s.code}: ${s.descriptor}`).join("\n");
        const labelHint = parts.length > 0 && parts[0].part_label
          ? parts.map((p) => p.part_label ?? "").join(", ")
          : "unknown — determine from LaTeX";
        const clRes = await fetch("/api/claude", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system: IB_CLASSIFY_SYSTEM,
            messages: [{
              role: "user",
              content: `Question LaTeX:\n\`\`\`\n${qDraft}\n\`\`\`\n\nMark Scheme LaTeX:\n\`\`\`\n${msDraft}\n\`\`\`\n\nAvailable subtopics:\n${subtopicList}\n\nKnown part labels (if any): ${labelHint}`,
            }],
          }),
        });
        if (clRes.ok) {
          const data = await readJsonSafely<{ content?: { text?: string }[] }>(clRes);
          const text: string = data?.content?.[0]?.text ?? "";
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) claudeParts = JSON.parse(jsonMatch[0]).parts ?? [];
          push(`Claude identified ${claudeParts.length} part(s): ${claudeParts.map((p) => p.label || "whole").join(", ")}.`);
        }
      } catch {
        push("⚠ Claude classification failed — part structure inferred from OCR labels.");
      }

      const detectedLabels = detectPartLabels(qDraft || msDraft);
      const claudeLabels = claudeParts.map((p) => (p.label ?? "").trim()).filter(Boolean);
      const claudeCountLabels =
        claudeLabels.length === 0 && claudeParts.length > 1
          ? Array.from({ length: claudeParts.length }, (_, i) => String.fromCharCode(97 + i))
          : [];
      const candidateLabels = claudeLabels.length > 0 ? claudeLabels : (detectedLabels.length > 0 ? detectedLabels : claudeCountLabels);
      // Probe using the full combined text (question + mark scheme) so that the
      // mark scheme's explicit (a)/(b) line-start markers are visible to the splitter.
      // Using only qDraft || msDraft caused failures when the question OCR was short
      // and only contained inline references like "result from part (a)".
      const combinedDraft = `${qDraft}\n\n${msDraft}`;
      const splitProbe = splitDraftIntoParts(combinedDraft, candidateLabels);
      const inferredLabels = candidateLabels.length > 0 ? candidateLabels : Array.from(splitProbe.parts.keys());
      let finalLabels = Array.from(new Set(inferredLabels.map((l) => l.trim()).filter(Boolean)));

      // Guard against false positives: OCR text like "where (a) ..." can be
      // misread as a single part label. Only trust a lone "a" when structure
      // markers clearly indicate multipart formatting.
      const hasExplicitPartEnvironment = hasExplicitTopLevelPartStructure(combinedDraft);
      const strongLabelMatches = Array.from(
        combinedDraft.matchAll(/(?:^|\n)\s*\(([a-z](?:i|ii|iii|iv|v)?)\)\s+/gi),
      );
      const strongUniqueLabels = new Set(strongLabelMatches.map((m) => (m[1] ?? "").toLowerCase()));

      const canTrustClaudeMultipartWithoutExplicit =
        !hasExplicitPartEnvironment
        && shouldTrustMultipartWithoutExplicit({
          claudeLabelsCount: claudeLabels.length,
          splitProbePartsCount: splitProbe.parts.size,
        });

      // If no explicit top-level part markers exist, force whole-question mode.
      // This prevents synthetic fallback labels like "a" from unlabeled OCR blocks.
      if (!hasExplicitPartEnvironment && finalLabels.length > 0 && !canTrustClaudeMultipartWithoutExplicit) {
        push("No explicit top-level part labels found; using whole-question mode.");
        finalLabels = [];
      } else if (canTrustClaudeMultipartWithoutExplicit) {
        push("No explicit top-level markers found, but Claude labels + extracted part structure support multipart extraction.");
      }

      const isSuspiciousSingleA =
        finalLabels.length === 1
        && normalizePartLabelKey(finalLabels[0]) === "a"
        && !hasExplicitPartEnvironment
        && strongUniqueLabels.size < 2;
      if (isSuspiciousSingleA) {
        push("Single '(a)' marker looked incidental; using whole-question mode.");
        finalLabels = [];
      }

      if (claudeLabels.length === 0 && finalLabels.length > 0) {
        const source = detectedLabels.length > 0 ? "OCR text" : (claudeCountLabels.length > 0 ? "Claude part count" : "structure inference");
        push(`Claude returned no labels; inferred ${finalLabels.length} part label(s) from ${source}: ${finalLabels.join(", ")}.`);
      }

      // Split the drafts using final labels (Claude, OCR-detected, or inferred)
      const { stem: stemQ, parts: splitQ } = splitDraftIntoParts(qDraft, finalLabels);
      const { stem: stemMS, parts: splitMS } = splitDraftIntoParts(msDraft, finalLabels);

      const expectedExistingLabels = parts
        .map((p) => (p.part_label ?? "").trim())
        .filter(Boolean);
      const saveGuard = shouldBlockPartAutoSave({
        expectedLabels: expectedExistingLabels,
        splitQuestion: splitQ,
        splitMarkscheme: splitMS,
      });

      // Build the extraction plan and launch the step-by-step review wizard.
      // No data is written to the database until the user confirms all steps.
      // Pre-seed editable marks from Claude data or \hfill [N] inference.
      const partMarks = new Map<string, number>();
      if (finalLabels.length === 0) {
        const cpMeta = claudeParts[0];
        const m = (typeof cpMeta?.marks === "number" && cpMeta.marks > 0)
          ? cpMeta.marks : parseMarksFromLatex(qDraft) ?? 1;
        partMarks.set("", m);
      } else {
        for (const label of finalLabels) {
          const normLabel = normalizePartLabelKey(label);
          const cp = claudeParts.find((p) => normalizePartLabelKey(p.label ?? "") === normLabel);
          const sq = splitQ.get(label) ?? "";
          const sm = splitMS.get(label) ?? "";
          const m = (typeof cp?.marks === "number" && cp.marks > 0)
            ? cp.marks : parseMarksFromLatex(sq || sm) ?? 1;
          partMarks.set(label, m);
        }
      }
      const extractionPlan: ExtractPlan = {
        qDraft,
        msDraft,
        finalLabels,
        isWholeQuestion: finalLabels.length === 0,
        stemQ,
        stemMS,
        splitQ,
        splitMS,
        claudeParts,
        partMarks,
        debug: {
          claudeLabels,
          detectedLabels,
          candidateLabels,
          inferredLabels,
          hasExplicitPartEnvironment,
          canTrustClaudeMultipart: canTrustClaudeMultipartWithoutExplicit,
          isSuspiciousSingleA,
          strongUniqueLabels: Array.from(strongUniqueLabels),
          splitProbeKeys: Array.from(splitProbe.parts.keys()),
          saveGuardBlocked: finalLabels.length > 0 && saveGuard.block,
          saveGuardReason: saveGuard.reason,
          logLines: [...log],
        },
      };
      setExtractPlan(extractionPlan);
      setFullExtractState("reviewing");
      push("Extraction ready — please review the results in the popup.");
    } catch (e) {
      setFullExtractError(e instanceof Error ? e.message : "Unexpected error");
      setFullExtractState("idle");
    }
  }

  async function commitExtractPlan(plan: ExtractPlan) {
    setFullExtractState("running");
    setFullExtractError(null);
    const push = (msg: string) => {
      setFullExtractLog((prev) => [...prev, msg]);
    };

    try {
      const { finalLabels, qDraft, msDraft, stemQ, stemMS, splitQ, splitMS, claudeParts } = plan;
      const claudeLabels = plan.debug.claudeLabels;

      // Whole-question path: no labels from Claude/OCR/inference.
      if (plan.isWholeQuestion) {
        const cpMeta = claudeParts[0]; // may be undefined if claudeParts is empty
        const extractedWholeTerm = chooseCommandTerm({
          questionLatex: qDraft,
          markschemeLatex: msDraft,
          claudeCommandTerm: cpMeta?.commandTerm ?? null,
        });
        const extractedWholeTerms = chooseCommandTerms({
          questionLatex: qDraft,
          markschemeLatex: msDraft,
          claudeCommandTerm: cpMeta?.commandTerm ?? null,
        });
        push("No part structure found — treating as whole question…");
        // Find or create a null-label (whole-question) part
        let wholePartId: string;
        const existingWhole = parts.find((p) => !p.part_label || p.part_label.trim() === "");
        if (existingWhole) {
          wholePartId = existingWhole.id;
          // Update metadata from Claude if available
          if (cpMeta) {
            await fetch("/api/questions/part-metadata", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                partId: wholePartId,
                marks: plan.partMarks?.get("") ?? ((typeof cpMeta.marks === "number" && cpMeta.marks > 0) ? cpMeta.marks : parseMarksFromLatex(qDraft) ?? null),
                commandTerm: extractedWholeTerm,
                commandTerms: extractedWholeTerms,
                sourceLatex: qDraft,
                subtopicCodes: cpMeta.subtopicCodes ?? [],
              }),
            });
          }
        } else {
          const createRes = await fetch("/api/questions/part-metadata", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              questionId: question.id,
              partLabel: null,
              marks: plan.partMarks?.get("") ?? ((typeof cpMeta?.marks === "number" && cpMeta.marks > 0) ? cpMeta.marks : parseMarksFromLatex(qDraft) ?? null),
              commandTerm: extractedWholeTerm,
              commandTerms: extractedWholeTerms,
              sourceLatex: qDraft,
              subtopicCodes: cpMeta?.subtopicCodes ?? [],
            }),
          });
          if (!createRes.ok) throw new Error("Failed to create whole-question part");
          const { part: created } = await createRes.json();
          if (!created?.id) throw new Error("Part creation returned no id");
          wholePartId = created.id;
        }
        await Promise.all([
          fetch("/api/questions/latex-update", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ partId: wholePartId, field: "content_latex", value: qDraft }),
          }),
          fetch("/api/questions/latex-update", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ partId: wholePartId, field: "markscheme_latex", value: msDraft }),
          }),
        ]);
        const wholePart: QuestionPart = existingWhole
          ? { ...existingWhole, content_latex: qDraft || null, markscheme_latex: msDraft || null }
          : { id: wholePartId, part_label: "", marks: 0, subtopic_codes: [], command_term: null, sort_order: 0, content_latex: qDraft || null, markscheme_latex: msDraft || null, latex_verified: null };
        setParts([wholePart]);
        setLatexDrafts({ [wholePartId]: { content_latex: qDraft, markscheme_latex: msDraft } });
        setWholeQDraft(qDraft);
        setWholeMSDraft(msDraft);
        push("Done! Whole question LaTeX saved.");
        onRefresh();
        setTimeout(() => setFullExtractState("idle"), 3000);
        return;
      }

      // Multi-part path: save stem only when there are actual parts
      push("Saving stems…");
      await Promise.all([
        fetch("/api/questions/stem-update", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: question.id, field: "stem_latex", value: stemQ }),
        }),
        fetch("/api/questions/stem-update", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: question.id, field: "stem_markscheme_latex", value: stemMS }),
        }),
      ]);
      setStemLatex(stemQ);
      setStemDraftQ(stemQ);
      setStemMsLatex(stemMS);
      setStemDraftMS(stemMS);

      // For each identified part label: find existing or create, then save LaTeX
      push("Saving parts…");
      const newParts: QuestionPart[] = [];
      const labelPlans = finalLabels.map((label, idx) => {
        const normalizedLabel = normalizePartLabelKey(label);
        const cpByLabel = claudeParts.find((p) => normalizePartLabelKey(p.label ?? "") === normalizedLabel);
        const cpByOrder = claudeLabels.length === 0 && claudeParts.length > 1 ? claudeParts[idx] : undefined;
        const cp = cpByLabel ?? cpByOrder;
        const splitQForLabel = splitQ.get(label) ?? "";
        const splitMSForLabel = splitMS.get(label) ?? "";
        const perPartTerms = chooseCommandTerms({
          questionLatex: splitQForLabel,
          markschemeLatex: splitMSForLabel,
          claudeCommandTerm: cp?.commandTerm ?? null,
        });
        return {
          idx,
          label,
          normalizedLabel,
          cp,
          splitQForLabel,
          splitMSForLabel,
          stem: romanSubpartStem(label),
          perPartTerms,
        };
      });

      const familyTerms = new Map<string, string[]>();
      const familySourceLatex = new Map<string, string>();
      const familyMembers = new Map<string, typeof labelPlans>();
      for (const lp of labelPlans) {
        if (!lp.stem) continue;
        const current = familyMembers.get(lp.stem) ?? [];
        current.push(lp);
        familyMembers.set(lp.stem, current);
      }
      for (const [stem, members] of familyMembers.entries()) {
        if (members.length < 2) continue;
        const combinedQ = members.map((m) => m.splitQForLabel).filter(Boolean).join("\n");
        const combinedMS = members.map((m) => m.splitMSForLabel).filter(Boolean).join("\n");
        const combinedTerms = mergeHighlightTerms(...members.map((m) => m.perPartTerms));
        const canonicalCombinedTerms = combinedTerms
          .map((term) => DEFAULT_COMMAND_TERMS.find((t) => t.toLowerCase() === term.toLowerCase()))
          .filter((t): t is string => Boolean(t));
        const primary = chooseCommandTerm({
          questionLatex: combinedQ,
          markschemeLatex: combinedMS,
          claudeCommandTerm: members[0]?.cp?.commandTerm ?? null,
        });
        familyTerms.set(stem, mergeHighlightTerms([primary], canonicalCombinedTerms));
        familySourceLatex.set(stem, combinedQ || members[0]?.splitQForLabel || "");
      }

      for (const lp of labelPlans) {
        const { label, normalizedLabel, cp, splitQForLabel, splitMSForLabel, stem, perPartTerms } = lp;
        const existing = parts.find((p) => normalizePartLabelKey(p.part_label ?? "") === normalizedLabel);
        let partId: string;
        const canonicalTerms = stem && familyTerms.has(stem) ? (familyTerms.get(stem) ?? perPartTerms) : perPartTerms;
        const canonicalTerm = canonicalTerms[0] ?? chooseCommandTerm({
          questionLatex: splitQForLabel,
          markschemeLatex: splitMSForLabel,
          claudeCommandTerm: cp?.commandTerm ?? null,
        });
        const sourceForMetadata = stem && familySourceLatex.has(stem)
          ? (familySourceLatex.get(stem) ?? splitQForLabel)
          : splitQForLabel;
        const exceptionFlags = deriveCommandTermFlags({ commandTerm: canonicalTerm, sourceLatex: sourceForMetadata });

        if (existing) {
          // Update metadata
          await fetch("/api/questions/part-metadata", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              partId: existing.id,
              partLabel: label,
              marks: plan.partMarks?.get(label) ?? ((typeof cp?.marks === "number" && cp.marks > 0) ? cp.marks : parseMarksFromLatex(splitQForLabel || splitMSForLabel) ?? existing.marks),
              commandTerm: canonicalTerm,
              commandTerms: canonicalTerms,
              sourceLatex: sourceForMetadata,
              subtopicCodes: cp?.subtopicCodes ?? existing.subtopic_codes,
            }),
          });
          partId = existing.id;
          newParts.push({
            ...existing,
            part_label: label,
            marks: plan.partMarks?.get(label) ?? ((typeof cp?.marks === "number" && cp.marks > 0) ? cp.marks : parseMarksFromLatex(splitQForLabel || splitMSForLabel) ?? existing.marks),
            command_term: canonicalTerm,
            command_terms: canonicalTerms,
            ...exceptionFlags,
            subtopic_codes: cp?.subtopicCodes ?? existing.subtopic_codes,
            content_latex: splitQForLabel || null,
            markscheme_latex: splitMSForLabel || null,
          });
        } else {
          // Create new part
          const res = await fetch("/api/questions/part-metadata", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              questionId: question.id,
              partLabel: label,
              marks: plan.partMarks?.get(label) ?? ((typeof cp?.marks === "number" && cp.marks > 0) ? cp.marks : parseMarksFromLatex(splitQForLabel || splitMSForLabel) ?? null),
              commandTerm: canonicalTerm,
              commandTerms: canonicalTerms,
              sourceLatex: sourceForMetadata,
              subtopicCodes: cp?.subtopicCodes ?? [],
            }),
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            push(`⚠ Failed to create part ${label || "(whole)"}: ${errData.error ?? res.status}`);
            continue;
          }
          const { part: created } = await res.json();
          if (!created?.id) { push(`⚠ Part ${label} creation returned no id`); continue; }
          partId = created.id;
          newParts.push({
            ...created,
            part_label: label,
            marks: plan.partMarks?.get(label) ?? ((typeof cp?.marks === "number" && cp.marks > 0) ? cp.marks : parseMarksFromLatex(splitQForLabel || splitMSForLabel) ?? created.marks),
            command_term: canonicalTerm,
            command_terms: canonicalTerms,
            ...exceptionFlags,
            subtopic_codes: cp?.subtopicCodes ?? created.subtopic_codes,
            content_latex: splitQForLabel || null,
            markscheme_latex: splitMSForLabel || null,
          });
        }

        // Save LaTeX for the part
        await Promise.all([
          fetch("/api/questions/latex-update", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ partId, field: "content_latex", value: splitQForLabel }),
          }),
          fetch("/api/questions/latex-update", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ partId, field: "markscheme_latex", value: splitMSForLabel }),
          }),
        ]);
      }

      if (finalLabels.length > 0) {
        const wholeQuestionParts = parts.filter((p) => !p.part_label || p.part_label.trim() === "");
        if (wholeQuestionParts.length > 0) {
          await Promise.all(
            wholeQuestionParts.map((p) =>
              fetch(`/api/questions/part-metadata?partId=${encodeURIComponent(p.id)}`, { method: "DELETE" })
            )
          );
        }
      }

      // Update local state — merge: keep any existing parts not touched by extraction,
      // plus all newly created / updated parts
      const updatedById: Record<string, QuestionPart> = {};
      newParts.forEach((p) => { updatedById[p.id] = p; });
      const mergedParts = parts
        .map((p) => updatedById[p.id] ?? p)  // update existing in-place
        .concat(newParts.filter((p) => !parts.some((ep) => ep.id === p.id)));  // add truly new
      const sortedMerged = (finalLabels.length > 0
        ? mergedParts.filter((p) => p.part_label && p.part_label.trim() !== "")
        : mergedParts
      ).sort((a, b) => a.sort_order - b.sort_order);
      setParts(sortedMerged);
      const newDrafts: Record<string, { content_latex: string; markscheme_latex: string }> = {};
      sortedMerged.forEach((p) => {
        newDrafts[p.id] = {
          content_latex: p.content_latex ?? "",
          markscheme_latex: p.markscheme_latex ?? "",
        };
      });
      setLatexDrafts(newDrafts);

      if (finalLabels.length > 0 && newParts.length === 0) {
        throw new Error("No parts were saved. Existing parts may use labels with different formatting (for example b(i) vs bi).");
      }

      push("Done! All LaTeX extracted and saved.");
      // Refresh parent question list so data stays in sync
      onRefresh();
      setTimeout(() => setFullExtractState("idle"), 3000);
    } catch (e) {
      setFullExtractError(e instanceof Error ? e.message : "Unexpected error");
      setFullExtractState("idle");
    }
  }

  async function extractLatexFromImages(partId: string, field: "content_latex" | "markscheme_latex") {
    setExtractingLatexField({ partId, field });
    // Switch to edit mode immediately so the user sees the result land
    setEditingLatex({ partId, field });
    try {
      const draftField = field === "content_latex" ? "parts_draft_latex" : "parts_draft_markscheme_latex";
      const res = await fetch("/api/questions/ocr-latex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: question.id, field: draftField }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const fullLatex: string = data.latex ?? "";
      if (!fullLatex) return;
      // Split by part labels and pick this part's slice
      const partLabels = parts.map((p) => p.part_label ?? "");
      const { stem, parts: splitMap } = splitDraftIntoParts(fullLatex, partLabels);
      const thisPart = parts.find((p) => p.id === partId);
      const thisLabel = thisPart?.part_label ?? "";
      // Use normalized label matching first; this handles labels like b(i) vs bi.
      const splitByNormalized = Array.from(splitMap.entries()).find(
        ([k]) => normalizePartLabelKey(k) === normalizePartLabelKey(thisLabel)
      )?.[1];
      // Use the split slice if found, otherwise fall back to stem (single-part question)
      const extracted = splitByNormalized ?? splitMap.get(thisLabel) ?? stem ?? fullLatex;
      setLatexDrafts((d) => ({
        ...d,
        [partId]: { ...d[partId], [field]: extracted },
      }));
    } finally {
      setExtractingLatexField(null);
    }
  }

  async function runClaude(partId: string, field: "content_latex" | "markscheme_latex") {
    const key = `${partId}-${field}`;
    const instruction = claudeInstruction[key] ?? "";
    if (!instruction.trim()) return;
    setClaudeLoading((l) => ({ ...l, [key]: true }));
    const currentLatex = latexDrafts[partId]?.[field] ?? "";
    try {
      const res = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: IB_CORRECTION_SYSTEM,
          messages: [{
            role: "user",
            content: `Here is the current LaTeX for this question part:\n\n\`\`\`\n${currentLatex}\n\`\`\`\n\nInstruction: ${instruction}\n\nReturn ONLY the corrected LaTeX, nothing else.`,
          }],
        }),
      });
      const data = await readJsonSafely<{ content?: { text?: string }[] }>(res);
      const corrected: string = data?.content?.[0]?.text ?? "";
      if (corrected) {
        setLatexDrafts((d) => ({ ...d, [partId]: { ...d[partId], [field]: corrected.trim() } }));
        setEditingLatex({ partId, field });
      }
    } finally {
      setClaudeLoading((l) => ({ ...l, [key]: false }));
      setClaudeInstruction((c) => ({ ...c, [key]: "" }));
    }
  }

  async function saveLatex(partId: string, field: "content_latex" | "markscheme_latex") {
    const value = latexDrafts[partId]?.[field] ?? "";
    setSavingLatex(true);
    try {
      const res = await fetch("/api/questions/latex-update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partId, field, value }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setParts((prev) => prev.map((p) => (p.id === partId ? { ...p, [field]: value || null } : p)));
      setEditingLatex(null);
    } finally {
      setSavingLatex(false);
    }
  }

  // Close modal on Escape key
  useEffect(() => {
    if (!expanded) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [expanded, handleClose]);

  useEffect(() => {
    if (!expanded) return;
    void fetchGraphCrops();
  }, [expanded, fetchGraphCrops]);

  // True when the question has at least one part with a letter label (a, b, c…)
  const hasLabeledParts = parts.some((p) => p.part_label && p.part_label.trim() !== "");
  const sortedLabeledParts = [...parts]
    .filter((p) => p.part_label && p.part_label.trim() !== "")
    .sort((a, b) => a.sort_order - b.sort_order);

  const buildCombinedLatex = (field: "content_latex" | "markscheme_latex") => {
    const stem = (field === "content_latex" ? stemLatex : stemMsLatex).trim();
    const partBlocks = sortedLabeledParts
      .map((p) => (p[field] ?? "").trim())
      .filter(Boolean)
      .map((body) => `\\begin{IBPart}\n${body}\n\\end{IBPart}`);
    return [stem, ...partBlocks].filter(Boolean).join("\n\n").trim();
  };

  return (
    <>
      <tr
        className="cursor-pointer hover:bg-blue-50 transition-colors"
        onClick={handleRowClick}
      >
        <td className="px-4 py-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleRowClick();
            }}
            className="font-bold text-blue-900 hover:underline"
            title="Open question details"
          >
            {question.code}
          </button>
        </td>
        <td className="px-4 py-2 text-center text-sm font-semibold text-gray-800">
          {question.session}
        </td>
        <td className="px-4 py-2 text-center text-sm font-semibold text-gray-800">
          P{question.paper}
        </td>
        <td className="px-4 py-2 text-center">
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${
              question.level === "AHL"
                ? "bg-purple-100 text-purple-800"
                : "bg-green-100 text-green-800"
            }`}
          >
            {question.level === "AHL" ? "HL" : question.level}
          </span>
        </td>
        <td className="px-4 py-2 text-center text-sm font-semibold text-gray-800">
          {question.timezone}
        </td>
        <td className="px-4 py-2 text-center text-sm font-bold text-blue-900">
          {question.question_parts.length}
        </td>
        <td className="px-4 py-2 text-center text-sm font-bold text-blue-900">
          {totalMarks}
        </td>
        <td className="px-4 py-2 text-center">
          <div className="flex items-center justify-center gap-2">
            <a
              href={`https://docs.google.com/document/d/${question.google_doc_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline text-xs font-semibold"
              onClick={(e) => e.stopPropagation()}
              title="Question images"
            >
              📄 Q
            </a>
            {question.google_ms_id && (
              <a
                href={`https://docs.google.com/document/d/${question.google_ms_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-green-600 hover:underline text-xs font-semibold"
                onClick={(e) => e.stopPropagation()}
                title="Markscheme images"
              >
                📝 MS
              </a>
            )}
          </div>
        </td>
        {/* Section badge (editable for P1/P2) */}
        <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
          {showSection ? (
            <div className="flex items-center justify-center gap-1">
              <button
                type="button"
                disabled={savingSection}
                onClick={() => onUpdateSection("A")}
                className={`rounded px-1.5 py-0.5 text-xs font-bold transition-colors ${
                  question.section === "A"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-500 hover:bg-blue-100"
                }`}
              >
                A
              </button>
              <button
                type="button"
                disabled={savingSection}
                onClick={() => onUpdateSection("B")}
                className={`rounded px-1.5 py-0.5 text-xs font-bold transition-colors ${
                  question.section === "B"
                    ? "bg-orange-500 text-white"
                    : "bg-gray-100 text-gray-500 hover:bg-orange-100"
                }`}
              >
                B
              </button>
            </div>
          ) : (
            <span className="text-xs text-gray-400">—</span>
          )}
        </td>
        {/* Add to test button */}
        {testBuilderOpen && (
          <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
            {question.has_question_images ? (
              <button
                type="button"
                onClick={onAddToQueue}
                disabled={inQueue}
                title={inQueue ? "Already in queue" : "Add to test"}
                className={`rounded-full w-7 h-7 text-sm font-bold transition-colors ${
                  inQueue
                    ? "bg-indigo-100 text-indigo-400 cursor-default"
                    : "bg-indigo-600 text-white hover:bg-indigo-700"
                }`}
              >
                {inQueue ? "✓" : "+"}
              </button>
            ) : (
              <span className="text-xs text-gray-300" title="No images extracted">—</span>
            )}
          </td>
        )}
      </tr>
      {expanded && typeof document !== "undefined" && createPortal(
        <>
        {/* ── Extraction review wizard ── */}
        {extractPlan && (
          <ExtractionReviewModal
            plan={extractPlan}
            questionCode={question.code}
            images={images}
            onConfirm={(confirmedPlan) => {
              setExtractPlan(null);
              void commitExtractPlan(confirmedPlan);
            }}
            onCancel={() => {
              setExtractPlan(null);
              setFullExtractState("idle");
              setFullExtractLog([]);
            }}
          />
        )}
        {/* ── Section prompt overlay ── */}
        {showSectionPrompt && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
            <div className="bg-white rounded-2xl shadow-2xl border border-amber-300 p-6 w-80 flex flex-col gap-4">
              <div>
                <p className="text-base font-bold text-gray-900 mb-1">Pick a section before closing</p>
                <p className="text-sm text-gray-500">
                  <span className="font-mono font-semibold text-blue-800">{question.code}</span> is P{question.paper} — assign it to Section A or B first.
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => { onUpdateSection("A"); setShowSectionPrompt(false); onClose(); }}
                  className="flex-1 rounded-lg bg-blue-600 text-white font-bold py-2 text-sm hover:bg-blue-700 transition-colors"
                >
                  Section A
                </button>
                <button
                  type="button"
                  onClick={() => { onUpdateSection("B"); setShowSectionPrompt(false); onClose(); }}
                  className="flex-1 rounded-lg bg-orange-500 text-white font-bold py-2 text-sm hover:bg-orange-600 transition-colors"
                >
                  Section B
                </button>
              </div>
              <button
                type="button"
                onClick={() => { setShowSectionPrompt(false); onClose(); }}
                className="text-xs text-gray-400 hover:text-gray-600 underline text-center"
              >
                Close without picking
              </button>
            </div>
          </div>
        )}
        {minimized ? (
          /* ── Minimized bar ── */
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t-2 border-blue-300 shadow-xl px-5 py-2 flex items-center gap-4">
            <span className="font-mono font-bold text-blue-900 text-sm">{question.code}</span>
            <span className="text-xs text-gray-500">
              {question.session} · P{question.paper} · {question.level} · TZ{question.timezone}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMinimized(false)}
                title="Restore editor"
                className="rounded px-3 py-1.5 text-xs font-bold bg-blue-100 text-blue-800 hover:bg-blue-200 transition-colors"
              >
                ▲ Restore
              </button>
              <button
                type="button"
                onClick={handleClose}
                title="Close editor"
                className="rounded w-7 h-7 flex items-center justify-center text-sm font-bold bg-gray-100 text-gray-700 hover:bg-red-100 hover:text-red-700 transition-colors"
              >
                ✕
              </button>
            </div>
          </div>
        ) : (
          /* ── Full-screen modal ── */
          <div className="fixed inset-0 z-50 flex flex-col bg-white overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-4 px-5 py-3 bg-blue-900 text-white shadow-md shrink-0">
              <span className="font-mono font-bold text-lg">{question.code}</span>
              <span className="text-sm text-blue-200">
                {question.session} · P{question.paper} · {question.level} · TZ{question.timezone}
              </span>
              {(() => {
                const editorMarks = parts.reduce((s, p) => s + p.marks, 0);
                const mpm = question.level === "SL" ? 9 / 8 : 12 / 11;
                return editorMarks > 0 ? (
                  <span className="text-xs bg-blue-700 rounded-full px-2.5 py-0.5 font-semibold text-blue-100">
                    {editorMarks} marks · ≈{Math.round(editorMarks * mpm)} min
                  </span>
                ) : null;
              })()}
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMinimized(true)}
                  title="Minimize"
                  className="rounded px-3 py-1.5 text-xs font-bold bg-blue-700 hover:bg-blue-600 text-white transition-colors"
                >
                  — Minimize
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  title="Close"
                  className="rounded px-3 py-1.5 text-xs font-bold bg-red-600 hover:bg-red-500 text-white transition-colors"
                >
                  ✕ Close
                </button>
              </div>
            </div>
            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto bg-blue-50 space-y-6 p-6">

                {/* ── Question metadata ── */}
                <div className="bg-white rounded-xl border border-blue-200 px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
                  <span className="text-xs font-bold text-blue-900 uppercase tracking-wide mr-1">Question details</span>
                  {/* Pills */}
                  <span className="px-2.5 py-0.5 bg-blue-50 rounded-full text-blue-800 font-semibold text-xs">{question.session}</span>
                  <span className="px-2.5 py-0.5 bg-blue-50 rounded-full text-blue-800 font-semibold text-xs">Paper {question.paper}</span>
                  <span className={`px-2.5 py-0.5 rounded-full font-semibold text-xs ${question.level === "AHL" ? "bg-purple-100 text-purple-800" : "bg-green-100 text-green-800"}`}>
                    {question.level === "AHL" ? "HL" : question.level}
                  </span>
                  <span className="px-2.5 py-0.5 bg-blue-50 rounded-full text-blue-800 font-semibold text-xs">{question.timezone}</span>
                  {question.curriculum?.length > 0 && (
                    <span className="px-2.5 py-0.5 bg-gray-100 rounded-full text-gray-700 font-semibold text-xs">{question.curriculum.join(", ")}</span>
                  )}
                  {question.difficulty != null && (
                    <span className="px-2.5 py-0.5 bg-yellow-50 rounded-full text-yellow-800 font-semibold text-xs">Difficulty {question.difficulty}</span>
                  )}
                  {/* Section A/B (only for P1/P2) */}
                  {showSection && (
                    <>
                      <span className="text-xs font-bold text-blue-900 ml-1">Section:</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={savingSection}
                          onClick={() => onUpdateSection("A")}
                          className={`rounded px-2 py-0.5 text-xs font-bold transition-colors ${
                            question.section === "A"
                              ? "bg-blue-600 text-white"
                              : "bg-gray-100 text-gray-500 hover:bg-blue-100"
                          }`}
                        >
                          A
                        </button>
                        <button
                          type="button"
                          disabled={savingSection}
                          onClick={() => onUpdateSection("B")}
                          className={`rounded px-2 py-0.5 text-xs font-bold transition-colors ${
                            question.section === "B"
                              ? "bg-orange-500 text-white"
                              : "bg-gray-100 text-gray-500 hover:bg-orange-100"
                          }`}
                        >
                          B
                        </button>
                        {savingSection && <span className="text-xs text-gray-400">Saving…</span>}
                      </div>
                    </>
                  )}
                  {/* Source docs */}
                  <div className="flex flex-wrap items-center gap-3 ml-1">
                    <span className="text-xs font-bold text-blue-900">Source docs:</span>
                    {hasDocLinkConflict && !editingLinks && (
                      <span className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-800">
                        Question doc and markscheme doc are the same file. Fix the question doc link before extracting.
                      </span>
                    )}
                    {editingLinks ? (
                      <div className="flex flex-col gap-2 w-full mt-1">
                        <label className="flex flex-col gap-0.5">
                          <span className="text-[11px] font-semibold text-blue-700">📄 Question Doc URL or ID</span>
                          <input
                            type="text"
                            value={linkDraftQ}
                            onChange={(e) => setLinkDraftQ(e.target.value)}
                            placeholder="https://docs.google.com/document/d/… or doc ID"
                            className="rounded border border-blue-300 px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-400 w-full max-w-xl"
                          />
                        </label>
                        <label className="flex flex-col gap-0.5">
                          <span className="text-[11px] font-semibold text-green-700">📝 Markscheme Doc URL or ID</span>
                          <input
                            type="text"
                            value={linkDraftMS}
                            onChange={(e) => setLinkDraftMS(e.target.value)}
                            placeholder="https://docs.google.com/document/d/… or doc ID (leave blank to unlink)"
                            className="rounded border border-green-300 px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-green-400 w-full max-w-xl"
                          />
                        </label>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={saveLinks}
                            disabled={savingLinks}
                            className="rounded bg-blue-600 px-3 py-1 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            {savingLinks ? "Saving…" : "Save Links"}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setEditingLinks(false); setLinkDraftQ(question.google_doc_id ?? ""); setLinkDraftMS(question.google_ms_id ?? ""); }}
                            disabled={savingLinks}
                            className="rounded border border-gray-300 px-3 py-1 text-xs font-bold text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {question.google_doc_id ? (
                          <span className="inline-flex items-center gap-1">
                            <a
                              href={`https://docs.google.com/document/d/${question.google_doc_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"
                            >
                              📄 Question Doc
                            </a>
                            <button
                              type="button"
                              onClick={() => unlinkDoc("q")}
                              disabled={unlinkingDoc !== null}
                              title="Unlink question doc"
                              className="ml-0.5 text-xs text-gray-400 hover:text-red-500 disabled:opacity-40"
                            >
                              {unlinkingDoc === "q" ? "…" : "×"}
                            </button>
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400 italic">No question doc linked</span>
                        )}
                        {question.google_ms_id ? (
                          <span className="inline-flex items-center gap-1">
                            <a
                              href={`https://docs.google.com/document/d/${question.google_ms_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs font-semibold text-green-600 hover:underline"
                            >
                              📝 Markscheme Doc
                            </a>
                            <button
                              type="button"
                              onClick={() => unlinkDoc("ms")}
                              disabled={unlinkingDoc !== null}
                              title="Unlink markscheme doc"
                              className="ml-0.5 text-xs text-gray-400 hover:text-red-500 disabled:opacity-40"
                            >
                              {unlinkingDoc === "ms" ? "…" : "×"}
                            </button>
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400 italic">No markscheme doc linked</span>
                        )}
                        <button
                          type="button"
                          onClick={() => { setLinkDraftQ(question.google_doc_id ?? ""); setLinkDraftMS(question.google_ms_id ?? ""); setEditingLinks(true); }}
                          className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-0.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 hover:text-blue-700"
                        >
                          ✏️ Edit Links
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* ── Row 4: Graph Editor ── */}
                <div className="border-t border-blue-100 pt-3">
                  <button
                    type="button"
                    onClick={() => setGraphEditorOpen((o) => !o)}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-700 hover:text-indigo-900"
                  >
                    <span>{graphEditorOpen ? "▾" : "▸"}</span>
                    <span>📈 Graph Editor</span>
                  </button>
                  {graphEditorOpen && (
                    <div className="mt-3 space-y-3">
                      {/* ── Extract from image controls ── */}
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={extractGraphFromImage}
                          disabled={graphExtracting || images.filter(i => i.image_type === "question").length === 0}
                          className="inline-flex items-center gap-1.5 rounded bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-50"
                          title={images.filter(i => i.image_type === "question").length === 0 ? "Extract question images first" : ""}
                        >
                          {graphExtracting ? "Extracting graph…" : "🔍 Extract Graph from Image"}
                        </button>
                        {graphExtractSnapshot && (
                          <button
                            type="button"
                            onClick={copyGraphExtractDebugPacket}
                            className="inline-flex items-center gap-1 rounded border border-indigo-300 bg-white px-2.5 py-1.5 text-[11px] font-bold text-indigo-700 hover:bg-indigo-50"
                            title="Copy extracted graph details and required correction output format"
                          >
                            {graphDebugCopied ? "✓ Copied" : "Copy Graph Debug Packet"}
                          </button>
                        )}
                        {graphExtractSnapshot && (
                          <button
                            type="button"
                            onClick={() => { setShowCorrectionInput((v) => !v); setCorrectionParseError(null); }}
                            className="inline-flex items-center gap-1 rounded border border-emerald-400 bg-white px-2.5 py-1.5 text-[11px] font-bold text-emerald-700 hover:bg-emerald-50"
                          >
                            {showCorrectionInput ? "✕ Cancel" : "✏ Paste Correction"}
                          </button>
                        )}
                        {graphExtracting && (
                          <span className="text-xs text-violet-600 italic">
                            Running 2-pass analysis (this may take ~30 s)…
                          </span>
                        )}
                        {graphExtractError && (
                          <span className="text-xs text-red-600 font-semibold">
                            {graphExtractError}
                            {graphExtractFailure?.status === 422 ? " (continuity gate)" : ""}
                          </span>
                        )}
                      </div>

                      {graphExtractFailure && (
                        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-xs font-bold text-red-800">
                              {graphExtractFailure.status === 422
                                ? "Continuity gate rejected this extraction"
                                : "Graph extraction failed"}
                            </p>
                            <button
                              type="button"
                              onClick={copyGraphExtractFailureReport}
                              className="rounded px-2.5 py-1 text-[11px] font-bold bg-red-600 text-white hover:bg-red-700"
                            >
                              {graphFailureCopied ? "✓ Copied" : "Copy Full Failure Report"}
                            </button>
                          </div>

                          <details>
                            <summary className="cursor-pointer text-xs font-bold text-red-800">
                              Click for details
                            </summary>
                          <div className="mt-2 space-y-1">
                            <p className="text-xs text-red-700"><span className="font-semibold">Status:</span> {graphExtractFailure.status}</p>
                            <p className="text-xs text-red-700"><span className="font-semibold">Error:</span> {graphExtractFailure.error}</p>

                            {graphExtractFailure.warnings.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-red-800">Warnings</p>
                                <ul className="list-disc ml-4 space-y-0.5">
                                  {graphExtractFailure.warnings.map((w, i) => (
                                    <li key={i} className="text-xs text-red-700">{w}</li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {graphExtractFailure.graphSpec && (
                              <details>
                                <summary className="cursor-pointer text-xs font-semibold text-red-800">Returned graphSpec JSON</summary>
                                <pre className="mt-1 rounded bg-white border border-red-100 p-2 text-[10px] leading-relaxed overflow-x-auto whitespace-pre-wrap max-h-56 text-red-900">
                                  {JSON.stringify(graphExtractFailure.graphSpec, null, 2)}
                                </pre>
                              </details>
                            )}

                            {graphExtractFailure.graphMeta && (
                              <details>
                                <summary className="cursor-pointer text-xs font-semibold text-red-800">Returned graphMeta JSON</summary>
                                <pre className="mt-1 rounded bg-white border border-red-100 p-2 text-[10px] leading-relaxed overflow-x-auto whitespace-pre-wrap max-h-56 text-red-900">
                                  {JSON.stringify(graphExtractFailure.graphMeta, null, 2)}
                                </pre>
                              </details>
                            )}
                          </div>
                          </details>
                        </div>
                      )}

                      {/* ── Extraction warnings ── */}
                      {graphExtractWarnings.length > 0 && (
                        <div className="rounded border border-yellow-300 bg-yellow-50 px-3 py-2 space-y-1">
                          <p className="text-xs font-bold text-yellow-800">⚠ Verification notices</p>
                          {graphExtractWarnings.map((w, i) => (
                            <p key={i} className="text-xs text-yellow-700">{w}</p>
                          ))}
                        </div>
                      )}

                      {/* ── Paste correction panel ── */}
                      {showCorrectionInput && (
                        <div className="rounded border border-emerald-300 bg-emerald-50 px-3 py-3 space-y-2">
                          <p className="text-xs font-bold text-emerald-800">✏ Paste corrected JSON</p>
                          <p className="text-[11px] text-emerald-700">
                            Paste the JSON returned by the AI (must have a <code className="bg-white px-0.5 rounded">graphSpec</code> key, optionally <code className="bg-white px-0.5 rounded">graphMeta</code> and <code className="bg-white px-0.5 rounded">warnings</code>).
                          </p>
                          <textarea
                            rows={10}
                            value={correctionJson}
                            onChange={(e) => { setCorrectionJson(e.target.value); setCorrectionParseError(null); }}
                            spellCheck={false}
                            placeholder={'{\n  "graphSpec": { ... },\n  "graphMeta": { ... },\n  "warnings": []\n}'}
                            className="w-full rounded border border-emerald-300 px-2 py-1.5 font-mono text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-white"
                          />
                          {correctionParseError && (
                            <p className="text-xs text-red-600">{correctionParseError}</p>
                          )}
                          <button
                            type="button"
                            onClick={applyCorrection}
                            disabled={!correctionJson.trim()}
                            className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
                          >
                            Apply → Load into Graph Editor
                          </button>
                        </div>
                      )}

                      {graphExtractFeedback.length > 0 && (
                        <div className="rounded border border-blue-300 bg-blue-50 px-3 py-2 space-y-1">
                          <p className="text-xs font-bold text-blue-800">🛠 Suggested improvements (always review)</p>
                          {graphExtractFeedback.map((tip, i) => (
                            <p key={i} className="text-xs text-blue-700">{tip}</p>
                          ))}
                        </div>
                      )}

                      {/* ── Graph metadata (from extraction) ── */}
                      {graphMeta && (
                        <details className="rounded border border-indigo-200 bg-indigo-50 px-3 py-2">
                          <summary className="cursor-pointer text-xs font-bold text-indigo-800">📊 Extracted graph metadata</summary>
                          <div className="mt-2 space-y-1 text-xs text-indigo-900">
                            {(graphMeta.description as string) && (
                              <p><span className="font-semibold">Description:</span> {graphMeta.description as string}</p>
                            )}
                            {(graphMeta.equations as string[])?.length > 0 && (
                              <p><span className="font-semibold">Equations:</span> {(graphMeta.equations as string[]).join(", ")}</p>
                            )}
                            {(graphMeta.xIntercepts as Array<{x:number;label?:string}>)?.length > 0 && (
                              <p><span className="font-semibold">x-intercepts:</span> {(graphMeta.xIntercepts as Array<{x:number;label?:string}>).map(p => p.label ?? `(${p.x},0)`).join(", ")}</p>
                            )}
                            {(graphMeta.yIntercepts as Array<{y:number;label?:string}>)?.length > 0 && (
                              <p><span className="font-semibold">y-intercepts:</span> {(graphMeta.yIntercepts as Array<{y:number;label?:string}>).map(p => p.label ?? `(0,${p.y})`).join(", ")}</p>
                            )}
                            {(graphMeta.verticalAsymptotes as number[])?.length > 0 && (
                              <p><span className="font-semibold">Vertical asymptotes:</span> x = {(graphMeta.verticalAsymptotes as number[]).join(", x = ")}</p>
                            )}
                            {(graphMeta.horizontalAsymptotes as string[])?.length > 0 && (
                              <p><span className="font-semibold">Horizontal asymptotes:</span> {(graphMeta.horizontalAsymptotes as string[]).join(", ")}</p>
                            )}
                            {(graphMeta.markschemeHints as string[])?.length > 0 && (
                              <div>
                                <p className="font-semibold">Mark-scheme hints:</p>
                                <ul className="list-disc ml-4">
                                  {(graphMeta.markschemeHints as string[]).map((h, i) => <li key={i}>{h}</li>)}
                                </ul>
                              </div>
                            )}
                          </div>
                        </details>
                      )}

                      {/* ── Main editor + preview grid ── */}
                      <div className="grid grid-cols-2 gap-4">
                        {/* Left: JSON spec editor */}
                        <div className="flex flex-col gap-2">
                          <p className="text-xs text-gray-500">
                            Define the graph as JSON.{" "}
                            <a
                              href="https://github.com/nicolewhite/algebra.js"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline text-indigo-500"
                            >
                              Expressions
                            </a>{" "}
                            support: <code className="text-xs bg-gray-100 px-1 rounded">x^2</code>,{" "}
                            <code className="text-xs bg-gray-100 px-1 rounded">sin(x)</code>,{" "}
                            <code className="text-xs bg-gray-100 px-1 rounded">ln(x)</code>,{" "}
                            <code className="text-xs bg-gray-100 px-1 rounded">e^x</code>,{" "}
                            <code className="text-xs bg-gray-100 px-1 rounded">sqrt(x)</code>, etc.
                          </p>
                          <textarea
                            rows={16}
                            value={graphSpecJson}
                            onChange={(e) => { setGraphSpecJson(e.target.value); setGraphSpecDirty(true); setGraphParseError(null); }}
                            spellCheck={false}
                            className="w-full rounded border border-gray-300 px-2 py-1.5 font-mono text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                          />
                          {graphParseError && (
                            <p className="text-xs text-red-600">{graphParseError}</p>
                          )}
                          <div className="flex gap-2 flex-wrap">
                            <button
                              type="button"
                              onClick={() => saveGraphToField("stem_latex")}
                              disabled={graphSavingField !== null}
                              className="rounded bg-indigo-600 px-3 py-1 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
                            >
                              {graphSavingField === "stem_latex" ? "Saving…" : "Save → Stem"}
                            </button>
                            <button
                              type="button"
                              onClick={() => saveGraphToField("parts_draft_latex")}
                              disabled={graphSavingField !== null}
                              className="rounded bg-blue-600 px-3 py-1 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                              {graphSavingField === "parts_draft_latex" ? "Saving…" : "Save → Parts Draft"}
                            </button>
                            <button
                              type="button"
                              onClick={() => { setGraphSpecJson(JSON.stringify(EXAMPLE_SPEC, null, 2)); setGraphSpecDirty(false); setGraphParseError(null); }}
                              className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
                            >
                              Reset to example
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                try {
                                  const spec = JSON.parse(graphSpecJson) as IbGraphSpec;
                                  const marker = encodeGraphSpec(spec);
                                  void navigator.clipboard.writeText(marker).then(() => {
                                    setGraphCopiedMarker(marker);
                                    setGraphMarkerCopied(true);
                                    setTimeout(() => setGraphMarkerCopied(false), 2000);
                                  });
                                } catch {
                                  setGraphParseError("Invalid JSON — fix errors before copying");
                                }
                              }}
                              className="rounded border border-violet-300 bg-violet-50 px-3 py-1 text-xs font-bold text-violet-700 hover:bg-violet-100"
                            >
                              {graphMarkerCopied ? "✓ Copied!" : "📋 Copy Graph LaTeX"}
                            </button>
                          </div>
                          <details className="text-xs text-gray-500">
                            <summary className="cursor-pointer font-semibold text-gray-600">Element reference</summary>
                            <pre className="mt-1 rounded bg-gray-50 p-2 text-[10px] leading-relaxed overflow-x-auto whitespace-pre-wrap">{GRAPH_ELEMENT_REFERENCE}</pre>
                          </details>
                        </div>

                        {/* Right: live preview + optional image comparison */}
                        <div className="flex flex-col gap-3">
                          <div>
                            <p className="text-xs font-semibold text-gray-600 mb-1">Live preview (LaTeX-rendered graph)</p>
                            {(() => {
                              try {
                                const spec = JSON.parse(graphSpecJson) as IbGraphSpec;
                                return <IbGraph spec={spec} />;
                              } catch {
                                return <p className="text-xs text-gray-400 italic">Fix JSON to see preview</p>;
                              }
                            })()}
                          </div>
                          {/* Source image comparison */}
                          {graphSourceImageB64 && (
                            <div>
                              <p className="text-xs font-semibold text-gray-600 mb-1">Original image (for comparison)</p>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={`data:image/png;base64,${graphSourceImageB64}`}
                                alt="Source question image"
                                className="w-full rounded border border-gray-200 object-contain bg-white"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Images + Parts & LaTeX side-by-side ── */}
                <div className="h-[640px] grid grid-cols-2 gap-6">

                {/* ── Images (left column) ── */}
                <div className="bg-white rounded-xl border border-blue-200 p-5 overflow-y-auto">
                  <div className="flex items-center gap-3 mb-3">
                    <h2 className="text-sm font-bold text-blue-900 uppercase tracking-wide">Images</h2>
                    {!driveConnected ? (
                      <a
                        href="/api/questions/connect-drive"
                        className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800 hover:bg-amber-100"
                        title="Google Drive not connected — click to authorize"
                      >
                        🔗 Connect Drive to Extract
                      </a>
                    ) : hasDocLinkConflict ? (
                      <button
                        type="button"
                        disabled
                        className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800 opacity-90"
                        title="Question doc and markscheme doc are the same file"
                      >
                        Fix doc links first
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onExtractImages(); }}
                        disabled={extracting}
                        className="rounded-lg border border-blue-400 bg-white px-3 py-1 text-xs font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                      >
                        {extracting ? "Extracting…" : images.length > 0 ? "Re-extract" : "Extract from Docs"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={hasTroubleshooting ? onCopyTroubleshooting : () => alert("Click \"Extract from Docs\" first to collect diagnostics, then copy.")}
                      className={`rounded-lg border px-3 py-1 text-xs font-bold transition-colors ${hasTroubleshooting ? "border-amber-400 bg-amber-50 text-amber-800 hover:bg-amber-100" : "border-slate-300 bg-white text-slate-500 hover:bg-slate-50"}`}
                      title={hasTroubleshooting ? "Copy extract diagnostics for troubleshooting" : "Run Extract from Docs first to collect diagnostics"}
                    >
                      {troubleshootingCopied ? "✓ Copied!" : hasTroubleshooting ? "📋 Copy Debug Info" : "📋 Copy Debug Info"}
                    </button>
                    {images.length > 0 && (
                      <span className="text-xs text-gray-500">
                        {images.filter(i => i.image_type === "question").length} question,{" "}
                        {images.filter(i => i.image_type === "markscheme").length} markscheme
                      </span>
                    )}
                  </div>
                  <div className="space-y-4">
                    <ImageGroup
                      label="Question"
                      labelColor="blue"
                      questionId={question.id}
                      imageType="question"
                      images={images.filter(i => i.image_type === "question")}
                      deletingImageIds={deletingImageIds}
                      uploading={uploadingImage}
                      onDelete={onDeleteImage}
                      onReorder={(orderedIds) => onReorderImages("question", orderedIds)}
                      onUpload={(file) => onUploadImage("question", file)}
                      onSaveAsGraphImage={saveImageAsGraphCrop}
                      savingAsGraphImageIds={savingAsGraphCropIds}
                    />
                    <ImageGroup
                      label="Markscheme"
                      labelColor="green"
                      questionId={question.id}
                      imageType="markscheme"
                      images={images.filter(i => i.image_type === "markscheme")}
                      deletingImageIds={deletingImageIds}
                      uploading={uploadingImage}
                      onDelete={onDeleteImage}
                      onReorder={(orderedIds) => onReorderImages("markscheme", orderedIds)}
                      onUpload={(file) => onUploadImage("markscheme", file)}
                    />

                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-xs font-semibold text-violet-800 mb-1">Graph Images</p>
                        <button
                          type="button"
                          onClick={() => void fetchGraphCrops()}
                          disabled={graphCropsLoading}
                          className="rounded border border-violet-300 bg-white px-2 py-0.5 text-[11px] font-bold text-violet-700 hover:bg-violet-50 disabled:opacity-50"
                        >
                          {graphCropsLoading ? "Refreshing…" : "Refresh"}
                        </button>
                        <span className="text-xs text-gray-500">{graphCrops.length} saved</span>
                      </div>

                      {graphCropsError && (
                        <p className="text-xs text-red-600 mb-2">{graphCropsError}</p>
                      )}

                      {graphCrops.length === 0 ? (
                        <p className="text-xs text-gray-400 italic">No graph images saved for this question yet.</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {graphCrops.map((crop, idx) => {
                            const part = parts.find((p) => p.id === crop.part_id);
                            const partLabel = part?.part_label?.trim() ? `Part ${part.part_label}` : crop.part_id ? "Part linked" : "No part";
                            const isDeleting = deletingGraphCropIds.has(crop.id);
                            return (
                              <div key={crop.id} className="relative group rounded border border-violet-200 bg-white p-1">
                                <a
                                  href={crop.url ?? "#"}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={crop.url ?? ""}
                                    alt={`Graph crop ${idx + 1}`}
                                    className={`h-24 w-24 rounded object-cover border border-violet-100 ${isDeleting ? "opacity-40" : ""}`}
                                  />
                                </a>
                                <div className="mt-1 max-w-24 space-y-0.5">
                                  <p className="truncate text-[10px] font-semibold text-violet-800">{partLabel}</p>
                                  <p className="truncate text-[10px] text-gray-500">{crop.extractor ?? "manual"}</p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (confirm("Delete this graph image? This cannot be undone.")) {
                                      void deleteGraphCrop(crop.id);
                                    }
                                  }}
                                  disabled={isDeleting}
                                  className="absolute top-1 right-1 hidden group-hover:flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white hover:bg-red-500 disabled:opacity-50"
                                  title="Delete graph image"
                                >
                                  {isDeleting ? "…" : "×"}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* ── Parts & LaTeX (right column) ── */}
                <div className="bg-white rounded-xl border border-blue-200 p-5 overflow-y-auto">
                  <div className="flex items-center gap-3 mb-4 flex-wrap">
                    <h2 className="text-sm font-bold text-blue-900 uppercase tracking-wide">
                      Parts &amp; LaTeX
                      <span className="ml-2 font-normal text-gray-400 normal-case">({parts.length} part{parts.length !== 1 ? "s" : ""})</span>
                    </h2>
                    {/* Full-question Extract LaTeX button */}
                    {(images.some((i) => i.image_type === "question") || images.some((i) => i.image_type === "markscheme")) && (
                      <button
                        type="button"
                        onClick={() => {
                          if (hasExistingContent()) {
                            setFullExtractState("confirm");
                          } else {
                            void runFullExtract();
                          }
                        }}
                        disabled={fullExtractState === "running" || fullExtractState === "reviewing"}
                        className="rounded px-3 py-1.5 text-xs font-bold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 flex items-center gap-1.5 transition-colors"
                      >
                        {fullExtractState === "running" ? (
                          <><span className="inline-block w-3 h-3 border-2 border-amber-200 border-t-white rounded-full animate-spin" /> Extracting…</>
                        ) : fullExtractState === "reviewing" ? (
                          "Reviewing…"
                        ) : (
                          "⟳ Extract LaTeX"
                        )}
                      </button>
                    )}
                    {/* Reset as whole question — removes stem + all labeled parts */}
                    {hasLabeledParts && (
                      <button
                        type="button"
                        onClick={() => { if (confirm("Reset as whole question? This will clear the stem and delete ALL labeled parts.")) void resetAsWholeQuestion(); }}
                        disabled={resettingWhole}
                        className="rounded px-3 py-1.5 text-xs font-bold border border-red-300 text-red-600 bg-white hover:bg-red-50 disabled:opacity-50 transition-colors"
                      >
                        {resettingWhole ? "Resetting…" : "↺ Reset as Whole Question"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm("Clear all LaTeX and delete all parts for this question? This will erase stem + all part LaTeX and remove all parts. This cannot be undone.")) {
                          void clearAllLatex();
                        }
                      }}
                      disabled={clearingAllLatex || fullExtractState === "running" || fullExtractState === "reviewing"}
                      className="rounded px-3 py-1.5 text-xs font-bold border border-red-300 text-red-600 bg-white hover:bg-red-50 disabled:opacity-50 transition-colors"
                    >
                      {clearingAllLatex ? "Clearing…" : "🧹 Clear LaTeX"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAddPartOpen(!addPartOpen)}
                      className="ml-auto rounded px-3 py-1.5 text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                    >
                      + Add Part
                    </button>
                  </div>

                  {/* Confirm overwrite dialog */}
                  {fullExtractState === "confirm" && (
                    <div className="mb-4 rounded-lg border border-orange-300 bg-orange-50 p-4 space-y-3">
                      <p className="text-sm font-semibold text-orange-800">
                        ⚠ This question already has LaTeX content. Extracting will <strong>overwrite all existing part and stem LaTeX</strong> with newly extracted data.
                      </p>
                      <p className="text-xs text-orange-600">
                        Part structure will be re-determined from the images. Existing parts not found in the new extraction will be left unchanged.
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void runFullExtract()}
                          className="rounded px-4 py-1.5 text-xs font-bold bg-orange-600 text-white hover:bg-orange-700"
                        >
                          Yes, overwrite with extracted LaTeX
                        </button>
                        <button
                          type="button"
                          onClick={() => setFullExtractState("idle")}
                          className="rounded px-4 py-1.5 text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Extraction progress / log */}
                  {(fullExtractState === "running" || fullExtractState === "reviewing" || fullExtractLog.length > 0 || !!fullExtractError) && (
                    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/40 p-3 space-y-1.5">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <p className="text-[11px] font-semibold text-amber-900">Extractor debug output</p>
                        <button
                          type="button"
                          onClick={() => copyFullExtractDebugOutput()}
                          disabled={fullExtractLog.length === 0 && !fullExtractError}
                          className="rounded border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                          title="Copy LaTeX extractor progress log and error"
                        >
                          {fullExtractCopied ? "✓ Copied" : "📋 Copy Debug Output"}
                        </button>
                      </div>
                      {fullExtractLog.map((msg, i) => (
                        <p key={i} className="text-xs text-gray-600 flex items-start gap-1.5">
                          <span className="text-green-500 shrink-0 mt-0.5">✓</span>{msg}
                        </p>
                      ))}
                      {fullExtractState === "running" && (
                        <p className="text-xs text-amber-700 flex items-center gap-1.5">
                          <span className="inline-block w-3 h-3 border-2 border-amber-400 border-t-amber-700 rounded-full animate-spin" />
                          Working…
                        </p>
                      )}
                      {fullExtractError && (
                        <p className="text-xs text-red-600 font-medium">⚠ {fullExtractError}</p>
                      )}
                    </div>
                  )}

                  {/* Add part form */}
                  {addPartOpen && (
                    <div className="mb-5 p-4 bg-blue-50 rounded-lg border border-blue-200 space-y-3">
                      <h3 className="text-xs font-bold text-blue-900">New Part</h3>
                      {/* Input row */}
                      <div className="grid grid-cols-4 gap-3">
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-semibold text-gray-700">Label</span>
                          <input
                            type="text"
                            value={newPartDraft.partLabel}
                            onChange={(e) => setNewPartDraft((d) => ({ ...d, partLabel: e.target.value }))}
                            placeholder="a, b, c…"
                            className="border border-gray-300 rounded px-2 py-1.5 text-sm text-gray-900 focus:outline-none text-gray-900 focus:ring-2 focus:ring-blue-400"
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-semibold text-gray-700">Marks</span>
                          <input
                            type="number"
                            min={0}
                            value={newPartDraft.marks}
                            onChange={(e) => setNewPartDraft((d) => ({ ...d, marks: e.target.value }))}
                            className="border border-gray-300 rounded px-2 py-1.5 text-sm text-gray-900 focus:outline-none text-gray-900 focus:ring-2 focus:ring-blue-400"
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-semibold text-gray-700">Command Term</span>
                          <select
                            value={newPartDraft.commandTerm}
                            onChange={(e) => setNewPartDraft((d) => ({ ...d, commandTerm: e.target.value }))}
                            className="border border-gray-300 rounded px-2 py-1.5 text-sm text-gray-900 focus:outline-none text-gray-900 focus:ring-2 focus:ring-blue-400"
                          >
                            <option value="">— none —</option>
                            {DEFAULT_COMMAND_TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-semibold text-gray-700">Subtopic codes (comma-separated)</span>
                          <input
                            type="text"
                            value={newPartDraft.subtopicCodes}
                            onChange={(e) => setNewPartDraft((d) => ({ ...d, subtopicCodes: e.target.value }))}
                            placeholder="5.1.1, 5.1.2…"
                            className="border border-gray-300 rounded px-2 py-1.5 text-sm text-gray-900 focus:outline-none text-gray-900 focus:ring-2 focus:ring-blue-400"
                          />
                        </label>
                      </div>

                      {/* Add Part button — stages locally, stays open */}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={stagePart}
                          className="rounded px-3 py-1.5 text-xs font-bold bg-blue-600 text-white hover:bg-blue-700"
                        >
                          + Add Part
                        </button>
                        <button
                          type="button"
                          onClick={() => { setAddPartOpen(false); setPendingParts([]); setAddPartError(null); }}
                          className="rounded px-3 py-1.5 text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200"
                        >
                          Cancel
                        </button>
                      </div>

                      {/* Staged parts list */}
                      {pendingParts.length > 0 && (
                        <div className="space-y-1.5 pt-2 border-t border-blue-200">
                          <p className="text-xs font-semibold text-blue-800">Staged ({pendingParts.length}):</p>
                          {pendingParts.map((p, i) => (
                            <div key={i} className="flex items-center gap-3 bg-white rounded-lg border border-blue-100 px-3 py-2 text-xs">
                              <span className="font-bold text-blue-900 w-6">{p.partLabel || "—"}</span>
                              <span className="text-gray-600">{p.marks} mark{p.marks !== "1" ? "s" : ""}</span>
                              {p.commandTerm && <span className="text-gray-500">{p.commandTerm}</span>}
                              {p.subtopicCodes && <span className="text-gray-400">{p.subtopicCodes}</span>}
                              <button
                                type="button"
                                onClick={() => removePending(i)}
                                className="ml-auto text-red-400 hover:text-red-600 font-bold"
                              >✕</button>
                            </div>
                          ))}
                          {addPartError && <p className="text-xs text-red-600">{addPartError}</p>}
                          <button
                            type="button"
                            onClick={commitParts}
                            disabled={committingParts}
                            className="mt-1 rounded px-4 py-2 text-xs font-bold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                          >
                            {committingParts ? "Saving…" : `Commit ${pendingParts.length} part${pendingParts.length !== 1 ? "s" : ""} to database`}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Stem section (only when there are labelled parts) ── */}
                  {hasLabeledParts && (stemLatex || stemMsLatex || editingStem !== null) && (
                    <div className="border border-indigo-200 rounded-lg overflow-hidden mb-4">
                      <div className="bg-indigo-50 px-4 py-2.5 flex items-center gap-3 border-b border-indigo-200">
                        <span className="font-bold text-sm text-indigo-900">Stem</span>
                        <div className="flex gap-1 ml-2">
                          <button
                            type="button"
                            onClick={() => setEditingStem("stem_latex")}
                            className={`px-2 py-0.5 rounded text-xs font-medium border ${editingStem === "stem_latex" ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-indigo-700 border-indigo-300 hover:bg-indigo-50"}`}
                          >Question</button>
                          <button
                            type="button"
                            onClick={() => setEditingStem("stem_markscheme_latex")}
                            className={`px-2 py-0.5 rounded text-xs font-medium border ${editingStem === "stem_markscheme_latex" ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-indigo-700 border-indigo-300 hover:bg-indigo-50"}`}
                          >Mark Scheme</button>
                        </div>
                        <button
                          type="button"
                          onClick={() => { if (confirm("Clear both stem fields? This cannot be undone.")) clearStem(); }}
                          disabled={clearingStem}
                          className="ml-1 px-2 py-0.5 rounded text-xs font-medium border border-red-300 text-red-600 bg-white hover:bg-red-50 disabled:opacity-50"
                          title="Clear stem_latex and stem_markscheme_latex from the database"
                        >{clearingStem ? "Clearing…" : "Clear Stem"}</button>
                        {editingStem && (
                          <div className="ml-auto flex gap-2">
                            <button
                              type="button"
                              onClick={() => saveStem(editingStem)}
                              disabled={savingStem}
                              className="px-3 py-1 rounded text-xs font-bold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                            >{savingStem ? "Saving…" : "Save"}</button>
                            <button
                              type="button"
                              onClick={() => { setEditingStem(null); setStemDraftQ(stemLatex); setStemDraftMS(stemMsLatex); }}
                              className="px-3 py-1 rounded text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200"
                            >Cancel</button>
                          </div>
                        )}
                      </div>
                      <div className="p-4 bg-white">
                        {editingStem === "stem_latex" ? (
                          <>
                            {graphCopiedMarker && (
                              <div className="mb-1.5 flex justify-end">
                                <button
                                  type="button"
                                  onClick={() => setStemDraftQ((v) => v + "\n" + graphCopiedMarker)}
                                  className="rounded border border-violet-300 bg-violet-50 px-2.5 py-0.5 text-[11px] font-bold text-violet-700 hover:bg-violet-100"
                                >⊕ Insert Graph</button>
                              </div>
                            )}
                            <textarea
                              className="w-full border border-gray-300 rounded p-2 text-xs font-mono text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                              rows={6}
                              value={stemDraftQ}
                              onChange={(e) => setStemDraftQ(e.target.value)}
                            />
                          </>
                        ) : editingStem === "stem_markscheme_latex" ? (
                          <>
                            {graphCopiedMarker && (
                              <div className="mb-1.5 flex justify-end">
                                <button
                                  type="button"
                                  onClick={() => setStemDraftMS((v) => v + "\n" + graphCopiedMarker)}
                                  className="rounded border border-violet-300 bg-violet-50 px-2.5 py-0.5 text-[11px] font-bold text-violet-700 hover:bg-violet-100"
                                >⊕ Insert Graph</button>
                              </div>
                            )}
                            <textarea
                              className="w-full border border-gray-300 rounded p-2 text-xs font-mono text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                              rows={6}
                              value={stemDraftMS}
                              onChange={(e) => setStemDraftMS(e.target.value)}
                            />
                          </>
                        ) : (
                          <div className="space-y-4">
                            <div>
                              <p className="text-xs font-semibold text-gray-500 mb-1">Question stem</p>
                              {stemLatex
                                ? <LatexRenderer latex={stemLatex} />
                                : <p className="text-xs text-gray-400 italic">—</p>}
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-gray-500 mb-1">Mark scheme stem</p>
                              {stemMsLatex
                                ? <LatexRenderer latex={stemMsLatex} />
                                : <p className="text-xs text-gray-400 italic">—</p>}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {!hasLabeledParts ? (
                    /* ── Whole question editor (no labelled parts) ── */
                    (() => {
                      const wholePart = parts[0]; // the null-label part, if it exists
                      return (
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      {/* Header: command term + subtopics */}
                      <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 space-y-2" onClick={(e) => e.stopPropagation()}>
                        <div className="flex flex-wrap items-center gap-4">
                          {wholePart && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-semibold text-gray-500">Subtopics:</span>
                              <SubtopicEditor
                                codes={wholePart.subtopic_codes}
                                available={availableSubtopics}
                                onChange={(codes) => {
                                  onUpdateSubtopics(wholePart.id, codes);
                                  setParts((prev) => prev.map((p) => (p.id === wholePart.id ? { ...p, subtopic_codes: codes } : p)));
                                }}
                              />
                            </div>
                          )}
                        </div>

                      </div>
                      <div className="divide-y divide-gray-100">
                        {(["q", "ms"] as const).map((field) => {
                          const label = field === "q" ? "Question LaTeX" : "Markscheme LaTeX";
                          const draft = field === "q" ? wholeQDraft : wholeMSDraft;
                          const setDraft = field === "q" ? setWholeQDraft : setWholeMSDraft;
                          const isEditing = editingWhole === field;
                          return (
                            <div key={field} className="p-4 space-y-3">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-gray-600">{label}</span>
                                {!isEditing && (
                                  <button
                                    type="button"
                                    onClick={() => setEditingWhole(field)}
                                    className="rounded px-2 py-0.5 text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200"
                                  >Edit</button>
                                )}
                                {isEditing && (
                                  <div className="flex gap-1">
                                    <button
                                      type="button"
                                      onClick={() => saveWholeQuestion(field)}
                                      disabled={savingWhole}
                                      className="rounded px-2 py-0.5 text-xs font-bold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                                    >{savingWhole ? "Saving…" : "Save"}</button>
                                    <button
                                      type="button"
                                      onClick={() => { setEditingWhole(null); setDraft(""); }}
                                      className="rounded px-2 py-0.5 text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200"
                                    >Cancel</button>
                                  </div>
                                )}
                              </div>
                              {isEditing ? (
                                <>
                                  {graphCopiedMarker && (
                                    <div className="mb-1.5 flex justify-end">
                                      <button
                                        type="button"
                                        onClick={() => setDraft((v) => v + "\n" + graphCopiedMarker)}
                                        className="rounded border border-violet-300 bg-violet-50 px-2.5 py-0.5 text-[11px] font-bold text-violet-700 hover:bg-violet-100"
                                      >⊕ Insert Graph</button>
                                    </div>
                                  )}
                                  <textarea
                                    className="w-full border border-gray-300 rounded p-2 text-xs font-mono text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
                                    rows={8}
                                    value={draft}
                                    onChange={(e) => setDraft(e.target.value)}
                                    autoFocus
                                  />
                                </>
                              ) : draft ? (
                                <LatexRenderer
                                  latex={draft}
                                  stripMarkAnnotations={field === "q"}
                                  highlightCommandTerm={field === "q" ? (wholePart ? primaryCommandTerm(wholePart) : null) : null}
                                  highlightContextTerms={field === "q" ? mergeHighlightTerms(
                                    contextTermHighlightsFromFlags(wholePart ?? null, wholePart?.instructional_context_terms ?? []),
                                    wholePart?.command_terms?.slice(1) ?? [],
                                    detectCommandTerms(draft),
                                  ) : []}
                                />
                              ) : (
                                <p className="text-xs text-gray-400 italic">No LaTeX — click Edit or ⟳ Extract to add</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                      );
                    })()
                  ) : (
                    <div className="space-y-6">
                      {([
                        { key: "content_latex", title: "Question", emptyHint: "No question LaTeX — click Edit or ⟳ Extract to add" },
                        { key: "markscheme_latex", title: "Mark scheme", emptyHint: "No markscheme LaTeX — click Edit or ⟳ Extract to add" },
                      ] as const).map((section) => (
                        <div key={section.key} className="space-y-3">
                          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-600">{section.title}</h3>
                          <div className="space-y-4">
                            {parts.map((part) => {
                              const partLabel = part.part_label ? `Part ${part.part_label.toUpperCase()}` : "Whole question";
                              const field = section.key;
                              const isEditing = editingLatex?.partId === part.id && editingLatex.field === field;
                              const isExtracting = extractingLatexField?.partId === part.id && extractingLatexField.field === field;
                              const fieldLabel = field === "content_latex" ? "Question LaTeX" : "Markscheme LaTeX";
                              const draft = latexDrafts[part.id]?.[field] ?? "";
                              const saved = part[field] ?? "";
                              const claudeKey = `${part.id}-${field}`;
                              const cardKey = `${part.id}-${field}`;
                              const isCollapsed = collapsedPartCards.has(cardKey);
                              const hasImages = field === "content_latex"
                                ? images.some((i) => i.image_type === "question")
                                : images.some((i) => i.image_type === "markscheme");

                              return (
                                <div key={`${part.id}-${field}`} className="border border-gray-200 rounded-lg overflow-hidden">
                                  <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 space-y-2" onClick={(e) => e.stopPropagation()}>
                                    <div className="flex flex-wrap items-center gap-3">
                                      <button
                                        type="button"
                                        className="text-xs text-gray-500 hover:text-gray-700"
                                        onClick={() => togglePartCard(cardKey)}
                                        title={isCollapsed ? "Expand this part" : "Collapse this part"}
                                      >
                                        {isCollapsed ? "▸" : "▾"}
                                      </button>
                                      <span className="font-bold text-sm text-blue-900">{partLabel}</span>
                                      <span className="text-xs text-gray-500 font-medium">[{part.marks} mark{part.marks !== 1 ? "s" : ""}]</span>
                                      {part.latex_verified && (
                                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">✓ Verified</span>
                                      )}
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-xs font-semibold text-gray-500">Subtopics:</span>
                                        <SubtopicEditor
                                          codes={part.subtopic_codes}
                                          available={availableSubtopics}
                                          onChange={(codes) => {
                                            onUpdateSubtopics(part.id, codes);
                                            setParts((prev) => prev.map((p) => (p.id === part.id ? { ...p, subtopic_codes: codes } : p)));
                                          }}
                                        />
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => { if (confirm(`Delete ${partLabel}? This cannot be undone.`)) deletePart(part.id); }}
                                        disabled={deletingPartId === part.id}
                                        className="ml-auto px-2 py-0.5 rounded text-xs font-medium border border-red-300 text-red-500 bg-white hover:bg-red-50 disabled:opacity-50"
                                        title="Delete this part from the database"
                                      >{deletingPartId === part.id ? "Deleting…" : "Delete Part"}</button>
                                    </div>
                                  </div>

                                  {!isCollapsed && <div className="p-4 space-y-3">
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs font-semibold text-gray-600">{fieldLabel}</span>
                                      <div className="flex gap-1 items-center">
                                        {hasImages && !isEditing && (
                                          <button
                                            type="button"
                                            onClick={() => extractLatexFromImages(part.id, field)}
                                            disabled={isExtracting}
                                            title="Extract LaTeX from uploaded images using OCR"
                                            className="rounded px-2 py-0.5 text-xs font-bold bg-amber-100 text-amber-800 hover:bg-amber-200 disabled:opacity-50 flex items-center gap-1"
                                          >
                                            {isExtracting ? (
                                              <><span className="inline-block w-3 h-3 border-2 border-amber-400 border-t-amber-700 rounded-full animate-spin" /> Extracting…</>
                                            ) : (
                                              "⟳ Extract"
                                            )}
                                          </button>
                                        )}
                                        {isEditing ? (
                                          <div className="flex gap-1">
                                            <button
                                              type="button"
                                              onClick={() => saveLatex(part.id, field)}
                                              disabled={savingLatex}
                                              className="rounded px-2 py-0.5 text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                                            >
                                              {savingLatex ? "Saving…" : "Save"}
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setEditingLatex(null);
                                                setLatexDrafts((d) => ({ ...d, [part.id]: { ...d[part.id], [field]: saved } }));
                                              }}
                                              className="rounded px-2 py-0.5 text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200"
                                            >
                                              Cancel
                                            </button>
                                          </div>
                                        ) : (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setEditingLatex({ partId: part.id, field });
                                              setLatexDrafts((d) => ({ ...d, [part.id]: { ...d[part.id], [field]: saved } }));
                                            }}
                                            className="rounded px-2 py-0.5 text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200"
                                          >
                                            Edit
                                          </button>
                                        )}
                                      </div>
                                    </div>

                                    {isEditing ? (
                                      <>
                                        {isExtracting && (
                                          <p className="text-xs text-amber-600 italic flex items-center gap-1">
                                            <span className="inline-block w-3 h-3 border-2 border-amber-400 border-t-amber-700 rounded-full animate-spin" />
                                            Running OCR on images…
                                          </p>
                                        )}
                                        {graphCopiedMarker && (
                                          <div className="mb-1.5 flex justify-end">
                                            <button
                                              type="button"
                                              onClick={() => setLatexDrafts((d) => ({ ...d, [part.id]: { ...d[part.id], [field]: (d[part.id]?.[field] ?? "") + "\n" + graphCopiedMarker } }))}
                                              className="rounded border border-violet-300 bg-violet-50 px-2.5 py-0.5 text-[11px] font-bold text-violet-700 hover:bg-violet-100"
                                            >⊕ Insert Graph</button>
                                          </div>
                                        )}
                                        <textarea
                                          className="w-full border border-gray-300 rounded p-2 text-xs font-mono resize-y min-h-24 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
                                          value={draft}
                                          onChange={(e) => setLatexDrafts((d) => ({ ...d, [part.id]: { ...d[part.id], [field]: e.target.value } }))}
                                          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void saveLatex(part.id, field); } }}
                                        />
                                        <div className="flex gap-2 pt-1 border-t border-gray-100">
                                          <input
                                            type="text"
                                            placeholder="Correction for Claude, e.g. 'fix the fraction in line 2'…"
                                            value={claudeInstruction[claudeKey] ?? ""}
                                            onChange={(e) => setClaudeInstruction((c) => ({ ...c, [claudeKey]: e.target.value }))}
                                            onKeyDown={(e) => e.key === "Enter" && runClaude(part.id, field)}
                                            className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-400"
                                          />
                                          <button
                                            type="button"
                                            onClick={() => runClaude(part.id, field)}
                                            disabled={claudeLoading[claudeKey] || !(claudeInstruction[claudeKey] ?? "").trim()}
                                            className="rounded px-2 py-1 text-xs font-bold bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-40"
                                          >
                                            {claudeLoading[claudeKey] ? "…" : "Ask Claude"}
                                          </button>
                                        </div>
                                      </>
                                    ) : saved ? (
                                      <div className="text-sm leading-relaxed min-h-8">
                                        <LatexRenderer
                                          latex={saved}
                                          stripMarkAnnotations={field === "content_latex"}
                                          highlightCommandTerm={field === "content_latex" ? primaryCommandTerm(part) : null}
                                          highlightContextTerms={field === "content_latex" ? mergeHighlightTerms(
                                            contextTermHighlightsFromFlags(part, part.instructional_context_terms ?? []),
                                            part.command_terms?.slice(1) ?? [],
                                            detectCommandTerms(saved),
                                          ) : []}
                                        />
                                      </div>
                                    ) : (
                                      <p className="text-xs text-gray-400 italic">{section.emptyHint}</p>
                                    )}
                                  </div>}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                </div>{/* end grid */}
            </div>
          </div>
        )}
        </>,
        document.body
      )}
    </>
  );
}

// ─── Image Group ──────────────────────────────────────────────────────────────

function ImageGroup({
  label,
  labelColor,
  questionId,
  imageType,
  images,
  deletingImageIds,
  uploading,
  onDelete,
  onReorder,
  onUpload,
  onSaveAsGraphImage,
  savingAsGraphImageIds,
}: {
  label: string;
  labelColor: "blue" | "green";
  questionId: string;
  imageType: "question" | "markscheme";
  images: QuestionImage[];
  deletingImageIds: Set<string>;
  uploading: boolean;
  onDelete: (imageId: string) => void;
  onReorder: (orderedIds: string[]) => void;
  onUpload: (file: File) => void;
  onSaveAsGraphImage?: (img: QuestionImage) => void;
  savingAsGraphImageIds?: Set<string>;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const dragIdx = useRef<number | null>(null);

  const borderColor = labelColor === "blue" ? "border-blue-200" : "border-green-200";
  const hoverBorderColor = labelColor === "blue" ? "hover:border-blue-500" : "hover:border-green-500";
  const labelClass = labelColor === "blue"
    ? "text-xs font-semibold text-blue-800 mb-1"
    : "text-xs font-semibold text-green-800 mb-1";

  const handlePaste = (e: React.ClipboardEvent) => {
    e.stopPropagation();
    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find((item) => item.type.startsWith("image/"));
    if (imageItem) {
      const file = imageItem.getAsFile();
      if (file) onUpload(file);
    }
  };

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    // Try to read image from clipboard API on click
    if (navigator.clipboard && "read" in navigator.clipboard) {
      try {
        const items = await navigator.clipboard.read();
        for (const clipItem of items) {
          const imageType = clipItem.types.find((t) => t.startsWith("image/"));
          if (imageType) {
            const blob = await clipItem.getType(imageType);
            const ext = imageType.split("/")[1] ?? "png";
            const file = new File([blob], `pasted-image.${ext}`, { type: imageType });
            onUpload(file);
            return;
          }
        }
      } catch {
        // Permission denied or no image — fall through to focus so Ctrl+V works
      }
    }
    (e.currentTarget as HTMLDivElement).focus();
  };

  const handleDragStart = (idx: number) => {
    dragIdx.current = idx;
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx.current === null || dragIdx.current === idx) return;
    const newOrder = [...images];
    const [moved] = newOrder.splice(dragIdx.current, 1);
    newOrder.splice(idx, 0, moved);
    dragIdx.current = idx;
    onReorder(newOrder.map((i) => i.id));
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <p className={labelClass}>{label}</p>
        {uploading && (
          <span className="text-xs text-gray-400 italic">Uploading…</span>
        )}
      </div>

      <div
        tabIndex={0}
        className={`rounded-lg border-2 border-dashed p-2 min-h-[60px] transition-colors outline-none focus:ring-2 cursor-pointer ${
          labelColor === "blue"
        }
            : "border-green-200 bg-green-50/30 focus:ring-green-400"
        }`}
        onPaste={handlePaste}
        onClick={handleClick}
      >
        {images.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-2">
            📋 Click to paste image from clipboard
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {images.map((img, idx) => (
              <div
                key={img.id}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                className="relative group cursor-grab active:cursor-grabbing"
              >
                {/* Drag handle overlay (top-left corner) */}
                <div className="absolute top-1 left-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 rounded px-1 py-0.5 text-white text-xs select-none pointer-events-none">
                  ⠿
                </div>

                {/* Image */}
                <a
                  href={img.url ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url ?? ""}
                    alt={img.alt_text ?? `${label} image ${idx + 1}`}
                    className={`max-h-40 rounded border bg-white p-1 ${borderColor} ${hoverBorderColor} hover:shadow-md transition-all ${
                      deletingImageIds.has(img.id) ? "opacity-40" : ""
                    }`}
                    draggable={false}
                  />
                </a>

                <a
                  href={img.url ?? "#"}
                  download
                  onClick={(e) => e.stopPropagation()}
                  className="absolute bottom-1 left-1 z-10 inline-flex h-5 w-5 items-center justify-center rounded bg-white/95 text-[11px] text-gray-700 shadow-sm ring-1 ring-gray-300 hover:bg-white opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Download image"
                >
                  ↓
                </a>

                {/* Save as graph image button (bottom-right) */}
                {onSaveAsGraphImage && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onSaveAsGraphImage(img); }}
                    disabled={savingAsGraphImageIds?.has(img.id)}
                    className="absolute bottom-1 right-1 z-10 opacity-0 group-hover:opacity-100 inline-flex h-5 w-5 items-center justify-center rounded bg-violet-600/90 text-[11px] text-white shadow-sm hover:bg-violet-700 disabled:opacity-50 transition-opacity"
                    title="Save as graph image"
                  >
                    {savingAsGraphImageIds?.has(img.id) ? "…" : "📊"}
                  </button>
                )}

                {/* Delete button (top-right) */}
                {confirmingDelete === img.id ? (
                  <div
                    className="absolute inset-0 flex flex-col items-center justify-center bg-red-900/80 rounded gap-1 z-20"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="text-white text-xs font-bold">Delete?</span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        disabled={deletingImageIds.has(img.id)}
                        onClick={() => { onDelete(img.id); setConfirmingDelete(null); }}
                        className="rounded bg-red-500 text-white text-xs font-bold px-2 py-0.5 hover:bg-red-400 disabled:opacity-50"
                      >
                        {deletingImageIds.has(img.id) ? "…" : "Yes"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingDelete(null)}
                        className="rounded bg-gray-200 text-gray-800 text-xs font-bold px-2 py-0.5 hover:bg-gray-300"
                      >
                        No
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); setConfirmingDelete(img.id); }}
                    className="absolute top-1 right-1 z-10 opacity-0 group-hover:opacity-100 rounded-full w-5 h-5 flex items-center justify-center bg-red-600 text-white text-xs font-bold hover:bg-red-500 transition-opacity"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Always show paste hint below images if there are some */}
        {images.length > 0 && (
          <p className="text-xs text-gray-400 mt-1 text-center">
            📋 Paste an image to add · drag to reorder
          </p>
        )}
      </div>
    </div>
  );
}

function SubtopicEditor({
  codes,
  available,
  onChange,
}: {
  codes: string[];
  available: Subtopic[];
  onChange: (codes: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const removeTopic = (code: string) => {
    onChange(codes.filter((c) => c !== code));
  };

  const addTopic = (code: string) => {
    if (!codes.includes(code)) {
      onChange([...codes, code].sort());
    }
    setSearch("");
    setOpen(false);
  };

  // Group available by section, filter by search and already-selected
  const filtered = available.filter(
    (s) =>
      !codes.includes(s.code) &&
      (search === "" ||
        s.code.toLowerCase().includes(search.toLowerCase()) ||
        s.descriptor.toLowerCase().includes(search.toLowerCase()))
  );

  const grouped = filtered.reduce(
    (acc, s) => {
      if (!acc[s.section]) acc[s.section] = [];
      acc[s.section].push(s);
      return acc;
    },
    {} as Record<number, Subtopic[]>
  );

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-1">
        {codes.map((c) => {
          const sub = available.find((s) => s.code === c);
          return (
            <span
              key={c}
              className="inline-flex items-center gap-0.5 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800"
            >
              {c}{sub?.descriptor ? ` ${sub.descriptor}` : ""}
              <button
                type="button"
                onClick={() => removeTopic(c)}
                className="ml-0.5 text-blue-500 hover:text-red-600 font-bold leading-none"
                title="Remove"
              >
                ×
              </button>
            </span>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="inline-flex items-center rounded-full border border-dashed border-blue-300 px-2 py-0.5 text-xs font-semibold text-blue-600 hover:bg-blue-50"
        >
          + Add
        </button>
      </div>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-blue-200 bg-white shadow-lg">
          <div className="p-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search subtopics..."
              autoFocus
              className="w-full rounded border border-blue-300 px-2 py-1 text-xs font-semibold text-blue-900 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="max-h-48 overflow-y-auto px-1 pb-2">
            {Object.entries(grouped).length === 0 && (
              <p className="px-2 py-1 text-xs text-gray-400">No matches</p>
            )}
            {Object.entries(grouped)
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([sec, subs]) => (
                <div key={sec}>
                  <div className="sticky top-0 bg-white px-2 py-0.5 text-xs font-bold text-gray-500">
                    {sec}. {SECTION_NAMES[Number(sec)] ?? "Other"}
                  </div>
                  {subs.map((s) => (
                    <button
                      key={s.code}
                      type="button"
                      onClick={() => addTopic(s.code)}
                      className="block w-full px-3 py-1 text-left text-xs hover:bg-blue-50 rounded"
                    >
                      <span className="font-bold text-blue-800">{s.code}</span>{" "}
                      <span className="text-gray-600">{s.descriptor}</span>
                    </button>
                  ))}
                </div>
              ))}
          </div>
          <div className="border-t border-blue-100 p-1">
            <button
              type="button"
              onClick={() => { setOpen(false); setSearch(""); }}
              className="w-full rounded px-2 py-1 text-xs font-bold text-gray-600 hover:bg-gray-100"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CommandTermSelect({
  value,
  terms,
  onChange,
  onAddCustom,
}: {
  value: string | null;
  terms: string[];
  onChange: (term: string | null) => void;
  onAddCustom: (term: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState(false);
  const [newTerm, setNewTerm] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setFilter("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const filtered = terms.filter((t) =>
    t.toLowerCase().includes(filter.toLowerCase())
  );

  const handleOpen = () => {
    setOpen(true);
    setFilter("");
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleSelect = (term: string | null) => {
    onChange(term);
    setOpen(false);
    setFilter("");
  };

  const handleAddSubmit = () => {
    const trimmed = newTerm.trim();
    if (trimmed) {
      onAddCustom(trimmed);
      onChange(trimmed);
    }
    setAdding(false);
    setNewTerm("");
    setOpen(false);
  };

  if (adding) {
    return (
      <div className="flex gap-1">
        <input
          type="text"
          value={newTerm}
          onChange={(e) => setNewTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAddSubmit();
            if (e.key === "Escape") { setAdding(false); setNewTerm(""); }
          }}
          placeholder="New term..."
          autoFocus
          className="w-28 rounded border border-blue-300 px-2 py-0.5 text-xs font-semibold text-blue-900 bg-white focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={handleAddSubmit}
          className="rounded bg-blue-600 px-2 py-0.5 text-xs font-bold text-white hover:bg-blue-700"
        >
          Add
        </button>
        <button
          type="button"
          onClick={() => { setAdding(false); setNewTerm(""); }}
          className="rounded bg-gray-200 px-2 py-0.5 text-xs font-bold text-gray-700 hover:bg-gray-300"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      {/* Trigger */}
      <button
        type="button"
        onClick={handleOpen}
        onFocus={handleOpen}
        className={`rounded border px-2 py-0.5 text-xs font-semibold text-left ${
          value
            ? "border-green-400 bg-green-50 text-green-800"
            : "border-gray-300 bg-white text-gray-500"
        }`}
      >
        {value ?? "— Select —"} <span className="opacity-50">▾</span>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-48 rounded border border-gray-200 bg-white shadow-lg">
          {/* Filter input */}
          <div className="p-1.5 border-b border-gray-100">
            <input
              ref={inputRef}
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setOpen(false); setFilter(""); }
                if (e.key === "Enter" && filtered.length === 1) handleSelect(filtered[0]);
              }}
              placeholder="Type to filter…"
              className="w-full rounded border border-gray-300 px-2 py-1 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {/* Clear option */}
            {value && (
              <button
                type="button"
                onClick={() => handleSelect(null)}
                className="w-full text-left px-3 py-1.5 text-xs text-red-500 hover:bg-red-50"
              >
                ✕ Clear
              </button>
            )}
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-xs text-gray-400 italic">No matches</div>
            )}
            {filtered.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => handleSelect(t)}
                className={`w-full text-left px-3 py-1.5 text-xs font-semibold hover:bg-blue-50 ${
                  t === value ? "bg-green-50 text-green-800" : "text-gray-800"
                }`}
              >
                {t}
              </button>
            ))}
            {/* Add custom */}
            <button
              type="button"
              onClick={() => { setOpen(false); setAdding(true); }}
              className="w-full text-left px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-50 border-t border-gray-100"
            >
              + Add custom…
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ExamBuilder Panel ─────────────────────────────────────────────────────────

const ALL_TEMPLATES = [
  { curriculum: "AA", level: "HL", paper: 1 },
  { curriculum: "AA", level: "HL", paper: 2 },
  { curriculum: "AA", level: "HL", paper: 3 },
  { curriculum: "AA", level: "SL", paper: 1 },
  { curriculum: "AA", level: "SL", paper: 2 },
  { curriculum: "AI", level: "HL", paper: 1 },
  { curriculum: "AI", level: "HL", paper: 2 },
  { curriculum: "AI", level: "HL", paper: 3 },
  { curriculum: "AI", level: "SL", paper: 1 },
  { curriculum: "AI", level: "SL", paper: 2 },
];

function TestBuilderPanel({
  queue,
  examConfig,
  courses,
  showSections,
  queueHasMarkscheme,
  showTemplateEditor,
  templateEdits,
  onConfigChange,
  onRemove,
  onUpdateSection,
  onAutoSort,
  onMoveUp,
  onPreviewTest,
  onPreviewMS,
  onClear,
  onToggleTemplateEditor,
  onTemplateEditChange,
  onSaveTemplates,
  savedExams,
  showSavedExams,
  savingExam,
  loadingExams,
  activeExamId,
  examDirty,
  onSaveExam,
  onToggleSavedExams,
  onLoadExam,
  onDeleteExam,
  showRandomPanel,
  randomTargetMinutes,
  buildingRandom,
  randomError,
  courseIdError,
  onToggleRandomPanel,
  onRandomTargetChange,
  onBuildRandom,
  onClearCourseIdError,
  onOpenQuestionFromQueue,
}: {
  queue: TestQueueItem[];
  examConfig: ExamConfig;
  courses: Course[];
  showSections: boolean;
  queueHasMarkscheme: boolean;
  showTemplateEditor: boolean;
  templateEdits: Record<string, string>;
  onConfigChange: (updates: Partial<ExamConfig>) => void;
  onRemove: (id: string) => void;
  onUpdateSection: (id: string, section: "A" | "B") => void;
  onAutoSort: () => void;
  onMoveUp: (index: number) => void;
  onPreviewTest: () => void;
  onPreviewMS: () => void;
  onClear: () => void;
  onToggleTemplateEditor: () => void;
  onTemplateEditChange: (key: string, val: string) => void;
  onSaveTemplates: () => void;
  savedExams: SavedExam[];
  showSavedExams: boolean;
  savingExam: boolean;
  loadingExams: boolean;
  activeExamId: string | null;
  examDirty: boolean;
  onSaveExam: () => void;
  onToggleSavedExams: () => void;
  onLoadExam: (exam: SavedExam) => void;
  onDeleteExam: (id: string) => void;
  showRandomPanel: boolean;
  randomTargetMinutes: number;
  buildingRandom: boolean;
  randomError: string | null;
  courseIdError: boolean;
  onToggleRandomPanel: () => void;
  onRandomTargetChange: (minutes: number) => void;
  onBuildRandom: () => void;
  onClearCourseIdError: () => void;
  onOpenQuestionFromQueue: (item: TestQueueItem) => void;
}) {
  // Build section groups for rendering placeholder dividers
  const sectionAItems = showSections ? queue.filter((q) => q.section === "A") : [];
  const sectionBItems = showSections ? queue.filter((q) => q.section === "B") : [];
  const unsectionedItems = showSections
    ? queue.filter((q) => q.section !== "A" && q.section !== "B")
    : [];

  const canPreview = queue.length > 0 && examConfig.courseId;
  const totalMarks = queue.reduce((sum, item) => sum + item.marks, 0);
  // HL: 120 min / 110 marks = 12/11; SL: 90 min / 80 marks = 9/8
  const mpm = examConfig.level === "HL" ? 12 / 11 : 9 / 8;
  const totalMinutes = Math.ceil(mpm * totalMarks);

  return (
    <div
      className="flex-shrink-0 rounded-xl border-2 border-indigo-300 bg-indigo-50 flex flex-col transition-[width] duration-200"
      style={{
        width: "var(--exam-builder-width, 20rem)",
        position: "sticky",
        top: 20,
      }}
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-2 border-b border-indigo-200">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-indigo-900 text-base">🏗 ExamBuilder</h3>
          <span className="text-xs font-semibold text-indigo-600">
            {queue.length} question{queue.length !== 1 ? "s" : ""}
          </span>
        </div>
        {queue.length > 0 && (
          <div className="flex items-center justify-between rounded-lg bg-indigo-100 border border-indigo-200 px-3 py-1.5 mb-2">
            <span className="text-xs font-bold text-indigo-800">
              {totalMarks} mark{totalMarks !== 1 ? "s" : ""}
            </span>
            <span className="text-xs font-semibold text-indigo-600">
              ≈ {totalMinutes} min
            </span>
          </div>
        )}

        {/* Exam config form */}
        <div className="space-y-2" suppressHydrationWarning>
          <input
            type="text"
            value={examConfig.name}
            onChange={(e) => onConfigChange({ name: e.target.value })}
            placeholder="Exam name (e.g. Mock 2026)"
            className="w-full rounded border border-indigo-300 px-2 py-1 text-sm font-semibold text-indigo-900 bg-white placeholder:text-indigo-300"
            suppressHydrationWarning
          />
          <div className="flex gap-2">
            <select
              value={examConfig.curriculum}
              onChange={(e) => onConfigChange({ curriculum: e.target.value as "AA" | "AI" })}
              className="flex-1 rounded border border-indigo-300 px-2 py-1 text-xs font-bold text-indigo-900 bg-white"
              suppressHydrationWarning
            >
              <option value="AA">AA</option>
              <option value="AI">AI</option>
            </select>
            <select
              value={examConfig.level}
              onChange={(e) => onConfigChange({ level: e.target.value as "HL" | "SL" })}
              className="flex-1 rounded border border-indigo-300 px-2 py-1 text-xs font-bold text-indigo-900 bg-white"
              suppressHydrationWarning
            >
              <option value="HL">HL</option>
              <option value="SL">SL</option>
            </select>
            <select
              value={examConfig.paper}
              onChange={(e) => onConfigChange({ paper: parseInt(e.target.value) as 1 | 2 | 3 })}
              className="flex-1 rounded border border-indigo-300 px-2 py-1 text-xs font-bold text-indigo-900 bg-white"
              suppressHydrationWarning
            >
              <option value={1}>P1</option>
              <option value={2}>P2</option>
              <option value={3}>P3</option>
            </select>
          </div>
          <select
            value={examConfig.courseId}
            onChange={(e) => {
              onConfigChange({ courseId: e.target.value });
              if (e.target.value) onClearCourseIdError();
            }}
            className={`w-full rounded border px-2 py-1 text-xs font-bold text-indigo-900 bg-white transition-colors ${
              courseIdError
                ? "border-2 border-red-500 ring-1 ring-red-400"
                : "border-indigo-300"
            }`}
            suppressHydrationWarning
          >
            <option value="">— Select class —</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <input
            type="date"
            value={examConfig.date}
            onChange={(e) => onConfigChange({ date: e.target.value })}
            className="w-full rounded border border-indigo-300 px-2 py-1 text-xs font-semibold text-indigo-900 bg-white"
            suppressHydrationWarning
          />
        </div>

        {/* Section controls (P1/P2 AA only) */}
        {showSections && queue.length > 0 && (
          <button
            type="button"
            onClick={onAutoSort}
            className="mt-2 w-full rounded border border-indigo-400 bg-white text-xs font-bold text-indigo-700 px-2 py-1 hover:bg-indigo-100"
          >
            ⇅ Sort: All Section A then Section B
          </button>
        )}

        {/* Random Exam button */}
        <button
          type="button"
          onClick={onToggleRandomPanel}
          className={`mt-2 w-full rounded border-2 text-xs font-bold px-2 py-1.5 transition-colors ${
            showRandomPanel
              ? "bg-violet-600 border-violet-600 text-white"
              : "border-violet-400 text-violet-700 bg-white hover:bg-violet-50"
          }`}
        >
          🎲 Random Exam
        </button>

        {/* Random exam panel */}
        {showRandomPanel && (
          <div className="mt-2 rounded-lg border border-violet-300 bg-violet-50 p-3 space-y-2">
            <p className="text-xs font-bold text-violet-900">
              Build a random exam within covered syllabus
            </p>

            {courseIdError && (
              <p className="text-xs font-semibold text-red-600">
                ↑ Please select a class first
              </p>
            )}

            <div>
              <label className="text-xs font-semibold text-violet-800 block mb-0.5">
                Target duration (minutes)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={30}
                  max={300}
                  step={5}
                  value={randomTargetMinutes}
                  onChange={(e) => onRandomTargetChange(parseInt(e.target.value) || 120)}
                  className="w-20 rounded border border-violet-300 px-2 py-1 text-sm font-bold text-violet-900 bg-white"
                />
                <span className="text-xs text-violet-600">
                  ≈ {Math.floor((randomTargetMinutes * 11) / 12)} marks
                </span>
              </div>
            </div>

            {randomError && (
              <p className="text-xs text-red-600 font-medium">{randomError}</p>
            )}

            <button
              type="button"
              onClick={onBuildRandom}
              disabled={buildingRandom}
              className="w-full rounded bg-violet-600 text-white text-xs font-bold py-1.5 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {buildingRandom ? "Building…" : "🎲 Build Exam"}
            </button>
          </div>
        )}
      </div>
      <div className="px-2 py-2 space-y-1">
        {queue.length === 0 && (
          <p className="text-center text-xs text-indigo-400 py-6">
            Click + next to a question to add it here
          </p>
        )}

        {showSections ? (
          <>
            {/* Section A group */}
            {sectionAItems.length > 0 && (
              <>
                <div className="px-2 py-1 text-xs font-bold text-blue-700 bg-blue-50 rounded border border-blue-200">
                  Section A ({sectionAItems.length})
                </div>
                {/* TODO: Section A header image placeholder */}
                <div className="px-2 py-1 text-xs text-gray-400 italic border border-dashed border-gray-300 rounded text-center">
                  [ Section A header image — coming soon ]
                </div>
                {sectionAItems.map((item, globalIdx) => {
                  const idx = queue.indexOf(item);
                  return (
                    <QueueRow
                      key={item.id}
                      item={item}
                      number={globalIdx + 1}
                      showSection={true}
                      minutesPerMark={mpm}
                      onOpenQuestion={() => onOpenQuestionFromQueue(item)}
                      onRemove={() => onRemove(item.id)}
                      onUpdateSection={(s) => onUpdateSection(item.id, s)}
                      onMoveUp={() => onMoveUp(idx)}
                    />
                  );
                })}
              </>
            )}

            {/* Section B group */}
            {sectionBItems.length > 0 && (
              <>
                <div className="px-2 py-1 text-xs font-bold text-orange-700 bg-orange-50 rounded border border-orange-200 mt-1">
                  Section B ({sectionBItems.length})
                </div>
                {/* TODO: Section B header image placeholder */}
                <div className="px-2 py-1 text-xs text-gray-400 italic border border-dashed border-gray-300 rounded text-center">
                  [ Section B header image — coming soon ]
                </div>
                {sectionBItems.map((item, bIdx) => {
                  const idx = queue.indexOf(item);
                  return (
                    <QueueRow
                      key={item.id}
                      item={item}
                      number={sectionAItems.length + bIdx + 1}
                      showSection={true}
                      minutesPerMark={mpm}
                      onOpenQuestion={() => onOpenQuestionFromQueue(item)}
                      onRemove={() => onRemove(item.id)}
                      onUpdateSection={(s) => onUpdateSection(item.id, s)}
                      onMoveUp={() => onMoveUp(idx)}
                    />
                  );
                })}
              </>
            )}

            {/* Unsectioned */}
            {unsectionedItems.map((item, uIdx) => {
              const idx = queue.indexOf(item);
              return (
                <QueueRow
                  key={item.id}
                  item={item}
                  number={sectionAItems.length + sectionBItems.length + uIdx + 1}
                  showSection={true}
                  minutesPerMark={mpm}
                  onOpenQuestion={() => onOpenQuestionFromQueue(item)}
                  onRemove={() => onRemove(item.id)}
                  onUpdateSection={(s) => onUpdateSection(item.id, s)}
                  onMoveUp={() => onMoveUp(idx)}
                />
              );
            })}
          </>
        ) : (
          queue.map((item, idx) => (
            <QueueRow
              key={item.id}
              item={item}
              number={idx + 1}
              showSection={false}
              minutesPerMark={mpm}
              onOpenQuestion={() => onOpenQuestionFromQueue(item)}
              onRemove={() => onRemove(item.id)}
              onUpdateSection={(s) => onUpdateSection(item.id, s)}
              onMoveUp={() => onMoveUp(idx)}
            />
          ))
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-indigo-200 space-y-2">
        <button
          type="button"
          onClick={onPreviewTest}
          disabled={!canPreview}
          className="w-full rounded-lg bg-indigo-600 text-white font-bold text-sm py-2 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          🖨 Preview Exam
        </button>
        <button
          type="button"
          onClick={onPreviewMS}
          disabled={!canPreview || !queueHasMarkscheme}
          className="w-full rounded-lg border-2 border-indigo-400 text-indigo-700 font-bold text-sm py-1.5 hover:bg-indigo-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title={!queueHasMarkscheme ? "No markscheme images in queue" : undefined}
        >
          📝 Preview Mark Scheme
        </button>

        {/* Save / Load row */}
        {activeExamId && examDirty && (
          <p className="text-xs font-semibold text-amber-700 flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
            Unsaved changes
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onSaveExam}
            disabled={savingExam || queue.length === 0}
            className={`flex-1 rounded text-white text-xs font-bold py-1.5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${
              activeExamId && examDirty
                ? "bg-amber-500 hover:bg-amber-600 animate-pulse"
                : "bg-green-600 hover:bg-green-700"
            }`}
            title={activeExamId ? "Overwrite saved exam" : "Save exam to database"}
          >
            {savingExam ? "Saving…" : activeExamId ? "💾 Overwrite" : "💾 Save Exam"}
          </button>
          <button
            type="button"
            onClick={onToggleSavedExams}
            className={`flex-1 rounded text-xs font-bold py-1.5 transition-colors border ${
              showSavedExams
                ? "bg-amber-100 border-amber-400 text-amber-800 hover:bg-amber-200"
                : "border-gray-300 text-gray-600 bg-white hover:bg-gray-100"
            }`}
          >
            📂 {showSavedExams ? "Hide" : "Load Exam"}
          </button>
        </div>

        {/* Saved exams list */}
        {showSavedExams && (
          <div className="rounded border border-amber-200 bg-amber-50 p-2 space-y-1 max-h-48 overflow-y-auto">
            <p className="text-xs font-bold text-amber-800 mb-1">Saved Exams</p>
            {loadingExams && <p className="text-xs text-gray-500">Loading…</p>}
            {!loadingExams && savedExams.length === 0 && (
              <p className="text-xs text-gray-500">No saved exams yet.</p>
            )}
            {savedExams.map((exam) => (
              <div
                key={exam.id}
                className={`flex items-center gap-1 rounded px-2 py-1 border ${
                  activeExamId === exam.id
                    ? "border-green-400 bg-green-50"
                    : "border-gray-200 bg-white"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-800 truncate">{exam.name}</p>
                  <p className="text-xs text-gray-500">
                    {exam.curriculum}{exam.level} P{exam.paper} · {exam.questions.length}q
                    {exam.exam_date ? ` · ${exam.exam_date}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onLoadExam(exam)}
                  className="rounded bg-indigo-600 text-white text-xs px-1.5 py-0.5 hover:bg-indigo-700 flex-shrink-0"
                >
                  Load
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteExam(exam.id)}
                  className="rounded bg-red-100 text-red-600 text-xs px-1.5 py-0.5 hover:bg-red-200 flex-shrink-0"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClear}
            disabled={queue.length === 0}
            className="flex-1 rounded border border-gray-300 text-xs font-bold text-gray-600 py-1 hover:bg-gray-100 disabled:opacity-40"
          >
            Clear all
          </button>
          <button
            type="button"
            onClick={onToggleTemplateEditor}
            className="flex-1 rounded border border-gray-300 text-xs font-bold text-gray-600 py-1 hover:bg-gray-100"
          >
            ⚙ Templates
          </button>
        </div>

        {/* Inline template editor */}
        {showTemplateEditor && (
          <div className="rounded border border-gray-200 bg-white p-2 space-y-1">
            <p className="text-xs font-bold text-gray-700 mb-1">Cover Slide Presentation IDs</p>
            {ALL_TEMPLATES.map(({ curriculum, level, paper }) => {
              const key = `${curriculum}-${level}-${paper}`;
              return (
                <div key={key} className="flex items-center gap-1">
                  <span className="text-xs font-semibold text-gray-600 w-16 flex-shrink-0">
                    {curriculum}{level} P{paper}
                  </span>
                  <input
                    type="text"
                    value={templateEdits[key] ?? ""}
                    onChange={(e) => onTemplateEditChange(key, e.target.value)}
                    placeholder="Presentation ID"
                    className="flex-1 rounded border border-gray-300 px-1.5 py-0.5 text-xs font-mono"
                  />
                </div>
              );
            })}
            <button
              type="button"
              onClick={onSaveTemplates}
              className="w-full mt-1 rounded bg-green-600 text-white text-xs font-bold py-1 hover:bg-green-700"
            >
              Save Templates
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function QueueRow({
  item,
  number,
  showSection,
  minutesPerMark,
  onOpenQuestion,
  onRemove,
  onUpdateSection,
  onMoveUp,
}: {
  item: TestQueueItem;
  number: number;
  showSection: boolean;
  minutesPerMark: number;
  onOpenQuestion: () => void;
  onRemove: () => void;
  onUpdateSection: (section: "A" | "B") => void;
  onMoveUp: () => void;
}) {
  return (
    <div
      className="flex items-center gap-1 rounded bg-white border border-indigo-200 px-2 py-1 text-xs hover:border-indigo-400"
    >
      {/* Move up */}
      <button
        type="button"
        onClick={onMoveUp}
        disabled={number === 1}
        title="Move up"
        className="text-indigo-400 hover:text-indigo-700 disabled:opacity-20 flex-shrink-0 leading-none"
      >
        ▲
      </button>
      {/* Number */}
      <span className="font-bold text-indigo-700 w-5 text-right flex-shrink-0">
        {number}.
      </span>
      {/* Code */}
      <button
        type="button"
        onClick={onOpenQuestion}
        className="flex-1 text-left font-semibold text-gray-800 truncate hover:underline"
        title="Open this question in the editor"
      >
        {item.code}
      </button>
      {/* Marks + time */}
      <span className="text-xs text-indigo-500 font-semibold flex-shrink-0">
        {item.marks}m·≈{Math.round(item.marks * minutesPerMark)}min
      </span>
      {/* Section toggle (P1/P2 AA only) */}
      {showSection && (
        <div className="flex gap-0.5 flex-shrink-0">
          <button
            type="button"
            onClick={() => onUpdateSection("A")}
            className={`rounded px-1 py-0.5 text-xs font-bold ${
              item.section === "A"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-500 hover:bg-blue-100"
            }`}
          >
            A
          </button>
          <button
            type="button"
            onClick={() => onUpdateSection("B")}
            className={`rounded px-1 py-0.5 text-xs font-bold ${
              item.section === "B"
                ? "bg-orange-500 text-white"
                : "bg-gray-100 text-gray-500 hover:bg-orange-100"
            }`}
          >
            B
          </button>
        </div>
      )}
      {/* Remove */}
      <button
        type="button"
        onClick={onRemove}
        className="text-gray-400 hover:text-red-600 font-bold ml-0.5 flex-shrink-0"
      >
        ×
      </button>
    </div>
  );
}

