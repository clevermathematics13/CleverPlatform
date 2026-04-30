import { NextResponse } from "next/server";

// Simple liveness endpoint for uptime checks and quick debugging.
export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      service: "platform-new",
      timestamp: new Date().toISOString(),
    },
    { status: 200 }
  );
}
