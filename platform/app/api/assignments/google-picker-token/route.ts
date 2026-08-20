/**
 * GET /api/assignments/google-picker-token
 *
 * Returns the Google access token AND API key for initializing the Google Picker.
 * The Picker requires both:
 *   - OAuth token (user auth, from the stored Drive credential)
 *   - API key / developer key (project auth, from env)
 *
 * Returns: { token: string; apiKey: string } or { error: string }
 */

import { NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { getDriveTokenFromCookie } from "@/lib/google-drive";

export const runtime = "nodejs";

export async function GET() {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;

  const credentials = await getDriveTokenFromCookie();
  if (!credentials?.access_token) {
    return NextResponse.json({ error: "Google Drive not connected" }, { status: 401 });
  }

  const apiKey = process.env.GOOGLE_PICKER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Google Picker API key not configured (GOOGLE_PICKER_API_KEY)" },
      { status: 500 }
    );
  }

  // The Picker SDK's setOAuthToken() (see activity-generator.tsx) expects a
  // bare access-token string. getDriveTokenFromCookie() now returns the full
  // Credentials object (see lib/google-drive.ts) rather than the raw cookie
  // JSON this route used to forward directly — extract just the token.
  return NextResponse.json({ token: credentials.access_token, apiKey });
}
