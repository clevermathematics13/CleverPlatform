'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  getSeats,
  saveSeatLayout,
  copyLayoutFrom,
  listSeatingLayouts,
  saveSeatingLayout,
  loadSeatingLayout,
  deleteSeatingLayout,
} from '@/lib/seating-data';
import {
  SEAT_ROLES,
  configSignature,
  deriveConfigs,
  nextPodId,
  seatsForConfigs,
  totalSeats as sumSeats,
  validateConfigs,
  type PodConfig,
  type SeatCount,
} from '@/lib/seating-layout';
import type { SeatingLayout } from '@/lib/seating-types';

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

  // Undo stack for deleted pods
  const [undoStack, setUndoStack] = useState<{ pod: PodConfig; idx: number; expiresAt: number }[]>([]);

  /**
   * The preset whose pods are exactly the ones currently in use, if any.
   * Nothing matching means the live layout has been edited away from every
   * saved preset - the dropdown says so rather than silently showing one.
   */
  const matchLayout = useCallback(
    (candidates: SeatingLayout[], live: PodConfig[], group: string): SeatingLayout | null => {
      const target = configSignature(live);
      return (
        candidates.find(
          (l) => Array.isArray(l.seats) && configSignature(deriveConfigs(l.seats, group)) === target,
        ) ?? null
      );
    },
    [],
  );

  /**
   * seating_seats is the single source of truth for what the class actually
   * uses, so the editor always shows THOSE pods - never a preset's. Showing a
   * preset here while the generator read seating_seats is what let the header
   * claim 21 seats while generation only saw 18. A preset is merely matched
   * against the live seats so the dropdown can show which one is in effect.
   */
  useEffect(() => {
    let ignore = false;
    async function loadAll() {
      setLoading(true);
      setLayoutLoading(true);
      try {
        const [seats, saved] = await Promise.all([
          getSeats(),
          listSeatingLayouts(classGroup).catch(() => [] as SeatingLayout[]),
        ]);
        if (ignore) return;
        const live = deriveConfigs(seats, classGroup);
        setConfigs(live);
        setLayouts(saved);
        const match = matchLayout(saved, live, classGroup);
        setSelectedLayoutId(match?.id ?? null);
        setLayoutName(match?.name ?? '');
      } catch (e) {
        if (!ignore) alert('Failed to load seat layout: ' + (e as Error).message);
      } finally {
        if (!ignore) {
          setLoading(false);
          setLayoutLoading(false);
        }
      }
    }
    if (classGroup) loadAll();
    return () => { ignore = true; };
  }, [classGroup, matchLayout]);

  const updateId = (idx: number, pod_id: string) =>
    setConfigs((prev) => prev.map((c, i) => (i === idx ? { ...c, pod_id } : c)));

  const updateCount = (idx: number, seat_count: SeatCount) =>
    setConfigs((prev) => prev.map((c, i) => (i === idx ? { ...c, seat_count } : c)));

  const add = () =>
    setConfigs((prev) => [...prev, { pod_id: nextPodId(prev), seat_count: 4 }]);

  /**
   * Persist a pod set. The live seats are ALWAYS written, because that is what
   * the generator and the chart read; the named preset is updated too when one
   * is currently in effect, so the two never drift apart.
   */
  const persistConfigs = async (updatedConfigs: PodConfig[]) => {
    const seats = seatsForConfigs(updatedConfigs, classGroup);
    await saveSeatLayout(seats, classGroup);
    const selected = layouts.find((l) => l.id === selectedLayoutId);
    if (selected && selected.name === layoutName.trim()) {
      await saveSeatingLayout(classGroup, selected.name, seats);
    }
  };

  // Delete pod: confirm → persist → undo toast
  const handleRemovePod = async (idx: number) => {
    const podName = configs[idx].pod_id;
    if (!confirm(`Delete pod "${podName}"?\n\nThis will be saved immediately. You can undo for 3 minutes.`)) return;
    const removed = configs[idx];
    const newConfigs = configs.filter((_, i) => i !== idx);
    setConfigs(newConfigs);
    try {
      await persistConfigs(newConfigs);
      onSaved();
    } catch (e) {
      alert('Failed to save deletion: ' + (e as Error).message);
      setConfigs(configs); // revert
      return;
    }
    setUndoStack((prev) => [
      ...prev,
      { pod: removed, idx, expiresAt: Date.now() + 3 * 60 * 1000 },
    ]);
  };

  // Undo a pod deletion
  const handleUndoRemove = async (entry: { pod: PodConfig; idx: number; expiresAt: number }) => {
    const newConfigs = [...configs];
    newConfigs.splice(entry.idx, 0, entry.pod);
    setConfigs(newConfigs);
    setUndoStack((prev) => prev.filter((e) => e !== entry));
    try {
      await persistConfigs(newConfigs);
      onSaved();
    } catch (e) {
      alert('Undo failed: ' + (e as Error).message);
    }
  };

  // Expire undo entries after 3 minutes
  useEffect(() => {
    if (undoStack.length === 0) return;
    const nearest = Math.min(...undoStack.map((e) => e.expiresAt));
    const delay = Math.max(100, nearest - Date.now());
    const timer = setTimeout(
      () => setUndoStack((prev) => prev.filter((e) => e.expiresAt > Date.now())),
      delay,
    );
    return () => clearTimeout(timer);
  }, [undoStack]);

  // Save as named layout
  const handleSaveLayout = async () => {
    if (!classGroup || !layoutName.trim()) {
      alert('Please enter a layout name.');
      return;
    }
    setSaving(true);
    try {
      const normalized = configs.map((c) => ({ ...c, pod_id: c.pod_id.trim() }));
      const problem = validateConfigs(normalized);
      if (problem) {
        alert('Save failed: ' + problem);
        return;
      }
      const seats = seatsForConfigs(normalized, classGroup);
      // Save the preset AND apply it, so the generator sees these seats.
      await saveSeatingLayout(classGroup, layoutName.trim(), seats);
      await saveSeatLayout(seats, classGroup);
      setConfigs(normalized);
      // Reload layouts
      const refreshed = await listSeatingLayouts(classGroup);
      setLayouts(refreshed);
      const saved = refreshed.find((l) => l.name === layoutName.trim());
      if (saved) setSelectedLayoutId(saved.id);
      onSaved();
    } catch (e) {
      alert('Save failed: ' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  /**
   * Apply a saved preset: it becomes the class's live layout, so its seats are
   * written to seating_seats and the rest of the app is told to refresh.
   */
  const handleLoadLayout = async (layoutId: string) => {
    setLayoutLoading(true);
    try {
      const layout = await loadSeatingLayout(layoutId);
      if (layout && layout.seats) {
        const loaded = deriveConfigs(layout.seats, classGroup);
        await saveSeatLayout(seatsForConfigs(loaded, classGroup), classGroup);
        setConfigs(loaded);
        setLayoutName(layout.name);
        setSelectedLayoutId(layout.id);
        onSaved();
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
      // Deleting a preset only forgets a saved name - the class keeps the pods
      // it is currently using, so `configs` is left alone.
      const refreshed = await listSeatingLayouts(classGroup);
      setLayouts(refreshed);
      const match = matchLayout(refreshed, configs, classGroup);
      setSelectedLayoutId(match?.id ?? null);
      setLayoutName(match?.name ?? '');
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
      const copied = deriveConfigs(seats, classGroup);
      setConfigs(copied);
      const match = matchLayout(layouts, copied, classGroup);
      setSelectedLayoutId(match?.id ?? null);
      setLayoutName(match?.name ?? '');
      onSaved();
    } catch (e) {
      alert('Copy failed: ' + (e as Error).message);
    } finally {
      setCopying(false);
    }
  };

  const totalSeats = sumSeats(configs);

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
            className="rounded border border-blue-300 px-2 py-1 text-sm text-blue-700 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
            disabled={layoutLoading || layouts.length === 0}
          >
            {layouts.length === 0 && <option value="">(none saved)</option>}
            {!selectedLayoutId && layouts.length > 0 && (
              <option value="">(unsaved layout)</option>
            )}
            {layouts.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
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
            className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-700 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
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
            className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-700 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
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
                        className="rounded border border-gray-400 px-2 py-1 text-sm text-gray-800 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                        onClick={() => handleRemovePod(idx)}
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
        Seat IDs are auto-generated as <em>Class-PodName-Role</em> (e.g. <em>9C-Pod A-L</em>).
        Saving or picking a layout applies it to this class straight away, so the
        seating generator uses exactly the pods shown here.
      </p>

      {/* Undo toast */}
      {undoStack.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 items-center pointer-events-none">
          {undoStack.map((entry, i) => (
            <div
              key={i}
              className="flex items-center gap-3 bg-gray-900 text-white px-5 py-3 rounded-xl shadow-2xl text-sm border border-gray-700 pointer-events-auto"
            >
              <span>
                Pod <strong>&ldquo;{entry.pod.pod_id}&rdquo;</strong> deleted
              </span>
              <button
                onClick={() => handleUndoRemove(entry)}
                className="rounded bg-yellow-400 text-gray-900 font-bold px-3 py-1 hover:bg-yellow-300 transition-colors"
              >
                Undo
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
