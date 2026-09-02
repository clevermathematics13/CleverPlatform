'use client';

import type { Student } from '@/lib/seating-types';

interface Props {
  students: Student[];
  classGroup: string;
}

export default function StudentList({ students, classGroup }: Props) {
  const filtered = students.filter((s) => s.class_group === classGroup && s.active);

  if (!filtered.length) {
    return <p className="text-da-muted italic py-4">No active students for {classGroup || 'this class'}.</p>;
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-da-text mb-3">Students ({filtered.length})</h3>
      <div className="overflow-hidden rounded-lg border border-da-border bg-da-surface shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-da-hover">
            <tr>
              {['#', 'ID', 'Name', 'Notes'].map((h) => (
                <th key={h} className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-da-text">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((s, i) => (
              <tr key={s.student_id} className="border-t border-da-border hover:bg-da-hover">
                <td className="px-4 py-2 text-da-muted">{i + 1}</td>
                <td className="px-4 py-2 font-mono text-xs text-da-text">{s.student_id}</td>
                <td className="px-4 py-2 font-medium text-da-text">{s.name}</td>
                <td className="px-4 py-2 text-da-muted">{s.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
