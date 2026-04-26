'use client';

import { useState } from 'react';
import type { Assignment, Rule, Student } from '@/lib/seating-types';

interface Props {
  assignments: Assignment[];
  rules: Rule[];
  students: Student[];
  classGroup: string;
}

export default function SeatingExplainer({ assignments, rules, students, classGroup }: Props) {
  const [open, setOpen] = useState(false);
  const [explanation, setExplanation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const classAssignments = assignments.filter((a) => a.class_group === classGroup);
  const classRules = rules.filter(
    (r) => r.active && (r.class_group === classGroup || r.class_group === '*')
  );

  const explain = async () => {
    if (!classAssignments.length) return;
    setLoading(true);
    setError('');
    setExplanation('');

    const podGroups = new Map<string, string[]>();
    classAssignments.forEach((a) => {
      if (!podGroups.has(a.pod_id)) podGroups.set(a.pod_id, []);
      podGroups.get(a.pod_id)!.push(a.name);
    });

    const seatingText = [...podGroups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([pod, names]) => `  ${pod}: ${names.join(', ')}`)
      .join('\n');

    const rulesText = classRules.length
      ? classRules
          .map((r) => {
            const nameOf = (id: string) =>
              students.find((s) => s.student_id === id)?.name ?? id;
            if (r.rule_type === 'PAIR')
              return `  PAIR: ${nameOf(r.student_a)} & ${nameOf(r.student_b)} weight=${r.weight}${r.notes ? ` (${r.notes})` : ''}`;
            if (r.rule_type === 'SEAT')
              return `  SEAT PIN: ${nameOf(r.student_id)} → seat ${r.seat_id}${r.notes ? ` (${r.notes})` : ''}`;
            if (!r.pod_id && r.weight >= 2)
              return `  MIN SIZE: ${nameOf(r.student_id)} needs ≥${r.weight} people in their pod`;
            return `  POD: ${nameOf(r.student_id)} → ${r.pod_id} weight=${r.weight}${r.notes ? ` (${r.notes})` : ''}`;
          })
          .join('\n')
      : '  (none)';

    const systemPrompt = `You are a helpful teaching assistant. Briefly explain the current classroom seating arrangement in plain, friendly language (3–5 sentences). Focus on notable groupings, rules that were applied, and any patterns worth mentioning. Keep it concise — teachers are busy.`;

    const userMessage = `CLASS: ${classGroup}

CURRENT SEATING (pod → students):
${seatingText}

RULES APPLIED:
${rulesText}

Please explain why students are seated the way they are, referencing specific pods and students where helpful.`;

    try {
      const res = await fetch('/api/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const text: string = data?.content?.[0]?.type === 'text' ? data.content[0].text : '';
      setExplanation(text || 'No explanation returned.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (!classAssignments.length) return null;

  return (
    <div className="mt-3">
      {!open ? (
        <button
          onClick={() => { setOpen(true); explain(); }}
          className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-800 hover:bg-indigo-100"
        >
          ✦ Explain this seating
        </button>
      ) : (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-indigo-900">✦ Seating Explanation</span>
            <div className="flex gap-2">
              <button
                onClick={explain}
                disabled={loading}
                className="text-xs text-indigo-600 hover:text-indigo-900 disabled:opacity-50"
              >
                {loading ? 'Thinking…' : '↺ Regenerate'}
              </button>
              <button
                onClick={() => setOpen(false)}
                className="text-indigo-400 hover:text-indigo-700 text-lg leading-none"
              >✕</button>
            </div>
          </div>

          {loading && (
            <p className="text-sm text-indigo-700 animate-pulse">Analysing seating…</p>
          )}
          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              Error: {error}
            </p>
          )}
          {explanation && (
            <p className="text-sm text-indigo-900 leading-relaxed whitespace-pre-wrap">
              {explanation}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
