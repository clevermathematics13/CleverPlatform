'use client';

import type { Assignment } from '@/lib/seating-types';

interface Props {
  assignments: Assignment[];
  classGroup: string;
}

export default function History({ assignments, classGroup }: Props) {
  const relevant = assignments
    .filter((a) => a.class_group === classGroup)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const runs = new Map<string, Assignment[]>();
  relevant.forEach((a) => {
    if (!runs.has(a.run_id)) runs.set(a.run_id, []);
    runs.get(a.run_id)!.push(a);
  });

  const sortedRuns = [...runs.entries()].slice(0, 20);

  if (!sortedRuns.length) {
    return <p className="text-gray-500 italic py-4">No seating history for {classGroup || 'this class'}.</p>;
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-800 mb-3">Recent Runs ({sortedRuns.length})</h3>
      {sortedRuns.map(([runId, runAssignments]) => (
        <details key={runId} className="rounded-lg border border-gray-300 bg-white shadow-sm">
          <summary className="cursor-pointer px-4 py-3 text-sm hover:bg-gray-50">
            <span className="font-mono text-xs text-gray-800">{runId}</span>
            <span className="text-gray-600"> — {runAssignments[0]?.date} — Score: {runAssignments[0]?.candidate_score?.toFixed(2)}</span>
          </summary>
          <table className="w-full text-sm border-t border-gray-200">
            <thead>
              <tr className="bg-gray-100">
                {['Pod', 'Seat', 'Student'].map((h) => (
                  <th key={h} className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runAssignments
                .sort((a, b) => a.pod_id.localeCompare(b.pod_id) || a.seat_role.localeCompare(b.seat_role))
                .map((a, i) => (
                  <tr key={i} className="border-t border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-800">{a.pod_id}</td>
                    <td className="px-4 py-2 font-mono text-xs text-gray-700">{a.seat_id} ({a.seat_role})</td>
                    <td className="px-4 py-2 font-medium text-gray-900">{a.name}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </details>
      ))}
    </div>
  );
}
