'use client';

import { useState, useEffect } from 'react';
import {
  getSeats,
  saveSeatLayout,
  copyLayoutFrom,
  listSeatingLayouts,
  saveSeatingLayout,
  loadSeatingLayout,
  deleteSeatingLayout,
} from '@/lib/seating-data';
import type { Seat, SeatingLayout } from '@/lib/seating-types';

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

function buildSeatId(classGroup: string, podId: string, role: string): string {
  return `${classGroup || '*'}-${podId}-${role}`;
}

function seatsForConfig(cfg: PodConfig, classGroup: string): Seat[] {
  const podId = cfg.pod_id.trim();
  return SEAT_ROLES[cfg.seat_count].map((role) => ({
    seat_id: buildSeatId(classGroup, podId, role),
    class_group: classGroup || '*',
    pod_id: podId,
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

  // Layout management
  const [layouts, setLayouts] = useState<SeatingLayout[]>([]);
  const [selectedLayoutId, setSelectedLayoutId] = useState<string | null>(null);
  const [layoutName, setLayoutName] = useState('');
  const [layoutLoading, setLayoutLoading] = useState(false);
  const [deletingLayoutId, setDeletingLayoutId] = useState<string | null>(null);

  // Load layouts and seats on mount/classGroup change
  useEffect(() => {
    let ignore = false;
    async function loadAll() {
      setLoading(true);
      setLayoutLoading(true);
      try {
        const [seats, layouts] = await Promise.all([
          getSeats(),
          listSeatingLayouts(classGroup),
        ]);
        if (ignore) return;
        setLayouts(layouts);
        // Load last-used layout if exists, else default
        const last = layouts[0];
        if (last) {
          setSelectedLayoutId(last.id);
          if (last.seats) setConfigs(deriveConfigs(last.seats, classGroup));
          setLayoutName(last.name);
        } else {
          setConfigs(deriveConfigs(seats, classGroup));
          setSelectedLayoutId(null);
          setLayoutName('');
        }
      } catch (e) {
        // fallback: just seats
        getSeats().then((seats) => setConfigs(deriveConfigs(seats, classGroup)));
      } finally {
        setLoading(false);
        setLayoutLoading(false);
      }
    }
    if (classGroup) loadAll();
    return () => { ignore = true; };
  }, [classGroup]);

  const updateId = (idx: number, pod_id: string) =>
    setConfigs((prev) => prev.map((c, i) => (i === idx ? { ...c, pod_id } : c)));

  const updateCount = (idx: number, seat_count: SeatCount) =>
    setConfigs((prev) => prev.map((c, i) => (i === idx ? { ...c, seat_count } : c)));

  const remove = (idx: number) =>
    setConfigs((prev) => prev.filter((_, i) => i !== idx));

  const add = () =>
    setConfigs((prev) => [...prev, { pod_id: nextPodId(prev), seat_count: 4 }]);

  // Save as named layout
  const handleSaveLayout = async () => {
    if (!classGroup || !layoutName.trim()) {
      alert('Please enter a layout name.');
      return;
    }
    setSaving(true);
    try {
      const normalized = configs.map((c) => ({ ...c, pod_id: c.pod_id.trim() }));
      if (normalized.some((c) => !c.pod_id)) {
        alert('Save failed: pod names cannot be empty.');
        return;
      }
      const seen = new Set<string>();
      for (const cfg of normalized) {
        const key = cfg.pod_id.toLowerCase();
        if (seen.has(key)) {
          alert(`Save failed: duplicate pod name "${cfg.pod_id}".`);
          return;
        }
        seen.add(key);
      }
      const seats = normalized.flatMap((c) => seatsForConfig(c, classGroup));
      await saveSeatingLayout(classGroup, layoutName.trim(), seats);
      setConfigs(normalized);
      // Reload layouts
      const layouts = await listSeatingLayouts(classGroup);
      setLayouts(layouts);
      const saved = layouts.find((l) => l.name === layoutName.trim());
      if (saved) setSelectedLayoutId(saved.id);
      onSaved();
    } catch (e) {
      alert('Save failed: ' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // Load a layout
  const handleLoadLayout = async (layoutId: string) => {
    setLayoutLoading(true);
    try {
      const layout = await loadSeatingLayout(layoutId);
      if (layout && layout.seats) {
        setConfigs(deriveConfigs(layout.seats, classGroup));
        setLayoutName(layout.name);
        setSelectedLayoutId(layout.id);
      }
    } catch (e) {
      alert('Failed to load layout: ' + (e as Error).message);
    } finally {
      setLayoutLoading(false);
    }
  };

  // Delete a layout
  const handleDeleteLayout = async (layoutId: string) => {
    if (!confirm('Delete this seating layout?')) return;
    setDeletingLayoutId(layoutId);
    try {
      await deleteSeatingLayout(layoutId);
      const layouts = await listSeatingLayouts(classGroup);
      setLayouts(layouts);
      if (layouts.length > 0) {
        setSelectedLayoutId(layouts[0].id);
        setLayoutName(layouts[0].name);
        if (layouts[0].seats) setConfigs(deriveConfigs(layouts[0].seats, classGroup));
      } else {
        setSelectedLayoutId(null);
        setLayoutName('');
        getSeats().then((seats) => setConfigs(deriveConfigs(seats, classGroup)));
      }
    } catch (e) {
      alert('Delete failed: ' + (e as Error).message);
    } finally {
      setDeletingLayoutId(null);
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

  if (!classGroup) {
    return <p className="text-gray-500 italic py-4">Select a class group first.</p>;
  }
  if (loading) {
    return <p className="text-gray-500 py-4">Loading seat layout…</p>;
  }

  return (
    <div className="space-y-4">
      {/* Header and layout controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-800">
          Pods for{' '}
          <span className="text-blue-700">{classGroup}</span>
          <span className="ml-2 font-normal text-gray-500">
            ({configs.length} pods · {totalSeats} seats)
          </span>
        </h3>
        <div className="flex flex-wrap gap-2 items-center">
          {/* Layout dropdown */}
          <span className="text-xs text-gray-500">Layouts:</span>
          <select
            value={selectedLayoutId ?? ''}
            onChange={e => {
              const id = e.target.value;
              if (id) handleLoadLayout(id);
            }}
            className="rounded border border-blue-300 px-2 py-1 text-sm text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
            disabled={layoutLoading || layouts.length === 0}
          >
            {layouts.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
            {layouts.length === 0 && <option value="">(none)</option>}
          </select>
          {/* Delete button for selected layout */}
          {selectedLayoutId && (
            <button
              onClick={() => handleDeleteLayout(selectedLayoutId)}
              disabled={deletingLayoutId === selectedLayoutId}
              className="rounded-lg border border-red-400 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
              style={{ marginLeft: 2 }}
            >
              {deletingLayoutId === selectedLayoutId ? 'Deleting…' : '🗑 Delete'}
            </button>
          )}
          <span className="text-gray-300">|</span>
          {/* Layout name input and save */}
          <input
            type="text"
            value={layoutName}
            onChange={e => setLayoutName(e.target.value)}
            placeholder="Layout name"
            className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
            style={{ width: 120 }}
          />
          <button
            onClick={handleSaveLayout}
            disabled={saving || configs.length === 0 || !layoutName.trim()}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : '💾 Save'}
          </button>
          <span className="text-gray-300">|</span>
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
          <button
            onClick={add}
            className="rounded-lg border border-gray-400 px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-100"
          >
            + Add Pod
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
