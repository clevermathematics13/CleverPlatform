"use client";

import { useState } from "react";
import type { ReflectionItem, SelfScore } from "@/lib/reflection-types";
import { computeDisagreement } from "@/lib/reflection-utils";

interface ScoreTableProps {
  items: ReflectionItem[];
  editable: boolean;
  onSave?: (scores: SelfScore[]) => Promise<void>;
}

export function ScoreTable({ items, editable, onSave }: ScoreTableProps) {
  const [editedScores, setEditedScores] = useState<Record<string, number>>(
    () => {
      const init: Record<string, number> = {};
      for (const item of items) {
        init[item.test_item_id] = item.self_marks ?? 0;
      }
      return init;
    }
  );
  const [saving, setSaving] = useState(false);

  const totalTeacher = items.reduce(
    (sum, i) => sum + (i.marks_awarded ?? 0),
    0
  );
  const totalSelf = items.reduce(
    (sum, i) => sum + (editedScores[i.test_item_id] ?? i.self_marks ?? 0),
    0
  );
  const totalMax = items.reduce((sum, i) => sum + i.max_marks, 0);

  // Compute live disagreement from current edited scores
  const liveItems: ReflectionItem[] = items.map((item) => ({
    ...item,
    self_marks: editedScores[item.test_item_id] ?? item.self_marks,
  }));
  const disagreement = computeDisagreement(liveItems);

  const handleSave = async () => {
    if (!onSave) return;
    setSaving(true);
    try {
      const scores: SelfScore[] = items.map((item) => ({
        test_item_id: item.test_item_id,
        self_marks: editedScores[item.test_item_id] ?? item.self_marks ?? 0,
      }));
      await onSave(scores);
    } finally {
      setSaving(false);
    }
  };

  const getDiffClass = (teacher: number | null, self: number) => {
    if (teacher === null) return "";
    if (self === teacher) return "bg-green-900/20";
    if (self > teacher) return "bg-yellow-900/20";
    return "bg-red-900/20";
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-da-amber">Score Comparison</h3>

      {/* Disagreement banner */}
      {disagreement !== null && (
        <div
          className={`rounded-lg border px-4 py-3 font-semibold text-sm flex items-center gap-3 ${
            disagreement === 0
              ? "border-green-700 bg-green-900/25 text-green-300"
              : disagreement <= 10
                ? "border-yellow-700 bg-yellow-900/25 text-yellow-300"
                : "border-red-700 bg-red-900/25 text-red-300"
          }`}
        >
          <span className="text-lg">
            {disagreement === 0 ? "✅" : disagreement <= 10 ? "⚠️" : "🔴"}
          </span>
          <span>
            Judgement Disagreement:{" "}
            <strong>{disagreement.toFixed(1)}%</strong>
            {disagreement === 0
              ? " — ready to upload corrections"
              : ""}
          </span>
        </div>
      )}

      {disagreement === null && (
        <div className="rounded-lg border border-da-border/50 bg-da-surface px-4 py-3 text-sm text-da-muted">
          ⏳ Waiting for teacher marks — disagreement will appear once grading is complete.
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-base">
          <thead>
            <tr className="border-b border-da-border/40 bg-da-surface">
              <th className="px-3 py-2 text-left font-bold text-da-amber">Question</th>
              <th className="px-3 py-2 text-center font-bold text-da-amber">Max</th>
              <th className="px-3 py-2 text-center font-bold text-da-amber">Teacher</th>
              <th className="px-3 py-2 text-center font-bold text-da-amber">Self</th>
              <th className="px-3 py-2 text-center font-bold text-da-amber">Diff</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const self =
                editedScores[item.test_item_id] ?? item.self_marks ?? 0;
              const diff =
                item.marks_awarded !== null
                  ? self - item.marks_awarded
                  : null;
              return (
                <tr
                  key={item.test_item_id}
                  className={`border-b ${getDiffClass(item.marks_awarded, self)}`}
                >
                  <td className="px-3 py-2">
                    <span className="font-bold text-da-amber">{item.question_number}</span>
                    {item.part_label && (
                      <span className="font-bold text-da-muted">({item.part_label})</span>
                    )}
                    {item.subtopic_codes.length > 0 && (
                      <span className="ml-2 text-xs text-da-muted">[{item.subtopic_codes.join(", ")}]</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center font-bold text-da-text">{item.max_marks}</td>
                  <td className="px-3 py-2 text-center">
                    {item.marks_awarded ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {editable ? (
                      <input
                        type="number"
                        min={0}
                        max={item.max_marks}
                        value={self}
                        onChange={(e) => {
                          const val = Math.max(
                            0,
                            Math.min(
                              parseInt(e.target.value) || 0,
                              item.max_marks
                            )
                          );
                          setEditedScores((prev) => ({
                            ...prev,
                            [item.test_item_id]: val,
                          }));
                        }}
                        className="w-16 rounded border-2 border-da-border bg-da-surface px-2 py-1 text-center text-da-text font-bold focus:ring-2 focus:ring-da-accent focus:border-da-accent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    ) : (
                      self
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {diff !== null ? (
                      <span
                        className={
                          diff === 0
                            ? "text-green-400"
                            : diff > 0
                              ? "text-yellow-400"
                              : "text-red-400"
                        }
                      >
                        {diff > 0 ? `+${diff}` : diff}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-da-border/40 bg-da-surface font-bold text-da-amber">
              <td className="px-3 py-2">Total</td>
              <td className="px-3 py-2 text-center">{totalMax}</td>
              <td className="px-3 py-2 text-center">{totalTeacher}</td>
              <td className="px-3 py-2 text-center">{totalSelf}</td>
              <td className="px-3 py-2 text-center">
                {totalSelf - totalTeacher > 0
                  ? `+${totalSelf - totalTeacher}`
                  : totalSelf - totalTeacher}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {editable && onSave && (
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-da-accent px-4 py-2 text-sm font-bold text-da-bg hover:bg-da-amber disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save Changes"}
        </button>
      )}
    </div>
  );
}
