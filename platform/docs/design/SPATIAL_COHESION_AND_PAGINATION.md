# Spatial Cohesion and Pagination Rules

## Purpose

This file defines the rules Claude should follow when designing layouts for Nuanced Analysis activities and when implementing the CleverPlatform document generation pipeline.

The central problem is spatial cohesion.

Students should experience a question, its visuals, its equations, and its answer space as one meaningful unit.

## Main rule

Keep the prompt and its answer space together whenever possible.

A question should not be stranded at the bottom of a page with the answer box on the next page.

An equation should not be separated from the prompt or working space it belongs to.

A diagram should not float away from the question that asks students to interpret it.

## Typst target implementation

### Atomic question block

Use Typst atomic blocks for normal prompt-answer pairs.

```typst
#block(breakable: false)[
  #question-prompt(...)
  #answer-box(...)
]
```

### When the block is too large

If the full question block does not fit on the current page, the renderer should choose one of three strategies:

1. Move the entire block to the next page.
2. Split only the answer space using a designed continuation layout.
3. Redesign the block using a larger page area or a different template variant.

Do not split randomly.

## Decision rules

### Rule 1: Full fit
If prompt plus full answer box fits, render as one unbreakable block.

### Rule 2: Move entire block
If the prompt plus minimum useful answer space does not fit, move the entire block to the next page.

### Rule 3: Partial answer box with continuation
If the prompt fits and enough useful answer space remains, render a partial answer box that fills the remaining space, then create a continuation box on the next page.

### Rule 4: Never create useless boxes
Do not create tiny answer spaces that cannot hold meaningful work.

```json
{
  "minimumUsefulAnswerBoxHeightMm": 28,
  "continuationBoxMinHeightMm": 35
}
```

### Rule 5: Avoid oversized blank space
If moving a block creates a large blank region, attempt a continuation answer box strategy before leaving the page blank.

### Rule 6: Preserve visual rhythm
Do not solve every whitespace issue by stretching boxes. Moderate expansion is acceptable. Extreme stretching makes the page feel sloppy.

## Recommended AST fields for cohesion

```json
{
  "type": "questionBlock",
  "id": "q01",
  "marks": 3,
  "estimatedMinutes": null,
  "cohesion": {
    "keepPromptWithAnswerBox": true,
    "keepStemWithFirstSubQuestion": true,
    "allowAnswerContinuation": true,
    "minimumUsefulAnswerBoxHeightMm": 28,
    "preferMoveWholeBlockOverTinyContinuation": true
  },
  "answerBox": {
    "kind": "lined",
    "heightMm": 55,
    "lineSpacingMm": 7,
    "continuation": {
      "enabled": true,
      "label": "Continue your response here"
    }
  }
}
```

## Visual quality checks

Before accepting a generated PDF, the system should check for:

1. Prompt orphaning.
2. Answer box orphaning.
3. Diagrams separated from prompts.
4. Graphs extending beyond the page boundary.
5. Equations overflowing the text area.
6. Excessive blank space.
7. Tiny unusable continuation boxes.
8. Inconsistent spacing between question blocks.
9. Headers or footers colliding with content.
10. Section titles appearing alone at the bottom of a page.

## Template behavior should be explicit

Do not hide layout rules in prose.

Rules like "keep question and answer together" should be represented in the template AST and validated by schema.

The layout engine should not guess. It should execute clearly defined rules.

## Pacing formula

`estimated minutes = round(marks * 12 / 11)`

This should remain configurable in the template AST.
