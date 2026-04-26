#!/bin/bash
# session-start-sync.sh — SessionStart hook for brain-in-a-vat.
#
# Auto-syncs local main with origin/main at session start to prevent
# accumulated divergence. Stale sessions tend to leave unpushed commits
# on local main (session digests, parallel merges); when these pile up
# the resulting pack exceeds Cloudflare's request size limit and pushes
# fail with HTTP 413, blocking all subsequent work.
#
# Policy:
#   - fast-forward main to origin/main when only behind
#   - hard-reset main to origin/main when ahead/diverged, but back up
#     the prior tip to refs/backup/main-pre-sync-<timestamp> first
#   - never touch the currently checked-out feature branch
#
# Logs to /tmp/session-start-sync.log. Exits 0 on any non-fatal error
# (no remote, fetch failure, etc.) so a missing network never blocks
# session startup.

set -euo pipefail

LOG_FILE="/tmp/session-start-sync.log"
exec >>"$LOG_FILE" 2>&1
echo "[$(date -u +%FT%TZ)] session-start-sync invoked pid=$$"

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

if ! git rev-parse --git-dir >/dev/null 2>&1; then
    echo "  skip: not a git repo"
    exit 0
fi

if [[ -z "$(git remote)" ]]; then
    echo "  skip: no remote configured"
    exit 0
fi

if ! git fetch origin main --quiet 2>&1; then
    echo "  skip: fetch failed (offline?)"
    exit 0
fi

ahead=$(git rev-list origin/main..main --count 2>/dev/null || echo "0")
behind=$(git rev-list main..origin/main --count 2>/dev/null || echo "0")
echo "  local main vs origin/main: ahead=$ahead behind=$behind"

if [[ "$ahead" -eq 0 && "$behind" -eq 0 ]]; then
    echo "  in sync, nothing to do"
    exit 0
fi

current_branch=$(git branch --show-current 2>/dev/null || echo "")
echo "  current branch: ${current_branch:-<detached>}"

if [[ "$ahead" -gt 0 ]]; then
    stamp=$(date -u +%Y%m%d-%H%M%S)
    backup_ref="refs/backup/main-pre-sync-$stamp"
    git update-ref "$backup_ref" main
    echo "  backed up local main ($ahead ahead commits) to $backup_ref"
fi

if [[ "$current_branch" == "main" ]]; then
    git reset --hard origin/main
    echo "  hard-reset main (was checked out)"
else
    git update-ref refs/heads/main refs/remotes/origin/main
    echo "  updated main ref to origin/main (was on $current_branch)"
fi

echo "[$(date -u +%FT%TZ)] session-start-sync done"
exit 0
