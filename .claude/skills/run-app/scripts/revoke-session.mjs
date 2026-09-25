/**
 * Revoke a session minted by mint-session.mjs, so it does not outlive the task.
 *
 * Run this as soon as you are done driving the browser, then delete the
 * session file. The container is ephemeral, but a refresh token that is still
 * valid is not something to leave lying around on the strength of that.
 *
 * --scope defaults to "local": only the session minted here is revoked.
 * "global" also signs the teacher out of every browser they are logged in on,
 * which is what this script used to do every time.
 *
 * Run it in place, from the repo root (the form the allow rule in
 * .claude/settings.json matches):
 *
 *   node .claude/skills/run-app/scripts/revoke-session.mjs --session <session.json> [--scope local|global]
 */
import fs from "node:fs";
import { createRequire } from "node:module";

// See mint-session.mjs: supabase-js lives under platform/.
const require = createRequire(new URL("../../../../platform/package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://qnawglgnoojrlaivylou.supabase.co";
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;

const args = process.argv.slice(2);
const argValue = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
const file = argValue("--session");
if (!file) {
  console.error("--session <path> is required");
  process.exit(1);
}
const scope = argValue("--scope") ?? "local";
if (scope !== "local" && scope !== "global") {
  console.error('--scope must be "local" or "global"');
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
const { error } = await admin.auth.admin.signOut(session.access_token, scope);
if (error) {
  console.error("revoke failed:", error.message);
  process.exit(1);
}
console.log(`session revoked (${scope}) for ${session.user?.email}; now delete ${file}`);
