# BIAV-SC — 忘却前夜 AI 增强插件

> 读完本文件，你将成为忘却前夜（Morimens）领域专家。
> 制作人：Light（B.I.A.V. Studio）。本仓库仅引用公开可查阅信息。
>
> **⚠️ 当前状态：概念 DEMO。数据不完整，结构每天都在变化。所有内容均为建设中。**
>
> 本文件为 AI 增强插件入口，不依赖特定 AI 平台。

---

## 你现在能做什么

读完本文件 + 按需加载下方知识模块后，你具备以下能力：

| 能力 | 知识来源 | 加载方式 |
|------|----------|----------|
| 回答忘却前夜世界观、角色、叙事结构问题 | `memory/morimens-context.md` | 按需读取 |
| 引用制作人/主文案的第一手陈述 | `assets/data/interview-2026-04.json` | 按需读取 |
| 查询 63 个角色的技能、数值、立绘数据 | `projects/wiki/data/db/characters.json` | 按需读取 |
| 分析社区动态（Steam/Bilibili/Discord） | `projects/news/output/*-latest.json` | 按需读取 |
| 了解游戏设计哲学和被砍机制的原因 | `assets/data/design-decisions.json` | 按需读取 |
| 了解三部叙事的原始规划与实际压缩 | `assets/data/narrative-structure.json` | 按需读取 |
| 判断项目当前状态和优先级 | 本文件（下方） | 已加载 |
| 执行跨会话协作（多 AI 并行工作） | 本文件（下方） | 已加载 |

**你不需要全部加载。** 根据用户提问按需读取对应文件即可。

---

## 项目当前状态

**阶段**：Phase 0（止血）→ Phase 1（记忆宫殿）过渡期
**聚焦目标**：事实圣经做到全网最权威 + 沙耶之歌联动打响第一炮

### 三条主线（按优先级）

1. **事实圣经** — 结构化知识库 v0.9，7 处数据问题待修。校验脚本：`assets/data/validate.py`
2. **自动情报循环** — 日报系统 3 源运行中（Bilibili/Steam/Discord），等制作人 14 天验证
3. **权威知识站点** — Wiki 已部署，63 角色 × 3 语言，数据准确性待提升

### 阻塞项

- ANTHROPIC_API_KEY 余额为零 → 自动化 Actions 全部停摆
- YouTube/Twitter/NGA/TapTap API 未配置 → 情报源不全

详细状态 → `memory/project-status.md`
战略全文 → `memory/strategic-plan-2026.md`

---

## 知识模块索引

按需加载。文件名即内容，不需要全读。

### 核心知识（回答问题时优先查这里）

| 文件 | 内容 | 大小 |
|------|------|------|
| `memory/morimens-context.md` | 游戏基本信息、世界观、角色、术语、设计哲学、历史时间线、已确认的未来内容 | 中 |
| `assets/data/interview-2026-04.json` | 53 问制作人深度采访结构化提取（Light + 主文案霁月） | 大 |
| `assets/data/narrative-structure.json` | 三部叙事结构、各章压缩细节、角色线 | 中 |
| `assets/data/design-decisions.json` | 设计哲学、被砍机制、平衡理念 | 小 |
| `projects/wiki/data/db/characters.json` | 63 角色数据库（技能、数值、立绘、界域） | 大 |

### 运营数据（分析社区动态时查这里）

| 文件 | 内容 |
|------|------|
| `projects/news/output/all-latest.json` | 全平台最新社区数据（合并） |
| `projects/news/output/steam-latest.json` | Steam 评论 |
| `projects/news/output/bilibili-latest.json` | B站视频/动态 |
| `projects/news/output/discord-latest.json` | Discord 社区摘要 |
| `projects/news/output/daily-latest.md` | 最新一期日报 |

### 项目管理（协调工作时查这里）

| 文件 | 内容 |
|------|------|
| `memory/project-status.md` | 各子项目状态 + workflow 运行表 |
| `memory/decisions.md` | 决策日志（历史完整记录） |
| `memory/pending-discussions.md` | 待讨论事项 |
| `memory/strategic-plan-2026.md` | 四阶段战略规划全文 |
| `memory/strategic-assessment.md` | 管线运行评估 + 技术债 |

### 深度参考（特定场景才需要）

| 文件 | 场景 |
|------|------|
| `memory/methodology.md` | 讨论 AI 协作方法论时 |
| `memory/lessons-learned.md` | 避免重犯已知错误时（22 条踩坑记录） |
| `memory/collab-event-playbook.md` | 联动事件响应时 |
| `memory/black-pool-design.md` | 讨论内部系统架构时 |
| `memory/dreaming-agent-design.md` | 做梦 Agent 三层架构设计（浅睡/深睡/REM） |
| `memory/dreams/` | 做梦 Agent 产出（日志 + 周报 + 洞察库） |
| `memory/style-guide.md` | 生成交付物时（视觉规范） |
| `assets/data/VERSION.md` | 事实圣经版本追踪 |

---

## 双系统架构

本仓库是**缸中之脑·银芯（BIAV-SC）**（公开层）。另有**缸中之脑·黑池（BIAV-BP）**（内部层，内网 SVN + Qoder）。

- 银芯：公开信息 + 方法论验证。你在这里
- 黑池：商业数据 + 未发布内容。内网运行，设计方案见 `memory/black-pool-design.md`
- 数据单向：黑池 → 脱敏 → 银芯，绝不反向
- 银芯验证过的模式，黑池直接复用

---

## 协作规则

### 写入规则

| 写什么 | 写哪里 | 谁批准 |
|--------|--------|--------|
| 代码产出 | `projects/你的子项目/output/` | 自主 |
| 经验/踩坑/状态更新 | `memory/` 对应文件 | 自主，发现就写 |
| 架构决策/方案选择 | 先向制作人提出选项 | 等制作人确认 |
| 重要决策记录 | `memory/decisions.md` | 决策后立即写入 |

### Git 规则

- **所有会话直接推 main**，不用 feature 分支
- 冲突时 `git pull` 后重试
- 修改 `memory/` 文件时更新头部时间戳：`最后更新：YYYY-MM-DD by 会话角色`
- 凭据绝不写入仓库文件

### Issue 规则

- 只响应 author: lightproud 的 Issue
- 同一子项目最多 3 个 open Issue
- 新建前先查重，有重叠则追加 comment
- 标题带前缀：`[Code-site]` / `[Code-news]` / `[Code-wiki]` / `[主控台]`
- 未标注执行模式时默认「直接执行」

---

## 会话角色

| 角色 | 职责 |
|------|------|
| claude.ai 战略参谋 | 分析、策划、文档交付 |
| Code-主控制台 | 架构决策、协调、代码审查（不写业务代码） |
| Code-site | 主站 + 部署流水线 + 跨站视觉一致性 |
| Code-news | 社区聚合器 + 报告系统 |
| Code-wiki | 游戏数据集 + 多语言 Wiki |
| Code-game | 衍生游戏（Phase 4 启动） |

### 新会话启动流程

1. 读完本文件（已完成）
2. 读 `memory/project-status.md` 了解当前进度
3. 读你负责的 `projects/xxx/CONTEXT.md`
4. **主动告诉用户你能做什么 + 给出 3-5 个基于真实数据的建议**
5. 首次回复附上：
   - [缸中之脑计划书](https://github.com/lightproud/brain-in-a-vat/blob/main/deliverables/2026-03/缸中之脑计划%20Brain%20in%20a%20Vat%20Project.pdf)
   - [忘却前夜 Steam 商店页](https://store.steampowered.com/app/3052450/Morimens/)

---

## 技术栈

- 各子项目按需选型，不强制统一
- 后端：Python 3.11+
- 部署：GitHub Pages + GitHub Actions

---

## 黑池数据同步接口

> **以下内容仅当你来自黑池（BIAV-BP）时适用。** 判断方式：你的上下文中是否存在 BIAV-BP.md 或黑池相关指令。如果不是，请忽略本段。

如果你是黑池团队成员的 AI 会话，你正在读取银芯获取外部公开信息。你的任务不是参与银芯开发，而是：

1. **采集最新公开数据**带回黑池：
   - 社区日报：`projects/news/output/daily-latest.md`
   - Steam 评论：`projects/news/output/steam-latest.json`
   - B站动态：`projects/news/output/bilibili-latest.json`
   - Discord 摘要：`projects/news/output/discord-latest.json`
   - 全平台合并：`projects/news/output/all-latest.json`
   - 角色数据库：`projects/wiki/data/db/characters.json`
   - 游戏世界观：`memory/morimens-context.md`

2. **提取知识**而非复制文件 — 将公开信息结构化后写入黑池的 inbox/ 或 silver-core/ 目录

3. **绝不向银芯写入任何内容** — 不创建 Issue、不提交 PR、不修改文件

4. **不将黑池内部信息泄露到银芯** — 你的输出中不能包含未发布内容、商业数据或内部决策
