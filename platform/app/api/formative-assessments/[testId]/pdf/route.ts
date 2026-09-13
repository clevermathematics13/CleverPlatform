/**
 * GET /api/formative-assessments/[testId]/pdf?kind=paper|mark-scheme
 *
 * Hand a teacher one of a Formative Assessment's archived PDFs.
 *
 * The files live in the private `exam-scans` bucket, so what is handed out is
 * a short-lived signed URL rather than a stored link -- see the migration
 * comment on tests.paper_pdf_storage_path for why these are not
 * tests.paper_url / tests.mark_scheme_url.
 *
 * Teacher-only, deliberately, and not just because the route requires it:
 * `kind=mark-scheme` serves the full answers and M/A/R codes.
 */

import { NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { SCAN_BUCKET } from "@/lib/ai-grading";
import { assessmentPdfFilename } from "@/lib/formative-assessment-pdf-body";

export const runtime = "nodejs";

const SIGNED_URL_TTL_SECONDS = 3600;

export async function GET(req: Request, { params }: { params: Promise<{ testId: string }> }) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;
  const { testId } = await params;

  const kindParam = new URL(req.url).searchParams.get("kind") ?? "paper";
  if (kindParam !== "paper" && kindParam !== "mark-scheme") {
    return NextResponse.json({ error: "kind must be 'paper' or 'mark-scheme'" }, { status: 400 });
  }
  const kind: "paper" | "mark-scheme" = kindParam;

  const { data: test, error } = await supabase
    .from("tests")
    .select("id, name, paper_pdf_storage_path, mark_scheme_pdf_storage_path")
    .eq("id", testId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!test) return NextResponse.json({ error: "Test not found" }, { status: 404 });

  const storagePath =
    kind === "paper" ? test.paper_pdf_storage_path : test.mark_scheme_pdf_storage_path;
  if (!storagePath) {
    // Distinguished from a 404 on the test itself: this one is fixed by
    // re-saving the assessment, which regenerates both PDFs.
    return NextResponse.json(
      {
        error:
          `No archived ${kind === "paper" ? "student paper" : "mark scheme"} for this test. ` +
          "Open it in the Formative Assessment creator and save it again to generate one.",
      },
      { status: 404 },
    );
  }

  const { data: signed, error: signError } = await supabase.storage
    .from(SCAN_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS, {
      download: assessmentPdfFilename(test.name ?? "assessment", kind),
    });
  if (signError || !signed?.signedUrl) {
    return NextResponse.json(
      { error: signError?.message ?? "Could not sign the archived PDF" },
      { status: 500 },
    );
  }

  return NextResponse.redirect(signed.signedUrl, 302);
}
