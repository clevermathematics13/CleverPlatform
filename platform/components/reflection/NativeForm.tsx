"use client";

import { useState, useRef } from "react";
import type { ReflectionItem, SelfScore } from "@/lib/reflection-types";

interface NativeFormProps {
  items: ReflectionItem[];
  onSubmit: (scores: SelfScore[]) => Promise<void>;
  paperUrl?: string | null;
  markSchemeUrl?: string | null;
  onOpenDoc?: (title: string, url: string) => void;
}

export function NativeForm({ items, onSubmit, paperUrl, markSchemeUrl, onOpenDoc }: NativeFormProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
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
      <h3 className="text-lg font-bold text-da-amber">Self-Grade Your Answers</h3>

      {/* Exam paper / mark scheme links */}
      {(paperUrl || markSchemeUrl) && (
        <div className="flex flex-wrap gap-2">
          {paperUrl && (
            <button
              type="button"
              onClick={() => onOpenDoc ? onOpenDoc("Exam Paper", paperUrl) : window.open(paperUrl, "_blank")}
              className="flex items-center gap-1.5 rounded-lg border border-da-border bg-da-surface px-3 py-1.5 text-sm font-medium text-da-text hover:bg-da-hover transition-colors"
            >
              📄 Exam Paper
            </button>
          )}
          {markSchemeUrl && (
            <button
              type="button"
              onClick={() => onOpenDoc ? onOpenDoc("Mark Scheme", markSchemeUrl) : window.open(markSchemeUrl, "_blank")}
              className="flex items-center gap-1.5 rounded-lg border border-da-border bg-da-surface px-3 py-1.5 text-sm font-medium text-da-text hover:bg-da-hover transition-colors"
            >
              📝 Mark Scheme
            </button>
          )}
        </div>
      )}

      <p className="text-base text-da-text">
        For each question, enter the marks you think you earned based on the
        mark scheme.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-base">
          <thead>
            <tr className="border-b border-da-border/40 bg-da-surface">
              <th className="px-3 py-2 text-left font-bold text-da-amber">Question</th>
              <th className="px-3 py-2 text-center font-bold text-da-amber">Max</th>
              <th className="px-3 py-2 text-center font-bold text-da-amber">Your Marks</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.test_item_id} className="border-b border-da-border/25">
                <td className="px-3 py-2">
                  <span className="font-bold text-da-amber">Q{item.question_number}</span>
                  {item.part_label && (
                    <span className="ml-1 font-bold text-da-muted">({item.part_label})</span>
                  )}
                </td>
                <td className="px-3 py-2 text-center font-bold text-da-text">{item.max_marks}</td>
                <td className="px-3 py-2 text-center">
                  <input
                    ref={(el) => { inputRefs.current[items.indexOf(item)] = el; }}
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
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const idx = items.indexOf(item);
                        const next = inputRefs.current[idx + 1];
                        if (next) next.focus();
                      }
                    }}
                    className="w-16 rounded border-2 border-da-border bg-da-surface px-2 py-1 text-center text-da-text font-bold focus:ring-2 focus:ring-da-accent focus:border-da-accent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && (
        <p className="text-sm text-red-400">{error}</p>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting}
        className="rounded-lg bg-da-accent px-4 py-2 text-sm font-bold text-da-bg hover:bg-da-amber disabled:opacity-50"
      >
        {submitting ? "Submitting…" : "Submit Self-Grades"}
      </button>
    </div>
  );
}
