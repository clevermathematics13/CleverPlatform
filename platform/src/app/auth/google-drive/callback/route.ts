import { NextRequest, NextResponse } from "next/server";
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
  const base = getBaseUrl(request);

  if (error) {
    return NextResponse.redirect(
      `${base}/dashboard/questions?drive_error=access_denied`
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${base}/dashboard/questions?drive_error=no_code`
    );
  }

  try {
    const redirectUri = `${base}/auth/google-drive/callback`;
    const token = await exchangeDriveCodeForToken(code, redirectUri);
    await saveDriveTokenToCookie(token);
    return NextResponse.redirect(
      `${base}/dashboard/questions?drive_connected=true`
    );
  } catch {
    return NextResponse.redirect(
      `${base}/dashboard/questions?drive_error=token_exchange_failed`
    );
  }
}
