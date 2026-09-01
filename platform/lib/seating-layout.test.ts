import { describe, it, expect } from 'vitest';
import {
  configSignature,
  deriveConfigs,
  nextPodId,
  seatsForConfigs,
  totalSeats,
  validateConfigs,
  type PodConfig,
} from './seating-layout';
import type { Seat } from './seating-types';

function seat(classGroup: string, podId: string, role: string, active = true): Seat {
  return {
    seat_id: `${classGroup}-${podId}-${role}`,
    class_group: classGroup,
    pod_id: podId,
    seat_role: role,
    x: 0,
    y: 0,
    active,
  };
}

/** 7 pods x 3 seats, i.e. the 9C layout that failed to reach the generator. */
const SEVEN_POD_LAYOUT: PodConfig[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((l) => ({
  pod_id: `Pod ${l}`,
  seat_count: 3 as const,
}));

describe('seatsForConfigs', () => {
  it('emits every seat of every pod, so the editor count is the generator count', () => {
    const seats = seatsForConfigs(SEVEN_POD_LAYOUT, '9C');
    expect(seats).toHaveLength(21);
    expect(seats).toHaveLength(totalSeats(SEVEN_POD_LAYOUT));
    expect(new Set(seats.map((s) => s.seat_id)).size).toBe(21);
    expect(seats.every((s) => s.class_group === '9C' && s.active)).toBe(true);
  });

  it('round-trips through deriveConfigs unchanged', () => {
    const seats = seatsForConfigs(SEVEN_POD_LAYOUT, '9C');
    expect(deriveConfigs(seats, '9C')).toEqual(SEVEN_POD_LAYOUT);
  });

  it('namespaces seat ids by class group so two classes cannot collide', () => {
    const a = seatsForConfigs([{ pod_id: 'Pod A', seat_count: 2 }], '9C');
    const b = seatsForConfigs([{ pod_id: 'Pod A', seat_count: 2 }], '9G');
    expect(a.map((s) => s.seat_id)).not.toEqual(b.map((s) => s.seat_id));
  });

  it('trims pod names before building seat ids', () => {
    const [s] = seatsForConfigs([{ pod_id: '  Pod A  ', seat_count: 2 }], '9C');
    expect(s.pod_id).toBe('Pod A');
    expect(s.seat_id).toBe('9C-Pod A-L');
  });
});

describe('deriveConfigs', () => {
  it('includes the shared "*" group and skips inactive seats', () => {
    const seats = [
      seat('9C', 'Pod A', 'L'),
      seat('9C', 'Pod A', 'R'),
      seat('*', 'Pod Z', 'L'),
      seat('*', 'Pod Z', 'R'),
      seat('9G', 'Pod Q', 'L'),
      seat('9C', 'Pod X', 'L', false),
    ];
    expect(deriveConfigs(seats, '9C')).toEqual([
      { pod_id: 'Pod A', seat_count: 2 },
      { pod_id: 'Pod Z', seat_count: 2 },
    ]);
  });

  it('clamps unusual role counts into the 2/3/4 options', () => {
    const seats = [
      seat('9C', 'Pod A', 'L'),
      seat('9C', 'Pod B', 'L'),
      seat('9C', 'Pod B', 'R'),
      seat('9C', 'Pod B', 'B'),
      seat('9C', 'Pod B', 'BL'),
      seat('9C', 'Pod B', 'BR'),
    ];
    expect(deriveConfigs(seats, '9C')).toEqual([
      { pod_id: 'Pod A', seat_count: 2 },
      { pod_id: 'Pod B', seat_count: 4 },
    ]);
  });
});

describe('configSignature', () => {
  it('matches a preset to the live seats regardless of pod order', () => {
    const live = deriveConfigs(seatsForConfigs(SEVEN_POD_LAYOUT, '9C'), '9C');
    expect(configSignature([...SEVEN_POD_LAYOUT].reverse())).toBe(configSignature(live));
  });

  it('separates a 21-seat preset from an 18-seat live layout', () => {
    const sixPods = SEVEN_POD_LAYOUT.slice(0, 6);
    expect(configSignature(sixPods)).not.toBe(configSignature(SEVEN_POD_LAYOUT));
  });

  it('separates pod sets that differ only in seat count', () => {
    const wider = SEVEN_POD_LAYOUT.map((c) => ({ ...c, seat_count: 4 as const }));
    expect(configSignature(wider)).not.toBe(configSignature(SEVEN_POD_LAYOUT));
  });
});

describe('validateConfigs', () => {
  it('accepts a clean pod set', () => {
    expect(validateConfigs(SEVEN_POD_LAYOUT)).toBeNull();
  });

  it('rejects blank pod names', () => {
    expect(validateConfigs([{ pod_id: '   ', seat_count: 2 }])).toMatch(/cannot be empty/);
  });

  it('rejects duplicates that would collide as seat ids', () => {
    expect(
      validateConfigs([
        { pod_id: 'Pod A', seat_count: 2 },
        { pod_id: ' pod a ', seat_count: 3 },
      ]),
    ).toMatch(/duplicate pod name/);
  });
});

describe('nextPodId', () => {
  it('picks the first unused letter', () => {
    expect(nextPodId(SEVEN_POD_LAYOUT)).toBe('Pod H');
    expect(nextPodId([])).toBe('Pod A');
  });
});
