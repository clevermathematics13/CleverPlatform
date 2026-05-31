import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireTeacher } from "@/lib/auth";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data } = await supabase.from("teacher_settings").select("show_corrections, show_feedback").eq("teacher_id", user.id).single();
  return NextResponse.json({ show_corrections: data?.show_corrections ?? false, show_feedback: data?.show_feedback ?? false });
}

export async function PATCH(request: NextRequest) {
  await requireTeacher();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json() as { show_corrections?: boolean; show_feedback?: boolean };
  const { data, error } = await supabase.from("teacher_settings").upsert({ teacher_id: user.id, ...body }, { onConflict: "teacher_id" }).select("show_corrections, show_feedback").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}