/**
 * tab-visibility.test.ts
 * -----------------------------------------------------------------------------
 * Regression test for assignment tabs discarding their contents on switch.
 *
 * The bug: assignments-client.tsx rendered each panel as
 * `activeTab === id && <Panel />`, so switching tabs unmounted the one you
 * left. On the Nuanced Analysis tab that silently threw away a generated
 * packet and reset the sandbox to its built-in DEFAULT_DRAFT -- the same
 * boilerplate that the stale-preview bug used to surface, and just as easy to
 * mistake for real output. Nothing warned, and nothing was recoverable.
 * -----------------------------------------------------------------------------
 */

import { describe, it, expect } from "vitest";
import {
  TABS,
  INITIAL_TAB,
  shouldRenderTab,
  visitTab,
  type TabId,
  type TabOption,
} from "./tab-visibility";

function tab(id: TabId): TabOption {
  const found = TABS.find((t) => t.id === id);
  if (!found) throw new Error(`no such tab: ${id}`);
  return found;
}

const NA = "nuanced-analysis";
const MANAGE = "manage-nuanced-analysis";

describe("shouldRenderTab", () => {
  it("keeps a visited tab mounted while another tab is on screen", () => {
    // The whole point: the Nuanced Analysis tab holds a generated packet in
    // component state, so leaving it in the tree is what preserves the work.
    const visited = new Set<TabId>([NA, "grade9"]);
    expect(shouldRenderTab(tab(NA), "grade9", visited)).toBe(true);
  });

  it("does not mount a tab that has never been opened", () => {
    const visited = new Set<TabId>([NA]);
    expect(shouldRenderTab(tab("grade12"), NA, visited)).toBe(false);
  });

  it("mounts the active tab", () => {
    expect(shouldRenderTab(tab(NA), NA, new Set<TabId>([NA]))).toBe(true);
  });

  it("mounts a remountOnShow tab only while it is active", () => {
    const visited = new Set<TabId>([NA, MANAGE]);
    expect(shouldRenderTab(tab(MANAGE), MANAGE, visited)).toBe(true);
    // Left the tree on switch away, so reopening it refetches the packet list
    // instead of showing what was there on the first visit.
    expect(shouldRenderTab(tab(MANAGE), NA, visited)).toBe(false);
  });
});

describe("visitTab", () => {
  it("adds a newly opened tab without mutating the previous set", () => {
    const before = new Set<TabId>([NA]);
    const after = visitTab(before, "grade9");
    expect(after.has("grade9")).toBe(true);
    expect(before.has("grade9")).toBe(false);
  });

  it("returns the same set when the tab was already visited", () => {
    // A new Set here would re-render every mounted panel for nothing.
    const before = new Set<TabId>([NA]);
    expect(visitTab(before, NA)).toBe(before);
  });
});

describe("tab configuration", () => {
  it("only lets a tab remount if it holds no authored work", () => {
    // Marking a sandbox tab remountOnShow restores the data-loss bug exactly.
    // Manage Saved Packets is the sole legitimate case: its entire state is a
    // fetched list, so a stale view is the bug and refetching is the point.
    expect(TABS.filter((t) => t.remountOnShow).map((t) => t.id)).toEqual([MANAGE]);
  });

  it("opens on a tab that exists", () => {
    expect(TABS.some((t) => t.id === INITIAL_TAB)).toBe(true);
  });
});
