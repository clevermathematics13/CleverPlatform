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
  const [driveRead, driveWrite, { data: settings }, { data: testRows }] = await Promise.all([
    getDriveConnectionStatus(),
    getDriveWriteStatus(),
    supabase
      .from("teacher_settings")
      .select("powerschool_drive_folder_id")
      .eq("teacher_id", profile.id)
      .maybeSingle(),
    supabase.from("tests").select("teacher_id").limit(200),
  ]);

  // Whose Drive connection the PowerSchool mirror will actually use: the
  // teacher who owns the tests, which is not necessarily whoever is signed in.
  //
  // A Drive token is stored per profile, and google_oauth_tokens is readable
  // only for your own row -- so this page cannot report on another account's
  // connection, only name it. Worth naming: connecting Drive while signed in
  // on one of the test accounts files a perfectly good token under that
  // profile, where the exports never look, and every screen says "Connected"
  // while the mirror stays broken. That happened.
  const ownerIds = [...new Set((testRows ?? []).map((t) => t.teacher_id as string))];
  const ownerId = ownerIds.length === 1 ? ownerIds[0] : null;
  let exportOwnerEmail: string | null = null;
  if (ownerId && ownerId !== profile.id) {
    const { data: owner } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", ownerId)
      .maybeSingle();
    exportOwnerEmail = (owner?.email as string | null) ?? "another account";
  }

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
          exportOwnerEmail={exportOwnerEmail}
        />
      </div>
    </div>
  );
}
