"use client";

import { useState } from "react";
import type { ReflectionItem, SelfScore } from "@/lib/reflection-types";

interface NativeFormProps {
  items: ReflectionItem[];
  onSubmit: (scores: SelfScore[]) => Promise<void>;
}

export function NativeForm({ items, onSubmit }: NativeFormProps) {
  const [scores, setScores] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const item of items) {
      init[item.test_item_id] = item.self_marks ?? 0;
    }
    return init;
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (testItemId: string, value: number, max: number) => {
    const clamped = Math.max(0, Math.min(value, max));
    setScores((prev) => ({ ...prev, [testItemId]: clamped }));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const selfScores: SelfScore[] = items.map((item) => ({
        test_item_id: item.test_item_id,
        self_marks: scores[item.test_item_id] ?? 0,
      }));
      await onSubmit(selfScores);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Self-Grade Your Answers</h3>
      <p className="text-sm text-gray-600">
        For each question, enter the marks you think you earned based on the
        mark scheme.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="px-3 py-2 text-left">Question</th>
              <th className="px-3 py-2 text-center">Max</th>
              <th className="px-3 py-2 text-center">Your Marks</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.test_item_id} className="border-b">
                <td className="px-3 py-2">
                  Q{item.question_number + 1}
                  {item.part_label ? ` (${item.part_label})` : ""}
                </td>
                <td className="px-3 py-2 text-center">{item.max_marks}</td>
                <td className="px-3 py-2 text-center">
                  <input
                    type="number"
                    min={0}
                    max={item.max_marks}
                    value={scores[item.test_item_id] ?? 0}
                    onChange={(e) =>
                      handleChange(
                        item.test_item_id,
                        parseInt(e.target.value) || 0,
                        item.max_marks
                      )
                    }
                    className="w-16 rounded border border-gray-300 px-2 py-1 text-center"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {submitting ? "Submitting…" : "Submit Self-Grades"}
      </button>
    </div>
  );
}
