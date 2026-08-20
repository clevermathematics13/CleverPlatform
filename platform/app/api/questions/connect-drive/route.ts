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
  // Both Drive and Classroom OAuth land on the same shared callback handler
  // (platform/app/auth/google-classroom/callback/route.ts), which branches
  // on state === "google-drive" vs the Classroom default. This route used to
  // point at /auth/google-drive/callback, which has never existed as an
  // actual route — Google would have 404'd after the consent screen instead
  // of returning here.
  const redirectUri = `${base}/auth/google-classroom/callback`;
  const url = getDriveAuthUrl(redirectUri);
  return NextResponse.redirect(url);
}
