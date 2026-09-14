import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { katexInlineCss, katexStylesheetBlock } from "./katex-inline-css";

/**
 * The defect these guard against prints silently and reached a real exam:
 * KaTeX draws U+2260 as a private-use slash (U+E020) over an `=`. Lose the
 * font and the slash vanishes while the `=` stays, so "n != 0" prints as
 * "n = 0". Nothing throws, nothing logs, and the paper looks fine.
 */
const ROOT = process.cwd();

describe("katexInlineCss", () => {
  const css = katexInlineCss();

  it("reads the vendored stylesheet", () => {
    expect(css, "public/katex/katex.min.css was not readable").not.toBeNull();
  });

  it("embeds every face the stylesheet declares", () => {
    const faces = css!.match(/@font-face/g) ?? [];
    const embedded = css!.match(/src:url\(data:font\/woff2;base64,/g) ?? [];
    expect(faces.length).toBeGreaterThan(0);
    expect(embedded.length).toBe(faces.length);
  });

  it("leaves no URL for the browser to fetch mid-render", () => {
    // Relative font paths cannot resolve under page.setContent() (no base
    // URL), and a CDN one is the race this module exists to remove.
    expect(css).not.toMatch(/url\(fonts\//);
    expect(css).not.toMatch(/url\((https?:)?\/\//);
  });

  it("embeds KaTeX_Main-Regular, which carries the != slash glyph", () => {
    const font = readFileSync(join(ROOT, "public", "katex", "fonts", "KaTeX_Main-Regular.woff2"));
    expect(css).toContain(font.toString("base64"));
  });

  it("embeds the same faces that are vendored", () => {
    const shipped = readdirSync(join(ROOT, "public", "katex", "fonts")).filter((f) =>
      f.endsWith(".woff2"),
    );
    // Every vendored face is referenced by the stylesheet, so every one of
    // them must appear inlined -- a face that stopped being embedded would
    // fail open, drawing nothing rather than erroring.
    for (const face of shipped) {
      const font = readFileSync(join(ROOT, "public", "katex", "fonts", face));
      expect(css, `${face} is not embedded`).toContain(font.toString("base64"));
    }
  });

  it("is cached rather than re-read per render", () => {
    // ~350KB of base64 per PDF page otherwise, and both PDFs build CSS twice.
    expect(katexInlineCss()).toBe(css);
  });
});

describe("katexStylesheetBlock", () => {
  it("returns the inlined CSS when the vendored copy is present", () => {
    expect(katexStylesheetBlock()).toBe(katexInlineCss());
  });
});

describe("the printed-paper renderers", () => {
  const orchestrator = readFileSync(join(ROOT, "lib", "document-orchestrator.ts"), "utf8");

  it("does not import KaTeX CSS from a CDN", () => {
    expect(orchestrator).not.toMatch(/cdn\.jsdelivr\.net[^\n]*katex/);
  });

  it("opens both stylesheets with the inlined block", () => {
    // Both the student paper (buildCss) and the mark scheme
    // (buildMarkSchemeCss) print maths, so both need the faces.
    const uses = orchestrator.match(/\$\{katexStylesheetBlock\(\)\}/g) ?? [];
    expect(uses.length).toBe(2);
  });

  it("waits for web fonts before printing", () => {
    const pdf = readFileSync(join(ROOT, "lib", "formative-assessment-pdf.ts"), "utf8");
    expect(pdf).toMatch(/document\.fonts\.ready/);
    // The wait is only worth anything before the print.
    expect(pdf.indexOf("document.fonts.ready")).toBeLessThan(pdf.indexOf("page.pdf({"));
  });
});
