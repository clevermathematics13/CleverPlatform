import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client for the bulk-upload worker. Bypasses RLS by
 * design (the worker is not a teacher-facing request, there's no session to
 * authenticate) -- same precedent as the one-off scripts/*.mjs maintenance
 * scripts in this repo. Because of that, every query the worker makes must
 * stay explicitly scoped by id/batch_id itself; there is no RLS backstop
 * here the way there is behind every app API route.
 */
export function createWorkerClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set for the bulk-upload worker."
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
