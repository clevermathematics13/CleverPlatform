import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

const ALLOWED_DOMAIN = 'amersol.edu.pe';
const ADMIN_EMAIL = 'clevermathematics@gmail.com';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {
              // Ignore errors from Server Components
            }
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const { data: { user } } = await supabase.auth.getUser();

      if (user?.email) {
        const email = user.email;
        const isSchoolAccount = email.endsWith(`@${ALLOWED_DOMAIN}`);
        const isAdmin = email === ADMIN_EMAIL;

        // Reject accounts that are neither school accounts nor the admin
        if (!isSchoolAccount && !isAdmin) {
          await supabase.auth.signOut();
          return NextResponse.redirect(`${origin}/login?error=domain_not_allowed`);
        }

        // Auto-create or update profile on every login
        const name =
          (user.user_metadata?.full_name as string | undefined) ??
          email.split('@')[0];
        const avatar_url =
          (user.user_metadata?.avatar_url as string | undefined) ?? null;

        const { data: existingProfile } = await supabase
          .from('profiles')
          .select('id')
          .eq('email', email)
          .single();

        if (!existingProfile) {
          // First login — create profile with default role
          await supabase.from('profiles').insert({
            email,
            name,
            role: isAdmin ? 'admin' : 'student',
            avatar_url,
          });
        } else {
          // Returning user — refresh name and avatar only; preserve manually-set role
          await supabase
            .from('profiles')
            .update({ name, avatar_url })
            .eq('email', email);
        }
      }

      const forwardedHost = request.headers.get('x-forwarded-host');
      const isLocalEnv = process.env.NODE_ENV === 'development';
      if (isLocalEnv) {
        return NextResponse.redirect(`${origin}${next}`);
      } else if (forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${next}`);
      } else {
        return NextResponse.redirect(`${origin}${next}`);
      }
    }
  }

  // Auth code exchange failed — redirect to login with error
  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
