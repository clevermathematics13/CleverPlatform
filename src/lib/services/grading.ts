import { createClient } from '@/lib/supabase-server';
import type { Submission } from '@/types/database';

export async function getPendingSubmissions(): Promise<Submission[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('submissions')
    .select('*')
    .eq('confirmed', false)
    .order('submitted_at', { ascending: false })
    .limit(20);
  return data ?? [];
}
