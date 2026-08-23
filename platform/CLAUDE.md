# CleverPlatform — Claude Code Instructions

Read these files FIRST, in this order, before doing anything:

1. platform/AGENTS.md — git rules, LaTeX conventions, test requirements
2. platform/docs/design/DEPLOYMENT_RUNBOOK.md — push workflow, failure modes
3. SCHEMA.md (repo root) — database table reference

Design docs (read before any NA content or PDF layout work):
- platform/docs/design/DESIGN_INSTRUCTIONS.md
- platform/docs/design/NA_TEMPLATE_DESIGN_PRINCIPLES.md
- platform/docs/design/SPATIAL_COHESION_AND_PAGINATION.md
- platform/docs/design/NA_GREAT_UNIFICATION_EXEMPLAR.md

## Non-negotiables
- Dev server: always npm run dev (--webpack). Never --turbopack.
- Never rename platform/src/proxy.ts or add middleware.ts alongside it.
- ASCII dashes only in comments (---- not Unicode box-drawing chars).
- Build + test before every push: npm run build && npm test
- main = production. No staging environment. Real student data.
- "Clev's Marks" in all UI copy for grading/scores.
