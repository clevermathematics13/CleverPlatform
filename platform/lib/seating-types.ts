/**
 * Teacher-set B/G marker used only by assessment seating, which alternates
 * genders along each row. '' means the teacher has not set one; such a student
 * is seated wherever the pattern has slack rather than being forced into a row
 * position they might not fit.
 */
export type Gender = 'B' | 'G' | '';

/**
 * Which kind of seating the generator is producing.
 *
 *   groups     - pods around tables, the historical behaviour
 *   assessment - one student per desk in columns and rows, alternating B/G
 */
export type SeatingMode = 'groups' | 'assessment';

export interface Student {
  student_id: string;
  name: string;
  class_group: string;
  active: boolean;
  notes: string;
  gender: Gender;
}

export interface Seat {
  seat_id: string;
  class_group: string;
  pod_id: string;
  seat_role: string;
  x: number;
  y: number;
  active: boolean;
}

export interface Rule {
  rule_type: 'PAIR' | 'POD' | 'SEAT';
  class_group: string;
  student_a: string;
  student_b: string;
  student_id: string;
  pod_id: string;
  seat_id: string;
  weight: number;
  active: boolean;
  notes: string;
}

export interface RuleFeedback {
  rule: Rule;
  satisfied: boolean;
  detail: string;
}

export interface Assignment {
  timestamp: string;
  date: string;
  class_group: string;
  run_id: string;
  candidate_score: number;
  student_id: string;
  name: string;
  seat_id: string;
  pod_id: string;
  seat_role: string;
  x: number;
  y: number;
}

export interface Setting {
  key: string;
  value: number;
}

export interface SeatingLayout {
  id: string;
  class_group: string;
  name: string;
  seats: Seat[];
  created_at: string;
  updated_at: string;
}
