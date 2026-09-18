import { NextRequest, NextResponse } from "next/server";
import { getApiTeacher } from "@/lib/auth";
import { getShowHiddenStudents } from "@/lib/teacher-preferences";
import { loadActivityReportData } from "@/lib/activity-report-data";
import { buildActivityReportCsv } from "@/lib/activity-rubric";
import { assessmentShortName } from "@/lib/assessment-short-name";

/**
 * GET /api/tests/[id]/activity-report/csv
 *
 * The class's learning targets as a spreadsheet: one row per student, the
 * outcome per target. Same roster and same marks as the activity report page
 * (lib/activity-report-data.ts), so what is downloaded is what was on screen.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getApiTeacher();
  if (!auth.ok) return auth.response;
  const { supabase, profile } = auth;
  const { id } = await params;

  const showHidden = await getShowHiddenStudents(supabase, profile.id);
  const loaded = await loadActivityReportData(supabase, id, { showHidden });
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status });

  const { data } = loaded;
  const csv = buildActivityReportCsv(
    data.rubric,
    data.rows.map((r) => ({ name: r.name, className: r.className, report: r.report, absent: r.absent }))
  );
  const short = assessmentShortName({ name: data.test.name, short_name: null }) || "activity";
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${short}_activity_report.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
