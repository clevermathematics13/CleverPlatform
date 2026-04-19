"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function RegisterPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const supabase = createClient();

      // Step 1: Validate the registration code
      const { data: regCode, error: codeError } = await supabase
        .from("registration_codes")
        .select("*")
        .eq("code", code.trim().toUpperCase())
        .eq("used", false)
        .single();

      if (codeError || !regCode) {
        setError("Invalid or expired registration code.");
        setLoading(false);
        return;
      }

      // Check expiry
      if (regCode.expires_at && new Date(regCode.expires_at) < new Date()) {
        setError("This registration code has expired.");
        setLoading(false);
        return;
      }

      // Step 2: Create the parent account
      const { data: authData, error: signUpError } =
        await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              role: "parent",
              registration_code: code.trim().toUpperCase(),
            },
          },
        });

      if (signUpError) {
        setError(signUpError.message);
        setLoading(false);
        return;
      }

      if (authData.user) {
        // Step 3: Create profile
        await supabase.from("profiles").insert({
          id: authData.user.id,
          email: email,
          display_name: email.split("@")[0],
          role: "parent",
        });

        // Step 4: Link parent to student
        await supabase.from("parent_links").insert({
          parent_profile_id: authData.user.id,
          student_id: regCode.student_id,
        });

        // Step 5: Mark code as used
        await supabase
          .from("registration_codes")
          .update({ used: true, used_by: authData.user.id })
          .eq("id", regCode.id);
      }

      router.push("/dashboard");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md space-y-8 rounded-xl bg-white p-8 shadow-lg">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">
            Parent Registration
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            Enter the registration code provided by the teacher
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleRegister} className="space-y-6">
          <div>
            <label
              htmlFor="code"
              className="block text-sm font-medium text-gray-700"
            >
              Registration Code
            </label>
            <input
              id="code"
              type="text"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. ABC123"
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-gray-700"
            >
              Email Address
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="parent@example.com"
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-gray-700"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min. 8 characters"
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {loading ? "Creating account..." : "Register"}
          </button>
        </form>

        <div className="text-center">
          <a
            href="/login"
            className="text-sm font-medium text-blue-600 hover:text-blue-500"
          >
            Already have an account? Sign in
          </a>
        </div>
      </div>
    </div>
  );
}
