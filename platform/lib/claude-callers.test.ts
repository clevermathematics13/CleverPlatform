/**
 * Every client that POSTs to /api/claude must read the stream it returns.
 *
 * That route stopped being a JSON endpoint in #164 and six callers kept doing
 * response.json() (or readJsonSafely, which is worse -- it returns null, so
 * the button simply did nothing). Nobody noticed for months, because a unit
 * test cannot open a socket and the failure looked like a UI that ignored you.
 *
 * So the invariant is checked where it is cheap and total: in the source. Any
 * file that posts to that route has to import the reader. A new caller written
 * the old way fails here, on the machine of whoever wrote it, rather than in a
 * teacher's hands.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const POSTS_TO_CLAUDE = /fetch\(\s*["'`]\/api\/claude["'`]/;
const READS_THE_STREAM = /readClaudeStream/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full);
  }
  return out;
}

const callers = sourceFiles(path.join(ROOT, "app"))
  .filter((f) => POSTS_TO_CLAUDE.test(fs.readFileSync(f, "utf8")))
  .map((f) => path.relative(ROOT, f));

describe("callers of POST /api/claude", () => {
  it("finds the callers at all -- a zero here would make this file vacuous", () => {
    expect(callers.length).toBeGreaterThan(3);
  });

  it.each(callers)("%s reads the stream rather than parsing JSON", (file) => {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    expect(READS_THE_STREAM.test(source)).toBe(true);
  });

  it.each(callers)("%s does not CALL readJsonSafely", (file) => {
    // It returns null when the body will not parse, which is exactly how this
    // failure stayed invisible: no error, no throw, nothing applied. Matched as
    // a call rather than a mention, so a comment explaining why it is the wrong
    // helper here does not trip the rule that says so.
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    expect(source).not.toMatch(/readJsonSafely\s*[<(]/);
  });
});
