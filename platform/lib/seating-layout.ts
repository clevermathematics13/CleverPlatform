/**
 * Pure helpers shared by the seat-layout editor.
 *
 * Two tables hold seat layouts and they are NOT interchangeable:
 *
 *   seating_seats   - the LIVE layout for a class. Everything that consumes
 *                     seats reads this: the generator (seating-engine),
 *                     SeatingChart, and the SEAT rules in RuleManager.
 *   seating_layouts - named PRESETS the teacher can save and re-apply. Only
 *                     the layout editor reads these.
 *
 * The editor used to show a preset's pods while the generator kept using the
 * live seats, so a 21-seat preset could sit next to an 18-seat live layout and
 * generation would fail with "Students (20) exceed seats (18)". Presets must
 * therefore always be written through to seating_seats when applied.
 */

import type { Seat } from '@/lib/seating-types';

export type SeatCount = 2 | 3 | 4;

export interface PodConfig {
  pod_id: string;
  seat_count: SeatCount;
}

export const SEAT_ROLES: Record<SeatCount, string[]> = {
  2: ['L', 'R'],
  3: ['L', 'R', 'B'],
  4: ['L', 'R', 'BL', 'BR'],
};

/** Seats belonging to a class group, including the shared '*' group. */
export function seatsForGroup(seats: Seat[], classGroup: string): Seat[] {
  return seats.filter((s) => s.active && (s.class_group === classGroup || s.class_group === '*'));
}

export function deriveConfigs(seats: Seat[], classGroup: string): PodConfig[] {
  const podMap = new Map<string, Set<string>>();
  seatsForGroup(seats, classGroup).forEach((s) => {
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

export function buildSeatId(classGroup: string, podId: string, role: string): string {
  return `${classGroup || '*'}-${podId}-${role}`;
}

export function seatsForConfig(cfg: PodConfig, classGroup: string): Seat[] {
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

export function seatsForConfigs(configs: PodConfig[], classGroup: string): Seat[] {
  return configs.flatMap((c) => seatsForConfig(c, classGroup));
}

export function totalSeats(configs: PodConfig[]): number {
  return configs.reduce((n, c) => n + c.seat_count, 0);
}

/**
 * Order-independent fingerprint of a pod set, used to tell whether the live
 * seats are exactly one of the saved presets.
 */
export function configSignature(configs: PodConfig[]): string {
  return configs
    .map((c) => `${c.pod_id.trim()}:${c.seat_count}`)
    .sort()
    .join('|');
}

export function nextPodId(configs: PodConfig[]): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const letter of letters) {
    const id = `Pod ${letter}`;
    if (!configs.find((c) => c.pod_id === id)) return id;
  }
  return `Pod ${Date.now()}`;
}

/** First validation failure for a pod set, or null when it is safe to save. */
export function validateConfigs(configs: PodConfig[]): string | null {
  if (configs.some((c) => !c.pod_id.trim())) return 'pod names cannot be empty.';
  const seen = new Set<string>();
  for (const cfg of configs) {
    const key = cfg.pod_id.trim().toLowerCase();
    if (seen.has(key)) return `duplicate pod name "${cfg.pod_id.trim()}".`;
    seen.add(key);
  }
  return null;
}
