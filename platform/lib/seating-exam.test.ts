import { describe, it, expect } from 'vitest';
import {
  arrangeExamSeating,
  buildExamGrid,
  summariseExamRun,
  examCellKey,
  EXAM_FULL_ROOM,
  isExamRun,
  latestExamRun,
  parseExamSeatId,
} from './seating-exam';
import type { Assignment, Gender, Student } from './seating-types';

function roster(pattern: string, classGroup = '27AH'): Student[] {
  return [...pattern].map((g, i) => ({
    student_id: `s${i + 1}@example.com`,
    name: `Student ${i + 1}`,
    class_group: classGroup,
    active: true,
    notes: '',
    gender: (g === '-' ? '' : g) as Gender,
  }));
}

/** The grid drawn as one string per row, '.' for the missing back-left desk. */
function render(placements: { cell: { row: number; col: number }; student: Student }[]): string[] {
  const rows: string[][] = [];
  placements.forEach(({ cell, student }) => {
    const row = (rows[cell.row - 1] ??= ['.', '.', '.']);
    row[cell.col - 1] = student.gender || '?';
  });
  return rows.map((r) => r.join(''));
}

describe('buildExamGrid', () => {
  it('seats a full room as six rows of three plus a back row of two', () => {
    const cells = buildExamGrid(EXAM_FULL_ROOM);
    expect(EXAM_FULL_ROOM).toBe(20);
    expect(cells).toHaveLength(20);

    const byRow = new Map<number, number[]>();
    cells.forEach((c) => byRow.set(c.row, [...(byRow.get(c.row) ?? []), c.col]));
    expect([...byRow.keys()]).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const row of [1, 2, 3, 4, 5, 6]) expect(byRow.get(row)).toEqual([1, 2, 3]);
    // Back row: middle and right only, no left-hand desk.
    expect(byRow.get(7)).toEqual([2, 3]);
  });

  it('wants BGB on row 1 and GBG on row 2', () => {
    const cells = buildExamGrid(6);
    const targets = (row: number) =>
      cells.filter((c) => c.row === row).sort((a, b) => a.col - b.col).map((c) => c.target);
    expect(targets(1)).toEqual(['B', 'G', 'B']);
    expect(targets(2)).toEqual(['G', 'B', 'G']);
  });

  it('builds only as many desks as there are students', () => {
    expect(buildExamGrid(12)).toHaveLength(12);
    expect(buildExamGrid(12).filter((c) => c.row === 4)).toHaveLength(3);
    expect(buildExamGrid(0)).toHaveLength(0);
  });

  it('puts a partial last row in the middle and right desks', () => {
    const one = buildExamGrid(13).filter((c) => c.row === 5);
    expect(one.map((c) => c.col)).toEqual([2]);
    const two = buildExamGrid(14).filter((c) => c.row === 5);
    expect(two.map((c) => c.col)).toEqual([2, 3]);
  });

  it("counts each desk's orthogonal neighbours", () => {
    const cells = buildExamGrid(9);
    const at = (row: number, col: number) => cells.find((c) => c.row === row && c.col === col)!;
    expect(at(2, 2).neighbours).toBe(4); // middle of a 3x3 block
    expect(at(1, 1).neighbours).toBe(2); // front-left corner
    expect(at(3, 3).neighbours).toBe(2); // back-right corner
    expect(at(1, 2).neighbours).toBe(3); // front edge
  });
});

describe('arrangeExamSeating', () => {
  it('follows the pattern exactly when the class splits that way', () => {
    // 20 students, 10 of each: exactly what the full-room checkerboard wants.
    const students = roster('BGBGBGBGBGBGBGBGBGBG');
    const { placements, matched, mismatched } = arrangeExamSeating(students);
    expect(matched).toBe(20);
    expect(mismatched).toBe(0);
    expect(render(placements)).toEqual(['BGB', 'GBG', 'BGB', 'GBG', 'BGB', 'GBG', '.GB']);
  });

  it('seats every student exactly once, in exactly one desk', () => {
    const students = roster('BBBBBBBGGGGG');
    const { placements } = arrangeExamSeating(students);
    expect(placements).toHaveLength(students.length);
    expect(new Set(placements.map((p) => p.student.student_id)).size).toBe(students.length);
    expect(new Set(placements.map((p) => examCellKey(p.cell))).size).toBe(students.length);
  });

  it('gets as close as possible when one gender is in excess', () => {
    // 12 desks want 6 of each; this class is 8 boys and 4 girls, so two desks
    // cannot be right however they are filled.
    const { matched, mismatched, unset } = arrangeExamSeating(roster('BBBBBBBBGGGG'));
    expect(matched).toBe(10);
    expect(mismatched).toBe(2);
    expect(unset).toBe(0);
  });

  it('breaks the pattern in the least connected desks', () => {
    const { placements } = arrangeExamSeating(roster('BBBBBBBBGGGG'));
    const broken = placements.filter((p) => p.student.gender !== p.cell.target);
    expect(broken).toHaveLength(2);
    // A 12-student grid is four full rows; its least connected desks are the
    // four corners, and the back ones are preferred over the front ones.
    broken.forEach((p) => {
      expect(p.cell.neighbours).toBe(2);
      expect(p.cell.row).toBe(4);
    });
  });

  it('gives students with no gender set the desks that break nothing', () => {
    // 6 boys, 3 girls, 3 unset in a 12-desk grid that wants 6 of each: the
    // boys fit, and the unset students should soak up the three girl-short
    // desks rather than displacing a girl into a boy's.
    const { placements, matched, mismatched, unset } = arrangeExamSeating(
      roster('BBBBBBGGG---'),
    );
    expect(matched).toBe(9);
    expect(mismatched).toBe(0);
    expect(unset).toBe(3);
    placements
      .filter((p) => p.student.gender === '')
      .forEach((p) => expect(p.cell.target).toBe('G'));
  });

  it('seats an all-unset class without complaint', () => {
    const { placements, matched, mismatched, unset } = arrangeExamSeating(roster('-------'));
    expect(placements).toHaveLength(7);
    expect(matched).toBe(0);
    expect(mismatched).toBe(0);
    expect(unset).toBe(7);
  });

  it('moves every student off the desk they had last time', () => {
    const students = roster('BGBGBGBGBGBG');
    const first = arrangeExamSeating(students);
    const firstCells = new Map(
      first.placements.map((p) => [p.student.student_id, examCellKey(p.cell)]),
    );
    const second = arrangeExamSeating(students, firstCells);
    const repeats = second.placements.filter(
      (p) => firstCells.get(p.student.student_id) === examCellKey(p.cell),
    );
    expect(repeats).toEqual([]);
  });

  it('keeps the pattern score when it breaks up seat repeats', () => {
    const students = roster('BBBBBBBBGGGG');
    const first = arrangeExamSeating(students);
    const firstCells = new Map(first.placements.map((p) => [p.student.student_id, examCellKey(p.cell)]));
    const second = arrangeExamSeating(students, firstCells);
    expect(second.matched).toBe(first.matched);
    expect(second.mismatched).toBe(first.mismatched);
  });
});

describe('summariseExamRun', () => {
  it('scores a stored run against the pattern it should have followed', () => {
    const rows: Assignment[] = [
      { ...blank(), student_id: 'boy', y: 1, x: 1 },      // wants B
      { ...blank(), student_id: 'girl', y: 1, x: 2 },     // wants G
      { ...blank(), student_id: 'wrong', y: 1, x: 3 },    // wants B, is a G
      { ...blank(), student_id: 'nobody', y: 2, x: 1 },   // no gender set
    ];
    const genders = new Map<string, Gender>([
      ['boy', 'B'],
      ['girl', 'G'],
      ['wrong', 'G'],
    ]);
    expect(summariseExamRun(rows, genders)).toEqual({
      total: 4,
      matched: 2,
      mismatched: 1,
      unset: 1,
    });
  });
});

describe('run tagging', () => {
  it('tells assessment runs apart from group runs', () => {
    expect(isExamRun('EXAM_1757870000000')).toBe(true);
    expect(isExamRun('RUN_1757870000000')).toBe(false);
  });

  it('reads the position back out of a seat id', () => {
    expect(parseExamSeatId('27AH-EXAM-R3C2')).toBe('R3C2');
    expect(parseExamSeatId('Grade 9 Extended-EXAM-R1C1')).toBe('R1C1');
    expect(parseExamSeatId('27AH-Pod A-L')).toBe('');
  });

  it('returns only the newest assessment run for the class', () => {
    const rows: Assignment[] = [
      { ...blank(), class_group: '27AH', run_id: 'EXAM_1', timestamp: '2026-09-01T00:00:00Z', student_id: 'a', y: 1, x: 1 },
      { ...blank(), class_group: '27AH', run_id: 'EXAM_2', timestamp: '2026-09-08T00:00:00Z', student_id: 'b', y: 1, x: 2 },
      { ...blank(), class_group: '27AH', run_id: 'EXAM_2', timestamp: '2026-09-08T00:00:00Z', student_id: 'c', y: 1, x: 1 },
      { ...blank(), class_group: '27AH', run_id: 'RUN_9', timestamp: '2026-09-09T00:00:00Z', student_id: 'd' },
      { ...blank(), class_group: '9A', run_id: 'EXAM_3', timestamp: '2026-09-10T00:00:00Z', student_id: 'e' },
    ];
    const run = latestExamRun(rows, '27AH');
    expect(run.map((r) => r.student_id)).toEqual(['c', 'b']);
    expect(latestExamRun(rows, 'K05')).toEqual([]);
  });
});

function blank(): Assignment {
  return {
    timestamp: '2026-09-01T00:00:00Z',
    date: '2026-09-01',
    class_group: '27AH',
    run_id: 'RUN_0',
    candidate_score: 0,
    student_id: '',
    name: '',
    seat_id: '',
    pod_id: '',
    seat_role: '',
    x: 0,
    y: 0,
  };
}
