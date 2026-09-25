/**
 * Mint a signed-in teacher session for the local dev server.
 *
 * The app's /auth/callback exchanges a PKCE code, whose verifier cookie only
 * the client that started the flow holds -- so there is no way to log in from
 * a script through the normal route. This instead asks the admin API for a
 * magic link (generateLink returns it rather than emailing it), redeems it,
 * and serialises the resulting session into the cookie @supabase/ssr reads.
 *
 * Writes the cookie array as JSON to --out. Hand that file to
 * drive-marking.cjs, and revoke it with revoke-session.mjs when finished.
 *
 * Minting a login for a real account is a real person's credentials: ask the
 * user in the conversation before running this, and revoke afterwards. The
 * allow rule in .claude/settings.json only removes the permission prompt.
 *
 * Run it in place, from the repo root, exactly as below -- that is the form
 * the allow rule matches. The anon key goes in as an argument, not an env
 * prefix: Claude Code strips only a fixed list of harmless variables before
 * matching a rule, so `ANON_KEY=... node ...` would not match it.
 *
 *   node .claude/skills/run-app/scripts/mint-session.mjs --anon-key <legacy anon JWT> --out <session.json>
 */
import fs from "node:fs";
import { createRequire } from "node:module";

// supabase-js is installed under platform/, not beside this script, and an
// ESM import resolves from the script's own folder. Resolving from
// platform/package.json lets the script run where it lives, so the allow rule
// can name this file rather than a copy anyone could rewrite.
const require = createRequire(new URL("../../../../platform/package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");

const args = process.argv.slice(2);
const argValue = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://qnawglgnoojrlaivylou.supabase.co";
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];
const ANON = argValue("--anon-key") ?? process.env.ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL = process.env.TEACHER_EMAIL ?? "clevermathematics@gmail.com";

const out = argValue("--out");
if (!out) {
  console.error("--out <path> is required");
  process.exit(1);
}
if (!ANON || !SRK) {
  console.error("need --anon-key <legacy anon JWT> and SUPABASE_SERVICE_ROLE_KEY in the env");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SRK, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email: EMAIL,
});
if (linkErr) {
  console.error("generateLink failed:", linkErr.message);
  process.exit(1);
}
const tokenHash = link.properties?.hashed_token;
if (!tokenHash) {
  console.error("no hashed_token returned");
  process.exit(1);
}

const anon = createClient(SUPABASE_URL, ANON, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const { data: verified, error: vErr } = await anon.auth.verifyOtp({
  token_hash: tokenHash,
  type: "magiclink",
});
if (vErr) {
  console.error("verifyOtp failed:", vErr.message);
  process.exit(1);
}
const s = verified.session;
if (!s) {
  console.error("no session returned");
  process.exit(1);
}

const session = {
  access_token: s.access_token,
  refresh_token: s.refresh_token,
  expires_at: s.expires_at,
  expires_in: s.expires_in,
  token_type: s.token_type,
  user: s.user,
};

// @supabase/ssr 0.10: "base64-" + base64url JSON, chunked at MAX_CHUNK_SIZE.
const encoded = "base64-" + Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
const MAX = 3180;
const name = `sb-${PROJECT_REF}-auth-token`;
const cookies = [];
if (encoded.length <= MAX) {
  cookies.push({ name, value: encoded });
} else {
  for (let i = 0, n = 0; i < encoded.length; i += MAX, n++) {
    cookies.push({ name: `${name}.${n}`, value: encoded.slice(i, i + MAX) });
  }
}

fs.writeFileSync(out, JSON.stringify({ cookies }, null, 2));
console.error(`signed in as ${verified.user?.email} (${verified.user?.id})`);
console.error(`${cookies.length} cookie chunk(s) written to ${out}`);
