/**
 * The teacher's read of one answer, as the student sees it.
 *
 * A server component: nothing here is interactive, and the student can only
 * ever read it. The write direction is teachers-only at the RLS, so there is
 * deliberately no control on this card for a student to reply with.
 *
 * The wording is the student's, not the database's. "not_yet" is shown as
 * "Not there yet" because a verdict a teacher picks in a marking queue and a
 * verdict a fifteen-year-old reads about their own work are not the same
 * sentence, even when they are the same value.
 */

import type { PracticeFeedback } from "@/lib/practice-sets";

const TONE: Record<PracticeFeedback["verdict"], { label: string; className: string }> = {
  correct: {
    label: "Correct",
    className: "border-da-success/50 bg-da-success/10 text-da-success",
  },
  almost: {
    label: "Almost",
    className: "border-da-warning/50 bg-da-warning/10 text-da-warning",
  },
  not_yet: {
    label: "Not there yet",
    className: "border-da-danger/50 bg-da-danger/10 text-da-danger",
  },
};

export default function AnswerFeedback({ feedback }: { feedback: PracticeFeedback }) {
  const tone = TONE[feedback.verdict];

  return (
    <div className="mt-2 rounded-md border border-da-border/70 bg-da-surface/60 px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono text-[10px] uppercase tracking-wider text-da-muted/70">
          Your teacher
        </span>
        <span className={`rounded border px-2 py-0.5 text-xs ${tone.className}`}>{tone.label}</span>
        {/* Said plainly rather than hidden: a comment that does not match what
            is in the box is confusing, and the reason is not the student's
            fault. */}
        {feedback.stale && (
          <span className="text-[11px] text-da-muted">
            on an earlier version of this answer
          </span>
        )}
      </div>
      {feedback.note && (
        <p className="mt-1.5 text-sm leading-relaxed text-da-text">{feedback.note}</p>
      )}
    </div>
  );
}
