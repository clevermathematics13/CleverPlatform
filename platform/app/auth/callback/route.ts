import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

function isMissingExtraTimeColumnError(message?: string) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return lower.includes("extra_time") && (lower.includes("does not exist") || lower.includes("schema cache"));
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";
  const invitedEmail = searchParams.get("invitedEmail")?.toLowerCase() ?? null;
  const persistent = searchParams.get("persistent") !== "0";

  // Build the correct redirect base (Codespace forwarded URL or origin)
  const forwardedHost = request.headers.get("x-forwarded-host");
  const redirectBase = forwardedHost
    ? `https://${forwardedHost}`
    : origin;

  const supabase = await createClient({ persistent });

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

  const userEmail = (user.email ?? "").toLowerCase();
  const teacherEmail = "clevermathematics@gmail.com";
  const isTeacher = userEmail === teacherEmail;
  const isSchoolEmail = userEmail.endsWith("@amersol.edu.pe");

  if (!isTeacher && invitedEmail && invitedEmail !== userEmail) {
    await supabase.auth.signOut();
    return NextResponse.redirect(
      `${redirectBase}/login?error=invite_email_mismatch`
    );
  }

  if (!isTeacher && !isSchoolEmail) {
    await supabase.auth.signOut();
    return NextResponse.redirect(
      `${redirectBase}/login?error=school_email_required`
    );
  }

  const { data: invitations } = await supabase
    .from("invited_students")
    .select("id")
    .ilike("email", userEmail)
    .limit(1);

  if (!isTeacher && (!invitations || invitations.length === 0)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(
      `${redirectBase}/login?error=student_not_invited`
    );
  }

  // Ensure profile exists (use upsert to avoid duplicate key errors)
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .single();

  if (!profile) {
    const email = userEmail;
    let role: "teacher" | "student" = "student";
    if (isTeacher) {
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
  await supabase.rpc("auto_enroll_from_invitations", {
    p_user_id: user.id,
    p_user_email: userEmail,
  });

  const { data: invitedExtraTimeRows, error: invitedExtraTimeError } = await supabase
    .from("invited_students")
    .select("course_id, extra_time")
    .eq("email", userEmail);

  if (invitedExtraTimeError) {
    if (!isMissingExtraTimeColumnError(invitedExtraTimeError.message)) {
      console.error("Invitation extra_time lookup failed:", invitedExtraTimeError.message);
    }
  } else {
    await Promise.all(
      (invitedExtraTimeRows ?? [])
        .filter((row) => typeof row.extra_time === "number")
        .map((row) =>
          supabase
            .from("students")
            .update({ extra_time: row.extra_time })
            .eq("profile_id", user.id)
            .eq("course_id", row.course_id)
        )
    );
  }

  // Copy pre-set nickname from invitation to profile (if profile has none)
  const { data: invitation } = await supabase
    .from("invited_students")
    .select("nickname")
    .eq("email", userEmail)
    .not("nickname", "is", null)
    .limit(1)
    .single();

  if (invitation?.nickname) {
    await supabase
      .from("profiles")
      .update({ nickname: invitation.nickname })
      .eq("id", user.id)
      .is("nickname", null);
  }

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
