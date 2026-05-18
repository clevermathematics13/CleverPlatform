"use client";

import { useState, useCallback } from "react";
import {
  type DPQuestionDesignerInput,
  type CurriculumModule,
  type CurriculumStage,
  type DPDesignerTemplate,
  type DeepSeekResponse,
  FUNCTION_FAMILY_PRESETS,
  DEFAULT_DP_INPUT,
  buildDPSystemPrompt,
  buildDPUserPrompt,
  extractJsonObject,
  sanitizeCurriculumModule,
} from "@/lib/dp-question-designer";

// ── Sample module for initial display ────────────────────────────────────────
const SAMPLE_MODULE: CurriculumModule = {
  title: "Foundations of Calculus: A Function-Family Approach to Limits",
  course: "IBDP Mathematics AA HL",
  target_grade_level: 12,
  assessment_tracker: "Clev's Marks",
  pedagogical_goal:
    "Progressive mastery of limits, continuity, and differentiability, strictly restricting derivative shortcuts until formally proven via the difference quotient.",
  stages: [
    {
      stage_number: 1,
      function_family: "Polynomial Functions",
      theme: "The Intuitive Foundation",
      core_vocabulary: [
        "Limit",
        "Direct substitution",
        "Interval",
        "Secant line",
        "Tangent line",
        "Difference quotient",
      ],
      key_proofs: [
        {
          name: "Power Rule from First Principles",
          description:
            "Prove $\\frac{d}{dx}(x^n) = nx^{n-1}$ for $n \\in \\mathbb{Z}^+$ using the limit of the difference quotient and binomial expansion.",
        },
        {
          name: "Root Existence (IVT application)",
          description:
            "Prove that if a polynomial evaluates to a positive value at $x=a$ and a negative value at $x=b$, the graph intersects the x-axis at least once in the interval $[a, b]$.",
        },
      ],
      exploration_activity: {
        title: "The Shrinking Secant",
        setup: "Given $f(x) = 0.5x^2 + 2$, find the exact slope at $x=2$.",
        task:
          "Calculate the slope of the secant line passing through $x=2$ and $x=2+h$. Build a table of values for $h = 1, 0.1, 0.01, 0.001$ to numerically hypothesize the tangent slope.",
        rigor:
          "Formalize the numerical guess by algebraically evaluating the limit of the difference quotient.",
      },
      tok_link:
        "The Concept of Infinity: Calculus relies on the infinitely small ($h \\to 0$). Can the human mind truly grasp the 'infinitely small,' or is it just a useful linguistic trick invented to make our formulas work?",
    },
    {
      stage_number: 2,
      function_family: "Rational Functions",
      theme: "The Anatomy of Discontinuity",
      core_vocabulary: [
        "Indeterminate form",
        "Vertical/Horizontal/Oblique asymptote",
        "Removable discontinuity",
        "Quotient",
        "Local linearity",
      ],
      key_proofs: [
        {
          name: "The Quotient Rule",
          description:
            "Prove $\\left(\\frac{f}{g}\\right)' = \\frac{f'g - fg'}{g^2}$ using the limit definition, requiring the algebraic technique of adding and subtracting $f(x)g(x)$ in the numerator.",
        },
      ],
      exploration_activity: {
        title: "Hole or Wall?",
        setup:
          "Analyze $f(x) = \\frac{x^2-4}{x-2}$, $g(x) = \\frac{x-2}{x^2-4}$, and $h(x) = \\frac{x^2-4}{(x-2)^2}$.",
        task: "Evaluate the limit of each function as $x \\to 2$ using algebraic manipulation before graphing.",
        rigor:
          "Classify the geometric behavior at $x=2$ (hole vs. asymptote) based purely on limit evaluation. Introduce L'Hôpital's Rule as an analytical tool for the $0/0$ form.",
      },
      tok_link:
        "The Nature of Undefined: What does $0/0$ actually mean? Is it a number, a concept, or a fundamental failure of our arithmetic system?",
    },
    {
      stage_number: 3,
      function_family: "Exponential & Logarithmic Functions",
      theme: "Transcendental Boundaries",
      core_vocabulary: [
        "Transcendental",
        "Base e",
        "Natural logarithm",
        "Euler's number",
        "Concavity",
        "Point of inflection",
      ],
      key_proofs: [
        {
          name: "Derivative of $e^x$",
          description:
            "Explore the definition of $e$ as the unique number where $\\lim_{h \\to 0} \\frac{e^h - 1}{h} = 1$, and use this to prove $\\frac{d}{dx}(e^x) = e^x$.",
        },
      ],
      exploration_activity: {
        title: "The Hierarchy of Infinity",
        setup:
          "Determine which function grows faster as $x \\to \\infty$: $x^{10}$ or $e^x$.",
        task: "Evaluate $\\lim_{x \\to \\infty} \\frac{x^{10}}{e^x}$ numerically for large values of $x$.",
        rigor:
          "Apply L'Hôpital's Rule iteratively to formally prove that exponential growth strictly dominates polynomial growth.",
      },
      tok_link:
        "Invention vs. Discovery: Euler's number $e$ governs continuous growth across physics, biology, and finance. Was $e$ invented by mathematicians, or is it a fundamental property of the universe we discovered?",
    },
    {
      stage_number: 4,
      function_family: "Trigonometric Functions",
      theme: "Oscillation and Squeeze",
      core_vocabulary: [
        "Periodicity",
        "Oscillation",
        "Squeeze Theorem",
        "Radian measure",
        "Bounding function",
      ],
      key_proofs: [
        {
          name: "The Fundamental Trigonometric Limit",
          description:
            "Rigorous geometric proof comparing areas of triangles and sectors to show $\\cos x \\le \\frac{\\sin x}{x} \\le \\frac{1}{\\cos x}$, proving $\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1$ via the Squeeze Theorem.",
        },
        {
          name: "Derivatives of Sine and Cosine",
          description:
            "Use the fundamental limit, the difference quotient, and compound angle identities to prove $\\frac{d}{dx}(\\sin x) = \\cos x$.",
        },
      ],
      exploration_activity: {
        title: "The Squeeze Sandbox",
        setup: "Evaluate $\\lim_{x \\to 0} x^2 \\sin(\\frac{1}{x})$.",
        task: "Observe that direct substitution and L'Hôpital's Rule both fail.",
        rigor:
          "Establish the bounding functions $-x^2 \\le x^2 \\sin(\\frac{1}{x}) \\le x^2$ and formally write out the Squeeze Theorem proof.",
      },
      tok_link:
        "Degrees vs. Radians: The limit $\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1$ only works in radians. Are radians a 'truer' measure of reality than human-invented degrees?",
    },
    {
      stage_number: 5,
      function_family: "Inverse & Reciprocal Trigonometric Functions",
      theme: "Restricted Domains",
      core_vocabulary: [
        "One-to-one function",
        "Principal value",
        "Domain restriction",
        "Implicit differentiation",
      ],
      key_proofs: [
        {
          name: "Derivatives of Inverse Trigonometry",
          description:
            "Construct right-angled triangles to prove the derivatives of $\\arcsin x$, $\\arccos x$, and $\\arctan x$ using implicit differentiation.",
        },
      ],
      exploration_activity: {
        title: "Slicing the Wave",
        setup: "Graph $y = \\sin x$ from $-3\\pi$ to $3\\pi$.",
        task: "Attempt to create the inverse function $y = \\arcsin x$ by reflecting across $y=x$, noting the failure of the vertical line test.",
        rigor:
          "Define the strict domain restrictions required to create a one-to-one function. Evaluate the left and right-hand limits of the derivative of $\\arcsin x$ as $x \\to 1^-$ and $x \\to -1^+$ to explain the vertical tangents at the boundaries.",
      },
      tok_link:
        "Pragmatism in Mathematics: By restricting the domain of sine to $[-\\frac{\\pi}{2}, \\frac{\\pi}{2}]$, are we ignoring mathematical reality just to make our functions 'work'?",
    },
  ],
};

// ── Styles ────────────────────────────────────────────────────────────────────
const inputClass =
  "w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500";
const labelClass = "block text-xs font-semibold text-gray-700 mb-1";
const btnPrimary =
  "rounded bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors";
const btnSecondary =
  "rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors";
const btnDanger =
  "rounded bg-red-50 px-2 py-1 text-xs text-red-600 hover:bg-red-100 transition-colors";

// ── Component ─────────────────────────────────────────────────────────────────

export function DPQuestionDesigner() {
  // Input form state
  const [input, setInput] = useState<DPQuestionDesignerInput>(DEFAULT_DP_INPUT);

  // Generated module
  const [module, setModule] = useState<CurriculumModule | null>(SAMPLE_MODULE);
  const [expandedStage, setExpandedStage] = useState<Set<number>>(new Set([1]));

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawJson, setRawJson] = useState<string>("");

  // Template state
  const [templates, setTemplates] = useState<DPDesignerTemplate[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  // Editable module JSON
  const [editJson, setEditJson] = useState<string>("");
  const [showJsonEditor, setShowJsonEditor] = useState(false);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const updateInput = useCallback(
    (updates: Partial<DPQuestionDesignerInput>) => {
      setInput((prev) => ({ ...prev, ...updates }));
    },
    []
  );

  const applyPreset = useCallback(
    (presetKey: string) => {
      const families = FUNCTION_FAMILY_PRESETS[presetKey];
      if (!families) return;
      const [curriculum, level] = presetKey.split("_");
      updateInput({
        functionFamilies: families,
        stageCount: families.length,
        course: `IBDP Mathematics ${curriculum} ${level}`,
      });
    },
    [updateInput]
  );

  const generateWithDeepSeek = useCallback(async () => {
    setIsGenerating(true);
    setError(null);
    setRawJson("");

    try {
      const response = await fetch("/api/deepseek", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: buildDPSystemPrompt(),
          messages: [{ role: "user" as const, content: buildDPUserPrompt(input) }],
        }),
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? `DeepSeek request failed (${response.status})`);
      }

      const data = (await response.json()) as DeepSeekResponse;
      const rawText =
        data.choices?.[0]?.message?.content ?? "";

      if (!rawText) {
        throw new Error("DeepSeek returned empty response");
      }

      setRawJson(rawText);

      const jsonString = extractJsonObject(rawText);
      const parsed = JSON.parse(jsonString) as Record<string, unknown>;
      const sanitized = sanitizeCurriculumModule(parsed);
      setModule(sanitized);
      setEditJson(JSON.stringify(sanitized, null, 2));
      setExpandedStage(new Set([1]));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Generation failed"
      );
    } finally {
      setIsGenerating(false);
    }
  }, [input]);

  // ── Template management ──────────────────────────────────────────────────

  const loadTemplates = useCallback(async () => {
    setLoadingTemplates(true);
    try {
      const res = await fetch("/api/assignments/templates/dp");
      const data = (await res.json()) as {
        templates: DPDesignerTemplate[];
        error?: string;
      };
      if (data.error) {
        setError(data.error);
      } else {
        setTemplates(data.templates ?? []);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load templates"
      );
    } finally {
      setLoadingTemplates(false);
    }
  }, []);

  const saveAsTemplate = useCallback(async () => {
    if (!templateName.trim()) {
      setError("Please enter a template name");
      return;
    }

    setIsSavingTemplate(true);
    setError(null);

    const [curriculum, level] = input.course.includes("AA")
      ? input.course.includes("SL") ? ["AA", "SL"] : ["AA", "HL"]
      : input.course.includes("SL") ? ["AI", "SL"] : ["AI", "HL"];

    try {
      const res = await fetch("/api/assignments/templates/dp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateName: templateName.trim(),
          curriculum,
          level,
          input: input as unknown as Record<string, unknown>,
          module: module as unknown as Record<string, unknown> | null,
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to save template");
      }

      setTemplateName("");
      await loadTemplates();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Template save failed"
      );
    } finally {
      setIsSavingTemplate(false);
    }
  }, [templateName, input, module, loadTemplates]);

  const loadTemplate = useCallback(
    (template: DPDesignerTemplate) => {
      setInput(template.input);
      if (template.module) {
        setModule(template.module);
        setEditJson(JSON.stringify(template.module, null, 2));
      }
      setShowTemplates(false);
    },
    []
  );

  const deleteTemplate = useCallback(
    async (id: string) => {
      if (!confirm("Delete this template?")) return;
      try {
        const res = await fetch(
          `/api/assignments/templates/dp?id=${encodeURIComponent(id)}`,
          { method: "DELETE" }
        );
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          throw new Error(data.error ?? "Delete failed");
        }
        await loadTemplates();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Delete failed"
        );
      }
    },
    [loadTemplates]
  );

  const toggleExpand = useCallback((stageNum: number) => {
    setExpandedStage((prev) => {
      const next = new Set(prev);
      if (next.has(stageNum)) next.delete(stageNum);
      else next.add(stageNum);
      return next;
    });
  }, []);

  const applyJsonEdit = useCallback(() => {
    try {
      const parsed = JSON.parse(editJson) as Record<string, unknown>;
      const sanitized = sanitizeCurriculumModule(parsed);
      setModule(sanitized);
      setEditJson(JSON.stringify(sanitized, null, 2));
      setShowJsonEditor(false);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Invalid JSON"
      );
    }
  }, [editJson]);

  const copyModuleJson = useCallback(() => {
    if (!module) return;
    const json = JSON.stringify({ curriculum_module: module }, null, 2);
    void navigator.clipboard.writeText(json);
  }, [module]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-indigo-900">
            🎓 DP Question Designer
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Design IB DP curriculum modules powered by DeepSeek AI
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setShowTemplates(!showTemplates);
              if (!showTemplates && templates.length === 0) loadTemplates();
            }}
            className={btnSecondary}
          >
            📂 {showTemplates ? "Hide" : ""} Templates
          </button>
          <button
            type="button"
            onClick={() => {
              setEditJson(
                JSON.stringify(module ?? SAMPLE_MODULE, null, 2)
              );
              setShowJsonEditor(!showJsonEditor);
            }}
            className={btnSecondary}
          >
            📝 {showJsonEditor ? "Hide" : "Edit"} JSON
          </button>
          <button
            type="button"
            onClick={copyModuleJson}
            disabled={!module}
            className={btnSecondary}
          >
            📋 Copy JSON
          </button>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 flex items-start justify-between">
          <p className="text-sm text-red-800 font-medium">{error}</p>
          <button
            onClick={() => setError(null)}
            className="text-red-400 hover:text-red-700 ml-2 flex-shrink-0 font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* Templates panel */}
      {showTemplates && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-indigo-800">Saved Templates</h3>
            <button
              onClick={() => setShowTemplates(false)}
              className="text-indigo-400 hover:text-indigo-700 text-xs font-bold"
            >
              ✕
            </button>
          </div>

          {/* Save new template */}
          <div className="flex items-center gap-2 mb-3">
            <input
              type="text"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="Template name…"
              className={`${inputClass} flex-1`}
            />
            <button
              type="button"
              onClick={saveAsTemplate}
              disabled={isSavingTemplate || !templateName.trim()}
              className={btnPrimary}
            >
              {isSavingTemplate ? "Saving…" : "💾 Save"}
            </button>
          </div>

          {/* Template list */}
          {loadingTemplates && (
            <p className="text-xs text-gray-500">Loading…</p>
          )}
          {!loadingTemplates && templates.length === 0 && (
            <p className="text-xs text-gray-500">No saved templates yet.</p>
          )}
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {templates.map((tpl) => (
              <div
                key={tpl.id}
                className="flex items-center gap-2 rounded border border-gray-200 bg-white px-3 py-2 hover:border-indigo-300 cursor-pointer"
                onClick={() => loadTemplate(tpl)}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 truncate">
                    {tpl.template_name}
                  </p>
                  <p className="text-xs text-gray-500">
                    {tpl.curriculum} {tpl.level} ·{" "}
                    {tpl.module
                      ? `${tpl.module.stages.length} stages`
                      : "input only"}
                    {" · "}
                    {new Date(tpl.updated_at).toLocaleDateString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteTemplate(tpl.id);
                  }}
                  className={btnDanger}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* JSON Editor panel */}
      {showJsonEditor && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold text-amber-800">JSON Editor</h3>
            <button
              onClick={applyJsonEdit}
              className="rounded bg-amber-600 px-3 py-1 text-xs font-bold text-white hover:bg-amber-700"
            >
              Apply Changes
            </button>
          </div>
          <textarea
            value={editJson}
            onChange={(e) => setEditJson(e.target.value)}
            rows={20}
            className="w-full rounded border border-amber-300 bg-white p-3 text-xs font-mono text-gray-900"
            spellCheck={false}
          />
        </div>
      )}

      {/* Input Form */}
      <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-4">
        <h3 className="text-sm font-bold text-gray-900">Module Configuration</h3>

        {/* Course + Tone presets */}
        <div className="flex flex-wrap gap-2">
          <div className="flex items-center gap-1">
            <span className="text-xs font-semibold text-gray-500 mr-1">
              Quick preset:
            </span>
            {Object.keys(FUNCTION_FAMILY_PRESETS).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => applyPreset(key)}
                className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-semibold text-gray-600 hover:bg-indigo-50 hover:border-indigo-300"
              >
                {key.replace("_", " ")}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Title</label>
            <input
              type="text"
              value={input.title}
              onChange={(e) => updateInput({ title: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Course</label>
            <input
              type="text"
              value={input.course}
              onChange={(e) => updateInput({ course: e.target.value })}
              className={inputClass}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className={labelClass}>Target Grade</label>
            <select
              value={input.targetGradeLevel}
              onChange={(e) =>
                updateInput({ targetGradeLevel: parseInt(e.target.value) })
              }
              className={inputClass}
            >
              <option value={9}>Grade 9</option>
              <option value={10}>Grade 10</option>
              <option value={11}>Grade 11</option>
              <option value={12}>Grade 12</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Stages</label>
            <input
              type="number"
              min={1}
              max={10}
              value={input.stageCount}
              onChange={(e) =>
                updateInput({ stageCount: parseInt(e.target.value) || 5 })
              }
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Tone</label>
            <select
              value={input.tone}
              onChange={(e) =>
                updateInput({
                  tone: e.target.value as DPQuestionDesignerInput["tone"],
                })
              }
              className={inputClass}
            >
              <option value="rigorous">Rigorous</option>
              <option value="discovery">Discovery</option>
              <option value="exam-focused">Exam-focused</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Assessment Tracker</label>
            <input
              type="text"
              value={input.assessmentTracker}
              onChange={(e) =>
                updateInput({ assessmentTracker: e.target.value })
              }
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label className={labelClass}>Pedagogical Goal</label>
          <textarea
            value={input.pedagogicalGoal}
            onChange={(e) => updateInput({ pedagogicalGoal: e.target.value })}
            rows={2}
            className={inputClass}
          />
        </div>

        {/* Function families */}
        <div>
          <label className={labelClass}>
            Function Families (one per stage)
          </label>
          <div className="flex flex-wrap gap-1">
            {input.functionFamilies.map((fam, idx) => (
              <div
                key={idx}
                className="flex items-center gap-1 rounded border border-gray-300 bg-gray-50 px-2 py-1 text-xs"
              >
                <span className="text-gray-400 font-bold">{idx + 1}.</span>
                <input
                  type="text"
                  value={fam}
                  onChange={(e) => {
                    const next = [...input.functionFamilies];
                    next[idx] = e.target.value;
                    updateInput({ functionFamilies: next });
                  }}
                  className="bg-transparent text-gray-800 w-40 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    const next = input.functionFamilies.filter(
                      (_, i) => i !== idx
                    );
                    updateInput({
                      functionFamilies: next,
                      stageCount: next.length,
                    });
                  }}
                  className="text-gray-400 hover:text-red-600 font-bold"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                updateInput({
                  functionFamilies: [
                    ...input.functionFamilies,
                    "New Function Family",
                  ],
                  stageCount: input.functionFamilies.length + 1,
                })
              }
              className="rounded border border-dashed border-gray-300 px-2 py-1 text-xs text-gray-400 hover:text-indigo-600 hover:border-indigo-400"
            >
              + Add
            </button>
          </div>
        </div>

        {/* Toggles */}
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={input.includeTOKLinks}
              onChange={(e) =>
                updateInput({ includeTOKLinks: e.target.checked })
              }
              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            Include TOK links
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={input.includeExplorationActivities}
              onChange={(e) =>
                updateInput({ includeExplorationActivities: e.target.checked })
              }
              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            Include explorations
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={input.includeKeyProofs}
              onChange={(e) =>
                updateInput({ includeKeyProofs: e.target.checked })
              }
              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            Include key proofs
          </label>
        </div>

        {/* Generate button */}
        <button
          type="button"
          onClick={generateWithDeepSeek}
          disabled={isGenerating}
          className={`w-full ${btnPrimary} py-3 text-base`}
        >
          {isGenerating ? (
            <span className="flex items-center justify-center gap-2">
              <span className="animate-spin inline-block h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
              Generating with DeepSeek…
            </span>
          ) : (
            "🤖 Generate Module (DeepSeek)"
          )}
        </button>

        {/* Raw JSON display (debug) */}
        {rawJson && (
          <details className="mt-2">
            <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
              View raw API response
            </summary>
            <pre className="mt-1 max-h-40 overflow-auto rounded border border-gray-200 bg-gray-50 p-2 text-[10px] text-gray-600 whitespace-pre-wrap">
              {rawJson}
            </pre>
          </details>
        )}
      </div>

      {/* Generated module display */}
      {module && (
        <div className="space-y-3">
          {/* Module header */}
          <div className="rounded-lg border-2 border-indigo-300 bg-indigo-50 p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="rounded-full bg-indigo-600 text-white text-xs font-bold px-2 py-0.5">
                    {module.course}
                  </span>
                  <span className="text-xs text-gray-500">
                    Grade {module.target_grade_level}
                  </span>
                </div>
                <h3 className="text-lg font-bold text-indigo-900">
                  {module.title}
                </h3>
                {module.pedagogical_goal && (
                  <p className="text-sm text-indigo-700 mt-2 italic">
                    {module.pedagogical_goal}
                  </p>
                )}
              </div>
              <span className="text-xs font-semibold text-indigo-500 bg-indigo-100 rounded px-2 py-1 flex-shrink-0">
                {module.stages.length} stages · {module.assessment_tracker}
              </span>
            </div>
          </div>

          {/* Stages */}
          {module.stages.map((stage) => (
            <StageCard
              key={stage.stage_number}
              stage={stage}
              expanded={expandedStage.has(stage.stage_number)}
              onToggle={() => toggleExpand(stage.stage_number)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Stage Card Subcomponent ────────────────────────────────────────────────────

function StageCard({
  stage,
  expanded,
  onToggle,
}: {
  stage: CurriculumStage;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={`rounded-lg border transition-colors ${
        expanded
          ? "border-indigo-300 bg-white shadow-sm"
          : "border-gray-200 bg-white hover:border-indigo-200 cursor-pointer"
      }`}
      onClick={() => !expanded && onToggle()}
    >
      {/* Collapsed header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="flex items-center justify-center h-8 w-8 rounded-full bg-indigo-600 text-white text-sm font-bold flex-shrink-0">
          {stage.stage_number}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-bold text-gray-900">
              {stage.theme}
            </h4>
            <span className="text-xs text-indigo-500 font-medium bg-indigo-50 rounded px-1.5 py-0.5">
              {stage.function_family}
            </span>
          </div>
          {!expanded && (
            <p className="text-xs text-gray-500 mt-0.5 truncate">
              {stage.core_vocabulary.slice(0, 4).join(" · ")}
              {stage.core_vocabulary.length > 4 ? " …" : ""}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className="flex-shrink-0 text-gray-400 hover:text-indigo-600 font-bold text-lg leading-none px-1"
        >
          {expanded ? "−" : "+"}
        </button>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-100 pt-3">
          {/* Core Vocabulary */}
          {stage.core_vocabulary.length > 0 && (
            <div>
              <h5 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                Core Vocabulary
              </h5>
              <div className="flex flex-wrap gap-1">
                {stage.core_vocabulary.map((term, i) => (
                  <span
                    key={i}
                    className="rounded-full bg-gray-100 text-gray-700 text-xs px-2 py-0.5 font-medium"
                  >
                    {term}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Key Proofs */}
          {stage.key_proofs.length > 0 && (
            <div>
              <h5 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                Key Proofs
              </h5>
              <div className="space-y-2">
                {stage.key_proofs.map((proof, i) => (
                  <div
                    key={i}
                    className="rounded border border-gray-200 bg-gray-50 px-3 py-2"
                  >
                    <p className="text-sm font-semibold text-gray-800">
                      {proof.name}
                    </p>
                    <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">
                      {proof.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Exploration Activity */}
          {stage.exploration_activity && (
            <div>
              <h5 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                Exploration Activity
              </h5>
              <div className="rounded border border-indigo-200 bg-indigo-50 px-3 py-2 space-y-2">
                <p className="text-sm font-bold text-indigo-800">
                  {stage.exploration_activity.title}
                </p>
                <div>
                  <span className="text-xs font-bold text-indigo-600">
                    Setup:{" "}
                  </span>
                  <span className="text-xs text-indigo-800">
                    {stage.exploration_activity.setup}
                  </span>
                </div>
                <div>
                  <span className="text-xs font-bold text-indigo-600">
                    Task:{" "}
                  </span>
                  <span className="text-xs text-indigo-800">
                    {stage.exploration_activity.task}
                  </span>
                </div>
                <div>
                  <span className="text-xs font-bold text-indigo-600">
                    Rigor:{" "}
                  </span>
                  <span className="text-xs text-indigo-800">
                    {stage.exploration_activity.rigor}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* TOK Link */}
          {stage.tok_link && (
            <div>
              <h5 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                TOK Link
              </h5>
              <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-xs text-amber-900 italic leading-relaxed">
                  {stage.tok_link}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}