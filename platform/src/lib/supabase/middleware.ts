import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

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
            request,
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

  // Redirect unauthenticated users to login (skip for API routes — they return 401)
  if (!user && !isPublicRoute && !isApiRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirectTo", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from login/register
  if (user && isPublicRoute && !isAuthFlowRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
