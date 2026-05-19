import { createClient } from '@/lib/supabase-server';
import type { Student, Grade } from '@/types/database';

export interface GradebookData {
  students: Student[];
  grades: Grade[];
}

export async function getStudentsWithGrades(): Promise<GradebookData> {
  const supabase = await createClient();

  const [studentsResult, gradesResult] = await Promise.all([
    supabase.from('students').select('*').order('name'),
    supabase
      .from('grades')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100),
  ]);

  return {
    students: studentsResult.data ?? [],
    grades: gradesResult.data ?? [],
  };
}
