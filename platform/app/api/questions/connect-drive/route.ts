import { NextRequest, NextResponse } from "next/server";
import { getDriveAuthUrl } from "@/lib/google-drive";
import { requireTeacher } from "@/lib/auth";

function getBaseUrl(request: NextRequest): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") || "https";
  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  return request.nextUrl.origin;
}

export async function GET(request: NextRequest) {
  // SECURITY: only a teacher may initiate the Drive OAuth consent flow.
  await requireTeacher();

  const base = getBaseUrl(request);
  const redirectUri = `${base}/auth/google-drive/callback`;
  const url = getDriveAuthUrl(redirectUri);
  return NextResponse.redirect(url);
}
