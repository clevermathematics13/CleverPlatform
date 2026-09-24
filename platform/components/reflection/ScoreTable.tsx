"use client";

import { Fragment, useState } from "react";
import type { ReflectionItem, ReflectionRemark, SelfScore } from "@/lib/reflection-types";
import { computeDisagreement } from "@/lib/reflection-utils";
import { pendingRemarkItemIds, remarkEligibility } from "@/lib/remark-requests";
import { MarkSchemePart } from "./MarkSchemePart";
import { RemarkRequestRow, type RemarkRowMode } from "./RemarkRequestRow";

interface ScoreTableProps {
  items: ReflectionItem[];
  editable: boolean;
  onSave?: (scores: SelfScore[]) => Promise<void>;
  /** Parts left out of the disagreement % because a re-mark request on them
   *  is waiting for the teacher. Defaults to the pending requests on
   *  `items`; the teacher dashboard, whose items carry none, passes its own. */
  excusedItemIds?: ReadonlySet<string>;
  /** Re-mark requests on this table: whether one can be made here, and who
   *  to tell when one is sent, reworded or withdrawn. Without it no request
   *  is shown or offered. */
  remark?: {
    mode: RemarkRowMode;
    canWithdraw: boolean;
    onChange?: (testItemId: string, remark: ReflectionRemark | null) => void;
  };
  /** False when the student has not self-graded at all.
   *
   *  Every self-mark read below falls back to 0 when it is null, which is
   *  harmless for a student who HAS self-graded (a blank box really is a 0)
   *  but invents a whole assessment for one who has not: a Self column of
   *  zeros, and a "Judgement Disagreement" that is really just their score
   *  subtracted from 100. This table was previously only ever reached after
   *  a self-assessment, so that never showed; opening Compare first makes it
   *  reachable, and a fabricated number presented as the student's own
   *  judgement is worse than no number. When false, the self side reads as
   *  "not entered yet" instead. */
  selfMarksEntered?: boolean;
}

export function ScoreTable({
  items,
  editable,
  onSave,
  selfMarksEntered = true,
  excusedItemIds,
  remark,
}: ScoreTableProps) {
  // "" is a question the student left blank -- no attempt -- which the
  // self-grade form treats as distinct from a 0 they earned, and which
  // student_self_scores now stores as NULL. Seeding these boxes with 0 would
  // turn "I didn't attempt it" into "I attempted it and got nothing" the
  // moment anyone pressed Save Changes.
  const [editedScores, setEditedScores] = useState<Record<string, number | "">>(
    () => {
      const init: Record<string, number | ""> = {};
      for (const item of items) {
        init[item.test_item_id] = item.self_marks ?? "";
      }
      return init;
    }
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [openQuestionMenuFor, setOpenQuestionMenuFor] = useState<string | null>(null);

  /** What the student currently claims for an item: a number, or null for a
   *  question they left blank (no attempt). */
  const selfMarkFor = (item: ReflectionItem): number | null => {
    const edited = editedScores[item.test_item_id];
    if (edited === "") return null;
    return edited ?? item.self_marks ?? null;
  };

  const totalTeacher = items.reduce(
    (sum, i) => sum + (i.marks_awarded ?? 0),
    0
  );
  // A blank question earned nothing, so it adds nothing to the total -- the
  // blank says something about the attempt, not about the marks.
  const totalSelf = items.reduce((sum, i) => sum + (selfMarkFor(i) ?? 0), 0);
  const totalMax = items.reduce((sum, i) => sum + i.max_marks, 0);

  // Compute live disagreement from current edited scores. Skipped entirely
  // when nothing has been self-graded: there is no judgement to disagree
  // with, and computing one anyway just restates the student's score.
  const liveItems: ReflectionItem[] = items.map((item) => ({
    ...item,
    self_marks: selfMarkFor(item),
  }));
  // Parts waiting for a re-mark are the teacher's to settle, not the
  // student's, so they sit outside the number that unlocks the upload.
  const excused = excusedItemIds ?? pendingRemarkItemIds(items);
  const disagreement = selfMarksEntered ? computeDisagreement(liveItems, excused) : null;
  // Asked of the SAVED marks, as the route asks it: a number typed here and
  // not yet saved is not something a re-mark request can be made against.
  const hasSelfAssessed = selfMarksEntered && items.some((i) => i.self_marks !== null);

  const handleSave = async () => {
    if (!onSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      const scores: SelfScore[] = items.map((item) => ({
        test_item_id: item.test_item_id,
        self_marks: selfMarkFor(item),
      }));
      await onSave(scores);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  const getDiffClass = (teacher: number | null, self: number | null) => {
    if (teacher === null) return "";
    // A blank question is a claim of no marks, so it shades against the
    // teacher's mark the same way an explicit 0 does.
    const claimed = self ?? 0;
    if (claimed === teacher) return "bg-green-900/20";
    if (claimed > teacher) return "bg-yellow-900/20";
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
            {excused.size > 0 && (
              <span className="block text-xs font-normal opacity-80">
                {excused.size === 1
                  ? "1 part waiting for a re-mark isn't counted."
                  : `${excused.size} parts waiting for a re-mark aren't counted.`}
              </span>
            )}
          </span>
        </div>
      )}

      {disagreement === null && (
        <div className="rounded-lg border border-da-border/50 bg-da-surface px-4 py-3 text-sm text-da-muted">
          {selfMarksEntered
            ? "⏳ Waiting for ClevMarks — disagreement will appear once marking is complete."
            : "Self-grade this test to see how your judgement compares with ClevMarks."}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-base">
          <thead>
            <tr className="border-b border-da-border/40 bg-da-surface">
              <th className="px-3 py-2 text-left font-bold text-da-amber">Question</th>
              <th className="px-3 py-2 text-center font-bold text-da-amber">Max</th>
              <th className="px-3 py-2 text-center font-bold text-da-amber">ClevMarks</th>
              <th className="px-3 py-2 text-center font-bold text-da-amber">Self</th>
              <th className="px-3 py-2 text-center font-bold text-da-amber">Diff</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const self = selfMarkFor(item);
              // Nothing self-graded: the row has no self mark and therefore
              // no difference to report, rather than a difference from 0. A
              // question left blank within a real self-assessment does have
              // one -- the student claimed no marks on it.
              const diff =
                selfMarksEntered && item.marks_awarded !== null
                  ? (self ?? 0) - item.marks_awarded
                  : null;
              const rowShade = selfMarksEntered ? getDiffClass(item.marks_awarded, self) : "";
              // A request already made always shows, with its answer; a new
              // one is offered only where it could be made.
              const existingRemark = item.remark_request ?? null;
              const canAsk =
                remarkEligibility({
                  hasSelfAssessed,
                  marksAwarded: item.marks_awarded,
                  savedSelfMarks: item.self_marks,
                  existingStatus: existingRemark?.status ?? null,
                }) === "ok";
              const showRemark =
                !!remark && (!!existingRemark || (canAsk && remark.mode !== "readonly"));
              return (
                <Fragment key={item.test_item_id}>
                <tr className={`${item.mark_scheme || showRemark ? "" : "border-b"} ${rowShade}`}>
                  <td className="px-3 py-2">
                    <div className="relative inline-block">
                      <button
                        type="button"
                        onClick={() =>
                          setOpenQuestionMenuFor((prev) =>
                            prev === item.test_item_id ? null : item.test_item_id
                          )
                        }
                        className="text-left hover:opacity-80"
                      >
                        <span className="font-bold text-da-amber">{item.paper_label ?? item.question_number}</span>
                        {item.part_label && (
                          <span className="font-bold text-da-muted">({item.part_label})</span>
                        )}
                        {item.subtopic_labels.length > 0 && (
                          <span className="ml-2 text-xs text-da-muted">[{item.subtopic_labels.join(", ")}]</span>
                        )}
                      </button>
                      {openQuestionMenuFor === item.test_item_id && (
                        <div className="absolute left-0 top-full z-20 mt-1 min-w-[140px] rounded-lg border border-da-border bg-da-surface py-1 shadow-lg">
                          <a
                            href={`/dashboard/questions?testItemId=${item.test_item_id}`}
                            className="block px-3 py-1.5 text-sm text-da-text hover:bg-da-hover"
                          >
                            Edit Question
                          </a>
                        </div>
                      )}
                    </div>
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
                        value={self ?? ""}
                        placeholder="–"
                        onChange={(e) => {
                          // Clearing the box puts the question back to "no
                          // attempt" rather than pinning it to 0.
                          if (e.target.value === "") {
                            setEditedScores((prev) => ({
                              ...prev,
                              [item.test_item_id]: "",
                            }));
                            return;
                          }
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
                    ) : selfMarksEntered ? (
                      // A blank stays a blank in the read-only view too: the
                      // student said they made no attempt, not that they
                      // scored zero.
                      (self ?? "\u2013")
                    ) : (
                      "\u2014"
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
                {/* The same per-part mark scheme as the self-grade form, full
                    width under its part and in the same shade, so a student
                    changing a mark here to settle a disagreement can see why. */}
                {item.mark_scheme && (
                  <tr className={`${showRemark ? "" : "border-b"} ${rowShade}`}>
                    <td colSpan={5} className="px-3 pb-3">
                      <MarkSchemePart scheme={item.mark_scheme} />
                    </td>
                  </tr>
                )}
                {/* Where a student who thinks ClevMarks are wrong on this
                    part says why, and later reads the answer. */}
                {showRemark && remark && (
                  <tr className={`border-b ${rowShade}`}>
                    <td colSpan={5} className="px-3 pb-3">
                      <RemarkRequestRow
                        testItemId={item.test_item_id}
                        remark={existingRemark}
                        canAsk={canAsk}
                        mode={remark.mode}
                        canWithdraw={remark.canWithdraw}
                        savedMarkAgrees={
                          item.marks_awarded !== null && (item.self_marks ?? 0) === item.marks_awarded
                        }
                        onChange={remark.onChange}
                      />
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-da-border/40 bg-da-surface font-bold text-da-amber">
              <td className="px-3 py-2">Total</td>
              <td className="px-3 py-2 text-center">{totalMax}</td>
              <td className="px-3 py-2 text-center">{totalTeacher}</td>
              <td className="px-3 py-2 text-center">{selfMarksEntered ? totalSelf : "\u2014"}</td>
              <td className="px-3 py-2 text-center">
                {!selfMarksEntered
                  ? "\u2014"
                  : totalSelf - totalTeacher > 0
                    ? `+${totalSelf - totalTeacher}`
                    : totalSelf - totalTeacher}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {editable && onSave && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-da-accent px-4 py-2 text-sm font-bold text-da-bg hover:bg-da-amber disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
          {saveError && <p className="text-sm text-red-400">{saveError}</p>}
        </div>
      )}
    </div>
  );
}
