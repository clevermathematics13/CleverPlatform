# Nuanced Analysis Activity Template Design Principles

## Core identity

Nuanced Analysis activities should feel like polished IB Mathematics learning documents, not generic worksheets.

They should combine:

1. Clean publishing-grade layout.
2. Strong mathematical structure.
3. Enough visual variety to reduce cognitive fatigue.
4. Clear student-facing instructions.
5. Thoughtful prompts that invite interpretation, reasoning, and reflection.
6. Carefully placed answer spaces that match the expected thinking demand.

The design should support mathematical thinking, not decorate around it.

## Audience

The primary audience is secondary mathematics students in IB and MYP contexts, especially students working through high-cognitive-load mathematics tasks.

Students may include English language learners, neurodiverse learners, and students who benefit from clear visual structure.

The tone should be rigorous but accessible. Avoid childish design choices, but do not make the page feel sterile.

## Template priorities

1. Mathematical clarity.
2. Spatial cohesion.
3. Predictable page breaks.
4. Readable graphs, diagrams, tables, and equations.
5. Student-friendly command terms.
6. Adequate answer space.
7. Teacher-controlled styling through validated template settings.

Do not let content generation override template constraints.

## Layout principles

Each activity page should have a clear visual hierarchy:

1. Document title or section title.
2. Short conceptual framing.
3. Task or question stem.
4. Definitions or vocabulary, when needed.
5. Student action prompts.
6. Graphs, diagrams, data tables, or equations.
7. Answer space.

Question prompts and answer boxes should normally stay together. A student should not see a prompt at the bottom of one page and the answer box at the top of the next page unless a deliberate continuation layout is used.

## Mathematical presentation principles

Equations must be typeset natively and beautifully.

Mathematical expressions should not rely on browser DOM mutations, screenshots, or fragile post-processing.

The system should know the physical dimensions of mathematical content before placing it.

When possible, mathematical notation should be consistent with IB conventions.

## Cognitive load principles

Students should not have to decode the page layout before doing the mathematics.

Use spacing, typography, section boxes, and icons sparingly to guide attention.

Avoid pages that feel like a wall of text.

## Vocabulary and command terms

Important mathematical vocabulary should be defined when it is central to the activity.

Definitions should be concise, student-facing, and placed near first use.

Command terms should be visible and intentional.

Avoid vague prompts such as "write about this" or "explain what you notice" unless the response structure is clearly supported.

## Nuanced Analysis activity structure

A strong Nuanced Analysis activity often includes:

1. A focused mathematical object or situation.
2. A prediction or interpretation prompt.
3. A representation shift.
4. A reasoning prompt.
5. A check for precision, limitations, or assumptions.
6. A connection to IB Mathematics, TOK, another discipline, or a real context.

## TOK and interdisciplinary engagement

TOK connections should not feel bolted on. They should emerge naturally from the mathematics.

Useful TOK angles include how a model shapes what we notice, how precision creates the appearance of certainty, how visual representations can persuade or mislead, and how assumptions affect conclusions.

## Answer space design

Answer boxes should be purposeful. Different response types need different spaces:

1. Short numerical answer: compact box.
2. Explanation: lined or lightly structured box.
3. Algebraic work: open working space.
4. Graphing: coordinate grid or diagram area.
5. Reflection: smaller box with a clear prompt.
6. Multi-step solution: larger working space that stays attached to the prompt.

## Determinism

The same input content and same template settings should produce the same output PDF.

Do not rely on unpredictable browser rendering, user machine fonts, or manual post-processing.

## Anchor-safe layout (scan pipeline contract)

Every A.1 grading incident in HANDOFF.md §5 came from crop geometry that
did not match where students actually wrote. These rules exist so no
future packet can repeat them:

1. Everything a student might write on belongs inside ONE question block:
   prompt, enumerated sub-items, tables to complete, and the answer box.
   Students annotate printed items inline (A.1 Q1, Q2, Q15) and complete
   printed table rows (Q9, Q16-Q17) wherever they appear; if such an
   element sits outside the block, its crop structurally cannot see the
   writing (there is no upward crop expansion).
2. The scan anchor spans the whole question block, not just the drawn
   box. The Typst template emits a `<na-anchor>` metadata marker pair
   around each question block; `TypstRenderService.render()` queries them
   and returns exact per-question geometry (`anchor_source =
   'typst_metadata'`). Never measure anchors off printed paper for a
   Typst-generated packet, and never hand-derive `expand_max_*` from a
   neighbour's authored coordinate.
3. Question blocks stay unbreakable. Anchor emission fails loudly if a
   marker pair lands on two pages.
4. Persist at generation time. Rendering with `persist` stores the master
   PDF and creates the packet version + anchors in one step; a packet
   whose master was never stored (A.1) can only be re-measured from
   student scans afterwards.
5. Every page carries the version label in its footer. Scanned paper must
   be able to say which render it came from -- the 1 Sep 2026 geometry
   incident (scanner auto-crop and photocopier scaling silently
   misaligning a whole cohort) burned hours because paper had no identity.
6. Scans are registered before cropping. Scanner auto-crop, copier
   reduction and duplex offsets are per-page affine distortions; the
   normalization tooling (platform/scripts/scan_geometry/) must be run on
   any batch whose pages do not verify against the master geometry.

## Non-negotiables

1. Do not store raw HTML, CSS, or LaTeX strings in the database as template configuration.
2. Do not allow malformed templates to be saved.
3. Do not separate prompts from answer spaces unless a designed continuation layout is used.
4. Do not let equations render as images when native math rendering is possible.
5. Do not create templates that require manual page-by-page repair.
6. Do not hide important layout decisions in unvalidated free-text fields.
