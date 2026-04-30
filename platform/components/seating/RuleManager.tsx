'use client';

import { useState, useEffect } from 'react';
import type { Rule, Student, Seat, RuleFeedback } from '@/lib/seating-types';
import { saveRules } from '@/lib/seating-data';
import RuleAI from './RuleAI';

interface Props {
  rules: Rule[];
  students: Student[];
  seats: Seat[];
  classGroup: string;
  onSaved: () => void;
  feedback?: RuleFeedback[];
}

export default function RuleManager({ rules, students, seats, classGroup, onSaved, feedback }: Props) {
  // Only manage rules for the selected class group and global '*' rules
  const [localRules, setLocalRules] = useState<Rule[]>(() =>
    rules.filter((r) => !classGroup || r.class_group === classGroup || r.class_group === '*')
  );
  const [saving, setSaving] = useState(false);

  // Re-sync when rules prop or classGroup changes.
  // Clamp min-size rule weights to max 8 so stale DB values (e.g. 15 from
  // a mis-dragged slider) get corrected the next time the user saves.
  useEffect(() => {
    setLocalRules(
      rules
        .filter((r) => !classGroup || r.class_group === classGroup || r.class_group === '*')
        .map((r) =>
          r.rule_type === 'POD' && !r.pod_id && r.student_id && r.weight > 8
            ? { ...r, weight: 8 }
            : r
        )
    );
  }, [rules, classGroup]);

  const filteredStudents = students.filter(
    (s) => s.active && (classGroup ? s.class_group === classGroup || classGroup === '*' : true)
  );
  const pods = [...new Set(seats.filter((s) => s.active).map((s) => s.pod_id))].sort();
  const allSeats = seats.filter((s) => s.active).sort((a, b) => a.seat_id.localeCompare(b.seat_id));

  const newRule = (type: 'PAIR' | 'POD' | 'SEAT'): Rule => ({
    rule_type: type,
    class_group: classGroup || '*',
    student_a: '', student_b: '', student_id: '', pod_id: '', seat_id: '',
    weight: type === 'SEAT' ? 15 : 0, active: true, notes: '',
  });

  const update = (idx: number, field: keyof Rule, value: string | number | boolean) => {
    const updated = [...localRules];
    updated[idx] = { ...updated[idx], [field]: value };
    setLocalRules(updated);
  };

  const remove = (idx: number) => setLocalRules(localRules.filter((_, i) => i !== idx));

  const handleSave = async () => {
    setSaving(true);
    try { await saveRules(localRules); onSaved(); }
    catch (e) { alert('Save failed: ' + (e as Error).message); }
    finally { setSaving(false); }
  };

  // Map rule to feedback item by matching rule fields
  const feedbackMap = new Map<number, RuleFeedback>();
  if (feedback) {
    localRules.forEach((rule, idx) => {
      const match = feedback.find(
        (f) =>
          f.rule.rule_type === rule.rule_type &&
          f.rule.student_a === rule.student_a &&
          f.rule.student_b === rule.student_b &&
          f.rule.student_id === rule.student_id &&
          f.rule.pod_id === rule.pod_id &&
          f.rule.seat_id === rule.seat_id
      );
      if (match) feedbackMap.set(idx, match);
    });
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setLocalRules([...localRules, newRule('PAIR')])}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
        >+ Pair Rule</button>
        <button
          onClick={() => setLocalRules([...localRules, newRule('POD')])}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
        >+ Pod Rule</button>
        <button
          onClick={() => setLocalRules([...localRules, newRule('SEAT')])}
          className="rounded-lg border border-orange-300 bg-orange-50 px-3 py-1.5 text-sm text-orange-800 hover:bg-orange-100"
        >📌 Pin to Seat</button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >{saving ? 'Saving…' : 'Save Rules'}</button>
        {classGroup && (
          <span className="ml-auto self-center text-xs text-gray-500">
            Showing rules for <strong>{classGroup}</strong> + global
          </span>
        )}
      </div>

      {/* AI generator */}
      <RuleAI
        students={students}
        seats={seats}
        classGroup={classGroup}
        onRules={(newRules) => setLocalRules([...localRules, ...newRules])}
      />

      {/* Feedback summary */}
      {feedback && feedback.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
            Last generate — rule outcomes
          </p>
          <div className="space-y-1">
            {feedback.map((fb, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className={fb.satisfied ? 'text-green-600' : 'text-red-600'}>
                  {fb.satisfied ? '✓' : '✗'}
                </span>
                <span className={fb.satisfied ? 'text-gray-700' : 'text-red-700'}>
                  {fb.detail}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {localRules.length === 0 && (
        <p className="text-gray-500 italic py-4">No rules yet. Add one above.</p>
      )}

      <div className="space-y-3">
        {localRules.map((rule, idx) => {
          const fb = feedbackMap.get(idx);
          return (
            <div
              key={idx}
              className={`rounded-lg border p-4 shadow-sm ${
                !rule.active
                  ? 'opacity-50 border-gray-300 bg-white'
                  : fb
                  ? fb.satisfied
                    ? 'border-green-300 bg-green-50'
                    : 'border-red-300 bg-red-50'
                  : 'border-gray-300 bg-white'
              }`}
            >
              <div className="flex items-center gap-2 mb-3">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold uppercase ${
                  rule.rule_type === 'PAIR'
                    ? 'bg-blue-100 text-blue-900 border border-blue-300'
                    : rule.rule_type === 'SEAT'
                    ? 'bg-orange-100 text-orange-900 border border-orange-300'
                    : 'bg-green-100 text-green-900 border border-green-300'
                }`}>{rule.rule_type}</span>
                <button
                  onClick={() => update(idx, 'active', !rule.active)}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                    rule.active ? 'bg-green-100 text-green-900 border border-green-300' : 'bg-red-100 text-red-900 border border-red-300'
                  }`}
                >{rule.active ? '● ON' : '○ OFF'}</button>
                {fb && (
                  <span className={`text-xs font-semibold ${fb.satisfied ? 'text-green-700' : 'text-red-700'}`}>
                    {fb.satisfied ? '✓ satisfied' : '✗ violated'}
                  </span>
                )}
                <button onClick={() => remove(idx)} className="ml-auto text-red-500 hover:text-red-700 text-lg leading-none">✕</button>
              </div>

              <div className="flex flex-wrap gap-2 items-center">
                {rule.rule_type === 'PAIR' ? (
                  <>
                    <select value={rule.student_a} onChange={(e) => update(idx, 'student_a', e.target.value)}
                      className="rounded border border-gray-400 px-2 py-1 text-sm text-gray-800">
                      <option value="">Student A</option>
                      {filteredStudents.map((s) => (
                        <option key={s.student_id} value={s.student_id}>{s.name}</option>
                      ))}
                    </select>
                    <select value={rule.student_b} onChange={(e) => update(idx, 'student_b', e.target.value)}
                      className="rounded border border-gray-400 px-2 py-1 text-sm text-gray-800">
                      <option value="">Student B</option>
                      {filteredStudents.map((s) => (
                        <option key={s.student_id} value={s.student_id}>{s.name}</option>
                      ))}
                    </select>
                  </>
                ) : rule.rule_type === 'SEAT' ? (
                  <>
                    <select value={rule.student_id} onChange={(e) => update(idx, 'student_id', e.target.value)}
                      className="rounded border border-gray-400 px-2 py-1 text-sm text-gray-800">
                      <option value="">Student</option>
                      {filteredStudents.map((s) => (
                        <option key={s.student_id} value={s.student_id}>{s.name}</option>
                      ))}
                    </select>
                    <span className="text-sm text-gray-500">📌 pinned to</span>
                    <select value={rule.seat_id} onChange={(e) => update(idx, 'seat_id', e.target.value)}
                      className="rounded border border-gray-400 px-2 py-1 text-sm text-gray-800">
                      <option value="">Seat</option>
                      {allSeats.map((s) => (
                        <option key={s.seat_id} value={s.seat_id}>{s.seat_id} ({s.pod_id} · {s.seat_role})</option>
                      ))}
                    </select>
                  </>
                ) : rule.pod_id === '' && rule.student_id ? (
                  <>
                    <select value={rule.student_id} onChange={(e) => update(idx, 'student_id', e.target.value)}
                      className="rounded border border-gray-400 px-2 py-1 text-sm text-gray-800">
                      <option value="">Student</option>
                      {filteredStudents.map((s) => (
                        <option key={s.student_id} value={s.student_id}>{s.name}</option>
                      ))}
                    </select>
                    <span className="text-sm text-gray-600">min</span>
                    <input
                      type="number" min="2" max="8" step="1"
                      value={Math.min(Math.max(rule.weight, 2), 8)}
                      onChange={(e) => update(idx, 'weight', Math.min(Math.max(Number(e.target.value), 2), 8))}
                      className="w-14 rounded border border-orange-300 bg-orange-50 px-2 py-1 text-sm font-semibold text-orange-800 text-center"
                    />
                    <span className="text-sm text-gray-600">people in pod</span>
                    <span className="rounded border border-orange-300 bg-orange-50 px-2 py-1 text-xs font-semibold text-orange-700">🔒 Always Hard</span>
                  </>
                ) : (
                  <>
                    <select value={rule.student_id} onChange={(e) => update(idx, 'student_id', e.target.value)}
                      className="rounded border border-gray-400 px-2 py-1 text-sm text-gray-800">
                      <option value="">Student</option>
                      {filteredStudents.map((s) => (
                        <option key={s.student_id} value={s.student_id}>{s.name}</option>
                      ))}
                    </select>
                    <select value={rule.pod_id} onChange={(e) => update(idx, 'pod_id', e.target.value)}
                      className="rounded border border-gray-400 px-2 py-1 text-sm text-gray-800">
                      <option value="">Pod</option>
                      {pods.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </>
                )}

                {rule.rule_type !== 'SEAT' && !(rule.rule_type === 'POD' && !rule.pod_id && rule.student_id) && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-700">Weight</span>
                    <input
                      type="range" min="-15" max="15" step="1" value={rule.weight}
                      onChange={(e) => update(idx, 'weight', Number(e.target.value))}
                      className="w-28"
                    />
                    <span className={`text-sm font-bold w-20 text-center ${
                      rule.weight > 0 ? 'text-teal-700' : rule.weight < 0 ? 'text-orange-600' : 'text-gray-500'
                    }`}>
                      {Math.abs(rule.weight) >= 15
                        ? (rule.weight > 0
                          ? (rule.rule_type === 'PAIR' ? '🔒 TOGETHER' : '🔒 ALWAYS')
                          : (rule.rule_type === 'PAIR' ? '🔒 APART' : '🔒 NEVER'))
                        : `${rule.weight > 0 ? '+' : ''}${rule.weight}`}
                    </span>
                  </div>
                )}

                <input
                  type="text" placeholder="Notes (optional)" value={rule.notes}
                  onChange={(e) => update(idx, 'notes', e.target.value)}
                  className="flex-1 min-w-24 rounded border border-gray-400 px-2 py-1 text-sm text-gray-800"
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
