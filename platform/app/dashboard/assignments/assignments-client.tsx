"use client";

import { useState } from "react";
import { Grade9PdfSandbox } from "./grade9-pdf-sandbox";
import { Grade10PdfSandbox } from "./grade10-pdf-sandbox";
import { Grade11PdfSandbox } from "./grade11-pdf-sandbox";
import { Grade12PdfSandbox } from "./grade12-pdf-sandbox";
import { DPQuestionDesigner } from "./dp-question-designer";

type TabId = "grade9" | "grade10" | "grade11" | "grade12" | "dp-designer";

type TabOption = {
  id: TabId;
  label: string;
  emoji: string;
};

const TABS: TabOption[] = [
  { id: "dp-designer", label: "DP Designer", emoji: "🎓" },
  { id: "grade9", label: "Grade 9", emoji: "9️⃣" },
  { id: "grade10", label: "Grade 10", emoji: "🔟" },
  { id: "grade11", label: "Grade 11", emoji: "11" },
  { id: "grade12", label: "Grade 12", emoji: "12" },
];

export function AssignmentsClient() {
  const [activeTab, setActiveTab] = useState<TabId>("dp-designer");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-lg border px-4 py-2 font-semibold transition-colors ${
              activeTab === tab.id
                ? "border-da-accent bg-da-accent/20 text-da-accent"
                : "border-da-border bg-da-bg/40 text-da-text hover:border-da-accent/60 hover:bg-da-hover"
            } ${
              tab.id === "dp-designer" && activeTab === "dp-designer"
                ? "ring-2 ring-indigo-400 ring-offset-1"
                : ""
            }`}
          >
            {tab.emoji} {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "dp-designer" && <DPQuestionDesigner />}
      {activeTab === "grade9" && <Grade9PdfSandbox />}
      {activeTab === "grade10" && <Grade10PdfSandbox />}
      {activeTab === "grade11" && <Grade11PdfSandbox />}
      {activeTab === "grade12" && <Grade12PdfSandbox />}
    </div>
  );
}
