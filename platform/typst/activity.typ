// ── CleverPlatform Nuanced Analysis — Typst template ────────────────────────
//
// This is the canonical Typst source file for Nuanced Analysis PDF generation.
// It is also embedded as a string inside lib/typst-render.service.ts for
// production API route use (zero file I/O at runtime).
//
// Usage (local Typst CLI for development):
//   typst compile activity.typ --input payload='{...json...}'
//
// Data contract: the JSON payload injected via sys.inputs.payload must conform
// to the ActivityPayload interface in lib/typst-render.service.ts.
// ─────────────────────────────────────────────────────────────────────────────

#let raw = sys.inputs.at("payload", default: "{}")
#let data = json(raw)
#let tmpl = data.template
#let content = data.content
#let opts = data.at("renderOptions", default: (:))

// ── Page setup ───────────────────────────────────────────────────────────────
#let page-size = if tmpl.document.pageSize == "a4" { "a4" } else { "us-letter" }
#set page(
  paper: page-size,
  margin: (
    top: str(tmpl.document.marginTopMm) + "mm",
    right: str(tmpl.document.marginRightMm) + "mm",
    bottom: str(tmpl.document.marginBottomMm) + "mm",
    left: str(tmpl.document.marginLeftMm) + "mm",
  ),
  header: if tmpl.header.enabled [
    #set text(size: 8pt, fill: rgb(tmpl.colors.muted))
    #grid(columns: (1fr, auto))[
      #if tmpl.header.leftTextMode == "documentTitle" [
        #content.title
      ] else if tmpl.header.leftTextMode == "courseName" [
        #content.at("course", default: "")
      ] else [
        #tmpl.header.at("customLeftText", default: "")
      ]
    ][
      #if tmpl.header.rightTextMode == "pageNumber" [
        #counter(page).display()
      ]
    ]
    #line(length: 100%, stroke: 0.3pt + rgb(tmpl.colors.border))
  ],
  footer: if tmpl.footer.enabled [
    #line(length: 100%, stroke: 0.3pt + rgb(tmpl.colors.border))
    #set text(size: 7pt, fill: rgb(tmpl.colors.muted))
    #grid(columns: (1fr, auto))[
      CleverPlatform Mathematics
    ][
      #if tmpl.footer.showPageNumber [
        Page #counter(page).display() of #counter(page).final().first()
      ]
    ]
  ],
)

#set text(
  font: tmpl.typography.bodyFont,
  size: str(tmpl.typography.bodySizePt) + "pt",
  fill: rgb(tmpl.colors.text),
)

#set par(leading: 0.7em, spacing: 0.8em)

// ── Colour aliases ────────────────────────────────────────────────────────────
#let col-primary = rgb(tmpl.colors.primary)
#let col-secondary = rgb(tmpl.colors.secondary)
#let col-accent = rgb(tmpl.colors.accent)
#let col-border = rgb(tmpl.colors.border)
#let col-tok = rgb(tmpl.colors.tokBox)
#let col-im = rgb(tmpl.colors.imBox)
#let col-strip = rgb(tmpl.colors.commandTermStrip)

// ── Helpers ───────────────────────────────────────────────────────────────────

#let tier-badge(tier) = [
  #if tier == 1 [ #text(fill: rgb("#1a7a4a"), size: 8pt)[\u{2605}] ]
  else if tier == 2 [ #text(fill: rgb("#1a5c9e"), size: 8pt)[\u{2605}\u{2605}] ]
  else if tier == 3 [ #text(fill: rgb("#8b3a8b"), size: 8pt)[\u{2605}\u{2605}\u{2605}] ]
]

#let answer-box(height-mm, continuation: none) = [
  #block(breakable: false, width: 100%)[
    #rect(
      width: 100%,
      height: str(height-mm) + "mm",
      stroke: str(tmpl.answerBoxes.borderWidthPt) + "pt + " + tmpl.colors.border,
      radius: 1pt,
    )
    #if continuation != none [
      #v(1pt)
      #text(size: 7pt, fill: rgb("#9ca3af"))[#continuation]
    ]
  ]
]

#let callout-box(body, fill-color: rgb("#f9fafb"), border-color: col-border, label: none) = [
  #block(breakable: false, width: 100%)[
    #rect(
      width: 100%,
      fill: fill-color,
      stroke: (
        left: 3pt + border-color,
        rest: 0.4pt + border-color,
      ),
      inset: (x: 8pt, y: 6pt),
      radius: (right: 2pt),
    )[
      #if label != none [
        #block(below: 3pt)[
          #text(size: 8pt, weight: "bold", fill: border-color)[#upper(label)]
        ]
      ]
      #body
    ]
  ]
]

// ── Document header block ────────────────────────────────────────────────────
#block(width: 100%)[
  #align(center)[
    #text(size: 9pt, weight: "bold", fill: col-secondary)[
      #upper(content.at("course", default: "IBDP Mathematics — Analysis and Approaches HL"))
    ]
    #v(5pt)
    #text(
      size: 19pt,
      weight: "bold",
      font: tmpl.typography.headingFont,
      fill: col-primary,
    )[#content.title]
    #v(3pt)
    #text(size: 11pt, fill: rgb("#4b5563"), style: "italic")[
      #content.at("subtitle", default: "Nuanced Analysis · IBDP Mathematics AA HL")
    ]
  ]
  #v(8pt)
  #line(length: 100%, stroke: 1.5pt + col-primary)
  #v(5pt)
  // Name and date fields
  #grid(columns: (1fr, 1fr), gutter: 16pt)[
    #text(size: 10pt)[*Student Name:* #h(4pt) #underline[#h(130pt)]]
  ][
    #text(size: 10pt)[*Date:* #h(4pt) #underline[#h(90pt)]]
  ]
  #v(4pt)
  // Topic and prereq metadata
  #if content.has("syllabusTopics") [
    #text(size: 9pt)[*Syllabus Topics:* #content.syllabusTopics]
    #v(2pt)
  ]
  #if content.has("prerequisites") [
    #text(size: 9pt)[*Prerequisites:* #content.prerequisites]
    #v(2pt)
  ]
  #if content.has("materials") [
    #text(size: 9pt, style: "italic")[#content.materials]
    #v(2pt)
  ]
  // Compulsory core callout
  #if content.has("compulsoryCore") [
    #v(2pt)
    #callout-box(
      fill-color: rgb("#f0fdf4"),
      border-color: rgb("#059669"),
      label: "Compulsory core (\u{2605} and \u{2605}\u{2605} questions)",
    )[
      #text(size: 9pt)[#content.compulsoryCore]
    ]
  ]
]

#v(10pt)

// ── Progress tracker ─────────────────────────────────────────────────────────
#if tmpl.progressTracker.enabled [
  #let part-count = content.sections.len()
  #block(width: 100%, fill: rgb("#f3f4f6"), inset: (x: 8pt, y: 4pt), radius: 2pt)[
    #text(size: 8pt, fill: rgb("#6b7280"))[
      *#tmpl.progressTracker.label* #h(6pt)
      #for i in range(part-count) [
        Part #str(i + 1) #box(
          width: 10pt,
          height: 10pt,
          stroke: 0.5pt + rgb("#9ca3af"),
          radius: 1pt,
        )[] #h(4pt)
      ]
    ]
  ]
  #v(8pt)
]

// ── Command Terms tear-off strip ─────────────────────────────────────────────
#if content.has("commandTerms") and content.commandTerms.len() > 0 [
  #line(length: 100%, stroke: (dash: "dashed", thickness: 0.7pt, paint: col-strip))
  #v(2pt)
  #block(width: 100%, fill: col-strip.lighten(88%), inset: 0pt)[
    // Header strip
    #block(fill: col-strip, width: 100%, inset: (x: 8pt, y: 3pt))[
      #text(size: 8pt, weight: "bold", fill: white)[
        #upper("Command Terms — Tear off and keep beside you while working")
      ]
    ]
    #block(inset: (x: 8pt, top: 6pt, bottom: 4pt))[
      // Table of terms
      #table(
        columns: (90pt, 1fr),
        stroke: 0.3pt + col-strip.lighten(40%),
        fill: (x, y) => if calc.odd(y) { col-strip.lighten(95%) } else { white },
        ..for ct in content.commandTerms {
          (
            text(weight: "bold", size: 9.5pt)[#ct.term],
            text(size: 9.5pt)[#ct.definition],
          )
        }
      )
      #v(5pt)
      // Demand-scale visual
      #block(width: 100%)[
        #text(size: 8pt, weight: "bold", fill: rgb("#4b5563"))[Output demand: ]
        #h(4pt)
        #text(size: 8pt)[
          Write down #sym.arrow.r State #sym.arrow.r Describe #sym.arrow.r Explain
          #sym.arrow.r Show that #sym.arrow.r #text(weight: "bold")[Prove]
        ]
      ]
      // Command-Term Spotlight (if present in first section)
      #if content.sections.len() > 0 and content.sections.first().has("spotlight") [
        #v(4pt)
        #callout-box(
          fill-color: col-strip.lighten(90%),
          border-color: col-strip,
          label: "Command-Term Spotlight: " + content.sections.first().spotlight.title,
        )[
          #text(size: 9pt)[#content.sections.first().spotlight.body]
        ]
      ]
    ]
  ]
  #v(2pt)
  #line(length: 100%, stroke: (dash: "dashed", thickness: 0.7pt, paint: col-strip))
  #v(8pt)
]

// ── TOK Provocations ─────────────────────────────────────────────────────────
#if content.has("tokProvocations") and content.tokProvocations.len() > 0 [
  #callout-box(
    fill-color: col-tok,
    border-color: col-accent,
    label: "TOK Provocations — return to these in the Reflection section",
  )[
    #for (i, tok) in content.tokProvocations.enumerate() [
      #text(size: 9.5pt)[*#str(i + 1).* #tok.body]
      #if i < content.tokProvocations.len() - 1 [#v(5pt)]
    ]
  ]
  #v(8pt)
]

// ── International Mindedness ──────────────────────────────────────────────────
#if content.has("internationalMindedness") [
  #callout-box(
    fill-color: col-im,
    border-color: rgb("#059669"),
    label: "International Mindedness",
  )[
    #text(size: 9.5pt)[#content.internationalMindedness.body]
  ]
  #v(8pt)
]

// ── Parts ────────────────────────────────────────────────────────────────────
#for section in content.sections [
  #v(str(tmpl.spacing.sectionGapMm) + "mm")

  // Section heading — glued to prereq box and first question
  #block(breakable: false)[
    #line(length: 100%, stroke: 2pt + col-primary)
    #v(3pt)
    #text(
      size: 12pt,
      weight: "bold",
      font: tmpl.typography.headingFont,
      fill: col-primary,
    )[#section.heading]
    #v(4pt)

    // Prerequisite micro-box
    #if section.has("prerequisiteBox") [
      #callout-box(
        fill-color: rgb("#eff6ff"),
        border-color: rgb("#3b82f6"),
        label: "What you need to start this Part",
      )[
        #for item in section.prerequisiteBox.items [
          - #text(size: 9pt)[#item]
        ]
      ]
      #v(4pt)
    ]
  ]

  // Command-Term Spotlight (mid-section callout)
  #if section.has("spotlight") and section.partNumber > 0 [
    #callout-box(
      fill-color: col-strip.lighten(90%),
      border-color: col-strip,
      label: "Command-Term Spotlight: " + section.spotlight.title,
    )[
      #text(size: 9.5pt)[#section.spotlight.body]
    ]
    #v(4pt)
  ]

  // Questions
  #for q in section.questions [
    #block(breakable: false)[
      // Prompt + marks row
      #grid(
        columns: (28pt, 1fr, 48pt),
        gutter: 6pt,
        align: (top, top, top),
      )[
        #text(weight: "bold", size: 11pt)[#str(q.globalNumber).]
        #tier-badge(q.tier)
      ][
        #text(size: str(tmpl.typography.bodySizePt) + "pt")[#q.prompt]
        #if q.has("hint") [
          #v(2pt)
          #text(size: 9pt, style: "italic", fill: rgb("#6b7280"))[_Hint:_ #q.hint]
        ]
      ][
        #if tmpl.questionBlocks.showMarks [
          #text(size: 8.5pt, fill: rgb("#6b7280"))[[#str(q.marks) mark#if q.marks != 1 [s]]]
        ]
        #if tmpl.questionBlocks.showEstimatedMinutes [
          #v(2pt)
          #text(size: 7.5pt, fill: rgb("#9ca3af"))[(~#str(q.estimatedMinutes) min)]
        ]
      ]
      #v(str(tmpl.spacing.promptToAnswerGapMm) + "mm")
      // Answer box — kept with prompt via breakable: false on parent block
      #answer-box(
        q.answerBox.heightMm,
        continuation: if q.answerBox.continuation.enabled { q.answerBox.continuation.label } else { none },
      )
    ]
    #v(str(tmpl.spacing.questionGapMm) + "mm")
  ]

  // Translation table
  #if section.has("translationTable") [
    #v(4pt)
    #text(size: 9pt, weight: "bold")[#section.translationTable.caption]
    #v(3pt)
    #block(breakable: false)[
      #table(
        columns: (1fr, 1fr),
        stroke: 0.4pt + col-border,
        fill: (x, y) => if y == 0 { rgb("#f3f4f6") } else if calc.odd(y) { white } else { rgb("#f9fafb") },
        table.header(
          text(weight: "bold", size: 9pt)[What you say in your head...],
          text(weight: "bold", size: 9pt)[What you write on the exam paper...],
        ),
        ..for row in section.translationTable.rows {
          (
            text(size: 9pt, style: "italic")[#row.informal],
            text(size: 9pt)[#row.formal],
          )
        }
      )
    ]
  ]

  // Geometric / Physical Reading
  #if section.has("geometricReading") [
    #v(4pt)
    #callout-box(
      fill-color: rgb("#f9fafb"),
      border-color: col-border,
      label: "Geometric / Physical Reading",
    )[
      #text(size: 9.5pt, style: "italic")[#section.geometricReading.body]
    ]
  ]
]

// ── Teacher's Companion ───────────────────────────────────────────────────────
#if opts.at("includeTeacherCompanion", default: false) [
  #pagebreak(weak: false)
  #line(length: 100%, stroke: 2pt + col-accent)
  #v(6pt)
  #text(size: 16pt, weight: "bold", fill: col-accent)[Teacher's Companion]
  #v(4pt)
  #callout-box(
    fill-color: rgb("#faf5ff"),
    border-color: col-accent,
    label: "For the instructor",
  )[
    #text(size: 9.5pt)[
      Remove this page before distributing to students.
      This companion contains the integration map, model moves, answer sketches,
      planted-error keys, tiered deadline guidance, compulsory core list,
      and differentiation notes.
    ]
  ]
]
