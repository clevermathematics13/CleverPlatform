/**
 * nuanced-analysis-spec.defaults.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * The CANONICAL IBDP Mathematics: Analysis & Approaches HL NuancedAnalysisSpec.
 *
 * This is the extensive, hardcoded "feel" of a Nuanced Analysis, expressed as a
 * fully-validated NuancedAnalysisSpec object. It is:
 *   - the seed for the `nuanced_analysis_specs` table (canonical AA HL row), and
 *   - the fallback the generator uses when no DB spec is found, and
 *   - the starting point the "Edit Template" flow clones when a teacher creates
 *     a course-specific variant.
 *
 * It is the machine-readable synthesis of the six project knowledge files and
 * the three exemplars, PLUS the flipped → in-class → take-home delivery spine.
 *
 * Every value here is validated by NuancedAnalysisSpecSchema (see the test).
 * To change what a Nuanced Analysis is, edit this object (or, in production, the
 * DB row) — never scatter the rules across prompt strings again.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { NuancedAnalysisSpec } from "./nuanced-analysis-spec.schema";


// Single backslash char, built at runtime so this source file stays backslash-free
// (prevents LaTeX double-backslash collapse when the file is regenerated/pushed).
const BS = String.fromCharCode(92);

export const CANONICAL_AAHL_SPEC: NuancedAnalysisSpec = {
  // ── 1. Identity ─────────────────────────────────────────────────────────────
  identity: {
    specId: "na-spec-aahl-canonical-v1",
    specVersion: "2026-07-14.1",
    name: "Nuanced Analysis — Canonical (IBDP Mathematics AA HL)",
    course: {
      programme: "IBDP",
      subject: "Mathematics",
      strand: "AA",
      level: "HL",
      label: "IBDP Mathematics: Analysis & Approaches HL",
      studentAgeRange: "16–18",
    },
    // Core is designed to be attemptable without a calculator, in the spirit of
    // Paper 1; technology tasks are explicitly quarantined into their own Part.
    calculatorPolicy: "mixed",
    paperStyles: ["paper1", "paper3"],
    defaultDurationLessons: 4,
    lessonLengthMinutes: 50,
    pageTargetMin: 12,
    pageTargetMax: 22,
  },

  // ── 2. Core philosophy ──────────────────────────────────────────────────────
  corePhilosophy: {
    definition:
      "A Nuanced Analysis is a coherent, multi-part guided investigation — not a worksheet of harder problems and not a set of unrelated exercises. It develops a single mathematical idea across many representations and rewards reasoning, conjecture, and reflection over answer-getting. It always includes a student-facing packet and a Teacher's Companion, and it earns its cross-topic integration through the mathematics rather than stapling topics on for coverage.",
    arc: [
      "concrete / numerical entry",
      "investigation",
      "conjecture",
      "justification / proof",
      "application",
      "reflection",
    ],
    representationForms: [
      "algebraic",
      "graphical",
      "numerical",
      "geometric",
      "verbal",
      "technological",
      "applied",
      "tabular",
    ],
    antiPatterns: [
      {
        id: "not-harder-worksheet",
        rule: "Not a worksheet with harder problems. There must be an arc (conjecture → proof → application → reflection), not a pile of unrelated questions.",
      },
      {
        id: "not-front-to-back-only",
        rule: "Not a packet that only makes sense front-to-back. Every Part must be enterable from its own 'What you need to start this Part' micro-box.",
      },
      {
        id: "not-punishing-extension",
        rule: "Not a packet where the extension feels like punishment. Extensions are natural next questions for curious students, not extra work for fast finishers.",
      },
      {
        id: "not-visible-scaffold",
        rule: "Not a packet where scaffolding is forced on everyone. Scaffolding is opt-in (fold-under / collapsible) so advanced students are not condescended to.",
      },
      {
        id: "not-language-test",
        rule: "Not a packet where the mathematics is a vehicle for a language test. ELL students must not be disadvantaged on the algebra or proof sections.",
      },
      {
        id: "not-forced-integration",
        rule: "Not a packet where integration is forced. A topic that does not connect to the thread belongs in a different activity; say so honestly in the Design Note.",
      },
    ],
  },

  // ── 3. Three-phase delivery model ───────────────────────────────────────────
  threePhaseModel: {
    enabled: true,
    flippedClassroom: {
      enabled: true,
      purpose:
        "Prepare students BEFORE the lesson so class time is spent on reasoning, not on being told the theory. Students trip over the concept first, build intuition, and arrive with a conjecture and vocabulary in hand.",
      requiredElements: [
        {
          id: "flip-play-before-proof",
          rule: "Include a 'Play Before Proof' technology sandbox (a Desmos/GeoGebra link or QR code with sliders) that leads students to notice the central phenomenon before any formula is stated.",
          rationale:
            "Discovery-first framing; the concept is met graphically/numerically before it is named.",
        },
        {
          id: "flip-prior-knowledge",
          rule: "Include Part 0 — Activating Prior Knowledge — as pre-class work: 3–4 short callback tasks that rebuild the exact prerequisites the in-class Parts assume.",
        },
        {
          id: "flip-vocabulary-preview",
          rule: "Include a short vocabulary / translation-table preview so students arrive already exposed to the precise IB language they will need.",
        },
        {
          id: "flip-entry-conjecture",
          rule: "End the flipped phase with one low-stakes conjecture prompt the student brings to class — the hook the in-class phase will justify or refute.",
        },
      ],
      partAllocationGuidance:
        "Part 0 and the first numerical-investigation Part typically live here. Keep this phase to accessible (★) tasks only — no proof, no ★★★.",
      timingGuidanceMinutes: 30,
      deliverables: [
        "Completed Part 0 callbacks",
        "A written entry conjecture to bring to the lesson",
        "Sandbox observations (2–3 noticings)",
      ],
      accessibilityNotes: [
        "All flipped tasks must be completable without teacher presence and with the micro-box alone.",
        "Provide the sandbox observation as a bullet-point option; do not require prose before the lesson.",
      ],
    },
    inClass: {
      enabled: true,
      purpose:
        "Use lesson time for the cognitively demanding core: turning conjecture into justification and proof, surfacing misconceptions through planted errors, and building representational fluency together.",
      requiredElements: [
        {
          id: "inclass-conjecture-to-proof",
          rule: "Carry the entry conjecture through to a justification or proof (e.g. Show that / Prove, including at least one induction template where the mathematics supports it).",
        },
        {
          id: "inclass-planted-error",
          rule: "Include at least one 'Broken Math Critique' / 'Find the Fatal Error' task, worked collaboratively — ask why the result is unreasonable first, then locate and correct the single error.",
        },
        {
          id: "inclass-translation-table",
          rule: "Include at least one Translation Table converting informal student language into rigorous IB phrasing for this topic.",
        },
        {
          id: "inclass-command-spotlight",
          rule: "Include a Command-Term Spotlight for the pair of terms most easily confused in this topic (e.g. Show that vs Prove, Sketch vs Draw, Hence vs Hence or otherwise).",
        },
        {
          id: "inclass-representation-shift",
          rule: "Include at least one deliberate representation shift (algebra ↔ geometry ↔ series/graph) with a Geometric / Physical Reading callout.",
        },
      ],
      partAllocationGuidance:
        "The investigation, conjecture, proof, and synthesis Parts live here. This is where ★★ standard work and the compulsory core concentrate; ★★★ challenge appears only after a clear visual break.",
      timingGuidanceMinutes: 100,
      deliverables: [
        "Completed proof / justification with working shown",
        "Corrected planted-error task with the misconception named",
        "A completed synthesis (e.g. full curve-sketch or multi-step analysis)",
      ],
      accessibilityNotes: [
        "State the compulsory core (★ and ★★ question numbers) on page 1 so reduced-workload students know exactly where to stop.",
        "Every proof carries a labelled template; every sketch carries a pre-drawn axis grid.",
      ],
    },
    takeHome: {
      enabled: true,
      purpose:
        "Consolidate and extend after the lesson: apply the result in a real / interdisciplinary context, reflect metacognitively, return to the TOK provocations, and open the door to independent exploration.",
      requiredElements: [
        {
          id: "takehome-application",
          rule: "Include an interdisciplinary or real-world application Part that uses a specific packet result (e.g. Michaelis–Menten kinetics, AC-circuit phasors, logistic growth).",
        },
        {
          id: "takehome-reflection",
          rule: "Include the full Reflection section: concept-connection map, a multiple-methods/representations question, and a return to one TOK provocation using a specific result.",
        },
        {
          id: "takehome-ia-seeding",
          rule: "Include the Optional Extension and IA-Seeding branches (≥ 2, deliberately under-specified) and a Toolbox Wondering that names one explorable direction for a Mathematical Exploration.",
        },
      ],
      partAllocationGuidance:
        "Application, Reflection, and Extension/IA-seeding Parts live here. Compulsory-core reflection is required; extension branches and Toolbox Wondering are clearly optional (★★★).",
      timingGuidanceMinutes: 60,
      deliverables: [
        "Completed application Part",
        "Completed Reflection (with TOK return)",
        "A chosen IA-seeding branch sketched into an initial research question (optional)",
      ],
      accessibilityNotes: [
        "Reflection questions must offer a bullet-point option and an oral alternative.",
        "The application must be submittable in digital typed format without loss of meaning.",
      ],
    },
    continuityRules: [
      {
        id: "continuity-conjecture-thread",
        rule: "The entry conjecture from the flipped phase must be explicitly named and taken up at the start of the in-class phase, and revisited once in the take-home Reflection.",
      },
      {
        id: "continuity-standalone",
        rule: "A student who missed one phase must still be able to enter the next using only the 'What you need to start this Part' micro-boxes — no phase may be a hard prerequisite that strands a returning student.",
      },
      {
        id: "continuity-phase-labels",
        rule: "Each Part must be tagged with its delivery phase (flipped / inClass / takeHome) in the output so the packet can be split cleanly into pre-class, in-class, and take-home documents.",
      },
    ],
  },

  // ── 4. Required structure ───────────────────────────────────────────────────
  requiredStructure: {
    order: [
      {
        key: "header",
        label: "Header block (title, name/date, course, topics, prerequisites, materials, calculator/paper style)",
        required: true,
        cardinality: "exactly 1",
      },
      {
        key: "progressTracker",
        label: "Progress tracker and compulsory-core list",
        required: true,
        cardinality: "exactly 1",
      },
      {
        key: "commandGlossary",
        label: "Tear-off command-term glossary, demand scale, and Command-Term Spotlight",
        required: true,
        cardinality: "exactly 1",
      },
      {
        key: "vocabularyAtl",
        label: "Vocabulary list and ATL statement",
        required: true,
        cardinality: "exactly 1",
      },
      {
        key: "tok",
        label: "TOK provocations",
        required: true,
        cardinality: "exactly 2",
      },
      {
        key: "internationalMindedness",
        label: "International-mindedness box",
        required: true,
        cardinality: "≥ 1",
      },
      {
        key: "part0",
        label: "Part 0 — Activating Prior Knowledge (flipped)",
        required: true,
        cardinality: "exactly 1",
      },
      {
        key: "parts",
        label: "Parts 1, 2, 3, … (investigation → proof → application)",
        required: true,
        cardinality: "≥ 3",
      },
      {
        key: "reflection",
        label: "Reflection",
        required: true,
        cardinality: "exactly 1",
      },
      {
        key: "extensionIa",
        label: "Optional Extension, IA-seeding branches, and Toolbox Wondering",
        required: true,
        cardinality: "≥ 2 branches + 1 Toolbox Wondering",
      },
      {
        key: "pageBreak",
        label: "Page break separating student packet from Teacher's Companion",
        required: true,
        cardinality: "exactly 1",
      },
      {
        key: "teacherCompanion",
        label: "Teacher's Companion",
        required: true,
        cardinality: "exactly 1",
      },
    ],
    partContract: {
      descriptiveTitleRequired: true,
      startsWithWhatYouNeedBox: true,
      whatYouNeedBulletMin: 2,
      whatYouNeedBulletMax: 4,
      standaloneEnterable: true,
      maxQuestionsBeforeBreak: 6,
      endsWithRepresentationBridgeWhenAppropriate: true,
      part0Purpose:
        "Bridge from the named prerequisite activities; rebuild only the exact prior skills the later Parts assume, using short callback tasks.",
    },
    numbering: {
      continuous: true,
      subpartStyle: "Q4(a), Q4(b)",
    },
  },

  // ── 5. Command terms ────────────────────────────────────────────────────────
  commandTerms: {
    boldFirstUse: true,
    boldMainMathematicalObject: true,
    oneInstructionPerSentence: true,
    separateContextFromTask: true,
    henceMustNameEarlierResult: true,
    demandScaleRequired: true,
    tearOffGlossaryRequired: true,
    spotlightRequired: true,
    spotlightGuidance:
      "Spotlight the pair of command terms most easily confused in THIS topic. Explain the mark-scheme consequence of confusing them (e.g. 'Hence' means starting from scratch earns zero).",
    canonicalTerms: [
      { term: "Write down", demand: "A short answer; no working normally required.", demandRank: 1 },
      { term: "State", demand: "Give a short, specific answer without justification.", demandRank: 1 },
      { term: "Calculate", demand: "Obtain a numerical answer from data or a formula; show working.", demandRank: 3 },
      { term: "Determine", demand: "Find the only possible answer and justify it.", demandRank: 5 },
      { term: "Estimate", demand: "Obtain an approximate answer from a graph or model; show construction lines.", demandRank: 3 },
      { term: "Sketch", demand: "Show shape and key features with relative scale; label intercepts, asymptotes, extrema, holes.", demandRank: 4 },
      { term: "Describe", demand: "Give a detailed account of what is observed.", demandRank: 4 },
      { term: "Explain", demand: "Give a detailed account including reasons or causes.", demandRank: 5 },
      { term: "Deduce", demand: "Reach a conclusion by logical reasoning from results already established.", demandRank: 6 },
      { term: "Show that", demand: "Obtain a stated result; every logical step must appear.", demandRank: 6 },
      { term: "Hence", demand: "You must use the immediately preceding result; starting over earns no marks.", demandRank: 6 },
      { term: "Hence or otherwise", demand: "Use the previous result or any other valid method.", demandRank: 5 },
      { term: "Justify", demand: "Support a conclusion with mathematical evidence.", demandRank: 7 },
      { term: "Prove", demand: "Establish truth by a rigorous, complete chain of reasoning valid for all stated cases.", demandRank: 9 },
      { term: "Evaluate", demand: "Weigh strengths, limitations and evidence before reaching a judgment.", demandRank: 7 },
    ],
  },

  // ── 6. The eight universal design layers ────────────────────────────────────
  designLayers: {
    layers: [
      {
        layer: 1,
        name: "Structural Chunking and Modular Design",
        primaryBeneficiaries: ["ADHD", "slow processing", "intermittent attendance", "trauma-affected"],
        rules: [
          { id: "l1-standalone", rule: "Every Part must be completable as a standalone task using only its micro-box." },
          { id: "l1-tracker", rule: "Add a progress tracker on the front page." },
          { id: "l1-hierarchical", rule: "Sub-questions use hierarchical numbering Q4(a), Q4(b) — never bare 4." },
          { id: "l1-break", rule: "No Part exceeds six questions without an internal break (callout, translation table, or technology task)." },
        ],
      },
      {
        layer: 2,
        name: "Tiered Entry Points",
        primaryBeneficiaries: ["prior-knowledge gaps", "maths anxiety", "twice-exceptional", "gifted"],
        rules: [
          { id: "l2-warmup", rule: "Every generalisation or proof is preceded by a numerical warm-up (specific values, no variables)." },
          { id: "l2-conjecture-first", rule: "Conjecture always precedes rule: build the pattern before confirming the formula." },
          { id: "l2-tiers", rule: "Mark each question ★ (entry), ★★ (standard), or ★★★ (extension)." },
          { id: "l2-separate", rule: "Separate the compulsory core (★, ★★) from ★★★ with a clear visual break; never bury an extension at the end of a compulsory list." },
        ],
      },
      {
        layer: 3,
        name: "Command-Term Accessibility",
        primaryBeneficiaries: ["ELL", "dyslexia", "autism spectrum", "maths anxiety"],
        rules: [
          { id: "l3-glossary", rule: "Mandatory tear-off command-term glossary with demand scale." },
          { id: "l3-bold", rule: "Bold the command term on first use; never use a term not in the glossary without defining it at point of use." },
          { id: "l3-hence-pointer", rule: "'Hence' questions must name which preceding result to use, e.g. 'Hence (using your answer to Q7)…'." },
          { id: "l3-gloss", rule: "For ELL, add a one-line plain-English gloss after formal terms on first use." },
        ],
      },
      {
        layer: 4,
        name: "Graduated Scaffolding Architecture",
        primaryBeneficiaries: ["all learners"],
        rules: [
          { id: "l4-induction", rule: "Every induction question includes a labelled template: Base case / Inductive hypothesis / Inductive step / Conclusion." },
          { id: "l4-showthat", rule: "Every HL-level 'Show that' includes the first line of working." },
          { id: "l4-sketch", rule: "Every 'Sketch' provides a pre-drawn, labelled axis grid with appropriate scale." },
          { id: "l4-starter", rule: "Every 'Describe'/'Explain' provides a sentence starter appropriate to its type." },
          { id: "l4-optin", rule: "Scaffolding is opt-in for gifted/twice-exceptional (fold-under / collapsible)." },
        ],
      },
      {
        layer: 5,
        name: "Language Load Reduction",
        primaryBeneficiaries: ["ELL", "dyslexia", "ADHD", "autism spectrum", "slow processing"],
        rules: [
          { id: "l5-one-instruction", rule: "One instruction per sentence; break multi-step demands into numbered sub-steps." },
          { id: "l5-bold-object", rule: "Bold the key mathematical object in every stem." },
          { id: "l5-separate-context", rule: "Separate context (boxed preamble) from task demand (new line, command term first)." },
          { id: "l5-concrete-verbs", rule: "Replace vague verbs ('investigate', 'explore') with concrete actions ('calculate for n = 1,2,3; write a general formula; explain why it holds')." },
        ],
      },
      {
        layer: 6,
        name: "Multimodal and Multi-Representational Design",
        primaryBeneficiaries: ["ELL", "dyscalculia", "visual learners", "autism spectrum"],
        rules: [
          { id: "l6-rule-of-four", rule: "Every key result appears in at least two of: symbolic, geometric, tabular/numeric, verbal." },
          { id: "l6-translation", rule: "Include a Translation Table for every domain transfer (algebraic ↔ geometric ↔ series)." },
          { id: "l6-reference", rule: "Provide reference inserts (e.g. powers-of-i cycle card, pre-drawn Argand/axis grids, formula-booklet page references)." },
        ],
      },
      {
        layer: 7,
        name: "Accessible Metacognition and Reflection",
        primaryBeneficiaries: ["ELL", "autism spectrum", "maths anxiety", "twice-exceptional"],
        rules: [
          { id: "l7-concept-map", rule: "Every 'list what you learned' reflection includes a concept-map template (Concept / Where it appeared / How it connected)." },
          { id: "l7-frame", rule: "Every TOK reflection includes a position-statement frame and a modelled mentor-text paragraph using a different packet result." },
          { id: "l7-bullet", rule: "Every 'explain what is gained' meta-question offers a bullet-point option." },
          { id: "l7-oral", rule: "Every reflection question is flagged as answerable orally." },
        ],
      },
      {
        layer: 8,
        name: "Flexible Assessment and Output Modes",
        primaryBeneficiaries: ["motor difficulties", "ELL", "dyslexia", "chronic health", "ADHD"],
        rules: [
          { id: "l8-core-list", rule: "State the compulsory core (★, ★★) as a specific list of question numbers on page 1." },
          { id: "l8-diagram-alt", rule: "Every 'Describe'/'Sketch' explicitly allows an annotated diagram instead of prose." },
          { id: "l8-bullet-alt", rule: "Every 'Explain' explicitly allows bullet points." },
          { id: "l8-digital", rule: "The packet is submittable in digital typed format without loss of meaning." },
          { id: "l8-tiered-deadlines", rule: "The Teacher's Companion specifies single-lesson vs take-home / multi-session Parts and a partial-credit policy." },
        ],
      },
    ],
    tiers: [
      { symbol: "★", name: "Entry", meaning: "Accessible to all; compulsory core entry point.", compulsory: true },
      { symbol: "★★", name: "Standard", meaning: "Target for most students; compulsory core.", compulsory: true },
      { symbol: "★★★", name: "Extension", meaning: "Challenge; optional unless stated; separated by a clear visual break.", compulsory: false },
    ],
    scaffoldHierarchy: [
      { level: 0, name: "No scaffold", provides: "Question only." },
      { level: 1, name: "Framing", provides: "Sentence starter." },
      { level: 2, name: "Structural", provides: "Labelled template with blank rows." },
      { level: 3, name: "Procedural", provides: "First step given; student continues." },
      { level: 4, name: "Worked model", provides: "Analogous simpler example fully worked, immediately preceding." },
    ],
    minimumUsefulScaffoldRule:
      "Use the minimum useful scaffold for each question's demand — the least support that still lets a student make meaningful partial progress. Do not over-scaffold ★★★ work.",
    ruleOfFourMinForms: 2,
    translationTableRequiredOnDomainTransfer: true,
  },

  // ── 7. Planted errors ───────────────────────────────────────────────────────
  plantedErrors: {
    minPerPacket: 1,
    maxPerPacket: 2,
    exactlyOneErrorPerLine: true,
    framePositively: true,
    askWhyUnreasonableBeforeLocating: true,
    nameMisconceptionInCompanion: true,
    mustBeTeachableConceptualNotArithmetic: true,
    framingText:
      "The following working was submitted by a student. Your job is not to judge the student — errors like this reveal important distinctions. First decide why the result is unreasonable; then locate the single slip and explain its consequence.",
  },

  // ── 8. TOK + International-mindedness ────────────────────────────────────────
  tok: {
    countExactly: 2,
    mustUseSpecificPacketResults: true,
    placedAtTop: true,
    returnInReflection: true,
    noAbstractOnly: true,
    angles: [
      "How a model shapes what we notice and what we ignore.",
      "How precision can create the appearance of certainty (or mere persuasion).",
      "How visual representations can persuade or mislead.",
      "Whether a mathematical object was discovered or invented, and whether usefulness makes it real.",
      "What makes one correct calculation more justified than another as evidence.",
      "Whether a second independent proof makes a result 'more true'.",
    ],
  },
  internationalMindedness: {
    required: true,
    mustBeGenuineHistoricalOrCultural: true,
    goBeyondEuler: true,
    includeNonEuropeanWhereMathConnects: true,
    guidance:
      "Attribute the mathematics honestly and include non-European mathematicians where the mathematics genuinely connects (e.g. Mādhava of Sangamagrāma, al-Battānī, Abū al-Wafāʾ, Āryabhaṭa, Mahalanobis, Wessel). Notation is a poor historian — do not force unrelated links.",
  },

  // ── 9. Reflection ───────────────────────────────────────────────────────────
  reflection: {
    requiredElements: [
      { id: "refl-connect", rule: "A concept-connection task: list ≥ 6 concepts/formulae connected in this analysis, naming at least one from each core topic touched." },
      { id: "refl-methods", rule: "A question about the value of multiple methods, proofs, or representations of the same result." },
      { id: "refl-tok-return", rule: "A return to one of the two TOK provocations, defended using a specific numbered result from this packet." },
      { id: "refl-frame", rule: "A structured response frame or concept map to scaffold the written reflection." },
    ],
    conceptMapTemplateRequired: true,
    positionStatementFrameRequired: true,
    mentorTextRequired: true,
    bulletOptionRequired: true,
    oralOptionRequired: true,
  },

  // ── 10. Teacher's Companion ─────────────────────────────────────────────────
  teacherCompanion: {
    separatedByPageBreak: true,
    removedBeforeDistribution: true,
    requiredSections: [
      { id: "tc-integration-map", rule: "Integration Map: table mapping every IB element (topics, TOK, ATL, IM, technology, IA-seeding, paper alignment, command terms) to specific question numbers." },
      { id: "tc-moves", rule: "The model's pedagogical 'moves', located: which question hosts each move (conjecture-before-rule, planted error, translation table, rule of four, etc.)." },
      { id: "tc-answers", rule: "Answer sketches for every question, including full working where it aids the teacher." },
      { id: "tc-planted-keys", rule: "Planted-error keys: the correct answer, the misconception name, and the HL concept the error distinguishes." },
      { id: "tc-timing-core", rule: "Timing and compulsory-core guidance: which Parts suit a 50-minute lesson vs take-home / double period, and the compulsory-core question list." },
      { id: "tc-differentiation", rule: "Differentiation and partial-credit guidance for ELL, neurodivergent profiles, prior-knowledge gaps, and gifted/twice-exceptional students." },
      { id: "tc-technology", rule: "Technology and materials notes (GDC window settings, GeoGebra/Desmos links, physical tools)." },
      { id: "tc-design-note", rule: "Honest Design Note: which topic areas are genuinely integrated vs handled at extension level vs excluded, and why. Integration is earned by the mathematics." },
    ],
  },

  // ── 11. Verification ────────────────────────────────────────────────────────
  verification: {
    requireVerificationReport: true,
    checklist: [
      { id: "vf-solve-all", rule: "Independently solve every problem; check symbolic and numerical results, domains, assumptions, units, graphs, limits, and special cases." },
      { id: "vf-sufficient-info", rule: "Verify each question has sufficient information and that every 'Hence' dependency is actually available at that point." },
      { id: "vf-planted-clean", rule: "Ensure each planted error contains ONLY the intended error and nothing else." },
      { id: "vf-no-leak", rule: "Ensure no question reveals a later answer." },
      { id: "vf-companion-match", rule: "Ensure the Teacher's Companion answers match the packet exactly." },
      { id: "vf-claims", rule: "Verify historical, scientific, curricular, and cultural claims before asserting them." },
      { id: "vf-computation", rule: "Use computation where useful, but never as a substitute for a required proof." },
    ],
  },

  // ── 12. Accessibility (cross-cutting) ───────────────────────────────────────
  accessibility: {
    compulsoryCoreListedOnPageOne: true,
    describeSketchDiagramAlternative: true,
    explainBulletAlternative: true,
    digitalSubmissionSupported: true,
    oralAlternativeForReflection: true,
    ellMoves: [
      { id: "ell-active-voice", rule: "Rewrite stems in active voice; identify the agent explicitly." },
      { id: "ell-phrase-bank", rule: "Provide a proof-writing phrase bank per proof type (induction, direct, by contradiction)." },
      { id: "ell-weight-symbolic", rule: "Weight the ELL compulsory core toward language-neutral symbolic/GDC tasks over extended prose." },
    ],
    neurodivergentMoves: [
      { id: "nd-adhd", rule: "ADHD: progress tracker + 'what you need from earlier' micro-box; avoid holding more than two prior results in working memory at once." },
      { id: "nd-autism", rule: "Autism spectrum: explicit criteria for all open items; structured sentence starters; avoid vague verbs and cluttered pages." },
      { id: "nd-anxiety", rule: "Maths anxiety: low-stakes conjecture-before-rule entry; explicitly credit partial solutions; never a bare 'Prove' without a scaffold." },
    ],
  },

  // ── 13. IA seeding / Toolbox Wondering ──────────────────────────────────────
  iaSeeding: {
    minBranches: 2,
    branchesFromDifferentTopicAreas: true,
    deliberatelyUnderSpecified: true,
    toolboxWonderingRequired: true,
    toolboxWonderingGuidance:
      "Include a 'Toolbox Wondering': one genuinely interesting, under-specified direction a student could grow into a full IB Mathematical Exploration, named with an initial research question, likely variables, and a method sketch.",
  },

  // ── 14. Voice / tone / platform copy ────────────────────────────────────────
  voiceAndCopy: {
    tone:
      "Rigorous but accessible. Publishing-grade, never childish and never sterile. The design supports mathematical thinking rather than decorating around it. Prompts invite interpretation and reasoning.",
    publishingGradeLayout: true,
    noPlaceholderData: true,
    copyRules: [
      { id: "copy-clevs-marks", rule: "In any UI or packet copy referring to grading or scores, use 'Clev's Marks' — never 'grade', 'score', or 'points' alone." },
      { id: "copy-intersects", rule: "In proof activities, use 'intersects' rather than describing lines as 'perfectly continuous'." },
      { id: "copy-specific", rule: "Never use generic placeholder data; use highly specific, real, verifiable examples." },
    ],
  },

  // ── 15. Output contract ─────────────────────────────────────────────────────
  outputContract: {
    targetTable: "nuanced_analyses",
    fields: [
      { field: "slug", jsonType: "string", required: true, description: "url-friendly-lowercase-title-with-hyphens." },
      { field: "title", jsonType: "string", required: true, description: "The main title of the packet." },
      { field: "subtitle", jsonType: "string", required: false, description: "A conceptual subtitle naming the unifying idea." },
      { field: "course", jsonType: "string", required: true, description: "The course label, e.g. 'IBDP Mathematics: Analysis & Approaches HL'." },
      { field: "syllabus_topics", jsonType: "string[]", required: true, description: "Array of topic strings, never a single comma-joined string." },
      { field: "prerequisites", jsonType: "string[]", required: true, description: "Array of prior-skill strings." },
      { field: "materials", jsonType: "string", required: false, description: "Materials and calculator/paper policy." },
      { field: "vocabulary", jsonType: "object[]", required: true, description: "Array of { student_speak, ib_rigor } objects." },
      { field: "atl_statement", jsonType: "string", required: false, description: "One ATL skill focus for the packet." },
      { field: "tok_provocations", jsonType: "string[]", required: true, description: "EXACTLY two TOK questions, each answerable from a specific packet result." },
      { field: "parts", jsonType: "object[]", required: true, description: "Array of { part_number, title, content, phase, questions[] }. Each question is { q_number, text, marks, tier }." },
      { field: "teacher_companion", jsonType: "object[]", required: true, description: "Array of { q_number, answer, mark_scheme, pedagogy_note }." },
      { field: "latex_content", jsonType: "string", required: false, description: "Optional; the deterministic Typst renderer is preferred over raw LaTeX." },
    ],
    partPhaseTagField: "phase",
    partPhaseTagValues: ["flipped", "inClass", "takeHome"],
    jsonEscapingRules: [
      "Output a single valid JSON object and nothing else — no prose, no markdown code fences.",
      "Escape every double quote inside a string with a backslash.",
      `Escape every backslash used in LaTeX/maths commands (write ${BS}${BS}frac, not ${BS}frac) so JSON.parse succeeds.`,
      "Do not use unescaped newlines inside string values.",
      "syllabus_topics, prerequisites, and tok_provocations MUST be JSON arrays of strings, never comma-joined strings.",
      "tok_provocations MUST contain exactly two items.",
    ],
    noMarkdownFences: true,
  },

  // ── 16. Generation hints ────────────────────────────────────────────────────
  generation: {
    preferredModel: "claude-sonnet-5",
    preferredEditingModel: "claude-opus-4-5",
    maxTokens: 32000,
    adaptiveThinking: true,
  },
};
