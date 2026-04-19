"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getProfile } from "@/lib/auth";

const IMPERSONATE_COOKIE = "impersonate-role";

export async function startImpersonation(formData: FormData) {
  const profile = await getProfile();
  if (profile.role !== "teacher") return;

  const role = formData.get("role") as string;
  if (role !== "student" && role !== "parent") return;

  const cookieStore = await cookies();
  cookieStore.set(IMPERSONATE_COOKIE, role, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 4, // 4 hours
  });
  revalidatePath("/dashboard");
}

export async function stopImpersonation() {
  const cookieStore = await cookies();
  cookieStore.delete(IMPERSONATE_COOKIE);
  revalidatePath("/dashboard");
}

export async function getImpersonatedRole(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(IMPERSONATE_COOKIE)?.value ?? null;
}
