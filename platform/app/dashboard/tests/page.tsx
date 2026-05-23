import { getProfile } from "@/lib/auth";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TestsClient } from "./tests-client";

export default async function TestsPage() {
  const profile = await getProfile();
  if (profile.role !== "teacher") redirect("/dashboard");

  const supabase = await createClient();

  const [{ data: tests }, { data: courses }] = await Promise.all([
    supabase
      .from("tests")
      .select(
        `id, name, test_date, total_marks, course_id, hidden,
         courses(name),
         test_items(id, question_number, part_label, max_marks, sort_order)`
      )
      .order("test_date", { ascending: false }),
    supabase.from("courses").select("id, name").order("name"),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-blue-900">Tests</h1>
      </div>
      <TestsClient
        initialTests={(tests ?? []) as unknown as TestRow[]}
        courses={courses ?? []}
      />
    </div>
  );
}

// Exported so the client can use it
export interface TestRow {
  id: string;
  name: string;
  test_date: string | null;
  total_marks: number | null;
  course_id: string | null;
  hidden: boolean;
  courses: { name: string } | null;
  test_items: {
    id: string;
    question_number: number;
    part_label: string;
    max_marks: number;
    sort_order: number | null;
  }[];
}
