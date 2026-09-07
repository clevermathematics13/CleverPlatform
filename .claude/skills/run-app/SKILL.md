---
name: run-app
description: Launch the CleverPlatform Next.js app (platform/) and drive it in a headless browser as a signed-in teacher, to see a change working in the real UI rather than only in tests. Use this whenever you need to run, start, open, or screenshot the app; check what a teacher actually sees on the AI-grading marking screen, the paper-layout editor, the gradebook or any dashboard page; confirm evidence crops, badges or marks render correctly; or reproduce a UI bug. Covers the four things that make this repo hard to run headlessly - env vars with no .env file, a teacher session that cannot be obtained through the normal login flow, Chromium being unable to reach Supabase through the agent proxy, and app-specific selectors that are not discoverable by poking at the page.
---

# Running CleverPlatform in a headless browser

Everything here was established empirically against the live app. The four
sections marked **gotcha** cost real time to discover; none of them is
guessable from the code, and skipping one produces a failure that looks like
something else entirely.

Read `platform/CLAUDE.md` first regardless - its non-negotiables (webpack not
turbopack, `main` is production with real student data) apply to everything
below.

## Before you start: is a browser actually needed?

Driving the UI means minting a session against **production** - there is no
staging environment. That is justified for "does the teacher see the right
thing", and wasteful for anything a test or a database query already answers.
Prefer `npm test`, or a direct Supabase query, when the question is about data
rather than rendering.

## 1. Environment

There is **no `.env` / `.env.local` file in this repo** and `.gitignore`
deliberately excludes them - the repo is public. Two variables are already in
the process env (`SUPABASE_SERVICE_ROLE_KEY`, `GRAPH_LAB_CV_SERVICE_URL`); the
two the browser needs are not, so pass them inline and never write them to
disk:

```bash
export NEXT_PUBLIC_SUPABASE_URL="https://qnawglgnoojrlaivylou.supabase.co"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="<legacy anon JWT>"
```

Get the anon key from the Supabase MCP tool `get_publishable_keys` and take the
one whose `type` is **`legacy`** (a `sb_publishable_...` key is a different
format; `lib/supabase/client.ts` expects the JWT).

`ANTHROPIC_API_KEY` is absent locally. That is fine for viewing: the marking
screen renders a red banner reading *"AI marking is currently unavailable …
ANTHROPIC_API_KEY is not configured on this deployment"* and everything else
still works. Expect that banner in screenshots and do not chase it. Only
running a fresh grade needs the key.

## 2. Start the server

```bash
cd platform && npm run dev > /tmp/dev.log 2>&1 &
until grep -qE "Ready in|Error" /tmp/dev.log; do sleep 1; done
```

Ready in about 1.5s on port 3000. Never pass `--turbopack`.

Sanity-check that routes compile and gate correctly before bothering with a
browser - an unauthenticated page should 307 to `/login` and an API route
should 401:

```bash
curl -sS -o /dev/null -w '%{http_code} -> %{redirect_url}\n' \
  http://localhost:3000/dashboard/tests/<testId>/ai-grade
```

## 3. Authentication — gotcha, and it needs the user's approval

**You cannot log in the normal way.** `app/auth/callback/route.ts` calls
`exchangeCodeForSession(code)`, which needs a PKCE verifier cookie set by the
client that started the flow. There is nothing to forge.

The way through is to mint a session with the service role and inject the
`@supabase/ssr` cookie directly. `scripts/mint-session.mjs` does this:
`admin.generateLink({type:'magiclink'})` (which returns the link rather than
emailing it) → `verifyOtp` → serialise the session into
`sb-<project-ref>-auth-token`, encoded as `base64-` + base64url JSON and split
into `.0` / `.1` chunks at 3180 characters (`@supabase/ssr` 0.10's
`MAX_CHUNK_SIZE`).

Two things to respect:

- **Ask first.** Minting a login for a real person's account is gated by the
  permission classifier, and rightly so. Explain what you are doing and why,
  and let them approve it. Do not look for a way around the refusal.
- **Revoke afterwards.** `scripts/revoke-session.mjs` calls
  `admin.auth.admin.signOut(access_token, "global")`. Run it and delete the
  session file when you are done, so nothing outlives the task.

The teacher account is `clevermathematics@gmail.com`; `app/auth/callback`
hardcodes that address, and `getApiTeacher()` requires `profiles.role =
'teacher'`.

## 4. Node module resolution — gotcha

ESM resolves `node_modules` from the **script's own directory**, not the
working directory. A script in the scratchpad cannot `import
"@supabase/supabase-js"` even when run from `platform/`, and fails with a
confusing `ERR_MODULE_NOT_FOUND` naming a package that is plainly installed.

Copy the script into `platform/` under a `.tmp-` name, run it, delete it:

```bash
cp <script>.mjs platform/.tmp-run.mts
(cd platform && npx tsx .tmp-run.mts <args>); rm -f platform/.tmp-run.mts
git status --porcelain   # confirm you left nothing behind
```

Use `.mts`/`npx tsx` when the script imports repo TypeScript (importing the
real module is much better than restating its logic - see §7).

## 5. Chromium and the agent proxy — gotcha

Two separate problems:

**Binary path.** Playwright 1.56 is installed globally, so set
`NODE_PATH=/opt/node22/lib/node_modules`. The browser lives at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome` — the unsuffixed
`/opt/pw-browsers/chromium/` directory exists but has no `chrome-linux/chrome`
inside, so pointing there fails with "executable doesn't exist". Launch with
`--no-sandbox --disable-dev-shm-usage`.

**TLS.** Outbound HTTPS goes through the agent proxy, which Chromium does not
trust, so every signed Supabase URL - including every evidence crop - fails
silently and images render blank. Node *does* trust it
(`NODE_EXTRA_CA_CERTS`), so intercept those requests and fulfil them from
Node:

```js
await ctx.route("**://*.supabase.co/**", async (route) => {
  const res = await fetch(route.request().url());
  await route.fulfill({
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") ?? "application/octet-stream" },
    body: Buffer.from(await res.arrayBuffer()),
  });
});
```

Also set `NO_PROXY=localhost,127.0.0.1` so the dev server is reached directly.

Never disable TLS verification or unset `HTTPS_PROXY` to work around this.

## 6. Driving the marking screen — gotcha

The structure is not guessable, and each of these cost a wasted run:

- **The roster loads after hydration, long past `networkidle`.** Waiting on
  `networkidle` finds only "Loading this assessment…". Wait for that text to
  detach, then for a `Review →` button to be visible.
- **Crops are two levels deep.** Click `Review →` for a student, then wait for
  the `Review — <name>` heading (it renders below the roster, so scroll it into
  view). Each part is a table row with a **`Why?`** expander; the crop lives
  inside that, behind a further **`Student's work`** toggle.
- **`Why?` behaves like an accordion** - opening one closes the last. To
  capture several parts, open, screenshot, close, move on. Batch-clicking six
  of them leaves exactly one open.
- Crop images are `img[alt*="Cropped scan region"]`. Assert
  `naturalWidth > 0`, not just presence - a blank frame is the proxy failure
  above, not an empty crop.
- Provenance badges are spans reading **`Paper layout`** (anchor-cut) or
  **`Region set by you`** (teacher redraw).

`scripts/drive-marking.cjs` implements all of this. It takes a test id and
optional part labels and writes screenshots plus a JSON report of each crop's
natural size and badge:

```bash
NODE_PATH=/opt/node22/lib/node_modules NO_PROXY=localhost,127.0.0.1 \
  node .claude/skills/run-app/scripts/drive-marking.cjs \
  --test <testId> --session <session.json> --out <dir> --parts "Q1(c),Q4(a)"
```

**Look at the screenshots.** The report tells you an image decoded; only your
eyes tell you it contains the right part's work. A crop that leads with the
previous part's answer line is expected - regions start slightly high so
drifting handwriting is not clipped.

## 7. When you recompute something the app computes

If you write a script that reclassifies or re-derives what production logic
produces, **import the real module** rather than restating its rules. Copying a
regex list into a script is how the script and the app drift apart, and the
divergence is invisible until it has written wrong data. This is the reason for
the `.mts` + `npx tsx` route in §4.

## 8. Clean up

```bash
pkill -f "next dev"           # returns 143; that is your own signal
node <revoke-session script>  # then delete the session JSON
git status --porcelain        # must be clean
```

The dev server's background task will report exit code 143 - that is the
`pkill`, not a failure.
