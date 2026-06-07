/**
 * GET /api/assignments/google-picker-token
 *
 * Returns the Google access token AND API key for initializing the Google Picker.
 * The Picker requires both:
 *   - OAuth token (user auth, from Drive cookie)
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

  const token = await getDriveTokenFromCookie();
  if (!token) {
    return NextResponse.json({ error: "Google Drive not connected" }, { status: 401 });
  }

  const apiKey = process.env.GOOGLE_PICKER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Google Picker API key not configured (GOOGLE_PICKER_API_KEY)" },
      { status: 500 }
    );
  }

  return NextResponse.json({ token, apiKey });
}
