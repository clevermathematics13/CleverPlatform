"use client";

import { useMemo, useState, type ReactElement } from "react";
import { Grade9PdfSandbox } from "./grade9-pdf-sandbox";
import { Grade10PdfSandbox } from "./grade10-pdf-sandbox";
import { Grade11PdfSandbox } from "./grade11-pdf-sandbox";
import { Grade12PdfSandbox } from "./grade12-pdf-sandbox";
import { DPQuestionDesigner } from "./dp-question-designer";
import { NuancedAnalysisSandbox } from "./nuanced-analysis-sandbox";
import { NuancedAnalysisManage } from "./nuanced-analysis-manage";
import { FormativeAssessmentSandbox } from "./formative-assessment-sandbox";
import { TABS, INITIAL_TAB, shouldRenderTab, visitTab, type TabId } from "./tab-visibility";

/**
 * Tabs mount on first visit and then stay mounted, hidden with CSS, rather
 * than unmounting when you switch away. See tab-visibility.ts for the rule
 * and why it exists.
 *
 * Lazy rather than mounting all eight upfront: four of these tabs fetch on
 * mount (courses, continuity, Drive status, saved packets), and none of that
 * should be paid for by someone who never opens the tab.
 *
 * Each panel element is memoised so that switching tabs - which re-renders
 * this component - does not re-render every previously visited tab. React
 * bails out of a subtree whose element is referentially identical, which
 * matters here because these subtrees render whole document previews. This
 * does not defeat remountOnShow: a tab that leaves the tree gets a fresh
 * component instance when it returns, memoised element or not.
 */
export function AssignmentsClient() {
  const [activeTab, setActiveTab] = useState<TabId>(INITIAL_TAB);
  const [visited, setVisited] = useState<ReadonlySet<TabId>>(() => new Set([INITIAL_TAB]));

  function openTab(id: TabId) {
    setActiveTab(id);
    setVisited((prev) => visitTab(prev, id));
  }

  const panels = useMemo<Record<TabId, ReactElement>>(
    () => ({
      "dp-designer": <DPQuestionDesigner />,
      "nuanced-analysis": <NuancedAnalysisSandbox />,
      "manage-nuanced-analysis": <NuancedAnalysisManage />,
      "formative-assessment": <FormativeAssessmentSandbox />,
      grade9: <Grade9PdfSandbox />,
      grade10: <Grade10PdfSandbox />,
      grade11: <Grade11PdfSandbox />,
      grade12: <Grade12PdfSandbox />,
    }),
    []
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => openTab(tab.id)}
            className={`rounded-lg border px-4 py-2 font-semibold transition-colors ${
              activeTab === tab.id
                ? "border-da-accent bg-da-accent/20 text-da-accent"
                : "border-da-border bg-da-bg/40 text-da-text hover:border-da-accent/60 hover:bg-da-hover"
            } ${
              tab.id === "dp-designer" && activeTab === "dp-designer"
                ? "ring-2 ring-indigo-400 ring-offset-1"
                : ""
            } ${
              tab.id === "nuanced-analysis" && activeTab === "nuanced-analysis"
                ? "ring-2 ring-amber-400 ring-offset-1"
                : ""
            }`}
          >
            {tab.emoji} {tab.label}
          </button>
        ))}
      </div>

      {TABS.map((tab) => {
        if (!shouldRenderTab(tab, activeTab, visited)) return null;
        return (
          <div key={tab.id} className={activeTab === tab.id ? undefined : "hidden"}>
            {panels[tab.id]}
          </div>
        );
      })}
    </div>
  );
}
