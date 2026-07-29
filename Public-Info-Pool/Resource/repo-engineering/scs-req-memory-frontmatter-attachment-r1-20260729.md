# SCS-REQ：记忆 frontmatter 四类型 + 选择性附着（r1 设计轮需求档）

- 日期：2026-07-29（北京时间）· 状态：**已定稿**（守密人 2026-07-29 四轮交互裁定收官：
  §1.2 丙·cards 退役 / §2.2 按 r1 案 / §四 pinned 采纳暂定案 / §四 when_to_save 官方全文注入；
  按 §三排期进入实现）
- 来源：守密人 2026-07-29 T75 拷问裁定「直接开设计轮」（不等黑池实测证据，本档即设计轮产出；
  同轮第 1 项 dream 信号源已随 agent SDK 1.6.0 落地——`transcripts` 指针段 +
  `consolidationToolOptions()` 预设）。
- 官方参照：`system-prompt-memory-instructions.md` / `system-prompt-*-memory-body-structure.md`
  （四类型定义）/ `agent-prompt-determine-which-memory-files-to-attach.md`（≤5 文件挑选子代理）/
  `system-reminder-memory-file-contents.md`（附着信封）。
- 章程语境：本包记忆系统对齐 `memory_20250818`（docs/MEMORY.md）；本档是对 Claude Code
  auto-memory 侧两块能力的**选择性收编设计**，不是整体章程改挂。

## 一、frontmatter 四类型

### 1.1 官方契约（收编目标）

每个记忆文件以 YAML frontmatter 开头：

```yaml
---
name: <short-kebab-case-slug>
description: <one-line summary — used to decide relevance during recall>
metadata:
  type: user | feedback | project | reference
  pinned: <bool>
---
```

四类型各有 when_to_save / body_structure（feedback/project 体例：规则行 + `**Why:**` +
`**How to apply:**`）；`description` 是选择性附着（§二）的挑选依据。

### 1.2 设计案

- **落点**：新增 `schema: 'frontmatter'` 档位（cards 已裁退役——见下条，落地后 `schema`
  仅 `'frontmatter' | undefined`），写侧校验器 `frontmatter.ts`（结构对称被移除的
  cards.ts）：frontmatter 存在性 / 必填字段（name、description）/ type 枚举 /
  description 单行长度上限（~150 字符，对齐索引行预算）。
  索引文件 `/memories/MEMORY.md` 豁免（沿用 cards 时期先例）。
- **cards 关系【已裁：丙·cards 退役】（守密人 2026-07-29 二轮交互裁定，否决推荐甲案）**：
  裁定语境——cards 本非 Claude 记忆模式（R9 属黑池适配轴、2026-07-11 需求书裁定、COMPAT
  诚实标 BPT-EXTENSION），守密人核实出身后裁记忆面收敛 Claude 形态、cards 移除。
  **执行并入 §一实现步**（消费者只面对一次破坏性迁移）：`schema: 'cards'` 档位 +
  `memory.cards` 配置 + `cards.ts` 校验器 + 相关导出一并移除，`schema` 收敛为
  `'frontmatter' | undefined(自由)`；semver 诚实——移除已发货公开选项为 BREAKING，
  该步发 **2.0.0**（家族锁步）并附 CHANGELOG 迁移注记。
  **在产消费者迁移清单**：① testbed 每日做梦归并卡（`validateCardsContent` 准入）随步
  迁 frontmatter 体例（卡文内容可保留，头部换 YAML frontmatter）；② 黑池侧若已 pin 消费
  cards 需按迁移注记升级（实现前守密人向黑池确认消费面即可，按「需求非数据」纪律口述）。
- **迁移悬崖（两向都要提示）**：任一档位下触碰旧体例文件的 `str_replace`/`insert` 会被
  全量校验拒绝（COMPAT #34 既有事实）——校验错误消息须附「delete + create 重写为新体例」
  的自愈指引；docs/MEMORY.md 增「已有内容下切换档位」小节。
- **健康扫描增量**：`assessMemoryStoreHealth` 增 frontmatter 完整率维度（仅
  `schema:'frontmatter'` 时启用）；consolidation 任务清单可列「缺 frontmatter 的文件」。

### 1.3 验收标准

写侧校验先红后绿测试（缺头/缺 name/坏 type/超长 description 各一）；索引豁免；
contract-suite 不扩（校验在工具层，store 契约不变）；COMPAT #9 行与 MEMORY.md 章程节同步。

## 二、选择性附着（≤5 相关记忆文件注入）

### 2.1 官方契约（收编目标）

专门子代理按 filename + description 从记忆库挑至多 5 个与当前任务相关的文件，
内容以 `<system-reminder>` 信封附着进会话（背景语境非指令、附「验证仍存在」防护——
本包 R6 索引注入已带同款措辞）；对 user/project 类保守。

### 2.2 设计案【已裁：按 r1 案定稿】（守密人 2026-07-29 四轮交互裁定）

- **形态**：`options.memory.attachment?: { enabled: true, maxFiles?: number(≤5),
  picker?: { model?: string } }`，**opt-in、计费可见**（挑选器是一次真实模型调用；
  按 0.94.0 无默认模型纪律，picker.model 缺省继承会话模型）。
- **流程**：会话装配期（R6 索引注入之后）→ 读全库 frontmatter 头（只读头不读体，
  有界扫描沿用 health 的 maxEntries=4096）→ 挑选器调用（输入：任务 prompt 首段 +
  文件名/description 清单；输出：结构化 ≤maxFiles 路径列表，schema 强制）→ 命中文件
  全文注入，信封与降权措辞对齐 R6（system prompt 片段、background-context + 待验证声明）。
- **依赖**：硬依赖 §一 frontmatter（无 description 无挑选依据）；`schema:'frontmatter'`
  未启用时 attachment 配置报 ConfigurationError（不静默降级——半吊子挑选比不挑更糟）。
- **护栏**：S2 incognito 下照常（附着是读）；S1 mounts 约束挑选范围（不可读子树不进
  候选清单）；注入总量上限（默认 25600 字节，对齐索引注入预算量级，超限按挑选序截断
  并披露）；挑选器失败优雅降级回「仅索引注入」并 debug 记录（坏挑选器绝不挡会话）。

### 2.3 验收标准

挑选器 stub 测试（零网络）：候选清单构造 / maxFiles 上限 / 不可读子树排除 / 失败降级；
注入信封措辞断言（对齐 R6 防护语）；计费面测试（picker 调用进 usage 账）。

## 三、排期与依赖

1. 本档定稿（§1.2 已裁丙、§2.2 已裁按 r1 案；余 §四两开放问题）→ 2. §一实现（frontmatter 落地 +
cards 退役同步，**BREAKING → 2.0.0**）→ 3. §二实现（依赖 §一，minor）。锁步发货；COMPAT #9 行随每步更新。

## 四、开放问题（已全裁，2026-07-29 四轮）

- `pinned` 字段语义【已裁：采纳 r1 暂定案】（守密人 2026-07-29 四轮交互裁定）：pinned 文件
  绕过挑选器直接附着、不占 maxFiles 名额，仍受 25600 字节总预算约束且优先入预算。
  裁定语境——官方原文 pinned =「适用于所有未来会话」，恒附着在官方即挑选器外机制，
  本案忠实该语义并补预算护栏防滥 pin 撞爆上下文。
- 四类型的 when_to_save / body_structure 提示词注入面【已裁：官方全文直接注入】（守密人
  2026-07-29 四轮交互裁定，**否决推荐的精简版案**）：随 `schema:'frontmatter'` 档位注入
  官方相关提示词**全文**（verbatim，provenance 标注对齐 descriptions.ts 治理纪律，入
  `UNGOVERNED_TOOL_DESCRIPTIONS` 完备性守卫辖域），不等描述治理轮。口径订正：官方相关
  提示词实为 feedback / project 各 save-guidance + body-structure 四档 + 总纲
  `memory-instructions` 与 description 专档（r1 原写「官方 8 档」偶大，以镜像 `ls` 为准）。
