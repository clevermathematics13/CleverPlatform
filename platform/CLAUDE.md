# CleverPlatform — Claude Code Instructions

Read these files FIRST, in this order, before doing anything:

1. platform/docs/HANDOFF.md — current state, what an agent can/cannot reach, open items
2. platform/AGENTS.md — git rules, LaTeX conventions, test requirements
3. platform/docs/design/DEPLOYMENT_RUNBOOK.md — push workflow, failure modes
4. SCHEMA.md (repo root) — database table reference

Design docs (read before any NA content or PDF layout work):
- platform/docs/design/DESIGN_INSTRUCTIONS.md
- platform/docs/design/NA_TEMPLATE_DESIGN_PRINCIPLES.md
- platform/docs/design/SPATIAL_COHESION_AND_PAGINATION.md
- platform/docs/design/NA_GREAT_UNIFICATION_EXEMPLAR.md

## Non-negotiables
- Dev server: always npm run dev (--webpack). Never --turbopack.
  This covers the DEV SERVER only. `npm run build` passes no bundler flag,
  so production builds with Turbopack -- Next 16's default -- and always has.
  What actually keeps Turbopack safe is the ASCII-dashes rule below.
- Never rename platform/src/proxy.ts or add middleware.ts alongside it.
- ASCII dashes only in comments (---- not Unicode box-drawing chars).
- Build + test before every push: npm run build && npm test
- main = production. No staging environment. Real student data.
- "ClevMarks" in all UI copy for grading/scores (renamed from "Clev's
  Marks" on 24 Sep 2026; older comments and printed packets still say that).
- Never "AI" (or a model name such as Claude) anywhere a student can see it:
  student page copy, URLs and API paths a student's browser calls, JSON
  field names it receives, error messages. Teacher pages may say AI.
  Components shared with the student bundle (e.g. TeacherDashboard.tsx,
  which reflection-client.tsx imports) count as student-facing.
- Migrations: platform/supabase/migrations must stay 1:1 with the live ledger.
  Read platform/supabase/migrations/README.md before adding one.
- AI-grading numerical-accuracy policy (IBDP AA HL Paper 2) lives in
  platform/grading_policies/ibdp_math_aa_hl_paper_2_numerical_accuracy.md —
  it is loaded at runtime by lib/ai-grading.ts (buildGradingSystemPrompt),
  not just documentation. Edit the .md file, not a copy of its text.
- Grade 9 STANDARD Level marking policy lives in
  platform/grading_policies/g9_standard_level_marking_principles.md — loaded
  at runtime by lib/ai-grading.ts for any test whose tests.standards_rubric is
  non-null, IN PLACE OF the Formative Assessment principles. Edit the .md
  file, not a copy of its text. The strands, level bands and part map are
  data on the test (lib/standards-rubric.ts), never code.
- Exploration/homework (ACTIVITY) marking policy lives in
  platform/grading_policies/mathmedic_activity_marking_principles.md — loaded
  at runtime by lib/ai-grading.ts for any test whose tests.activity_rubric is
  non-null, IN PLACE OF BOTH the Formative Assessment and the Standard Level
  principles. Edit the .md file, not a copy of its text. It deliberately
  REVERSES the "a bare answer earns no method mark" rule the other two share,
  because an Exploration is sat before the lesson. The learning targets,
  outcome bands and part map are data on the test (lib/activity-rubric.ts),
  never code; the classes it is offered for are ACTIVITY_COURSE_NAMES there.
- Grade-boundary suggestion policy lives in
  platform/grading_policies/grade_boundary_principles.md — loaded at runtime by
  lib/boundary-suggestion.ts (buildBoundarySystemPrompt) for every AI boundary
  suggestion, not just documentation. Edit the .md file, not a copy of its text.
  The fixed rules (whole-mark lines, guidance precedence, no student names) are
  in code after it, so editing the file cannot remove them. Each assessment has
  its OWN boundaries (grade_boundary_sets.test_id); they change only through
  decide_test_boundaries(), with a stated reason -- never repoint
  tests.boundary_set_id by hand.
- NA student feedback voice lives in
  platform/feedback_voice/na_student_feedback_voice.md — loaded at runtime by
  lib/na-assessment.ts (buildAssessmentSystemPrompt), not just documentation.
  Edit the .md file, not a copy of its text. Every sender must build its system
  prompt through buildAssessmentSystemPrompt(); the raw prompt constants are
  deliberately unexported so missing one is a compile error.
  worker/Dockerfile MUST copy feedback_voice/ — the worker imports that module,
  so a missing file throws at import and the worker never starts.
