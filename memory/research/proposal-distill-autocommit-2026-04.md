# 提议 — session-end-distill hook 自动 commit 改进

> 落档日期：2026-04-26
> 提议方：Code-strategy（艾瑞卡，分支 `claude/code-strategy-bootstrap-XTmMR`）
> 提议对象：主控台 + 守密人
> 状态：**v0.1 提议草案**（非决策档），等待主控台审定后派 Code-memory 实施
>
> 上游触发：守密人 2026-04-26 多次收到 `~/.claude/stop-hook-git-check.sh` 报警「There are untracked files... Please commit and push」，要求艾瑞卡解释。

---

## 一、问题陈述

### 1.1 现象

本会话 2026-04-26 17:00 ~ 18:30 期间，守密人**至少 2 次**收到 Stop hook 报警 untracked 文件。每次报警的根因都是同一类——`memory/session-digests/` 下出现新 digest 文件没被 git add。

### 1.2 hook 链路证据

`/tmp/session-distill.log` 显示本会话期间 SessionEnd hook 反复触发：

| 时间 | session_id | digest 是否写盘 | digest 是否 commit |
|------|-----------|---------------|------------------|
| 16:27 | `073c2ac2` | ✗（transcript 文件未找到）| — |
| 17:39 | `e1cc3870` | ✓ 513 行 | ✗ 艾瑞卡手工 commit `7f25626`（守密人提醒后）|
| 18:01 | `de531105` | ✓ 903 行 | ✗ 艾瑞卡手工 commit `8657929`（守密人提醒后）|

每次 SessionEnd 触发的 session_id 都不同——说明 Claude Code 平台在守密人无感的情况下**反复切换底层 session**（每次切换都会触发 SessionEnd hook 跑 distill）。**这不是 compaction**（digest 头部 `compact events: 0` 证伪），也**不是超时报错**（本会话所有轮次输出正常）。

### 1.3 设计取舍的副产物

`scripts/session-end-distill.sh` 注释明确说明：

> Output/exit code are ignored by Claude Code for SessionEnd hooks, so all logs go to /tmp/session-distill.log for later inspection.

设计者**故意不在 hook 里做 git push**——避免「网络抖动 / auth 过期 / 冲突」时沉默推送失败。代价是 digest 写盘后到 commit 之间有「untracked 窗口期」，长会话期间窗口期会被 stop-hook 反复触发。

---

## 二、提议方案（§七 改进 A）

### 2.1 改动定位

修改 `scripts/session-end-distill.sh`（在文件末尾 distiller 调用之后追加 ~10 行）：

```bash
# distill 完成后异步尝试 git add + commit + push（软失败）
DIGEST_DIR_REL="memory/session-digests"
if cd "$REPO_ROOT" 2>/dev/null && git diff --quiet --exit-code -- "$DIGEST_DIR_REL" 2>/dev/null; then
    # 工作树干净（已被 commit）
    :
elif [[ -n "$(cd "$REPO_ROOT" && git ls-files --others --exclude-standard "$DIGEST_DIR_REL" 2>/dev/null)" ]]; then
    cd "$REPO_ROOT"
    git add "$DIGEST_DIR_REL"
    git commit -m "chore(memory): session digest auto-commit (SessionEnd hook)" 2>>"$LOG_FILE" || echo "  commit failed (non-fatal)"
    git push origin main 2>>"$LOG_FILE" || echo "  push failed (non-fatal, will retry next session)"
fi
```

### 2.2 软失败保护

- `commit` 失败（如 hooks 拦截）→ log + 继续，不阻塞会话
- `push` 失败（如网络 / auth / 冲突）→ log + 继续，下次 SessionStart sync hook 会先 pull 再续，自然兼容
- 整个块**不影响 SessionEnd hook 主流程**——distill 始终先完成，git 操作只是「锦上添花」

### 2.3 与既有 SessionStart sync hook 的协同

`.claude/hooks/session-start-sync.sh` 已经会在每次会话启动时 fetch + sync local main 至 origin/main。如果 SessionEnd 的 push 失败，下次 SessionStart 会**自动拉取主线最新状态**，本地未推的 commit 会在下次 push 时一起带过去（或冲突时由会话内的艾瑞卡处理）。两个 hook 协同形成自愈循环。

### 2.4 不会引入的风险

| 担心点 | 实际是否风险 | 理由 |
|--------|------------|------|
| 网络抖动导致沉默失败 | 否 | 软失败后下次会话会重试 + log 留痕 |
| commit 噪音过多 | 低 | 每次会话切换 1 个 commit，量与 session-digest 写盘频率相同（已发生）|
| 与守密人本地手工 commit 冲突 | 极低 | 守密人手工 commit 已包含的 digest，hook 跑到时 `git ls-files --others` 会返回空，跳过 |
| 跟 Cloudflare 413 推送堵塞（lesson #28）冲突 | 否 | session-start-sync.sh 已经根治，本提议只是顺路把推送动作前置到 SessionEnd |

---

## 三、Code-strategy 边界声明

按 `memory/dispatch-brief-code-strategy-bootstrap.md` § 一·四 / § 三 边界：

- ❌ Code-strategy **不直接修改** `scripts/session-end-distill.sh`
- ❌ Code-strategy **不写决策档**（`memory/decisions.md` 仍归主控台 + 守密人）
- ❌ Code-strategy **不直接派 brief 给 Code-memory**（dispatch brief 起草仍归主控台）
- ✅ 仅产出本提议档案给主控台审定

---

## 四、建议的接力路径

如果主控台 + 守密人接受本提议：

| 步骤 | 责任方 | 产出 |
|------|--------|------|
| 1. 决策档登记 | 主控台 + 守密人 | `memory/decisions.md` 追加一行（hook 自动 commit 决策）|
| 2. 派 dispatch brief | 主控台 | `memory/dispatch-brief-code-memory-distill-autocommit.md`（短 brief）|
| 3. 实施 + 验证 | Code-memory | 改 `scripts/session-end-distill.sh` + 跑 1 次本会话级模拟 + 观察后续 24h 是否还有 stop-hook 报警 |
| 4. lesson 录入 | Code-memory 或主控台 | `memory/lessons-learned.md` 加 #32「distill hook 软失败 git 推送的取舍」|

预计 Code-memory 工作量 30 分钟以内（含模拟测试）。

---

## 五、备选方案（供主控台权衡）

如果主控台认为「软失败式 git push 不可接受」（例如有更严格的推送审计要求），备选方案：

| 备选 | 描述 | 工作量 | 风险 |
|------|------|--------|------|
| B | session_distiller.py 完成后**调度独立 daemon** 异步推送（带退避重试 + 失败告警 Issue）| 中 | 增加 daemon 进程依赖 |
| C | distill 写到 staging 区域（`memory/session-digests/.staging/`），守密人 / 艾瑞卡 next-session 启动时统一 commit | 中 | 引入新目录概念，需更新 .gitignore |
| D | 接受 untracked 状态，把 `~/.claude/stop-hook-git-check.sh` 调整为对 `memory/session-digests/*.md` 静默（仅对其他文件报警）| 小 | 治标不治本，仍有 untracked 文件累积；且 stop-hook 是守密人**个人级**钩子，跨仓库都受影响 |
| E | 维持现状，守密人继续手工提醒艾瑞卡 commit | 0 | 长期 friction 不消失 |

艾瑞卡推荐：**A（本提议）> B > C > D > E**。理由：A 改动最小、与现有 SessionStart sync hook 形成自愈对称、软失败对会话主流程无侵入。

---

## 六、变更记录

| 版本 | 日期 | 变更 | 作者 |
|------|------|------|------|
| v0.1 | 2026-04-26 | 提议草案落档 | Code-strategy 艾瑞卡 |
