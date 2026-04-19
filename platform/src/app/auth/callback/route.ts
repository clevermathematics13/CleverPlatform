import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  // Build the correct redirect base (Codespace forwarded URL or origin)
  const forwardedHost = request.headers.get("x-forwarded-host");
  const redirectBase = forwardedHost
    ? `https://${forwardedHost}`
    : origin;

  const supabase = await createClient();

  if (code) {
    const { error: exchangeError } =
      await supabase.auth.exchangeCodeForSession(code);

    if (exchangeError) {
      console.error("Auth code exchange failed:", exchangeError.message);
      // Code may have already been exchanged (proxy retry).
      // Check if we have a session anyway.
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        console.log("Session exists despite exchange error, proceeding");
      } else {
        return NextResponse.redirect(
          `${redirectBase}/login?error=auth_callback_failed`
        );
      }
    }
  }

  // At this point we either exchanged the code or had an existing session
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(
      `${redirectBase}/login?error=auth_callback_failed`
    );
  }

  // Ensure profile exists (use upsert to avoid duplicate key errors)
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .single();

  if (!profile) {
    const email = user.email ?? "";
    let role: "teacher" | "student" = "student";
    if (email === "clevermathematics@gmail.com") {
      role = "teacher";
    }

    const { error: upsertError } = await supabase.from("profiles").upsert(
      {
        id: user.id,
        email: email,
        display_name:
          user.user_metadata?.full_name ?? email.split("@")[0],
        avatar_url: user.user_metadata?.avatar_url ?? null,
        role: role,
      },
      { onConflict: "id" }
    );

    if (upsertError) {
      console.error("Profile upsert failed:", upsertError.message);
    } else {
      console.log("Profile created for", email, "with role", role);
    }
  }

  // Auto-enroll from teacher invitations (if any)
  const userEmail = user.email ?? "";
  await supabase.rpc("auto_enroll_from_invitations", {
    p_user_id: user.id,
    p_user_email: userEmail,
  });

  // Check if student needs to set nickname
  const { data: currentProfile } = await supabase
    .from("profiles")
    .select("role, nickname")
    .eq("id", user.id)
    .single();

  if (currentProfile?.role === "student" && !currentProfile.nickname) {
    return NextResponse.redirect(`${redirectBase}/register/nickname`);
  }

  return NextResponse.redirect(`${redirectBase}${next}`);
}
