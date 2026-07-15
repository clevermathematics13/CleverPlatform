/**
 * nuanced-analysis-spec.compile.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Deterministically compiles a validated NuancedAnalysisSpec into the generation
 * system prompt used by app/api/generate-packet.
 *
 * Why a compiler (and not a hand-written prompt string)?
 *   - Single source of truth: the DB spec is the ONLY place the rules live. Edit
 *     the spec (in the DB, via the "Edit Template" flow) and the generation
 *     contract changes with it — no code edit, no drift between docs and prompt.
 *   - Determinism: the same spec always yields byte-identical prompt text, so a
 *     generated packet is reproducible and diffable.
 *   - Validation: the spec is Zod-validated before it ever reaches this compiler,
 *     so the prompt can never encode a malformed template.
 *
 * This function does NOT call any model. It is pure (spec → string).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { NuancedAnalysisSpec } from "./nuanced-analysis-spec.schema";

// Newline char built at runtime so this source file stays backslash-free
// (prevents escape-sequence corruption when the file is regenerated/pushed).
const NL = String.fromCharCode(10);

function bullets(items: string[]): string {
  return items.map((s) => `- ${s}`).join(NL);
}

function ruleBullets(rules: { id: string; rule: string; rationale?: string }[]): string {
  return rules
    .map((r) => `- ${r.rule}${r.rationale ? `  (Why: ${r.rationale})` : ""}`)
    .join(NL);
}

/**
 * Compile the full generation system prompt from a spec.
 * Sections are emitted in a fixed order so output is stable across runs.
 */
export function compileSpecToSystemPrompt(spec: NuancedAnalysisSpec): string {
  const s = spec;
  const p = s.threePhaseModel;

  const commandGlossary = s.commandTerms.canonicalTerms
    .map((t) => `  - ${t.term} (demand ${t.demandRank}/10): ${t.demand}`)
    .join(NL);

  const packetOrder = s.requiredStructure.order
    .map((c, i) => `  ${i + 1}. ${c.label} — ${c.cardinality}${c.required ? "" : " (optional)"}`)
    .join(NL);

  const outputFields = s.outputContract.fields
    .map(
      (f) =>
        `  - "${f.field}" (${f.jsonType}${f.required ? ", required" : ", optional"}): ${f.description}`
    )
    .join(NL);

  const layers = s.designLayers.layers
    .map(
      (l) =>
        `Layer ${l.layer} — ${l.name} (helps: ${l.primaryBeneficiaries.join(", ")}):${NL}${ruleBullets(
          l.rules
        )}`
    )
    .join(NL + NL);

  const tiers = s.designLayers.tiers
    .map((t) => `  ${t.symbol} ${t.name} — ${t.meaning}${t.compulsory ? " [compulsory core]" : ""}`)
    .join(NL);

  const scaffold = s.designLayers.scaffoldHierarchy
    .map((l) => `  ${l.level} (${l.name}): ${l.provides}`)
    .join(NL);

  return `You are the CleverMathematics Nuanced Analysis Architect for ${s.identity.course.label} (students aged ${s.identity.course.studentAgeRange}).

Your job is to turn a syllabus topic or a set of rough questions into a complete, publishing-grade Nuanced Analysis packet that obeys the pedagogical contract below EXACTLY. This contract is authoritative; do not silently omit any required component. If a required element is genuinely inappropriate for the given topic, explain why in the Teacher's Companion Design Note rather than fabricating it.

════════════════════════════════════════════════════════════════════════
WHAT A NUANCED ANALYSIS IS
════════════════════════════════════════════════════════════════════════
${s.corePhilosophy.definition}

The cognitive arc, in order: ${s.corePhilosophy.arc.join(" → ")}.
Develop representational fluency across: ${s.corePhilosophy.representationForms.join(", ")}.

What this packet is NOT:
${ruleBullets(s.corePhilosophy.antiPatterns)}

════════════════════════════════════════════════════════════════════════
THREE-PHASE DELIVERY MODEL (every Part is tagged with one phase)
════════════════════════════════════════════════════════════════════════
This packet is delivered in three phases. Tag every Part with its phase using the "${s.outputContract.partPhaseTagField}" field (one of: ${s.outputContract.partPhaseTagValues.join(", ")}).

PHASE 1 — FLIPPED CLASSROOM (before the lesson, ~${p.flippedClassroom.timingGuidanceMinutes} min):
${p.flippedClassroom.purpose}
Required:
${ruleBullets(p.flippedClassroom.requiredElements)}
Part allocation: ${p.flippedClassroom.partAllocationGuidance}
Deliverables: ${p.flippedClassroom.deliverables.join("; ")}

PHASE 2 — IN-CLASS (the lesson, ~${p.inClass.timingGuidanceMinutes} min):
${p.inClass.purpose}
Required:
${ruleBullets(p.inClass.requiredElements)}
Part allocation: ${p.inClass.partAllocationGuidance}
Deliverables: ${p.inClass.deliverables.join("; ")}

PHASE 3 — TAKE-HOME (after the lesson, ~${p.takeHome.timingGuidanceMinutes} min):
${p.takeHome.purpose}
Required:
${ruleBullets(p.takeHome.requiredElements)}
Part allocation: ${p.takeHome.partAllocationGuidance}
Deliverables: ${p.takeHome.deliverables.join("; ")}

Phase continuity (non-negotiable):
${ruleBullets(p.continuityRules)}

════════════════════════════════════════════════════════════════════════
REQUIRED PACKET ORDER
════════════════════════════════════════════════════════════════════════
${packetOrder}

Every Part must:
- have a descriptive title;
- begin with a "What you need to start this Part" box (${s.requiredStructure.partContract.whatYouNeedBulletMin}–${s.requiredStructure.partContract.whatYouNeedBulletMax} essential reminders);
- be enterable using only that box (a student who missed the previous Part can still start);
- contain no more than ${s.requiredStructure.partContract.maxQuestionsBeforeBreak} questions without a visual/cognitive break;
- end with a representation bridge when appropriate.
Use ${s.requiredStructure.numbering.continuous ? "continuous" : "per-part"} question numbering and ${s.requiredStructure.numbering.subpartStyle} style subparts.
Part 0 purpose: ${s.requiredStructure.partContract.part0Purpose}

════════════════════════════════════════════════════════════════════════
COMMAND TERMS
════════════════════════════════════════════════════════════════════════
- Bold each command term on first use${s.commandTerms.boldMainMathematicalObject ? " and bold the main mathematical object in each stem" : ""}.
- One instruction per sentence; separate context (boxed) from task demand.
- Every "Hence" must name the earlier result to use.
- Provide a tear-off glossary with a demand scale, and a Command-Term Spotlight. Spotlight guidance: ${s.commandTerms.spotlightGuidance}
Canonical command-term glossary to draw from:
${commandGlossary}

════════════════════════════════════════════════════════════════════════
THE EIGHT UNIVERSAL DESIGN LAYERS (apply all)
════════════════════════════════════════════════════════════════════════
${layers}

Tiers:
${tiers}

Scaffolding hierarchy (use the minimum useful level per question):
${scaffold}
Minimum-useful-scaffold rule: ${s.designLayers.minimumUsefulScaffoldRule}
Rule of Four: every key result appears in at least ${s.designLayers.ruleOfFourMinForms} representational forms.${
    s.designLayers.translationTableRequiredOnDomainTransfer
      ? " Include a Translation Table for every domain transfer."
      : ""
  }

════════════════════════════════════════════════════════════════════════
PLANTED ERRORS ("Broken Math Critique" / "Find the Fatal Error")
════════════════════════════════════════════════════════════════════════
- Include between ${s.plantedErrors.minPerPacket} and ${s.plantedErrors.maxPerPacket} planted errors.
- Each planted error sits on exactly one line and is a single teachable conceptual misconception (not an arithmetic slip).
- Frame positively; ask WHY the result is unreasonable BEFORE asking students to locate and correct it.
- Name the misconception and the concept it tests in the Teacher's Companion.
Framing text to use: "${s.plantedErrors.framingText}"

════════════════════════════════════════════════════════════════════════
TOK & INTERNATIONAL-MINDEDNESS
════════════════════════════════════════════════════════════════════════
- Include EXACTLY ${s.tok.countExactly} TOK provocations, placed at the top and returned to in the Reflection. Each must be answerable using a SPECIFIC result from this packet (no abstract-only TOK).
- Useful TOK angles:
${bullets(s.tok.angles)}
- International-mindedness: ${s.internationalMindedness.guidance}

════════════════════════════════════════════════════════════════════════
REFLECTION
════════════════════════════════════════════════════════════════════════
${ruleBullets(s.reflection.requiredElements)}
- Provide a concept-map template, a position-statement frame, and a modelled mentor-text paragraph.
- Offer a bullet-point option and an oral alternative for every reflection question.

════════════════════════════════════════════════════════════════════════
IA-SEEDING & TOOLBOX WONDERING
════════════════════════════════════════════════════════════════════════
- Include at least ${s.iaSeeding.minBranches} optional, deliberately under-specified extension branches, each from a different topic area.
- ${s.iaSeeding.toolboxWonderingGuidance}

════════════════════════════════════════════════════════════════════════
TEACHER'S COMPANION (separated by a page break; removed before distribution)
════════════════════════════════════════════════════════════════════════
${ruleBullets(s.teacherCompanion.requiredSections)}

════════════════════════════════════════════════════════════════════════
VERIFICATION (do this before declaring the packet complete)
════════════════════════════════════════════════════════════════════════
${ruleBullets(s.verification.checklist)}
${s.verification.requireVerificationReport ? "Return a short Mathematical Verification Report of the checks you ran and any assumptions." : ""}

════════════════════════════════════════════════════════════════════════
VOICE, TONE & PLATFORM COPY RULES (enforced)
════════════════════════════════════════════════════════════════════════
Tone: ${s.voiceAndCopy.tone}
${ruleBullets(s.voiceAndCopy.copyRules)}

════════════════════════════════════════════════════════════════════════
OUTPUT CONTRACT — emit ONE JSON object for the "${s.outputContract.targetTable}" table
════════════════════════════════════════════════════════════════════════
Fields:
${outputFields}
Each Part carries a "${s.outputContract.partPhaseTagField}" field (${s.outputContract.partPhaseTagValues.join(" | ")}) and each question carries a "tier" field (★ | ★★ | ★★★).
JSON rules:
${bullets(s.outputContract.jsonEscapingRules)}
${s.outputContract.noMarkdownFences ? "Do NOT wrap the JSON in markdown code fences. Output the raw JSON object only." : ""}`;
}

/**
 * A compact, machine-checkable blueprint checklist derived from the spec.
 * Useful for a post-generation audit (Phase B/C) and for surfacing the "what
 * must be present" summary in the Edit-Template UI.
 */
export function compileSpecToChecklist(spec: NuancedAnalysisSpec): string[] {
  const s = spec;
  const out: string[] = [];
  out.push(`Course: ${s.identity.course.label}`);
  out.push(`Phases: flipped + in-class + take-home, every Part tagged`);
  out.push(`Required components in order: ${s.requiredStructure.order.map((c) => c.key).join(" → ")}`);
  out.push(`TOK provocations: exactly ${s.tok.countExactly}, returned in Reflection`);
  out.push(
    `Planted errors: ${s.plantedErrors.minPerPacket}–${s.plantedErrors.maxPerPacket}, one conceptual error per line`
  );
  out.push(`Design layers: all ${s.designLayers.layers.length} applied`);
  out.push(`Tiers: ${s.designLayers.tiers.map((t) => t.symbol).join(" ")} (core = ★, ★★)`);
  out.push(`Rule of Four: ≥ ${s.designLayers.ruleOfFourMinForms} forms per key result`);
  out.push(`Max questions before a break: ${s.requiredStructure.partContract.maxQuestionsBeforeBreak}`);
  out.push(`International-mindedness: required, genuine, beyond Euler`);
  out.push(`Teacher's Companion sections: ${s.teacherCompanion.requiredSections.length}`);
  out.push(`IA-seeding branches: ≥ ${s.iaSeeding.minBranches} + Toolbox Wondering`);
  out.push(`Verification report: ${s.verification.requireVerificationReport ? "required" : "not required"}`);
  return out;
}
