/**
 * GET /api/source-materials/[id]/file — download an uploaded source file
 *
 * Same shape as the archived-assessment download: the bucket is private, so a
 * short-lived signed URL is minted on demand and redirected to, rather than a
 * storage URL being stored anywhere that could outlive it.
 */

import { NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

export const runtime = "nodejs";

const BUCKET = "exam-scans";
const SIGNED_URL_TTL_SECONDS = 60 * 60;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { id } = await params;

  const { data: row, error } = await supabase
    .from("source_materials")
    .select("storage_path, title")
    .eq("id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: signed, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS);

  if (signError || !signed) {
    return NextResponse.json(
      { error: signError?.message ?? "Could not sign a download link." },
      { status: 500 },
    );
  }

  return NextResponse.redirect(signed.signedUrl, 302);
}
