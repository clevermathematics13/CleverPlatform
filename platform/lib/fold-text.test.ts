import { describe, it, expect } from "vitest";
import { foldText } from "./fold-text";

describe("foldText", () => {
  it("lowercases", () => {
    expect(foldText("Davi Verma")).toBe("davi verma");
  });

  it("strips the accents a US keyboard will not produce", () => {
    expect(foldText("Joaquín")).toBe("joaquin");
    expect(foldText("Inés Palomino")).toBe("ines palomino");
    expect(foldText("Paula Sofía Nieto Pérez")).toBe("paula sofia nieto perez");
  });

  it("lets an unaccented query match an accented name", () => {
    expect(foldText("Joaquín Musso").includes(foldText("joaquin"))).toBe(true);
    expect(foldText("Inés Palomino").includes(foldText("ines"))).toBe(true);
  });

  it("still matches when the query itself carries the accent", () => {
    expect(foldText("Joaquín Musso").includes(foldText("Joaquín"))).toBe(true);
  });

  it("leaves unaccented names alone", () => {
    expect(foldText("Ruifeng Wu")).toBe("ruifeng wu");
    expect(foldText("9C")).toBe("9c");
  });
});
