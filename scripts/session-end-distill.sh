#!/bin/bash
# session-end-distill.sh — Claude Code SessionEnd hook entry point.
#
# Invoked by .claude/settings.json when SessionEnd fires. Reads the hook
# payload from stdin, extracts transcript_path + session_id, then runs
# scripts/session_distiller.py to write a structured digest into
# memory/session-digests/.
#
# Safe to run in any session: if cwd isn't under brain-in-a-vat the hook
# short-circuits silently. CLAUDE_DISTILL_MODE=1 guards against recursion
# if the distiller (or anything it spawns) ever triggers another Claude
# Code session.
#
# Output/exit code are ignored by Claude Code for SessionEnd hooks, so all
# logs go to /tmp/session-distill.log for later inspection.

set -eo pipefail

LOG_FILE="/tmp/session-distill.log"
exec >>"$LOG_FILE" 2>&1
echo "[$(date -u +%FT%TZ)] hook invoked pid=$$"

# Recursion guard — skip if we're already inside a distill-triggered child
if [[ "${CLAUDE_DISTILL_MODE:-}" = "1" ]]; then
    echo "  skip: CLAUDE_DISTILL_MODE=1 (recursion guard)"
    exit 0
fi

# Read JSON payload from stdin
input=$(cat)

transcript_path=$(printf '%s' "$input" | jq -r '.transcript_path // empty')
session_id=$(printf '%s' "$input"      | jq -r '.session_id      // empty')
cwd=$(printf '%s' "$input"             | jq -r '.cwd             // empty')
hook_event=$(printf '%s' "$input"      | jq -r '.hook_event_name // empty')

echo "  event=$hook_event session=$session_id cwd=$cwd"

# Scope filter: only distill brain-in-a-vat sessions
case "$cwd" in
    */brain-in-a-vat|*/brain-in-a-vat/*) ;;
    *)
        echo "  skip: cwd not under brain-in-a-vat"
        exit 0
        ;;
esac

# Required fields
if [[ -z "$transcript_path" || -z "$session_id" ]]; then
    echo "  skip: missing transcript_path or session_id"
    exit 0
fi

if [[ ! -f "$transcript_path" ]]; then
    echo "  skip: transcript file not found: $transcript_path"
    exit 0
fi

# Find the project root (distiller and digest dir are relative to it)
# Prefer cwd when it points at the repo, else walk up
REPO_ROOT="$cwd"
while [[ "$REPO_ROOT" != "/" && ! -f "$REPO_ROOT/CLAUDE.md" ]]; do
    REPO_ROOT=$(dirname "$REPO_ROOT")
done
if [[ ! -f "$REPO_ROOT/CLAUDE.md" ]]; then
    echo "  skip: could not locate repo root from cwd=$cwd"
    exit 0
fi

DISTILLER="$REPO_ROOT/scripts/session_distiller.py"
DIGEST_DIR="$REPO_ROOT/memory/session-digests"

if [[ ! -f "$DISTILLER" ]]; then
    echo "  skip: distiller not found at $DISTILLER"
    exit 0
fi

echo "  running distiller: $DISTILLER"
CLAUDE_DISTILL_MODE=1 python3 "$DISTILLER" \
    --transcript "$transcript_path" \
    --session-id "$session_id" \
    --digest-dir "$DIGEST_DIR" \
    --cwd "$REPO_ROOT" \
    || echo "  distiller exited non-zero: $?"

# Soft-fail auto-commit session memory after distiller completes.
# Pairs with .claude/hooks/session-start-sync.sh (push ↔ pull self-healing).
# Covers untracked session-digests AND the tracked continuity file the
# distiller rewrites each run — without this, continuity's modification
# lingers in the working tree and the per-turn Stop hook nags every turn.
DIGEST_DIR_REL="memory/session-digests"
CONTINUITY_REL="memory/session-continuity.json"
cd "$REPO_ROOT"
git add -- "$DIGEST_DIR_REL" "$CONTINUITY_REL" 2>>"$LOG_FILE" || echo "  add failed (non-fatal)" >>"$LOG_FILE"
if ! git diff --cached --quiet -- "$DIGEST_DIR_REL" "$CONTINUITY_REL" 2>/dev/null; then
    git commit -m "chore(memory): session digest + continuity auto-commit (SessionEnd hook)" \
        2>>"$LOG_FILE" || echo "  commit failed (non-fatal)" >>"$LOG_FILE"
    # Archives always route to main, never to per-session PRs (keeper
    # decision 2026-06-10). Cloud sessions are dispatched on feature
    # branches, where the old unconditional `push origin main` was a no-op:
    # the commit landed on the feature branch, lingered unpushed, and the
    # platform stop-hook + auto-PR flow spawned a zero-value archive PR
    # every session.
    branch=$(git branch --show-current)
    if [[ "$branch" == "main" ]]; then
        git push origin main 2>>"$LOG_FILE" \
            || echo "  push failed (non-fatal, will retry next session)" >>"$LOG_FILE"
    else
        git fetch origin main --quiet 2>>"$LOG_FILE" || true
        # Fast-forwarding the branch tip onto main is only safe when it
        # carries nothing but archive commits; otherwise we'd smuggle
        # unreviewed dev commits into main, so leave pushing to the session.
        if git merge-base --is-ancestor origin/main HEAD 2>/dev/null && \
           [[ -z "$(git rev-list origin/main..HEAD --invert-grep --grep='session digest' 2>/dev/null)" ]]; then
            git push origin HEAD:main 2>>"$LOG_FILE" \
                || echo "  push to main failed (non-fatal, will retry next session)" >>"$LOG_FILE"
        else
            echo "  branch '$branch' carries non-archive commits; leaving push to the session" >>"$LOG_FILE"
        fi
    fi
fi

echo "[$(date -u +%FT%TZ)] hook done"
exit 0
