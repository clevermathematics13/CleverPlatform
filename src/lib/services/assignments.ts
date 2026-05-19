import { createClient } from '@/lib/supabase-server';
import type { Assignment } from '@/types/database';

export async function getAssignments(): Promise<Assignment[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('assignments')
    .select('*')
    .order('created_at', { ascending: false });
  return data ?? [];
}
