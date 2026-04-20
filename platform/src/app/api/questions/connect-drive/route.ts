import { NextRequest, NextResponse } from "next/server";
import { getDriveAuthUrl } from "@/lib/google-drive";

function getBaseUrl(request: NextRequest): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") || "https";
  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  return request.nextUrl.origin;
}

export async function GET(request: NextRequest) {
  const base = getBaseUrl(request);
  const redirectUri = `${base}/auth/google-drive/callback`;
  const url = getDriveAuthUrl(redirectUri);
  return NextResponse.redirect(url);
}
