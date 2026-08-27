"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";

type Feedback = {
  id: string;
  ai_attempted: boolean | null;
  ai_transcription: string | null;
  ai_verdict: "correct" | "partial" | "incorrect" | "unclear" | null;
  ai_marks_awarded: number | null;
  ai_marks_available: number | null;
  ai_misconception_tags: string[] | null;
  ai_margin_comment: string | null;
  ai_next_step: string | null;
  ai_confidence: number | null;
  ai_teacher_note: string | null;
  ai_validation_error: string | null;
  final_verdict: "correct" | "partial" | "incorrect" | "unclear" | null;
  final_marks_awarded: number | null;
  final_margin_comment: string | null;
  final_next_step: string | null;
  teacher_edited: boolean;
  approved_by: string | null;
  approved_at: string | null;
  released_at: string | null;
  student_flagged_misread: boolean;
  student_flag_note: string | null;
};

type Row = {
  cropId: string;
  imageUrl: string | null;
  inkDensity: number | null;
  isBlank: boolean;
  boundaryExpanded: boolean;
  packetScanId: string | null;
  packetSeq: number | null;
  idStatus: string | null;
  studentName: string | null;
  feedback: Feedback | null;
};

type Anchor = {
  id: string;
  qid: string;
  base_qid: string;
  part_label: string | null;
  command_term: string | null;
  marks_available: number | null;
  answer_sketch: string | null;
  open_rubric: string | null;
  misconception_context: string | null;
};

const VERDICT_KEYS: Record<string, "correct" | "partial" | "incorrect" | "unclear"> = {
  "1": "correct",
  "2": "partial",
  "3": "incorrect",
  "4": "unclear",
};

// Marks carry the color now, not a separate verdict chip -- the two were
// redundant (the number already says what happened) and could visibly
// disagree with each other during editing, which was confusing on its
// own. Full marks = green, zero = red, everything between interpolates
// so a 2/3 reads as more "correct" than a 1/3 rather than all partial
// marks looking identical.
function marksColorClasses(marks: number, max: number | undefined): string {
  if (max === undefined || max <= 0) return "text-da-text";
  const frac = Math.max(0, Math.min(1, marks / max));
  if (frac === 1) return "text-green-500";
  if (frac === 0) return "text-red-500";
  if (frac >= 0.67) return "text-lime-500";
  if (frac >= 0.34) return "text-amber-500";
  return "text-orange-500";
}

export default function AnchorReviewClient({
  anchor,
  initialRows,
}: {
  anchor: Anchor;
  initialRows: Row[];
}) {
  const [rows, setRows] = useState(initialRows);
  const [showNames, setShowNames] = useState(false);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [editingComment, setEditingComment] = useState<string | null>(null);
  const [editingMarks, setEditingMarks] = useState<string | null>(null);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [bulkThreshold, setBulkThreshold] = useState(0.85);
  const [bulkBusy, setBulkBusy] = useState(false);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);

  const reviewed = rows.filter((r) => r.feedback?.approved_at).length;
  const total = rows.length;

  const saveDecision = useCallback(
    async (
      row: Row,
      verdict: "correct" | "partial" | "incorrect" | "unclear",
      marks: number,
      comment: string,
      next: string,
      edited: boolean
    ) => {
      if (!row.feedback) return;
      setSavingIds((prev) => new Set(prev).add(row.cropId));
      try {
        const res = await fetch("/api/na-review/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cropId: row.cropId,
            verdict,
            marksAwarded: marks,
            marginComment: comment,
            nextStep: next,
            edited,
          }),
        });
        if (!res.ok) throw new Error(await res.text());

        setRows((prev) =>
          prev.map((r) =>
            r.cropId === row.cropId && r.feedback
              ? {
                  ...r,
                  feedback: {
                    ...r.feedback,
                    final_verdict: verdict,
                    final_marks_awarded: marks,
                    final_margin_comment: comment,
                    final_next_step: next,
                    teacher_edited: edited,
                    approved_at: new Date().toISOString(),
                  },
                }
              : r
          )
        );
      } catch (e) {
        console.error("Save failed", e);
      } finally {
        setSavingIds((prev) => {
          const next = new Set(prev);
          next.delete(row.cropId);
          return next;
        });
      }
    },
    []
  );

  const acceptAiDraft = useCallback(
    (row: Row) => {
      if (!row.feedback?.ai_verdict) return;
      saveDecision(
        row,
        row.feedback.ai_verdict,
        row.feedback.ai_marks_awarded ?? 0,
        row.feedback.ai_margin_comment ?? "",
        row.feedback.ai_next_step ?? "",
        false
      );
    },
    [saveDecision]
  );

  const setVerdictOverride = useCallback(
    (row: Row, verdict: "correct" | "partial" | "incorrect" | "unclear") => {
      if (!row.feedback) return;
      // Verdict and marks are independent fields, saved independently.
      // An earlier version tried to be "helpful" by auto-setting the
      // mark whenever the verdict changed (full/zero/zero for correct/
      // incorrect/unclear) -- this created a worse bug than the one it
      // fixed: setting the mark directly afterward, then changing the
      // verdict again, silently overwrote the mark the teacher had JUST
      // set, because the verdict-setter had no way to know the mark
      // field had been touched since. Two functions independently
      // "deriving" one field from the other is inherently fragile.
      // Pressing a verdict key now ONLY sets the verdict. The mark stays
      // exactly as it was until the teacher explicitly changes it via
      // the mark field (click it or press 'm') -- if that leaves a
      // visibly mismatched pairing like "correct, 1/3", that mismatch is
      // the correct, honest signal that the mark still needs setting,
      // not something to paper over with a guess.
      const marks = row.feedback.final_marks_awarded ?? row.feedback.ai_marks_awarded ?? 0;
      const comment = row.feedback.final_margin_comment ?? row.feedback.ai_margin_comment ?? "";
      const next = row.feedback.final_next_step ?? row.feedback.ai_next_step ?? "";
      const unchanged = verdict === row.feedback.ai_verdict;
      saveDecision(row, verdict, marks, comment, next, !unchanged || row.feedback.teacher_edited);
    },
    [saveDecision]
  );

  const setMarksOverride = useCallback(
    (row: Row, marks: number) => {
      if (!row.feedback) return;
      // Marks-only change -- see comment in setVerdictOverride above for
      // why this never also touches the verdict.
      const verdict = row.feedback.final_verdict ?? row.feedback.ai_verdict ?? "unclear";
      const comment = row.feedback.final_margin_comment ?? row.feedback.ai_margin_comment ?? "";
      const next = row.feedback.final_next_step ?? row.feedback.ai_next_step ?? "";
      saveDecision(row, verdict, marks, comment, next, true);
    },
    [saveDecision]
  );

  const bulkAccept = useCallback(async () => {
    setBulkBusy(true);
    try {
      const res = await fetch("/api/na-review/bulk-accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anchorId: anchor.id, confidenceThreshold: bulkThreshold }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const detail = await fetch(`/api/na-review/anchor/${anchor.id}`).then((r) => r.json());
      setRows(detail.rows);
      alert(`Accepted ${data.accepted} response(s) at confidence >= ${bulkThreshold}.`);
    } catch (e) {
      console.error("Bulk accept failed", e);
      alert("Bulk accept failed -- see console.");
    } finally {
      setBulkBusy(false);
    }
  }, [anchor.id, bulkThreshold]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (activeIdx === null) return;
      if (editingComment !== null || editingMarks !== null) return;
      const row = rows[activeIdx];
      if (!row) return;

      if (e.key in VERDICT_KEYS) {
        e.preventDefault();
        setVerdictOverride(row, VERDICT_KEYS[e.key]);
      } else if (e.key === "Enter") {
        e.preventDefault();
        acceptAiDraft(row);
      } else if (e.key === "/") {
        e.preventDefault();
        setEditingComment(row.cropId);
      } else if (e.key === "m") {
        e.preventDefault();
        setEditingMarks(row.cropId);
      } else if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        setActiveIdx((i) => (i === null ? 0 : Math.min(rows.length - 1, i + 1)));
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        setActiveIdx((i) => (i === null ? 0 : Math.max(0, i - 1)));
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [activeIdx, rows, editingComment, editingMarks, setVerdictOverride, acceptAiDraft]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/dashboard/na-review" className="text-xs text-da-muted hover:text-da-accent">
            ← All questions
          </Link>
          <h1 className="text-2xl font-bold text-da-text font-serif mt-1">{anchor.qid}</h1>
          {anchor.command_term && (
            <p className="text-sm text-da-muted mt-0.5">
              {anchor.command_term} · {anchor.marks_available} Clev&apos;s Marks
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="text-sm text-da-text font-medium">
            {reviewed} / {total} reviewed
          </p>
          <button
            onClick={() => setShowNames((s) => !s)}
            className="text-xs text-da-muted hover:text-da-accent mt-1"
          >
            {showNames ? "Hide names" : "Show names"}
          </button>
        </div>
      </div>

      <div
        className="rounded-xl border border-da-border bg-da-surface p-4 space-y-2 sticky top-0 z-10 shadow-lg shadow-black/20"
        style={{ backgroundColor: "var(--color-da-surface)" }}
      >
        {anchor.open_rubric ? (
          <div>
            <p className="text-xs font-semibold text-da-accent uppercase tracking-wide">
              Open rubric (no single correct answer)
            </p>
            <p className="text-sm text-da-text mt-1">{anchor.open_rubric}</p>
          </div>
        ) : (
          <div>
            <p className="text-xs font-semibold text-da-accent uppercase tracking-wide">Answer key</p>
            <p className="text-sm text-da-text mt-1">{anchor.answer_sketch}</p>
          </div>
        )}
        {anchor.misconception_context && (
          <div className="pt-2 border-t border-da-border">
            <p className="text-xs font-semibold text-amber-500 uppercase tracking-wide">
              Planted-error target
            </p>
            <p className="text-sm text-da-muted mt-1">{anchor.misconception_context}</p>
          </div>
        )}

        <div className="flex items-center gap-3 pt-2 border-t border-da-border text-xs text-da-muted flex-wrap">
          <span>
            Keys: <kbd className="px-1 bg-da-hover rounded">1</kbd> correct{" "}
            <kbd className="px-1 bg-da-hover rounded">2</kbd> partial{" "}
            <kbd className="px-1 bg-da-hover rounded">3</kbd> incorrect{" "}
            <kbd className="px-1 bg-da-hover rounded">4</kbd> unclear{" "}
            <kbd className="px-1 bg-da-hover rounded">m</kbd> edit marks{" "}
            <kbd className="px-1 bg-da-hover rounded">Enter</kbd> accept AI
          </span>
          <span className="text-da-muted/70">
            (verdict and marks are set independently — a key press changes only the verdict; click
            the mark or press <kbd className="px-1 bg-da-hover rounded">m</kbd> to set the number)
          </span>
          <span className="ml-auto flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={bulkThreshold}
              onChange={(e) => setBulkThreshold(Number(e.target.value))}
              className="w-16 border border-da-border rounded px-1.5 py-0.5 text-xs bg-da-surface"
            />
            <button
              onClick={bulkAccept}
              disabled={bulkBusy}
              className="px-2.5 py-1 rounded bg-da-accent/15 text-da-accent hover:bg-da-accent/25 disabled:opacity-50"
            >
              {bulkBusy ? "Accepting…" : "Accept all above threshold"}
            </button>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {rows.map((row, idx) => {
          const fb = row.feedback;
          const displayedVerdict = fb?.final_verdict ?? fb?.ai_verdict ?? null;
          const displayedMarks = fb?.final_marks_awarded ?? fb?.ai_marks_awarded ?? null;
          const maxMarks = fb?.ai_marks_available ?? anchor.marks_available ?? undefined;
          const isReviewed = !!fb?.approved_at;
          const marksColor =
            displayedMarks !== null ? marksColorClasses(displayedMarks, maxMarks) : "text-da-text";
          const lowConfidence =
            fb?.ai_confidence !== null && fb?.ai_confidence !== undefined && fb.ai_confidence < 0.6;

          return (
            <div
              key={row.cropId}
              onClick={() => setActiveIdx(idx)}
              className={`rounded-xl border bg-da-surface overflow-hidden cursor-pointer transition-all ${
                activeIdx === idx ? "border-da-accent ring-2 ring-da-accent/30" : "border-da-border"
              } ${isReviewed ? "opacity-70" : ""}`}
            >
              <div className="flex items-center justify-between px-3 py-2 border-b border-da-border text-xs">
                <span className="text-da-muted">
                  {showNames ? row.studentName ?? "Unknown" : `#${row.packetSeq ?? "?"}`}
                  {row.idStatus === "needs_review" && (
                    <span className="ml-1 text-amber-500" title="ID needs review">
                      ⚠
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-1.5">
                  {row.boundaryExpanded && (
                    <span className="text-da-muted" title="Crop was adaptively expanded">
                      ⤢
                    </span>
                  )}
                  {lowConfidence && (
                    <span className="text-amber-500" title="Low AI confidence">
                      ⚡
                    </span>
                  )}
                  {fb?.ai_validation_error && (
                    <span className="text-red-500" title={fb.ai_validation_error}>
                      ⚠ invalid
                    </span>
                  )}
                  {displayedMarks !== null &&
                    (editingMarks === row.cropId ? (
                      <input
                        type="number"
                        autoFocus
                        min={0}
                        max={maxMarks}
                        step={0.5}
                        defaultValue={displayedMarks}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={(e) => {
                          const val = Number(e.target.value);
                          if (!Number.isNaN(val)) setMarksOverride(row, val);
                          setEditingMarks(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          if (e.key === "Escape") setEditingMarks(null);
                        }}
                        className="w-14 border border-da-accent rounded px-1 py-0.5 text-xs bg-da-surface text-da-text"
                      />
                    ) : (
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingMarks(row.cropId);
                        }}
                        className={`font-semibold cursor-text hover:bg-da-hover/50 rounded px-1 ${marksColor}`}
                        title="Click to edit"
                      >
                        {displayedMarks}/{maxMarks}
                      </span>
                    ))}
                  {isReviewed && <span className="text-green-500">✓</span>}
                </div>
              </div>

              {row.isBlank ? (
                <div className="aspect-[3/1] flex items-center justify-center text-da-muted text-sm bg-da-hover/30">
                  Blank -- not attempted
                </div>
              ) : row.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={row.imageUrl} alt={`${anchor.qid} response`} className="w-full" />
              ) : (
                <div className="aspect-[3/1] flex items-center justify-center text-da-muted text-sm">
                  Image unavailable
                </div>
              )}

              {fb && !row.isBlank && (
                <div className="px-3 py-2 text-xs space-y-1.5">
                  <p className="text-da-text">
                    {editingComment === row.cropId ? (
                      <textarea
                        ref={commentInputRef}
                        autoFocus
                        defaultValue={fb.final_margin_comment ?? fb.ai_margin_comment ?? ""}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={(e) => {
                          saveDecision(
                            row,
                            displayedVerdict ?? "unclear",
                            displayedMarks ?? 0,
                            e.target.value,
                            fb.final_next_step ?? fb.ai_next_step ?? "",
                            true
                          );
                          setEditingComment(null);
                        }}
                        className="w-full border border-da-border rounded px-2 py-1 bg-da-surface text-da-text"
                        rows={2}
                      />
                    ) : (
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingComment(row.cropId);
                        }}
                        className="cursor-text hover:bg-da-hover/50 rounded px-1 -mx-1"
                      >
                        {fb.final_margin_comment ?? fb.ai_margin_comment ?? "(no comment)"}
                      </span>
                    )}
                  </p>
                  {fb.ai_teacher_note && (
                    <p className="text-da-muted italic border-t border-da-border pt-1.5">
                      Teacher note: {fb.ai_teacher_note}
                    </p>
                  )}
                  {fb.student_flagged_misread && (
                    <p className="text-amber-500 border-t border-da-border pt-1.5">
                      ⚑ Student flagged: {fb.student_flag_note ?? "thinks this was misread"}
                    </p>
                  )}
                  {savingIds.has(row.cropId) && <p className="text-da-muted">Saving…</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
