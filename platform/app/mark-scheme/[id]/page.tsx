import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { studentMarkSchemeAccess } from "@/lib/student-mark-scheme-access";
import { studentMarkSchemeRows, type StudentMarkSchemeItem } from "@/lib/student-mark-scheme";
import { explanationReader, loadStoredExplanations } from "@/lib/mark-scheme-explanation-store";
import { MarkSchemePart } from "@/components/reflection/MarkSchemePart";
import { OfficeHoursLink } from "@/components/reflection/OfficeHoursLink";

export const metadata: Metadata = { title: "Mark scheme" };

/**
 * A test's whole student mark scheme on one page: every part's card
 * (components/reflection/MarkSchemePart), in the self-grade form's order and
 * under its labels.
 *
 * Reached from the self-grade form's "Mark Scheme" button, which opens
 * tests.mark_scheme_url -- /api/tests/[id]/mark-scheme, redirecting here --
 * in the form's side panel (components/reflection/DocPanel.tsx) or a new
 * tab. It is a page rather than the HTML the API route used to write
 * because each card's "Explain more" steps are interactive, and this way
 * every place a student reads a mark scheme is the same component.
 * Outside /dashboard on purpose: it is shown inside that panel, where the
 * dashboard's navigation would be a second frame around the first.
 *
 * Gated by studentMarkSchemeAccess: released, and past the viewer's own
 * class sitting. The test and its items are read in the viewer's session
 * (RLS confines a student to their track family); the written explanations
 * with the service role, after that gate, since students have no policy on
 * that table.
 */
export default async function StudentMarkSchemePage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await getProfile();
  const { id } = await params;
  const supabase = await createClient();

  const { data: test } = await supabase
    .from("tests")
    .select("id, name, test_date, exam_time, release_at, hidden, mark_scheme_url, custom_content")
    .eq("id", id)
    .maybeSingle();
  if (!test) notFound();

  const access = await studentMarkSchemeAccess(supabase, profile, test);
  if (!access.ok) {
    return (
      <Shell>
        <div className="rounded-xl border border-da-border bg-da-surface p-5">
          <h1 className="text-xl font-bold text-da-text">Mark scheme</h1>
          <p className="mt-2 text-base text-da-text">{access.message}</p>
        </div>
      </Shell>
    );
  }

  const [{ data: items }, stored] = await Promise.all([
    supabase
      .from("test_items")
      .select("id, question_number, part_label, max_marks, sort_order, stem_text, question_text, markscheme_text")
      .eq("test_id", test.id)
      .order("sort_order", { ascending: true }),
    loadStoredExplanations(explanationReader(supabase), test.id),
  ]);
  const rows = studentMarkSchemeRows(test.custom_content, (items ?? []) as StudentMarkSchemeItem[], stored);
  const draft = test.custom_content as { title?: string; subtitle?: string } | null;
  const title = draft?.title?.trim() || (test.name as string | null) || "Assessment";
  const subtitle = draft?.subtitle?.trim() || null;

  return (
    <Shell>
      <header className="space-y-1">
        <p className="text-sm font-semibold text-da-muted">Mark scheme</p>
        <h1 className="text-2xl font-bold leading-tight text-da-text">{title}</h1>
        {subtitle && <p className="text-base text-da-muted">{subtitle}</p>}
      </header>

      <section aria-label="How to use this mark scheme" className="rounded-xl border border-da-border bg-da-surface p-4">
        <h2 className="text-base font-bold text-da-text">How to use it</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-base leading-relaxed marker:font-bold marker:text-da-amber">
          <li>
            Find the question and read the <strong>answer</strong>.
          </li>
          <li>
            Read <strong>how the marks work</strong>, and count the marks you earned.
          </li>
          <li>
            Not sure why? Press <strong>Explain more</strong> and go one step at a time.
          </li>
        </ol>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <OfficeHoursLink />
          <span className="text-sm text-da-muted">Still stuck? Your teacher can go through it with you.</span>
        </div>
      </section>

      {rows.length === 0 ? (
        <p className="text-base text-da-muted">No mark scheme has been written for this test yet.</p>
      ) : (
        <ol className="space-y-6">
          {rows.map((row) => (
            <li key={row.itemId} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3 border-b border-da-border/60 pb-1">
                <h2 className="text-lg font-bold text-da-amber">{row.label}</h2>
                <span className="text-sm text-da-muted">
                  {row.maxMarks} {row.maxMarks === 1 ? "mark" : "marks"}
                </span>
              </div>
              {row.scheme ? (
                <MarkSchemePart scheme={row.scheme} wide />
              ) : (
                <p className="text-sm text-da-muted">No mark scheme was written for this part.</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 text-da-text sm:px-6">{children}</main>;
}
