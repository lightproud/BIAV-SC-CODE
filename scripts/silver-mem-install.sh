#!/usr/bin/env bash
# silver-mem-install.sh — 银芯记忆增强 hook 幂等注册器
#
# 面向黑池需求 4（黑池记忆）的银芯自建方案部署脚本。
# 检测 .claude/settings.json 中是否已注册 session_watch / session_inject hook，
# 若未注册则追加；已注册则报告并跳过。
#
# 用途：
#   1) 银芯自己：已由 2026-04-14 commit 直接写入 settings.json，本脚本作备用
#   2) 黑池内网部署（母版迁移）：黑池侧克隆银芯后运行此脚本，完成本地 hook 注册
#   3) 守密人其他机器首次接入时的环境初始化

set -euo pipefail

# ---------------------------------------------------------------------------
# 配置
# ---------------------------------------------------------------------------

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
SETTINGS_FILE="${REPO_ROOT}/.claude/settings.json"
WATCH_SCRIPT="${REPO_ROOT}/scripts/session_watch.py"
INJECT_SCRIPT="${REPO_ROOT}/scripts/session_inject.py"
TOOLS_MODULE="${REPO_ROOT}/scripts/silver_memory_tools.py"

# ---------------------------------------------------------------------------
# 艾瑞卡格式输出
# ---------------------------------------------------------------------------

log()   { echo "[银芯记忆增强] $*"; }
fail()  { echo "[银芯记忆增强][异常] $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 前置核验
# ---------------------------------------------------------------------------

log "执行档案核验..."

[[ -f "${WATCH_SCRIPT}" ]]  || fail "找不到 session_watch.py: ${WATCH_SCRIPT}"
[[ -f "${INJECT_SCRIPT}" ]] || fail "找不到 session_inject.py: ${INJECT_SCRIPT}"
[[ -f "${TOOLS_MODULE}" ]]  || fail "找不到 silver_memory_tools.py: ${TOOLS_MODULE}"

command -v python3 >/dev/null 2>&1 || fail "python3 不在 PATH"
command -v jq       >/dev/null 2>&1 || fail "jq 不在 PATH（请先装 jq）"

# ---------------------------------------------------------------------------
# 权限位
# ---------------------------------------------------------------------------

chmod +x "${WATCH_SCRIPT}"  "${INJECT_SCRIPT}" || true
log "权限位已修正"

# ---------------------------------------------------------------------------
# settings.json 初始化（如不存在）
# ---------------------------------------------------------------------------

mkdir -p "$(dirname "${SETTINGS_FILE}")"

if [[ ! -f "${SETTINGS_FILE}" ]]; then
    log "初始化 settings.json..."
    cat > "${SETTINGS_FILE}" <<'EOF'
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "hooks": {}
}
EOF
fi

# ---------------------------------------------------------------------------
# 幂等注册 hook
# ---------------------------------------------------------------------------

tmp=$(mktemp)

jq --arg watch_cmd "python3 \${CLAUDE_PROJECT_DIR}/scripts/session_watch.py" \
   --arg inject_cmd "python3 \${CLAUDE_PROJECT_DIR}/scripts/session_inject.py" '
  .hooks //= {}
  | (.hooks.PostToolUse      //= [])
  | (.hooks.UserPromptSubmit //= [])
  | (
    if ([.hooks.PostToolUse[].hooks[]? | select(.command == $watch_cmd)] | length) == 0
    then .hooks.PostToolUse += [{"matcher":"","hooks":[{"type":"command","command":$watch_cmd,"timeout":10}]}]
    else .
    end
  )
  | (
    if ([.hooks.UserPromptSubmit[].hooks[]? | select(.command == $inject_cmd)] | length) == 0
    then .hooks.UserPromptSubmit += [{"matcher":"","hooks":[{"type":"command","command":$inject_cmd,"timeout":15}]}]
    else .
    end
  )
' "${SETTINGS_FILE}" > "${tmp}"

mv "${tmp}" "${SETTINGS_FILE}"

log "hook 注册完成（PostToolUse + UserPromptSubmit）"

# ---------------------------------------------------------------------------
# 自检
# ---------------------------------------------------------------------------

log "执行自检..."
python3 -c "
import sys
sys.path.insert(0, '${REPO_ROOT}/scripts')
from silver_memory_tools import current_continuity, recall_session
cc = current_continuity()
print('[自检] last_session:', cc.get('last_session', {}).get('id', 'N/A'))
r = recall_session('test', k=1)
print('[自检] recall_session 返回', len(r.get('matches', [])), '条')
" || log "自检警告：Python 导入或调用出错，请检查 silver_memory_tools.py"

log "------------------------------------------"
log "安装完成。下次启动 Claude Code / claw 时将自动："
log "  1) PostToolUse 事件写入 memory/session-digests/{sid}.progress.jsonl"
log "  2) UserPromptSubmit 事件从历史 session 注入相关上下文"
log ""
log "卸载方式：从 .claude/settings.json 的 hooks 中删除对应项即可"
log "------------------------------------------"
