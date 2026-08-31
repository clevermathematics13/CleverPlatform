/**
 * Seating chart data layer – backed by Supabase.
 * All functions are client-safe (browser Supabase client).
 */

import { createClient } from '@/lib/supabase/client';
import type { Student, Seat, Rule, Assignment, Setting, SeatingLayout } from '@/lib/seating-types';

// --- Reads --------------------------------------------------------------------

/**
 * Students for the seating generator, derived live from the real roster
 * (courses / students / invited_students) rather than the frozen
 * `seating_students` snapshot table, which was seeded once and never
 * updated when a class gets archived — so archived classes' students used
 * to keep showing up here forever. class_group is the course name; a
 * student is included only if their course is not archived.
 */
export async function getStudents(): Promise<Student[]> {
  const supabase = createClient();

  const { data: courses, error: coursesError } = await supabase
    .from('courses')
    .select('id, name')
    .eq('archived', false);
  if (coursesError) throw new Error(coursesError.message);

  const classGroupByCourse = new Map((courses ?? []).map((c) => [c.id as string, c.name as string]));
  const courseIds = [...classGroupByCourse.keys()];
  if (courseIds.length === 0) return [];

  const [{ data: enrolled, error: enrolledError }, { data: invited, error: invitedError }] = await Promise.all([
    supabase
      .from('students')
      .select('course_id, hidden, profiles:profile_id ( email, display_name, nickname )')
      .in('course_id', courseIds),
    supabase
      .from('invited_students')
      .select('course_id, email, full_name, nickname, hidden')
      .in('course_id', courseIds)
      .is('profile_id', null),
  ]);
  if (enrolledError) throw new Error(enrolledError.message);
  if (invitedError) throw new Error(invitedError.message);

  const seen = new Set<string>();
  const students: Student[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (enrolled ?? []) as any[]) {
    const profile = row.profiles as { email: string; display_name: string; nickname: string | null } | null;
    const studentId = profile?.email;
    const classGroup = classGroupByCourse.get(row.course_id);
    if (!studentId || !classGroup || seen.has(studentId)) continue;
    seen.add(studentId);
    students.push({
      student_id: studentId,
      name: profile?.nickname || profile?.display_name || studentId,
      class_group: classGroup,
      active: !row.hidden,
      notes: '',
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (invited ?? []) as any[]) {
    const classGroup = classGroupByCourse.get(row.course_id);
    if (!row.email || !classGroup || seen.has(row.email)) continue;
    seen.add(row.email);
    students.push({
      student_id: row.email,
      name: row.nickname || row.full_name || row.email,
      class_group: classGroup,
      active: !row.hidden,
      notes: '',
    });
  }

  return students.sort(
    (a, b) => a.class_group.localeCompare(b.class_group) || a.name.localeCompare(b.name),
  );
}

export async function getSeats(): Promise<Seat[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('seating_seats')
    .select('*')
    .eq('active', true)
    .order('pod_id')
    .order('seat_id');
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getRules(): Promise<Rule[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('seating_rules')
    .select('*')
    .eq('active', true)
    .order('created_at');
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getAssignments(): Promise<Assignment[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('seating_assignments')
    .select('*')
    .order('timestamp', { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getCurrentSeating(): Promise<Assignment[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('seating_current')
    .select('*')
    .order('class_group')
    .order('student_id');
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getSettings(): Promise<Setting[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('seating_settings')
    .select('key, value');
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Returns sorted unique class groups, i.e. non-archived course names. */
export async function getClassGroups(): Promise<string[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('courses')
    .select('name')
    .eq('archived', false);
  if (error) throw new Error(error.message);
  const groups = [...new Set((data ?? []).map((r) => r.name as string))];
  return groups.sort();
}

// --- Writes -------------------------------------------------------------------

/**
 * Replace all rules in the given class group (or global '*') with the
 * supplied set. Soft-deletes are handled by the active flag on data returned
 * from the engine; we delete the group's rows and re-insert.
 */
export async function saveRules(rules: Rule[]): Promise<void> {
  const supabase = createClient();

  const groups = [...new Set(rules.map((r) => r.class_group))];

  // 1. Fetch IDs of rows we'll replace — BEFORE touching anything
  const oldIds: string[] = [];
  if (groups.length > 0) {
    const { data: existing, error: fetchErr } = await supabase
      .from('seating_rules')
      .select('id')
      .in('class_group', groups);
    if (fetchErr) throw new Error(fetchErr.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (existing ?? []).forEach((r: any) => { if (r.id) oldIds.push(r.id); });
  }

  // 2. Insert new rows first — if this fails, nothing has been deleted yet
  if (rules.length > 0) {
    const { error: insError } = await supabase
      .from('seating_rules')
      .insert(
        rules.map((r) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { id: _id, created_at: _ca, ...rest } = r as any;
          return rest;
        }),
      );
    if (insError) throw new Error(insError.message);
  }

  // 3. Delete the old rows by ID — safe because new rows are already in DB
  if (oldIds.length > 0) {
    const { error: delError } = await supabase
      .from('seating_rules')
      .delete()
      .in('id', oldIds);
    if (delError) throw new Error(delError.message);
  }
}

/**
 * Upsert the current seating for the entire run.
 * The unique constraint is (class_group, student_id).
 */
export async function saveCurrentSeating(assignments: Assignment[]): Promise<void> {
  if (assignments.length === 0) return;
  const supabase = createClient();
  // seating_current has no `timestamp` column — strip it before upsert
  const rows = assignments.map(({ timestamp: _ts, ...rest }) => rest);
  const { error } = await supabase
    .from('seating_current')
    .upsert(rows, { onConflict: 'class_group,student_id' });
  if (error) throw new Error(error.message);
}

/** Copy the seat layout from one class group into another (replaces destination). */
export async function copyLayoutFrom(sourceGroup: string, destGroup: string): Promise<void> {
  const supabase = createClient();
  const { data: sourceSeats, error: fetchError } = await supabase
    .from('seating_seats')
    .select('*')
    .eq('class_group', sourceGroup)
    .eq('active', true);
  if (fetchError) throw new Error(fetchError.message);
  if (!sourceSeats || sourceSeats.length === 0)
    throw new Error(`No seats found for class group "${sourceGroup}"`);

  const newSeats: Seat[] = sourceSeats.map((s: Seat) => ({
    ...s,
    seat_id: `${destGroup}-${s.pod_id}-${s.seat_role}`,
    class_group: destGroup,
  }));

  await saveSeatLayout(newSeats, destGroup);
}

/** Replace the entire seat layout for a class group. */
export async function saveSeatLayout(seats: Seat[], classGroup: string): Promise<void> {
  const supabase = createClient();
  const { error: delError } = await supabase
    .from('seating_seats')
    .delete()
    .eq('class_group', classGroup);
  if (delError) throw new Error(delError.message);
  if (seats.length === 0) return;
  const { error: insError } = await supabase
    .from('seating_seats')
    .insert(seats);
  if (insError) throw new Error(insError.message);
}

export async function appendAssignments(assignments: Assignment[]): Promise<void> {
  if (assignments.length === 0) return;
  const supabase = createClient();
  const { error } = await supabase
    .from('seating_assignments')
    .insert(assignments);
  if (error) throw new Error(error.message);
}

// --- Named seating chart layouts ----------------------------------------------

export async function listSeatingLayouts(classGroup: string): Promise<SeatingLayout[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('seating_layouts')
    .select('*')
    .eq('class_group', classGroup)
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function saveSeatingLayout(classGroup: string, name: string, seats: Seat[]): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from('seating_layouts')
    .upsert({ class_group: classGroup, name, seats }, { onConflict: 'class_group,name' });
  if (error) throw new Error(error.message);
}

export async function loadSeatingLayout(layoutId: string): Promise<SeatingLayout | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('seating_layouts')
    .select('*')
    .eq('id', layoutId)
    .single();
  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function deleteSeatingLayout(layoutId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from('seating_layouts')
    .delete()
    .eq('id', layoutId);
  if (error) throw new Error(error.message);
}
