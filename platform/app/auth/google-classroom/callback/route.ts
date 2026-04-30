import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken, saveTokenToCookie } from "@/lib/google-classroom";
import {
  exchangeDriveCodeForToken,
  saveDriveTokenToCookie,
} from "@/lib/google-drive";

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
      // Drive token for clevermathematics@gmail.com (question docs)
      const redirectUri = `${base}/auth/google-classroom/callback`;
      const token = await exchangeDriveCodeForToken(code, redirectUri);
      await saveDriveTokenToCookie(token);
      return NextResponse.redirect(`${base}/dashboard/questions?drive_connected=true`);
    }

    // Classroom token for school account (student rosters)
    const token = await exchangeCodeForToken(code);
    await saveTokenToCookie(token);
    return NextResponse.redirect(`${base}/dashboard/students?gc_connected=true`);
  } catch {
    if (isDrive) {
      return NextResponse.redirect(`${base}/dashboard/questions?drive_error=token_exchange_failed`);
    }
    return NextResponse.redirect(`${base}/dashboard/students?gc_error=token_exchange_failed`);
  }
}
