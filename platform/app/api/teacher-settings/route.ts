import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireTeacher } from "@/lib/auth";

/** The columns this route is allowed to touch. PATCH used to spread the whole
 *  request body into the upsert, so any column name a caller invented went
 *  straight through to teacher_settings. Only the teacher's own row was ever
 *  reachable, but "whatever you send" is not a shape worth keeping. */
const FIELDS = "show_corrections, show_feedback, show_hidden_students, powerschool_drive_folder_id";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data } = await supabase.from("teacher_settings").select(FIELDS).eq("teacher_id", user.id).single();
  const row = data as {
    show_corrections?: boolean;
    show_feedback?: boolean;
    show_hidden_students?: boolean;
    powerschool_drive_folder_id?: string | null;
  } | null;
  return NextResponse.json({
    show_corrections: row?.show_corrections ?? false,
    show_feedback: row?.show_feedback ?? false,
    show_hidden_students: row?.show_hidden_students ?? false,
    powerschool_drive_folder_id: row?.powerschool_drive_folder_id ?? null,
  });
}

export async function PATCH(request: NextRequest) {
  await requireTeacher();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json() as {
    show_corrections?: boolean;
    show_feedback?: boolean;
    show_hidden_students?: boolean;
    powerschool_drive_folder_id?: string | null;
  };

  const updates: Record<string, unknown> = {};
  if (body.show_corrections !== undefined) updates.show_corrections = body.show_corrections;
  if (body.show_feedback !== undefined) updates.show_feedback = body.show_feedback;
  if (body.show_hidden_students !== undefined) updates.show_hidden_students = body.show_hidden_students;
  if (body.powerschool_drive_folder_id !== undefined) {
    // A Drive folder id, or a pasted folder URL to take it out of. Emptying
    // the field turns the mirror off rather than storing "".
    const raw = (body.powerschool_drive_folder_id ?? "").trim();
    const fromUrl = /\/folders\/([A-Za-z0-9_-]+)/.exec(raw)?.[1];
    updates.powerschool_drive_folder_id = raw === "" ? null : (fromUrl ?? raw);
  }

  const { data, error } = await supabase
    .from("teacher_settings")
    .upsert({ teacher_id: user.id, ...updates }, { onConflict: "teacher_id" })
    .select(FIELDS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
