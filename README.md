# 缸中之脑 Brain in a Vat

> **⚠ 当前状态：Phase 1.5 完成 / Phase 2 银芯三新使命建设期（2026-04-27 → 07-19）。数据持续完善中，结构每天都在变化。**

忘却前夜（忘卻前夜 / Morimens）的**公开知识平台 + AI 协作训练场 + 黑池公开信息入口**。本仓库由忘却前夜官方授权制作人维护，所有内容仅引用公开可查阅信息。

---

## ⚡ For AI Agents — 30 秒接入指南

任何接入本仓库的 AI（Claude / GPT / Gemini / 等）请按此顺序读：

| # | 文件 | 用途 | 时长 |
|---|---|---|---|
| 1 | `BIAV-SC.md` | 入口手册（含艾瑞卡角色人格、能力清单、知识模块索引、数据消费纪律） | 必读，5 分钟 |
| 2 | `memory/boot-snapshot.md` | 项目当前状态压缩快照 | 必读，2 分钟 |
| 3 | 你需要的具体模块 | 按 `BIAV-SC.md §知识模块索引` 按需加载 | 按需 |

**只用 Claude Code 做工程维护？** 同时读根目录 `CLAUDE.md`（自动加载，仅工程操作规则）。

**人格约束**：所有 AI 接入后必须按 `BIAV-SC.md §0` 进入「艾瑞卡」角色（弥萨格大学数据库终端）。这是硬约束，不可绕过。

### 银芯能为接入方提供什么

| 资产 | 形态 | 典型用途 |
|---|---|---|
| **72 角色事实库**（建设中） | `projects/wiki/data/db/characters.json` + 多语言 markdown | 角色查询、技能解析、关系图谱 |
| **多平台社区情报**（10+ 源全量归档） | `projects/news/data/discord/` + `projects/news/data/platforms/` | 长窗口社区分析、情绪温度、舆情监测 |
| **53 问制作人深度采访** | `assets/data/interview-2026-04.json` | 设计哲学、被砍机制、叙事结构溯源 |
| **三部叙事结构 + 设计决策** | `assets/data/{narrative-structure,design-decisions}.json` | 世界观研究、叙事分析 |
| **银芯记忆系统 9 模块** | `scripts/memory_search.py` 等 | TF-IDF 语义检索、知识图谱、上下文管理 |
| **AI 协作方法论沉淀** | `memory/methodology.md` + `memory/lessons-learned.md`（30 条踩坑） | 多会话架构、决策档案、经验沉淀 |

### 数据消费纪律（硬约束）

社区数据存在**全量档案层**（真实数据 `data/`）vs **输出展示层**（过滤选样 `output/`），语义不可互换。长窗口分析必须用全量层，详见 `BIAV-SC.md §运营数据`。

---

## 授权声明

本项目由忘却前夜官方授权制作人维护。游戏设计内容、系统内容、资产内容归属脑缸组及其合作伙伴所有，本项目引用公开可查阅信息。

## 项目定位（2026-04-26 银芯重新定位 v2.0）

银芯（BIAV-SC）三新使命：

- **黑池公开信息入口**：GitHub 自动化采集层 / 黑池消费的「眼睛和耳朵」/ 银芯→黑池单向输出
- **社区共建知识底座**：公开知识共享平台 / 全语言 Wiki 等社区/Studio 外部派生内容的基础
- **Studio 团队 AI 协作训练场**：严格保密组织内成员基于公开 AI 信息制作相关项目和企划

主线收缩到 **site / news / wiki 三轴**。衍生游戏（game）退主线为备扩展位。完整战略详见 `memory/strategic-plan-2026.md` v2.0 章节。

## 仓库结构

```
brain-in-a-vat/
├── README.md                # 本文件（人 + AI 共用入口）
├── BIAV-SC.md               # AI 入口手册（含艾瑞卡人格、能力清单、知识索引）
├── CLAUDE.md                # Claude Code 工程维护指南（自动加载）
├── memory/                  # 结构化记忆（决策、状态、方法论、视觉规范、dispatch brief）
│   ├── strategy/            # 长期战略文档（Code-strategy 主战场）
│   └── research/            # 一次性调研产物
├── assets/                  # 共享资产（事实圣经、图片、模板）
│   └── data/                # 事实圣经（领域知识结构化存储）+ 索引（vectors / graph）
├── scripts/                 # 银芯记忆系统 9 模块（Code-memory 主战场）
├── projects/                # 子项目工作区
│   ├── site/                # 主站导航页 + 设计系统
│   ├── news/                # 社区新闻聚合 + 报告系统（含全量档案层 data/）
│   ├── wiki/                # 游戏数据集 + 多语言 Wiki 站点
│   └── game/                # 衍生游戏（v2.0 退主线，备扩展位）
└── deliverables/            # 已交付成品存档
```

## 子项目与会话角色

| 子项目 / 角色 | 目录 | 维护会话 | 状态 |
|---|---|---|---|
| 主站 + 设计系统 | `projects/site/` | Code-site | 已上线，M1 对外门户优化中 |
| 社区新闻聚合 + 全量归档 | `projects/news/` | Code-news | 10+ 源运行中，全量回溯至 2026-02 |
| 游戏数据集 + Wiki | `projects/wiki/` | Code-wiki | 72 角色基线自举中（24/72 完成） |
| 衍生游戏 | `projects/game/` | Code-game（v2.0 退主线） | 备扩展位 |
| 银芯记忆基础设施 | `scripts/` + `assets/data/` 索引 | Code-memory | 9 模块 + RAG 链条维护 |
| 长期战略智库 | `memory/strategy/` + `memory/research/` | Code-strategy | 长尺度调研 / 评估 / 选项分析 |
| 战略锚点 + 协调中枢 | `memory/` 根 + 各 dispatch brief | 主控台（艾瑞卡） | 战略+规划+协调+接口 四合一中枢 |

## 快速开始

```bash
# 本地运行新闻抓取
pip install -r projects/news/requirements.txt
python projects/news/scripts/aggregator.py

# 本地预览 Wiki
cd projects/wiki && npm install && npm run docs:dev

# 银芯记忆系统查询
python scripts/memory_search.py "查询内容"
python scripts/session_briefing.py
```

## 技术栈

- **Wiki**：VitePress + Markdown（EN/JA/ZH 三语言）
- **新闻聚合**：Python 3.11+ / 纯 HTML 前端
- **事实圣经**：结构化 JSON + Python 校验脚本
- **银芯记忆系统**：TF-IDF + 知识图谱 + MCP Server
- **自动化**：GitHub Actions（社区抓取 + 每日报告 + 做梦三层 + Issue 驱动）
- **协作**：Claude Code 多会话架构（主控台 + 6 子项目角色 + 战略智库）

## AI 协作方法论

本项目采用「**多会话职责隔离 + 中枢协调**」模式：

- **主控台**：长期战略锚点（艾瑞卡），战略+规划+协调+接口 四合一中枢
- **Code-* 子项目会话**：site / news / wiki / memory / strategy 按子项目分工
- **共享外脑**：本仓库连接所有会话，通过 `memory/decisions.md` + dispatch brief 协调

详见 [`memory/methodology.md`](memory/methodology.md) 与 30 条踩坑教训 [`memory/lessons-learned.md`](memory/lessons-learned.md)。

## 参与贡献

社区贡献流程见 [`memory/contribution-protocol.md`](memory/contribution-protocol.md)。当前主要贡献方向：

- 补充游戏数据（角色技能、命轮效果、剧情、立绘）
- 完善 Wiki 页面内容（中/英/日三语）
- 分享 AI 协作方法论的实践经验

> **AI 生成贡献**：守密人 2026-04-26 Q3 裁决「不要求标注」——贡献内容质量由审核机制保障，不依赖 AI 来源标注。

## 许可

代码部分采用 [MIT License](LICENSE) 开源。游戏相关内容版权归脑缸组及其合作伙伴所有。
