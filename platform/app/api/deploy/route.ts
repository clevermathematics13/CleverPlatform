import { NextRequest, NextResponse } from "next/server";
import { requireTeacher } from "@/lib/auth";

const HOOKS: Record<string, string | undefined> = {
  preview: process.env.VERCEL_DEPLOY_HOOK_PREVIEW,
  production: process.env.VERCEL_DEPLOY_HOOK_MAIN,
};

export async function POST(request: NextRequest) {
  await requireTeacher();
  const { target = "preview" } = await request.json() as { target?: string };
  const hook = HOOKS[target];
  if (!hook) return NextResponse.json({ error: "Unknown target" }, { status: 400 });

  const res = await fetch(hook, { method: "POST" });
  const data = await res.json();
  return NextResponse.json({ ok: res.ok, ...data });
}
