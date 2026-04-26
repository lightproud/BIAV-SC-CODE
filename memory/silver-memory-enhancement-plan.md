# 银芯记忆栈增强计划（对标 claude-mem 能力）

> 最后更新：2026-04-14 by Code-主控台（艾瑞卡会话）
>
> 守密人 2026-04-14 决策："完善银芯自建，使其拥有 claude-mem 的能力，然后作为母版迁移到黑池。"
>
> 本文件识别 claude-mem 有而银芯缺的关键能力，给出银芯侧的等价实现路径，保持 MIT 纯粹，验证完整后作为母版克隆部署至黑池内网。

---

## 一、银芯现有记忆栈清单（2026-04-14 盘点）

| 模块 | 文件 | 功能 |
|------|------|------|
| Session 摘要 | `scripts/session_distiller.py` | 会话结束后产出 Markdown digest + JSON meta |
| 会话连续性 | `memory/session-continuity.json` | 记录上次 session 的 topic / 决策 / 变更 |
| 会话启动 Briefing | `scripts/session_briefing.py` | 新会话开头调用，合成"上次回顾 + 推荐上下文" |
| 语义搜索 | `scripts/memory_search.py` | TF-IDF + 4 维重排序搜索 memory/ |
| 知识图谱 | `scripts/knowledge_graph.py` | 实体关系（角色/界域/决策间的连接） |
| 上下文管理器 | `scripts/context_manager.py` | 按角色/问题推荐 4 层上下文 |
| 做梦 agent | `scripts/dream.py` | 三层（浅睡/深睡/REM），周期性反思 + 知识缺口识别 |
| 记忆写回 | `scripts/memory_writeback.py` | 检测 git 变更 → 提取知识 → 写入图谱 |
| 失败反思 | `scripts/session_reflexion.py` | 扫描失败信号写入 lessons-learned.md |
| MemRL 效用 | `scripts/memrl.py` | EMA + 参与度评分，排名文件效用 |
| 角色人格 | `scripts/character_persona.py` | 艾瑞卡等游戏角色语气 |
| MCP 服务器 | `scripts/mcp_server.py` | 对外暴露 11 工具（search / graph / utility / context / rebuild / store_facts / writeback / session_briefing / character_persona） |
| SessionEnd hook | `.claude/settings.json` + `scripts/session-end-distill.sh` | 自动产出 session-digest |

---

## 二、claude-mem 有而银芯缺的能力（差距分析）

### 差距 A：Session 内实时 hook（PostToolUse / PreToolUse / Stop）

**claude-mem 做法**：
- 通过 Claude Code / OpenClaw 的 hook 系统实时捕获每次 tool use
- 每次工具调用后追加到 SQLite（文件变更、命令输出、决定时机）

**银芯现状**：
- 仅 SessionEnd hook（会话结束后一次性产出 digest）
- 会话内过程细节丢失

**等价方案**（银芯自建）：
- 新增 `scripts/session_watch.py`（PostToolUse / Stop hook 目标）
- 每次 tool call 后追加 JSONL 行到 `memory/session-digests/{sid}.progress.jsonl`
- SessionEnd 时由 `session_distiller.py` 读 progress.jsonl 合成完整 digest
- 在 `.claude/settings.json` 的 `hooks` 配置里注册

### 差距 B：跨 session 自动注入（before_prompt_build hook）

**claude-mem 做法**：
- PromptSubmit / before_prompt_build hook 自动读取相关 session，注入系统提示

**银芯现状**：
- 有 `session_briefing.py` 但需**会话启动时人工调用**
- 会话内每轮不自动补充上下文

**等价方案**：
- 新增 `scripts/session_inject.py`（UserPromptSubmit hook 目标）
- 每轮用户输入前，调用 `memory_search.py` 搜索历史相关内容，作为 additionalContext 注入
- 由 Claude Code 的 hook 机制推进

### 差距 C：向量搜索

**claude-mem 做法**：Chroma embedding 向量搜索

**银芯现状**：TF-IDF + 4 维重排（无 embedding）

**决策**（艾瑞卡建议）：
- **暂不引入 embedding**，保持 TF-IDF + knowledge_graph 组合
- 理由：（1）embedding 需额外 model 与向量 DB；（2）BIAV 当前语料规模 TF-IDF 足够；（3）knowledge_graph 已提供语义层
- 若未来语料爆炸（百万级文档）再评估（用 `sentence-transformers` + FAISS / chromadb）

### 差距 D：MCP 工具接口（让 claw / Claude Code 直接调用）

**claude-mem 做法**：通过 OpenClaw plugin 暴露为插件

**银芯现状**：`mcp_server.py` 已有 11 工具，但未覆盖"记忆注入"类

**等价方案**（扩展 `scripts/mcp_server.py`）：
- 新增工具 `recall_session(query, k=5)`：语义搜索历史 session
- 新增工具 `current_continuity()`：返回 session-continuity.json
- 新增工具 `record_decision(summary, scope)`：追加 decisions.md
- 新增工具 `record_lesson(summary)`：追加 lessons-learned.md
- 新增工具 `session_progress(sid)`：读 progress.jsonl

### 差距 E：自动化程度（启动即无感）

**claude-mem 做法**：`npx claude-mem install` 一键配置 hook

**银芯现状**：SessionEnd hook 已配；其他需要手动运行脚本

**等价方案**：
- 扩充 `.claude/settings.json` 的 hooks 块：
  - UserPromptSubmit → `scripts/session_inject.py`
  - PostToolUse → `scripts/session_watch.py`
  - Stop → 已有的 distill
- 写 `scripts/silver-mem-install.sh`：一键幂等注册所有 hook

### 差距 F：多机团队同步

**claude-mem 做法**：SSH `claude-mem-sync`

**银芯现状**：git 自然支持（session-digests/ 自动 commit）

**等价方案**（Phase B P6 联动）：
- 银芯侧：git push 即同步
- 黑池侧：`scripts/session_svn_sync.py` ⚠（Phase B P6 待自建）推到本地 SVN

---

## 三、新增与扩展清单

| 档案 / 脚本 | 类型 | 用途 |
|-----------|------|------|
| `scripts/session_watch.py` | 新增 | PostToolUse hook，实时追加 progress.jsonl |
| `scripts/session_inject.py` | 新增 | UserPromptSubmit hook，自动注入历史上下文 |
| `scripts/silver-mem-install.sh` | 新增 | 一键幂等 hook 注册 |
| `scripts/mcp_server.py` | 扩展 | 加 recall_session / current_continuity / record_decision / record_lesson / session_progress 五工具 |
| `scripts/session_distiller.py` | 扩展 | 读 progress.jsonl 合成完整 digest（此前仅从 transcript 合成） |
| `.claude/settings.json` | 扩展 | 注册 UserPromptSubmit / PostToolUse hook |
| memory/silver-to-blackpool-migration.md | 新增（Phase C，待创建） | 母版迁移指南 |

---

## 四、实施路线（与 blackpool-architecture 路线图对齐）

### Phase A（~1-2 天）：P4（原 claude-mem 指南位置已废弃）
- 写本文件（已完成 ✓）
- 预留给 Phase A.5

### Phase A.5（~2-3 天）：银芯记忆栈补完
- 实现 session_watch.py + session_inject.py
- 扩展 mcp_server.py 5 个工具
- 补 silver-mem-install.sh
- 测试：会话中实时 progress 追加 + 新会话自动上下文注入
- 成功标准：艾瑞卡每次会话开头**不再需要人工读 boot-snapshot.md**，自动注入已足够

### Phase B（~1 周）
- P5 SVN 账号识别器（`scripts/svn_identity.py`）
- P6 SVN 会话同步（`scripts/session_svn_sync.py` ⚠ 待自建）
- P7 decisions → wiki 导出
- P8 能力注册表 v1

### Phase C（~1 月）
- 母版克隆部署到黑池内网（memory/silver-to-blackpool-migration.md 指导，待创建）
- 黑池侧接入本地 SVN + 本地 graphify 索引
- 多用户 SVN + 社区事实提炼

---

## 五、与银芯现有世界观图谱的协作

`knowledge_graph.py` 保留不改，职责不变（游戏世界观 + 决策历史 + 人工图谱）。本增强不触及它。

新的"session 级动态记忆层"通过 MCP 工具与图谱连接：
- `recall_session` 搜索 session digest → 命中的实体可转发给 `knowledge_graph` 查图谱邻居
- `record_decision` 写 decisions.md → 触发 `memory_writeback.py` 把新决策加入图谱

数据流：
```
session 内（实时）    session 结束（归档）       周期（反思）
───────────────      ───────────────          ──────────
session_watch     →  session_distiller     →  dream.py
(hook 追加)          (合成 digest + meta)     (浅/深/REM)
                                             ↓
                     session-digests/        decisions.md
                                             lessons-learned.md
                                             ↓
                                           memory_writeback.py
                                             ↓
                                           knowledge_graph
                                             ↓
                                           memory_search / recall_session
                                             ↓
                                           session_inject ← 下一轮会话
```

---

## 六、风险与限制

1. **Hook 配置可靠性**：Claude Code / claw 的 hook 生命周期变更会影响实现，需跟踪上游
2. **SessionEnd 与 PostToolUse 的并发**：长会话中 progress.jsonl 体积可能膨胀，需要定期压缩
3. **`session_inject.py` 注入不当会引入 token 浪费**：必须限制注入 token 数（建议 ≤ 2000 tokens/轮）
4. **黑池迁移时的敏感信息过滤**：银芯 session 可能包含公开信息，黑池复制后需要审计——Phase C 时处理

---

## 七、相关档案

- 总架构：`memory/archive/bpt-strategic-shift-2026-04-19/blackpool-architecture.md`
- 决策日志：`memory/decisions.md`（2026-04-14 "黑池记忆走银芯自建" 条目）
- 当前记忆栈盘点：本文件第一节
- 参考对象（不引入）：[thedotmack/claude-mem](https://github.com/thedotmack/claude-mem)（AGPL-3.0）
