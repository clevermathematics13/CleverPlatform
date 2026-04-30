"use client";

import { useState } from "react";

interface OverrideModalProps {
  studentId: string;
  studentName: string;
  testId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function OverrideModal({
  studentId,
  studentName,
  testId,
  onClose,
  onSuccess,
}: OverrideModalProps) {
  const [password, setPassword] = useState("");
  const [scores, setScores] = useState<Record<string, number>>({});
  const [step, setStep] = useState<"auth" | "edit">("auth");
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<
    { test_item_id: string; question_number: number; part_label: string; max_marks: number; self_marks: number }[]
  >([]);

  const handleVerify = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/override/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, studentId, testId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Verification failed");
        return;
      }
      setToken(data.token);
      setItems(data.items ?? []);
      const initScores: Record<string, number> = {};
      for (const item of data.items ?? []) {
        initScores[item.test_item_id] = item.self_marks ?? 0;
      }
      setScores(initScores);
      setStep("edit");
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/override/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          studentId,
          testId,
          scores: items.map((item) => ({
            test_item_id: item.test_item_id,
            self_marks: scores[item.test_item_id] ?? 0,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Save failed");
        return;
      }
      onSuccess();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">
            Override Scores — {studentName}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        {step === "auth" && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Enter your teacher password to override this student&apos;s
              self-assessment scores.
            </p>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Teacher password"
              className="w-full rounded border border-gray-300 px-3 py-2"
              autoComplete="current-password"
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleVerify}
                disabled={loading || !password}
                className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? "Verifying…" : "Verify"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {step === "edit" && (
          <div className="space-y-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="px-3 py-2 text-left">Question</th>
                  <th className="px-3 py-2 text-center">Max</th>
                  <th className="px-3 py-2 text-center">Self Marks</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.test_item_id} className="border-b">
                    <td className="px-3 py-2">
                      Q{item.question_number}
                      {item.part_label ? ` (${item.part_label})` : ""}
                    </td>
                    <td className="px-3 py-2 text-center">{item.max_marks}</td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="number"
                        min={0}
                        max={item.max_marks}
                        value={scores[item.test_item_id] ?? 0}
                        onChange={(e) => {
                          const val = Math.max(
                            0,
                            Math.min(
                              parseInt(e.target.value) || 0,
                              item.max_marks
                            )
                          );
                          setScores((prev) => ({
                            ...prev,
                            [item.test_item_id]: val,
                          }));
                        }}
                        className="w-16 rounded border border-gray-300 px-2 py-1 text-center"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={loading}
                className="rounded bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-50"
              >
                {loading ? "Saving…" : "Save Override"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
