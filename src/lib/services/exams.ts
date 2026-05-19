import { createClient } from '@/lib/supabase-server';
import type { Exam } from '@/types/database';

export async function getExams(): Promise<Exam[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('exams')
    .select('*')
    .order('created_at', { ascending: false });
  return data ?? [];
}
