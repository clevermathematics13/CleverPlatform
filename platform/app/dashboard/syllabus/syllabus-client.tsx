"use client";

import { useState, useEffect, useCallback } from "react";

interface Course {
  id: string;
  name: string;
}

interface Subtopic {
  code: string;
  descriptor: string;
  section: number;
  parent_code: string | null;
}

interface SubtopicWithCoverage extends Subtopic {
  covered: boolean;
}

const SECTION_NAMES: Record<number, string> = {
  1: "Number & Algebra",
  2: "Functions",
  3: "Geometry & Trigonometry",
  4: "Statistics & Probability",
  5: "Calculus",
};

const SECTION_COLORS: Record<number, { bg: string; border: string; header: string; check: string }> = {
  1: { bg: "bg-blue-50", border: "border-blue-200", header: "bg-blue-100 text-blue-900", check: "accent-blue-600" },
  2: { bg: "bg-purple-50", border: "border-purple-200", header: "bg-purple-100 text-purple-900", check: "accent-purple-600" },
  3: { bg: "bg-green-50", border: "border-green-200", header: "bg-green-100 text-green-900", check: "accent-green-600" },
  4: { bg: "bg-orange-50", border: "border-orange-200", header: "bg-orange-100 text-orange-900", check: "accent-orange-600" },
  5: { bg: "bg-red-50", border: "border-red-200", header: "bg-red-100 text-red-900", check: "accent-red-600" },
};

// Detect AH courses (class name contains "AH")
function isAHCourse(name: string) {
  return name.toUpperCase().includes("AH");
}

export function SyllabusClient({
  courses,
  subtopics,
}: {
  courses: Course[];
  subtopics: Subtopic[];
}) {
  const ahCourses = courses.filter((c) => isAHCourse(c.name));
  const otherCourses = courses.filter((c) => !isAHCourse(c.name));

  // Prefer 27AH if present, else first AH, else first course
  const default27AH = courses.find((c) => c.name.toUpperCase().includes("27AH"));
  const [selectedCourseId, setSelectedCourseId] = useState<string>(
    default27AH?.id ?? ahCourses[0]?.id ?? courses[0]?.id ?? ""
  );
  const [coverage, setCoverage] = useState<Record<string, boolean>>({});
  const [loadingCoverage, setLoadingCoverage] = useState(false);
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Set<number>>(new Set());

  const toggleSection = (sectionNum: number) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionNum)) next.delete(sectionNum);
      else next.add(sectionNum);
      return next;
    });
  };

  const selectedCourse = courses.find((c) => c.id === selectedCourseId);
  const isAH = selectedCourse ? isAHCourse(selectedCourse.name) : false;

  const loadCoverage = useCallback(async (courseId: string) => {
    setLoadingCoverage(true);
    setError(null);
    try {
      const res = await fetch(`/api/syllabus?courseId=${courseId}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        return;
      }
      const map: Record<string, boolean> = {};
      for (const s of data.subtopics ?? []) {
        map[s.code] = s.covered;
      }
      setCoverage(map);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load coverage");
    } finally {
      setLoadingCoverage(false);
    }
  }, []);

  useEffect(() => {
    if (selectedCourseId) loadCoverage(selectedCourseId);
  }, [selectedCourseId, loadCoverage]);

  const toggleCoverage = async (subtopicCode: string) => {
    if (!selectedCourseId) return;
    const newCovered = !coverage[subtopicCode];

    // Optimistic update
    setCoverage((prev) => ({ ...prev, [subtopicCode]: newCovered }));
    setSaving((prev) => new Set(prev).add(subtopicCode));

    try {
      const res = await fetch("/api/syllabus", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId: selectedCourseId,
          subtopicCode,
          covered: newCovered,
        }),
      });
      const data = await res.json();
      if (data.error) {
        // Revert
        setCoverage((prev) => ({ ...prev, [subtopicCode]: !newCovered }));
        setError(data.error);
      }
    } catch {
      setCoverage((prev) => ({ ...prev, [subtopicCode]: !newCovered }));
      setError("Failed to save");
    } finally {
      setSaving((prev) => {
        const next = new Set(prev);
        next.delete(subtopicCode);
        return next;
      });
    }
  };

  const markSection = async (sectionNum: number, covered: boolean) => {
    if (!selectedCourseId) return;
    const sectionSubtopics = subtopics.filter((s) => s.section === sectionNum);
    // Optimistic
    const update: Record<string, boolean> = {};
    for (const s of sectionSubtopics) update[s.code] = covered;
    setCoverage((prev) => ({ ...prev, ...update }));

    // Save all sequentially (don't spam with parallel requests)
    for (const s of sectionSubtopics) {
      setSaving((prev) => new Set(prev).add(s.code));
      try {
        await fetch("/api/syllabus", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            courseId: selectedCourseId,
            subtopicCode: s.code,
            covered,
          }),
        });
      } finally {
        setSaving((prev) => {
          const next = new Set(prev);
          next.delete(s.code);
          return next;
        });
      }
    }
  };

  // Natural sort for subtopic codes: split on non-numeric runs so
  // "2.10" > "2.9" rather than "2.10" < "2.2" (lexicographic).
  const sortSubtopics = (a: Subtopic, b: Subtopic) =>
    a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: "base" });

  // Group subtopics by section number (sorted naturally within each section)
  const bySection = subtopics.reduce<Record<number, Subtopic[]>>((acc, s) => {
    if (!acc[s.section]) acc[s.section] = [];
    acc[s.section].push(s);
    return acc;
  }, {});
  for (const subs of Object.values(bySection)) subs.sort(sortSubtopics);

  // Compute progress per section
  const sectionProgress = (sectionNum: number) => {
    const subs = bySection[sectionNum] ?? [];
    const done = subs.filter((s) => coverage[s.code]).length;
    return { done, total: subs.length };
  };

  const totalProgress = () => {
    const done = subtopics.filter((s) => coverage[s.code]).length;
    return { done, total: subtopics.length };
  };

  const tp = totalProgress();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold text-blue-900 drop-shadow-sm">Syllabus Coverage</h1>
        <p className="mt-1 text-base font-medium text-blue-700">
          Track which IB AAHL subtopics have been taught for each class.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 space-y-2">
          <p className="font-semibold">{error}</p>
          {error.includes("schema cache") && (
            <div className="text-xs space-y-1">
              <p>The <code className="bg-red-100 px-1 rounded">syllabus_coverage</code> table is missing from your Supabase database. Run this in the <strong>Supabase SQL Editor</strong>:</p>
              <pre className="mt-1 bg-red-100 rounded p-2 text-xs overflow-x-auto whitespace-pre-wrap select-all">{`CREATE TABLE IF NOT EXISTS public.syllabus_coverage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  subtopic_code TEXT NOT NULL REFERENCES public.subtopics(code) ON DELETE CASCADE,
  covered BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (course_id, subtopic_code)
);
ALTER TABLE public.syllabus_coverage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers can manage syllabus coverage"
  ON public.syllabus_coverage FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'teacher'));
CREATE POLICY "Students can view syllabus coverage"
  ON public.syllabus_coverage FOR SELECT USING (true);
NOTIFY pgrst, 'reload schema';`}</pre>
            </div>
          )}
        </div>
      )}

      {/* Class selector tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {ahCourses.length > 0 && (
          <>
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wide mr-1">AH Classes:</span>
            {ahCourses.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedCourseId(c.id)}
                className={`rounded-full px-4 py-1.5 text-sm font-bold border-2 transition-colors ${
                  selectedCourseId === c.id
                    ? "bg-indigo-600 border-indigo-600 text-white"
                    : "border-indigo-300 text-indigo-700 bg-white hover:bg-indigo-50"
                }`}
              >
                {c.name}
              </button>
            ))}
          </>
        )}
        {otherCourses.length > 0 && (
          <>
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wide ml-3 mr-1">Other:</span>
            {otherCourses.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedCourseId(c.id)}
                disabled
                title="AAHL syllabus not yet set up for this class"
                className="rounded-full px-4 py-1.5 text-sm font-bold border-2 border-gray-200 text-gray-400 bg-gray-50 cursor-not-allowed opacity-60"
              >
                {c.name}
              </button>
            ))}
          </>
        )}
      </div>

      {!isAH && selectedCourse && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Syllabus coverage for <strong>{selectedCourse.name}</strong> has not been set up yet. Only AAHL (AH) classes are supported at this time.
        </div>
      )}

      {isAH && selectedCourse && (
        <>
          {/* Overall progress bar */}
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-5 py-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-bold text-indigo-900">
                {selectedCourse.name} — Overall Progress
              </span>
              <span className="text-sm font-semibold text-indigo-700">
                {tp.done} / {tp.total} subtopics covered
              </span>
            </div>
            <div className="h-3 rounded-full bg-indigo-200 overflow-hidden">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all duration-300"
                style={{ width: tp.total ? `${(tp.done / tp.total) * 100}%` : "0%" }}
              />
            </div>
          </div>

          {loadingCoverage ? (
            <div className="py-12 text-center text-gray-500 font-medium">Loading coverage…</div>
          ) : (
            <div className="space-y-4">
              {[1, 2, 3, 4, 5].map((sectionNum) => {
                const subs = bySection[sectionNum] ?? [];
                if (subs.length === 0) return null;
                const prog = sectionProgress(sectionNum);
                const colors = SECTION_COLORS[sectionNum];
                const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;

                // Separate parent-level and child-level subtopics for cleaner display
                const topLevel = subs.filter((s) => !s.parent_code);
                const children = subs.filter((s) => s.parent_code);

                return (
                  <div
                    key={sectionNum}
                    className={`rounded-xl border-2 ${colors.border} ${colors.bg} overflow-hidden`}
                  >
                    {/* Section header */}
                    <div className={`flex items-center justify-between px-5 py-3 ${colors.header}`}>
                      <button
                        type="button"
                        onClick={() => toggleSection(sectionNum)}
                        className="flex items-center gap-3 flex-1 min-w-0 text-left hover:opacity-80 transition-opacity"
                      >
                        <span className="text-sm opacity-60 flex-shrink-0">
                          {collapsedSections.has(sectionNum) ? "▶" : "▼"}
                        </span>
                        <span className="text-base font-extrabold">
                          {sectionNum}. {SECTION_NAMES[sectionNum]}
                        </span>
                        <span className="text-xs font-semibold opacity-70">
                          {prog.done}/{prog.total} · {pct}%
                        </span>
                      </button>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => markSection(sectionNum, true)}
                          className="rounded px-2 py-0.5 text-xs font-bold bg-white bg-opacity-60 hover:bg-opacity-100 border border-current transition-colors"
                        >
                          ✓ All
                        </button>
                        <button
                          type="button"
                          onClick={() => markSection(sectionNum, false)}
                          className="rounded px-2 py-0.5 text-xs font-bold bg-white bg-opacity-40 hover:bg-opacity-80 border border-current transition-colors"
                        >
                          ✕ None
                        </button>
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div className="h-1.5 bg-white bg-opacity-40">
                      <div
                        className="h-full bg-current opacity-40 transition-all duration-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>

                    {/* Subtopic rows */}
                    {!collapsedSections.has(sectionNum) && <div className="divide-y divide-white divide-opacity-60">
                      {topLevel.map((sub) => {
                        const isCovered = !!coverage[sub.code];
                        const isSaving = saving.has(sub.code);
                        const subChildren = children.filter((c) => c.parent_code === sub.code);

                        return (
                          <div key={sub.code}>
                            {/* Parent subtopic row */}
                            <label
                              className={`flex items-start gap-3 px-5 py-2.5 cursor-pointer hover:bg-white hover:bg-opacity-40 transition-colors ${
                                isCovered ? "opacity-100" : "opacity-80"
                              }`}
                            >
                              <div className="flex items-center mt-0.5">
                                <input
                                  type="checkbox"
                                  checked={isCovered}
                                  disabled={isSaving}
                                  onChange={() => toggleCoverage(sub.code)}
                                  className={`h-4 w-4 rounded border-gray-300 ${colors.check} disabled:opacity-50`}
                                />
                              </div>
                              <div className="flex-1 min-w-0">
                                <span className="text-sm font-bold text-gray-800">
                                  {sub.code}
                                </span>
                                <span className="text-sm text-gray-700 ml-2">
                                  {sub.descriptor}
                                </span>
                                {isSaving && (
                                  <span className="ml-2 text-xs text-gray-400 italic">saving…</span>
                                )}
                              </div>
                              {isCovered && (
                                <span className="text-green-600 text-sm font-bold flex-shrink-0">✓</span>
                              )}
                            </label>

                            {/* Child subtopics (indented) */}
                            {subChildren.map((child) => {
                              const childCovered = !!coverage[child.code];
                              const childSaving = saving.has(child.code);
                              return (
                                <label
                                  key={child.code}
                                  className={`flex items-start gap-3 px-5 py-2 pl-12 cursor-pointer hover:bg-white hover:bg-opacity-40 transition-colors border-t border-white border-opacity-40 ${
                                    childCovered ? "opacity-100" : "opacity-65"
                                  }`}
                                >
                                  <div className="flex items-center mt-0.5">
                                    <input
                                      type="checkbox"
                                      checked={childCovered}
                                      disabled={childSaving}
                                      onChange={() => toggleCoverage(child.code)}
                                      className={`h-3.5 w-3.5 rounded border-gray-300 ${colors.check} disabled:opacity-50`}
                                    />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <span className="text-xs font-bold text-gray-600">
                                      {child.code}
                                    </span>
                                    <span className="text-xs text-gray-600 ml-2">
                                      {child.descriptor}
                                    </span>
                                    {childSaving && (
                                      <span className="ml-2 text-xs text-gray-400 italic">saving…</span>
                                    )}
                                  </div>
                                  {childCovered && (
                                    <span className="text-green-500 text-xs font-bold flex-shrink-0">✓</span>
                                  )}
                                </label>
                              );
                            })}
                          </div>
                        );
                      })}

                      {/* Standalone child subtopics (parent not in top-level) */}
                      {children
                        .filter((c) => !topLevel.some((t) => t.code === c.parent_code))
                        .map((sub) => {
                          const isCovered = !!coverage[sub.code];
                          const isSaving = saving.has(sub.code);
                          return (
                            <label
                              key={sub.code}
                              className={`flex items-start gap-3 px-5 py-2.5 cursor-pointer hover:bg-white hover:bg-opacity-40 transition-colors ${
                                isCovered ? "opacity-100" : "opacity-80"
                              }`}
                            >
                              <div className="flex items-center mt-0.5">
                                <input
                                  type="checkbox"
                                  checked={isCovered}
                                  disabled={isSaving}
                                  onChange={() => toggleCoverage(sub.code)}
                                  className={`h-4 w-4 rounded border-gray-300 ${colors.check} disabled:opacity-50`}
                                />
                              </div>
                              <div className="flex-1 min-w-0">
                                <span className="text-sm font-bold text-gray-800">
                                  {sub.code}
                                </span>
                                <span className="text-sm text-gray-700 ml-2">
                                  {sub.descriptor}
                                </span>
                                {isSaving && (
                                  <span className="ml-2 text-xs text-gray-400 italic">saving…</span>
                                )}
                              </div>
                              {isCovered && (
                                <span className="text-green-600 text-sm font-bold flex-shrink-0">✓</span>
                              )}
                            </label>
                          );
                        })}
                    </div>}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
