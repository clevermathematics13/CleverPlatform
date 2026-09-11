/**
 * Station rotation planner.
 *
 * Builds a plan that sends every student to every station exactly once, keeps
 * 2-3 students at a station at any one time, and tries to hand everyone a new
 * set of partners in every rotation.
 *
 * With n stations the plan is exactly n rotations long, because each student
 * visits each station once. Every student is somewhere in every rotation, so
 * the class size S has to satisfy 2n <= S <= 3n -- that is the whole range
 * stationCountOptions() offers, and why a 24-student class cannot run 4
 * stations without breaking the 2-3 rule.
 *
 * A plan is an S x n matrix, matrix[i][r] = station of student i in rotation
 * r, under three invariants:
 *   1. every row is a permutation of the stations (everyone visits everywhere)
 *   2. every column holds each station 2 or 3 times (group sizes)
 *   3. two students share a station at most once (fresh partners)
 * The seed and every search move preserve 1 and 2, so they always hold; 3 is
 * the objective the local search minimises.
 *
 * Zero repeats is not always reachable. Two students whose rotation order is
 * identical sit together every single time, and at most n(n-1) orders can
 * pairwise agree in at most one place, so S > n(n-1) forces repeats -- always
 * at 2 stations, and at 3 stations from 7 students up. repeatsUnavoidable()
 * reports that so the UI can say so plainly instead of implying a bad shuffle.
 */

export interface RotationStudent {
  student_id: string;
  name: string;
}

export interface RotationStation {
  /** 0-based station index; the UI labels it with stationLabel(). */
  station: number;
  students: RotationStudent[];
}

export interface RotationRound {
  /** 0-based rotation index. */
  round: number;
  stations: RotationStation[];
}

export interface RepeatPair {
  a: RotationStudent;
  b: RotationStudent;
  /** Rotations these two spend at the same station; only > 1 is a repeat. */
  times: number;
}

export interface RotationPlan {
  class_group: string;
  station_count: number;
  students: RotationStudent[];
  rounds: RotationRound[];
  /** Pairs that meet more than once, worst first. Empty is the happy case. */
  repeats: RepeatPair[];
  generated_at: string;
}

export interface PlanOptions {
  classGroup?: string;
  /** Injectable for deterministic tests; defaults to Math.random. */
  rng?: () => number;
  restarts?: number;
  iterations?: number;
}

export const MIN_STATION_STUDENTS = 2;
export const MAX_STATION_STUDENTS = 3;

/** Smallest class a rotation can be built for: 2 stations of 2. */
export const MIN_ROTATION_STUDENTS = MIN_STATION_STUDENTS * 2;

export function stationLabel(station: number): string {
  return `Station ${station + 1}`;
}

/**
 * Station counts that keep every station at 2-3 students with the whole class
 * placed every rotation. Empty when the class is too small to rotate at all.
 */
export function stationCountOptions(studentCount: number): number[] {
  const min = Math.max(2, Math.ceil(studentCount / MAX_STATION_STUDENTS));
  const max = Math.floor(studentCount / MIN_STATION_STUDENTS);
  const out: number[] = [];
  for (let n = min; n <= max; n++) out.push(n);
  return out;
}

/**
 * Fewest stations that fit and still give everyone all-new partners, falling
 * back to the fewest stations that fit at all.
 */
export function defaultStationCount(studentCount: number): number {
  return freshPartnerStationCounts(studentCount)[0]
    ?? stationCountOptions(studentCount)[0]
    ?? 0;
}

/**
 * True when a repeat-free plan is not merely hoped for but constructed: the
 * station count has a field behind it (see buildField) and the class needs
 * fewer groups than that field has multipliers, so every pair of students
 * shares a station exactly once or not at all.
 */
export function guaranteesFreshPartners(studentCount: number, stationCount: number): boolean {
  if (stationCountProblem(studentCount, stationCount)) return false;
  if (!buildField(stationCount)) return false;
  return Math.ceil(studentCount / stationCount) <= stationCount - 1;
}

/** The station counts a class can run with nobody repeating a partner. */
export function freshPartnerStationCounts(studentCount: number): number[] {
  return stationCountOptions(studentCount).filter((n) => guaranteesFreshPartners(studentCount, n));
}

/**
 * True when no arrangement can avoid repeat partners, because more students
 * need rotation orders than there are orders that pairwise overlap once.
 */
export function repeatsUnavoidable(studentCount: number, stationCount: number): boolean {
  return studentCount > stationCount * (stationCount - 1);
}

/** Why the given station count will not work for this class, or null. */
export function stationCountProblem(studentCount: number, stationCount: number): string | null {
  if (!Number.isInteger(stationCount) || stationCount < 2) {
    return 'Pick at least 2 stations.';
  }
  const min = stationCount * MIN_STATION_STUDENTS;
  const max = stationCount * MAX_STATION_STUDENTS;
  if (studentCount < min) {
    return `${stationCount} stations need at least ${min} students to keep 2 at each; this class has ${studentCount}.`;
  }
  if (studentCount > max) {
    return `${stationCount} stations hold at most ${max} students at 3 each; this class has ${studentCount}.`;
  }
  return null;
}

// ---- schedule search ---------------------------------------------------------

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

function shuffled<T>(arr: T[], rng: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Steps that turn "+= step each rotation" into a full tour of the stations. */
function coprimeSteps(n: number): number[] {
  const out = range(n).slice(1).filter((s) => gcd(s, n) === 1);
  return out.length ? out : [1];
}

interface Field {
  add: number[][];
  mul: number[][];
}

/**
 * x^k written in the lower powers of x, for the prime-power station counts a
 * class can actually reach (n <= 16 needs 32 students at 2 per station).
 * coeffs[t] is the coefficient of x^t.
 */
const FIELD_POLYNOMIALS: Record<number, { p: number; k: number; coeffs: number[] }> = {
  4: { p: 2, k: 2, coeffs: [1, 1] },        // x^2 = x + 1
  8: { p: 2, k: 3, coeffs: [1, 1, 0] },     // x^3 = x + 1
  9: { p: 3, k: 2, coeffs: [2, 0] },        // x^2 = 2
  16: { p: 2, k: 4, coeffs: [1, 1, 0, 0] }, // x^4 = x + 1
};

function isPrime(n: number): boolean {
  if (n < 2) return false;
  for (let d = 2; d * d <= n; d++) if (n % d === 0) return false;
  return true;
}

/**
 * Arithmetic on n symbols, when n admits it: integers mod n for a prime, and
 * polynomials mod an irreducible for a prime power. Null for 6, 10, 12, 14,
 * 15 and friends, where no such field exists and the seed falls back to a
 * rougher start for the search to clean up.
 */
const fieldCache = new Map<number, Field | null>();

function buildField(n: number): Field | null {
  const cached = fieldCache.get(n);
  if (cached !== undefined) return cached;
  const field = computeField(n);
  fieldCache.set(n, field);
  return field;
}

function computeField(n: number): Field | null {
  const table = (f: (i: number, j: number) => number) =>
    range(n).map((i) => range(n).map((j) => f(i, j)));

  if (isPrime(n)) {
    return { add: table((i, j) => (i + j) % n), mul: table((i, j) => (i * j) % n) };
  }

  const spec = FIELD_POLYNOMIALS[n];
  if (!spec) return null;
  const { p, k, coeffs } = spec;

  const digits = (v: number) => {
    const out: number[] = [];
    for (let i = 0; i < k; i++) { out.push(v % p); v = Math.floor(v / p); }
    return out;
  };
  const value = (d: number[]) => d.reduce((acc, digit, i) => acc + digit * p ** i, 0);

  return {
    add: table((i, j) => {
      const a = digits(i); const b = digits(j);
      return value(a.map((x, t) => (x + b[t]) % p));
    }),
    mul: table((i, j) => {
      const a = digits(i); const b = digits(j);
      const product = new Array<number>(2 * k - 1).fill(0);
      for (let x = 0; x < k; x++) {
        for (let y = 0; y < k; y++) product[x + y] = (product[x + y] + a[x] * b[y]) % p;
      }
      for (let deg = product.length - 1; deg >= k; deg--) {
        const carry = product[deg];
        if (!carry) continue;
        product[deg] = 0;
        for (let t = 0; t < k; t++) {
          product[deg - k + t] = (product[deg - k + t] + carry * coeffs[t]) % p;
        }
      }
      return value(product.slice(0, k));
    }),
  };
}

/**
 * The n rows "station = a * rotation + b", one per b. Each row is a full tour,
 * no two rows of the same a ever coincide, and two rows with different a
 * coincide in exactly one rotation -- which is the best a pair of students can
 * do. So when the station count is a prime power, handing each group its own a
 * builds a repeat-free plan outright and the search below has nothing to fix.
 */
function affineRows(field: Field, a: number, n: number): number[][] {
  return range(n).map((b) => range(n).map((r) => field.add[field.mul[a][r]][b]));
}

/** Same guarantees within a group as affineRows, for a step coprime to n. */
function cyclicRows(n: number, step: number, offset: number): number[][] {
  return Array.from({ length: n }, (_, j) =>
    Array.from({ length: n }, (_, r) => (offset + j + r * step) % n));
}

/** A group's rows from an arbitrary Latin square: valid, but nothing more. */
function randomLatinRows(n: number, rng: () => number): number[][] {
  const rowPerm = shuffled(range(n), rng);
  const colPerm = shuffled(range(n), rng);
  const symPerm = shuffled(range(n), rng);
  return Array.from({ length: n }, (_, j) =>
    Array.from({ length: n }, (_, r) => symPerm[(rowPerm[j] + colPerm[r]) % n]));
}

/**
 * A valid starting schedule: the class is cut into groups of n (plus a short
 * final group) and each group tours the stations on its own pattern. Distinct
 * patterns are what stop two groups shadowing each other, so the best ones go
 * out first and only a class needing more groups than there are good patterns
 * falls back to a random tour for the search to clean up.
 */
function seedMatrix(studentCount: number, n: number, rng: () => number): number[][] {
  const matrix: number[][] = new Array(studentCount);
  const order = shuffled(range(studentCount), rng);
  const groupCount = Math.ceil(studentCount / n);
  const field = buildField(n);
  const multipliers = field ? shuffled(range(n).slice(1), rng) : [];
  const steps = shuffled(coprimeSteps(n), rng);

  for (let g = 0; g < groupCount; g++) {
    let rows: number[][];
    if (field && g < multipliers.length) rows = affineRows(field, multipliers[g], n);
    else if (!field && g < steps.length) rows = cyclicRows(n, steps[g], Math.floor(rng() * n));
    else rows = randomLatinRows(n, rng);

    order.slice(g * n, (g + 1) * n).forEach((student, j) => {
      matrix[student] = [...rows[j]];
    });
  }
  return matrix;
}

/** meet[i * S + j] (i < j) = rotations student i and j spend together. */
function meetCounts(matrix: number[][], stationCount: number): Int32Array {
  const s = matrix.length;
  const meet = new Int32Array(s * s);
  for (let r = 0; r < stationCount; r++) {
    const at: number[][] = Array.from({ length: stationCount }, () => []);
    for (let i = 0; i < s; i++) at[matrix[i][r]].push(i);
    for (const group of at) {
      for (let a = 0; a < group.length; a++) {
        for (let b = a + 1; b < group.length; b++) meet[group[a] * s + group[b]]++;
      }
    }
  }
  return meet;
}

/** A second meeting costs 1, a third 4: clearing the worst pair comes first. */
function penalty(times: number): number {
  return times <= 1 ? 0 : (times - 1) * (times - 1);
}

function totalCost(meet: Int32Array, studentCount: number): number {
  let cost = 0;
  for (let i = 0; i < studentCount; i++) {
    for (let j = i + 1; j < studentCount; j++) cost += penalty(meet[i * studentCount + j]);
  }
  return cost;
}

/**
 * Local search over schedules.
 *
 * The move: two students trade places along a cycle of rotations. Take the
 * permutation that maps each of student i's stations to the station j is at in
 * the same rotation; every cycle of it is a set of rotations where i and j
 * between them use the same stations, so swapping the pair across exactly
 * those rotations leaves both rows a full tour and leaves every station's head
 * count in every rotation untouched. Only who works with whom changes, which
 * is the one thing the search is allowed to move.
 *
 * Acceptance is annealed: early on a worse schedule is often taken to get off
 * the plateaus this landscape is full of, and the temperature decays so the
 * tail of the run is a plain hill climb. The best schedule seen is kept.
 */
function improve(
  matrix: number[][],
  stationCount: number,
  rng: () => number,
  iterations: number,
): { matrix: number[][]; cost: number } {
  const s = matrix.length;
  const meet = meetCounts(matrix, stationCount);
  let cost = totalCost(meet, s);
  let best = matrix.map((row) => [...row]);
  let bestCost = cost;
  if (stationCount < 2 || s < 2) return { matrix: best, cost: bestCost };

  // where[i][station] = the rotation in which student i is at that station.
  const where: number[][] = matrix.map((row) => {
    const inverse = new Array<number>(stationCount);
    row.forEach((station, r) => { inverse[station] = r; });
    return inverse;
  });

  const changes = new Map<number, number>();
  const cycle: number[] = [];
  const startTemp = 1.5;
  const endTemp = 0.02;

  for (let step = 0; step < iterations && bestCost > 0; step++) {
    const i = Math.floor(rng() * s);
    let j = Math.floor(rng() * (s - 1));
    if (j >= i) j++;

    const start = Math.floor(rng() * stationCount);
    if (matrix[i][start] === matrix[j][start]) continue;

    cycle.length = 0;
    let r = start;
    do {
      cycle.push(r);
      r = where[i][matrix[j][r]];
    } while (r !== start && cycle.length <= stationCount);

    changes.clear();
    const bump = (x: number, y: number, d: number) => {
      const key = x < y ? x * s + y : y * s + x;
      changes.set(key, (changes.get(key) ?? 0) + d);
    };
    for (const round of cycle) {
      const si = matrix[i][round];
      const sj = matrix[j][round];
      for (let k = 0; k < s; k++) {
        if (k === i || k === j) continue;
        const sk = matrix[k][round];
        if (sk === si) { bump(i, k, -1); bump(j, k, 1); }
        else if (sk === sj) { bump(j, k, -1); bump(i, k, 1); }
      }
    }

    let delta = 0;
    changes.forEach((d, key) => {
      delta += penalty(meet[key] + d) - penalty(meet[key]);
    });

    if (delta > 0) {
      const temp = startTemp * Math.pow(endTemp / startTemp, step / iterations);
      if (rng() >= Math.exp(-delta / temp)) continue;
    }

    changes.forEach((d, key) => { meet[key] += d; });
    for (const round of cycle) {
      const si = matrix[i][round];
      const sj = matrix[j][round];
      matrix[i][round] = sj;
      matrix[j][round] = si;
      where[i][sj] = round;
      where[j][si] = round;
    }
    cost += delta;

    if (cost < bestCost) {
      bestCost = cost;
      best = matrix.map((row) => [...row]);
    }
  }

  return { matrix: best, cost: bestCost };
}

function searchSchedule(
  studentCount: number,
  stationCount: number,
  rng: () => number,
  restarts: number,
  iterations: number,
): number[][] {
  let best = seedMatrix(studentCount, stationCount, rng);
  let bestCost = totalCost(meetCounts(best, stationCount), studentCount);

  for (let attempt = 0; attempt < restarts && bestCost > 0; attempt++) {
    const seed = attempt === 0
      ? best.map((row) => [...row])
      : seedMatrix(studentCount, stationCount, rng);
    const result = improve(seed, stationCount, rng, iterations);
    if (result.cost < bestCost) {
      bestCost = result.cost;
      best = result.matrix;
    }
  }
  return best;
}

// ---- plan assembly -----------------------------------------------------------

/** Turn a schedule matrix into the plan the UI renders. */
export function planFromMatrix(
  students: RotationStudent[],
  matrix: number[][],
  classGroup: string,
): RotationPlan {
  const stationCount = matrix[0]?.length ?? 0;
  const byName = (a: RotationStudent, b: RotationStudent) => a.name.localeCompare(b.name);

  const rounds: RotationRound[] = range(stationCount).map((r) => ({
    round: r,
    stations: range(stationCount).map((station) => ({
      station,
      students: students.filter((_, i) => matrix[i][r] === station).sort(byName),
    })),
  }));

  const meet = meetCounts(matrix, stationCount);
  const repeats: RepeatPair[] = [];
  for (let i = 0; i < students.length; i++) {
    for (let j = i + 1; j < students.length; j++) {
      const times = meet[i * students.length + j];
      if (times > 1) repeats.push({ a: students[i], b: students[j], times });
    }
  }
  repeats.sort((x, y) => y.times - x.times || byName(x.a, y.a) || byName(x.b, y.b));

  return {
    class_group: classGroup,
    station_count: stationCount,
    students: [...students].sort(byName),
    rounds,
    repeats,
    generated_at: new Date().toISOString(),
  };
}

/**
 * Build a rotation plan for the given students.
 * Throws with a teacher-readable message when the station count cannot work.
 */
export function planStationRotation(
  students: RotationStudent[],
  stationCount: number,
  options: PlanOptions = {},
): RotationPlan {
  const problem = stationCountProblem(students.length, stationCount);
  if (problem) throw new Error(problem);

  const rng = options.rng ?? Math.random;
  const restarts = options.restarts ?? 6;
  const iterations = options.iterations ?? Math.max(3000, students.length * stationCount * 50);

  const matrix = searchSchedule(students.length, stationCount, rng, restarts, iterations);
  return planFromMatrix(students, matrix, options.classGroup ?? '');
}

/** Each student's own route: stations[r] is where they are in rotation r. */
export function studentItineraries(
  plan: RotationPlan,
): { student: RotationStudent; stations: number[] }[] {
  const stationOf = new Map<string, number[]>();
  plan.rounds.forEach((round) => {
    round.stations.forEach((station) => {
      station.students.forEach((student) => {
        if (!stationOf.has(student.student_id)) {
          stationOf.set(student.student_id, new Array(plan.station_count).fill(-1));
        }
        stationOf.get(student.student_id)![round.round] = station.station;
      });
    });
  });
  return plan.students.map((student) => ({
    student,
    stations: stationOf.get(student.student_id) ?? new Array(plan.station_count).fill(-1),
  }));
}

/** Everything a plan promises, checked. Empty list means the plan is sound. */
export function validatePlan(plan: RotationPlan): string[] {
  const problems: string[] = [];
  const n = plan.station_count;

  if (plan.rounds.length !== n) {
    problems.push(`expected ${n} rotations, found ${plan.rounds.length}`);
  }

  plan.rounds.forEach((round) => {
    const placed = round.stations.flatMap((s) => s.students.map((st) => st.student_id));
    if (new Set(placed).size !== placed.length) {
      problems.push(`rotation ${round.round + 1} places a student twice`);
    }
    if (placed.length !== plan.students.length) {
      problems.push(`rotation ${round.round + 1} places ${placed.length} of ${plan.students.length} students`);
    }
    round.stations.forEach((station) => {
      const size = station.students.length;
      if (size < MIN_STATION_STUDENTS || size > MAX_STATION_STUDENTS) {
        problems.push(
          `rotation ${round.round + 1} ${stationLabel(station.station)} has ${size} students`,
        );
      }
    });
  });

  studentItineraries(plan).forEach(({ student, stations }) => {
    if (new Set(stations).size !== n || stations.some((s) => s < 0)) {
      problems.push(`${student.name} does not visit every station exactly once`);
    }
  });

  return problems;
}
