import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Request header carrying the per-tab "view as" target from the URL.
 *
 *  Per-tab impersonation can only be driven by the URL. A cookie is shared
 *  by every tab on the origin (which is exactly what the old
 *  impersonate-role cookie got wrong), and sessionStorage -- the one
 *  genuinely per-tab store -- is invisible to server rendering. The query
 *  param is
 *  the only piece of per-tab state that reaches the server on a plain
 *  navigation.
 *
 *  It is forwarded as a request header because a Next App Router LAYOUT
 *  cannot read searchParams (only pages can), and the sidebar that renders
 *  the impersonation banner lives in the dashboard layout. Middleware sees
 *  the full URL, so it copies the param onto the request for every server
 *  component to read via headers().
 *
 *  This is an UNVALIDATED passthrough of a user-supplied value. Nothing may
 *  trust it: lib/view-as.ts re-checks that the caller is really a teacher
 *  and that the target is really one of their roster students before it
 *  means anything. */
export const VIEW_AS_HEADER = "x-view-as";

export async function updateSession(request: NextRequest) {
  // Strip any inbound x-view-as before setting our own, so the header can
  // only ever originate from this middleware reading the URL -- never from
  // a client that simply sent the header itself.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(VIEW_AS_HEADER);
  const viewAsParam = request.nextUrl.searchParams.get("viewAs");
  if (viewAsParam) requestHeaders.set(VIEW_AS_HEADER, viewAsParam);

  let supabaseResponse = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // The OAuth callback must reach its route handler with cookies untouched.
  //
  // Attempting session recovery here is actively destructive on this exact
  // request: getUser() finds whatever stale sb-<ref>-auth-token cookie is
  // lying around, fails to refresh it, and auth-js responds by calling
  // _removeSession() -- which deletes the session cookie AND
  // `<storageKey>-code-verifier`, the PKCE verifier the callback is about to
  // need. setAll then writes that deletion onto `request` itself, so the
  // handler sees an empty verifier and exchangeCodeForSession fails with
  // "PKCE code verifier not found in storage" -> auth_callback_failed.
  //
  // That produced a reliable "sign in twice, every time" for the teacher:
  // attempt 1 purged the stale token as a side effect, so attempt 2 found no
  // session to recover, never called _removeSession, and succeeded. Two
  // earlier fixes missed it by looking for a race -- the tell was a single
  // /auth/callback request in the logs with no duplicate. There was never a
  // second request; the request killed its own verifier.
  //
  // There is nothing to refresh here by definition: the session this request
  // establishes does not exist yet.
  if (request.nextUrl.pathname.startsWith("/auth/callback")) {
    return supabaseResponse;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request: { headers: requestHeaders },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh the session - important for Server Components
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Define public routes that don't require authentication
  const publicRoutes = ["/login", "/register", "/auth/callback"];
  const isPublicRoute = publicRoutes.some((route) =>
    request.nextUrl.pathname.startsWith(route)
  );

  // API routes handle their own auth — don't redirect them to /login
  const isApiRoute = request.nextUrl.pathname.startsWith("/api/");

  // Some providers can return ?code=... on the current route.
  // Normalize those requests to /auth/callback so the code gets exchanged.
  // Only applies outside of /auth/* routes — those are OAuth flow routes
  // that handle their own codes (/auth/google-classroom/callback etc.).
  const hasOAuthCode = request.nextUrl.searchParams.has("code");
  const isAnyAuthRoute = request.nextUrl.pathname.startsWith("/auth/");
  if (hasOAuthCode && !isAnyAuthRoute) {
    const callbackUrl = request.nextUrl.clone();
    callbackUrl.pathname = "/auth/callback";

    if (!callbackUrl.searchParams.has("next")) {
      const nextUrl = request.nextUrl.clone();
      nextUrl.searchParams.delete("code");
      callbackUrl.searchParams.set(
        "next",
        `${nextUrl.pathname}${nextUrl.search ? nextUrl.search : ""}`
      );
    }

    return NextResponse.redirect(callbackUrl);
  }

  // Routes where authenticated users should NOT be redirected away
  const authFlowRoutes = ["/auth/google-classroom", "/auth/google-drive", "/register/nickname"];
  const isAuthFlowRoute = authFlowRoutes.some((route) =>
    request.nextUrl.pathname.startsWith(route)
  );

  // Helper: copy Supabase session cookies onto any redirect response so
  // token refreshes are never silently dropped mid-flow (prevents redirect loops).
  //
  // The whole cookie is copied, options included. Copying only name and value
  // used to strip `maxAge`, and @supabase/ssr expresses a DELETION as
  // `{ value: "", maxAge: 0 }` -- so a cookie Supabase asked to delete was
  // instead re-set as an empty session cookie that outlived the redirect.
  // Stale auth cookies surviving a sign-out is what feeds the callback bug
  // documented at the top of this file.
  const withCookies = (response: ReturnType<typeof NextResponse.redirect>) => {
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      const { name, value, ...options } = cookie;
      response.cookies.set(name, value, options);
    });
    return response;
  };

  // Redirect unauthenticated users to login (skip for API routes — they return 401)
  if (!user && !isPublicRoute && !isApiRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirectTo", request.nextUrl.pathname);
    return withCookies(NextResponse.redirect(url));
  }

  // Redirect authenticated users away from login/register
  if (user && isPublicRoute && !isAuthFlowRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return withCookies(NextResponse.redirect(url));
  }

  return supabaseResponse;
}
