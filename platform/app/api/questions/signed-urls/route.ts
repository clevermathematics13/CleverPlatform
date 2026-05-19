import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";

// POST /api/questions/signed-urls
// Body: { paths: string[] }
// Returns signed URLs (1h expiry) for the given Supabase Storage paths in the question-images bucket.
export async function POST(request: NextRequest) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, user, profile } = auth;

  const body = await request.json() as { paths: string[] };
  const { paths } = body;

  if (!Array.isArray(paths) || paths.length === 0) {
    return NextResponse.json({ urls: [] });
  }

  const { data, error } = await supabase.storage
    .from("question-images")
    .createSignedUrls(paths, 3600);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const urls = (data ?? []).map((item) => ({
    path: item.path,
    url: item.signedUrl,
  }));

  return NextResponse.json({ urls });
}
