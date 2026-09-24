"use client";

/**
 * The marking screen.
 *
 * Two views over the same data, because there are two different questions a
 * teacher asks. "By question" is the default and the one that makes this
 * screen worth building: pick a question, read the class's answers to one part
 * side by side, mark them. "By student" is for when the question really is
 * about one person.
 *
 * Only the selected question's answers are mounted. A thirteen-question set
 * for fourteen students is 364 answer cells, and rendering every one of them
 * through KaTeX on first paint would cost seconds for work the teacher is not
 * looking at yet.
 *
 * Every mutation goes through router.refresh(): the server page stays the
 * single source of what is on screen, so a second tab, a student editing an
 * answer mid-marking, or a failed write all resolve to whatever the database
 * actually holds rather than to a local copy that has drifted.
 *
 * The one exception is the verdict button the teacher just clicked, which
 * shows as pressed immediately. That refresh re-runs the whole page -- roster,
 * every answer, every mark -- and takes a second or two on a full class;
 * leaving the button visually untouched for that long invites a second click.
 * It is display only, it is dropped the moment the server replies, and it is
 * reverted if the write failed. Nothing durable is inferred from it.
 */

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import LatexRenderer from "@/components/LatexRenderer";
import {
  VERDICTS,
  VERDICT_LABEL,
  verdictTally,
  type StudentAnswerCell,
  type Verdict,
} from "@/lib/practice-marking";
import type { MarkingPart, MarkingQuestion, MarkingView } from "@/lib/practice-marking-service";
import {
  rollUpByTopic,
  totalTally,
  weakestFirst,
  type RollupCell,
  type SubtopicNode,
} from "@/lib/practice-topic-rollup";

const VERDICT_STYLE: Record<Verdict, string> = {
  correct: "border-da-success/60 bg-da-success/15 text-da-success",
  almost: "border-da-warning/60 bg-da-warning/15 text-da-warning",
  not_yet: "border-da-danger/60 bg-da-danger/15 text-da-danger",
};

function ProgressLine({
  answered,
  marked,
  stale,
  onRoster,
}: {
  answered: number;
  marked: number;
  stale: number;
  onRoster: number;
}) {
  return (
    <span className="font-mono text-xs tracking-wide text-da-muted">
      {answered}/{onRoster} answered &middot;{" "}
      <span className={marked === answered && answered > 0 ? "text-da-success" : undefined}>
        {marked} read
      </span>
      {stale > 0 && <span className="text-da-warning"> &middot; {stale} changed since</span>}
    </span>
  );
}

function AnswerCard({
  cell,
  onMarked,
}: {
  cell: StudentAnswerCell;
  onMarked: () => void;
}) {
  const [note, setNote] = useState(cell.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(!!cell.note);
  // What the teacher just clicked, shown as pressed straight away, because
  // router.refresh() re-runs the whole page and a button that looks untouched
  // for a second or two invites a second click.
  //
  // It carries a snapshot of what the server was showing when the click
  // happened, so it expires on its own: the moment a refresh changes
  // cell.verdict the snapshot stops matching and the server wins. No reset, no
  // effect, and nothing left stale if a refresh never arrives.
  const [pending, setPending] = useState<{ verdict: Verdict; serverWas: Verdict | null } | null>(
    null
  );
  const shown = pending && pending.serverWas === cell.verdict ? pending.verdict : cell.verdict;

  const save = useCallback(
    async (verdict: Verdict, nextNote: string) => {
      if (!cell.answerId) return;
      setPending({ verdict, serverWas: cell.verdict });
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/practice-marks", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ answerId: cell.answerId, verdict, note: nextNote }),
        });
        if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "Failed");
        onMarked();
      } catch (e) {
        // The click did not stick, so stop showing it as though it had.
        setPending(null);
        setError(e instanceof Error ? e.message : "Could not save");
      } finally {
        setBusy(false);
      }
    },
    [cell.answerId, cell.verdict, onMarked]
  );

  const clear = useCallback(async () => {
    if (!cell.answerId) return;
    setBusy(true);
    setError(null);
    setPending(null);
    try {
      const res = await fetch(`/api/practice-marks?answerId=${cell.answerId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Could not clear");
      onMarked();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not clear");
    } finally {
      setBusy(false);
    }
  }, [cell.answerId, onMarked]);

  if (cell.empty) {
    return (
      <li className="flex items-baseline justify-between gap-3 rounded-lg border border-dashed border-da-border/60 px-3 py-2">
        <span className="text-sm text-da-muted">{cell.fullName}</span>
        <span className="font-mono text-[11px] text-da-muted/60">
          {cell.profileId ? "nothing written" : "has not signed in"}
        </span>
      </li>
    );
  }

  return (
    <li className="rounded-lg border border-da-border bg-da-surface p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-medium text-da-text">{cell.fullName}</span>
        {cell.stale && (
          <span className="font-mono text-[11px] text-da-warning">
            changed since you read it
          </span>
        )}
      </div>

      <div className="overflow-x-auto rounded-md bg-da-bg/60 px-3 py-2 text-da-text">
        <LatexRenderer latex={`$${cell.answerLatex}$`} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {VERDICTS.map((verdict) => (
          <button
            key={verdict}
            type="button"
            disabled={busy}
            onClick={() => void save(verdict, note)}
            aria-pressed={shown === verdict}
            className={[
              "rounded-md border px-2.5 py-1 text-xs transition-colors disabled:opacity-50",
              shown === verdict
                ? VERDICT_STYLE[verdict]
                : "border-da-border text-da-muted hover:border-da-accent/50 hover:text-da-text",
            ].join(" ")}
          >
            {VERDICT_LABEL[verdict]}
          </button>
        ))}

        <button
          type="button"
          onClick={() => setNoteOpen((open) => !open)}
          className="rounded-md border border-da-border px-2.5 py-1 text-xs text-da-muted hover:border-da-accent/50 hover:text-da-text"
        >
          {cell.note ? "Note" : "Add note"}
        </button>

        {shown && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void clear()}
            className="rounded-md px-2 py-1 text-xs text-da-muted/70 hover:text-da-danger disabled:opacity-50"
          >
            Clear
          </button>
        )}

        {busy && <span className="text-xs text-da-muted">Saving&hellip;</span>}
        {error && <span className="text-xs text-da-danger">{error}</span>}
      </div>

      {noteOpen && (
        <div className="mt-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="One line for this student, if it helps."
            className="w-full rounded-md border border-da-border bg-da-bg px-2 py-1.5 text-sm text-da-text placeholder:text-da-muted/50 focus:border-da-accent focus:outline-none"
          />
          <button
            type="button"
            disabled={busy || !shown}
            onClick={() => shown && void save(shown, note)}
            title={shown ? undefined : "Pick correct, almost or not yet first"}
            className="mt-1 rounded-md border border-da-border px-2.5 py-1 text-xs text-da-muted hover:border-da-accent/50 hover:text-da-text disabled:opacity-50"
          >
            Save note
          </button>
        </div>
      )}
    </li>
  );
}

function PartBlock({ part, onMarked }: { part: MarkingPart; onMarked: () => void }) {
  const tally = useMemo(() => verdictTally(part.cells), [part.cells]);

  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-da-border pb-2">
        <h3 className="font-serif text-lg font-bold text-da-text">
          {part.partLabel ? `Part ${part.partLabel}` : "Answers"}
        </h3>
        <div className="flex flex-wrap items-baseline gap-x-3">
          <ProgressLine {...part.progress} />
          {part.progress.marked > 0 && (
            <span className="font-mono text-xs">
              <span className="text-da-success">{tally.correct} correct</span>
              {" · "}
              <span className="text-da-warning">{tally.almost} almost</span>
              {" · "}
              <span className="text-da-danger">{tally.not_yet} not yet</span>
            </span>
          )}
        </div>
      </div>
      <ul className="mt-3 space-y-2">
        {part.cells.map((cell) => (
          <AnswerCard key={cell.invitedId} cell={cell} onMarked={onMarked} />
        ))}
      </ul>
    </section>
  );
}

function QuestionStem({ question }: { question: MarkingQuestion }) {
  return (
    <div className="rounded-lg border border-da-border bg-da-surface p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <span className="font-serif text-lg font-bold text-da-accent">{question.position}.</span>
          {question.subtopics.map((s) => (
            <span key={s} className="text-sm text-da-text">
              {s}
            </span>
          ))}
        </div>
        <span className="font-mono text-sm text-da-muted">[{question.marks}]</span>
      </div>
      {question.questionLatex ? (
        <div className="rounded-md bg-da-bg/60 px-3 py-2 text-da-text">
          <LatexRenderer latex={question.questionLatex} />
        </div>
      ) : (
        question.imageUrls.map((url) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={url}
            src={url}
            alt={`Question ${question.position}`}
            className="mx-auto h-auto max-w-full rounded-md bg-white"
          />
        ))
      )}
    </div>
  );
}

export function MarkingClient({ view }: { view: MarkingView }) {
  const router = useRouter();
  const [mode, setMode] = useState<"question" | "student" | "topic">("question");
  const [selectedItemId, setSelectedItemId] = useState(view.questions[0]?.itemId ?? "");
  const [selectedInvitedId, setSelectedInvitedId] = useState(view.students[0]?.invitedId ?? "");

  const onMarked = useCallback(() => router.refresh(), [router]);

  const question = view.questions.find((q) => q.itemId === selectedItemId) ?? view.questions[0];

  if (view.questions.length === 0) {
    return (
      <div className="rounded-xl border border-da-border bg-da-surface p-8 text-center">
        <h1 className="font-serif text-2xl font-bold text-da-text">{view.setName}</h1>
        <p className="mt-3 text-sm text-da-muted">
          This set has no questions yet, so there is nothing to mark.
        </p>
      </div>
    );
  }

  return (
    <>
      <header>
        <h1 className="font-serif text-3xl font-bold text-da-text">{view.setName}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1">
          <span className="font-mono text-xs tracking-wide text-da-muted">{view.courseName}</span>
          <ProgressLine {...view.progress} />
          {!view.releasedAt && (
            <span className="font-mono text-xs text-da-warning">
              not released &mdash; the class cannot see this set yet
            </span>
          )}
        </div>
        {/* Said once, at the top, because a screen with three coloured verdict
            buttons looks like a grading screen and this one deliberately is
            not. */}
        <p className="mt-3 max-w-2xl text-xs leading-relaxed text-da-muted/80">
          Practice, not assessment: nothing here is a score, and nothing reaches ClevMarks
          or the gradebook.{" "}
          {view.feedbackReleasedAt ? (
            <span className="text-da-warning">
              Feedback is shared &mdash; each student can see what you write on their own answers,
              as soon as you write it.
            </span>
          ) : (
            <span>
              Feedback is private: students cannot see any of this until you share it from the
              Practice Sets page.
            </span>
          )}
        </p>
      </header>

      <div className="mt-6 flex gap-2" role="tablist" aria-label="Marking view">
        {(["question", "student", "topic"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={
              mode === m
                ? "rounded-full border border-da-accent bg-da-accent/15 px-3 py-1 text-xs font-medium text-da-text"
                : "rounded-full border border-da-border px-3 py-1 text-xs text-da-muted hover:border-da-accent/50 hover:text-da-text"
            }
          >
            {m === "question" ? "By question" : m === "student" ? "By student" : "By topic"}
          </button>
        ))}
      </div>

      {mode === "question" ? (
        <div className="mt-5 grid gap-6 md:grid-cols-[13rem_1fr]">
          <nav aria-label="Questions" className="flex flex-wrap gap-1.5 md:flex-col">
            {view.questions.map((q) => {
              const done = q.progress.answered > 0 && q.progress.marked === q.progress.answered;
              return (
                <button
                  key={q.itemId}
                  type="button"
                  onClick={() => setSelectedItemId(q.itemId)}
                  aria-current={q.itemId === question.itemId}
                  className={[
                    "flex items-baseline justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors",
                    q.itemId === question.itemId
                      ? "border-da-accent bg-da-accent/10 text-da-text"
                      : "border-da-border text-da-muted hover:border-da-accent/50 hover:text-da-text",
                  ].join(" ")}
                >
                  <span>Question {q.position}</span>
                  <span
                    className={
                      done ? "font-mono text-[10px] text-da-success" : "font-mono text-[10px] text-da-muted/70"
                    }
                  >
                    {q.progress.marked}/{q.progress.answered}
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="min-w-0">
            <QuestionStem question={question} />
            {question.parts.map((part) => (
              <PartBlock key={part.partLabel} part={part} onMarked={onMarked} />
            ))}
          </div>
        </div>
      ) : mode === "student" ? (
        <ByStudent
          view={view}
          selectedInvitedId={selectedInvitedId}
          onSelect={setSelectedInvitedId}
          onMarked={onMarked}
        />
      ) : (
        <ByTopic view={view} />
      )}
    </>
  );
}

function ByStudent({
  view,
  selectedInvitedId,
  onSelect,
  onMarked,
}: {
  view: MarkingView;
  selectedInvitedId: string;
  onSelect: (id: string) => void;
  onMarked: () => void;
}) {
  const student = view.students.find((s) => s.invitedId === selectedInvitedId) ?? view.students[0];

  if (!student) {
    return (
      <p className="mt-6 rounded-lg border border-da-border bg-da-surface p-6 text-sm text-da-muted">
        This course has no students on its roster.
      </p>
    );
  }

  return (
    <div className="mt-5 grid gap-6 md:grid-cols-[13rem_1fr]">
      <nav aria-label="Students" className="flex flex-wrap gap-1.5 md:flex-col">
        {view.students.map((s) => (
          <button
            key={s.invitedId}
            type="button"
            onClick={() => onSelect(s.invitedId)}
            aria-current={s.invitedId === student.invitedId}
            className={[
              "rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors",
              s.invitedId === student.invitedId
                ? "border-da-accent bg-da-accent/10 text-da-text"
                : "border-da-border text-da-muted hover:border-da-accent/50 hover:text-da-text",
            ].join(" ")}
          >
            {s.fullName}
          </button>
        ))}
      </nav>

      <div className="min-w-0 space-y-6">
        {view.questions.map((q) => (
          <div key={q.itemId}>
            <QuestionStem question={q} />
            {q.parts.map((part) => {
              const cell = part.cells.find((c) => c.invitedId === student.invitedId);
              if (!cell) return null;
              return (
                <div key={part.partLabel} className="mt-3">
                  {part.partLabel && (
                    <h3 className="mb-1 font-mono text-xs tracking-wide text-da-muted">
                      Part {part.partLabel}
                    </h3>
                  )}
                  <ul>
                    <AnswerCard cell={cell} onMarked={onMarked} />
                  </ul>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * What the class does not have yet, by topic rather than by question.
 *
 * The other two tabs answer "how did question 7 go" and "how is Camilla
 * doing". This one answers the question a teacher actually plans Monday from:
 * which piece of mathematics is this class missing. It counts the three
 * spellings of a topic together -- 5.16, 5.16.4 and "5.16 (parts)" are all
 * further integration -- which only became possible once every subtopic had a
 * parent.
 *
 * Weakest first, and no percentage anywhere: with fourteen students a
 * percentage invents precision, and this is practice, which does not get
 * scored.
 */
function ByTopic({ view }: { view: MarkingView }) {
  const rollups = useMemo(() => {
    const cells: RollupCell[] = [];
    for (const question of view.questions) {
      for (const part of question.parts) {
        for (const cell of part.cells) {
          cells.push({
            studentName: cell.fullName,
            verdict: cell.verdict,
            answered: !cell.empty,
            subtopicCodes: question.subtopicCodes,
          });
        }
      }
    }
    const index = new Map<string, SubtopicNode>(Object.entries(view.subtopicIndex));
    return weakestFirst(rollUpByTopic(cells, index));
  }, [view]);

  const total = useMemo(() => totalTally(rollups), [rollups]);
  const anythingRead = total.correct + total.almost + total.not_yet > 0;

  if (rollups.length === 0) {
    return (
      <p className="mt-6 rounded-lg border border-da-border bg-da-surface p-6 text-sm text-da-muted">
        Nobody has written an answer yet, so there is nothing to group by topic.
      </p>
    );
  }

  return (
    <div className="mt-5 space-y-3">
      <p className="font-mono text-xs tracking-wide text-da-muted">
        {anythingRead ? (
          <>
            <span className="text-da-success">{total.correct} correct</span>
            {" · "}
            <span className="text-da-warning">{total.almost} almost</span>
            {" · "}
            <span className="text-da-danger">{total.not_yet} not yet</span>
            {" · weakest first"}
          </>
        ) : (
          "Answers are in, but none has been read yet -- mark some and this orders itself."
        )}
      </p>

      {rollups.map((r) => {
        const width = (n: number) => (r.marked === 0 ? 0 : Math.round((n / r.marked) * 100));
        return (
          <section
            key={r.topicCode}
            className="rounded-lg border border-da-border bg-da-surface p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 className="font-serif text-lg font-bold text-da-text">
                {r.topicName}{" "}
                <span className="font-mono text-xs font-normal text-da-muted">{r.topicCode}</span>
              </h3>
              <span className="font-mono text-xs text-da-muted">
                {r.answered} answered &middot; {r.marked} read
              </span>
            </div>

            {/* The codes that rolled up, so it is never a mystery what was
                counted together. */}
            {r.childCodes.length > 1 && (
              <p className="mt-1 font-mono text-[11px] text-da-muted/70">
                {r.childCodes.join(" · ")}
              </p>
            )}

            {r.marked > 0 && (
              <>
                <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-da-bg">
                  <div className="bg-da-success" style={{ width: `${width(r.tally.correct)}%` }} />
                  <div className="bg-da-warning" style={{ width: `${width(r.tally.almost)}%` }} />
                  <div className="bg-da-danger" style={{ width: `${width(r.tally.not_yet)}%` }} />
                </div>
                <p className="mt-1.5 font-mono text-xs">
                  <span className="text-da-success">{r.tally.correct} correct</span>
                  {" · "}
                  <span className="text-da-warning">{r.tally.almost} almost</span>
                  {" · "}
                  <span className="text-da-danger">{r.tally.not_yet} not yet</span>
                </p>
              </>
            )}

            {r.notYetStudents.length > 0 && (
              <p className="mt-2 text-sm text-da-text">
                <span className="text-da-muted">Not there yet: </span>
                {r.notYetStudents.join(", ")}
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
