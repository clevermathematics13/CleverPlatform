/**
 * Revoke a session minted by mint-session.mjs, so it does not outlive the task.
 *
 * Run this as soon as you are done driving the browser, then delete the
 * session file. The container is ephemeral, but a refresh token that is still
 * valid is not something to leave lying around on the strength of that.
 *
 * Must be run from platform/ so node_modules resolves -- see SKILL.md section 4.
 *
 *   node .tmp-revoke.mjs --session session.json
 */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://qnawglgnoojrlaivylou.supabase.co";
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;

const args = process.argv.slice(2);
const file = args.includes("--session") ? args[args.indexOf("--session") + 1] : null;
if (!file) {
  console.error("--session <path> is required");
  process.exit(1);
}

const { cookies } = JSON.parse(fs.readFileSync(file, "utf8"));
const encoded = cookies.map((c) => c.value).join("");
const session = JSON.parse(
  Buffer.from(encoded.replace(/^base64-/, ""), "base64url").toString("utf8")
);

const admin = createClient(SUPABASE_URL, SRK, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { error } = await admin.auth.admin.signOut(session.access_token, "global");
if (error) {
  console.error("revoke failed:", error.message);
  process.exit(1);
}
console.log(`session revoked for ${session.user?.email}; now delete ${file}`);
