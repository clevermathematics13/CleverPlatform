"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import LatexRenderer from "@/components/LatexRenderer";

interface Course {
  id: string;
  name: string;
}

interface PlacementTestRow {
  id: string;
  student_name: string;
  course_id: string | null;
  file_name: string;
  status: "uploaded" | "segmenting" | "segmented" | "grading" | "complete" | "error";
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
  courses: { name: string } | null;
}

interface PlacementQuestion {
  id: string;
  question_number: number;
  page_numbers: number[];
  inferred_question_latex: string;
  inferred_markscheme_latex: string;
  inferred_max_marks: number;
  inferred_level_hint: "SL" | "HL" | null;
  sort_order: number;
  mark: {
    marks_awarded: number;
    max_marks: number;
    confidence: "high" | "medium" | "low";
    confidence_notes: string | null;
    student_work_transcription: string | null;
  } | null;
}

interface Recommendation {
  recommended_label: "AISL" | "AASL" | "AAHL";
  overall_percentage: number;
  reasoning: string;
  low_confidence_count: number;
}

function statusLabel(status: PlacementTestRow["status"]): string {
  switch (status) {
    case "uploaded":
      return "Uploaded — ready to segment";
    case "segmenting":
      return "Segmenting questions…";
    case "segmented":
      return "Segmented — ready to grade";
    case "grading":
      return "Grading…";
    case "complete":
      return "Complete";
    case "error":
      return "Error";
  }
}

function statusColor(status: PlacementTestRow["status"]): string {
  switch (status) {
    case "complete":
      return "text-da-success";
    case "error":
      return "text-da-danger";
    case "segmenting":
    case "grading":
      return "text-da-info";
    default:
      return "text-da-muted";
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // strip the data: prefix
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export function PlacementClient({ courses }: { courses: Course[] }) {
  const [tests, setTests] = useState<PlacementTestRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [studentName, setStudentName] = useState("");
  const [courseId, setCourseId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshList = useCallback(async () => {
    try {
      const res = await fetch("/api/placement");
      const data = await res.json();
      if (res.ok) setTests(data.placementTests ?? []);
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  // Poll while anything is in-flight (segmenting/grading)
  useEffect(() => {
    const hasActive = tests.some((t) => t.status === "segmenting" || t.status === "grading");
    if (!hasActive) return;
    const interval = setInterval(refreshList, 4000);
    return () => clearInterval(interval);
  }, [tests, refreshList]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    setUploadError(null);
    if (!studentName.trim()) {
      setUploadError("Enter the student's name.");
      return;
    }
    if (!file) {
      setUploadError("Choose a PDF to upload.");
      return;
    }
    setUploading(true);
    try {
      const data = await fileToBase64(file);
      const res = await fetch("/api/placement/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentName: studentName.trim(),
          courseId: courseId || null,
          fileName: file.name,
          data,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");

      setStudentName("");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await refreshList();
      setSelectedId(json.placementTest.id);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[22rem_1fr]">
      <div className="space-y-6">
        {/* Upload form */}
        <form
          onSubmit={handleUpload}
          className="rounded-xl border border-da-border bg-da-surface p-4 space-y-3"
        >
          <h2 className="text-sm font-semibold text-da-amber">Upload a placement test</h2>
          <div>
            <label className="block text-xs font-medium text-da-muted mb-1">Student name</label>
            <input
              type="text"
              value={studentName}
              onChange={(e) => setStudentName(e.target.value)}
              placeholder="e.g. Alex Chen"
              className="w-full rounded-lg border border-da-border bg-da-bg/70 px-3 py-2 text-sm text-da-text focus:border-da-accent focus:outline-none focus:ring-1 focus:ring-da-accent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-da-muted mb-1">
              Course (optional)
            </label>
            <select
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              className="w-full rounded-lg border border-da-border bg-da-bg/70 px-3 py-2 text-sm text-da-text focus:border-da-accent focus:outline-none focus:ring-1 focus:ring-da-accent"
            >
              <option value="">— none —</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-da-muted mb-1">
              Scanned test (PDF)
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm text-da-text file:mr-3 file:rounded-lg file:border-0 file:bg-da-button-bg file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-da-button-text hover:file:bg-da-button-hover"
            />
          </div>
          {uploadError && <p className="text-xs text-da-danger">{uploadError}</p>}
          <button
            type="submit"
            disabled={uploading}
            className="w-full rounded-lg border border-da-accent/40 bg-da-accent px-4 py-2 text-sm font-semibold text-[#2b1408] transition-colors hover:bg-da-amber disabled:opacity-50"
          >
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </form>

        {/* List */}
        <div className="rounded-xl border border-da-border bg-da-surface p-4">
          <h2 className="text-sm font-semibold text-da-amber mb-3">Placement tests</h2>
          {loadingList ? (
            <p className="text-xs text-da-muted">Loading…</p>
          ) : tests.length === 0 ? (
            <p className="text-xs text-da-muted">No placement tests uploaded yet.</p>
          ) : (
            <ul className="space-y-1">
              {tests.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(t.id)}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      selectedId === t.id
                        ? "bg-da-hover text-da-text"
                        : "text-da-text/80 hover:bg-da-hover"
                    }`}
                  >
                    <p className="font-medium truncate">{t.student_name}</p>
                    <p className={`text-xs ${statusColor(t.status)}`}>{statusLabel(t.status)}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div>
        {selectedId ? (
          <PlacementDetail
            id={selectedId}
            onStatusChange={refreshList}
          />
        ) : (
          <div className="rounded-xl border border-da-border bg-da-surface p-8 text-center text-sm text-da-muted">
            Select a placement test to view its questions, marks, and recommendation.
          </div>
        )}
      </div>
    </div>
  );
}

function PlacementDetail({
  id,
  onStatusChange,
}: {
  id: string;
  onStatusChange: () => void;
}) {
  const [test, setTest] = useState<PlacementTestRow | null>(null);
  const [questions, setQuestions] = useState<PlacementQuestion[]>([]);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [segmenting, setSegmenting] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/placement/${id}`);
    const data = await res.json();
    if (res.ok) {
      setTest(data.placementTest);
      setQuestions(data.questions ?? []);
      setRecommendation(data.recommendation ?? null);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [id, load]);

  useEffect(() => {
    if (!test) return;
    if (test.status === "segmenting" || test.status === "grading") {
      const interval = setInterval(load, 4000);
      return () => clearInterval(interval);
    }
  }, [test, load]);

  async function handleSegment() {
    setActionError(null);
    setSegmenting(true);
    try {
      const res = await fetch(`/api/placement/${id}/segment`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Segmentation failed");
      await load();
      onStatusChange();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Segmentation failed");
    } finally {
      setSegmenting(false);
    }
  }

  if (loading || !test) {
    return (
      <div className="rounded-xl border border-da-border bg-da-surface p-8 text-center text-sm text-da-muted">
        Loading…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-da-border bg-da-surface p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-da-text">{test.student_name}</h2>
            <p className="text-xs text-da-muted">
              {test.file_name} {test.courses?.name ? `· ${test.courses.name}` : ""}
            </p>
          </div>
          <span className={`text-xs font-medium ${statusColor(test.status)}`}>
            {statusLabel(test.status)}
          </span>
        </div>

        {test.status === "error" && test.error_message && (
          <div className="mt-3 rounded-lg border border-da-danger/40 bg-da-danger/10 px-3 py-2 text-xs text-da-danger">
            {test.error_message}
          </div>
        )}
        {actionError && (
          <div className="mt-3 rounded-lg border border-da-danger/40 bg-da-danger/10 px-3 py-2 text-xs text-da-danger">
            {actionError}
          </div>
        )}

        {(test.status === "uploaded" || test.status === "error") && (
          <button
            type="button"
            onClick={handleSegment}
            disabled={segmenting}
            className="mt-3 rounded-lg border border-da-accent/40 bg-da-accent px-4 py-2 text-sm font-semibold text-[#2b1408] transition-colors hover:bg-da-amber disabled:opacity-50"
          >
            {segmenting ? "Segmenting…" : test.status === "error" ? "Retry segmentation" : "Segment questions"}
          </button>
        )}
      </div>

      {recommendation && (
        <div className="rounded-xl border border-da-accent/50 bg-da-accent/10 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-da-muted">
            Recommended placement
          </p>
          <p className="text-2xl font-bold text-da-accent">{recommendation.recommended_label}</p>
          <p className="text-sm text-da-text mt-1">
            {recommendation.overall_percentage.toFixed(1)}% overall
            {recommendation.low_confidence_count > 0 && (
              <span className="ml-2 text-da-warning">
                · {recommendation.low_confidence_count} item
                {recommendation.low_confidence_count === 1 ? "" : "s"} flagged for review
              </span>
            )}
          </p>
          <p className="text-sm text-da-muted mt-2">{recommendation.reasoning}</p>
        </div>
      )}

      {questions.length > 0 && (
        <div className="space-y-3">
          {questions.map((q) => (
            <QuestionCard key={q.id} q={q} />
          ))}
        </div>
      )}
    </div>
  );
}

function QuestionCard({ q }: { q: PlacementQuestion }) {
  const lowConfidence = q.mark?.confidence === "low";
  return (
    <div
      className={`rounded-xl border p-4 ${
        lowConfidence
          ? "border-da-warning/60 bg-da-warning/10"
          : "border-da-border bg-da-surface"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-da-text">
          Question {q.question_number}
          {q.inferred_level_hint && (
            <span className="ml-2 text-xs font-normal text-da-muted">
              ({q.inferred_level_hint} level)
            </span>
          )}
        </h3>
        {q.mark ? (
          <span className="text-sm font-semibold text-da-text">
            {q.mark.marks_awarded} / {q.mark.max_marks} Clev&apos;s Marks
          </span>
        ) : (
          <span className="text-xs text-da-muted">Not yet graded</span>
        )}
      </div>

      {lowConfidence && (
        <div className="mb-2 rounded-md border border-da-warning/50 bg-da-warning/15 px-3 py-1.5 text-xs text-da-warning">
          ⚠ Low confidence — please review this mark.
          {q.mark?.confidence_notes ? ` ${q.mark.confidence_notes}` : ""}
        </div>
      )}

      <div className="text-sm text-da-text/90">
        <LatexRenderer latex={q.inferred_question_latex} />
      </div>

      {q.mark?.student_work_transcription && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-da-muted hover:text-da-text">
            Transcribed student work
          </summary>
          <p className="mt-1 text-xs text-da-muted whitespace-pre-wrap">
            {q.mark.student_work_transcription}
          </p>
        </details>
      )}
    </div>
  );
}
