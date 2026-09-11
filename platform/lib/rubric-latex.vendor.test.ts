import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * public/katex/ is a vendored copy of node_modules/katex/dist, used by the
 * printable answer key at app/api/na-review/rubric/[nuancedAnalysisId].
 *
 * Nothing imports those files, so nothing would notice them going stale. If
 * they do, the page still renders KaTeX markup but positions none of it, and
 * x^4 silently becomes "x4" on a marking key. These tests are the only thing
 * standing between `npm update katex` and that.
 */
const root = process.cwd();
const vendored = join(root, "public", "katex");
const upstream = join(root, "node_modules", "katex", "dist");

describe("vendored KaTeX assets", () => {
  it("has the stylesheet the route links to", () => {
    expect(existsSync(join(vendored, "katex.min.css"))).toBe(true);
  });

  it("is byte-identical to the installed katex version", () => {
    // Re-vendor with:
    //   cp node_modules/katex/dist/katex.min.css public/katex/katex.min.css
    //   cp node_modules/katex/dist/fonts/*.woff2 public/katex/fonts/
    const ours = readFileSync(join(vendored, "katex.min.css"), "utf8");
    const theirs = readFileSync(join(upstream, "katex.min.css"), "utf8");
    expect(ours, "public/katex/katex.min.css is stale — re-vendor it").toBe(theirs);
  });

  it("ships every woff2 face the stylesheet asks for", () => {
    const css = readFileSync(join(vendored, "katex.min.css"), "utf8");
    const wanted = [...css.matchAll(/url\(fonts\/([A-Za-z_-]+\.woff2)\)/g)].map((m) => m[1]);
    expect(wanted.length).toBeGreaterThan(0);

    const shipped = new Set(readdirSync(join(vendored, "fonts")));
    const missing = [...new Set(wanted)].filter((f) => !shipped.has(f));
    expect(missing, `missing vendored fonts: ${missing.join(", ")}`).toEqual([]);
  });

  it("keeps the font paths relative, so they resolve under /katex/", () => {
    const css = readFileSync(join(vendored, "katex.min.css"), "utf8");
    // An absolute or CDN URL here would send the browser off-site for fonts,
    // defeating the point of vendoring.
    expect(css).not.toMatch(/url\((https?:)?\/\//);
    expect(css).toMatch(/url\(fonts\//);
  });

  it("is linked by the rubric route from the vendored path, not a CDN", () => {
    const route = readFileSync(
      join(root, "app", "api", "na-review", "rubric", "[nuancedAnalysisId]", "route.ts"),
      "utf8",
    );
    expect(route).toContain('"/katex/katex.min.css"');
    expect(route).not.toMatch(/cdn\.jsdelivr\.net[^\n]*katex/);
  });
});
