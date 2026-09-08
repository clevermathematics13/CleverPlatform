import { requireTeacher } from "@/lib/auth";
import { getShowHiddenStudents } from "@/lib/teacher-preferences";
import { createClient } from "@/lib/supabase/server";
import { getDriveConnectionStatus, getDriveWriteStatus } from "@/lib/google-drive";
import { SettingsClient } from "./settings-client";

export default async function SettingsPage() {
  const profile = await requireTeacher();
  const supabase = await createClient();
  const showHiddenStudents = await getShowHiddenStudents(supabase, profile.id);

  // Two questions, not one: whether Google is connected at all (the read
  // scopes the question-bank features need) and whether that connection may
  // also write (the scope the PowerSchool mirror needs). A token issued
  // before the mirror existed answers yes to the first and no to the second,
  // which is the state that produced "The Drive connection is read-only" with
  // no obvious place to fix it.
  const [driveRead, driveWrite, { data: settings }] = await Promise.all([
    getDriveConnectionStatus(),
    getDriveWriteStatus(),
    supabase
      .from("teacher_settings")
      .select("powerschool_drive_folder_id")
      .eq("teacher_id", profile.id)
      .maybeSingle(),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-serif text-3xl font-bold text-da-text">Settings</h1>
      <p className="mt-1 text-sm text-da-muted">Platform preferences.</p>
      <div className="mt-6">
        <SettingsClient
          initialShowHiddenStudents={showHiddenStudents}
          drive={{
            connected: driveRead.connected,
            email: driveRead.email,
            canWrite: driveWrite.connected && driveWrite.missingScopes.length === 0,
            fragile: driveRead.fragile,
          }}
          initialDriveFolderId={
            (settings?.powerschool_drive_folder_id as string | null) ?? ""
          }
        />
      </div>
    </div>
  );
}
