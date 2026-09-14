'use client';

import { useRef } from 'react';
import { EXAM_COLUMNS, summariseExamRun } from '@/lib/seating-exam';
import type { Assignment, Gender, Student } from '@/lib/seating-types';

interface Props {
  /** Rows of one assessment run - the newest one for this class. */
  assignments: Assignment[];
  students: Student[];
  classGroup: string;
}

/**
 * The chart shows names and nothing else. Gender drives where a student is
 * seated, but it is not the teacher's to put on a wall or in an exported
 * image, so nothing here renders it - no letter under the name, no colour
 * standing in for one, and no marker on the desks that had to break the
 * pattern, which would give away the occupant's gender by elimination. The
 * count above the chart says how well the pattern held without naming anyone.
 */
export default function ExamSeatingChart({ assignments, students, classGroup }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);

  const genderOf = new Map<string, Gender>(students.map((s) => [s.student_id, s.gender]));
  const summary = summariseExamRun(assignments, genderOf);

  if (!assignments.length) {
    return (
      <p className="text-da-muted italic py-8 text-center">
        No assessment seating for {classGroup || 'this class'} yet — press Generate Exam Seating.
      </p>
    );
  }

  const rows = new Map<number, Assignment[]>();
  assignments.forEach((a) => {
    const row = Number(a.y);
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row)!.push(a);
  });
  const rowNumbers = [...rows.keys()].sort((a, b) => a - b);

  const exportImage = async () => {
    if (!canvasRef.current) return;
    try {
      const { toPng } = await import('html-to-image');
      const dataUrl = await toPng(canvasRef.current, { backgroundColor: '#0f0b0d' });
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `assessment-seating-${classGroup || 'chart'}-${new Date().toISOString().slice(0, 10)}.png`;
      a.click();
    } catch (e) {
      alert('Export failed: ' + (e as Error).message);
    }
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs text-da-muted">
          {summary.matched} of {summary.total} desks follow the alternating pattern
          {summary.mismatched > 0 && ` — ${summary.mismatched} could not (the class does not split evenly)`}
          {summary.unset > 0 && ` — ${summary.unset} not set in the Students tab`}
        </p>
        <button
          onClick={exportImage}
          className="shrink-0 rounded-lg border border-da-border px-3 py-1.5 text-xs font-medium text-da-text hover:bg-da-hover"
        >
          ↓ Export image
        </button>
      </div>

      <div ref={canvasRef} className="rounded-lg border border-dashed border-da-border bg-da-bg/40 p-4">
        <div className="mb-4 rounded border border-da-border bg-da-hover py-1.5 text-center text-[11px] font-bold uppercase tracking-[0.2em] text-da-muted">
          Front of room
        </div>

        <div className="mx-auto flex max-w-2xl flex-col gap-2">
          {rowNumbers.map((row) => {
            const seats = new Map(rows.get(row)!.map((a) => [Number(a.x), a]));
            return (
              <div key={row} className="flex items-center gap-2">
                <span className="w-10 shrink-0 text-right text-[10px] font-semibold uppercase tracking-wide text-da-muted">
                  Row {row}
                </span>
                <div className="grid flex-1 grid-cols-3 gap-2">
                  {Array.from({ length: EXAM_COLUMNS }, (_, i) => i + 1).map((col) => {
                    const a = seats.get(col);
                    if (!a) {
                      // Only the back row can have a gap: its left-hand desk
                      // does not exist, and its right-hand one is simply spare
                      // when the class leaves a single student for that row.
                      return (
                        <div
                          key={col}
                          className="rounded border border-dashed border-da-border/60 bg-transparent p-2 text-center text-xs text-da-muted/50"
                        >
                          {col === 1 ? 'no desk' : 'empty'}
                        </div>
                      );
                    }
                    return (
                      <div
                        key={col}
                        title={a.seat_id}
                        className="rounded border border-da-accent/40 bg-da-accent/20 p-2 text-center"
                      >
                        <span className="block truncate text-xs font-semibold text-da-text">{a.name}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
