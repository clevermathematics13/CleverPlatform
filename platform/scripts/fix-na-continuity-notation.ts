/**
 * One-off: rewrite the mathematics in na_continuity's packet digests as the
 * LaTeX the packets are authored in.
 *
 * WHY IT MATTERS FOR A TABLE NOBODY LOOKS AT. A continuity digest is never
 * rendered. It is prompt text: buildContinuityContext() turns the digests
 * into the block that tells the generator what prior packets already spent,
 * and that block sits LAST in the prompt, where a model weights it most
 * heavily. So the notation in it is not cosmetic -- it is the most recent
 * example of "how mathematics is written here" that the model sees before it
 * starts writing. Rule 11b of buildActivityGeneratorSystemPrompt() says
 * LaTeX; two digests then showed it Typst ("a div b := a times 1/b") and
 * Unicode ("a ÷ b := a × 1/b") instead.
 *
 * WHY THESE STRINGS AND NOT A PATTERN. Every replacement below is an exact
 * literal, applied only where it matches exactly, and the script reports a
 * miss rather than guessing. A digest is prose describing what a packet
 * taught; a regex loose enough to catch the notation is loose enough to
 * damage the sentence around it.
 *
 * SCOPE. A.2 defines subtraction and division, and B.1 quotes both
 * definitions back. Fixing one without the other would leave the same
 * definition written two ways in one prompt, which is worse than either.
 * A.3's and B.4's digests carry UNDELIMITED ASCII ("a^2+2ab+b^2",
 * "6x^2+11x+3 = (2x+3)(3x+1)") -- readable, not wrong notation, and not
 * touched here.
 *
 * Usage (from platform/):
 *   npx tsx scripts/fix-na-continuity-notation.ts          # dry run
 *   npx tsx scripts/fix-na-continuity-notation.ts --yes
 */
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--yes");

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://qnawglgnoojrlaivylou.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  console.error("Missing env: SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

/** section -> the exact substrings to replace inside that digest. */
const EDITS: Record<string, Array<[string, string]>> = {
  "A.2": [
    [
      "a - b := a + (-b), and a ÷ b := a × 1/b",
      "$a - b := a + (-b)$, and $a \\div b := a \\times \\frac{1}{b}$",
    ],
    [
      "reciprocal (informal, via a÷b := a×1/b)",
      "reciprocal (informal, via $a \\div b := a \\times \\frac{1}{b}$)",
    ],
    ["(5÷n written as n÷5)", "($5 \\div n$ written as $n \\div 5$)"],
  ],
  "B.1": [
    [
      "(a-b := a+(-b), a div b := a times 1/b)",
      "($a - b := a + (-b)$, $a \\div b := a \\times \\frac{1}{b}$)",
    ],
  ],
};

type Digest = Record<string, unknown>;

/** Applies one edit wherever it appears in a digest's strings. */
function applyEdit(digest: Digest, from: string, to: string): number {
  let hits = 0;
  for (const [field, value] of Object.entries(digest)) {
    if (typeof value === "string") {
      if (value.includes(from)) {
        digest[field] = value.split(from).join(to);
        hits += 1;
      }
    } else if (Array.isArray(value)) {
      digest[field] = value.map((item) => {
        if (typeof item === "string" && item.includes(from)) {
          hits += 1;
          return item.split(from).join(to);
        }
        return item;
      });
    }
  }
  return hits;
}

async function main() {
  const { data, error } = await supabase.from("na_continuity").select("id, course_id, packets");
  if (error) {
    console.error("Read failed:", error.message);
    process.exit(1);
  }

  let missed = 0;

  for (const row of data ?? []) {
    const packets = (row.packets ?? []) as Digest[];
    let changed = 0;

    for (const digest of packets) {
      const edits = EDITS[String(digest.section)];
      if (!edits) continue;
      for (const [from, to] of edits) {
        const hits = applyEdit(digest, from, to);
        if (hits === 0) {
          // Already fixed, or the digest has moved on. Either way this script
          // must not guess at where the text went.
          console.log(`  --    ${digest.section}: no match for ${JSON.stringify(from)}`);
          missed += 1;
        } else {
          console.log(`  ok    ${digest.section}: ${hits}x ${JSON.stringify(from)}`);
          changed += hits;
        }
      }
    }

    if (changed === 0) {
      console.log(`course ${row.course_id}: nothing to change`);
      continue;
    }
    if (!APPLY) {
      console.log(`course ${row.course_id}: ${changed} replacement(s) ready (dry run)`);
      continue;
    }

    const { error: writeError } = await supabase
      .from("na_continuity")
      .update({ packets, updated_at: new Date().toISOString() })
      .eq("id", row.id);

    if (writeError) {
      console.error(`course ${row.course_id}: WRITE FAILED: ${writeError.message}`);
      process.exit(1);
    }
    console.log(`course ${row.course_id}: ${changed} replacement(s) written`);
  }

  if (missed > 0) process.exit(1);
}

main();
