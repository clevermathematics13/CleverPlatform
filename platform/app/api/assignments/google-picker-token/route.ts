/**
 * GET /api/assignments/google-picker-token
 *
 * Returns the Google access token for initializing the Google Picker.
 * Only returns token if user is authenticated and has Drive connected.
 *
 * Returns: { token: string } or { error: string }
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

  return NextResponse.json({ token });
}
