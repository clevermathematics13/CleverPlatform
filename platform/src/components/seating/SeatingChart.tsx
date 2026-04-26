'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import type { Assignment, Seat } from '@/lib/seating-types';

interface Props {
  seats: Seat[];
  assignments: Assignment[];
  classGroup: string;
}

const ROLE_ORDER: Record<string, number> = { L: 0, R: 1, B: 2 };

function roleSort(a: Seat, b: Seat) {
  return (ROLE_ORDER[a.seat_role] ?? 9) - (ROLE_ORDER[b.seat_role] ?? 9);
}

interface PodPosition { x: number; y: number; }

export default function SeatingChart({ seats, assignments, classGroup }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const activeSeats = seats.filter(
    (s) => s.active && (s.class_group === classGroup || s.class_group === '*')
  );

  const assignmentMap = new Map(assignments.map((a) => [a.seat_id, a]));

  const pods = new Map<string, Seat[]>();
  activeSeats.forEach((s) => {
    if (!pods.has(s.pod_id)) pods.set(s.pod_id, []);
    pods.get(s.pod_id)!.push(s);
  });

  const sortedPodIds = [...pods.keys()].sort();
  const storageKey = `sc_pod_positions_${classGroup}`;

  const [positions, setPositions] = useState<Record<string, PodPosition>>(() => {
    if (typeof window === 'undefined') {
      const init: Record<string, PodPosition> = {};
      sortedPodIds.forEach((id, i) => {
        init[id] = { x: 20 + (i % 4) * 240, y: 20 + Math.floor(i / 4) * 220 };
      });
      return init;
    }
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (sortedPodIds.every((id) => parsed[id])) return parsed;
      }
    } catch { /* ignore */ }
    const init: Record<string, PodPosition> = {};
    sortedPodIds.forEach((id, i) => {
      init[id] = { x: 20 + (i % 4) * 240, y: 20 + Math.floor(i / 4) * 220 };
    });
    return init;
  });

  const canvasHeight = Math.max(600, ...Object.values(positions).map((p) => p.y + 220));

  const dragRef = useRef<{
    podId: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent, podId: string) => {
    e.preventDefault();
    const pos = positions[podId] || { x: 0, y: 0 };
    dragRef.current = { podId, startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [positions]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const { podId, startX, startY, origX, origY } = dragRef.current;
    setPositions((prev) => ({
      ...prev,
      [podId]: { x: origX + (e.clientX - startX), y: origY + (e.clientY - startY) },
    }));
  }, []);

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
    try { localStorage.setItem(storageKey, JSON.stringify(positions)); } catch { /* ignore */ }
  }, [positions, storageKey]);

  // When classGroup changes, reload positions from localStorage (or compute default grid)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        setPositions(parsed);
        return;
      }
    } catch { /* ignore */ }
    const init: Record<string, PodPosition> = {};
    sortedPodIds.forEach((id, i) => {
      init[id] = { x: 20 + (i % 4) * 240, y: 20 + Math.floor(i / 4) * 220 };
    });
    setPositions(init);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classGroup]);

  // When new pods appear (class group already loaded), add default positions for them
  useEffect(() => {
    setPositions((prev) => {
      const next = { ...prev };
      let changed = false;
      sortedPodIds.forEach((id, i) => {
        if (!next[id]) {
          next[id] = { x: 20 + (i % 4) * 240, y: 20 + Math.floor(i / 4) * 220 };
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedPodIds.join(',')]);

  // Early return AFTER all hooks
  if (!activeSeats.length) {
    return <p className="text-gray-500 italic py-8 text-center">No seats configured for {classGroup || 'this class'}.</p>;
  }

  return (
    <div>
      <div className="flex justify-end mb-2">
        <button
          onClick={async () => {
            if (!canvasRef.current) return;
            try {
              const { toPng } = await import('html-to-image');
              const dataUrl = await toPng(canvasRef.current, { backgroundColor: '#eff6ff' });
              const a = document.createElement('a');
              a.href = dataUrl;
              a.download = `seating-${classGroup || 'chart'}-${new Date().toISOString().slice(0, 10)}.png`;
              a.click();
            } catch (e) {
              alert('Export failed: ' + (e as Error).message);
            }
          }}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          ↓ Export image
        </button>
      </div>
      <div
        ref={canvasRef}
        className="relative border border-dashed border-gray-400 rounded-lg bg-blue-50/50"
        style={{ minHeight: canvasHeight }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {sortedPodIds.map((podId) => {
          const podSeats = pods.get(podId)!;
          const pos = positions[podId] || { x: 0, y: 0 };
          const topRow = podSeats.filter((s) => !s.seat_role.startsWith('B')).sort(roleSort);
          const bottomRow = podSeats.filter((s) => s.seat_role.startsWith('B')).sort(roleSort);

          return (
            <div
              key={podId}
              className="absolute bg-white border border-gray-300 rounded-lg p-3 shadow-md w-52 cursor-grab active:cursor-grabbing active:shadow-lg active:z-10 select-none touch-none"
              style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
              onPointerDown={(e) => onPointerDown(e, podId)}
            >
              <div className="text-xs font-bold text-blue-700 uppercase tracking-wide mb-2 pointer-events-none">
                {podId}
              </div>
              <div className="flex gap-1.5 pointer-events-none">
                {topRow.map((seat) => {
                  const a = assignmentMap.get(seat.seat_id);
                  return (
                    <div
                      key={seat.seat_id}
                      title={seat.seat_id}
                      className={`flex-1 rounded p-2 text-center text-xs font-semibold min-w-0 ${
                        a ? 'bg-blue-100 border border-blue-200 text-blue-900' : 'bg-gray-100 border border-dashed border-gray-300 text-gray-400'
                      }`}
                    >
                      <span className="block truncate">{a?.name || '—'}</span>
                    </div>
                  );
                })}
              </div>
              {bottomRow.length > 0 && (
                <div className="flex justify-center mt-1.5 pointer-events-none">
                  {bottomRow.map((seat) => {
                    const a = assignmentMap.get(seat.seat_id);
                    return (
                      <div
                        key={seat.seat_id}
                        title={seat.seat_id}
                        className={`w-20 rounded p-2 text-center text-xs font-semibold ${
                          a ? 'bg-blue-100 border border-blue-300 text-blue-900' : 'bg-gray-100 border border-dashed border-gray-400 text-gray-400'
                        }`}
                      >
                        <span className="block truncate">{a?.name || '—'}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {assignments.length > 0 && (
        <p className="mt-3 text-xs text-gray-600">
          Score: {assignments[0]?.candidate_score?.toFixed(2)} — Run: {assignments[0]?.run_id}
        </p>
      )}
    </div>
  );
}
