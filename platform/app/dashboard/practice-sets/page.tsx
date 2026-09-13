import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listPracticeSetsForTeacher } from "@/lib/practice-set-admin";
import { AmbientSphere } from "@/components/brand/AmbientSphere";
import { PracticeSetsClient } from "./practice-sets-client";

export const metadata = { title: "Practice Sets" };

/**
 * Where a teacher builds practice sets.
 *
 * Two ways to add a question, and the second is the point of the screen: take
 * a past paper question from the bank, or have one WRITTEN from it. A past
 * paper question spent on practice can no longer be set as an assessment, and
 * the bank is finite; a generated counterpart exercises the same technique at
 * the same tariff and leaves the original untouched.
 *
 * A generated question is a draft until a teacher approves it. Nothing on
 * this page can put unapproved machine-written mathematics in front of a
 * class -- the RLS policy on practice_set_items is what guarantees that, not
 * this page's buttons.
 */
export default async function PracticeSetsPage() {
  await requireTeacher();
  const supabase = await createClient();

  const [{ data: courses }, sets] = await Promise.all([
    supabase.from("courses").select("id, name").eq("archived", false).order("name"),
    listPracticeSetsForTeacher(),
  ]);

  return (
    <div className="relative">
      <AmbientSphere />
      {/* Everything the teacher reads sits above the scenery. */}
      <div className="relative z-10">
        <PracticeSetsClient
          courses={(courses ?? []).map((c) => ({ id: c.id as string, name: c.name as string }))}
          sets={sets}
        />
      </div>
    </div>
  );
}
