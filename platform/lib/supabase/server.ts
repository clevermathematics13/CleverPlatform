import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * @param options.persistent - When false, auth cookies are set as session
 *   cookies (no maxAge/expires) so they expire when the browser closes.
 *   Defaults to true (persistent cookies with Supabase's default lifetime).
 */
export async function createClient(options?: { persistent?: boolean }) {
  const cookieStore = await cookies();
  const persistent = options?.persistent ?? true;

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options: cookieOptions }) => {
              // A DELETION must stay a deletion. @supabase/ssr expresses one as
              // `{ value: "", maxAge: 0 }`, so blanket-stripping maxAge for
              // non-persistent sessions quietly turned every cookie Supabase
              // asked to clear into an empty session cookie that stuck around
              // instead. Those stale auth cookies are what make the next
              // sign-in's callback fail (see lib/supabase/middleware.ts).
              const isDeletion = cookieOptions?.maxAge === 0 || value === "";
              const finalOptions =
                persistent || isDeletion
                  ? cookieOptions
                  : { ...cookieOptions, maxAge: undefined, expires: undefined };
              cookieStore.set(name, value, finalOptions);
            });
          } catch {
            // The `setAll` method is called from a Server Component
            // where cookies can't be set. This is safe to ignore if
            // you have middleware refreshing user sessions.
          }
        },
      },
    }
  );
}
