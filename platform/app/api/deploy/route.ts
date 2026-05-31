import { NextRequest, NextResponse } from "next/server";
import { requireTeacher } from "@/lib/auth";

const HOOKS: Record<string, string | undefined> = {
  preview: process.env.VERCEL_DEPLOY_HOOK_PREVIEW,
  production: process.env.VERCEL_DEPLOY_HOOK_MAIN,
};

// POST — called from the DeployCard button in the teacher dashboard
export async function POST(request: NextRequest) {
  await requireTeacher();
  const { target = "preview" } = await request.json() as { target?: string };
  const hook = HOOKS[target];
  if (!hook) return NextResponse.json({ error: "Unknown target" }, { status: 400 });

  const res = await fetch(hook, { method: "POST" });
  const data = await res.json();
  return NextResponse.json({ ok: res.ok, ...data });
}

// GET — called by Claude via Vercel MCP fetch tool
// Usage: /api/deploy?target=preview&secret=DEPLOY_SECRET
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");
  const target = searchParams.get("target") ?? "preview";

  if (!secret || secret !== process.env.DEPLOY_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const hook = HOOKS[target];
  if (!hook) return NextResponse.json({ error: "Unknown target" }, { status: 400 });

  const res = await fetch(hook, { method: "POST" });
  const data = await res.json();
  return NextResponse.json({ ok: res.ok, target, ...data });
}
