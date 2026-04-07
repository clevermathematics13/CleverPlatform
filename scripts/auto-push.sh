#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if ! command -v inotifywait >/dev/null 2>&1; then
    echo "inotifywait is required but not installed." >&2
    exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "This script must be run inside a git repository." >&2
    exit 1
fi

if ! git remote get-url origin >/dev/null 2>&1; then
    echo "Git remote 'origin' is not configured." >&2
    exit 1
fi

branch="${1:-$(git rev-parse --abbrev-ref HEAD)}"
debounce_seconds="${AUTO_PUSH_DEBOUNCE_SECONDS:-2}"
watch_events="close_write,create,delete,move"
exclude_pattern='(^|/)\.git(/|$)'

commit_and_push() {
    if [[ -z "$(git status --porcelain)" ]]; then
        return
    fi

    git add -A

    if git diff --cached --quiet; then
        return
    fi

    timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    git commit -m "chore: auto-sync ${timestamp}"
    git push origin "$branch"
    echo "Pushed auto-sync commit at ${timestamp}"
}

echo "Watching ${repo_root} for changes. Auto-pushing to origin/${branch} after ${debounce_seconds}s of inactivity."

trap 'echo; echo "Stopping auto-push watcher."; exit 0' INT TERM

while true; do
    inotifywait -qq -r -e "$watch_events" --exclude "$exclude_pattern" .

    while inotifywait -qq -t "$debounce_seconds" -r -e "$watch_events" --exclude "$exclude_pattern" .; do
        :
    done

    commit_and_push
done