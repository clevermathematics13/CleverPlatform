"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import LatexRenderer from "@/components/LatexRenderer";
import { createClient } from "@/lib/supabase/client";

interface Course {
  id: string;
  name: string;
}

type PlacementStatus =
  | "uploaded"
  | "segmenting"
  | "segmented"
  | "grading"
  | "graded"
  | "complete"
  | "error";

interface PlacementTestRow {
  id: string;
  student_name: string | null;
  student_name_source: "manual" | "extracted";
  student_name_confidence: "high" | "medium" | "low" | null;
  student_name_notes: string | null;
  course_id: string | null;
  file_name: string;
  status: PlacementStatus;
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

function statusLabel(status: PlacementStatus): string {
  switch (status) {
    case "uploaded":
      return "Uploaded — ready to segment";
    case "segmenting":
      return "Segmenting questions…";
    case "segmented":
      return "Segmented — ready to grade";
    case "grading":
      return "Grading…";
    case "graded":
      return "Graded — ready for recommendation";
    case "complete":
      return "Complete";
    case "error":
      return "Error";
  }
}

function statusColor(status: PlacementStatus): string {
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

function displayName(t: {
  student_name: string | null;
}): string {
  return t.student_name?.trim() || "Name not read";
}

/** Extracted names that weren't clearly legible need a teacher's eye. */
function nameNeedsReview(t: {
  student_name: string | null;
  student_name_source: "manual" | "extracted";
  student_name_confidence: "high" | "medium" | "low" | null;
}): boolean {
  if (t.student_name_source !== "extracted") return false;
  if (!t.student_name?.trim()) return true;
  return t.student_name_confidence === "low" || t.student_name_confidence === "medium";
}

const ACCEPTED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png", ".heic", ".heif"];

function isAcceptedFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export function PlacementClient({ courses }: { courses: Course[] }) {
  const [tests, setTests] = useState<PlacementTestRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [studentName, setStudentName] = useState("");
  const [courseId, setCourseId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadStage, setUploadStage] = useState<string | null>(null);
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

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    const rejected = picked.filter((f) => !isAcceptedFile(f));
    const accepted = picked.filter(isAcceptedFile);

    if (rejected.length > 0) {
      setUploadError(
        `Skipped ${rejected.length} unsupported file${rejected.length === 1 ? "" : "s"} — only PDF, JPEG, PNG, and HEIC are supported.`
      );
    } else {
      setUploadError(null);
    }
    setFiles(accepted);
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    setUploadError(null);
    if (files.length === 0) {
      setUploadError("Choose at least one file (PDF, or one or more photos).");
      return;
    }
    if (files.length > 10) {
      setUploadError("A placement test can have at most 10 pages.");
      return;
    }
    // A lone PDF is fine; mixing a PDF with photos is not supported by the
    // assembly step, so catch that early with a clear message.
    const hasPdf = files.some((f) => f.name.toLowerCase().endsWith(".pdf"));
    if (hasPdf && files.length > 1) {
      setUploadError("If uploading a PDF, upload just the one PDF — don't mix it with photos.");
      return;
    }

    setUploading(true);
    try {
      // Step 1: upload each raw file directly to Supabase Storage from the
      // browser. This bypasses Vercel's 4.5MB request body limit, which
      // multiple full-resolution phone photos would otherwise blow through.
      const supabase = createClient();
      const batchId = crypto.randomUUID();
      const rawStoragePaths: string[] = [];

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      for (let i = 0; i < files.length; i++) {
        setUploadStage(`Uploading page ${i + 1} of ${files.length}…`);
        const f = files[i];
        const safeExt = f.name.split(".").pop()?.toLowerCase() || "dat";
        const path = `placement-tests-raw/${user.id}/${batchId}/${String(i + 1).padStart(2, "0")}.${safeExt}`;

        const { error: uploadErr } = await supabase.storage.from("uploads").upload(path, f, {
          contentType: f.type || undefined,
          upsert: false,
        });
        if (uploadErr) throw new Error(`Failed to upload "${f.name}": ${uploadErr.message}`);
        rawStoragePaths.push(path);
      }

      // Step 2: tell the server which raw files to assemble — this request
      // is tiny (just a list of paths), so it's well within Vercel's limits.
      setUploadStage(
        studentName.trim() ? "Assembling document…" : "Reading the name from the front page…"
      );
      const res = await fetch("/api/placement/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentName: studentName.trim() || null,
          courseId: courseId || null,
          rawStoragePaths,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");

      setStudentName("");
      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await refreshList();
      setSelectedId(json.placementTest.id);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      setUploadStage(null);
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
            <label className="block text-xs font-medium text-da-muted mb-1">
              Student name <span className="font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={studentName}
              onChange={(e) => setStudentName(e.target.value)}
              placeholder="Leave blank to read from the paper"
              className="w-full rounded-lg border border-da-border bg-da-bg/70 px-3 py-2 text-sm text-da-text focus:border-da-accent focus:outline-none focus:ring-1 focus:ring-da-accent"
            />
            <p className="mt-1 text-xs text-da-muted">
              If left blank, the name is read from the handwritten front page and flagged for
              review if it isn&apos;t clearly legible.
            </p>
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
              Scanned test — one PDF, or up to 10 photos (JPEG, PNG, HEIC)
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/heic,image/heif,.heic,.heif"
              multiple
              onChange={handleFilePick}
              className="w-full text-sm text-da-text file:mr-3 file:rounded-lg file:border-0 file:bg-da-button-bg file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-da-button-text hover:file:bg-da-button-hover"
            />
            {files.length > 0 && (
              <ul className="mt-2 space-y-1">
                {files.map((f, i) => (
                  <li
                    key={`${f.name}-${i}`}
                    className="flex items-center justify-between rounded-md bg-da-bg/50 px-2 py-1 text-xs text-da-text/80"
                  >
                    <span className="truncate">
                      {i + 1}. {f.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="ml-2 shrink-0 text-da-muted hover:text-da-danger"
                      aria-label={`Remove ${f.name}`}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {uploadError && <p className="text-xs text-da-danger">{uploadError}</p>}
          <button
            type="submit"
            disabled={uploading}
            className="w-full rounded-lg border border-da-accent/40 bg-da-accent px-4 py-2 text-sm font-semibold text-[#2b1408] transition-colors hover:bg-da-amber disabled:opacity-50"
          >
            {uploading ? uploadStage ?? "Uploading…" : "Upload"}
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
                    <p className="font-medium truncate">
                      {displayName(t)}
                      {nameNeedsReview(t) && (
                        <span className="ml-1 text-da-warning" title="Name needs review">
                          ⚠
                        </span>
                      )}
                    </p>
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
  const [actionLoading, setActionLoading] = useState<"segment" | "grade" | "recommend" | null>(null);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);

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
    setEditingName(false);
    load();
  }, [id, load]);

  useEffect(() => {
    if (!test) return;
    if (test.status === "segmenting" || test.status === "grading") {
      const interval = setInterval(load, 4000);
      return () => clearInterval(interval);
    }
  }, [test, load]);

  async function runAction(action: "segment" | "grade" | "recommend") {
    setActionError(null);
    setActionLoading(action);
    try {
      const res = await fetch(`/api/placement/${id}/${action}`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `${action} failed`);
      await load();
      onStatusChange();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : `${action} failed`);
    } finally {
      setActionLoading(null);
    }
  }

  async function saveName() {
    if (!nameDraft.trim()) return;
    setSavingName(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/placement/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentName: nameDraft.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save name");
      setEditingName(false);
      await load();
      onStatusChange();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to save name");
    } finally {
      setSavingName(false);
    }
  }

  if (loading || !test) {
    return (
      <div className="rounded-xl border border-da-border bg-da-surface p-8 text-center text-sm text-da-muted">
        Loading…
      </div>
    );
  }

  const canSegment = test.status === "uploaded" || test.status === "error";
  const canGrade = test.status === "segmented" || (test.status === "error" && questions.length > 0);
  const canRecommend = test.status === "graded" || (test.status === "error" && questions.some((q) => q.mark));
  const reviewName = nameNeedsReview(test);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-da-border bg-da-surface p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {editingName ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveName();
                    if (e.key === "Escape") setEditingName(false);
                  }}
                  autoFocus
                  className="rounded-lg border border-da-border bg-da-bg/70 px-2 py-1 text-lg font-semibold text-da-text focus:border-da-accent focus:outline-none focus:ring-1 focus:ring-da-accent"
                />
                <button
                  type="button"
                  onClick={saveName}
                  disabled={savingName || !nameDraft.trim()}
                  className="rounded-md bg-da-accent px-2 py-1 text-xs font-semibold text-[#2b1408] disabled:opacity-50"
                >
                  {savingName ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingName(false)}
                  className="text-xs text-da-muted hover:text-da-text"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h2
                  className={`text-lg font-semibold ${
                    test.student_name ? "text-da-text" : "text-da-muted italic"
                  }`}
                >
                  {displayName(test)}
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setNameDraft(test.student_name ?? "");
                    setEditingName(true);
                  }}
                  className="text-xs text-da-muted hover:text-da-accent"
                >
                  edit
                </button>
              </div>
            )}
            <p className="text-xs text-da-muted mt-0.5">
              {test.file_name} {test.courses?.name ? `· ${test.courses.name}` : ""}
            </p>
          </div>
          <span className={`shrink-0 text-xs font-medium ${statusColor(test.status)}`}>
            {statusLabel(test.status)}
          </span>
        </div>

        {reviewName && !editingName && (
          <div className="mt-3 rounded-lg border border-da-warning/50 bg-da-warning/10 px-3 py-2 text-xs text-da-warning">
            ⚠{" "}
            {test.student_name
              ? `Name read from the paper${
                  test.student_name_confidence ? ` (${test.student_name_confidence} confidence)` : ""
                } — please confirm it's right.`
              : "No name could be read from the front page."}
            {test.student_name_notes ? ` ${test.student_name_notes}` : ""}
          </div>
        )}

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

        <div className="mt-3 flex flex-wrap gap-2">
          {canSegment && (
            <button
              type="button"
              onClick={() => runAction("segment")}
              disabled={actionLoading !== null}
              className="rounded-lg border border-da-accent/40 bg-da-accent px-4 py-2 text-sm font-semibold text-[#2b1408] transition-colors hover:bg-da-amber disabled:opacity-50"
            >
              {actionLoading === "segment"
                ? "Segmenting…"
                : test.status === "error"
                ? "Retry segmentation"
                : "Segment questions"}
            </button>
          )}
          {canGrade && (
            <button
              type="button"
              onClick={() => runAction("grade")}
              disabled={actionLoading !== null}
              className="rounded-lg border border-da-accent/40 bg-da-accent px-4 py-2 text-sm font-semibold text-[#2b1408] transition-colors hover:bg-da-amber disabled:opacity-50"
            >
              {actionLoading === "grade" ? "Grading…" : "Grade questions"}
            </button>
          )}
          {canRecommend && (
            <button
              type="button"
              onClick={() => runAction("recommend")}
              disabled={actionLoading !== null}
              className="rounded-lg border border-da-accent/40 bg-da-accent px-4 py-2 text-sm font-semibold text-[#2b1408] transition-colors hover:bg-da-amber disabled:opacity-50"
            >
              {actionLoading === "recommend" ? "Generating…" : "Generate recommendation"}
            </button>
          )}
        </div>
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
