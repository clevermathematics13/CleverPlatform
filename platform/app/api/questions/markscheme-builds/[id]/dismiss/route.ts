import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

// POST /api/questions/markscheme-builds/[id]/dismiss
// A teacher sets a flagged build aside: nothing is written to the question,
// and the build script will not try the question again (it skips any
// question with a dismissed build).
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;
  const { id } = await params;

  const { data, error } = await supabase
    .from("markscheme_builds")
    .update({ status: "dismissed", decided_at: new Date().toISOString(), decided_by: user.id })
    .eq("id", id)
    .eq("status", "flagged")
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "This build is no longer waiting for review." }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
