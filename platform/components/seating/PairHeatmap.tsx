'use client';

import type { Assignment, Student } from '@/lib/seating-types';

interface Props {
  assignments: Assignment[];
  students: Student[];
  classGroup: string;
}

function getPairCounts(assignments: Assignment[], classGroup: string): Map<string, number> {
  const counts = new Map<string, number>();

  // Group assignments by run_id
  const byRun = new Map<string, Assignment[]>();
  assignments
    .filter((a) => a.class_group === classGroup)
    .forEach((a) => {
      if (!byRun.has(a.run_id)) byRun.set(a.run_id, []);
      byRun.get(a.run_id)!.push(a);
    });

  byRun.forEach((rows) => {
    const byPod = new Map<string, string[]>();
    rows.forEach((r) => {
      if (!byPod.has(r.pod_id)) byPod.set(r.pod_id, []);
      byPod.get(r.pod_id)!.push(r.student_id);
    });
    byPod.forEach((ids) => {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const key = ids[i] < ids[j] ? `${ids[i]}|${ids[j]}` : `${ids[j]}|${ids[i]}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
    });
  });

  return counts;
}

function colorForCount(count: number, max: number): string {
  if (count === 0) return 'bg-da-bg/70 text-da-muted';
  const intensity = Math.round((count / Math.max(max, 1)) * 4);
  switch (intensity) {
    case 1: return 'bg-amber-200 text-amber-950';
    case 2: return 'bg-amber-400 text-amber-950';
    case 3: return 'bg-orange-500 text-white';
    default: return 'bg-rose-600 text-white';
  }
}

export default function PairHeatmap({ assignments, students, classGroup }: Props) {
  const classStudents = students
    .filter((s) => s.active && (classGroup === '*' || s.class_group === classGroup))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (classStudents.length === 0) {
    return <p className="py-8 text-center italic text-da-muted">No students for {classGroup || 'this class'}.</p>;
  }

  const classAssignments = assignments.filter((a) => a.class_group === classGroup);
  const runCount = new Set(classAssignments.map((a) => a.run_id)).size;

  if (runCount === 0) {
    return <p className="py-8 text-center italic text-da-muted">No seating history yet — generate a seating to see the heatmap.</p>;
  }

  const pairCounts = getPairCounts(assignments, classGroup);
  const max = Math.max(...Array.from(pairCounts.values()), 1);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-da-muted">
          Pair frequency over <strong>{runCount}</strong> seating{runCount !== 1 ? 's' : ''}.
          Darker = sat together more often.
        </p>
        <div className="flex items-center gap-1 text-xs text-da-muted">
          <span>Rare</span>
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className={`w-5 h-5 rounded text-center text-[10px] leading-5 font-bold ${colorForCount(i, 4)}`}
            />
          ))}
          <span>Often</span>
        </div>
      </div>

      <div className="overflow-auto max-h-[70vh]">
        <table className="text-xs border-collapse">
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-20 border border-da-border bg-da-bg p-1 min-w-20" />
              {classStudents.map((s) => (
                <th
                  key={s.student_id}
                  className="sticky top-0 z-10 border border-da-border bg-da-bg p-1 font-semibold text-da-text min-w-13 max-w-13 whitespace-nowrap overflow-hidden"
                  style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', height: 64 }}
                  title={s.name}
                >
                  {s.name.split(' ')[0]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {classStudents.map((rowStudent, ri) => (
              <tr key={rowStudent.student_id}>
                <td className="sticky left-0 z-10 border border-da-border bg-da-surface px-2 py-1 font-semibold text-da-text whitespace-nowrap">
                  {rowStudent.name}
                </td>
                {classStudents.map((colStudent, ci) => {
                  if (ci === ri) {
                    return (
                      <td key={colStudent.student_id} className="h-8 w-12 border border-da-border bg-da-bg/70" />
                    );
                  }
                  const key =
                    rowStudent.student_id < colStudent.student_id
                      ? `${rowStudent.student_id}|${colStudent.student_id}`
                      : `${colStudent.student_id}|${rowStudent.student_id}`;
                  const count = pairCounts.get(key) ?? 0;
                  return (
                    <td
                      key={colStudent.student_id}
                      title={`${rowStudent.name} & ${colStudent.name}: ${count}×`}
                      className={`h-8 w-12 border border-da-border/70 text-center font-bold cursor-default select-none ${colorForCount(count, max)}`}
                    >
                      {count > 0 ? count : ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
