import { describe, it, expect } from "vitest";
import { safeStorageName, correctionsKey } from "./storage-keys";

/** Supabase storage-api's own key validator, copied from its limits.ts. */
const isValidKey = (key: string) =>
  key.length > 0 && /^(\w|\/|!|-|\.|\*|'|\(|\)| |&|\$|@|=|;|:|\+|,|\?)*$/.test(key);

describe("safeStorageName", () => {
  it("transliterates the accented name that produced the Invalid key report", () => {
    expect(safeStorageName("Diseño sin título.pdf")).toBe("Diseno-sin-titulo.pdf");
  });

  it("handles the decomposed (NFD) spelling a Mac hands over identically", () => {
    // Same name, but as "n" + combining tilde and "i" + combining acute, which
    // is what a file picked from macOS actually carries.
    const nfd = "Diseño sin título.pdf";
    expect(nfd).not.toBe("Diseño sin título.pdf");
    expect(safeStorageName(nfd)).toBe("Diseno-sin-titulo.pdf");
  });

  it("removes the # that silently truncated a stored object", () => {
    expect(safeStorageName("Math KA #6 Corrections.pdf")).toBe("Math-KA-6-Corrections.pdf");
  });

  it("removes ? too, which truncates a key just as quietly", () => {
    expect(safeStorageName("what?.pdf")).toBe("what.pdf");
  });

  it("keeps the extension and collapses runs of separators", () => {
    expect(safeStorageName("Scan 12 Jan 2026 at 14:03.pdf")).toBe("Scan-12-Jan-2026-at-14-03.pdf");
  });

  it("falls back to 'file' when the stem slugs away to nothing", () => {
    expect(safeStorageName("——.pdf")).toBe("file.pdf");
  });

  it("leaves an already-safe name alone", () => {
    expect(safeStorageName("blank.pdf")).toBe("blank.pdf");
  });

  it("tolerates a name with no extension", () => {
    expect(safeStorageName("corrections")).toBe("corrections");
  });

  it("caps a very long stem without losing the extension", () => {
    expect(safeStorageName(`${"a".repeat(300)}.pdf`)).toBe(`${"a".repeat(100)}.pdf`);
  });

  it("produces a key Supabase accepts for every name that previously failed", () => {
    for (const name of [
      "Diseño sin título.pdf",
      "Math KA #6 Corrections.pdf",
      "über—café résumé (final)!.pdf",
      "100% ✓ done.pdf",
      "你好.pdf",
    ]) {
      const safe = safeStorageName(name);
      expect(isValidKey(safe)).toBe(true);
      expect(safe).not.toMatch(/[#?]/);
    }
  });
});

describe("correctionsKey", () => {
  const student = "579505db-509a-4259-854c-39943fd3ad9a";
  const test = "f5221cd9-66b1-48cd-bfe3-652d87df26b2";

  it("builds a key Supabase accepts from the name that was rejected", () => {
    const key = correctionsKey(student, test, "Diseño sin título.pdf");
    expect(isValidKey(key)).toBe(true);
    expect(key).toMatch(
      new RegExp("^" + student + "/" + test + "/\\d+-[0-9a-f]{8}-Diseno-sin-titulo\\.pdf$")
    );
  });

  it("keeps the student uuid as the first segment, which the RLS policy checks", () => {
    expect(correctionsKey(student, test, "x.pdf").split("/")[0]).toBe(student);
  });

  it("never reuses a key, so every write stays on the INSERT path", () => {
    const keys = new Set(
      Array.from({ length: 200 }, () => correctionsKey(student, test, "same.pdf"))
    );
    expect(keys.size).toBe(200);
  });
});
