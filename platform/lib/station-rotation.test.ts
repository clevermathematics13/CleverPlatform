import { describe, it, expect } from 'vitest';
import {
  defaultStationCount,
  freshPartnerStationCounts,
  guaranteesFreshPartners,
  planStationRotation,
  repeatsUnavoidable,
  stationCountOptions,
  stationCountProblem,
  studentItineraries,
  validatePlan,
  MAX_STATION_STUDENTS,
  MIN_STATION_STUDENTS,
  type RotationStudent,
} from './station-rotation';

/** Deterministic rng so a failure is reproducible rather than a bad roll. */
function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function roster(count: number): RotationStudent[] {
  return Array.from({ length: count }, (_, i) => ({
    student_id: `student-${i}`,
    name: `Student ${String(i).padStart(2, '0')}`,
  }));
}

/** Cheap budget: these cases only need a plan, not the best possible one. */
const FAST = { restarts: 2, iterations: 400 };

describe('stationCountOptions', () => {
  it('offers only counts that keep every station at 2-3 students', () => {
    for (let size = 4; size <= 34; size++) {
      for (const n of stationCountOptions(size)) {
        expect(n * MIN_STATION_STUDENTS).toBeLessThanOrEqual(size);
        expect(n * MAX_STATION_STUDENTS).toBeGreaterThanOrEqual(size);
      }
    }
  });

  it('is empty for a class too small to fill two stations', () => {
    expect(stationCountOptions(3)).toEqual([]);
    expect(stationCountOptions(0)).toEqual([]);
    expect(stationCountOptions(4)).toEqual([2]);
  });

  it('rejects a count that cannot seat the class, with a reason', () => {
    expect(stationCountProblem(24, 4)).toMatch(/at most 12 students/);
    expect(stationCountProblem(12, 8)).toMatch(/at least 16 students/);
    expect(stationCountProblem(12, 1)).toMatch(/at least 2 stations/);
    expect(stationCountProblem(24, 8)).toBeNull();
  });
});

describe('planStationRotation', () => {
  it('sends every student to every station once, 2-3 at a time', () => {
    for (const [size, stations] of [[12, 4], [18, 6], [20, 7], [24, 8], [26, 9], [30, 12]]) {
      const plan = planStationRotation(roster(size), stations, { ...FAST, rng: seededRng(size * 31 + stations) });
      expect(validatePlan(plan)).toEqual([]);
      expect(plan.rounds).toHaveLength(stations);
      expect(plan.students).toHaveLength(size);
    }
  });

  it('gives everyone new partners whenever the station count allows it', () => {
    for (let size = 4; size <= 30; size++) {
      for (const n of stationCountOptions(size)) {
        if (!guaranteesFreshPartners(size, n)) continue;
        const plan = planStationRotation(roster(size), n, { rng: seededRng(size * 101 + n) });
        expect(validatePlan(plan)).toEqual([]);
        expect(plan.repeats).toEqual([]);
      }
    }
  });

  it('still produces a usable plan where repeats cannot be avoided', () => {
    // Two stations force it: in rotation 2 everyone simply swaps sides, so a
    // pair that starts together is together throughout.
    expect(repeatsUnavoidable(6, 2)).toBe(true);
    const plan = planStationRotation(roster(6), 2, { ...FAST, rng: seededRng(7) });
    expect(validatePlan(plan)).toEqual([]);
    expect(plan.repeats.length).toBeGreaterThan(0);
    expect(plan.repeats.every((r) => r.times > 1)).toBe(true);
  });

  it('refuses a station count the class cannot fill', () => {
    expect(() => planStationRotation(roster(24), 4)).toThrow(/at most 12 students/);
    expect(() => planStationRotation(roster(12), 8)).toThrow(/at least 16 students/);
  });

  it('keeps the same students it was handed', () => {
    const students = roster(15);
    const plan = planStationRotation(students, 5, { classGroup: '9C', rng: seededRng(3) });
    expect(plan.class_group).toBe('9C');
    const placed = plan.rounds[0].stations.flatMap((s) => s.students.map((st) => st.student_id));
    expect(new Set(placed)).toEqual(new Set(students.map((s) => s.student_id)));
  });
});

describe('studentItineraries', () => {
  it('gives each student every station exactly once, in rotation order', () => {
    const plan = planStationRotation(roster(21), 7, { rng: seededRng(11) });
    const itineraries = studentItineraries(plan);
    expect(itineraries).toHaveLength(21);
    for (const { stations } of itineraries) {
      expect([...stations].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    }
    // A student's itinerary agrees with the rotation view it was built from.
    const first = itineraries[0];
    plan.rounds.forEach((round) => {
      const station = round.stations.find((s) =>
        s.students.some((st) => st.student_id === first.student.student_id));
      expect(station?.station).toBe(first.stations[round.round]);
    });
  });
});

describe('defaultStationCount', () => {
  it('prefers a repeat-free count and always offers a valid one', () => {
    for (let size = 4; size <= 34; size++) {
      const options = stationCountOptions(size);
      const fresh = freshPartnerStationCounts(size);
      const chosen = defaultStationCount(size);
      if (options.length === 0) {
        expect(chosen).toBe(0);
        continue;
      }
      expect(options).toContain(chosen);
      if (fresh.length > 0) expect(chosen).toBe(fresh[0]);
    }
  });
});

describe('validatePlan', () => {
  it('catches a plan that breaks the promises', () => {
    const plan = planStationRotation(roster(12), 4, { rng: seededRng(5) });
    // Move a student to a station they already visit: they now miss one.
    plan.rounds[0].stations[1].students.push(plan.rounds[0].stations[0].students[0]);
    plan.rounds[0].stations[0].students.shift();
    expect(validatePlan(plan).length).toBeGreaterThan(0);
  });
});
