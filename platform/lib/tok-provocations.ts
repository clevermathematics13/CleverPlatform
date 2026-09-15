/**
 * tok-provocations.ts -- what makes a TOK provocation worth printing.
 * -----------------------------------------------------------------------------
 * Every DP Nuanced Analysis packet carries exactly two Theory of Knowledge
 * provocations at the top and returns to one of them in the Reflection. That
 * much was already contractual. What was not specified anywhere was the only
 * thing a reader actually notices: whether the two questions are interesting.
 *
 * The failure this module exists to prevent is not a missing provocation --
 * the schema catches that -- it is a PRESENT one that could have been written
 * without reading the packet. "Is mathematics discovered or invented?" is a
 * real question, and printed bare at the top of a packet on logarithms it
 * teaches a student that TOK is a box to tick. The generator had one line of
 * guidance ("a real philosophical tension in the mathematics"), which is a
 * statement of intent rather than a standard anything can be held to.
 *
 * So the bar is written out as numbered rules a teacher reviewing a packet can
 * name -- "T5, it would fit any topic" -- and lives in ONE module, because the
 * two DP creators reach the model by different routes (the dashboard Nuanced
 * Analysis tab through buildActivityGeneratorSystemPrompt, /admin/create
 * through the DB-backed spec compiler) and a bar that exists twice is a bar
 * that drifts.
 *
 * ON "WHERE APPROPRIATE", which is rule T4 and rule T7 and nothing else.
 * It does NOT mean a packet may skip its provocations: the spec fixes the
 * count at exactly two and the Reflection, the preview and the Typst callout
 * box all assume they are there. It means (T4) the ANGLE has to be one this
 * packet's mathematics genuinely raises -- no asking about modelling
 * assumptions in a packet that builds no model -- and (T7) the tie-backs in
 * the body of the packet go only where a question actually reaches the
 * tension, never as philosophy sprinkled on every Part.
 *
 * Pre-DP (Grade 9/10) packets are deliberately NOT held to this. Those
 * students are not in TOK; their packets keep the older, lighter rule.
 * -----------------------------------------------------------------------------
 */

// Newline built at runtime so this file stays free of escape sequences, the
// same reason nuanced-analysis-spec.compile.ts does it.
const NL = String.fromCharCode(10);

/**
 * The bar, as it is spliced into a DP generator's system prompt. Numbered so
 * a teacher rejecting a provocation can say which rule it broke.
 */
export const TOK_PROVOCATION_RULES: readonly string[] = [
  "T1. ANCHOR EACH PROVOCATION IN THIS PACKET'S OWN MATHEMATICS. Each of the two must name or quote something the student actually meets here: the identity proved in Part 3, the assumption the model in Part 4 rests on, the definition that makes Part 1 possible, the specific number that came out of Q7. Name it in the provocation itself, in words a student who has read only this packet can follow. A provocation that names nothing from the packet is a decoration -- delete it and write one that does.",
  "T2. BOTH ANSWERS MUST BE DEFENSIBLE. It is a knowledge question only if a thoughtful student could argue either side and give something up by choosing. Make the tension explicit, usually as two clauses joined by 'or', so the student can see what each answer commits them to. If one answer is obviously right -- 'Should we check our working?', 'Is precision valuable?' -- that is a rhetorical question, not a provocation.",
  "T3. ASK FOR A POSITION, NOT A TOPIC. Write something a student can answer with a sentence that starts 'I think ... because ...'. 'Discuss the nature of proof' names a topic and cannot be answered. 'Does the second proof in Part 3 make the result MORE true than the first, or only more believed?' asks for a position.",
  "T4. TAKE THE ANGLE THIS MATHEMATICS ACTUALLY RAISES -- this is what 'where appropriate' means. Read what the packet does, then ask the knowledge question it genuinely provokes. Do not ask about modelling assumptions in a packet that builds no model, about proof and certainty in a packet that proves nothing, or about how a diagram persuades in a packet with no diagram. A packet that is mostly computation still raises real questions -- what the digits of an answer claim, whether a result read off technology is known in the same sense as one derived by hand, what a definition quietly keeps out -- and an honest small question beats an inflated metaphysical one the mathematics cannot support.",
  "T5. THE PORTABILITY TEST, RUN BEFORE YOU SUBMIT. Read each provocation and ask: could this be pasted unchanged into a packet on a completely different topic? If it could, it is not about this mathematics. Rewrite it until deleting this packet's content would leave it unanswerable.",
  "T6. THESE OPENERS ARE BANNED IN BARE FORM, because they are what makes TOK look bolted on: 'Is mathematics discovered or invented?', 'Is mathematics a universal language?', 'Is mathematics the language of the universe?', 'Can we ever be certain of anything in mathematics?', 'Is mathematics beautiful?'. The questions underneath them are excellent; it is arriving unattached that is banned. Reach the same question through this packet's own object instead -- the discovered/invented question earns its place only once the student is holding the specific definition someone chose and the specific result it turned out to predict.",
  "T7. TIE BACK IN THE BODY ONLY WHERE A QUESTION REALLY REACHES THE TENSION. When a Part arrives at a result that bears directly on one of the two provocations, follow it with one short question that makes the connection explicit and names which provocation it is -- a Describe or Explain, 2 to 3 marks, tier 2 or 3. One or two of these across a packet is right. Do not attach a TOK sentence to a question that does not raise one: philosophy on every Part costs the provocations the force they are printed for.",
  "T8. THE RETURN IN THE REFLECTION IS EVIDENCE, NOT OPINION. The reflection question that returns to a provocation must require a SPECIFIC numbered result from this packet as the evidence for the position taken, and must say so in the prompt ('citing a numbered result from this packet'). A reflection that invites the student to say how they feel about mathematics has thrown away the only evidence they have.",
] as const;

/**
 * Angles used when the caller has no spec of its own to draw from.
 *
 * The spec-compiled path passes the angle list stored on the template instead,
 * so the DB stays the single source for that one. The last two here exist for
 * T4: a heavily computational packet has to have somewhere honest to go.
 */
export const TOK_ANGLE_MENU: readonly string[] = [
  "How a model shapes what we notice and what we ignore.",
  "How precision can create the appearance of certainty, or merely of persuasion.",
  "How a visual representation can persuade or mislead.",
  "Whether a mathematical object was discovered or invented, and whether being useful makes it real.",
  "What makes one correct calculation better justified than another as evidence.",
  "Whether a second independent proof makes a result more true, or only more believed.",
  "What a definition lets in, and what it quietly keeps out.",
  "Whether a result obtained from technology is known in the same sense as one derived by hand.",
] as const;

/**
 * A provocation that passes T1-T5, shown rather than described.
 *
 * Lifted from the packet in docs/design/NA_GREAT_UNIFICATION_EXEMPLAR.md so
 * the model is given the house standard rather than its own idea of one. Both
 * halves matter: the object is named, and the second clause says what the
 * other answer would cost.
 */
const WORKED_EXAMPLE: readonly string[] = [
  "A provocation that passes T1-T5, from a packet on complex numbers that had just derived Euler's identity:",
  "  The number $i$ was introduced by definition, as a solution to $x^2 = -1$, to make unsolvable equations solvable. Centuries later it turned out to describe rotation, alternating current and quantum states. Was $i$ DISCOVERED to have been real all along, or did we INVENT a tool and then find places to use it -- and does being that useful settle the question either way?",
  "Why it passes: it names the definition the packet actually used (T1); a student can defend either answer and loses something either way (T2); it asks for a position (T3); the packet really did turn a defined object into a predictive one, so the angle is the one this mathematics raises (T4); and delete the complex numbers and nothing is left to answer (T5).",
] as const;

/**
 * The bar as a system-prompt block. Generators splice this in rather than
 * restating any of it, so tightening a rule tightens it everywhere at once.
 *
 * Pure: same angles in, byte-identical block out, which is what keeps the
 * spec-compiled prompt reproducible.
 */
export function tokProvocationBlock(angles: readonly string[] = TOK_ANGLE_MENU): string {
  return [
    "TOK PROVOCATIONS -- THE QUALITY BAR. The two provocations are the first thing a student reads and the last thing they are asked to defend, so they are held to the following. Read these before writing them, and apply T7 while you are writing the Parts rather than afterwards.",
    ...TOK_PROVOCATION_RULES,
    "Angles worth taking, where this packet's mathematics genuinely raises one (T4). This is a menu, not a checklist -- take the one that fits, and take none of them if the mathematics points somewhere better:",
    ...angles.map((a) => `- ${a}`),
    ...WORKED_EXAMPLE,
  ].join(NL);
}
