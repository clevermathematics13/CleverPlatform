import { requireTeacher } from "@/lib/auth";
import { getShowHiddenStudents } from "@/lib/teacher-preferences";
import { createClient } from "@/lib/supabase/server";
import { SettingsClient } from "./settings-client";

export default async function SettingsPage() {
  const profile = await requireTeacher();
  const supabase = await createClient();
  const showHiddenStudents = await getShowHiddenStudents(supabase, profile.id);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-serif text-3xl font-bold text-da-text">Settings</h1>
      <p className="mt-1 text-sm text-da-muted">Platform preferences.</p>
      <div className="mt-6">
        <SettingsClient initialShowHiddenStudents={showHiddenStudents} />
      </div>
    </div>
  );
}
