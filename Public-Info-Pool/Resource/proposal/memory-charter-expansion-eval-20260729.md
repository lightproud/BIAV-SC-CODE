# 记忆章程扩编评估（设计轮提案）— frontmatter 四类型 / 选择性附着 / dream 信号源

- 日期：2026-07-29（北京时间）
- 来源：守密人 2026-07-29 拷问裁定 #9「扩大收编」——两条低成本项（索引官方链接格式、
  approaching 预警档）已随 silver-core-sdk 1.5.0 落地；其余三项**需另开设计轮**，本档为该轮的
  评估底稿。裁定溯源见 `memory/decisions.md` 2026-07-29 条与 COMPAT.md「2026-07-28 tools/memory
  alignment audit」节。
- 现行章程：SDK 记忆系统对齐 Anthropic `memory_20250818` 六命令协议（`docs/MEMORY.md`）；
  Claude Code auto-memory 侧能力此前整体记非目标。

## 评估对象（三项，按官方参照档逐项）

### 1. frontmatter 四类型（user / feedback / project / reference）

- **官方契约**：每个记忆文件带 YAML frontmatter（`name` / `description` / `metadata.type` /
  `metadata.pinned`），四类型各有 when_to_save / body_structure 定义（参照档
  `system-prompt-memory-instructions.md` 等 8 份）。
- **对本包的价值**：`description` 字段是选择性附着（第 2 项）的前置依赖——没有它，相关性
  挑选无据可依；`type` 使巩固（consolidation）可以按类差异化剪枝。
- **代价与风险**：与现行 cards 模式（R9）是**两套互斥的文件体例**——cards 校验器会拒绝
  frontmatter 开头的文件（COMPAT 登记表 #34 既有事实）；引入即需裁定二者关系
  （并存开关 / cards 吸收 frontmatter / 弃一保一）。
- **初步倾向**：作为第 2 项的依赖一并裁；单独引入无消费者。

### 2. 选择性附着（按 description 挑 ≤5 相关记忆文件注入）

- **官方契约**：专门子代理按 filename + description 选至多 5 个相关记忆文件附着进会话
  （`agent-prompt-determine-which-memory-files-to-attach.md`），对 user/project 类保守。
- **对本包的价值**：现行 R6 只注入 MEMORY.md 头部（索引），文件本体永远靠模型 view——
  选择性附着是「索引路由」到「内容直达」的跨越，对黑池长会话省往返。
- **代价与风险**：需要一次额外模型调用（挑选器）——本包「零常驻、宿主付费面显式」纪律下，
  须作为 opt-in 且计费可见；且依赖第 1 项的 description 字段。
- **初步倾向**：依赖第 1 项；若黑池侧无「记忆文件多到索引路由不够用」的实测痛点，暂缓。

### 3. dream 信号源（会话日志 + transcript grep 进巩固输入）

- **官方契约**：dream 巩固的 Gather 阶段读 `logs/YYYY/MM/DD/` 会话日志、窄词 grep JSONL
  转录（`agent-prompt-dream-memory-consolidation.md` Phase 2）；本包 consolidation 的 Gather
  只读记忆文件本身。
- **对本包的价值**：巩固能发现「发生过但没写进记忆」的遗漏——现行版只能整理已写入的。
- **代价与风险**：需要宿主暴露转录路径与日志布局（本包 sessions 层有 JSONL 存储，路径
  可给）；巩固回合的读面扩大，S1 mounts 安全注记需同步扩写。
- **初步倾向**：三项中独立性最强、可单独裁；建议作为 consolidation 的 opt-in 输入源参数
  （`buildConsolidationPrompt` 加 transcript 指针段），不新增进程与调度（维持 spec N1）。

## 建议的裁定顺序

1. 先裁第 3 项（独立、小）；
2. 第 1+2 项捆绑裁（依赖关系），裁定前先取黑池侧「记忆文件规模 / 索引路由是否已不够用」
   的实测数据作为需求证据；
3. 任何一项落地都须同步：cards 关系裁定、MEMORY.md 章程节、COMPAT 登记表 #9 行、
   contract-suite 扩展。

## 状态

挂账 `memory/todo.md`（新增条目，类别：裁定）；未裁前本档只是评估底稿，不构成实现承诺。

## 后记（同日二次拷问裁定，2026-07-29）

本档「建议的裁定顺序」已被守密人二次拷问**部分推翻**：第 3 项（dream 信号源）按推荐案裁
「指针段+预设」并随 agent SDK 1.6.0 落地；第 1+2 项守密人裁**「直接开设计轮」**（否决
「先取黑池证据」的缓议案），r1 需求档见
`Public-Info-Pool/Resource/repo-engineering/scs-req-memory-frontmatter-attachment-r1-20260729.md`。
本档降为背景底稿，后续以 r1 需求档为准。
