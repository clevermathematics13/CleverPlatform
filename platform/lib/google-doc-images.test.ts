import type { docs_v1 } from "googleapis";
import { describe, expect, it } from "vitest";
import {
  extensionForType,
  inlineObjectIdsInDocumentOrder,
  isDocExtractionFileName,
  isDriveFileNotFound,
} from "./google-doc-images";

const image = (id: string): docs_v1.Schema$ParagraphElement => ({ inlineObjectElement: { inlineObjectId: id } });
const text = (content: string): docs_v1.Schema$ParagraphElement => ({ textRun: { content } });
const paragraph = (...elements: docs_v1.Schema$ParagraphElement[]): docs_v1.Schema$StructuralElement => ({
  paragraph: { elements },
});
const table = (...rows: docs_v1.Schema$StructuralElement[][][]): docs_v1.Schema$StructuralElement => ({
  table: { tableRows: rows.map((cells) => ({ tableCells: cells.map((content) => ({ content })) })) },
});

describe("inlineObjectIdsInDocumentOrder", () => {
  it("follows the page, not the map's keys", () => {
    const body: docs_v1.Schema$Body = {
      content: [paragraph(text("(a) "), image("kix.zz")), paragraph(image("kix.aa")), paragraph(image("kix.mm"))],
    };
    // The map lists them alphabetically; the page reads zz, aa, mm.
    expect(inlineObjectIdsInDocumentOrder(body, ["kix.aa", "kix.mm", "kix.zz"])).toEqual(["kix.zz", "kix.aa", "kix.mm"]);
  });

  it("reads tables row by row and cell by cell, nested tables included", () => {
    const body: docs_v1.Schema$Body = {
      content: [
        paragraph(image("first")),
        table(
          [[paragraph(image("r1c1"))], [paragraph(image("r1c2"))]],
          [[table([[paragraph(image("inner"))]])], [paragraph(image("r2c2"))]]
        ),
        { tableOfContents: { content: [paragraph(image("toc"))] } },
        paragraph(image("last")),
      ],
    };
    expect(inlineObjectIdsInDocumentOrder(body, ["last", "toc", "r2c2", "inner", "r1c2", "r1c1", "first"])).toEqual([
      "first",
      "r1c1",
      "r1c2",
      "inner",
      "r2c2",
      "toc",
      "last",
    ]);
  });

  it("keeps objects the body never refers to, last, and ignores ids it does not know", () => {
    const body: docs_v1.Schema$Body = { content: [paragraph(image("b"), image("ghost"), image("b"))] };
    expect(inlineObjectIdsInDocumentOrder(body, ["a", "b", "c"])).toEqual(["b", "a", "c"]);
    expect(inlineObjectIdsInDocumentOrder(undefined, ["a", "b"])).toEqual(["a", "b"]);
  });
});

describe("isDocExtractionFileName", () => {
  it("knows the names Extract and Extract all images write, and nothing else", () => {
    expect(isDocExtractionFileName("01.png")).toBe(true);
    expect(isDocExtractionFileName("12.jpg")).toBe(true);
    expect(isDocExtractionFileName("03-lx2k9a1-2.png")).toBe(true);
    expect(isDocExtractionFileName("pdf-01.png")).toBe(false);
    expect(isDocExtractionFileName("upload-scheme.png")).toBe(false);
    expect(isDocExtractionFileName("1.png")).toBe(false);
  });
});

describe("extensionForType and isDriveFileNotFound", () => {
  it("maps content types and recognises a missing Drive file", () => {
    expect(extensionForType("image/jpeg")).toBe("jpg");
    expect(extensionForType("image/webp")).toBe("webp");
    expect(extensionForType("application/octet-stream")).toBe("png");
    expect(isDriveFileNotFound({ code: 404 })).toBe(true);
    expect(isDriveFileNotFound(new Error("Requested entity was not found."))).toBe(true);
    expect(isDriveFileNotFound(new Error("quota exceeded"))).toBe(false);
  });
});
