import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken, saveTokenToCookie } from "@/lib/google-classroom";

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
    return NextResponse.redirect(`${base}/dashboard/students?gc_error=access_denied`);
  }

  if (!code) {
    return NextResponse.redirect(`${base}/dashboard/students?gc_error=no_code`);
  }

  try {
    const token = await exchangeCodeForToken(code);
    await saveTokenToCookie(token);
    return NextResponse.redirect(`${base}/dashboard/students?gc_connected=true`);
  } catch {
    return NextResponse.redirect(`${base}/dashboard/students?gc_error=token_exchange_failed`);
  }
}
