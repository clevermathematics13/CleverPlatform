"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import type {
  ReflectionTest,
  ReflectionItem,
  ReflectionStep,
  SelfScore,
  PdfUpload,
} from "@/lib/reflection-types";
import { StepTracker } from "@/components/reflection/StepTracker";
import { HowItWorks } from "@/components/reflection/HowItWorks";
import { NativeForm } from "@/components/reflection/NativeForm";
import { ScoreTable } from "@/components/reflection/ScoreTable";
import { UploadSection } from "@/components/reflection/UploadSection";
import { TeacherDashboard } from "@/components/reflection/TeacherDashboard";
import { createClient } from "@/lib/supabase/client";

interface ReflectionClientProps {
  profile: { id: string; role: string; display_name: string };
  tests: ReflectionTest[];
  selectedTestId: string | null;
  initialItems: ReflectionItem[] | null;
  initialUpload: PdfUpload | null;
  isTeacher: boolean;
}

export function ReflectionClient({
  profile,
  tests,
  selectedTestId,
  initialItems,
  initialUpload,
  isTeacher,
}: ReflectionClientProps) {
  const router = useRouter();
  const [items, setItems] = useState<ReflectionItem[]>(initialItems ?? []);
  const hasSelfScores = items.some((i) => i.self_marks !== null);
  const hasTeacherMarks = items.some((i) => i.marks_awarded !== null);

  const getInitialStep = (): ReflectionStep => {
    if (initialUpload) return 4;
    if (hasSelfScores && hasTeacherMarks) return 3;
    if (hasSelfScores) return 2;
    return 1;
  };

  const [step, setStep] = useState<ReflectionStep>(getInitialStep);

  const handleTestChange = (testId: string) => {
    router.push(`/dashboard/reflection?testId=${testId}`);
  };

  const handleSubmitSelfGrades = useCallback(
    async (scores: SelfScore[]) => {
      const supabase = createClient();
      for (const score of scores) {
        await supabase.from("student_self_scores").upsert(
          {
            test_item_id: score.test_item_id,
            student_id: profile.id,
            self_marks: score.self_marks,
            submitted_at: new Date().toISOString(),
          },
          { onConflict: "test_item_id,student_id" }
        );
      }
      // Update local state
      setItems((prev) =>
        prev.map((item) => {
          const score = scores.find(
            (s) => s.test_item_id === item.test_item_id
          );
          return score ? { ...item, self_marks: score.self_marks } : item;
        })
      );
      setStep(2);
    },
    [profile.id]
  );

  const handleSaveComparison = useCallback(
    async (scores: SelfScore[]) => {
      const supabase = createClient();
      for (const score of scores) {
        await supabase.from("student_self_scores").upsert(
          {
            test_item_id: score.test_item_id,
            student_id: profile.id,
            self_marks: score.self_marks,
            submitted_at: new Date().toISOString(),
          },
          { onConflict: "test_item_id,student_id" }
        );
      }
      setItems((prev) =>
        prev.map((item) => {
          const score = scores.find(
            (s) => s.test_item_id === item.test_item_id
          );
          return score ? { ...item, self_marks: score.self_marks } : item;
        })
      );
      setStep(3);
    },
    [profile.id]
  );

  if (tests.length === 0) {
    return (
      <div className="max-w-4xl">
        <h1 className="text-2xl font-bold mb-4">Reflection</h1>
        <p className="text-gray-500">No tests available yet.</p>
      </div>
    );
  }

  if (isTeacher) {
    return (
      <div className="max-w-6xl">
        <h1 className="text-2xl font-bold mb-4">Reflection Dashboard</h1>
        <TeacherDashboard tests={tests} />
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold mb-2">Reflection</h1>

      {/* Test selector */}
      <div className="mb-4 flex items-center gap-3">
        <label htmlFor="test-selector" className="text-sm font-medium">
          Test:
        </label>
        <select
          id="test-selector"
          value={selectedTestId ?? ""}
          onChange={(e) => handleTestChange(e.target.value)}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm"
        >
          {tests.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      <HowItWorks />
      <StepTracker current={step} />

      {/* Step content */}
      {step === 1 && (
        <NativeForm items={items} onSubmit={handleSubmitSelfGrades} />
      )}

      {step === 2 && (
        <div className="space-y-4">
          <ScoreTable
            items={items}
            editable={true}
            onSave={handleSaveComparison}
          />
          <button
            type="button"
            onClick={() => setStep(3)}
            className="text-sm text-blue-600 hover:underline"
          >
            Skip to Upload →
          </button>
        </div>
      )}

      {step === 3 && selectedTestId && (
        <div className="space-y-4">
          <ScoreTable items={items} editable={false} />
          <UploadSection
            studentId={profile.id}
            testId={selectedTestId}
            existingUpload={initialUpload}
          />
          <button
            type="button"
            onClick={() => setStep(4)}
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
          >
            Mark Complete ✓
          </button>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4 text-center py-8">
          <p className="text-4xl">🎉</p>
          <h2 className="text-xl font-bold text-green-700">
            Reflection Complete!
          </h2>
          <p className="text-gray-600">
            Check the{" "}
            <a
              href="/dashboard/mastery"
              className="text-blue-600 hover:underline"
            >
              Mastery page
            </a>{" "}
            to see your progress over time.
          </p>
          <button
            type="button"
            onClick={() => setStep(1)}
            className="text-sm text-gray-500 hover:underline"
          >
            ← Redo this reflection
          </button>
        </div>
      )}
    </div>
  );
}
