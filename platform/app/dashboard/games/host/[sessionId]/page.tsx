import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import { HostGameClient } from "./host-game-client";

export default async function HostGamePage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const profile = await requireTeacher();
  const { sessionId } = await params;
  const supabase = await createClient();

  const { data: session } = await supabase
    .from("game_sessions")
    .select("id, host_id, room_code, bank_id")
    .eq("id", sessionId)
    .single();

  if (!session) notFound();
  if (session.host_id !== profile.id) redirect("/dashboard/games");

  const { data: bank } = await supabase
    .from("game_question_banks")
    .select("title")
    .eq("id", session.bank_id)
    .single();

  return (
    <HostGameClient
      sessionId={session.id}
      roomCode={session.room_code}
      bankTitle={bank?.title ?? "Question Bank"}
    />
  );
}
