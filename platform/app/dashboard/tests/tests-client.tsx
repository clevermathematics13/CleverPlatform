"use client";

import { useState } from "react";
import type { TestRow } from "./page";
import { ImportFromPpqModal } from "./import-from-ppq-modal";

interface Course {
  id: string;
  name: string;
}

interface TestsClientProps {
  initialTests: TestRow[];
  courses: Course[];
}

interface ItemDraft {
  question_number: number | "";
  part_label: string;
  max_marks: number | "";
  sort_order: number | "";
}

const emptyItem = (): ItemDraft => ({
  question_number: "",
  part_label: "",
  max_marks: "",
  sort_order: "",
});

export function TestsClient({ initialTests, courses }: TestsClientProps) {
  const [tests, setTests] = useState<TestRow[]>(initialTests);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Create form state
  const [name, setName] = useState("");
  const [courseId, setCourseId] = useState(courses[0]?.id ?? "");
  const [testDate, setTestDate] = useState("");
  const [testTime, setTestTime] = useState("");
  const [paperUrl, setPaperUrl] = useState("");
  const [markSchemeUrl, setMarkSchemeUrl] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([emptyItem()]);

  // Expand/collapse test items
  const [expanded, setExpanded] = useState<string | null>(null);

  // Deleting
  const [deleting, setDeleting] = useState<string | null>(null);
  const [updatingVisibility, setUpdatingVisibility] = useState<string | null>(null);

  const formattedExamTime = (value: string | null) => {
    if (!value) return null;
    return value.slice(0, 5);
  };

  const addItem = () => setItems((prev) => [...prev, emptyItem()]);
  const removeItem = (i: number) =>
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  const updateItem = (i: number, patch: Partial<ItemDraft>) =>
    setItems((prev) => prev.map((item, idx) => (idx === i ? { ...item, ...patch } : item)));

  const fetchAndPrependTest = async (testId: string) => {
    const detailRes = await fetch(`/api/tests/${testId}`);
    const detail = await detailRes.json();
    if (detailRes.ok) {
      setTests((prev) => [{ ...detail, hidden: detail.hidden ?? false } as TestRow, ...prev]);
    }
  };

  const handleCreate = async () => {
    if (!name.trim() || !courseId) {
      setCreateError("Name and class are required.");
      return;
    }
    if (items.some((it) => it.question_number === "" || it.max_marks === "")) {
      setCreateError("Fill in Question # and Max Marks for all rows.");
      return;
    }

    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/tests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          course_id: courseId,
          test_date: testDate || null,
          exam_time: testTime || null,
          release_at:
            testDate && testTime
              ? new Date(new Date(`${testDate}T${testTime}:00`).getTime() + 80 * 60 * 1000).toISOString()
              : null,
          paper_url: paperUrl.trim() || null,
          mark_scheme_url: markSchemeUrl.trim() || null,
          items: items.map((it, i) => ({
            question_number: Number(it.question_number),
            part_label: it.part_label || "",
            max_marks: Number(it.max_marks),
            sort_order: it.sort_order !== "" ? Number(it.sort_order) : i,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create test");
      const createdId = data?.id as string | undefined;
      if (createdId) await fetchAndPrependTest(createdId);
      setShowCreate(false);
      setName("");
      setTestDate("");
      setTestTime("");
      setPaperUrl("");
      setMarkSchemeUrl("");
      setItems([emptyItem()]);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Error");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (testId: string) => {
    if (!confirm("Archive this exam and remove it from active tests?")) return;
    setDeleting(testId);
    try {
      const res = await fetch(`/api/tests/${testId}`, { method: "DELETE" });
      if (res.ok) setTests((prev) => prev.filter((t) => t.id !== testId));
    } finally {
      setDeleting(null);
    }
  };

  const handleToggleHidden = async (testId: string, hidden: boolean) => {
    setUpdatingVisibility(testId);
    try {
      const res = await fetch(`/api/tests/${testId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden }),
      });
      if (!res.ok) return;
      setTests((prev) => prev.map((t) => (t.id === testId ? { ...t, hidden } : t)));
    } finally {
      setUpdatingVisibility(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Create / Import buttons */}
      {!showCreate && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            + Create Test
          </button>
          <button
            type="button"
            onClick={() => setShowImport(true)}
            className="rounded-lg border border-purple-400/40 bg-purple-500/15 px-4 py-2 text-sm font-medium text-purple-300 hover:bg-purple-500/25"
          >
            Import from PPQ Bank
          </button>
        </div>
      )}

      {showImport && (
        <ImportFromPpqModal
          onClose={() => setShowImport(false)}
          onImported={async (testId) => {
            await fetchAndPrependTest(testId);
            setShowImport(false);
          }}
        />
      )}

      {/* Create form */}
      {showCreate && (
        <div className="rounded-xl border-2 border-blue-400/40 bg-blue-500/15 p-5 space-y-4">
          <h2 className="font-bold text-blue-300 text-lg">New Test</h2>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-da-muted uppercase">Test Name *</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Paper 1 November 2024"
                className="rounded border border-da-border px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-400"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-da-muted uppercase">Class *</span>
              <select
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
                className="rounded border border-da-border px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-400"
              >
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-da-muted uppercase">Date</span>
              <input
                type="date"
                value={testDate}
                onChange={(e) => setTestDate(e.target.value)}
                className="rounded border border-da-border px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-400"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-da-muted uppercase">Exam Time</span>
              <input
                type="time"
                value={testTime}
                onChange={(e) => setTestTime(e.target.value)}
                className="rounded border border-da-border px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-400"
              />
            </label>
          </div>

          {/* Document URLs */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-da-muted uppercase">Exam Paper URL</span>
              <input
                type="url"
                value={paperUrl}
                onChange={(e) => setPaperUrl(e.target.value)}
                placeholder="https://drive.google.com/file/d/…/view"
                className="rounded border border-da-border px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-400"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-da-muted uppercase">Mark Scheme URL</span>
              <input
                type="url"
                value={markSchemeUrl}
                onChange={(e) => setMarkSchemeUrl(e.target.value)}
                placeholder="https://drive.google.com/file/d/…/view"
                className="rounded border border-da-border px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-400"
              />
            </label>
          </div>

          {/* Items table */}
          <div className="space-y-2">
            <h3 className="font-semibold text-blue-300 text-sm">Questions</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-blue-500/15 text-blue-300 text-left">
                  <th className="px-2 py-1 rounded-tl font-semibold">Q #</th>
                  <th className="px-2 py-1 font-semibold">Part</th>
                  <th className="px-2 py-1 font-semibold">Max</th>
                  <th className="px-2 py-1 rounded-tr font-semibold">Sort</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i} className="border-b">
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        min={1}
                        value={item.question_number}
                        onChange={(e) =>
                          updateItem(i, {
                            question_number: e.target.value === "" ? "" : Number(e.target.value),
                          })
                        }
                        placeholder="#"
                        className="w-14 rounded border border-da-border px-2 py-1 text-sm focus:ring-2 focus:ring-blue-400"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        value={item.part_label}
                        onChange={(e) => updateItem(i, { part_label: e.target.value })}
                        placeholder="a"
                        className="w-14 rounded border border-da-border px-2 py-1 text-sm focus:ring-2 focus:ring-blue-400"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        min={1}
                        value={item.max_marks}
                        onChange={(e) =>
                          updateItem(i, {
                            max_marks: e.target.value === "" ? "" : Number(e.target.value),
                          })
                        }
                        placeholder="6"
                        className="w-14 rounded border border-da-border px-2 py-1 text-sm focus:ring-2 focus:ring-blue-400"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        value={item.sort_order}
                        onChange={(e) =>
                          updateItem(i, {
                            sort_order: e.target.value === "" ? "" : Number(e.target.value),
                          })
                        }
                        placeholder={String(i)}
                        className="w-14 rounded border border-da-border px-2 py-1 text-sm focus:ring-2 focus:ring-blue-400"
                      />
                    </td>
                    <td className="px-1 py-1 text-center">
                      <button
                        type="button"
                        onClick={() => removeItem(i)}
                        className="text-red-400 hover:text-red-200 text-lg leading-none"
                        title="Remove row"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              type="button"
              onClick={addItem}
              className="text-sm text-blue-300 hover:underline"
            >
              + Add question
            </button>
          </div>

          {createError && <p className="text-sm text-red-300">{createError}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {creating ? "Creating…" : "Create Test"}
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="rounded-lg border border-da-border px-4 py-2 text-sm text-da-muted hover:bg-da-hover"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Test list */}
      {tests.length === 0 && !showCreate && (
        <p className="text-sm text-da-muted">
          No tests yet. Create your first test above.
        </p>
      )}

      <div className="space-y-3">
        {tests.map((test) => {
          const isExpanded = expanded === test.id;
          const isDeleting = deleting === test.id;
          const totalMax = test.test_items.reduce(
            (sum, it) => sum + it.max_marks,
            0
          );
          return (
            <div
              key={test.id}
              className="rounded-xl border border-da-border bg-da-surface shadow-sm"
            >
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-bold text-da-text">{test.name}</p>
                  <p className="text-xs text-da-muted">
                    {test.courses?.name ?? "—"}
                    {test.test_date && ` · ${test.test_date}`}
                    {formattedExamTime(test.exam_time) && ` ${formattedExamTime(test.exam_time)}`}
                    {` · ${test.test_items.length} questions · ${totalMax} marks`}
                  </p>
                  <label className="mt-1 inline-flex items-center gap-2 text-xs text-da-muted">
                    <input
                      type="checkbox"
                      checked={test.hidden}
                      disabled={updatingVisibility === test.id}
                      onChange={(e) => handleToggleHidden(test.id, e.target.checked)}
                    />
                    Hide this exam from student reflection dropdown
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={`/dashboard/reflection?testId=${test.id}`}
                    className="rounded border border-blue-400/40 bg-blue-500/15 px-3 py-1 text-xs text-blue-300 hover:bg-blue-500/25"
                  >
                    Enter Marks →
                  </a>
                  <a
                    href={`/dashboard/tests/${test.id}/ai-grade`}
                    className="rounded border border-purple-400/40 bg-purple-500/15 px-3 py-1 text-xs text-purple-300 hover:bg-purple-500/25"
                  >
                    Mark Scans →
                  </a>
                  <button
                    type="button"
                    onClick={() =>
                      setExpanded(isExpanded ? null : test.id)
                    }
                    className="rounded border border-da-border px-3 py-1 text-xs text-da-muted hover:bg-da-hover"
                  >
                    {isExpanded ? "▲ Hide" : "▼ Questions"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(test.id)}
                    disabled={isDeleting}
                    className="rounded border border-red-400/40 px-3 py-1 text-xs text-red-300 hover:bg-red-500/25 disabled:opacity-50"
                  >
                    {isDeleting ? "…" : "Archive"}
                  </button>
                </div>
              </div>

              {isExpanded && test.test_items.length > 0 && (
                <div className="border-t px-4 py-3">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-da-muted border-b">
                        <th className="pb-1 font-semibold">Question</th>
                        <th className="pb-1 font-semibold">Part</th>
                        <th className="pb-1 font-semibold">Max Marks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...test.test_items]
                        .sort(
                          (a, b) =>
                            (a.sort_order ?? a.question_number) -
                            (b.sort_order ?? b.question_number)
                        )
                        .map((it) => (
                          <tr key={it.id} className="border-b last:border-0">
                            <td className="py-1">Q{it.question_number}</td>
                            <td className="py-1">{it.part_label || "—"}</td>
                            <td className="py-1">{it.max_marks}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
