import { createClient } from '@/lib/supabase-server';
import type { Topic } from '@/types/database';

export async function getTopics(): Promise<Topic[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('topics')
    .select('*')
    .order('order_index');
  return data ?? [];
}
