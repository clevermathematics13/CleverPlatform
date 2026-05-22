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
import { computeDisagreement } from "@/lib/reflection-utils";
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
  viewStudentId?: string | null;
  viewStudentName?: string | null;
}

export function ReflectionClient({
  profile,
  tests,
  selectedTestId,
  initialItems,
  initialUpload,
  isTeacher,
  viewStudentId,
  viewStudentName,
}: ReflectionClientProps) {
  const router = useRouter();
  const [items, setItems] = useState<ReflectionItem[]>(initialItems ?? []);
  const [pdfUpload, setPdfUpload] = useState<PdfUpload | null>(initialUpload);
  const hasSelfScores = items.some((i) => i.self_marks !== null);
  const hasTeacherMarks = items.some((i) => i.marks_awarded !== null);
  const disagreement = computeDisagreement(items);

  const getInitialStep = (): ReflectionStep => {
    if (pdfUpload) return 4;
    if (hasSelfScores && hasTeacherMarks && disagreement === 0) return 3;
    if (hasSelfScores && hasTeacherMarks) return 2;
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
      const updatedItems = items.map((item) => {
        const score = scores.find((s) => s.test_item_id === item.test_item_id);
        return score ? { ...item, self_marks: score.self_marks } : item;
      });
      setItems(updatedItems);
      // Auto-advance to upload only when disagreement reaches 0
      const newDisagreement = computeDisagreement(updatedItems);
      if (newDisagreement === 0) setStep(3);
    },
    [profile.id, items]
  );

  if (tests.length === 0) {
    return (
      <div className="max-w-4xl">
        <h1 className="text-2xl font-bold mb-4">Reflection</h1>
        <p className="text-da-muted">No tests available yet.</p>
      </div>
    );
  }

  if (isTeacher && !viewStudentId) {
    return (
      <div className="max-w-6xl">
        <h1 className="text-2xl font-bold mb-4 text-da-amber">Exam Reflection Dashboard</h1>
        <TeacherDashboard tests={tests} />
      </div>
    );
  }

  // Teacher viewing a student, or student viewing own page
  const isViewingStudent = isTeacher && !!viewStudentId;

  return (
    <div className="max-w-4xl">
      {isViewingStudent && (
        <div className="mb-4">
          <a
            href="/dashboard/reflection"
            className="text-sm text-da-accent hover:underline"
          >
            ← Back to dashboard
          </a>
        </div>
      )}
      <h1 className="text-2xl font-extrabold mb-2 text-da-text drop-shadow-sm">
        {isViewingStudent
          ? `${viewStudentName}'s Exam Reflection`
          : "Exam Reflection"}
      </h1>

      {/* Test selector */}
      <div className="mb-4 flex items-center gap-3">
        <label htmlFor="test-selector" className="text-base font-semibold text-da-amber">
          Test:
        </label>
        <select
          id="test-selector"
          value={selectedTestId ?? ""}
          onChange={(e) => handleTestChange(e.target.value)}
          className="rounded border border-da-border px-3 py-1.5 text-base font-semibold text-da-text bg-da-surface focus:ring-2 focus:ring-da-accent"
          disabled={tests.length === 0}
        >
          {tests.map((t) => (
            <option key={t.id} value={t.id} className="text-da-text font-semibold">
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
          {hasTeacherMarks && disagreement !== 0 && (
            <p className="text-sm text-orange-300/80">
              Bring disagreement to 0% to unlock the upload step. Edit your
              self marks above and hit &ldquo;Save Changes&rdquo;.
            </p>
          )}
          {!hasTeacherMarks && (
            <p className="text-sm text-da-muted">
              Waiting for your teacher to enter marks — come back once grading is
              complete to see your disagreement score.
            </p>
          )}
          {hasTeacherMarks && disagreement === 0 && (
            <button
              type="button"
              onClick={() => setStep(3)}
              className="rounded-lg bg-da-accent px-4 py-2 text-sm font-bold text-da-bg hover:bg-da-amber"
            >
              Proceed to Upload →
            </button>
          )}
        </div>
      )}

      {step === 3 && selectedTestId && (
        <div className="space-y-4">
          <ScoreTable items={items} editable={false} />
          <UploadSection
            studentId={profile.id}
            testId={selectedTestId}
            existingUpload={pdfUpload}
            disagreement={disagreement}
            onChangeUpload={(u) => {
              setPdfUpload(u);
              if (u) setStep(4);
            }}
          />
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4 text-center py-8">
          <p className="text-4xl">🎉</p>
          <h2 className="text-xl font-bold text-green-400">
            Reflection Complete!
          </h2>
          <p className="text-da-muted">
            Check the{" "}
            <a
              href="/dashboard/mastery"
              className="text-da-accent hover:underline"
            >
              Mastery page
            </a>{" "}
            to see your progress over time.
          </p>
          <button
            type="button"
            onClick={() => setStep(1)}
            className="text-sm text-da-muted hover:underline"
          >
            ← Redo this reflection
          </button>
        </div>
      )}
    </div>
  );
}
