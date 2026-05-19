// =============================================================================
// Core domain types
// =============================================================================
export * from './types';
// ^ UserRole, Profile, Course, Student, ParentLink, RegistrationCode

// =============================================================================
// Reflection types
// =============================================================================
export * from './reflection-types';
// ^ ReflectionItem, ReflectionTest, SelfScore, PdfUpload, OverrideToken,
//   SubtopicMastery, StudentReflectionRow, ReflectionStep, HeatmapCell

// =============================================================================
// Seating types — Student aliased to SeatingStudent (conflicts with types.ts)
// =============================================================================
export type {
  Student as SeatingStudent,
  Seat,
  Rule,
  RuleFeedback,
  Assignment as SeatingAssignment,
  Setting as SeatingSetting,
  SeatingLayout,
} from './seating-types';

// =============================================================================
// Auth
// =============================================================================
export * from './auth';

// =============================================================================
// Services
// =============================================================================
export * from './exam-service';
export * from './seating-data';
export * from './seating-engine';
export * from './google-classroom';
export * from './google-drive';
export * from './drive-doc-matching';

// =============================================================================
// Utilities
// =============================================================================
export * from './latex-utils';
export * from './command-term-flags';
export * from './question-parts-compat';
export * from './question-image-filter';
export * from './graph-raster-snap';
export * from './http-json';
export * from './chat-audio';

// =============================================================================
// Assignments — clampInt / extractJsonObject omitted (conflict with dp-question-designer)
// =============================================================================
export type {
  DocumentKind,
  FormattingRequirements,
  AssignmentInput,
  AssignmentQuestion,
  AssignmentSection,
  AssignmentDraft,
  ClaudeTextBlock,
  ClaudeResponse,
  SavedTemplate,
  AssignmentPdfRequest,
} from './assignments';
export {
  buildSystemPrompt,
  buildUserPrompt,
  sanitizeDraft,
  formatQuestionLabel,
  escapeHtml,
  generateAssignmentHtml,
} from './assignments';

// =============================================================================
// DP Question Designer — clampInt / extractJsonObject omitted (same conflict)
// =============================================================================
export type {
  Curriculum,
  Level,
  DPQuestionDesignerInput,
  KeyProof,
  ExplorationActivity,
  CurriculumStage,
  CurriculumModule,
  DPDesignerTemplate,
  DeepSeekTextBlock,
  DeepSeekResponse,
} from './dp-question-designer';
export {
  FUNCTION_FAMILY_PRESETS,
  DEFAULT_DP_INPUT,
  buildDPSystemPrompt,
  buildDPUserPrompt,
  sanitizeCurriculumModule,
} from './dp-question-designer';
