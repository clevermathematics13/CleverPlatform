/**
 * GET /api/assignments/drive-status
 *
 * Lightweight endpoint: returns whether Google Drive is connected for the
 * current session. Used by the Activity Generator panel on mount to decide
 * whether to show the Connect button or the connected badge.
 *
 * Returns: { connected: boolean }
 */

import { NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { getDriveTokenFromCookie } from "@/lib/google-drive";

export const runtime = "nodejs";

export async function GET() {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;

  const token = await getDriveTokenFromCookie();
  return NextResponse.json({ connected: token !== null });
}
