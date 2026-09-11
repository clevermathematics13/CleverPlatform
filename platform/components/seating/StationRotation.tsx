'use client';

import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  defaultStationCount,
  freshPartnerStationCounts,
  planStationRotation,
  repeatsUnavoidable,
  stationCountOptions,
  stationLabel,
  studentItineraries,
  MIN_ROTATION_STUDENTS,
  type RotationPlan,
  type RotationStudent,
} from '@/lib/station-rotation';
import type { Student } from '@/lib/seating-types';

interface Props {
  students: Student[];
  classGroup: string;
}

type View = 'rotations' | 'students';

interface StoredState {
  enabled: boolean;
  stationCount: number;
  plan: RotationPlan | null;
}

const EMPTY_STATE: StoredState = { enabled: false, stationCount: 0, plan: null };

/* ---- persistence ------------------------------------------------------------
   The panel's settings and its last plan live in localStorage, one entry per
   class, the way the chart above keeps its pod positions: a plan is worth
   surviving a page reload mid-lesson (regenerating hands every student a
   different partner), but it is not worth a table and a migration.

   It is read through useSyncExternalStore rather than an effect so that the
   server render and the hydrating client render agree -- the stored plan
   arrives in the re-render straight after hydration, not during it. */

const STORE_EVENT = 'cleverplatform:station-rotation';
const memoryStore = new Map<string, string>();
let storeUnavailable = false;

function storageKey(classGroup: string): string {
  return `sc_rotation_${classGroup}`;
}

function readStore(key: string): string | null {
  if (!storeUnavailable) {
    try {
      return localStorage.getItem(key);
    } catch {
      // Private windows and blocked site data: fall back to memory so the
      // panel still works for this visit.
      storeUnavailable = true;
    }
  }
  return memoryStore.get(key) ?? null;
}

function writeStore(key: string, value: string): void {
  if (!storeUnavailable) {
    try {
      localStorage.setItem(key, value);
    } catch {
      storeUnavailable = true;
    }
  }
  if (storeUnavailable) memoryStore.set(key, value);
  window.dispatchEvent(new Event(STORE_EVENT));
}

function subscribeToStore(onChange: () => void): () => void {
  window.addEventListener(STORE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(STORE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

function parseStored(raw: string | null, classGroup: string): StoredState {
  if (!raw) return EMPTY_STATE;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredState>;
    return {
      enabled: parsed.enabled === true,
      stationCount: typeof parsed.stationCount === 'number' ? parsed.stationCount : 0,
      // A plan from another class is not this class's plan.
      plan: parsed.plan?.class_group === classGroup ? parsed.plan : null,
    };
  } catch {
    return EMPTY_STATE;
  }
}

/** How a single rotation splits the class across the stations. */
function stationSizeSummary(studentCount: number, stationCount: number): string {
  const threes = studentCount - 2 * stationCount;
  const twos = stationCount - threes;
  if (threes <= 0) return '2 students at every station';
  if (twos <= 0) return '3 students at every station';
  return `${threes} station${threes === 1 ? '' : 's'} of 3 and ${twos} of 2`;
}

export default function StationRotation({ students, classGroup }: Props) {
  const [view, setView] = useState<View>('rotations');
  // Both are tagged with the class they belong to, so switching class clears
  // them without an effect reaching in to reset state.
  const [busyFor, setBusyFor] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ classGroup: string; message: string } | null>(null);
  const exportRef = useRef<HTMLDivElement>(null);

  const raw = useSyncExternalStore(
    subscribeToStore,
    () => readStore(storageKey(classGroup)),
    () => null,
  );
  const saved = useMemo(() => parseStored(raw, classGroup), [raw, classGroup]);

  const roster: RotationStudent[] = useMemo(
    () =>
      students
        .filter((s) => s.active && s.class_group === classGroup)
        .map((s) => ({ student_id: s.student_id, name: s.name })),
    [students, classGroup],
  );

  const options = stationCountOptions(roster.length);
  const freshCounts = freshPartnerStationCounts(roster.length);
  // A saved choice only counts while the roster still supports it; a class that
  // gained or lost students falls back to the default rather than to a station
  // count that can no longer seat everyone.
  const stationCount = options.includes(saved.stationCount)
    ? saved.stationCount
    : defaultStationCount(roster.length);

  const { enabled, plan } = saved;
  const generating = busyFor === classGroup;
  const error = failure?.classGroup === classGroup ? failure.message : '';

  const save = (patch: Partial<StoredState>) => {
    writeStore(storageKey(classGroup), JSON.stringify({ ...saved, stationCount, ...patch }));
  };

  const generate = () => {
    setFailure(null);
    setBusyFor(classGroup);
    const group = classGroup;
    // Hand the browser a frame to paint the button: a station count with no
    // exact construction behind it can search for the better part of a second.
    setTimeout(() => {
      try {
        const next = planStationRotation(roster, stationCount, { classGroup: group });
        writeStore(
          storageKey(group),
          JSON.stringify({ ...saved, stationCount, enabled: true, plan: next }),
        );
      } catch (e) {
        setFailure({ classGroup: group, message: (e as Error).message });
      } finally {
        setBusyFor(null);
      }
    }, 0);
  };

  const exportImage = async () => {
    if (!exportRef.current) return;
    try {
      const { toPng } = await import('html-to-image');
      const dataUrl = await toPng(exportRef.current, { backgroundColor: '#0f0b0d' });
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `rotations-${classGroup || 'class'}-${new Date().toISOString().slice(0, 10)}.png`;
      link.click();
    } catch (e) {
      setFailure({ classGroup, message: 'Export failed: ' + (e as Error).message });
    }
  };

  const planMatchesRoster =
    plan !== null &&
    plan.students.map((s) => s.student_id).sort().join('|') ===
      roster.map((s) => s.student_id).sort().join('|');

  const repeatAdvice = () => {
    const count = plan?.station_count ?? stationCount;
    if (repeatsUnavoidable(roster.length, count)) {
      return ` No arrangement avoids it with only ${count} stations.`;
    }
    const alternatives = freshCounts.filter((n) => n !== plan?.station_count).slice(0, 3);
    if (alternatives.length) {
      const list =
        alternatives.length > 1
          ? `${alternatives.slice(0, -1).join(', ')} or ${alternatives[alternatives.length - 1]}`
          : `${alternatives[0]}`;
      return ` ${list} stations would avoid it entirely.`;
    }
    return '';
  };

  return (
    <div className="mt-6 rounded-xl border border-da-border bg-da-bg/40 p-4">
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => save({ enabled: e.target.checked })}
          className="mt-0.5 h-4 w-4 accent-da-accent"
        />
        <span>
          <span className="text-sm font-semibold text-da-text">Rotating stations</span>
          <span className="mt-0.5 block text-xs text-da-muted">
            Every student visits every station once, 2-3 students at a station, working with
            different people in each rotation.
          </span>
        </span>
      </label>

      {enabled && (
        <div className="mt-4 space-y-4 border-t border-da-border pt-4">
          {options.length === 0 ? (
            <p className="text-sm text-da-muted">
              {roster.length === 0
                ? `No active students in ${classGroup || 'this class'} yet.`
                : `Rotating stations needs at least ${MIN_ROTATION_STUDENTS} active students; ${classGroup} has ${roster.length}.`}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm font-semibold text-da-text">
                  Stations
                  <select
                    value={stationCount}
                    onChange={(e) => save({ stationCount: Number(e.target.value) })}
                    className="rounded-lg border border-da-border px-3 py-1.5 text-sm font-normal text-da-text focus:outline-none focus:ring-2 focus:ring-da-accent"
                  >
                    {options.map((n) => (
                      <option key={n} value={n}>
                        {n} stations{freshCounts.includes(n) ? ' · no repeats' : ''}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  onClick={generate}
                  disabled={generating}
                  className="rounded-lg border border-da-accent/40 bg-da-accent px-4 py-2 text-sm font-semibold text-da-on-accent transition-colors hover:bg-da-amber disabled:opacity-50"
                >
                  {generating ? 'Planning…' : plan ? '🔁 New rotations' : '🔁 Plan rotations'}
                </button>

                {plan && (
                  <div className="ml-auto flex items-center gap-2">
                    <div className="flex rounded-lg border border-da-border p-0.5">
                      {(
                        [
                          ['rotations', 'By rotation'],
                          ['students', 'By student'],
                        ] as [View, string][]
                      ).map(([key, label]) => (
                        <button
                          key={key}
                          onClick={() => setView(key)}
                          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                            view === key
                              ? 'bg-da-accent text-da-on-accent'
                              : 'text-da-muted hover:text-da-text'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={exportImage}
                      className="rounded-lg border border-da-border px-3 py-1.5 text-xs font-medium text-da-text hover:bg-da-hover"
                    >
                      ↓ Export image
                    </button>
                  </div>
                )}
              </div>

              <p className="text-xs text-da-muted">
                {roster.length} students · {stationCount} rotations ·{' '}
                {stationSizeSummary(roster.length, stationCount)}. Only station counts that keep
                every station at 2-3 students, with the whole class placed, are offered.
              </p>

              {error && <p className="text-sm text-da-danger">{error}</p>}

              {plan && !planMatchesRoster && (
                <p className="text-xs text-da-warning">
                  The class list has changed since this plan was made. Plan the rotations again to
                  include everyone.
                </p>
              )}

              {plan && (
                <>
                  {plan.repeats.length === 0 ? (
                    <p className="text-xs text-da-success">
                      ✓ Everyone reaches all {plan.station_count} stations and works with a
                      different group in every rotation.
                    </p>
                  ) : (
                    <div className="text-xs text-da-warning">
                      <p>
                        {plan.repeats.length} pair{plan.repeats.length === 1 ? '' : 's'} share a
                        station more than once.{repeatAdvice()}
                      </p>
                      <p className="mt-1 text-da-muted">
                        {plan.repeats
                          .slice(0, 6)
                          .map((r) => `${r.a.name} & ${r.b.name} (${r.times}x)`)
                          .join(', ')}
                        {plan.repeats.length > 6 ? `, and ${plan.repeats.length - 6} more` : ''}
                      </p>
                    </div>
                  )}

                  <div ref={exportRef} className="space-y-5 rounded-lg bg-da-bg/40 p-3">
                    {view === 'rotations' ? (
                      plan.rounds.map((round) => (
                        <div key={round.round}>
                          <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-da-text">
                            Rotation {round.round + 1}
                          </h4>
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                            {round.stations.map((station) => (
                              <div
                                key={station.station}
                                className="rounded-lg border border-da-border bg-da-surface p-3"
                              >
                                <div className="text-xs font-bold uppercase tracking-wide text-da-accent">
                                  {stationLabel(station.station)}
                                </div>
                                <ul className="mt-1.5 space-y-0.5">
                                  {station.students.map((student) => (
                                    <li
                                      key={student.student_id}
                                      className="truncate text-sm text-da-text"
                                    >
                                      {student.name}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-da-border text-left text-xs uppercase tracking-wide text-da-muted">
                              <th className="py-2 pr-3 font-semibold">Student</th>
                              {plan.rounds.map((round) => (
                                <th
                                  key={round.round}
                                  className="px-2 py-2 text-center font-semibold"
                                >
                                  Rot {round.round + 1}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {studentItineraries(plan).map(({ student, stations }) => (
                              <tr
                                key={student.student_id}
                                className="border-b border-da-border/50"
                              >
                                <td className="py-1.5 pr-3 text-da-text">{student.name}</td>
                                {stations.map((station, round) => (
                                  <td key={round} className="px-2 py-1.5 text-center text-da-muted">
                                    {station + 1}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <p className="mt-2 text-xs text-da-muted">
                          Each number is a station: 1 is {stationLabel(0)}.
                        </p>
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
