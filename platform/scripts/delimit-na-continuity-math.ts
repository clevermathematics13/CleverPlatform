/**
 * One-off: put the mathematics in A.3's and B.4's continuity digests inside
 * $...$, as LaTeX, the way every other digest now reads.
 *
 * The companion to scripts/fix-na-continuity-notation.ts, which fixed A.2 and
 * B.1. Those two had the WRONG notation -- Typst and Unicode. These two have
 * NO notation: "a^2+2ab+b^2", "6x^2+11x+3 = (2x+3)(3x+1)", "a*b=b*a" sit in
 * the prose as bare ASCII. Same consequence either way. A digest is never
 * rendered; it is prompt text, and buildContinuityContext() puts it LAST,
 * where a model weights it most heavily. Whatever the mathematics looks like
 * there is the freshest example of house style the generator sees before it
 * writes, and rule 11b asks it for LaTeX.
 *
 * HOW IT AVOIDS EATING THE PROSE. Three rules, because the strings being
 * edited are paragraphs, not fields:
 *
 *  1. Only the text OUTSIDE existing $...$ is considered. B.4's TOK
 *     provocation already reads "$x^2+11x+18$", and a blind pass would have
 *     made it "$$x^2+11x+18$$".
 *  2. Replacements run LONGEST FIRST, and each one is swapped for a
 *     placeholder rather than its final text. Without that, wrapping
 *     "3(x+4)+2(x+4)=5(x+4)" and then wrapping "(x+4)" would put delimiters
 *     through the middle of the span just written.
 *  3. Every literal is exact, and a miss is REPORTED rather than guessed at.
 *     Two of these strings carry CCSS codes -- HSA.SSE.A.2, 7.EE.A.1, MP.7 --
 *     that look like mathematics and are not; nothing here matches them, and
 *     a pattern loose enough to be convenient would.
 *
 * Every span the script produces is compiled as real Typst before anything is
 * written, so a digest can never be left quoting mathematics that will not
 * print in the packet that inherits it.
 *
 * Usage (from platform/):
 *   npx tsx scripts/delimit-na-continuity-math.ts          # dry run, full diff
 *   npx tsx scripts/delimit-na-continuity-math.ts --yes
 */
import { createClient } from "@supabase/supabase-js";
import { NodeCompiler } from "@myriaddreamin/typst-ts-node-compiler";
import { latexToTypst } from "../lib/latex-to-typst";
import { spanIsForLatexConversion } from "../lib/math-typesetting";

const APPLY = process.argv.includes("--yes");

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://qnawglgnoojrlaivylou.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  console.error("Missing env: SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const BS = String.fromCharCode(92);
const TIMES = `${BS}times `;

/**
 * The expressions, as they appear in the prose, and the LaTeX to set them as.
 * Identical on both sides except where the source used "*" for multiplication,
 * which is neither LaTeX nor how a packet prints it.
 */
const EXPRESSIONS: Array<[string, string]> = [
  // ---- A.3 ----
  ["(a+b)(a+b) = a^2 + 2ab + b^2", "(a+b)(a+b) = a^2 + 2ab + b^2"],
  ["(a+b)(a+b) = a^2+2ab+b^2", "(a+b)(a+b) = a^2+2ab+b^2"],
  ["4(2x+3y)+5(2x+3y)=18x+27y", "4(2x+3y)+5(2x+3y)=18x+27y"],
  ["2*(3*5) = (2*3)*(2*5)", `2 ${TIMES}(3 ${TIMES}5) = (2 ${TIMES}3) ${TIMES}(2 ${TIMES}5)`],
  ["3(x+4)+2(x+4)=5(x+4)", "3(x+4)+2(x+4)=5(x+4)"],
  ["5(x+2) = 5x + 2", "5(x+2) = 5x + 2"],
  ["12a+6(c+n)", "12a+6(c+n)"],
  ["12a+6c+6n", "12a+6c+6n"],
  ["30(2a+c)", "30(2a+c)"],
  ["a*b=b*a", `a ${TIMES}b = b ${TIMES}a`],
  ["a+b=b+a", "a+b=b+a"],
  ["x+5=12", "x+5=12"],
  ["3x=18", "3x=18"],
  ["(x+4)", "(x+4)"],

  // ---- B.4 ----
  ["(ax+b)(cx+d) = ac x^2 + (ad+bc)x + bd", "(ax+b)(cx+d) = ac x^2 + (ad+bc)x + bd"],
  ["6x^2+11x+3 = (2x+3)(3x+1)", "6x^2+11x+3 = (2x+3)(3x+1)"],
  ["x^2+8x+16 = (x+4)(x+4)", "x^2+8x+16 = (x+4)(x+4)"],
  ["(x+2)(x+9) = x^2+11x+18", "(x+2)(x+9) = x^2+11x+18"],
  ["(x+3)(x+2) = x^2+5x+6", "(x+3)(x+2) = x^2+5x+6"],
  ["x^2+3x-3x-9", "x^2+3x-3x-9"],
  ["(x^2)^2-4^2", "(x^2)^2-4^2"],
  ["4x^2+4x+1", "4x^2+4x+1"],
  ["x^2+6x+10", "x^2+6x+10"],
  ["(x-2)(x+3)", "(x-2)(x+3)"],
  ["x^2+bx+c", "x^2+bx+c"],
  ["x^2+7x+3", "x^2+7x+3"],
  ["x^2+x-6", "x^2+x-6"],
  ["x^2-x-6", "x^2-x-6"],
  ["x^4-16", "x^4-16"],
  ["x^2+9", "x^2+9"],
  ["x^2-9", "x^2-9"],
  ["'= 0'", "'$= 0$'"],

  // ---- A.1 ----
  //
  // NOT listed, deliberately: the mark tariff in notation_conventions
  // ("Calculate=3", "Show that/Justify=6-7") is how many marks a command
  // term is worth, not an equation, and the CCSS codes (HSA.SSE.A.1a,
  // 6.EE.A.2a-b, MP.7) are references. Both would read as mathematics to a
  // pattern and are not.
  ["60a+30c = 30(2a+c)", "60a+30c = 30(2a+c)"],
  ["60a+30c=570", "60a+30c=570"],
  ["60a+30c", "60a+30c"],
  ["2a+c=19", "2a+c=19"],
  ["90ac", "90ac"],
  ["60a", "60a"],

  // ---- A.2 ----
  //
  // NOT listed: "one stapled rolling bundle per cycle = current section
  // classwork+HW" is prose using "=" for "consists of", and "P2 = Peter's
  // coincidence" labels a question. Neither is an equation.
  ["1+2+3 = 1x2x3 = 6", `1+2+3 = 1 ${TIMES}2 ${TIMES}3 = 6`],
  ["(2,3,4)", "(2,3,4)"],
  ["12-5", "12-5"],
  ["5-12", "5-12"],
].sort((a, b) => b[0].length - a[0].length);

/**
 * Which digests this script is allowed to touch. A.1 and A.2 were added
 * after a sharper scan found the same undelimited algebra there -- "2a+c=19",
 * "60a+30c = 30(2a+c)", "1+2+3 = 1x2x3 = 6" -- that A.3 and B.4 had. Leaving
 * two of six sections in the old style would have defeated the point, since
 * the generator reads the whole block.
 */
const SECTIONS = new Set(["A.1", "A.2", "A.3", "B.4"]);

const PLACEHOLDER = String.fromCharCode(3);

/** Wraps every listed expression in the prose OUTSIDE existing $...$ spans. */
function delimit(text: string): { out: string; count: number } {
  const parts = text.split("$");
  // An odd delimiter count means the existing pairing is already broken;
  // leave the string entirely alone rather than adding to the confusion.
  if (parts.length % 2 === 0) return { out: text, count: 0 };

  const held: string[] = [];
  let count = 0;

  const rewritten = parts.map((part, i) => {
    if (i % 2 === 1) return part; // already mathematics
    let prose = part;
    for (const [from, latex] of EXPRESSIONS) {
      if (!prose.includes(from)) continue;
      // "'= 0'" carries its own quotes and supplies the finished text.
      const wrapped = latex.startsWith("'") ? latex : `$${latex}$`;
      const pieces = prose.split(from);
      count += pieces.length - 1;
      const token = `${PLACEHOLDER}${held.length}${PLACEHOLDER}`;
      held.push(wrapped);
      prose = pieces.join(token);
    }
    return prose;
  });

  let out = rewritten.reduce((acc, part, i) => (i === 0 ? part : `${acc}$${part}`), "");
  out = out.replace(
    new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`, "g"),
    (_, n) => held[Number(n)],
  );
  return { out, count };
}

const compiler = NodeCompiler.create();

/** Compiles every $...$ span in a string; returns the ones Typst refuses. */
function badSpans(text: string): string[] {
  const parts = text.split("$");
  if (parts.length % 2 === 0) return [`UNBALANCED: ${text.slice(0, 60)}`];
  const bad: string[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const span = parts[i];
    // The SAME routing buildTypstPayload() uses. Checking with isLatexMath
    // alone was too strict and rejected five true strings: "2ab" and "ac x^2"
    // carry no backslash, so that test calls them legacy Typst and hands
    // them straight to a compiler that reads "ab" as one unknown variable.
    // spanIsForLatexConversion() is what production asks -- would Typst
    // refuse this, and is it mathematics rather than prose -- and it sends
    // them to the converter, which spaces the letters out.
    const typst = spanIsForLatexConversion(span) ? latexToTypst(span) : span;
    try {
      compiler.pdf({
        mainFileContent: `#set page(width: 400pt, height: 200pt)\n#eval(${JSON.stringify(typst)}, mode: "math")\n`,
      });
    } catch (err) {
      bad.push(`${span}  ->  ${String((err as Error)?.message || err).slice(0, 120)}`);
    }
  }
  return bad;
}

type Digest = Record<string, unknown>;

async function main() {
  const { data, error } = await supabase.from("na_continuity").select("id, course_id, packets");
  if (error) {
    console.error("Read failed:", error.message);
    process.exit(1);
  }

  const unused = new Set(EXPRESSIONS.map(([from]) => from));
  let failures = 0;

  for (const row of data ?? []) {
    const packets = (row.packets ?? []) as Digest[];
    let changed = 0;

    for (const digest of packets) {
      if (!SECTIONS.has(String(digest.section))) continue;

      for (const [field, value] of Object.entries(digest)) {
        const list = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
        const rewritten = list.map((item) => {
          if (typeof item !== "string") return item;
          const { out, count } = delimit(item);
          if (count === 0) return item;

          for (const [from] of EXPRESSIONS) if (item.includes(from)) unused.delete(from);

          const bad = badSpans(out);
          if (bad.length > 0) {
            failures += 1;
            console.log(`\n  FAIL  ${digest.section}.${field}`);
            for (const b of bad) console.log(`        ${b}`);
            return item;
          }

          changed += count;
          console.log(`\n  ${digest.section}.${field}  (${count} expression(s))`);
          console.log(`    -  ${item}`);
          console.log(`    +  ${out}`);
          return out;
        });

        if (Array.isArray(value)) digest[field] = rewritten;
        else if (typeof value === "string") digest[field] = rewritten[0];
      }
    }

    if (failures > 0) {
      console.error(`\n${failures} string(s) produced mathematics Typst refuses. Nothing written.`);
      process.exit(1);
    }

    if (unused.size > 0) {
      console.log(`\n  note: ${unused.size} listed expression(s) never matched:`);
      for (const u of unused) console.log(`        ${JSON.stringify(u)}`);
    }

    if (changed === 0) {
      console.log(`\ncourse ${row.course_id}: nothing to change`);
      continue;
    }
    if (!APPLY) {
      console.log(`\ncourse ${row.course_id}: ${changed} expression(s) ready (dry run)`);
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
    console.log(`\ncourse ${row.course_id}: ${changed} expression(s) written`);
  }
}

main();
