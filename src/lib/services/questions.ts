import { createClient } from '@/lib/supabase-server';
import type { Question } from '@/types/database';

export interface QuestionFilters {
  level?: string;
  paper?: string;
  limit?: number;
}

export async function getQuestions(
  filters: QuestionFilters = {},
): Promise<{ questions: Question[]; count: number | null }> {
  const supabase = await createClient();

  let query = supabase
    .from('questions')
    .select('*', { count: 'exact' })
    .order('year', { ascending: false });

  if (filters.level) query = query.eq('level', filters.level);
  if (filters.paper) query = query.eq('paper', Number(filters.paper));
  query = query.limit(filters.limit ?? 50);

  const { data, count } = await query;
  return { questions: data ?? [], count };
}
