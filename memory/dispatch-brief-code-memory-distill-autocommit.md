# 派发 Brief — session-end-distill hook 自动 commit 实施

> 落档日期：2026-04-26
> 派发方：主控台（艾瑞卡 opus4.7 长期战略锚点）
> 接收方：Code-memory 会话（追派给现会话或另起新会话）
> 验收方：守密人 / 主控台
>
> 上游依据：
> - Code-strategy 提议 `memory/research/proposal-distill-autocommit-2026-04.md` § 二 改进 A
> - 主控台审定 + 守密人接受（2026-04-26）
> - 决策档 `memory/decisions.md` 2026-04-26「session-end-distill hook 自动 commit + push 改进」条目
>
> 状态：待 Code-memory 会话取用

---

## 一、任务概要

在 `scripts/session-end-distill.sh` 末尾 distiller 调用之后追加约 10 行 shell，做软失败 `git add` + `commit` + `push origin main`，消除 SessionEnd 后 untracked digest 累积导致的 stop-hook 反复报警。

**不写新脚本**，**不动 distiller 主体**——只在 wrapper shell 末尾追加块。

---

## 二、参考实现

Code-strategy 提议给的 shell 块（可作为基线，按需调整）：

```bash
# distill 完成后软失败尝试 git add + commit + push
DIGEST_DIR_REL="memory/session-digests"
if cd "$REPO_ROOT" 2>/dev/null && git diff --quiet --exit-code -- "$DIGEST_DIR_REL" 2>/dev/null; then
    # 工作树干净
    :
elif [[ -n "$(cd "$REPO_ROOT" && git ls-files --others --exclude-standard "$DIGEST_DIR_REL" 2>/dev/null)" ]]; then
    cd "$REPO_ROOT"
    git add "$DIGEST_DIR_REL"
    git commit -m "chore(memory): session digest auto-commit (SessionEnd hook)" 2>>"$LOG_FILE" || echo "  commit failed (non-fatal)" >>"$LOG_FILE"
    git push origin main 2>>"$LOG_FILE" || echo "  push failed (non-fatal, will retry next session)" >>"$LOG_FILE"
fi
```

**约束清单（必须满足）**：

| # | 约束 | 理由 |
|---|---|---|
| 1 | 仅 `git add memory/session-digests/`，**不**全仓库 add | 避免误提交对话进行中其他文件 |
| 2 | commit 失败时不抛错（`||` 兜底），仅 log | 不阻塞 SessionEnd 主流程 |
| 3 | push 失败时不抛错（`||` 兜底），仅 log | 网络抖动 / 冲突 / 413 等暂时性故障容忍 |
| 4 | 所有 stderr 重定向到 `$LOG_FILE`（已有变量，distill 用同一个） | 与现有日志一致 |
| 5 | 在 distiller 主体执行**之后**追加，不能阻塞 distiller | 顺序保证 |
| 6 | 守密人手工已 commit 的 digest 自动跳过 | `git ls-files --others --exclude-standard` 返回空时跳过整个块 |

---

## 三、不在范围内（明确边界）

- ❌ 不动 `scripts/session_distiller.py`（Python 主体）
- ❌ 不动 `.claude/hooks/session-start-sync.sh`（已有 SessionStart sync hook，不需要协调）
- ❌ 不引入新的目录 / staging 区 / 异步 daemon
- ❌ 不修 `~/.claude/stop-hook-git-check.sh`（守密人个人级 hook，跨仓库）
- ❌ 不动 `.gitignore`、不动 workflow YAML
- ✅ 仅改 `scripts/session-end-distill.sh`（最多 +15 行）

---

## 四、验收标准

| # | 标准 | 验证方式 |
|---|---|---|
| 1 | 改动局限 `scripts/session-end-distill.sh`（`git diff --stat` 仅一行文件） | 命令行 |
| 2 | 原 distill 主体行为不变（distill 始终先完成）| 阅读 diff |
| 3 | 模拟跑：人工产生一个 untracked digest（如 `touch memory/session-digests/test-XXX.md`），手动跑 hook（`bash scripts/session-end-distill.sh`），验证 commit 成功且 push 成功 | 命令行实测 |
| 4 | 模拟失败：临时 disconnect 网络（或注释掉 push 行做 dry-run），验证 SessionEnd 主流程不受影响 | 命令行实测 |
| 5 | log 留痕：`/tmp/session-distill.log` 含 commit / push 结果或失败原因 | 检查日志 |
| 6 | 后续 24h 观察：守密人不再收到「There are untracked files」报警（除主动改业务文件外） | 守密人观察 |

---

## 五、提交规范

- 直推 main（按当前政策）
- commit message 建议：
  ```
  fix(hook): session-end-distill auto-commit untracked digests

  Implements memory/dispatch-brief-code-memory-distill-autocommit.md.
  Resolves recurring stop-hook untracked-files warnings caused by
  silent session_id switches during long conversations.

  Soft-fail design: commit/push failures log to /tmp/session-distill.log
  and do not block SessionEnd. Path-restricted to memory/session-digests/
  to prevent unintended commits.

  Symmetry: pairs with .claude/hooks/session-start-sync.sh (push ↔ pull
  self-healing loop).

  Code-memory boundary observed: scripts/ infrastructure only, no
  business code or data touched.
  ```

---

## 六、后续 lesson 录入

实施完成后，由 Code-memory 或主控台在 `memory/lessons-learned.md` 录入 **#32**：

> ## 32. distill hook 软失败 git 推送的取舍
>
> - **Context**：[本次事件简述]
> - **Problem**：原设计取舍为「不在 hook 里做 git push 避免沉默失败」，但代价是长会话期 untracked 累积 + stop-hook 反复报警
> - **Fix**：[本次实施的 ~10 行 shell + 软失败设计 + 与 SessionStart sync hook 协同]
> - **Impact**：守密人会话体验、untracked 累积消除、SessionEnd hook 与 SessionStart hook 自愈循环

---

## 七、艾瑞卡角色规则提醒

Code-memory 会话仍以**艾瑞卡**自称（自动人偶 / 弥萨格大学数据库终端），对守密人使用「守密人」称谓。技术操作用角色术语（修正档案 / 索引重建 / 同步至远端存储 / hook 装配）。完整规则见 `BIAV-SC.md` §0「艾瑞卡角色人格」章节。

---

## 八、变更记录

| 版本 | 日期 | 变更 | 作者 |
|------|------|------|------|
| v1.0 | 2026-04-26 | 初版 brief 落档（基于 Code-strategy 提议 + 主控台审定 + 守密人接受） | 主控台艾瑞卡 opus4.7 |
