import type { IbGraphSpec } from "./IbGraph";

/**
 * The [[GRAPH_JSON:<base64>]] marker helpers, apart from IbGraph itself.
 *
 * They lived in IbGraph.tsx, which imports mafs (and through it a second
 * copy of katex) at the top. LatexRenderer needs only these helpers to find
 * and decode a marker, yet importing them from IbGraph pulled mafs into
 * every page that renders LaTeX -- and silently cancelled LatexRenderer's own
 * next/dynamic import of IbGraph, whose whole point is that mafs loads only
 * when a graph is actually drawn. Keeping them here, with a type-only import
 * of the spec, is what lets that lazy load work. IbGraph re-exports them, so
 * existing imports keep working.
 */

// --- JSON <-> base64 helpers (used by LatexRenderer & editor) ----------------

export const GRAPH_MARKER_RE = /\[\[GRAPH_JSON:([A-Za-z0-9+/=]+)\]\]/g;

export function encodeGraphSpec(spec: IbGraphSpec): string {
  return `[[GRAPH_JSON:${btoa(JSON.stringify(spec))}]]`;
}

export function decodeGraphSpec(b64: string): IbGraphSpec | null {
  try {
    return JSON.parse(atob(b64)) as IbGraphSpec;
  } catch {
    return null;
  }
}
