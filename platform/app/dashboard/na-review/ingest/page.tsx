import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import IngestPilotClient from "./ingest-pilot-client";

export default async function IngestPilotPage() {
  await requireTeacher();
  const supabase = await createClient();

  const { data: packetVersion } = await supabase
    .from("na_packet_versions")
    .select("id, version_label")
    .eq("version_label", "A.1 v1 (pilot-validated)")
    .single();

  if (!packetVersion) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold text-da-text font-serif">Pilot Data Ingestion</h1>
        <p className="text-da-muted text-sm mt-2">
          No packet version found with label &quot;A.1 v1 (pilot-validated)&quot;. Run the anchor
          seed migration first.
        </p>
      </div>
    );
  }

  return <IngestPilotClient packetVersionId={packetVersion.id} />;
}
