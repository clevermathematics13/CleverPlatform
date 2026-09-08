import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * `tests` and `courses` can no longer be embedded without naming the foreign
 * key, and this is the guard that says so.
 *
 * powerschool_export_files has `PRIMARY KEY (course_id, test_id)` with a
 * foreign key to each of them. That is exactly the shape PostgREST reads as a
 * join table, so it now sees TWO ways to get from tests to courses: the direct
 * tests.course_id, and the many-to-many through the export files. A bare
 * `courses(name)` on a tests query is ambiguous, and PostgREST answers the
 * WHOLE query with HTTP 300 / PGRST201 -- no rows, no partial result.
 *
 * That is worse than it sounds, because supabase-js hands the failure back as
 * `{ data: null, error }`, and a caller reading only `data` renders it as
 * "nothing here". The Tests page did exactly that: six tests in the database,
 * "No tests yet. Create your first test above." on screen.
 *
 * `courses!tests_course_id_fkey(name)` names which relationship is meant and
 * the query works again. Nothing warns you if you forget -- the code compiles,
 * the types are unchanged, and it only fails in front of the teacher. Hence a
 * test that reads the source.
 */

const ROOT = path.resolve(__dirname, "..");
const SEARCH_DIRS = ["app", "lib", "components", "scripts", "workflows"];

/** Every .ts/.tsx file under the directories the app is actually built from. */
function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        walk(full);
      } else if (/\.tsx?$/.test(entry.name) && !full.endsWith(path.basename(__filename))) {
        found.push(full);
      }
    }
  };
  for (const dir of SEARCH_DIRS) walk(path.join(ROOT, dir));
  return found;
}

/**
 * Where `.from("<table>")` is followed by an embed of `<embedded>` with no
 * `!fk` hint. The window stops at the next `.from(` so one query's select
 * cannot be blamed on the query after it.
 */
function ambiguousEmbeds(table: string, embedded: string): string[] {
  const hits: string[] = [];
  const opener = `.from("${table}")`;

  for (const file of sourceFiles()) {
    const source = fs.readFileSync(file, "utf8");
    let at = source.indexOf(opener);
    while (at !== -1) {
      const after = source.slice(at + opener.length);
      const nextQuery = after.indexOf(".from(");
      const window = nextQuery === -1 ? after : after.slice(0, nextQuery);

      // `courses(` but not `courses!...(`. A comment mentioning the bare form
      // is not a query, so lines starting with // are dropped first.
      const code = window
        .split("\n")
        .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
        .join("\n");

      if (new RegExp(`[^!\\w]${embedded}\\s*\\(`).test(code)) {
        const line = source.slice(0, at).split("\n").length;
        hits.push(`${path.relative(ROOT, file)}:${line}`);
      }
      at = source.indexOf(opener, at + opener.length);
    }
  }
  return hits;
}

describe("PostgREST embeds between tests and courses", () => {
  it("never embeds courses from tests without naming the foreign key", () => {
    expect(ambiguousEmbeds("tests", "courses")).toEqual([]);
  });

  it("never embeds tests from courses without naming the foreign key", () => {
    expect(ambiguousEmbeds("courses", "tests")).toEqual([]);
  });

  // The scan has to be able to fail, or it is decoration. This is the shape it
  // is looking for, written out.
  it("would catch the bare form", () => {
    const offending = `supabase.from("tests").select("id, courses(name)")`;
    expect(/[^!\w]courses\s*\(/.test(offending)).toBe(true);
    const fixed = `supabase.from("tests").select("id, courses!tests_course_id_fkey(name)")`;
    expect(/[^!\w]courses\s*\(/.test(fixed)).toBe(false);
  });
});
