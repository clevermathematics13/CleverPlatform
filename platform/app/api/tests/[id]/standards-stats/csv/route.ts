import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { getShowHiddenStudents } from "@/lib/teacher-preferences";
import { loadStandardsStatsData } from "@/lib/standards-stats-data";
import { buildStandardsStatsCsv } from "@/lib/standards-stats";
import { assessmentShortName } from "@/lib/assessment-short-name";

/**
 * GET /api/tests/[id]/standards-stats/csv?scope=<all|courseId>
 *
 * The class statistics as a spreadsheet: a question table, a part table and
 * a strand table in one file. Same loader as the stats page
 * (lib/standards-stats-data.ts) and the same scope, so what is downloaded is
 * what was on screen.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, profile } = auth;
  const { id } = await params;

  const showHidden = await getShowHiddenStudents(supabase, profile.id);
  const loaded = await loadStandardsStatsData(supabase, id, {
    showHidden,
    scope: request.nextUrl.searchParams.get("scope"),
  });
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status });

  const { data } = loaded;
  const csv = buildStandardsStatsCsv(data.stats, {
    testName: data.test.name,
    scopeLabel: data.scope.label,
  });
  const short = assessmentShortName({ name: data.test.name, short_name: null }) || "assessment";
  // The scope is in the filename so two downloads of the same paper do not
  // land on top of each other in a Downloads folder.
  const scopeSlug = data.scope.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${short}_stats_${scopeSlug}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
