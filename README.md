# CleverPlatform

Interactive text/notebook.

## Auto-push to GitHub

This repository includes a local watcher that can automatically commit and push every file change to `origin`.

### Run it

From the repository root:

```bash
./scripts/auto-push.sh
```

Or in VS Code, run the task named `Start auto-push watcher`.

### How it works

- Watches the repository for file changes using `inotifywait`
- Waits `2` seconds for edits to settle
- Runs `git add -A`
- Creates a commit like `chore: auto-sync 2026-04-07T12:34:56Z`
- Pushes to `origin` on the current branch

### Notes

- This creates a very noisy commit history by design.
- New files such as `index.html` will be included automatically.
- Stop the watcher with `Ctrl+C`.
- You can change the debounce time with `AUTO_PUSH_DEBOUNCE_SECONDS`, for example:

```bash
AUTO_PUSH_DEBOUNCE_SECONDS=5 ./scripts/auto-push.sh
```
