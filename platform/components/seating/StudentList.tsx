'use client';

import type { Student } from '@/lib/seating-types';

interface Props {
  students: Student[];
  classGroup: string;
}

export default function StudentList({ students, classGroup }: Props) {
  const filtered = students.filter((s) => s.class_group === classGroup && s.active);

  if (!filtered.length) {
    return <p className="text-gray-500 italic py-4">No active students for {classGroup || 'this class'}.</p>;
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-800 mb-3">Students ({filtered.length})</h3>
      <div className="overflow-hidden rounded-lg border border-gray-300 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              {['#', 'ID', 'Name', 'Notes'].map((h) => (
                <th key={h} className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((s, i) => (
              <tr key={s.student_id} className="border-t border-gray-200 hover:bg-gray-50">
                <td className="px-4 py-2 text-gray-600">{i + 1}</td>
                <td className="px-4 py-2 font-mono text-xs text-gray-700">{s.student_id}</td>
                <td className="px-4 py-2 font-medium text-gray-900">{s.name}</td>
                <td className="px-4 py-2 text-gray-600">{s.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
