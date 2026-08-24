import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

// POST /api/na-review/packet-scan/[packetScanId]/reassign
// Body: { studentProfileId }
// Corrects which student a scanned packet belongs to -- the pipeline's
// automatic ID match (cover-page name read, see na-scanning.ts) can
// attach the wrong profile, and until now the review UI could only
// display that name, not fix it. Setting id_status to "confirmed" clears
// the needs-review flag now that a teacher has looked at it directly.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ packetScanId: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { packetScanId } = await params;

  const body = (await request.json()) as { studentProfileId?: string };
  const { studentProfileId } = body;

  if (!studentProfileId) {
    return NextResponse.json({ error: "studentProfileId is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("na_packet_scans")
    .update({ student_profile_id: studentProfileId, id_status: "confirmed" })
    .eq("id", packetScanId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
