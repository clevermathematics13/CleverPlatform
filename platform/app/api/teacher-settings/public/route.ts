import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data } = await supabase.from("teacher_settings").select("show_corrections, show_feedback").limit(1).single();
  return NextResponse.json({ show_corrections: data?.show_corrections ?? false, show_feedback: data?.show_feedback ?? false });
}