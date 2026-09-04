import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { HostLobbyClient } from "./host-lobby-client";
import { JoinGameClient } from "./join-client";

export default async function GamesPage() {
  const profile = await getProfile();

  if (profile.role === "teacher") {
    const supabase = await createClient();
    const { data: banks } = await supabase
      .from("game_question_banks")
      .select("id, slug, title")
      .order("title");

    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-extrabold text-da-text drop-shadow-sm">Live Game</h1>
        <p className="mt-1 text-base font-medium text-da-accent">
          Host a Kahoot-style round from any question bank -- students join with a room code.
        </p>
        <div className="mt-6">
          <HostLobbyClient banks={banks ?? []} hostId={profile.id} />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-3xl font-extrabold text-da-text drop-shadow-sm">Live Game</h1>
      <p className="mt-1 text-base font-medium text-da-accent">
        Enter the room code your teacher gives you to join.
      </p>
      <div className="mt-6">
        <JoinGameClient />
      </div>
    </div>
  );
}
