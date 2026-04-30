"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const IMPERSONATE_ROLE_COOKIE = "impersonate-role";
const IMPERSONATE_PROFILE_COOKIE = "impersonate-profile-id";

export async function startImpersonation(formData: FormData) {
  const profile = await getProfile();
  if (profile.role !== "teacher") return;

  const role = formData.get("role") as string;
  if (role !== "student" && role !== "parent") return;

  const cookieStore = await cookies();
  cookieStore.set(IMPERSONATE_ROLE_COOKIE, role, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 4,
  });
  revalidatePath("/dashboard");
}

export async function startStudentImpersonation(formData: FormData) {
  const profile = await getProfile();
  if (profile.role !== "teacher") return;

  const targetProfileId = formData.get("profile_id") as string;
  if (!targetProfileId) return;

  // Verify the target is an actual student profile (not teacher)
  const supabase = await createClient();
  const { data: targetProfile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", targetProfileId)
    .eq("role", "student")
    .single();

  if (!targetProfile) return;

  const cookieStore = await cookies();
  cookieStore.set(IMPERSONATE_ROLE_COOKIE, "student", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 4,
  });
  cookieStore.set(IMPERSONATE_PROFILE_COOKIE, targetProfileId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 4,
  });
  redirect("/dashboard/student-start");
}

export async function stopImpersonation() {
  const cookieStore = await cookies();
  cookieStore.delete(IMPERSONATE_ROLE_COOKIE);
  cookieStore.delete(IMPERSONATE_PROFILE_COOKIE);
  revalidatePath("/dashboard");
}

export async function getImpersonatedRole(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(IMPERSONATE_ROLE_COOKIE)?.value ?? null;
}

export async function getImpersonatedProfileId(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(IMPERSONATE_PROFILE_COOKIE)?.value ?? null;
}
