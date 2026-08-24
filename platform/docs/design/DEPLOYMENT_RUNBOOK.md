# CleverPlatform -- GitHub Push & Deployment Runbook

*This file is a standing reference. Every code deployment session must follow this sequence.*

---

## Standard Deployment Workflow

### Step 1 -- Clone the repo (first action in every session)

```bash
cd /home/claude
git clone --depth 1 https://github.com/clevermathematics13/CleverPlatform.git
cd CleverPlatform
```

> `--depth 1` is sufficient -- full history is never needed for edits.

---

### Step 2 -- Edit files locally

Use `str_replace` or `create_file` on the cloned paths:

```
/home/claude/CleverPlatform/platform/app/...
```

Verify changes are correct before pushing:

```bash
grep -n "KEY_STRING" /home/claude/CleverPlatform/path/to/file.tsx
```

---

### Step 3 -- Push to GitHub

`git push` works, provided the Claude GitHub App is installed for the repository
(https://github.com/apps/claude/installations/select_target). Use it:

```bash
git push -u origin <branch>
```

If the App is not installed, the push 403s with "Claude doesn't have GitHub access
to clevermathematics13/CleverPlatform". Note that `git fetch` and `git clone` keep
working in that state -- the failure is push-only, so "no credentials" is the wrong
diagnosis. `GitHub MCP:push_files` is the fallback, but it can only add and update
files, not delete them, and it mints its own commits, so local SHAs then diverge
from the remote.

---

### Step 4 -- Verify Vercel build

Vercel auto-deploys from `main` on every push. Build time: ~90-110 seconds.

Wait for `readyState: READY` AND `lambdaRuntimeStats` present in `get_deployment`.

Bare `READY` is insufficient -- always confirm `lambdaRuntimeStats`.

---

### Step 5 -- Manual redeploy (if needed)

Use the DEPLOY_SECRET-gated endpoint documented in Vercel env vars.
The secret is stored in Vercel environment variables -- never paste it in code or docs.

---

## Quick Reference

| Item | Value |
|------|-------|
| GitHub repo | `clevermathematics13/CleverPlatform` |
| Branch | `main` |
| Production URL | `https://www.clevermathematics.com` |
| Vercel project ID | `prj_dvN9UGPeAbfHOWctzYam7zuh8QO0` |
| Vercel team ID | `team_EycgR7jYOPiUNuDya32nj9QX` |
| Build time | ~90-110 seconds |

---

## If `git push` Fails

A 403 means the Claude GitHub App is not installed for this repository, not that the
container lacks credentials. Install it at
https://github.com/apps/claude/installations/select_target and retry. The App grants
read+write to code *and* workflows, so files under `.github/workflows/` push fine.

## Multi-file Push Pattern

```python
import os
os.chdir("/home/claude/CleverPlatform")

files_to_push = [
    "platform/app/dashboard/some-component.tsx",
]

file_payloads = []
for path in files_to_push:
    with open(path, 'r') as f:
        file_payloads.append({ "path": path, "content": f.read() })

# Then call: GitHub MCP:push_files with file_payloads
```

---

## Common Failure Modes

| Symptom | Cause | Fix |
|---------|-------|-----|
| `fatal: could not read Username` | `git push` used instead of MCP | Use `GitHub MCP:push_files` |
| Build fails on Vercel | TypeScript error or missing import | Check `get_deployment_build_logs` |
| `create_or_update_file` fails | Missing or stale file SHA | Switch to `push_files` (no SHA required) |
| Deploy shows old code | Push not completed before testing | Wait for `READY` + `lambdaRuntimeStats` |
