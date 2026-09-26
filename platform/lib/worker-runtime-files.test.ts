import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * The NA worker's image copies only lib/, worker/ and the folders its code
 * reads at runtime (worker/Dockerfile). A module that reads a file through
 * path.join(process.cwd(), "<folder>", ...) at module init throws when the
 * folder is missing, so the worker crashloops on import -- and nothing short
 * of building the image shows it, since `npm run worker:dev` runs from
 * platform/ where every folder exists.
 *
 * This follows the worker's real (non-type) imports from worker/index.ts and
 * checks that every such folder any reachable module reads has its own COPY
 * line. It is how lib/ai-grading.ts's grading_policies/ turned out to be
 * load-bearing rather than the insurance the Dockerfile once called it.
 */

const ROOT = path.resolve(__dirname, "..");

const IMPORT =
  /(?:^|\n)\s*(import|export)\s+(type\s+)?[^'"]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|(?:^|\n)\s*import\s+["']([^"']+)["']/g;

function resolveImport(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(path.join(ROOT, fromFile)), spec);
  else return null;
  for (const ext of ["", ".ts", ".tsx", "/index.ts"]) {
    const candidate = base + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return path.relative(ROOT, candidate);
  }
  return null;
}

/** Every local module reachable from `entry` through imports that exist at runtime. */
function reachableFrom(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    for (const m of source.matchAll(IMPORT)) {
      if (m[2]) continue; // `import type ... from` is erased at runtime
      const spec = m[3] ?? m[4] ?? m[5];
      const resolved = spec ? resolveImport(file, spec) : null;
      if (resolved && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return seen;
}

/** Folders a module reads relative to the working directory. */
function runtimeFolders(file: string): string[] {
  const source = fs.readFileSync(path.join(ROOT, file), "utf8");
  return [...source.matchAll(/path\.join\(\s*process\.cwd\(\),\s*["']([^"'/]+)["']/g)].map((m) => m[1]);
}

function copiedFolders(): Set<string> {
  const dockerfile = fs.readFileSync(path.join(ROOT, "worker", "Dockerfile"), "utf8");
  return new Set([...dockerfile.matchAll(/^COPY\s+(\S+)\s+\.\/\S+\s*$/gm)].map((m) => m[1]));
}

describe("worker image runtime files", () => {
  const reachable = reachableFrom("worker/index.ts");

  it("sees the modules that read files at import time", () => {
    // If the import walk stopped finding these, the check below would pass
    // for the wrong reason.
    expect(reachable.has("lib/na-assessment.ts")).toBe(true);
    expect(reachable.has("lib/ai-grading.ts")).toBe(true);
  });

  it("copies every folder a reachable module reads into the image", () => {
    const copied = copiedFolders();
    const needed = new Map<string, string>();
    for (const file of reachable) {
      for (const folder of runtimeFolders(file)) if (!needed.has(folder)) needed.set(folder, file);
    }
    expect(needed.has("grading_policies")).toBe(true);
    expect(needed.has("feedback_voice")).toBe(true);
    const missing = [...needed].filter(([folder]) => !copied.has(folder)).map(([f, by]) => `${f} (read by ${by})`);
    expect(missing).toEqual([]);
  });
});
