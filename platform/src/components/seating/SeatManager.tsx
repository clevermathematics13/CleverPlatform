'use client';

import { useState, useEffect } from 'react';
import { getSeats, saveSeatLayout, copyLayoutFrom } from '@/lib/seating-data';
import type { Seat } from '@/lib/seating-types';

type SeatCount = 2 | 3 | 4;

interface PodConfig {
  pod_id: string;
  seat_count: SeatCount;
}

const SEAT_ROLES: Record<SeatCount, string[]> = {
  2: ['L', 'R'],
  3: ['L', 'R', 'B'],
  4: ['L', 'R', 'BL', 'BR'],
};

function deriveConfigs(seats: Seat[], classGroup: string): PodConfig[] {
  const podMap = new Map<string, Set<string>>();
  seats
    .filter((s) => s.active && (s.class_group === classGroup || s.class_group === '*'))
    .forEach((s) => {
      if (!podMap.has(s.pod_id)) podMap.set(s.pod_id, new Set());
      podMap.get(s.pod_id)!.add(s.seat_role);
    });
  return [...podMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([pod_id, roles]) => {
      const n = roles.size;
      const seat_count: SeatCount = n >= 4 ? 4 : n === 3 ? 3 : 2;
      return { pod_id, seat_count };
    });
}

function seatsForConfig(cfg: PodConfig, classGroup: string): Seat[] {
  return SEAT_ROLES[cfg.seat_count].map((role) => ({
    seat_id: `${cfg.pod_id}-${role}`,
    class_group: classGroup || '*',
    pod_id: cfg.pod_id,
    seat_role: role,
    x: 0,
    y: 0,
    active: true,
  }));
}

function nextPodId(configs: PodConfig[]): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const letter of letters) {
    const id = `Pod ${letter}`;
    if (!configs.find((c) => c.pod_id === id)) return id;
  }
  return `Pod ${Date.now()}`;
}

interface Props {
  classGroup: string;
  onSaved: () => void;
}

const ALL_GROUPS = ['27AH', 'K05', '9A', '9D', '9G'];

export default function SeatManager({ classGroup, onSaved }: Props) {
  const [configs, setConfigs] = useState<PodConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copySource, setCopySource] = useState('27AH');
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    if (!classGroup) { setLoading(false); return; }
    setLoading(true);
    getSeats()
      .then((seats) => setConfigs(deriveConfigs(seats, classGroup)))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [classGroup]);

  const updateId = (idx: number, pod_id: string) =>
    setConfigs((prev) => prev.map((c, i) => (i === idx ? { ...c, pod_id } : c)));

  const updateCount = (idx: number, seat_count: SeatCount) =>
    setConfigs((prev) => prev.map((c, i) => (i === idx ? { ...c, seat_count } : c)));

  const remove = (idx: number) =>
    setConfigs((prev) => prev.filter((_, i) => i !== idx));

  const add = () =>
    setConfigs((prev) => [...prev, { pod_id: nextPodId(prev), seat_count: 4 }]);

  const handleSave = async () => {
    if (!classGroup) return;
    setSaving(true);
    try {
      const seats = configs.flatMap((c) => seatsForConfig(c, classGroup));
      await saveSeatLayout(seats, classGroup);
      onSaved();
    } catch (e) {
      alert('Save failed: ' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleCopyFrom = async () => {
    if (!classGroup || !copySource || copySource === classGroup) return;
    if (!confirm(`Replace the ${classGroup} layout with a copy of ${copySource}?`)) return;
    setCopying(true);
    try {
      await copyLayoutFrom(copySource, classGroup);
      const seats = await getSeats();
      setConfigs(deriveConfigs(seats, classGroup));
      onSaved();
    } catch (e) {
      alert('Copy failed: ' + (e as Error).message);
    } finally {
      setCopying(false);
    }
  };

  const totalSeats = configs.reduce((n, c) => n + c.seat_count, 0);

  if (!classGroup)
    return <p className="text-gray-500 italic py-4">Select a class group first.</p>;
  if (loading)
    return <p className="text-gray-500 py-4">Loading seat layout…</p>;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-800">
          Pods for{' '}
          <span className="text-blue-700">{classGroup}</span>
          <span className="ml-2 font-normal text-gray-500">
            ({configs.length} pods · {totalSeats} seats)
          </span>
        </h3>
        <div className="flex flex-wrap gap-2 items-center">
          {/* Copy from another class */}
          <span className="text-xs text-gray-500">Copy from:</span>
          <select
            value={copySource}
            onChange={(e) => setCopySource(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            {ALL_GROUPS.filter((g) => g !== classGroup).map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
          <button
            onClick={handleCopyFrom}
            disabled={copying}
            className="rounded-lg border border-gray-400 px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-100 disabled:opacity-50"
          >
            {copying ? 'Copying…' : '📋 Copy Layout'}
          </button>
          <span className="text-gray-300">|</span>
          <button
            onClick={add}
            className="rounded-lg border border-gray-400 px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-100"
          >
            + Add Pod
          </button>
          <button
            onClick={handleSave}
            disabled={saving || configs.length === 0}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : '💾 Save Layout'}
          </button>
        </div>
      </div>

      {configs.length === 0 ? (
        <p className="text-gray-500 italic py-6 text-center">
          No pods yet. Click &quot;+ Add Pod&quot; to start building your room layout.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-300 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-700 w-44">
                  Pod Name
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-700 w-32">
                  Seats
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">
                  Layout Preview
                </th>
                <th className="px-4 py-2.5 w-12" />
              </tr>
            </thead>
            <tbody>
              {configs.map((cfg, idx) => {
                const topRoles = SEAT_ROLES[cfg.seat_count].filter((r) => !r.startsWith('B'));
                const botRoles = SEAT_ROLES[cfg.seat_count].filter((r) => r.startsWith('B'));
                return (
                  <tr key={idx} className="border-t border-gray-200 hover:bg-gray-50">
                    {/* Pod ID */}
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        value={cfg.pod_id}
                        onChange={(e) => updateId(idx, e.target.value)}
                        className="w-full rounded border border-gray-400 px-2 py-1 text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </td>

                    {/* Seat count */}
                    <td className="px-4 py-3">
                      <select
                        value={cfg.seat_count}
                        onChange={(e) => updateCount(idx, Number(e.target.value) as SeatCount)}
                        className="rounded border border-gray-400 px-2 py-1 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value={2}>2 seats</option>
                        <option value={3}>3 seats</option>
                        <option value={4}>4 seats</option>
                      </select>
                    </td>

                    {/* Visual preview */}
                    <td className="px-4 py-3">
                      <div className="inline-flex flex-col gap-1">
                        {/* Top row */}
                        <div className="flex gap-1">
                          {topRoles.map((r) => (
                            <div
                              key={r}
                              className="w-10 h-8 rounded bg-blue-100 border border-blue-300 flex items-center justify-center text-xs font-bold text-blue-800"
                            >
                              {r}
                            </div>
                          ))}
                        </div>
                        {/* Bottom row */}
                        {botRoles.length > 0 && (
                          <div className="flex gap-1 justify-center">
                            {botRoles.map((r) => (
                              <div
                                key={r}
                                className="w-10 h-8 rounded bg-slate-100 border border-slate-300 flex items-center justify-center text-xs font-bold text-slate-700"
                              >
                                {r}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Delete */}
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => remove(idx)}
                        className="text-red-500 hover:text-red-700 text-lg leading-none"
                        title="Remove pod"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-500">
        Seat roles: <strong>L</strong> = left, <strong>R</strong> = right,{' '}
        <strong>B</strong> = back-center (3-seat), <strong>BL/BR</strong> = back-left/right (4-seat).
        Seat IDs are auto-generated as <em>PodName-Role</em> (e.g. <em>Pod A-L</em>).
      </p>
    </div>
  );
}
