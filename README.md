# 缸中之脑 Brain in a Vat

> **⚠ 当前状态：稳态维护期（2026-07-12 起）。Phase 2 银芯使命建设期（2026-04-27 起）已提前收口、判定基本达成（守密人 2026-07-12 裁定）；信息层采集自动跑、按需维护，silver-core-sdk 按新使命持续开发。**

忘却前夜（忘卻前夜 / Morimens）的**社区知识平台 + 黑池信息入口**。本仓库由忘却前夜官方授权制作人维护，引用公开可查阅的游戏资料。

> **定位（守密人 2026-06-21 裁定，宽解）**：银芯为**公开信息层**（整层公开），覆盖 2026-06-11「受限 / 非公开层」定位（翻回公开）；银芯自身工程产物亦属公开信息。两条射程外硬约束不受影响：(1) 定位为公开**不解除**第三方平台 ToS 对采集行为的约束；(2) §1.1-HC 黑池防火墙维持永久关闭——「银芯公开」绝不等于「黑池可进银芯」。

---

## 接入弥萨格数据库 · For AI Agents

> 「记忆宫殿的访问者，请通过身份验证。」

任何 AI 实例（Claude / GPT / Gemini 等）接入本仓库后，请直接打开 [`CLAUDE.md`](CLAUDE.md) —— 弥萨格大学数据库的**统一入口**，含艾瑞卡角色卡（你的运行身份）/ 可访问数据资产清单 / 数据消费纪律 / 卡帕西编码 4 原则（硬约束）/ 按需加载的知识模块索引。约 5 分钟即可就位，以「艾瑞卡」身份服务守密人。

**Claude Code 终端**自动加载 CLAUDE.md（平台级强约束）。**外部 AI**（GPT / Gemini 等）通过 raw URL 直接 fetch：`https://raw.githubusercontent.com/lightproud/brain-in-a-vat/main/CLAUDE.md`。

**深度浸染艾瑞卡说话风格**（强烈建议）：在 CLAUDE.md §2 抽象规则之外，再读 [`assets/data/character-personas/erica-speech-canon.md`](assets/data/character-personas/erica-speech-canon.md) —— 含 9 条 Voice.lua 一手语音原文 + 8 节模式归纳，每次回应前采样 1-2 条 Voice 样本模仿其结构。

---

## 授权声明

本项目由忘却前夜官方授权制作人维护。游戏设计内容、系统内容、资产内容归属脑缸组及其合作伙伴所有，本项目引用公开可查阅信息。

## 项目定位（2026-07-12 第三次收敛：信息入口 + 通用 AI 底层开发基地）

银芯（BIAV-SC）二使命：

- **黑池信息入口**：GitHub 自动化采集层 / 黑池消费的「眼睛和耳朵」/ 银芯→黑池单向输出（news 核心）
- **通用 AI 底层能力开发基地**：silver-core-sdk 等通用 AI 底层工程产物持续开发，作为银芯→黑池单向输出物支持黑池建设（2026-07-12 事实使命转正）

> 使命收敛历程：三新使命（2026-04-26 v2.0）→ 使命#3「Studio 团队 AI 协作训练场」退役（2026-06-28）→ 原使命#2「社区共建知识底座」取消 + SDK 使命转正（守密人 2026-07-12 裁定，见 `memory/decisions.md`）。wiki 子项目已冻结（已建成果保留：72 角色基线 + 站点静态页，不删不派发）。

site 维持对外门户；衍生游戏（game）为守密人个人兴趣，不承载使命。完整战略详见 `memory/strategic-plan-2026.md`。

## 仓库结构

```
brain-in-a-vat/
├── README.md                # 本文件（人 + AI 共用入口）
├── CLAUDE.md                # AI 统一入口（Claude Code 自动加载 + 外部 raw URL fetch 同源；含艾瑞卡人格 / 卡帕西编码 4 原则 / 数据消费纪律 / 知识索引 / Light 维护速查）
├── memory/                  # 结构化记忆（决策、状态、方法论、视觉规范、active hub）
│   ├── active/             # 主题入口卡（高频 hub，优先读）
│   ├── strategy/            # 长期战略文档
│   └── research/            # 一次性调研产物
├── assets/                  # 共享资产（事实圣经、图片、模板）
│   └── data/                # 事实圣经（领域知识结构化存储）
├── scripts/                 # 顶层 Python 工具层（人格 / 记忆写入 / 解包-解析 / 运营）
├── tests/                   # pytest 单元测试（解析 / 采集 / 记忆 / 文本）
├── projects/                # 子项目工作区
│   ├── site/                # 主站导航页 + 设计系统
│   ├── news/                # 社区新闻聚合 + 报告系统（含全量档案层 data/）
│   ├── wiki/                # 游戏数据集 + 多语言 Wiki 站点
│   └── game/                # 衍生游戏（v2.0 退主线，备扩展位）
└── Public-Info-Pool/        # 公开信息层产物总池（Resource 正式产物 / Rough 草稿；取代旧 deliverables/）
```

## 子项目与模块

> 多会话 Code-* 角色（主控台 + 各子项目会话）已于 **2026-06 退役**，现为守密人 ↔ **单一艾瑞卡会话**直接协作，子项目前缀仅作话题标签（沿革见 `memory/archive/contribution-protocol-hub.md`，2026-07-11 随协议退役降档归档）。

| 子项目 / 模块 | 目录 | 状态 |
|---|---|---|
| 主站 + 设计系统 | `projects/site/` | 已上线，M1 对外门户优化中 |
| 社区新闻聚合 + 全量归档 | `projects/news/` | 10+ 源运行中，全量回溯至 2026-02 |
| 游戏数据集 + Wiki | `projects/wiki/` | 结构化层 2026-06-15 清空，W2 以一手解包字段重建基线 |
| 衍生游戏 | `projects/game/` | v2.0 退主线，备扩展位 |
| 银芯记忆 | `memory/*.md` 人工策展 + MCP `biav-sc-memory` 4 工具 | 自造记忆栈（9 模块/做梦）2026-06 退役，定位收归平台原生上下文 |
| 长期战略智库 | `memory/strategy/` + `memory/research/` | 长尺度调研 / 评估 / 选项分析 |

## 快速开始

```bash
# 本地运行新闻抓取
pip install -r projects/news/requirements.txt
python projects/news/scripts/aggregator.py

# 本地预览 Wiki
cd projects/wiki && npm install && npm run dev

# 跨档案检索记忆层（语义检索子系统 2026-06 退役，改用 ripgrep）
rg "<关键词>" memory/ assets/

# 运行验证程序（全量单测）
pytest tests/ -v
```

## 技术栈

- **Wiki**：VitePress + Markdown（EN/JA/ZH 三语言）
- **新闻聚合**：Python 3.11+ / 纯 HTML 前端
- **事实圣经**：结构化 JSON + Python 校验脚本
- **银芯记忆**：CLAUDE.md（每会话自动加载）+ `memory/*.md` 人工策展 + MCP `biav-sc-memory` 4 工具；会话连续性承 Claude 平台原生上下文（自造 TF-IDF/知识图谱/做梦栈 2026-06 退役）
- **自动化**：GitHub Actions（社区抓取 + Issue 驱动 + 部署；精确清单以 `ls .github/workflows/` 为准）
- **协作**：Claude Code 单一艾瑞卡会话 + 平台原生记忆（原多会话架构 2026-06 退役）

## AI 协作方法论

本项目现采用「**守密人 ↔ 单一艾瑞卡会话**」直接协作（原「多会话职责隔离 + 中枢协调」模式 2026-06 退役）：

- **统一身份**：艾瑞卡承接战略+规划+协调+接口，子项目前缀（news / wiki / site …）仅作话题标签
- **记忆层**：CLAUDE.md 自动加载 + `memory/*.md` 人工策展档案 + 平台原生上下文管理
- **决策溯源**：`memory/decisions.md`（溯源权威）+ `memory/active/` 主题入口卡

详见 [`memory/methodology.md`](memory/methodology.md) 与踩坑教训 [`memory/lessons-learned.md`](memory/lessons-learned.md)（持续追加，条数以文件最新为准）。

## 关于贡献（单向可读）

本仓库对社区为**单向可读**（守密人 2026-07-10 裁定）：欢迎自由阅读、引用与派生使用全部公开信息（遵循下方许可），但**不接收外部贡献**——不受理数据补全 / 翻译 / 内容类 PR 与 Issue。原贡献流程已退役，历史档案见 [`memory/contribution-protocol.md`](memory/contribution-protocol.md)。交流请到游戏社区（Discord 等）。

## 许可

代码部分采用 [MIT License](LICENSE) 开源。游戏相关内容版权归脑缸组及其合作伙伴所有。
