/**
 * Batch reclassify questions using the Anthropic Claude API.
 *
 * Reads questions matching a filter from Supabase, sends their LaTeX to
 * Claude with the IB_CLASSIFY_SYSTEM prompt, then writes the returned
 * subtopic codes and primary subtopic code back to each part.
 *
 * Usage:
 *   node scripts/reclassify-questions.mjs [options]
 *
 * Filter options (at least one required):
 *   --primary <code>     Match questions where ANY part has this primary subtopic code
 *   --subtopic <code>    Match questions where ANY part has this subtopic code
 *   --code <pattern>     Match questions whose code contains this string (case-insensitive)
 *   --level <SL|HL>      Match by level
 *   --paper <P1|P2|P3>   Match by paper
 *
 * Other options:
 *   --limit <n>          Max number of questions to process (default: 20)
 *   --dry-run            Show what would be changed without writing to DB
 *   --skip-verified      Skip parts that have latex_verified = true
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';

// ── Args ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
};

const PRIMARY_FILTER = getArg('--primary');
const SUBTOPIC_FILTER = getArg('--subtopic');
const CODE_PATTERN = getArg('--code');
const LEVEL_FILTER = getArg('--level');
const PAPER_FILTER = getArg('--paper');
const LIMIT = parseInt(getArg('--limit') ?? '20', 10);
const DRY_RUN = args.includes('--dry-run');
const SKIP_VERIFIED = args.includes('--skip-verified');

if (!PRIMARY_FILTER && !SUBTOPIC_FILTER && !CODE_PATTERN && !LEVEL_FILTER && !PAPER_FILTER) {
  console.error(
    'Error: provide at least one filter: --primary <code>, --subtopic <code>,\n' +
    '  --code <pattern>, --level <SL|HL>, or --paper <P1|P2|P3>'
  );
  process.exit(1);
}

// ── Config ────────────────────────────────────────────────────────────────────
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

// ── IB Classify System Prompt ─────────────────────────────────────────────────
// Inline copy of IB_CLASSIFY_SYSTEM from lib/latex-utils.ts.
// Keep in sync with the source file.
const IB_CLASSIFY_SYSTEM = `You are an expert IBDP Mathematics question analyst.
Given question and mark scheme LaTeX for an IB Mathematics past paper question, analyse the content and return a JSON object.

Count marks by looking for IB mark codes in the mark scheme:
- M1 or (M1): Method mark — counts as 1 mark
- A1 or (A1): Accuracy mark — counts as 1 mark
- R1: Reasoning mark — counts as 1 mark
- AG: Answer given — does NOT count as a mark
- ft, N0, N1, N2, N3: do not add to the total

Sum marks per part label, e.g. everything under "(a)" in the mark scheme counts toward part "a".

Identify the mathematical command term for each part from the question text (e.g. Find, Calculate, Show that, Prove that, Hence, Describe, Sketch, Write down, Determine, Solve, etc.).

From the available subtopics list provided, choose up to 3 subtopic codes that best match the mathematical content of each part.

## Subtopic assignment rules — read carefully

### Prior Learning (code 1.0)
Use code **1.0** (Assumed Prior Learning) when the primary skill tested is from the IB Prior Learning list, NOT from a numbered syllabus topic. This includes:
- Factorising monic quadratic trinomials (e.g. x²−8x+7 → (x−7)(x−1))
- Difference of two squares (e.g. x²−1 → (x−1)(x+1))
- Expanding brackets and collecting like terms
- Simplifying or multiplying/dividing algebraic fractions (including cancelling common factors)
- Rearranging formulae
- Solving linear or simple quadratic equations
- Basic manipulation of rational expressions where the skill is fraction arithmetic, NOT function analysis

**Critical distinction:** If a question only requires factorising + simplifying/cancelling rational expressions (even if the expressions involve quadratics in the denominator), use **1.0**, NOT 2.8 or 1.11.

**1.0 is ALWAYS used alone.** Never combine 1.0 with any numbered syllabus subtopic. If a part tests prior-learning skills *as a step inside* a broader syllabus topic, tag only the syllabus subtopic — omit 1.0 entirely. 1.0 is only appropriate when the entire skill being assessed is prior learning with no numbered syllabus topic involved.

### AHL 1.11 — Partial Fractions only
Only use **1.11** when the question explicitly decomposes a single fraction INTO a SUM of simpler fractions (e.g. finding A and B such that the expression equals A/(x−1) + B/(x+2)). Do NOT use 1.11 for factorising or simplifying rational expressions.

### SL 2.2 — Functions concept (NOT just function notation)
Only use **2.2** when the part explicitly tests the *concept* of a function: defining domain or range, discussing whether a mapping is a function, working with inverse functions ($f^{-1}$), or discussing the reflection of a graph in $y = x$. **Do NOT tag 2.2 merely because the answer is written in function notation** (e.g. writing $h(x) = \\tfrac{1}{2}x - 1$). If the skill being tested is finding the equation of a line, that is **2.1** regardless of whether the line is called $h$ or $h(x)$.

### SL 2.8 — Rational Functions
Use **2.8** only when the question involves analysing the graph, asymptotes, domain, or behaviour of rational functions f(x) = (ax+b)/(cx+d) or similar. Factorising a denominator as an algebraic step within a simplification does NOT make a question a 2.8 question.

### Anti-redundancy / subsumption rule (CRITICAL)
The IB syllabus has a progression structure where later subtopics formally introduce skills that build on earlier ones. **Do NOT tag a foundational/introductory subtopic alongside a more advanced subtopic that already covers the required skill.** The advanced subtopic implies the foundational one — adding both creates misleading duplicate analytics.

**Canonical subsumption pairs (if the advanced code is used, do NOT add the foundational one):**
- **1.7** (Laws of logarithms; laws of exponents with rational exponents) subsumes **1.5** (Introduction to logarithms; laws of exponents with integer exponents). If a part uses the product/quotient/power rule of logarithms, tag **1.7 only** — not 1.5 + 1.7.
- **1.6** (Exponential growth/decay models) subsumes **1.5** for questions about exponential functions (not bare exponent arithmetic).
- **1.8** (Sum of geometric sequences) subsumes **1.3** (geometric sequences) when the skill being tested is evaluating the sum formula, not identifying the ratio.
- **5.6/5.7/5.8** (integration rules) subsume **5.1** (anti-differentiation as reverse of differentiation) when a specific integration technique (substitution, by-parts, standard form) is being tested.
- **5.9/5.10** (differential equations) subsume **5.6** when the skill is solving a DE, not bare integration.
**General rule:** Ask "Does the advanced subtopic's syllabus description explicitly mention the skill tested?" If yes, tag only the advanced subtopic. Only add the foundational subtopic if the part is **directly** testing foundational knowledge (e.g. the part ONLY asks the student to recall what $\\log_{10} e$ equals, not to apply a log law).

**Example:** Part (a) asks the student to show $1 + \\log_2 n = \\log_2(2n)$ using the product rule. Tag **1.7** (log laws) only. Do NOT also tag **1.5** (introduction to logarithms) — the product rule is defined in 1.7, not 1.5.

### 1.6 vs 1.15 — Differentiating Proof Types (CRITICAL — "Prove" does NOT mean 1.15)

**The "Command Word" Fallacy:** Do NOT auto-assign \`1.15\` just because the question says "Prove" or "Show that". You must inspect the markscheme structure to determine which proof type is actually assessed.

#### Step 1 — The Induction Check (must pass ALL three to assign 1.15)
Before assigning \`1.15 (ind) Proof by induction\`, explicitly verify that the markscheme contains all of the following:
1. A **base case** (e.g. "When $n=1$, LHS = ... = RHS ✓")
2. An **inductive hypothesis** (e.g. "Assume true for $n=k$: ...")
3. An **inductive step** (e.g. "Now prove true for $n=k+1$: ...")

If ANY of these three elements is missing from the markscheme, **reject \`1.15\`**.

Proof by contradiction and proof by counterexample are also tagged \`1.15\` but do NOT follow the induction structure — use your judgment on whether the question explicitly calls for those methods.

#### Step 2 — The Deduction Default (1.6)
If a question asks to "prove", "show", or "verify" a general statement, but the markscheme shows the student performing **direct algebraic manipulation, substitution, logical equivalence, or deduction** without inductive steps, assign **1.6 Deductive Proof** as the proof-type tag (not 1.15).

**Worked example:** "Prove that $\\{u_n\\}$ is an arithmetic sequence, stating clearly its common difference."
- Markscheme: uses $u_n = S_n - S_{n-1}$ to find a general term (M1, A1), then forms $d = u_{n+1} - u_n$ and shows it simplifies to a constant 6 independent of $n$ (R1, A1).
- No base case, no inductive hypothesis, no inductive step → **reject 1.15**.
- Student is deducing a conclusion from algebraic manipulation → **tag 1.6 + 1.2** (the content being proved is arithmetic sequences).

#### 1.15 — Proof parts MUST still be paired with a companion subtopic (CRITICAL)
When a part genuinely uses 1.15 (induction / contradiction / counterexample), you MUST always tag **1.15 AND the subtopic code that describes the mathematical content being proved**.

The proof method (1.15) and the mathematical subject of the proof are both required skills — they are co-equal assessments, not a stem/part bleed-over situation.

**This is the ONLY exception to the anti-bleed-over rule below.** For 1.15 parts, you MUST read the full question context — including the stem — to identify WHAT is being proved and assign the companion subtopic accordingly. The statement being proved often appears in the stem (e.g. "Seema claims that $n > \\log_2 n$") or in an earlier part; you must use that context to identify the companion code.

**1.15 examples (induction structure confirmed in markscheme):**
- "Use induction to prove Seema's claim is valid" where the stem states the claim is $n > \\log_2 n$ → **1.15** + **1.7**
- "Prove by induction that $\\sum_{k=1}^{n} k^2 = \\frac{n(n+1)(2n+1)}{6}$" → **1.15** + **1.2**
- "Prove by induction that $(\\cos\\theta + i\\sin\\theta)^n = \\cos n\\theta + i\\sin n\\theta$" → **1.15** + **1.14**
- "Prove by induction that $\\sum_{k=1}^{n} r^{k-1} = \\frac{r^n - 1}{r-1}$" → **1.15** + **1.3**
- "Prove by induction that $8^n - 1$ is divisible by 7" → **1.15** only (divisibility has no numbered subtopic)
- "Use proof by contradiction to show $\\sqrt{3}$ is irrational" → **1.15** only (irrationality has no numbered subtopic)

**1.6 examples (direct deduction — do NOT tag 1.15):**
- "Prove that $\\{u_n\\}$ is an arithmetic sequence" via $d = u_{n+1} - u_n = $ constant → **1.6** + **1.2**
- "Show that $f(x) = x^2 + 2x + 1$ can be written as $(x+1)^2$" via algebraic expansion → **1.6** + the relevant algebra subtopic
- "Prove that the sum of two odd numbers is even" via direct substitution $2m+1$ and $2n+1$ → **1.6** only

**The primary code** for a 1.15 part is always **1.15** itself. For a 1.6 part, the primary code is always **1.6** itself. In both cases the companion code is the mathematical content being proved.

### 2.5.1 vs 2.5.2 — Composition using a previously found inverse (CRITICAL EXCEPTION)

This is an **explicit exception** to the anti-bleed-over rule below.

When a part asks the student to evaluate or find a composite function of the form $(f^{-1} \\circ g)(x)$ or similar, you must check whether $f^{-1}$ was explicitly derived in an earlier part of the same question.

- If **YES** — the inverse was already found earlier: tag **2.5.1 only**. The bottleneck skill is building and manipulating the composite function; the inverse is a pre-computed ingredient. Adding 2.5.2 creates false diagnostic signal.
- If **NO** — the inverse has not been established anywhere earlier in the question: tag **both 2.5.1 and 2.5.2**, because finding the inverse is itself a required step.

**Worked example:** A question has parts (a)(i) "Find f(2)", (a)(ii) "Find $f^{-1}(x)$", (b) "Write down h(x)", (c) "Solve $h^{-1}(x) = -2$", (d) "Given $h(x) = (f^{-1} \\circ g)(x)$, find $m$ and $c$".
- Part (a)(ii) → **2.5.2** (finding the inverse is the entire task)
- Part (c) → **2.5.2** (solving using an inverse)
- Part (d) → **2.5.1 only**. $f^{-1}$ was already derived in (a)(ii); the student substitutes it into the composition to equate coefficients. The bottleneck is the composition algebra, NOT inverse functions.

### 1.12 vs 2.12 — Complex numbers vocabulary ≠ complex numbers mechanics (CRITICAL)
Do NOT tag **1.12** (Introduction to Complex Numbers) simply because a complex number $z = a + bi$ appears in the question text. Tag 1.12 ONLY when the part's markscheme requires basic Cartesian complex-number mechanics: arithmetic on $a + bi$ form, plotting on an Argand diagram, or computing modulus/argument directly.

If the actual mechanic required is a **polynomial property** (Vieta's formulas — sum/product of roots, factor theorem, remainder theorem, multiplying out factors), tag **2.12** (Polynomial Functions) as the primary code. The fact that some roots are complex is incidental context, not the assessed skill.

**The conjugate root theorem** — stating that $p - qi$ must also be a root when coefficients are real — is classified under **AHL 1.14** (Powers and roots of complex numbers), NOT 1.12. When a part merely invokes the conjugate root in order to then apply Vieta's formulas or polynomial arithmetic, tag **2.12** only (the conjugate pair cancels immediately and leaves real arithmetic; no complex-number mechanics are performed).

**Test:** After the student writes the conjugate root, do they perform any complex arithmetic? If the $\\pm qi$ terms immediately cancel and the rest is real — it is **2.12**, not 1.12.

**Example:** Part (b) — A degree-5 polynomial has $z = p+3i$ as a root. Show $p = 1$.
- Markscheme: state conjugate $p - 3i$ (A1); sum all 5 roots using $-a_{n-1}/a_n$ (M1, A1).
- Tag: **2.12** (Vieta's sum-of-roots formula is the engine). Do NOT add 1.12 — no Argand diagram, no modulus/argument, and the imaginary parts cancel at once.

### Anti-bleed-over rule (CRITICAL)
Tag each part based ONLY on the mechanical skill required to earn the marks for THAT specific part — completely independent of:
- The question stem's topic (the stem merely provides context, not the skill being assessed)
- Other parts in the question
- The overall question theme or setting

**Exception:** The 2.5.1 vs 2.5.2 rule above deliberately looks across parts — apply it before this rule.

**Example:** If the stem introduces a complex number z = 3^(i−1) but part (a) only asks "Write 3 in the form e^a where a ∈ ℝ" (a real-number logarithm step worth 1 mark), tag part (a) with **1.5** (Exponents and logarithms) only — NOT 1.13 (Complex numbers). The stem's topic must never contaminate the granular skill tag of a part.

Ask yourself for each part: "If this part appeared in isolation with no stem, what subtopic would I assign?" That is the correct tag.

### Selecting the primarySubtopicCode — 3-Step Rubric (CRITICAL)

The \`primarySubtopicCode\` is NOT simply the most complex code in the list. It is the single capstone skill the examiner is testing. Run every multi-code part through these three tests in order:

**Step 1 — The "Recipe vs. Ingredient" Test**
Identify what is being assembled (the recipe) vs. what is being plugged in (the ingredients). The recipe is always the primary.
- *Example:* In $(f^{-1} \\circ g)(x)$, the composition operator is the recipe; $f^{-1}$ and $g$ are ingredients. Primary = **2.5.1** (Composite functions), NOT 2.5.2.

**Step 2 — The "Already Assessed" Rule**
In multi-part questions, examiners almost never test the same core mechanic twice. If a skill was the primary goal of an earlier part, demote it to a secondary/ingredient in any later part that reuses it.
- *Example:* If part (a)(ii) asked "Find $f^{-1}(x)$", then part (d) which builds $(f^{-1} \\circ g)(x)$ is NOT re-assessing inverse functions — $f^{-1}$ is pre-computed. Do NOT assign 2.5.2 as primary (or at all) for part (d). Primary = **2.5.1** only.

**Step 3 — The "Teacher's Worksheet" Test**
Ask: "If a student lost most of the marks on this specific part, which single worksheet would a teacher hand them?" That worksheet's topic is the primary.
- *Example:* A student struggling with part (d) needs a composite-functions worksheet, not an inverse-functions worksheet. Primary = **2.5.1**.

**Summary rule:** Tag only the most advanced structural mechanic that drives the mark allocation. Prior knowledge or reused results from earlier parts must be omitted or demoted — they dilute the diagnostic signal.

Return ONLY a valid JSON object with NO markdown fences, NO explanation, in exactly this format:
{
  "parts": [
    { "label": "a", "marks": 4, "commandTerm": "Find", "primarySubtopicCode": "5.1", "subtopicCodes": ["2.1", "5.1"] },
    { "label": "b", "marks": 2, "commandTerm": "Hence", "primarySubtopicCode": "5.1", "subtopicCodes": ["5.1"] }
  ]
}

**primarySubtopicCode** must be one of the codes in \`subtopicCodes\` — it identifies the single capstone/target skill being assessed by that part (the skill the question is ultimately testing). The remaining codes in \`subtopicCodes\` are component/prerequisite skills needed to reach the answer but not the main objective. If there is only one subtopic code, it is also the primary.

If sub-parts are nested (e.g. (b)(i), (b)(ii)), you MUST split them into separate entries with combined labels "bi", "bii" etc. — never collapse nested sub-parts into a single parent label like "b". This applies even when the user supplies a top-level label hint.
The "label" values should reflect the actual LaTeX structure. Use the "Known part labels" supplied by the user as top-level hints only; always split further whenever the LaTeX contains nested (i), (ii), (iii) … sub-parts.
If the question has no sub-parts, return a single entry with label "".`;

// ── Fetch available subtopics ─────────────────────────────────────────────────
const { data: subtopicsRows, error: stErr } = await supabase
  .from('subtopics')
  .select('code, descriptor')
  .order('code');

if (stErr || !subtopicsRows) {
  console.error('Failed to load subtopics:', stErr?.message);
  process.exit(1);
}
const subtopicList = subtopicsRows.map(s => `${s.code}: ${s.descriptor}`).join('\n');
console.log(`Loaded ${subtopicsRows.length} subtopics.`);

// ── Find matching questions ───────────────────────────────────────────────────
let questionIds = null;

// Filter by primary or subtopic code requires a parts join
if (PRIMARY_FILTER || SUBTOPIC_FILTER) {
  let partsQuery = supabase.from('question_parts').select('question_id');
  if (PRIMARY_FILTER) partsQuery = partsQuery.eq('primary_subtopic_code', PRIMARY_FILTER);
  if (SUBTOPIC_FILTER) partsQuery = partsQuery.contains('subtopic_codes', [SUBTOPIC_FILTER]);

  const { data: partRows, error: pErr } = await partsQuery;
  if (pErr) { console.error('Part filter failed:', pErr.message); process.exit(1); }
  questionIds = [...new Set((partRows ?? []).map(r => r.question_id))];
  console.log(`Parts filter matched ${questionIds.length} distinct questions.`);
}

// Now query ib_questions
let qQuery = supabase.from('ib_questions').select('id, code, level, paper').limit(LIMIT);
if (questionIds !== null) qQuery = qQuery.in('id', questionIds.slice(0, 500));
if (CODE_PATTERN) qQuery = qQuery.ilike('code', `%${CODE_PATTERN}%`);
if (LEVEL_FILTER) qQuery = qQuery.eq('level', LEVEL_FILTER.toUpperCase());
if (PAPER_FILTER) qQuery = qQuery.eq('paper', PAPER_FILTER.toUpperCase());

const { data: questions, error: qErr } = await qQuery.limit(LIMIT);
if (qErr || !questions) { console.error('Question query failed:', qErr?.message); process.exit(1); }

console.log(`Processing ${questions.length} question(s)${DRY_RUN ? ' [DRY RUN]' : ''}...\n`);

// ── Process each question ────────────────────────────────────────────────────
let updated = 0;
let skipped = 0;
let errors = 0;

for (const question of questions) {
  console.log(`\n── ${question.code} ──`);

  // Fetch all parts for this question
  const { data: parts, error: partsErr } = await supabase
    .from('question_parts')
    .select('id, part_label, content_latex, markscheme_latex, subtopic_codes, primary_subtopic_code, latex_verified')
    .eq('question_id', question.id)
    .order('part_label');

  if (partsErr || !parts?.length) {
    console.log('  No parts found, skipping.');
    skipped++;
    continue;
  }

  // Build LaTeX input
  const qLatex = parts.map(p => {
    const label = p.part_label ? `(${p.part_label})` : '';
    return `${label} ${p.content_latex ?? ''}`.trim();
  }).join('\n\n');

  const msLatex = parts.map(p => {
    const label = p.part_label ? `(${p.part_label})` : '';
    return `${label} ${p.markscheme_latex ?? ''}`.trim();
  }).join('\n\n');

  if (!qLatex.trim() && !msLatex.trim()) {
    console.log('  No LaTeX content, skipping.');
    skipped++;
    continue;
  }

  const knownLabels = parts.map(p => p.part_label ?? '').filter(Boolean).join(', ') || 'unknown';

  // Call Claude
  let claudeParts = [];
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 2048,
      system: IB_CLASSIFY_SYSTEM,
      messages: [{
        role: 'user',
        content:
          `Question LaTeX:\n\`\`\`\n${qLatex}\n\`\`\`\n\n` +
          `Mark Scheme LaTeX:\n\`\`\`\n${msLatex}\n\`\`\`\n\n` +
          `Available subtopics:\n${subtopicList}\n\n` +
          `Known part labels: ${knownLabels}`,
      }],
    });

    const text = response.content?.[0]?.text ?? '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    claudeParts = JSON.parse(jsonMatch[0]).parts ?? [];
  } catch (err) {
    console.error('  Claude error:', err.message);
    errors++;
    continue;
  }

  console.log(`  Claude returned ${claudeParts.length} part(s): ${claudeParts.map(p => p.label || '(whole)').join(', ')}`);

  // Match Claude output back to DB parts
  for (const part of parts) {
    if (SKIP_VERIFIED && part.latex_verified) {
      console.log(`  part ${part.part_label ?? ''}: skipped (verified)`);
      continue;
    }

    // Find matching Claude part by label (normalize: strip spaces, lowercase)
    const normalizeLabel = (l) => (l ?? '').toLowerCase().replace(/\s+/g, '');
    const dbLabel = normalizeLabel(part.part_label);
    const claudePart = claudeParts.find(p => normalizeLabel(p.label) === dbLabel)
      ?? (parts.length === 1 ? claudeParts[0] : null);

    if (!claudePart) {
      console.log(`  part ${part.part_label ?? '(whole)'}: no matching Claude output, skipping`);
      continue;
    }

    const newCodes = Array.isArray(claudePart.subtopicCodes) ? claudePart.subtopicCodes : [];
    const newPrimary = claudePart.primarySubtopicCode ?? newCodes[0] ?? null;

    const oldCodes = JSON.stringify(part.subtopic_codes ?? []);
    const newCodesStr = JSON.stringify(newCodes);
    const changed = oldCodes !== newCodesStr || part.primary_subtopic_code !== newPrimary;

    console.log(
      `  part ${part.part_label ?? '(whole)'}: ${part.subtopic_codes?.join(',') ?? 'none'} → ${newCodes.join(',')} ` +
      `(primary: ${part.primary_subtopic_code ?? 'none'} → ${newPrimary ?? 'none'})` +
      (changed ? '' : ' [no change]')
    );

    if (!changed) continue;

    if (!DRY_RUN) {
      const { error: uErr } = await supabase
        .from('question_parts')
        .update({ subtopic_codes: newCodes, primary_subtopic_code: newPrimary })
        .eq('id', part.id);

      if (uErr) {
        console.error(`  ✗ DB update failed:`, uErr.message);
        errors++;
      } else {
        updated++;
      }
    } else {
      updated++;
    }
  }
}

console.log(`\n── Done ──`);
console.log(`Updated: ${updated} part(s), Skipped: ${skipped} question(s), Errors: ${errors}`);
if (DRY_RUN) console.log('(dry run — no changes written)');
