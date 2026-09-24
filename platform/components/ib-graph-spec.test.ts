import { describe, it, expect } from "vitest";
import { GRAPH_MARKER_RE, encodeGraphSpec, decodeGraphSpec } from "./ib-graph-spec";
import type { IbGraphSpec } from "./IbGraph";

const SPEC: IbGraphSpec = {
  xRange: [-3, 5],
  yRange: [-6, 10],
  elements: [
    { type: "fn", expr: "x^2 - 2*x - 3", label: "f(x)" },
    { type: "point", x: 3, y: 0, label: "(3, 0)", open: false },
  ],
};

describe("graph marker helpers", () => {
  it("round-trips a spec through its marker", () => {
    const marker = encodeGraphSpec(SPEC);
    GRAPH_MARKER_RE.lastIndex = 0;
    const match = GRAPH_MARKER_RE.exec(`Sketch: ${marker} as shown.`);
    expect(match).not.toBeNull();
    expect(decodeGraphSpec(match![1])).toEqual(SPEC);
  });

  // LatexRenderer resets lastIndex before each exec because the regex is
  // global and shared; finding every marker in a string depends on that flag.
  it("finds every marker in a string", () => {
    const text = `${encodeGraphSpec(SPEC)} and ${encodeGraphSpec({ ...SPEC, xRange: [0, 1] })}`;
    GRAPH_MARKER_RE.lastIndex = 0; // matchAll starts from the shared regex's lastIndex
    expect([...text.matchAll(GRAPH_MARKER_RE)]).toHaveLength(2);
  });

  it("decodes garbage to null instead of throwing", () => {
    expect(decodeGraphSpec("not base64 json")).toBeNull();
    expect(decodeGraphSpec(btoa("{not json"))).toBeNull();
  });
});
