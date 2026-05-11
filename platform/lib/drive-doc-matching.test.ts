import { describe, expect, it } from "vitest";
import {
  extractCodeToken,
  filterDocsOutsideFolderTree,
  pickBestCandidate,
} from "./drive-doc-matching";

describe("drive-doc-matching", () => {
  it("filters docs that live under an excluded folder tree", () => {
    const docs = [
      { id: "question-doc", name: "25M.1.AHL.TZ1.H_6", parents: ["question-folder"] },
      { id: "markscheme-doc", name: "25M.1.AHL.TZ1.H_6", parents: ["markscheme-folder"] },
      { id: "shared-doc", name: "25M.1.AHL.TZ1.H_6", parents: ["question-folder", "markscheme-folder"] },
    ];

    expect(filterDocsOutsideFolderTree(docs, new Set(["markscheme-folder"]))).toEqual([
      { id: "question-doc", name: "25M.1.AHL.TZ1.H_6", parents: ["question-folder"] },
    ]);
  });

  it("prefers exact filenames and can avoid a conflicted doc id", () => {
    const candidates = [
      { id: "ms-doc", name: "25M.1.AHL.TZ1.H_6" },
      { id: "question-doc", name: "25M.1.AHL.TZ1.H_6" },
    ];

    expect(pickBestCandidate("25M.1.AHL.TZ1.H_6", candidates)?.id).toBe("ms-doc");
    expect(pickBestCandidate("25M.1.AHL.TZ1.H_6", candidates, "ms-doc")?.id).toBe("question-doc");
  });

  it("extracts embedded IB code tokens", () => {
    expect(extractCodeToken("Draft 25M.1.AHL.TZ1.H_6 - v2")).toBe("25M.1.AHL.TZ1.H_6");
  });
});