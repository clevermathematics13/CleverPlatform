/**
 * Assessment seating - one student per desk, in columns and rows.
 *
 * The room this models has three columns of desks. Every row seats three
 * students except the back row, which has no left-hand desk and so seats two
 * (middle and right). A full room is therefore 6 x 3 + 2 = 20 students, and
 * the grid is built for the number of students actually sitting rather than
 * for the room: 12 students get four full rows and no back row at all.
 *
 * Genders alternate along and down the grid, starting B G B on row 1, then
 * G B G on row 2, and so on. That is the checkerboard `(row + col) % 2`, which
 * means no student is orthogonally next to, in front of, or behind someone of
 * the same gender - the point of the pattern, not a side effect of it.
 *
 * A class rarely splits exactly the way the checkerboard wants. Whichever
 * gender is in excess has to break the pattern somewhere, so the breaks are
 * put where they cost least: the desks with the fewest neighbours, which are
 * the corners and the back row. Students with no gender set are placed last
 * and take the *most* connected leftover desks, because they cannot break a
 * pattern they are not part of.
 *
 * Everything here is pure. `generateExamSeating()` at the bottom is the only
 * function that reads the clock, and it does nothing else.
 */

import type { Assignment, Gender, Student } from './seating-types';

/** A gender the pattern can actually ask for - everything but "not set". */
type SetGender = Exclude<Gender, ''>;

/** Desks across the room, left to right. */
export const EXAM_COLUMNS = 3;

/**
 * Columns the back row uses, in fill order. The back-left desk does not exist,
 * so a row that cannot be filled with three students uses the middle desk
 * first and then the right-hand one.
 */
export const EXAM_BACK_ROW_COLUMNS: readonly number[] = [2, 3];

/** Students seated by a full room: six rows of three, plus a back row of two. */
export const EXAM_FULL_ROOM = 6 * EXAM_COLUMNS + EXAM_BACK_ROW_COLUMNS.length;

export interface ExamCell {
  /** 1-based, row 1 at the front of the room. */
  row: number;
  /** 1-based: 1 = left, 2 = middle, 3 = right. */
  col: number;
  /** The gender the alternating pattern wants in this desk. */
  target: SetGender;
  /** Desks orthogonally adjacent to this one. Corners and the back row have fewest. */
  neighbours: number;
}

export interface ExamPlacement {
  cell: ExamCell;
  student: Student;
}

export interface ExamArrangement {
  placements: ExamPlacement[];
  /** Desks whose occupant is the gender the pattern wanted. */
  matched: number;
  /** Desks whose occupant is the other gender - the pattern breaks. */
  mismatched: number;
  /** Students with no gender set; they count as neither matched nor mismatched. */
  unset: number;
}

/** Seat id written to seating_assignments, e.g. `27AH-EXAM-R3C2`. */
export function examSeatId(classGroup: string, cell: ExamCell): string {
  return `${classGroup}-EXAM-${examCellKey(cell)}`;
}

/** Position part of a seat id, stable across class groups: `R3C2`. */
export function examCellKey(cell: { row: number; col: number }): string {
  return `R${cell.row}C${cell.col}`;
}

/** The `R3C2` out of a seat id, or '' if this is not an assessment seat. */
export function parseExamSeatId(seatId: string): string {
  const marker = '-EXAM-';
  const at = seatId.lastIndexOf(marker);
  return at === -1 ? '' : seatId.slice(at + marker.length);
}

/** Assessment runs are tagged so group seating can ignore them, and vice versa. */
export const EXAM_RUN_PREFIX = 'EXAM_';

export function isExamRun(runId: string): boolean {
  return runId.startsWith(EXAM_RUN_PREFIX);
}

/** The gender the alternating pattern wants in a desk: BGB, then GBG, and on. */
export function examTargetFor(row: number, col: number): SetGender {
  return (row + col) % 2 === 0 ? 'B' : 'G';
}

/**
 * The desks needed to seat `studentCount` students, in reading order: rows of
 * three from the front, then a back row of the 1 or 2 left over, which uses
 * the middle desk first because the back-left one does not exist.
 */
export function buildExamGrid(studentCount: number): ExamCell[] {
  const n = Math.max(0, Math.floor(studentCount));
  const fullRows = Math.floor(n / EXAM_COLUMNS);
  const remainder = n % EXAM_COLUMNS;

  const cells: Omit<ExamCell, 'neighbours'>[] = [];
  for (let row = 1; row <= fullRows; row++) {
    for (let col = 1; col <= EXAM_COLUMNS; col++) {
      cells.push({ row, col, target: examTargetFor(row, col) });
    }
  }
  if (remainder > 0) {
    const row = fullRows + 1;
    EXAM_BACK_ROW_COLUMNS.slice(0, remainder).forEach((col) => {
      cells.push({ row, col, target: examTargetFor(row, col) });
    });
  }

  const occupied = new Set(cells.map((c) => `${c.row},${c.col}`));
  return cells.map((c) => ({
    ...c,
    neighbours: [
      [c.row - 1, c.col],
      [c.row + 1, c.col],
      [c.row, c.col - 1],
      [c.row, c.col + 1],
    ].filter(([r, col]) => occupied.has(`${r},${col}`)).length,
  }));
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Fewest neighbours first, then furthest back - the cheapest desks to break the pattern in. */
function byCheapestToBreak(a: ExamCell, b: ExamCell): number {
  return a.neighbours - b.neighbours || b.row - a.row || a.col - b.col;
}

/**
 * Re-seat anyone who drew the desk they sat in last time, by swapping them
 * with a student of the same gender - which leaves the gender layout, and so
 * the pattern score, exactly as it was. Only swaps that free both students
 * from a repeat are taken.
 */
function breakUpSeatRepeats(
  placements: ExamPlacement[],
  previousCellKeys: Map<string, string>,
): void {
  const repeats = (p: ExamPlacement) =>
    previousCellKeys.get(p.student.student_id) === examCellKey(p.cell);

  for (let i = 0; i < placements.length; i++) {
    if (!repeats(placements[i])) continue;
    for (let j = 0; j < placements.length; j++) {
      if (i === j) continue;
      const a = placements[i];
      const b = placements[j];
      if (a.student.gender !== b.student.gender) continue;
      const aWouldRepeat = previousCellKeys.get(a.student.student_id) === examCellKey(b.cell);
      const bWouldRepeat = previousCellKeys.get(b.student.student_id) === examCellKey(a.cell);
      if (aWouldRepeat || bWouldRepeat) continue;
      [a.student, b.student] = [b.student, a.student];
      break;
    }
  }
}

/**
 * Seat `students` in the assessment grid, following the alternating pattern as
 * closely as the class allows.
 *
 * `previousCellKeys` maps student_id to the `R3C2` they had in the last
 * assessment run; anyone who would draw the same desk again is swapped with
 * someone the pattern cannot tell them apart from.
 */
export function arrangeExamSeating(
  students: Student[],
  previousCellKeys: Map<string, string> = new Map(),
): ExamArrangement {
  const cells = buildExamGrid(students.length);

  const pools: Record<SetGender, Student[]> = {
    B: shuffle(students.filter((s) => s.gender === 'B')),
    G: shuffle(students.filter((s) => s.gender === 'G')),
  };
  const unset = shuffle(students.filter((s) => s.gender !== 'B' && s.gender !== 'G'));

  const placements: ExamPlacement[] = [];
  const spareCells: ExamCell[] = [];

  // Seat everyone the pattern has room for. Where a gender runs short, the
  // desks left standing empty are the cheapest ones to break the pattern in,
  // because the well-connected desks were filled correctly first.
  (['B', 'G'] as const).forEach((target) => {
    const targetCells = cells
      .filter((c) => c.target === target)
      .sort((a, b) => byCheapestToBreak(b, a));
    targetCells.forEach((cell) => {
      const student = pools[target].pop();
      if (student) placements.push({ cell, student });
      else spareCells.push(cell);
    });
  });

  // Whoever is left over: students of the wrong gender first, into the desks
  // that break the pattern most cheaply, and students with no gender set into
  // whatever remains - they break nothing wherever they sit.
  const leftover = [...pools.B, ...pools.G, ...unset];
  spareCells.sort(byCheapestToBreak).forEach((cell, i) => {
    const student = leftover[i];
    if (!student) return;
    placements.push({ cell, student });
  });

  breakUpSeatRepeats(placements, previousCellKeys);

  placements.sort((a, b) => a.cell.row - b.cell.row || a.cell.col - b.cell.col);

  return {
    placements,
    matched: placements.filter((p) => p.student.gender === p.cell.target).length,
    mismatched: placements.filter(
      (p) => p.student.gender !== '' && p.student.gender !== p.cell.target,
    ).length,
    unset: placements.filter((p) => p.student.gender === '').length,
  };
}

/** Everyone's desk in the most recent assessment run for this class. */
export function previousExamCells(
  allAssignments: Assignment[],
  classGroup: string,
): Map<string, string> {
  const run = latestExamRun(allAssignments, classGroup);
  return new Map(run.map((a) => [a.student_id, parseExamSeatId(a.seat_id)]));
}

/** Rows of the most recent assessment run for this class, newest run only. */
export function latestExamRun(allAssignments: Assignment[], classGroup: string): Assignment[] {
  const exam = allAssignments.filter((a) => a.class_group === classGroup && isExamRun(a.run_id));
  if (exam.length === 0) return [];
  const newest = exam.reduce((best, a) => (a.timestamp > best.timestamp ? a : best), exam[0]);
  return exam
    .filter((a) => a.run_id === newest.run_id)
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * How well a stored assessment run follows the pattern. Read back off the run
 * itself rather than remembered from generation, so a reloaded page reports
 * what is actually on the chart.
 */
export function summariseExamRun(
  rows: Assignment[],
  genderOf: Map<string, Gender>,
): { total: number; matched: number; mismatched: number; unset: number } {
  let matched = 0;
  let mismatched = 0;
  let unset = 0;
  rows.forEach((r) => {
    const gender = genderOf.get(r.student_id) ?? '';
    if (!gender) unset++;
    else if (gender === examTargetFor(Number(r.y), Number(r.x))) matched++;
    else mismatched++;
  });
  return { total: rows.length, matched, mismatched, unset };
}

/**
 * Assessment seating for a class, ready to write to seating_assignments.
 *
 * `x` and `y` carry the column and row so the chart can rebuild the grid from
 * a stored run without re-deriving anything, and `pod_id` / `seat_role` stay
 * populated because the History tab reads them for every run.
 */
export function generateExamSeating(
  students: Student[],
  allAssignments: Assignment[],
  classGroup: string,
): { assignments: Assignment[]; arrangement: ExamArrangement } {
  const active = students.filter((s) => s.active && s.class_group === classGroup);
  if (active.length === 0) throw new Error(`No active students for "${classGroup}"`);

  const arrangement = arrangeExamSeating(active, previousExamCells(allAssignments, classGroup));

  const now = new Date();
  const runId = `${EXAM_RUN_PREFIX}${Date.now()}`;
  const assignments = arrangement.placements.map(({ cell, student }) => ({
    timestamp: now.toISOString(),
    date: now.toISOString().slice(0, 10),
    class_group: classGroup,
    run_id: runId,
    candidate_score: arrangement.matched,
    student_id: student.student_id,
    name: student.name,
    seat_id: examSeatId(classGroup, cell),
    pod_id: `Row ${cell.row}`,
    seat_role: `C${cell.col}`,
    x: cell.col,
    y: cell.row,
  }));

  return { assignments, arrangement };
}
