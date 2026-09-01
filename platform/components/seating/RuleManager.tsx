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
          className="rounded-lg border border-da-border px-3 py-1.5 text-sm hover:bg-da-hover"
        >+ Pair Rule</button>
        <button
          onClick={() => setLocalRules([...localRules, newRule('POD')])}
          className="rounded-lg border border-da-border px-3 py-1.5 text-sm hover:bg-da-hover"
        >+ Pod Rule</button>
        <button
          onClick={() => setLocalRules([...localRules, newRule('SEAT')])}
          className="rounded-lg border border-da-warning/40 bg-da-warning/15 px-3 py-1.5 text-sm text-da-warning hover:bg-da-warning/25"
        >📌 Pin to Seat</button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-da-accent px-4 py-1.5 text-sm font-semibold text-[#2b1408] hover:bg-da-amber disabled:opacity-50"
        >{saving ? 'Saving…' : 'Save Rules'}</button>
        {classGroup && (
          <span className="ml-auto self-center text-xs text-da-muted">
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
        <div className="rounded-lg border border-da-border bg-da-hover p-3">
          <p className="text-xs font-semibold text-da-muted uppercase tracking-wide mb-2">
            Last generate — rule outcomes
          </p>
          <div className="space-y-1">
            {feedback.map((fb, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className={fb.satisfied ? 'text-da-success' : 'text-da-danger'}>
                  {fb.satisfied ? '✓' : '✗'}
                </span>
                <span className={fb.satisfied ? 'text-da-text' : 'text-da-danger'}>
                  {fb.detail}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {localRules.length === 0 && (
        <p className="text-da-muted italic py-4">No rules yet. Add one above.</p>
      )}

      <div className="space-y-3">
        {localRules.map((rule, idx) => {
          const fb = feedbackMap.get(idx);
          return (
            <div
              key={idx}
              className={`rounded-lg border p-4 shadow-sm ${
                !rule.active
                  ? 'opacity-50 border-da-border bg-da-surface'
                  : fb
                  ? fb.satisfied
                    ? 'border-da-success/40 bg-da-success/10'
                    : 'border-da-danger/40 bg-da-danger/10'
                  : 'border-da-border bg-da-surface'
              }`}
            >
              <div className="flex items-center gap-2 mb-3">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold uppercase ${
                  rule.rule_type === 'PAIR'
                    ? 'bg-da-info/20 text-da-info border border-da-info/40'
                    : rule.rule_type === 'SEAT'
                    ? 'bg-da-warning/20 text-da-warning border border-da-warning/40'
                    : 'bg-da-success/20 text-da-success border border-da-success/40'
                }`}>{rule.rule_type}</span>
                <button
                  onClick={() => update(idx, 'active', !rule.active)}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                    rule.active ? 'bg-da-success/20 text-da-success border border-da-success/40' : 'bg-da-danger/20 text-da-danger border border-da-danger/40'
                  }`}
                >{rule.active ? '● ON' : '○ OFF'}</button>
                {fb && (
                  <span className={`text-xs font-semibold ${fb.satisfied ? 'text-da-success' : 'text-da-danger'}`}>
                    {fb.satisfied ? '✓ satisfied' : '✗ violated'}
                  </span>
                )}
                <button onClick={() => remove(idx)} className="ml-auto text-da-danger hover:opacity-80 text-lg leading-none">✕</button>
              </div>

              <div className="flex flex-wrap gap-2 items-center">
                {rule.rule_type === 'PAIR' ? (
                  <>
                    <select value={rule.student_a} onChange={(e) => update(idx, 'student_a', e.target.value)}
                      className="rounded border border-da-border px-2 py-1 text-sm text-da-text">
                      <option value="">Student A</option>
                      {filteredStudents.map((s) => (
                        <option key={s.student_id} value={s.student_id}>{s.name}</option>
                      ))}
                    </select>
                    <select value={rule.student_b} onChange={(e) => update(idx, 'student_b', e.target.value)}
                      className="rounded border border-da-border px-2 py-1 text-sm text-da-text">
                      <option value="">Student B</option>
                      {filteredStudents.map((s) => (
                        <option key={s.student_id} value={s.student_id}>{s.name}</option>
                      ))}
                    </select>
                  </>
                ) : rule.rule_type === 'SEAT' ? (
                  <>
                    <select value={rule.student_id} onChange={(e) => update(idx, 'student_id', e.target.value)}
                      className="rounded border border-da-border px-2 py-1 text-sm text-da-text">
                      <option value="">Student</option>
                      {filteredStudents.map((s) => (
                        <option key={s.student_id} value={s.student_id}>{s.name}</option>
                      ))}
                    </select>
                    <span className="text-sm text-da-muted">📌 pinned to</span>
                    <select value={rule.seat_id} onChange={(e) => update(idx, 'seat_id', e.target.value)}
                      className="rounded border border-da-border px-2 py-1 text-sm text-da-text">
                      <option value="">Seat</option>
                      {allSeats.map((s) => (
                        <option key={s.seat_id} value={s.seat_id}>{s.seat_id} ({s.pod_id} · {s.seat_role})</option>
                      ))}
                    </select>
                  </>
                ) : rule.pod_id === '' && rule.student_id ? (
                  <>
                    <select value={rule.student_id} onChange={(e) => update(idx, 'student_id', e.target.value)}
                      className="rounded border border-da-border px-2 py-1 text-sm text-da-text">
                      <option value="">Student</option>
                      {filteredStudents.map((s) => (
                        <option key={s.student_id} value={s.student_id}>{s.name}</option>
                      ))}
                    </select>
                    <span className="text-sm text-da-muted">min</span>
                    <input
                      type="number" min="2" max="8" step="1"
                      value={Math.min(Math.max(rule.weight, 2), 8)}
                      onChange={(e) => update(idx, 'weight', Math.min(Math.max(Number(e.target.value), 2), 8))}
                      className="w-14 rounded border border-da-warning/40 bg-da-warning/15 px-2 py-1 text-sm font-semibold text-da-warning text-center"
                    />
                    <span className="text-sm text-da-muted">people in pod</span>
                    <span className="rounded border border-da-warning/40 bg-da-warning/15 px-2 py-1 text-xs font-semibold text-da-warning">🔒 Always Hard</span>
                  </>
                ) : (
                  <>
                    <select value={rule.student_id} onChange={(e) => update(idx, 'student_id', e.target.value)}
                      className="rounded border border-da-border px-2 py-1 text-sm text-da-text">
                      <option value="">Student</option>
                      {filteredStudents.map((s) => (
                        <option key={s.student_id} value={s.student_id}>{s.name}</option>
                      ))}
                    </select>
                    <select value={rule.pod_id} onChange={(e) => update(idx, 'pod_id', e.target.value)}
                      className="rounded border border-da-border px-2 py-1 text-sm text-da-text">
                      <option value="">Pod</option>
                      {pods.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </>
                )}

                {rule.rule_type !== 'SEAT' && !(rule.rule_type === 'POD' && !rule.pod_id && rule.student_id) && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-da-text">Weight</span>
                    <input
                      type="range" min="-15" max="15" step="1" value={rule.weight}
                      onChange={(e) => update(idx, 'weight', Number(e.target.value))}
                      className="w-28"
                    />
                    <span className={`text-sm font-bold w-20 text-center ${
                      rule.weight > 0 ? 'text-da-success' : rule.weight < 0 ? 'text-da-warning' : 'text-da-muted'
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
                  className="flex-1 min-w-24 rounded border border-da-border px-2 py-1 text-sm text-da-text"
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
