#!/usr/bin/env bash
# silver-mem-deploy.sh — 把银芯记忆母版拷贝到黑池内网工作副本
#
# BPT-NEXT Phase D.2 — Black Pool need 4 (internal memory) by inheritance.
#
# 与 silver-mem-install.sh 的区别：
#   silver-mem-install.sh 注册银芯自己的 hook（source == target）
#   silver-mem-deploy.sh  把银芯母版拷贝到另一个工作副本（source != target）
#
# 用法：
#   silver-mem-deploy.sh <black-pool-wc-path>
#   silver-mem-deploy.sh --dry-run <black-pool-wc-path>
#
# 白名单拷贝，不做 `rsync -a memory/` — 避免银芯私有记忆泄漏到黑池。

set -euo pipefail

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
    DRY_RUN=1
    shift
fi

TARGET="${1:-}"

if [[ -z "$TARGET" ]]; then
    cat >&2 <<EOF
usage: silver-mem-deploy.sh [--dry-run] <black-pool-wc-path>

Copies the silver-core memory infrastructure into the target working copy:
  scripts/  — 13 Python modules (MCP server, briefing, writeback, dream, ...)
  .claude/settings.json — SessionEnd / PostToolUse / UserPromptSubmit hooks
  memory/session-digests/ + memory/dreams/ — empty skeleton directories

A dry run prints the actions without touching the filesystem.
EOF
    exit 2
fi

if [[ ! -d "$TARGET" ]]; then
    echo "error: target directory does not exist: $TARGET" >&2
    exit 1
fi

# Resolve silver-core root by script location.
SRC_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# White-listed script set — keep in sync with memory/phase-d-plan.md#D.2.
SILVER_SCRIPTS=(
    "scripts/mcp_server.py"
    "scripts/silver_memory_tools.py"
    "scripts/memory_search.py"
    "scripts/knowledge_graph.py"
    "scripts/fact_store.py"
    "scripts/session_briefing.py"
    "scripts/session_distiller.py"
    "scripts/session_inject.py"
    "scripts/session_reflexion.py"
    "scripts/session_watch.py"
    "scripts/dream.py"
    "scripts/memory_writeback.py"
    "scripts/memrl.py"
    "scripts/context_manager.py"
    "scripts/silver-mem-install.sh"
)

# Python version probe — silver core requires 3.11+.
if command -v python3 >/dev/null 2>&1; then
    PY_VERSION="$(python3 -c 'import sys; print("{}.{}".format(sys.version_info[0], sys.version_info[1]))')"
    PY_MAJOR="${PY_VERSION%%.*}"
    PY_MINOR="${PY_VERSION#*.}"
    if [[ "$PY_MAJOR" -lt 3 ]] || { [[ "$PY_MAJOR" -eq 3 ]] && [[ "$PY_MINOR" -lt 11 ]]; }; then
        echo "warning: python3 is $PY_VERSION; silver-core requires 3.11+" >&2
    fi
else
    echo "warning: python3 not found on PATH; silver-core scripts will not run" >&2
fi

action() {
    # action <description> <cmd...>
    local desc="$1"
    shift
    if [[ "$DRY_RUN" -eq 1 ]]; then
        echo "DRY-RUN: $desc"
        printf '         $ '
        printf '%q ' "$@"
        echo
    else
        echo "$desc"
        "$@"
    fi
}

# 1. Ensure target/scripts/ exists.
action "ensure $TARGET/scripts/ exists" mkdir -p "$TARGET/scripts"

# 2. Copy whitelist scripts.
missing=0
for rel in "${SILVER_SCRIPTS[@]}"; do
    src="$SRC_ROOT/$rel"
    if [[ ! -f "$src" ]]; then
        echo "warning: silver-core source missing: $rel" >&2
        missing=$((missing + 1))
        continue
    fi
    dst="$TARGET/$rel"
    action "copy $rel" cp -f "$src" "$dst"
done

if [[ "$missing" -gt 0 ]]; then
    echo "error: $missing silver-core script(s) missing at source" >&2
    exit 1
fi

# 3. Install .claude/settings.json (register hooks for the target repo).
HOOK_SRC="$SRC_ROOT/.claude/settings.json"
HOOK_DST="$TARGET/.claude/settings.json"
if [[ -f "$HOOK_SRC" ]]; then
    action "ensure $TARGET/.claude/ exists" mkdir -p "$TARGET/.claude"
    if [[ -f "$HOOK_DST" ]]; then
        action "backup existing hook config to $HOOK_DST.bak" cp -f "$HOOK_DST" "$HOOK_DST.bak"
    fi
    action "install SessionEnd/PostToolUse hook config" cp -f "$HOOK_SRC" "$HOOK_DST"
else
    echo "note: no .claude/settings.json in silver core, skipping hook install" >&2
fi

# 4. Create memory/ skeleton directories.
SKELETON_DIRS=(
    "memory/session-digests"
    "memory/dreams"
)
for d in "${SKELETON_DIRS[@]}"; do
    action "ensure $TARGET/$d/ exists" mkdir -p "$TARGET/$d"
done

# 5. Sanity probe — confirm session_briefing.py parses after copy.
if [[ "$DRY_RUN" -eq 0 ]]; then
    if command -v python3 >/dev/null 2>&1; then
        if python3 -c "import ast; ast.parse(open('$TARGET/scripts/session_briefing.py').read())" 2>/dev/null; then
            echo "verify: session_briefing.py parses OK"
        else
            echo "warning: session_briefing.py failed to parse — check silver-core source" >&2
        fi
    fi
fi

echo
echo "Silver core deployed to $TARGET"
echo "Next steps in the target working copy:"
echo "  cd $TARGET"
echo "  python3 scripts/session_briefing.py      # first briefing (may be empty)"
echo "  bash scripts/silver-mem-install.sh       # register local hooks if needed"
