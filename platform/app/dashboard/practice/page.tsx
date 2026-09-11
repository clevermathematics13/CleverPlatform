import Link from "next/link";
import { getProfile, requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { resolveViewAs } from "@/lib/view-as";
import {
  getReleasedPracticeSets,
  getStudentCourseIds,
  loadPracticeSetView,
  type PracticeSetSummary,
} from "@/lib/practice-set-service";
import LatexRenderer from "@/components/LatexRenderer";
import { calculatorAllowed, type PracticeItem, type PracticeSetView } from "@/lib/practice-sets";

export const metadata = { title: "Practice" };

/**
 * The student's practice page.
 *
 * Questions only. There is no mark scheme on this page and no route to one --
 * see the header of lib/practice-set-service.ts for what would have to change
 * before there is, and in what order.
 *
 * Teachers reach the same page two ways: ?viewAs=<invitedStudentId> gives the
 * class's exact view (the sidebar picker's mechanism, same as every other
 * student page), and visiting it plainly lists every released set across all
 * courses so a set can be checked without picking a student first.
 */
export default async function PracticePage({
  searchParams,
}: {
  searchParams: Promise<{ set?: string; viewAs?: string }>;
}) {
  await requireRole("student", "teacher");
  const profile = await getProfile();
  const params = await searchParams;
  const viewAs = await resolveViewAs(params.viewAs);
  const isTeacherView = profile.role === "teacher";

  let courseIds: string[];
  if (viewAs) {
    courseIds = viewAs.courseId ? [viewAs.courseId] : [];
  } else if (isTeacherView) {
    const supabase = await createClient();
    const { data } = await supabase.from("courses").select("id").eq("archived", false);
    courseIds = (data ?? []).map((row) => row.id as string);
  } else {
    courseIds = await getStudentCourseIds(profile.id, profile.email);
  }

  const sets = await getReleasedPracticeSets(courseIds);
  const selectedId = params.set && sets.some((s) => s.id === params.set) ? params.set : sets[0]?.id;

  // The teacher's own browsing view is the only one that gets IB codes. A
  // ?viewAs= preview deliberately does not: a preview that shows more than the
  // student sees is not a preview.
  const view = selectedId
    ? await loadPracticeSetView({
        setId: selectedId,
        courseIds,
        includeQuestionCodes: isTeacherView && !viewAs,
      })
    : null;

  const q = viewAs ? `?viewAs=${viewAs.invitedStudentId}&` : "?";

  return (
    <div className="mx-auto max-w-4xl">
      {viewAs && (
        <p className="mb-6 rounded-lg border border-da-info/40 bg-da-info/10 px-4 py-3 text-sm text-da-text">
          Previewing <span className="font-semibold">{viewAs.name}</span>&rsquo;s view.
          {!viewAs.hasAccount && " This student has not signed in yet."}
        </p>
      )}

      {!view ? (
        <EmptyState isTeacherView={isTeacherView && !viewAs} />
      ) : (
        <>
          <PracticeSetHeader view={view} />
          {sets.length > 1 && <SetSwitcher sets={sets} selectedId={view.id} queryPrefix={q} />}
          {view.groups.map((group) => (
            <section key={group.tier} className="mt-12">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-da-border pb-3">
                <h2 className="font-serif text-2xl font-bold text-da-text">{group.label}</h2>
                <span className="font-mono text-xs tracking-wide text-da-muted">
                  {group.items.length} question{group.items.length === 1 ? "" : "s"} &middot; {group.marks} marks
                </span>
                <p className="w-full text-sm text-da-muted/80">{group.blurb}</p>
              </div>
              <ol className="mt-6 space-y-8">
                {group.items.map((item) => (
                  <QuestionCard key={item.position} item={item} />
                ))}
              </ol>
            </section>
          ))}
        </>
      )}
    </div>
  );
}

function PracticeSetHeader({ view }: { view: PracticeSetView }) {
  return (
    <header>
      <h1 className="font-serif text-3xl font-bold text-da-text">{view.name}</h1>
      {view.description && (
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-da-muted">{view.description}</p>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-xs tracking-wide text-da-muted">
        <span>
          {view.questionCount} question{view.questionCount === 1 ? "" : "s"}
        </span>
        <span>{view.totalMarks} marks</span>
        {/* The gate is on the data, not on this line: when it flips, the
            answers appear because the service starts returning them. */}
        <span className={view.markschemeReleased ? "text-da-success" : "text-da-warning"}>
          {view.markschemeReleased ? "Worked answers available" : "Answers not released yet"}
        </span>
      </div>
    </header>
  );
}

function SetSwitcher({
  sets,
  selectedId,
  queryPrefix,
}: {
  sets: PracticeSetSummary[];
  selectedId: string;
  queryPrefix: string;
}) {
  return (
    <nav className="mt-8 flex flex-wrap gap-2" aria-label="Practice sets">
      {sets.map((set) => (
        <Link
          key={set.id}
          href={`/dashboard/practice${queryPrefix}set=${set.id}`}
          className={
            set.id === selectedId
              ? "rounded-full border border-da-accent bg-da-accent/15 px-3 py-1 text-xs font-medium text-da-text"
              : "rounded-full border border-da-border px-3 py-1 text-xs text-da-muted hover:border-da-accent/50 hover:text-da-text"
          }
        >
          {set.name}
        </Link>
      ))}
    </nav>
  );
}

function QuestionCard({ item }: { item: PracticeItem }) {
  const gdc = calculatorAllowed(item.paper);

  return (
    <li className="rounded-xl border border-da-border bg-da-surface p-5 shadow-sm shadow-black/30">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-serif text-xl font-bold text-da-accent">{item.position}.</span>
          {item.subtopics.map((sub) => (
            <span key={sub.code} className="text-sm text-da-text">
              {sub.descriptor ?? sub.code}
            </span>
          ))}
          {item.paper !== null && (
            <span className="font-mono text-[11px] tracking-wide text-da-muted">
              {gdc ? "calculator" : "no calculator"}
            </span>
          )}
        </div>
        <span className="font-mono text-sm font-semibold text-da-muted">[{item.marks}]</span>
      </div>

      {item.questionCode && (
        <p className="mt-2 font-mono text-[11px] tracking-wide text-da-muted/70">
          {item.questionCode} &middot; teacher view only
        </p>
      )}

      <div className="mt-4 space-y-3">
        {/* A generated question is text and renders as text; a bank question
            is a scan of a printed page. Exactly one of the two is ever set,
            so there is no precedence to get wrong. */}
        {item.questionLatex ? (
          <div className="rounded-lg bg-da-bg/60 px-4 py-3 text-da-text">
            <LatexRenderer latex={item.questionLatex} />
          </div>
        ) : item.imageUrls.length === 0 ? (
          <p className="rounded-lg border border-da-warning/40 bg-da-warning/10 px-3 py-2 text-sm text-da-text">
            This question could not be loaded. Let your teacher know which number it is.
          </p>
        ) : (
          item.imageUrls.map((url) => (
            // Plain <img>: these are signed Supabase URLs that expire in an
            // hour, so next/image's optimiser cache would be caching a URL
            // that is dead before the cache entry is.
            //
            // max-w-full rather than w-full, because the bank's images were
            // imported at several different resolutions -- from 582px wide to
            // 1786px for the same one line of question text. Stretching every
            // one to the container upscales the low-resolution ones into
            // blurry giants next to their neighbours. Capping instead means
            // the big ones fit and the small ones render at native size.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={url}
              src={url}
              alt={`Question ${item.position}`}
              className="mx-auto h-auto max-w-full rounded-lg bg-white"
            />
          ))
        )}
      </div>
    </li>
  );
}

function EmptyState({ isTeacherView }: { isTeacherView: boolean }) {
  return (
    <div className="rounded-xl border border-da-border bg-da-surface p-8 text-center">
      <h1 className="font-serif text-2xl font-bold text-da-text">No practice set yet</h1>
      <p className="mx-auto mt-3 max-w-md text-sm text-da-muted">
        {isTeacherView
          ? "No course has a released practice set. A set becomes visible here once practice_sets.released_at is set."
          : "Your teacher hasn't released one for your class yet. It will show up here when they do."}
      </p>
    </div>
  );
}
