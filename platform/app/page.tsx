import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen flex-col bg-da-bg">
      <header className="border-b border-da-border px-6 py-5">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <span className="text-xl font-bold tracking-tight text-da-accent font-serif">
            CleverPlatform
          </span>
          <Link
            href="/login"
            style={{ backgroundColor: "#c88a1a", color: "#2b1408" }}
            className="rounded-lg border border-da-accent/40 px-4 py-2 text-sm font-semibold shadow-sm transition-colors hover:bg-da-amber"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-1 flex-col justify-center px-6 py-20">
        <div className="max-w-2xl space-y-6">
          <h1 className="text-4xl font-bold tracking-tight text-da-accent font-serif sm:text-5xl">
            CleverPlatform
          </h1>
          <p className="text-lg leading-relaxed text-da-text">
            CleverPlatform is an IB Diploma Programme Mathematics learning
            platform used to manage coursework, assessments, and grading for
            students, parents, and teachers.
          </p>
          <ul className="space-y-3 text-da-text">
            <li className="flex gap-3">
              <span className="text-da-accent">—</span>
              <span>
                <span className="font-semibold">Students</span> access
                assignments, assessments, and grades in one place.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-da-accent">—</span>
              <span>
                <span className="font-semibold">Teachers</span> create, assign,
                and grade IB Mathematics assessments with structured feedback.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-da-accent">—</span>
              <span>
                <span className="font-semibold">Parents</span> can follow
                their child&apos;s academic progress with an access code.
              </span>
            </li>
          </ul>
          <div className="flex flex-wrap gap-4 pt-4">
            <Link
              href="/login"
              style={{ backgroundColor: "#c88a1a", color: "#2b1408" }}
              className="rounded-lg border border-da-accent/40 px-6 py-3 text-sm font-semibold shadow-sm transition-colors hover:bg-da-amber"
            >
              Sign in
            </Link>
            <Link
              href="/register"
              className="rounded-lg border border-da-border px-6 py-3 text-sm font-semibold text-da-text transition-colors hover:border-da-accent/40"
            >
              Register as a parent
            </Link>
          </div>
        </div>
      </main>

      <footer className="border-t border-da-border px-6 py-6 text-sm text-da-muted">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2">
          <span>CleverPlatform</span>
          <div className="flex gap-4">
            <Link href="/privacy" className="hover:text-da-accent">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-da-accent">
              Terms of Service
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
