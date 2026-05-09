import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function GradebookPage() {
  await requireTeacher();
  const supabase = await createClient();

  const { data: courses } = await supabase
    .from("courses")
    .select("id, name")
    .order("name");

  const courseList = courses ?? [];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-da-text font-serif">Gradebook</h1>
        <p className="text-da-muted text-sm mt-1">
          Select a course below, or hover over &quot;Gradebook&quot; in the sidebar to jump directly.
        </p>
      </div>

      {courseList.length === 0 ? (
        <div className="rounded-xl border border-dashed border-da-border bg-da-surface p-12 text-center">
          <p className="text-da-muted text-sm">
            No courses yet.{" "}
            <Link href="/dashboard/courses" className="text-da-accent hover:underline">
              Create a course
            </Link>{" "}
            to get started.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courseList.map((course) => (
            <Link
              key={course.id}
              href={`/dashboard/gradebook/${course.id}`}
              className="group block rounded-xl border border-da-border bg-da-surface px-6 py-5 transition-all hover:bg-da-hover hover:border-da-accent/60 hover:shadow-lg hover:shadow-black/30"
            >
              <div className="flex items-start justify-between">
                <h2 className="text-lg font-semibold text-da-text group-hover:text-da-accent transition-colors">
                  {course.name}
                </h2>
                <span className="text-da-accent text-lg">→</span>
              </div>
              <p className="text-xs text-da-muted mt-2">View Gradebook</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
