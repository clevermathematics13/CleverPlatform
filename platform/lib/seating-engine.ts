import type { Student, Seat, Rule, Assignment, Setting, RuleFeedback } from './seating-types';

interface ScoredCandidate {
  assignment: Map<string, Seat>;
  score: number;
}

interface HistoryStats {
  pairCount: Map<string, number>;
  seatRepeatCount: Map<string, number>;
}

interface SettingsMap {
  candidateCount: number;
  topK: number;
  temperature: number;
  historyRuns: number;
  freshnessPairWeight: number;
  freshnessSeatWeight: number;
}

interface HardConstraints {
  hardPodMust: Map<string, string>;
  hardPodNever: Map<string, Set<string>>;
  hardPairTogether: Set<string>;
  hardPairApart: Set<string>;
  hardPodMinSize: Map<string, number>;
  hardSeatMust: Map<string, string>; // studentId → seat_id
}

function canonicalPairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function parseSettings(settings: Setting[]): SettingsMap {
  const map = new Map(settings.map((s) => [s.key, s.value]));
  return {
    candidateCount: map.get('candidate_count') || 900,
    topK: map.get('top_k') || 40,
    temperature: map.get('temperature') || 2.0,
    historyRuns: map.get('history_runs') || 5,
    freshnessPairWeight: map.get('freshness_pair_weight') || 1.5,
    freshnessSeatWeight: map.get('freshness_seat_weight') || 0.5,
  };
}

function parseRules(rules: Rule[], classGroup: string) {
  const pairWeights = new Map<string, number>();
  const podWeights = new Map<string, number>();
  const hardPodMust = new Map<string, string>();
  const hardPodNever = new Map<string, Set<string>>();
  const hardPairTogether = new Set<string>();
  const hardPairApart = new Set<string>();
  const hardPodMinSize = new Map<string, number>();
  const hardSeatMust = new Map<string, string>();

  rules
    .filter((r) => r.active && (r.class_group === classGroup || r.class_group === '*'))
    .forEach((r) => {
      const isHard = Math.abs(r.weight) >= 15;
      if (r.rule_type === 'PAIR' && r.student_a && r.student_b) {
        const key = canonicalPairKey(r.student_a, r.student_b);
        if (isHard) {
          if (r.weight > 0) hardPairTogether.add(key);
          else hardPairApart.add(key);
        }
        pairWeights.set(key, r.weight);
      } else if (r.rule_type === 'SEAT' && r.student_id && r.seat_id) {
        hardSeatMust.set(r.student_id, r.seat_id);
      } else if (r.rule_type === 'POD' && r.student_id) {
        if (!r.pod_id && r.weight >= 2) {
          // Min pod size: weight = minimum number of students in this student's pod
          hardPodMinSize.set(r.student_id, Math.round(r.weight));
        } else if (r.pod_id) {
          if (isHard) {
            if (r.weight > 0) {
              hardPodMust.set(r.student_id, r.pod_id);
            } else {
              if (!hardPodNever.has(r.student_id)) hardPodNever.set(r.student_id, new Set());
              hardPodNever.get(r.student_id)!.add(r.pod_id);
            }
          }
          podWeights.set(`${r.student_id}|${r.pod_id}`, r.weight);
        }
      }
    });

  return { pairWeights, podWeights, hardPodMust, hardPodNever, hardPairTogether, hardPairApart, hardPodMinSize, hardSeatMust };
}

function buildHistoryStats(
  assignments: Assignment[],
  classGroup: string,
  historyRuns: number
): HistoryStats {
  const relevant = assignments
    .filter((a) => a.class_group === classGroup)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const runOrder: string[] = [];
  const seenRuns = new Set<string>();
  relevant.forEach((r) => {
    if (r.run_id && !seenRuns.has(r.run_id)) {
      seenRuns.add(r.run_id);
      runOrder.push(r.run_id);
    }
  });

  const selectedRuns = new Set(runOrder.slice(0, historyRuns));
  const byRun = new Map<string, Assignment[]>();
  relevant.forEach((r) => {
    if (!selectedRuns.has(r.run_id)) return;
    if (!byRun.has(r.run_id)) byRun.set(r.run_id, []);
    byRun.get(r.run_id)!.push(r);
  });

  const pairCount = new Map<string, number>();
  const seatRepeatCount = new Map<string, number>();

  byRun.forEach((rows) => {
    const podMap = new Map<string, string[]>();
    rows.forEach((r) => {
      const seatKey = `${r.student_id}|${r.seat_id}`;
      seatRepeatCount.set(seatKey, (seatRepeatCount.get(seatKey) || 0) + 1);
      if (!podMap.has(r.pod_id)) podMap.set(r.pod_id, []);
      podMap.get(r.pod_id)!.push(r.student_id);
    });
    podMap.forEach((ids) => {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const key = canonicalPairKey(ids[i], ids[j]);
          pairCount.set(key, (pairCount.get(key) || 0) + 1);
        }
      }
    });
  });

  return { pairCount, seatRepeatCount };
}

function scoreCandidate(
  assignment: Map<string, Seat>,
  pairWeights: Map<string, number>,
  podWeights: Map<string, number>,
  history: HistoryStats,
  settings: SettingsMap
): number {
  let score = 0;
  const podToStudents = new Map<string, string[]>();

  assignment.forEach((seat, studentId) => {
    if (!podToStudents.has(seat.pod_id)) podToStudents.set(seat.pod_id, []);
    podToStudents.get(seat.pod_id)!.push(studentId);
    score += podWeights.get(`${studentId}|${seat.pod_id}`) || 0;
    const seatKey = `${studentId}|${seat.seat_id}`;
    score -= settings.freshnessSeatWeight * (history.seatRepeatCount.get(seatKey) || 0);
  });

  podToStudents.forEach((ids) => {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = canonicalPairKey(ids[i], ids[j]);
        score += pairWeights.get(key) || 0;
        score -= settings.freshnessPairWeight * (history.pairCount.get(key) || 0);
      }
    }
  });

  return score;
}

function rebalanceLastPod(assignment: Map<string, Seat>, allSeats: Seat[], hc: HardConstraints): void {
  const podStudents = new Map<string, string[]>();
  assignment.forEach((seat, studentId) => {
    if (!podStudents.has(seat.pod_id)) podStudents.set(seat.pod_id, []);
    podStudents.get(seat.pod_id)!.push(studentId);
  });

  const podIds = [...podStudents.keys()].sort();
  if (podIds.length < 2) return;

  const lastPodId = podIds[podIds.length - 1];
  const prevPodId = podIds[podIds.length - 2];
  const lastStudents = podStudents.get(lastPodId)!;
  const prevStudents = podStudents.get(prevPodId)!;

  if (lastStudents.length === 1 && prevStudents.length === 3) {
    const occupiedSeatIds = new Set<string>();
    assignment.forEach((seat) => occupiedSeatIds.add(seat.seat_id));
    const emptySeatsInLastPod = allSeats.filter(
      (s) => s.pod_id === lastPodId && !occupiedSeatIds.has(s.seat_id)
    );
    if (emptySeatsInLastPod.length === 0) return;

    // Only move students that have no hard pod/seat constraints.
    const moveable = prevStudents.filter(
      (sid) => !hc.hardPodMust.has(sid) && !hc.hardSeatMust.has(sid)
    );
    if (moveable.length === 0) return;
    const moveIdx = Math.floor(Math.random() * moveable.length);
    const studentToMove = moveable[moveIdx];
    const emptySeat = emptySeatsInLastPod[Math.floor(Math.random() * emptySeatsInLastPod.length)];
    assignment.set(studentToMove, emptySeat);
  }
}

function satisfiesHardConstraints(
  assignment: Map<string, Seat>,
  hc: HardConstraints
): boolean {
  // Build pod occupancy map (needed for min-size and pair checks)
  const podToStudents = new Map<string, Set<string>>();
  assignment.forEach((seat, studentId) => {
    if (!podToStudents.has(seat.pod_id)) podToStudents.set(seat.pod_id, new Set());
    podToStudents.get(seat.pod_id)!.add(studentId);
  });

  for (const [studentId, seat] of assignment) {
    const mustPod = hc.hardPodMust.get(studentId);
    if (mustPod && seat.pod_id !== mustPod) return false;
    const neverPods = hc.hardPodNever.get(studentId);
    if (neverPods && neverPods.has(seat.pod_id)) return false;
    const mustSeat = hc.hardSeatMust.get(studentId);
    if (mustSeat && seat.seat_id !== mustSeat) return false;
  }

  // Check minimum pod occupancy constraints
  for (const [studentId, minSize] of hc.hardPodMinSize) {
    const seat = assignment.get(studentId);
    if (!seat) continue;
    const occupancy = podToStudents.get(seat.pod_id)?.size ?? 0;
    if (occupancy < minSize) return false;
  }

  for (const key of hc.hardPairTogether) {
    const [a, b] = key.split('|');
    const seatA = assignment.get(a);
    const seatB = assignment.get(b);
    if (seatA && seatB && seatA.pod_id !== seatB.pod_id) return false;
  }
  for (const key of hc.hardPairApart) {
    const [a, b] = key.split('|');
    const seatA = assignment.get(a);
    const seatB = assignment.get(b);
    if (seatA && seatB && seatA.pod_id === seatB.pod_id) return false;
  }

  return true;
}

function sampleBySoftmax(pool: ScoredCandidate[], temperature: number): ScoredCandidate {
  const t = Math.max(0.05, temperature);
  const maxScore = Math.max(...pool.map((c) => c.score));
  const weights = pool.map((c) => Math.exp((c.score - maxScore) / t));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

export function generateSeating(
  students: Student[],
  seats: Seat[],
  rules: Rule[],
  allAssignments: Assignment[],
  settings: Setting[],
  classGroup: string
): Assignment[] {
  const activeStudents = students.filter(
    (s) => s.active && s.class_group === classGroup
  );
  const activeSeats = seats.filter(
    (s) => s.active && (s.class_group === classGroup || s.class_group === '*')
  );

  if (activeStudents.length === 0) throw new Error(`No active students for "${classGroup}"`);
  if (activeSeats.length === 0) throw new Error(`No active seats for "${classGroup}"`);
  if (activeStudents.length > activeSeats.length)
    throw new Error(`Students (${activeStudents.length}) exceed seats (${activeSeats.length})`);

  const cfg = parseSettings(settings);
  const { pairWeights, podWeights, hardPodMust, hardPodNever, hardPairTogether, hardPairApart, hardPodMinSize, hardSeatMust } =
    parseRules(rules, classGroup);
  const hc: HardConstraints = { hardPodMust, hardPodNever, hardPairTogether, hardPairApart, hardPodMinSize, hardSeatMust };
  const history = buildHistoryStats(allAssignments, classGroup, cfg.historyRuns);

  const seatsByPod = [...activeSeats].sort(
    (a, b) => a.pod_id.localeCompare(b.pod_id) || a.seat_role.localeCompare(b.seat_role)
  );

  const seatsByPodMap = new Map<string, Seat[]>();
  seatsByPod.forEach((s) => {
    if (!seatsByPodMap.has(s.pod_id)) seatsByPodMap.set(s.pod_id, []);
    seatsByPodMap.get(s.pod_id)!.push(s);
  });

  // Cap min-pod-size constraints to the actual largest pod so an absurd weight
  // (e.g. 15 from a mis-dragged slider) never makes generation impossible.
  const maxPodSize = Math.max(...[...seatsByPodMap.values()].map((p) => p.length), 1);
  for (const [sid, size] of hardPodMinSize) {
    if (size > maxPodSize) hardPodMinSize.set(sid, maxPodSize);
  }

  const candidates: ScoredCandidate[] = [];
  for (let i = 0; i < cfg.candidateCount; i++) {
    const assignment = new Map<string, Seat>();
    const usedSeatIds = new Set<string>();
    const placedStudentIds = new Set<string>();

    for (const [studentId, mustPod] of hardPodMust) {
      const podSeats = seatsByPodMap.get(mustPod);
      if (!podSeats) continue;
      const available = podSeats.filter((s) => !usedSeatIds.has(s.seat_id));
      if (available.length === 0) continue;
      const seat = available[Math.floor(Math.random() * available.length)];
      assignment.set(studentId, seat);
      usedSeatIds.add(seat.seat_id);
      placedStudentIds.add(studentId);
    }

    // Place students pinned to a specific seat
    for (const [studentId, mustSeatId] of hardSeatMust) {
      const seat = activeSeats.find((s) => s.seat_id === mustSeatId);
      if (!seat || usedSeatIds.has(seat.seat_id)) continue;
      assignment.set(studentId, seat);
      usedSeatIds.add(seat.seat_id);
      placedStudentIds.add(studentId);
    }

    const remainingStudents = shuffle(
      activeStudents.filter((s) => !placedStudentIds.has(s.student_id))
    );
    const remainingSeats = seatsByPod.filter((s) => !usedSeatIds.has(s.seat_id));

    remainingStudents.forEach((st, idx) => {
      if (idx < remainingSeats.length) {
        assignment.set(st.student_id, remainingSeats[idx]);
      }
    });

    rebalanceLastPod(assignment, seatsByPod, hc);

    if (!satisfiesHardConstraints(assignment, hc)) continue;

    const score = scoreCandidate(assignment, pairWeights, podWeights, history, cfg);
    candidates.push({ assignment, score });
  }

  if (candidates.length === 0) {
    throw new Error('No valid seating found. Check for conflicting guaranteed (🔒) rules.');
  }

  candidates.sort((a, b) => b.score - a.score);
  const pool = candidates.slice(0, Math.min(cfg.topK, candidates.length));
  const chosen = sampleBySoftmax(pool, cfg.temperature);

  const runId = `RUN_${Date.now()}`;
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const studentMap = new Map(activeStudents.map((s) => [s.student_id, s.name]));

  const result: Assignment[] = [];
  chosen.assignment.forEach((seat, studentId) => {
    result.push({
      timestamp: now.toISOString(),
      date: dateStr,
      class_group: classGroup,
      run_id: runId,
      candidate_score: chosen.score,
      student_id: studentId,
      name: studentMap.get(studentId) || '',
      seat_id: seat.seat_id,
      pod_id: seat.pod_id,
      seat_role: seat.seat_role,
      x: seat.x,
      y: seat.y,
    });
  });

  result.sort((a, b) => a.pod_id.localeCompare(b.pod_id) || a.seat_role.localeCompare(b.seat_role));
  return result;
}

/** Evaluate each active rule against a completed assignment and return feedback. */
export function evaluateRules(
  rules: Rule[],
  assignments: Assignment[],
  classGroup: string
): RuleFeedback[] {
  const activeRules = rules.filter(
    (r) => r.active && (r.class_group === classGroup || r.class_group === '*')
  );
  if (activeRules.length === 0 || assignments.length === 0) return [];

  // Build lookup maps from the assignment
  const seatOf = new Map<string, Assignment>(); // studentId → assignment
  const podStudents = new Map<string, string[]>(); // podId → studentIds
  assignments.forEach((a) => {
    seatOf.set(a.student_id, a);
    if (!podStudents.has(a.pod_id)) podStudents.set(a.pod_id, []);
    podStudents.get(a.pod_id)!.push(a.student_id);
  });

  const nameOf = (id: string) => seatOf.get(id)?.name ?? id;

  return activeRules.map((rule): RuleFeedback => {
    if (rule.rule_type === 'SEAT' && rule.student_id && rule.seat_id) {
      const a = seatOf.get(rule.student_id);
      const satisfied = a?.seat_id === rule.seat_id;
      return {
        rule,
        satisfied,
        detail: satisfied
          ? `${nameOf(rule.student_id)} is in seat ${rule.seat_id} ✓`
          : `${nameOf(rule.student_id)} ended up in ${a?.seat_id ?? 'unknown'} instead of ${rule.seat_id}`,
      };
    }

    if (rule.rule_type === 'POD' && rule.student_id) {
      const a = seatOf.get(rule.student_id);
      if (!a) return { rule, satisfied: false, detail: `${nameOf(rule.student_id)} not assigned` };

      // Min pod-size rule
      if (!rule.pod_id && rule.weight >= 2) {
        const size = podStudents.get(a.pod_id)?.length ?? 0;
        const satisfied = size >= rule.weight;
        return {
          rule,
          satisfied,
          detail: satisfied
            ? `${nameOf(rule.student_id)} is in pod ${a.pod_id} with ${size} people ✓`
            : `${nameOf(rule.student_id)} is in pod ${a.pod_id} with only ${size} person(s) (min ${rule.weight})`,
        };
      }

      // Standard POD rule
      const inCorrectPod = a.pod_id === rule.pod_id;
      const satisfied = rule.weight >= 0 ? inCorrectPod : !inCorrectPod;
      return {
        rule,
        satisfied,
        detail: satisfied
          ? `${nameOf(rule.student_id)} is ${rule.weight >= 0 ? 'in' : 'not in'} pod ${rule.pod_id} ✓`
          : `${nameOf(rule.student_id)} is in ${a.pod_id}, expected ${rule.weight >= 0 ? '' : 'not '}${rule.pod_id}`,
      };
    }

    if (rule.rule_type === 'PAIR' && rule.student_a && rule.student_b) {
      const a = seatOf.get(rule.student_a);
      const b = seatOf.get(rule.student_b);
      if (!a || !b) return { rule, satisfied: false, detail: 'One or both students not assigned' };
      const samePod = a.pod_id === b.pod_id;
      const shouldBeTogether = rule.weight > 0;
      const satisfied = shouldBeTogether ? samePod : !samePod;
      return {
        rule,
        satisfied,
        detail: satisfied
          ? `${nameOf(rule.student_a)} & ${nameOf(rule.student_b)} ${samePod ? 'are together' : 'are apart'} ✓`
          : `${nameOf(rule.student_a)} & ${nameOf(rule.student_b)} ${samePod ? 'ended up together (should be apart)' : 'ended up apart (should be together)'}`,
      };
    }

    return { rule, satisfied: true, detail: 'Rule not evaluated (incomplete fields)' };
  });
}
