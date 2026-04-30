import { requireTeacher } from "@/lib/auth";
import { SyllabusClient } from "./syllabus-client";
import { createClient } from "@/lib/supabase/server";

export default async function SyllabusPage() {
  await requireTeacher();

  const supabase = await createClient();

  // Fetch courses (order by name so AH classes group together)
  const { data: courses } = await supabase
    .from("courses")
    .select("id, name")
    .order("name");

  // Fetch all subtopics
  const { data: subtopics } = await supabase
    .from("subtopics")
    .select("code, descriptor, section, parent_code")
    .order("code");

  return (
    <div className="w-full">
      <SyllabusClient
        courses={courses ?? []}
        subtopics={subtopics ?? []}
      />
    </div>
  );
}
