// Shared types for the question bank components

export interface MarkAttribution {
  subtopicCode: string;
  source: 'manual' | 'ai';
  rationale?: string;
}

export interface QuestionPart {
  id: string;
  part_label: string;
  marks: number;
  subtopic_codes: string[];
  primary_subtopic_code?: string | null;
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
  /** Persisted mark-level subtopic attributions, keyed by token ID. */
  mark_attributions?: Record<string, MarkAttribution> | null;
}

export interface QuestionImage {
  id: string;
  image_type: "question" | "markscheme";
  storage_path: string;
  sort_order: number;
  alt_text: string | null;
  url: string | null;
}

export interface GraphImageCrop {
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

export interface Question {
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
  teacher_notes: string | null;
  /** Short note field used in QuestionRow note panel. */
  note?: string | null;
  question_parts: QuestionPart[];
}

export interface Course {
  id: string;
  name: string;
}

export interface TestQueueItem {
  id: string;
  code: string;
  section: "A" | "B" | null;
  curriculum: string[];
  hasQuestion: boolean;
  hasMarkscheme: boolean;
  marks: number;
  /** Optional per-question answer-box height override (mm) for Section A print output. */
  answerBoxMm?: number | null;
  subtopicCodes: string[];
  partSubtopics: { partLabel: string; codes: string[] }[];
}

export interface ExamConfig {
  name: string;
  curriculum: "AA" | "AI";
  level: "HL" | "SL";
  paper: 1 | 2 | 3;
  courseId: string;
  date: string;
  time: string;
  answerBoxMode: "auto" | "fixed";
  answerBoxFixedMm: number;
}

export interface SavedExam {
  id: string;
  name: string;
  curriculum: "AA" | "AI";
  level: "HL" | "SL";
  paper: 1 | 2 | 3;
  course_id: string | null;
  exam_date: string | null;
  exam_time: string | null;
  /** Auto-set flag. 'no_datetime' means the exam was saved without a date or time. */
  notes: string | null;
  questions: TestQueueItem[];
  created_at: string;
  updated_at: string;
}

export interface Subtopic {
  code: string;
  descriptor: string;
  section: number;
}

export interface Filters {
  sessions: string[];
  timezones: string[];
  subtopics: Subtopic[];
}

export interface GraphExtractFailure {
  status: number;
  error: string;
  warnings: string[];
  feedback: string[];
  graphSpec?: import("@/components/IbGraph").IbGraphSpec;
  graphMeta?: Record<string, unknown>;
}

export interface GraphExtractSnapshot {
  status: number;
  ok: boolean;
  error?: string;
  warnings: string[];
  feedback: string[];
  graphSpec?: import("@/components/IbGraph").IbGraphSpec;
  graphMeta?: Record<string, unknown>;
}

export interface DocExtractTroubleshooting {
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

export interface ExtractPlan {
  qDraft: string;
  msDraft: string;
  finalLabels: string[];
  isWholeQuestion: boolean;
  stemQ: string;
  stemMS: string;
  splitQ: Map<string, string>;
  splitMS: Map<string, string>;
  claudeParts: { label: string; marks: number; commandTerm: string; primarySubtopicCode?: string; subtopicCodes: string[] }[];
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
