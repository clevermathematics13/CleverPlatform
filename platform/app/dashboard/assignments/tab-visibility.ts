/**
 * tab-visibility.ts
 * -----------------------------------------------------------------------------
 * Which assignment tabs are in the React tree, and which one is on screen.
 *
 * Split out of assignments-client.tsx so the decision can be tested without a
 * DOM: it used to be an inline `activeTab === id && <Tab />`, which unmounted
 * a tab the moment you switched away and silently discarded everything it
 * held. On the Nuanced Analysis tab that meant losing a generated packet -
 * minutes of work and a paid model call - and dropping back to the sandbox's
 * built-in DEFAULT_DRAFT, which looks enough like a real packet to be mistaken
 * for one.
 *
 * The rule is now: a tab mounts on first visit and stays mounted, hidden with
 * CSS, unless it opts into remountOnShow.
 * -----------------------------------------------------------------------------
 */

export type TabId =
  | "dp-designer"
  | "nuanced-analysis"
  | "manage-nuanced-analysis"
  | "formative-assessment"
  | "grade9"
  | "grade10"
  | "grade11"
  | "grade12";

export type TabOption = {
  id: TabId;
  label: string;
  emoji: string;
  /**
   * Rebuild this tab from scratch each time it is opened, instead of keeping
   * it alive. Only for tabs whose state is entirely server-derived, where
   * showing what was fetched on the first visit is the bug and a fresh fetch
   * is the whole point of reopening it.
   *
   * Never set this on a tab that holds authored work.
   */
  remountOnShow?: boolean;
};

// "Nuanced Analysis" has its OWN grade/course/section picker inside it
// (covering Grade 9-12), so the plain "Grade N" tabs are a different,
// older, generic PDF sandbox with no continuity awareness. Labelled
// "(generic PDF)" here specifically so a person working on Grade 9
// Nuanced Analysis content doesn't land on this tab by habit and lose
// the continuity context that only the Nuanced Analysis tab builds.
export const TABS: TabOption[] = [
  { id: "dp-designer",               label: "DP Designer",             emoji: "🎓" },
  { id: "nuanced-analysis",          label: "Nuanced Analysis",         emoji: "🔬" },
  // Nothing here is authored by hand - it is a list of saved packets, a
  // course filter and a delete confirmation. Reopening it after saving a
  // packet must show that packet, so this one is deliberately remounted.
  { id: "manage-nuanced-analysis",   label: "Manage Saved Packets",     emoji: "🗂️", remountOnShow: true },
  { id: "formative-assessment",      label: "Formative Assessment",     emoji: "📝" },
  { id: "grade9",                    label: "Grade 9 (generic PDF)",    emoji: "9️⃣" },
  { id: "grade10",                   label: "Grade 10 (generic PDF)",   emoji: "🔟" },
  { id: "grade11",                   label: "Grade 11 (generic PDF)",   emoji: "11" },
  { id: "grade12",                   label: "Grade 12 (generic PDF)",   emoji: "12" },
];

export const INITIAL_TAB: TabId = "nuanced-analysis";

/**
 * Is this tab in the React tree at all?
 *
 * A keep-alive tab stays true once visited even while another tab is on
 * screen - that is precisely what preserves its state. Returning false here
 * unmounts the tab and throws away everything it holds.
 */
export function shouldRenderTab(
  tab: TabOption,
  activeTab: TabId,
  visited: ReadonlySet<TabId>
): boolean {
  return tab.remountOnShow ? tab.id === activeTab : visited.has(tab.id);
}

/**
 * Record a tab as visited. Returns the SAME set when nothing changed, so
 * re-selecting the current tab does not hand React a new object and re-render
 * every mounted panel.
 */
export function visitTab(visited: ReadonlySet<TabId>, id: TabId): ReadonlySet<TabId> {
  return visited.has(id) ? visited : new Set(visited).add(id);
}
