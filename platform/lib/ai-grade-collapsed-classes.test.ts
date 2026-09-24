import { describe, it, expect } from "vitest";
import {
  COLLAPSED_CLASSES_COOKIE,
  collapsedClassesCookie,
  parseCollapsedClasses,
} from "./ai-grade-collapsed-classes";

/** The value part of a document.cookie string, as the browser sends it back. */
const valueOf = (cookie: string) => cookie.slice(`${COLLAPSED_CLASSES_COOKIE}=`.length, cookie.indexOf(";"));

describe("collapsedClassesCookie / parseCollapsedClasses", () => {
  it("reads back what it wrote, whether or not the value was decoded first", () => {
    const raw = valueOf(collapsedClassesCookie(["9A", "9G"], true));
    // Next's cookies() hands over the decoded value; read the raw one too.
    expect(parseCollapsedClasses(decodeURIComponent(raw))).toEqual(["9A", "9G"]);
    expect(parseCollapsedClasses(raw)).toEqual(["9A", "9G"]);
  });

  it("survives names with commas, quotes, percent signs and accents", () => {
    const names = ["Grade 9, Group B", 'The "Other" set', "100% club", "Año 9 · C"];
    const raw = valueOf(collapsedClassesCookie(names, false));
    // Nothing a cookie value may not hold (RFC 6265 cookie-octet).
    expect(raw).toMatch(/^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]+$/);
    expect(parseCollapsedClasses(decodeURIComponent(raw))).toEqual(names);
  });

  it("is scoped to the tests pages for a year, Lax, and Secure only when asked", () => {
    const cookie = collapsedClassesCookie(["9A"], true);
    expect(cookie).toContain("; path=/dashboard/tests;");
    expect(cookie).toContain("; max-age=31536000;");
    expect(cookie).toContain("; SameSite=Lax");
    expect(cookie.endsWith("; Secure")).toBe(true);
    expect(collapsedClassesCookie(["9A"], false)).not.toContain("Secure");
  });

  it("deletes the cookie once nothing is collapsed", () => {
    expect(collapsedClassesCookie([], true)).toContain("; max-age=0;");
  });

  it("keeps the most recent 20 distinct names and skips over-long ones", () => {
    const many = Array.from({ length: 25 }, (_, i) => `C${i}`);
    const raw = valueOf(collapsedClassesCookie([...many, "C3", "x".repeat(41)], true));
    const kept = parseCollapsedClasses(decodeURIComponent(raw));
    expect(kept).toHaveLength(20);
    expect(kept[0]).toBe("C5");
    expect(kept[19]).toBe("C24");
    expect(kept).not.toContain("x".repeat(41));
  });

  it("reads anything else as nothing collapsed", () => {
    for (const bad of [
      undefined,
      null,
      "",
      "9A,9G",
      "%E0%A4%A",
      '{"9A":true}',
      "[1,2]",
      `["${"y".repeat(5000)}"]`,
    ]) {
      expect(parseCollapsedClasses(bad)).toEqual([]);
    }
    // One good name among bad entries is still read.
    expect(parseCollapsedClasses('["9A", 3, null, ""]')).toEqual(["9A"]);
  });
});
