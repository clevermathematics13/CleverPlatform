import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { listLessons } from "@/lib/lessons";

/** The lesson index.
 *
 *  The menu entry for this section is static, the way Practice and Live Game
 *  are: it is in the sidebar whether or not a lesson has been written for
 *  the class yet, and this page says plainly when there is nothing. The
 *  DASHBOARD TILE is the conditional one, because a tile is a claim that
 *  there is something to open. */
export default async function LessonsPage({
  searchParams,
}: {
  searchParams: Promise<{ viewAs?: string }>;
}) {
  await requireRole("student", "teacher");
  const { viewAs } = await searchParams;
  // Carry the teacher's per-tab preview through, exactly as the sidebar and
  // the dashboard tiles do, so the view survives the navigation.
  const q = viewAs ? `?viewAs=${viewAs}` : "";

  const lessons = listLessons();

  return (
    <div className="mx-auto max-w-4xl">
      <header>
        <h1 className="font-serif text-3xl text-da-text">Lessons</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-da-muted">
          Short lessons that give you the tools for a worksheet before you start it. Work through the
          slides, try each check question before you reveal the answer, then go and do the paper.
        </p>
      </header>

      {lessons.length === 0 ? (
        <p className="mt-8 rounded-xl border border-da-border bg-da-surface p-6 text-sm text-da-muted">
          No lessons have been published yet.
        </p>
      ) : (
        <ul className="mt-8 space-y-4">
          {lessons.map((lesson) => (
            <li key={lesson.slug}>
              <Link
                href={`/dashboard/lessons/${lesson.slug}${q}`}
                className="group block rounded-xl border border-da-border bg-da-surface p-6 shadow-sm shadow-black/30 transition-all hover:border-da-accent/50 hover:shadow-md hover:shadow-black/40"
              >
                <p className="font-mono text-xs tracking-widest text-da-accent">
                  LESSON {lesson.code} &middot; {lesson.courseLabel.toUpperCase()}
                </p>
                <h2 className="mt-2 font-serif text-xl text-da-text">{lesson.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-da-muted">{lesson.summary}</p>
                <p className="mt-4 font-mono text-[11px] tracking-wide text-da-muted/70">
                  {lesson.slideCount} slides &middot; about {lesson.minutes} minutes
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
