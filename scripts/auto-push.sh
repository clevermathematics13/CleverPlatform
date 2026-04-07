#!/usr/bin/env bash
# auto-push — commit & push on every change
#
# Modes
#   poll  (default)  check for changes every --interval seconds
#   watch            react instantly via inotifywait, then debounce
#
# Usage
#   ./scripts/auto-push.sh                          # poll every 30 s
#   ./scripts/auto-push.sh --interval 10            # poll every 10 s
#   ./scripts/auto-push.sh --watch                  # instant, 5 s debounce
#   ./scripts/auto-push.sh --watch --interval 3     # instant, 3 s debounce
#   ./scripts/auto-push.sh --branch dev             # push to a different branch

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

# ── defaults ────────────────────────────────────────────────────
mode="poll"
interval=30
branch=""

# ── parse flags ─────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --watch|-w)    mode="watch";    shift ;;
        --interval|-i) interval="$2";   shift 2 ;;
        --branch|-b)   branch="$2";     shift 2 ;;
        --help|-h)
            sed -n '2,/^$/s/^# //p' "$0"; exit 0 ;;
        *)
            echo "Unknown flag: $1 (try --help)" >&2; exit 1 ;;
    esac
done

branch="${branch:-$(git rev-parse --abbrev-ref HEAD)}"

# ── preflight checks ───────────────────────────────────────────
git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
    || { echo "Not inside a git repository." >&2; exit 1; }
git remote get-url origin >/dev/null 2>&1 \
    || { echo "Git remote 'origin' is not configured." >&2; exit 1; }
if [[ "$mode" == "watch" ]] && ! command -v inotifywait >/dev/null 2>&1; then
    echo "inotifywait not found — falling back to poll mode." >&2
    mode="poll"
fi

# ── commit & push ──────────────────────────────────────────────
commit_and_push() {
    [[ -z "$(git status --porcelain)" ]] && return 0

    git add -A
    git diff --cached --quiet && return 0

    # Build a descriptive message from the staged diff
    local count changed summary msg
    changed="$(git diff --cached --name-status)"
    count="$(echo "$changed" | wc -l)"
    summary="$(echo "$changed" | awk '{print $NF}' | head -3 | paste -sd', ')"

    if [[ "$count" -eq 1 ]]; then
        msg="update ${summary}"
    elif [[ "$count" -le 3 ]]; then
        msg="update ${count} files: ${summary}"
    else
        msg="update ${count} files: ${summary}, ..."
    fi

    git commit -m "$msg"
    git push origin "$branch"
    echo "$(date +%H:%M:%S) ✓ ${msg}"
}

# ── banner ──────────────────────────────────────────────────────
printf '\n  auto-push active\n'
printf '  mode     %s\n' "$mode"
printf '  interval %ss\n' "$interval"
printf '  branch   origin/%s\n' "$branch"
printf '  stop     Ctrl+C\n\n'

trap 'printf "\n  auto-push stopped.\n"; exit 0' INT TERM

# ── main loop ───────────────────────────────────────────────────
if [[ "$mode" == "watch" ]]; then
    exclude='(^|/)\.git(/|$)'
    events="close_write,create,delete,move"
    while true; do
        inotifywait -qq -r -e "$events" --exclude "$exclude" .
        # debounce: keep waiting while edits continue
        while inotifywait -qq -t "$interval" -r -e "$events" --exclude "$exclude" .; do
            :
        done
        commit_and_push
    done
else
    while true; do
        sleep "$interval"
        commit_and_push
    done
fi