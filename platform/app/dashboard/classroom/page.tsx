import { requireTeacher } from "@/lib/auth";
import Link from "next/link";
import { ClassroomClient } from "./classroom-client";
import { fetchCourses } from "./actions";

export default async function ClassroomPage() {
  await requireTeacher();
  const { courses, error } = await fetchCourses();

  return (
    <div>
      <h1 className="text-3xl font-extrabold text-blue-900 drop-shadow-sm">
        Google Classroom
      </h1>
      <p className="mt-1 text-base font-medium text-blue-700">
        Read and assess student work submitted to Google Classroom.
      </p>

      {courses.length === 0 && (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No Classroom courses are visible.{" "}
          <Link
            href="/dashboard/students"
            className="font-medium underline hover:text-amber-900"
          >
            Connect Google Classroom
          </Link>{" "}
          on the Students page, then reload.
          {error ? <span className="mt-1 block text-xs">{error}</span> : null}
        </div>
      )}

      <div className="mt-6">
        <ClassroomClient courses={courses} initialError={error} />
      </div>
    </div>
  );
}
