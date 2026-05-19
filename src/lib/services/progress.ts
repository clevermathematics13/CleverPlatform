import { createClient } from '@/lib/supabase-server';
import type { Grade, StudentResponse } from '@/types/database';
import { redirect } from 'next/navigation';

export interface StudentProgressData {
  grades: Grade[];
  responses: StudentResponse[];
}

export async function getStudentProgress(): Promise<StudentProgressData> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) redirect('/login');

  const [gradesResult, responsesResult] = await Promise.all([
    supabase
      .from('grades')
      .select('*')
      .eq('student_email', user.email)
      .order('created_at', { ascending: false }),
    supabase
      .from('student_responses')
      .select('*')
      .eq('student_email', user.email)
      .order('created_at', { ascending: false }),
  ]);

  return {
    grades: gradesResult.data ?? [],
    responses: responsesResult.data ?? [],
  };
}
