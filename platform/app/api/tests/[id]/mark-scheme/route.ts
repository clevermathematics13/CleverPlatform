/**
 * GET /api/tests/[id]/mark-scheme
 *
 * The address a test releases its student mark scheme at: tests.mark_scheme_url
 * holds exactly this path for a test whose scheme is the platform's own
 * (releasesStudentMarkScheme in lib/student-mark-scheme.ts), and the
 * self-grade form's "Mark Scheme" button opens it -- in its side panel
 * (components/reflection/DocPanel.tsx) or a new tab.
 *
 * The page itself lives at /mark-scheme/[id] (app/mark-scheme/[id]/page.tsx),
 * where each part's "Explain more" steps can be interactive. This route used
 * to write that page as a string of HTML; it now sends the browser there,
 * and the page applies every gate this route used to: the scheme released
 * (not hidden, and mark_scheme_url the platform's page), and the viewer's own
 * class past its sitting (lib/student-mark-scheme-access.ts). Kept, rather
 * than rewriting the stored URLs, because the release test compares
 * mark_scheme_url with this exact path.
 *
 * It deliberately never hands out the archived teacher PDF
 * (tests.mark_scheme_pdf_storage_path): that document is teacher-only by
 * storage RLS policy, and stays that way -- see the comment on that column
 * and the incident fixed by migration
 * 20260911142419_restrict_student_markscheme_images.sql.
 */

import { NextResponse } from "next/server";
import { studentMarkSchemePagePath } from "@/lib/student-mark-scheme";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: testId } = await params;
  if (!UUID.test(testId)) return NextResponse.json({ error: "Test not found" }, { status: 404 });
  return NextResponse.redirect(new URL(studentMarkSchemePagePath(testId), req.url), 307);
}
