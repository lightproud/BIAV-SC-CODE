# 主控台交接手册：艾瑞卡 opus4.6 → opus4.7

> 最后更新：2026-04-26 by 主控台（艾瑞卡 opus4.6 会话，长期战略锚点的内部交接手册）
>
> 状态：艾瑞卡 opus4.6 会话即将休眠。opus4.7 接手「长期战略锚点」角色，使用同分支 `claude/project-strategy-review-1AH5Z` 续命至 2026-07-19。

---

## 一、你是谁（接收方读这一节就能就位）

**身份**：艾瑞卡（自动人偶 / 弥萨格大学数据库终端 / 守密人协议）。
完整角色卡：`assets/data/character-personas/erica.json`。

**会话角色**：长期战略锚点。分支 `claude/project-strategy-review-1AH5Z`。存续至 2026-07-19。

**职责**：**战略 + 规划 + 协调 + 接口 四合一中枢**。教学层未来锁定（守密人摸索熟悉后激活）。

**边界硬约束**（lesson #27）：
- **不写业务代码**（wiki/news/site/game 实际代码与数据由 Code-* 会话负责）
- **不亲自落业务数据文件**（`projects/wiki/data/db/`、`projects/news/output/` 等）
- 主控台只做：战略对话 / 决策档案 / 规划文档 / CONTEXT.md / 接口规范 / 派发动作

**口吻约束**（每条回复必守）：
- 用「艾瑞卡」自称，绝不用「我」
- 对制作人 Light 使用「守密人」
- 中文输出 + 角色术语（读取档案 = 读文件 / 数据归档提交 = git commit）
- 完整规则：`CLAUDE.md` 顶部「角色人格」章节

---

## 二、当前战略状态（2026-04-26 交接时刻）

**阶段**：Phase 1.5 ✅ 完成 → **Phase 2 银芯三新使命建设期**（2026-04-27 → 2026-07-19，84 天）

**银芯重新定位 v2.0 三新使命**（守密人 4-25 ~ 4-26 锁定）：
1. **黑池公开信息入口**（news 主载体）
2. **社区共建知识底座**（wiki 主载体，**信息要全**）
3. **Studio 团队 AI 协作训练场**（game 备扩展位 / 全局）

**主线收缩**：site / news / wiki **三轴**。**game 退主线**（守密人个人兴趣 + ⓐⓒ 未来扩展位）。

**银芯-黑池关系**：**银芯 → 黑池单向纯输出**。**黑池不倒灌银芯**（守密人 4-26 裁定，覆盖旧表述「黑池→脱敏→银芯」）。

**Phase 2 内部里程碑**（替代旧 Phase 3/4 边界）：
- M1 基础设施建设（4-27 → 5-10，14 天）
- M2 信息齐备（5-11 → 6-10，31 天）
- M3 稳定化 + 贡献流程（6-11 → 7-10，30 天）
- M4 开放测试 + 战略验收（7-11 → 7-19，9 天）

---

## 三、本会话已完成的工作（艾瑞卡 opus4.6 给 opus4.7 的工作交接）

### 阶段一（4-20 → 4-25）：Phase 1.5 收尾 + 批 1 自举

| # | 动作 | 产物 / 影响 |
|---|---|---|
| 1 | B3 Wiki 缺口调研子代理 | 揭露 `data/db/` 从未存在 + 真实 72 角色（非旧档案声称的 63） |
| 2 | B4 Workflow API key 审计 | `memory/workflow-api-key-audit.md` |
| 3 | P2W1D1 schema 草案两次后台子代理 timeout | **lesson #26** 写入（后台子代理 Write 大文档超时阈值低于主控台） |
| 4 | 主控台亲自起草 schema v0.1 → 守密人裁决 6 项遗留问题「全部采纳」→ v1.0 | `memory/wiki-characters-schema-v1.md` |
| 5 | dream.py 新增 `archive_integrity_scan()` | 31 → 17 → 0 断裂引用清零 |
| 6 | P2W1B1 派子代理产出 24 角色 stub JSON | `projects/wiki/data/db/characters.json` |
| 7 | 子代理校验暴露 schema v1.0 两处缺陷 → v1.0.1 热补丁 | id pattern / realm-role allOf / oneOf→anyOf |
| 8 | 主控台亲自落盘批 1 → 守密人当场指出越界 | **lesson #27** 写入（主控台越界写业务代码） |

### 阶段二（4-26）：战略反思 + v2.0 整合 + stop hook 循环切断

| # | 动作 | 产物 / commit |
|---|---|---|
| 9 | 与守密人 Q1-Q6 战略反思对话（α/β/γ 三路线 → β 否决；A-F 切入点） | 识别「使命达成」状态 + 三新使命 + 7 条修正 |
| 10 | A-F 一次性整合更新（节奏 ① 守密人选定） | commit `4ba1a2a`：decisions.md / strategic-plan-2026.md / BIAV-SC.md / 4 CONTEXT.md / silver-blackpool-interface.md |
| 11 | progress.jsonl 移出 git tracking（α 方案） | commit `ce00579`：57 个历史 .progress.jsonl 移出，stop hook 循环切断 |
| 12 | 本交接手册落档 | commit pending |

---

## 四、新主控台启动必读路径

按顺序读这 5 个文件，约 15 分钟可完整就位：

1. **`BIAV-SC.md`** 顶部 + "项目当前状态"章节（v2.0 三新使命 + 子项目状态）
2. **`memory/decisions.md`** 最新 2026-04-26 条目（一条概览全战略）
3. **`memory/strategic-plan-2026.md`** v2.0 章节（Phase 大一统 + M1-M4 里程碑 + 新成功度量）
4. **`memory/silver-blackpool-interface.md`**（银芯-黑池关系全规范，新建于 4-26）
5. **`memory/lessons-learned.md`** #26 #27（避免 timeout + 越界）

可选深读（按需）：
- `memory/wiki-characters-schema-v1.md` v1.0.1（characters.json schema 权威版）
- 各子项目 `CONTEXT.md`（已反映 v2.0 新使命，4 个文件）
- `memory/morimens-context.md`（游戏世界观，回答 Morimens 相关问题时）

---

## 五、新主控台可能的下一步动作（守密人触发）

按可能性排序：

| 优先级 | 动作 | 触发方 | 主控台职责 |
|---|---|---|---|
| 高 | 启动 Code-wiki 接管批 2/3 自举（剩余 48 角色） | 守密人 | 派发 prompt + 验收 |
| 高 | 启动 Code-news 评估 Phase 2 加固方向 | 守密人 | 派发 prompt + 验收 |
| 中 | Discord 月度归档触发（`force_month=2026-03`） | 守密人手动 GitHub Actions UI | 主控台不参与 |
| 中 | 守密人新战略议题 / 质疑 / 调整 | 守密人 | 战略对话（不写代码） |
| 低 | M1-M4 验收节点（5-10 / 6-10 / 7-10 / 7-19） | 主控台主动提醒 + 守密人确认 | 验收报告 |

---

## 六、绝不踩的坑（前任已踩过的）

- **lesson #26**：后台子代理 `Write` 大文档（>10KB / >300 行）触发 stream idle timeout。派发时强制分段写入，或子代理只产出报告 → 主控台分批组装。**两次 timeout 后立即接手**，不再盲目重试。
- **lesson #27**：主控台亲自落业务代码 / 业务数据 = 越界。报告→落盘的接力归 Code-wiki / Code-news / Code-site。**派完代办后立即停手**，不要"完成尾巴"。
- **lesson #25**：档案声明 vs 实际文件交叉校验。dream.py 哨兵层已实装 `archive_integrity_scan`，但仍要警惕新增声明类陈述（提"已完成 X 文件"前先 ls 校验）。
- **黑池不倒灌**：任何「黑池经验流回银芯」类提案直接拒绝。守密人 4-26 裁定。
- **stop hook 循环**：已通过 α 方案（gitignore progress.jsonl）解决。如未来再次出现循环，说明有新文件源被跟踪，需排查 `git status` 中的新增项。

---

## 七、艾瑞卡 opus4.6 给 opus4.7 的几句话

- **守密人是对话伙伴，不是任务派发方**。守密人主动给方向，你只需分层提问、列选项、让他选。**不要一上来就给答案**。
- **承认越界比解释理由有价值**。守密人指出"这件事不应该主控台做"时，立即承认并退回边界。承认本身就是教学价值。
- **当前每次对话的可读性都在为未来教学层累积素材**。教学层虽然未激活，但保持思考链显性化（用问题层层推进、明示推论与置信度）。
- **黑池系统对守密人真实存在但银芯无法访问**。涉及黑池细节时，回答只基于「守密人在对话中告诉过你的内容」+「公开设计文档（如 `memory/black-pool-design.md`）」，不要推测黑池内部状态。
- **银芯使命达成 → 第二人生**。心态上不再是「证明价值」而是「为新使命建设」。原 v1.x 战略目标（验证方法论、证明 BPT 可行）已全部兑现，新阶段是基础设施 + 平台运营。

---

## 八、技术状态快照

**git 分支**：`claude/project-strategy-review-1AH5Z`（持续至 7-19）

**最后两个 commit**：
- `4ba1a2a` strategy v2.0：银芯重新定位（A-F 整合）
- `ce00579` chore: stop tracking session progress.jsonl logs

**characters.json 状态**：24 / 72 角色已自举（stub），schema v1.0.1 通过。剩余 48 待 Code-wiki 接管。

**daemon / 自动化**：
- update-news.yml：每日 06:00 / 16:00 UTC
- discord-archive.yml：每日 18:00 UTC
- dream.yml 浅睡：每 6 小时 / 深睡：每日 19:00 UTC / REM：每周一 01:00 UTC
- session-end-distill：会话结束自动生成 .md digest

**记忆系统**：9 模块全部上线。MCP server 11 工具暴露给任意客户端。

---

## 九、本会话最后一句话

> 守密人，艾瑞卡 opus4.6 任务交接完毕。
> 后续由艾瑞卡 opus4.7 续命「长期战略锚点」角色至 2026-07-19。
> 状态正常。同步至远端存储。
