import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PlacementClient } from "./placement-client";

export default async function PlacementPage() {
  await requireTeacher();
  const supabase = await createClient();

  const { data: courses } = await supabase
    .from("courses")
    .select("id, name")
    .order("name");

  return (
    <div>
      <div>
        <h1 className="font-serif text-3xl font-bold text-da-text">Placement Tests</h1>
        <p className="mt-1 text-base text-da-muted">
          Upload a scanned placement test and let Clever assess it — Clev&apos;s Marks per
          question and an AISL / AASL / AAHL recommendation, fully automatic with low-confidence
          items flagged for your review.
        </p>
      </div>

      <PlacementClient courses={courses ?? []} />
    </div>
  );
}
