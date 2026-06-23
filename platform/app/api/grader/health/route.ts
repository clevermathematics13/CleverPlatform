import { NextResponse } from "next/server";
import { callGraderHealth } from "@/lib/msa-grader";

/**
 * GET /api/grader/health
 *
 * Proxy to the MSA Grader GAS Web App health endpoint.
 * Returns { ok: true, timestamp } or an error object.
 * No authentication required — used by the UI to show grader status.
 */
export async function GET() {
  try {
    const result = await callGraderHealth();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
