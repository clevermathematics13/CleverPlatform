import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/auth";
import { loadMarkingView } from "@/lib/practice-marking-service";
import { MarkingClient } from "./marking-client";

export const metadata = { title: "Marking" };

/**
 * Reading a class's practice answers, one question at a time.
 *
 * Organised by QUESTION rather than by student, which is the whole point of
 * the screen. Marking one student's paper and then the next is how you mark an
 * exam; for practice the useful question is "how did the class find part (b)",
 * and fourteen answers to the same part side by side makes a shared
 * misconception obvious in seconds. A per-student view is one click away for
 * when the question really is about one person.
 *
 * Nothing recorded here is a score. See migration 20260911201428: three
 * states, an optional note, no total, and no route to the gradebook.
 */
export default async function PracticeMarkingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireTeacher();
  const { id } = await params;
  const view = await loadMarkingView(id);
  if (!view) notFound();

  return (
    <div className="mx-auto max-w-6xl">
      <nav className="mb-4 text-sm">
        <Link href="/dashboard/practice-sets" className="text-da-muted hover:text-da-text">
          &larr; Practice Sets
        </Link>
      </nav>
      <MarkingClient view={view} />
    </div>
  );
}
