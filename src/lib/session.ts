import { createClient } from './supabase-server';
import type { UserRole } from '@/types/database';

export interface SessionUser {
  id: string;
  email: string;
  role: UserRole;
}

/**
 * Fetch the current authenticated user and their role from the profiles table.
 * Returns null if the session is missing or invalid.
 * Call this once in a Server Component layout rather than in client useEffect.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('email', user.email)
    .single();

  const role: UserRole = (profile?.role as UserRole) ?? 'student';

  return { id: user.id, email: user.email, role };
}
