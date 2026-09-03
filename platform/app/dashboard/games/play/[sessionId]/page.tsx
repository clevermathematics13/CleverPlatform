import { requireStudentOrTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { PlayGameClient } from "./play-game-client";

export default async function PlayGamePage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const profile = await requireStudentOrTeacher();
  const { sessionId } = await params;
  const supabase = await createClient();

  const { data: session } = await supabase
    .from("game_sessions")
    .select("id, bank_id")
    .eq("id", sessionId)
    .single();
  // RLS only returns this row once the caller is the host or already has a
  // game_players row for it -- joining always happens before this page loads.
  if (!session) notFound();

  const { data: bank } = await supabase
    .from("game_question_banks")
    .select("title")
    .eq("id", session.bank_id)
    .single();

  return (
    <PlayGameClient
      sessionId={session.id}
      bankTitle={bank?.title ?? "Question Bank"}
      profileId={profile.id}
    />
  );
}
