import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken, saveToken } from "@/lib/google-classroom";
import {
  exchangeDriveCodeForToken,
  saveDriveToken,
} from "@/lib/google-drive";

// Google OAuth callback, shared by both providers (branches on `state`).
// Both Classroom and Drive tokens are persisted server-side in
// public.google_oauth_tokens (provider = "google-classroom" / "google-drive"
// respectively) so each connection survives cookie clears, device changes,
// and works from background jobs — not just the connecting browser session.
// saveDriveToken writes through to that same DB-backed store.

function getBaseUrl(request: NextRequest): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") || "https";
  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  return request.nextUrl.origin;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");
  const state = request.nextUrl.searchParams.get("state");
  const base = getBaseUrl(request);

  const isDrive = state === "google-drive";

  if (error) {
    if (isDrive) {
      return NextResponse.redirect(`${base}/dashboard/questions?drive_error=access_denied`);
    }
    return NextResponse.redirect(`${base}/dashboard/students?gc_error=access_denied`);
  }

  if (!code) {
    if (isDrive) {
      return NextResponse.redirect(`${base}/dashboard/questions?drive_error=no_code`);
    }
    return NextResponse.redirect(`${base}/dashboard/students?gc_error=no_code`);
  }

  try {
    if (isDrive) {
      // Drive token for clevermathematics@gmail.com (question docs).
      // Persisted server-side, same as Classroom below.
      const redirectUri = `${base}/auth/google-classroom/callback`;
      const token = await exchangeDriveCodeForToken(code, redirectUri);
      await saveDriveToken(token);
      return NextResponse.redirect(`${base}/dashboard/questions?drive_connected=true`);
    }

    // Classroom token for school account (student rosters).
    // Persisted server-side so the connection survives cookie clears,
    // device changes and background jobs.
    const redirectUri = `${base}/auth/google-classroom/callback`;
    const token = await exchangeCodeForToken(code, redirectUri);
    await saveToken(token);
    return NextResponse.redirect(`${base}/dashboard/students?gc_connected=true`);
  } catch (err) {
    console.error("[google-classroom callback]", err);
    if (isDrive) {
      return NextResponse.redirect(`${base}/dashboard/questions?drive_error=token_exchange_failed`);
    }
    return NextResponse.redirect(`${base}/dashboard/students?gc_error=token_exchange_failed`);
  }
}
