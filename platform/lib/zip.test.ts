import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildZip } from "./zip";
import { crc32 } from "./crc32";

/** Fixed so the bytes are reproducible across runs. */
const WHEN = new Date(2026, 8, 8, 14, 30, 20);

describe("crc32", () => {
  // The canonical check value: CRC-32 of "123456789" is 0xCBF43926. If this
  // is right the polynomial and the bit order are right.
  it("matches the standard check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("is 0 for empty input", () => {
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe("buildZip", () => {
  it("starts with the local file header signature", () => {
    const zip = buildZip([{ name: "a.csv", content: "hello", date: WHEN }]);
    expect([...zip.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("ends with the end-of-central-directory signature", () => {
    const zip = buildZip([{ name: "a.csv", content: "hello", date: WHEN }]);
    expect([...zip.slice(-22, -18)]).toEqual([0x50, 0x4b, 0x05, 0x06]);
  });

  it("records the entry count in both fields of the end record", () => {
    const zip = buildZip([
      { name: "a.csv", content: "one", date: WHEN },
      { name: "b.csv", content: "two", date: WHEN },
      { name: "c.csv", content: "three", date: WHEN },
    ]);
    const end = zip.slice(-22);
    expect(end[8] | (end[9] << 8)).toBe(3); // entries on this disk
    expect(end[10] | (end[11] << 8)).toBe(3); // entries total
  });

  it("produces an empty but valid archive for no entries", () => {
    const zip = buildZip([]);
    expect(zip.length).toBe(22);
    expect([...zip.slice(0, 4)]).toEqual([0x50, 0x4b, 0x05, 0x06]);
  });

  // Bit 11 tells the reader the name is UTF-8. Without it "Évaluation.csv"
  // comes out mangled on Windows.
  it("flags names as UTF-8", () => {
    const zip = buildZip([{ name: "Évaluation.csv", content: "x", date: WHEN }]);
    const flags = zip[6] | (zip[7] << 8);
    expect(flags & 0x0800).toBe(0x0800);
  });
});

/**
 * The real test. Anything can emit plausible-looking bytes; the question is
 * whether `unzip` reads them, because that is what the teacher's computer will
 * do with the file.
 */
describe("buildZip, read back by unzip", () => {
  const hasUnzip = (() => {
    try {
      execFileSync("unzip", ["-v"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();

  it.runIf(hasUnzip)("round-trips several files, contents intact", () => {
    const files = [
      { name: "9A_Form1_3.csv", content: "Student Num,Student Name,Score\r\n30017,Santiago CAIPO,4\r\n" },
      { name: "9C_Form1_9.csv", content: "Student Num,Student Name,Score\r\n30010,Emma BENDERMAN,\r\n" },
      { name: "Tomás_Évaluation.csv", content: "accented name, and a comma\n" },
    ];
    const zip = buildZip(files.map((f) => ({ ...f, date: WHEN })));

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zip-test-"));
    try {
      const archive = path.join(dir, "out.zip");
      fs.writeFileSync(archive, zip);

      // -t is unzip's own integrity check: CRCs, headers, offsets.
      const tested = execFileSync("unzip", ["-t", archive], { encoding: "utf8" });
      expect(tested).toContain("No errors detected");

      execFileSync("unzip", ["-q", "-o", archive, "-d", dir]);
      for (const f of files) {
        expect(fs.readFileSync(path.join(dir, f.name), "utf8")).toBe(f.content);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it.runIf(hasUnzip)("preserves CRLF, which PowerSchool's files use", () => {
    const content = "a,b\r\nc,d\r\n";
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zip-test-"));
    try {
      const archive = path.join(dir, "crlf.zip");
      fs.writeFileSync(archive, buildZip([{ name: "x.csv", content, date: WHEN }]));
      execFileSync("unzip", ["-q", "-o", archive, "-d", dir]);
      expect(fs.readFileSync(path.join(dir, "x.csv"), "utf8")).toBe(content);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
