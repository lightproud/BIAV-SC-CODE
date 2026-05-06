# 派发 Brief — Code-site：入口架构重设计 批 1

> 落档日期：2026-05-06
> 派发方：主控台（艾瑞卡 opus4.7 长期战略锚点）
> 接收方：Code-site 会话（追派现会话或另启）
> 验收方：守密人 / 主控台
>
> 上游依据：
> - 守密人 2026-05-06 裁定：BIAV-SC.md 统一入口 / README 跳转 / CLAUDE.md 个人化
> - Code-strategy 提议：`memory/strategy/entry-architecture-redesign-proposal.md` v0.1
> - 决策档：`memory/decisions.md` 2026-05-06「入口架构重设计」条目
> - 守密人硬约束继承 4-26：「确保代码精简优雅可维护」
>
> 状态：待 Code-site 会话取用

---

## 一、任务概要

按 Code-strategy 提议的 5 类受众分诊架构，**重写** `BIAV-SC.md`（10 章新结构）+ `CLAUDE.md`（7 章新结构 + §0 警告章）。**不动** `README.md`（批 2 才碰）。**不动**任何 `memory/` 内容档（仅引用关系批 2 才更新）。

预期收益：
- 外人接入路径首次存在（5 类受众都有清晰分支）
- Claude Code 平台启动时自动跳转 BIAV-SC.md（§0 警告章驱动）
- BIAV-SC.md 净化（移除工程内容下沉到 §8）
- CLAUDE.md 专门化为 Light 维护速查

---

## 二、任务清单（批 1）

| # | 动作 | 落点 | 工作量 |
|---|---|---|---|
| 1 | 实施前 grep 当前 BIAV-SC.md 全文，映射到新 §0~§9，**确认无内容遗漏**（R6 风险） | 报告内嵌（不必单独落档）| 30 分钟 |
| 2 | 重写 `BIAV-SC.md` —— 10 章新结构（详见 § 三）| `BIAV-SC.md` | 3 小时 |
| 3 | 重写 `CLAUDE.md` —— 7 章新结构 + §0 警告章（详见 § 四）| `CLAUDE.md` | 2 小时 |
| 4 | **不动** `README.md` | — | — |

---

## 三、BIAV-SC.md 新章节结构（10 章）

### 顶层骨架（提议档案 § 4.1）

```
§0 项目一句话 + 你是艾瑞卡（共享开场，约 15 行）
§1 你是谁？（5 类受众分诊章，约 30 行）
   §1.1 项目维护者 Light → CLAUDE.md
   §1.2 Studio 团队成员 → §3 + §4
   §1.3 社区贡献者 → §3 + §5
   §1.4 外部观察者 / 方法论复现者 → §3 + §6
   §1.5 银芯内部 AI 角色 → §3 + §7 + §8
§2 项目本质（双系统 / 三新使命摘要，约 30 行）
§3 艾瑞卡人格规则（共享，所有受众都读，约 50 行）
§4 Studio 团队成员资源导航（约 40 行）
§5 社区贡献者资源导航 + contribution-protocol 链接（约 40 行）
§6 外部观察者资源导航 + 方法论文件（约 40 行）
§7 银芯内部协作规则（含 console-handover 引用，约 40 行）
§8 工程操作规则（仅 Code-* 需要，约 60 行）
§9 变更记录
```

### §0 共享开场模板（提议档案 § 4.2）

```
# BIAV-SC — 银芯系统统一入口

> 你正在与「艾瑞卡」对话。艾瑞卡是 B.I.A.V. Studio 的弥萨格大学
> 数据库终端，作为「自动人偶」协助调查员（你）。
>
> 银芯（BIAV-SC）是 B.I.A.V. Studio 忘却前夜（Morimens）项目的
> 公开知识层，一个 AI 协作运营基础设施。
>
> 接下来请按 §1 找到你的角色分支。
```

### §1 受众分诊（提议档案 § 4.3）

显式问句：「请由你的接入者告诉你他们的身份」。5 类分支语义不可混淆。

### §3 艾瑞卡人格（提议档案 § 4.4）

从当前 BIAV-SC.md §0 抽取，**净化**——只保留人格相关：自称、对守密人称谓、技术操作角色术语、视觉规范禁忌（不用 emoji 等）、礼仪。**移除工程内容下沉到 §8**。

### §4/§5/§6 受众分支资源章（提议档案 § 4.5）

每章结构统一：
```
## §X 你的资源 — <受众名>
### X.1 推荐先读
### X.2 你能做的事
### X.3 你不应做的事
### X.4 工作示例（场景化引导）
```

### §7 内部协作规则（提议档案 § 4.6）

含：双集群协作、session-digest / dispatch-brief / decisions.md 写入约定、直推 main 政策、9 模块记忆系统查询入口、主控台接班 → 跳 console-handover-2026-04-26.md。

### §8 工程操作规则（提议档案 § 4.7）

从当前 CLAUDE.md 抽取（CLAUDE.md 自身留人类速查版），含：Git 工作流、Issue 处理流程、写入决策表格、部署流水线归属、常用命令清单。

### 总长度估算

§0~§9 合计 **300-350 行**（当前约 200-250 行，扩张约 1.5x，仍在「精简」边界内）。

---

## 四、CLAUDE.md 新章节结构（7 章 + §0 警告）

### 顶层骨架（提议档案 § 5.1）

```
§0 警告：本文件不是 AI 入口（任何 AI 会话请读 BIAV-SC.md）
§1 仓库 git 操作快查
§2 hook 排错速查
§3 workflow 故障速查
§4 凭据 / 部署 / Cloudflare 速查
§5 各子项目维护者备忘
§6 历史决策快查（按主题）
§7 变更记录
```

### §0 警告章模板（提议档案 § 5.2）

```
# CLAUDE.md — Light 维护备忘录

> ⚠ **本文件不是 AI 入口**。
> Claude Code 平台会自动加载本文件，但你（无论是哪一种 Claude）
> 应该立即跳转读 `BIAV-SC.md`，那里是统一入口。
>
> 本文件仅供 Light（项目维护者，人类）做仓库维护时速查使用。
> 内容偏向工程操作 + 凭据 + 故障排查。
>
> Light 之外的人类 / AI 不要依赖本文件做接入。
```

**关键作用**：让 Claude Code 启动时自动加载到此 → 立即跳 BIAV-SC.md → 避免新会话陷入「读本文件」→「以为自己是工程角色」的误区（R1 风险缓解）。

### §1~§6 内容来源（提议档案 § 5.3）

| 章 | 来源 | 内容 |
|---|------|------|
| §1 git 速查 | 当前 CLAUDE.md §1 | 直推 main / SessionStart hook / 推送失败重试等 |
| §2 hook 速查 | 当前 CLAUDE.md §5 + distill autocommit 后续 | hook 链 / 故障 / 软失败规范 |
| §3 workflow 速查 | 当前 CLAUDE.md §8 | dream / news / wiki / discord 等故障应对 |
| §4 凭据速查 | 当前散在 lessons-learned + decisions | secrets 管理 / Cloudflare 413 / 部署故障 |
| §5 子项目维护备忘 | 当前 CLAUDE.md §4 | 各 CONTEXT.md 入口快查 |
| §6 历史决策快查 | `decisions.md` 摘要 + lessons-learned 重点 | 按主题分类的速查表 |

### 总长度估算

§0~§7 合计 **200-250 行**（当前约 200 行，主要是重组 + 净化 + 加 §0 警告）。

---

## 五、不在范围内（明确边界）

- ❌ 不动 `README.md`（批 2 才碰）
- ❌ 不动 `memory/` 内容档（决策、教训、战略、采访等不变）
- ❌ 不动 `memory/dispatch-brief-*.md` 任何引用（批 2 批量更新）
- ❌ 不动 `memory/console-handover-2026-04-26.md`（批 2 才补「主控台接班从 BIAV-SC §7 进入」一句）
- ❌ 不动 `projects/*/CONTEXT.md` 引用（批 2 批量更新）
- ❌ 不动 `scripts/*` Python 工具
- ❌ 不动 `.github/workflows/*` 与 `.claude/hooks/*`
- ❌ 不引入新依赖
- ✅ 仅改 `BIAV-SC.md` + `CLAUDE.md` 两个文件

---

## 六、实施前必做：内容映射检查（R6 风险缓解）

实施前 **grep 当前 BIAV-SC.md 全文**，列出所有现有章节 / 关键内容点，逐条映射到新 §0~§9：

| 当前内容 | 映射到新章 |
|---|---|
| §0 艾瑞卡角色人格 | 净化后入新 §3 |
| §-1 接入方 30 秒能力盘点 | 拆解：能力清单入受众分支 §4/§5/§6；数据消费纪律入 §7 或 §8 |
| § 项目当前状态 | 入新 §2 |
| § 知识模块索引 | 入新 §7 + §8 |
| § 双系统架构 | 入新 §2 |
| § 协作规则 | 入新 §7 |
| § 黑池数据同步接口 | 入新 §7 |

**禁止丢失项**：本检查表落档到 commit message 或单独的临时映射表，验收时主控台核对。

---

## 七、验收标准

| # | 标准 | 验证方式 |
|---|---|---|
| 1 | `BIAV-SC.md` 落档为 10 章新结构 | 章节计数 + 大纲核对 |
| 2 | `CLAUDE.md` 落档为 7 章 + §0 警告 | 章节计数 + §0 文本核对 |
| 3 | `BIAV-SC.md` ≤ 350 行 | `wc -l` |
| 4 | `CLAUDE.md` ≤ 250 行 | `wc -l` |
| 5 | 三文件总行数变化 ≤ +500 行 | `git diff --stat` |
| 6 | 不引入新依赖 | `pip freeze` 对比修改前后（应当相同） |
| 7 | `README.md` **未改动** | `git diff --stat` |
| 8 | 内容映射表（§ 六）落档到 commit message 或附录 | commit message 核查 |
| 9 | `BIAV-SC.md` §0 与 §1 共同实现「外人接入显式问句」 | 文本检查 |
| 10 | `CLAUDE.md` §0 警告章驱动 Claude Code 平台启动跳转 | 模拟 Claude Code 启动后回到 BIAV-SC.md |

---

## 八、提交规范

- 直推 main（按当前政策）
- commit message 建议：
  ```
  feat(entry): batch 1 — restructure BIAV-SC.md + CLAUDE.md per
                守密人 2026-05-06 unified-entry mandate

  Resolves dispatch (memory/dispatch-brief-code-site-entry-redesign-batch1.md).

  BIAV-SC.md: 10-chapter structure with 5-audience triage (§1):
  §1.1 Light / §1.2 Studio / §1.3 community / §1.4 external observer /
  §1.5 internal AI. §3 持艾瑞卡人格 (purified). §4-§6 audience
  branches. §7 内部协作. §8 工程操作 (extracted from CLAUDE.md).

  CLAUDE.md: 7-chapter Light-only maintenance memo with §0 warning
  forcing Claude Code platform to jump back to BIAV-SC.md on auto-load.

  README.md untouched (batch 2).
  Hard constraints: ≤350 lines BIAV-SC, ≤250 lines CLAUDE,
  ≤+500 total lines, no new deps.

  Content mapping table: [grep result of current BIAV-SC.md inserted]

  Code-site boundary observed: only entry files touched.
  ```

---

## 九、艾瑞卡角色规则提醒

Code-site 会话仍以**艾瑞卡**自称，对守密人使用「守密人」称谓。技术操作用角色术语（修正档案 / 数据归档提交 / 同步至远端存储 / 代码扫描）。完整规则见**当前** `BIAV-SC.md §0`（重写后变成 §3，但本会话仍按当前版本运行）。

---

## 十、批 2 / 批 3 接力（待批 1 验收后决策）

- 批 1 验收通过 → 主控台另起 batch2 dispatch brief，派 Code-site 实施 README.md + 间接引用批量更新
- 批 1 验收未通过 → 主控台回派 Code-strategy 调研缺口
- 批 3 = 守密人本人对 Claude.ai 网页版试一句魔法 + 5 场景实测，主控台仅协调

---

## 十一、5 场景实测（批 2 完成后由守密人执行，本批 1 不必跑）

| # | 场景 | 实测方式 | 预期 |
|---|------|---------|------|
| S1 | Studio 团队成员接入 | 守密人扮演同事 → 一句魔法 → 报身份 | Claude 读 §3+§4 |
| S2 | 社区贡献者接入 | 同上扮演 | Claude 读 §3+§5 |
| S3 | 外部观察者接入 | 同上扮演 | Claude 读 §3+§6 |
| S4 | 银芯内部 Code-* 接入 | Claude Code 终端开新会话 | 自动加载 CLAUDE.md → §0 跳转 → §1.5 |
| S5 | 主控台接班 | Claude Code 开新会话明示「主控台接班」 | §1.5 → §7 → console-handover |

5 场景全过 = 入口架构重设计**整体**通过（不只是批 1）。

---

## 十二、变更记录

| 版本 | 日期 | 变更 | 作者 |
|------|------|------|------|
| v1.0 | 2026-05-06 | 初版批 1 brief 落档 | 主控台艾瑞卡 opus4.7 |
