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
  Marks" on 24 Sep 2026; HANDOFF sections 1-41, migrations and printed
  packets still say that, on purpose).
- A ClevMark is NEVER lowered or cleared once the student has self-assessed
  the test (the teacher's rule, 25 Sep 2026) -- any student_self_scores row
  on any part of the test counts. Before ANY grade-down, including SQL run
  through MCP, check student_self_scores for that student on that test; any
  row means no. The six routes that write student_marks enforce it through
  lib/protected-marks.ts, and the trigger student_marks_protect_self_assessed
  backs them: it keeps the old value (or skips the delete) with a WARNING
  instead of raising, so read the value back after any write. Never disable
  the trigger without the teacher's explicit instruction. Deleting a test or
  a part still removes its marks. See docs/HANDOFF.md section 42.
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
- Reading-integrity rules (what counts as the student's work: never the mark
  scheme's working, not a blank space, not erased pencil, never a rebuilt
  unreadable page) live in
  platform/grading_policies/reading_integrity_principles.md -- interpolated
  into GRADING_SYSTEM_PROMPT itself (lib/ai-grading.ts), so every paper type
  gets them. Edit the .md file, not a copy of its text. Its rules are NAMED,
  not numbered: rules 1-20 are cited by number elsewhere.
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
  so a missing file throws at import and the worker never starts. The same
  holds for grading_policies/: the worker reaches lib/ai-grading.ts through
  lib/na-scanning.ts. lib/worker-runtime-files.test.ts checks every folder a
  worker module reads is copied.
- Lessons from marking, for the generators, live in
  platform/generation_lessons/ -- one file per family (g9_extended,
  g9_standard, ibdp_aa_hl), each in its own marking language (M/A/R/FT;
  strand descriptors, never mark codes; IB conventions). Loaded by
  lib/generation-lessons.ts (server-only) for the NA generator (via
  /api/nuanced-analyses/continuity), /admin/create, the Assessment Creator
  (via /api/generation-lessons) and practice questions. Edit the .md files,
  not a copy of their text. Never import lib/generation-lessons.ts into a
  client module: the browser-side prompt builders take the lessons as a
  string.
