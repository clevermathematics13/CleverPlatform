import { requireTeacher } from "@/lib/auth";
import { PlacementClient } from "./placement-client";

export default async function PlacementPage() {
  await requireTeacher();

  return (
    <div>
      <div>
        <h1 className="font-serif text-3xl font-bold text-da-text">Placement Tests</h1>
        <p className="mt-1 text-base text-da-muted">
          Upload a scanned placement test and let Clever assess it — the student&apos;s name and
          grade level are read off the front page, then Clev&apos;s Marks per question and an
          AISL / AASL / AAHL recommendation, fully automatic with anything uncertain flagged for
          your review.
        </p>
      </div>

      <PlacementClient />
    </div>
  );
}
