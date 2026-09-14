'use client';

import { useState } from 'react';
import { setStudentGender } from '@/lib/seating-data';
import type { Gender, Student } from '@/lib/seating-types';

interface Props {
  students: Student[];
  classGroup: string;
  /** Called after a gender is saved, so the generator sees the new value. */
  onGenderSaved: () => void;
}

const CHOICES: { value: Gender; label: string; title: string }[] = [
  { value: 'B', label: 'B', title: 'Seat in the B positions of the alternating pattern' },
  { value: 'G', label: 'G', title: 'Seat in the G positions of the alternating pattern' },
  { value: '', label: '—', title: 'Not set - seat wherever the pattern has slack' },
];

export default function StudentList({ students, classGroup, onGenderSaved }: Props) {
  const filtered = students.filter((s) => s.class_group === classGroup && s.active);

  /** Shown immediately on click; the reload behind it is what makes it stick. */
  const [pending, setPending] = useState<Record<string, Gender>>({});
  const [saving, setSaving] = useState('');

  const save = async (student: Student, gender: Gender) => {
    if ((pending[student.student_id] ?? student.gender) === gender) return;
    setPending((p) => ({ ...p, [student.student_id]: gender }));
    setSaving(student.student_id);
    try {
      await setStudentGender(student.student_id, gender);
      onGenderSaved();
    } catch (e) {
      setPending((p) => {
        const next = { ...p };
        delete next[student.student_id];
        return next;
      });
      alert('Could not save: ' + (e as Error).message);
    } finally {
      setSaving('');
    }
  };

  if (!filtered.length) {
    return <p className="text-da-muted italic py-4">No active students for {classGroup || 'this class'}.</p>;
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-da-text mb-1">Students ({filtered.length})</h3>
      <p className="mb-3 text-xs text-da-muted">
        B/G is used only by assessment seating, which alternates genders along each row.
      </p>
      <div className="overflow-hidden rounded-lg border border-da-border bg-da-surface shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-da-hover">
            <tr>
              {['#', 'ID', 'Name', 'B/G', 'Notes'].map((h) => (
                <th key={h} className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-da-text">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((s, i) => {
              const gender = pending[s.student_id] ?? s.gender;
              return (
                <tr key={s.student_id} className="border-t border-da-border hover:bg-da-hover">
                  <td className="px-4 py-2 text-da-muted">{i + 1}</td>
                  <td className="px-4 py-2 font-mono text-xs text-da-text">{s.student_id}</td>
                  <td className="px-4 py-2 font-medium text-da-text">{s.name}</td>
                  <td className="px-4 py-2">
                    <div
                      className={`inline-flex overflow-hidden rounded-md border border-da-border ${
                        saving === s.student_id ? 'opacity-50' : ''
                      }`}
                    >
                      {CHOICES.map((choice) => (
                        <button
                          key={choice.label}
                          type="button"
                          title={choice.title}
                          aria-pressed={gender === choice.value}
                          disabled={saving === s.student_id}
                          onClick={() => save(s, choice.value)}
                          className={`w-8 py-1 text-xs font-semibold transition-colors ${
                            gender === choice.value
                              ? 'bg-da-accent text-da-on-accent'
                              : 'text-da-muted hover:bg-da-hover hover:text-da-text'
                          }`}
                        >
                          {choice.label}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-da-muted">{s.notes}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
