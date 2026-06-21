# BPT 架构快照（4-19 战略转向冻结点基线）

> **⚠ 定格快照（勿当现行）**：文中一切 `bpt-*` / `channels.ts` / `helpers.ts` 等路径反映 2026-04-19 冻结点的 BPT 设想，BPT 战线早已不在银芯内部开发（指导改人工搬运），这些引用按历史快照理解、不指向现行文件。
>
> 最后更新：2026-04-27 by 艾瑞卡会话（基于 `memory/archive/bpt-strategic-shift-2026-04-19/` 8 份归档摘录）
>
> 状态：**冻结基线**。代表 2026-04-19 BPT 从银芯仓库删除时的最后一版设计。内网 BPT 后续演进以本文为参照锚点。
>
> 用途：Code-BPT 会话产出搬运包时的「我们 4-19 当时是怎么想的」上下文锚点。不是当前实施规范，仅为历史共识快照。

---

## 〇、为什么要这份文件

BPT 实代码部署在内网 SVN，银芯（本仓库）够不到。Code-BPT 角色作为指导者只能基于「公开层留存的设计」给意见。这份文件把 8 份归档浓缩为单页 anchor，避免每次指导都重新翻档案。

## 一、BPT 是什么

**核心命题**：把 Claude Code 范式（对话式 agentic + tool use 循环 + 流式 + 工具透明）产品化为 Studio 团队级终端，替代 Qoder。

**产品形态**：Electron 桌面应用 + React UI + 本地 LLM 网关 + 银芯/黑池双引擎 + SVN 分发到内网。

**用户**：守密人（非程序员）+ Studio 团队成员（基于公开 AI 信息做项目，主线在内网 BPT 中跑）。

## 二、Prime Directive — Token 经济纪律（不可降级）

biav-desktop（前代）死因：tool call token 占对话 80%，schema 每轮重发、result 不截断、history 不压缩。BPT 全部架构决策围绕避免重蹈覆辙：

| 红线 | 内容 | 违反代价 |
|------|------|---------|
| T1 | tool schema 首轮发 + `cache_control: ephemeral`，命中率 < 80% 状态栏亮红 | 每轮多 2-5k token |
| T2 | tool result > 2000 token 必截断，完整版存 artifact | history 撑爆 |
| T3 | 对话 > 20 轮 或 > 60k token 触发滚动压缩（保留近 K 轮原文 + 之前压成摘要），用户可见可撤回 | history 无限膨胀 |
| T4 | active tool set 按档位最小化（chat 4 / work 10），切档时重发 schema 重置 cache | 9+ 工具常驻 = 每轮白花 3-5k |
| T5 | 每轮写结构化日志：6 维 token 分布（system/tools/history/generation/cache hit/cache write）+ cache 命中率 + 工具名 + 成本估算 | 额度透明无法兑现 |

**Phase 0 验收门槛**：「10 轮 token 预算测试」——挂 12 工具连问 10 题，input ≤ 30k（cache hit > 70%）/ output ≤ 10k。

## 三、Secondary Directive — 非程序员维护性

| # | 规则 |
|---|------|
| 1 | 单目录单 package.json，禁 monorepo / workspace / pnpm |
| 2 | 禁 self-evolve / 运行时动态代码加载（biav-desktop 字面 `\r\n` 污染源头） |
| 3 | 源码可读性 > 性能，宁啰嗦 if/else 也不晦涩管道 |
| 4 | 注释写「为什么」不写「是什么」 |
| 5 | TypeScript strict 全开，禁 `any` / `as unknown as` |
| 6 | 一文件一模块，无 `helpers.ts`/`utils.ts` 垃圾桶 |
| 7 | 业务代码写 assert，核心路径守不变式 |

## 四、双引擎数据层

```
┌─────────────────────────────────────────────────┐
│ Silver Core（小数据，已语义化）                 │
│   Tier 1 直接调用：UI/system prompt/管理操作    │
│   Tier 2 MCP：LLM 主动调用（4 工具白名单）      │
│   Tier 3 外部 MCP：LLM/UI                       │
│   工具：memory_search / graph_query /            │
│        graph_related_files / store_facts        │
│   砍掉的 5 个：rebuild_indexes / writeback /    │
│        check_cache / utility / recommend_context│
│        （走 Tier 1 不进 LLM schema）            │
├─────────────────────────────────────────────────┤
│ BPE — Black Pool Explorer（海量数据，自然语言） │
│   核心倒转：不让 LLM 搜大仓库，让用户搜→@Cite   │
│   架构：bge-m3 embedding → top-20 → Haiku       │
│        重排 → top-5 + 一句话摘要                 │
│   索引：3 个 SQLite（chunks/vectors/keywords    │
│        FTS5 兜底），随 SVN 分发                  │
│   LLM 暴露：bpe_semantic_search +                │
│        bpe_lookup_symbol，禁 grep/读全文/递归    │
│   chunking：tree-sitter 按 class/method（C#/Lua │
│        /Python/JS）+ 顶层 key（JSON/Lua 表/CSV） │
└─────────────────────────────────────────────────┘
```

**数据规模锚点**：百万行代码 + 120 个 1-2MB 配置 ≈ 11 万切片。

## 五、UI 档位制（Gear）

一 UI 双负载档位，切换在输入框旁，「像汽车换挡」。

| 档位 | 用途 | Active tools | Schema 成本 |
|------|------|--------------|------------|
| 对话档（默认） | 问答/讨论/分析 | 银芯读 + BPE 查询 ≈ 4 个 | ~1.5k token |
| 工作档 | 写代码/改配置/执行 | 对话档 + fs 读写 + 命令执行 + store_facts ≈ 10 个 | ~4k token |

**切档机制**：清 tool schema cache + 重发新 schema + 标记 `cache_control`；不清对话历史；切入工作档时弹确认提示。

## 六、四条 Day-0 差异化（对 Qoder）

1. **模型自由** — UI 直接切网关任意模型（Claude/GPT/国产），不重启不清对话
2. **额度透明** — 6 维 token + 人民币成本实时跟随
3. **工具可扩展** — 银芯内置 + MCP 标准协议外部 server + 配置目录热加载，白名单审计
4. **懂项目** — 双引擎出厂理解项目结构，不是「通用助手碰巧连了文件」

## 七、技术演进时间线（重要！）

| 阶段 | 日期 | 决策 | 状态 |
|------|------|------|------|
| BPT v0（母版） | 2026-04 早 | Electron + React + Vite + TS strict，自建 LLM/agent loop | 设计完成，未实施 |
| BPT-NEXT v0 | 2026-04-14 | 基于 `ruvnet/open-claude-code`（occ-local，JS MIT），相对路径 import 不 fork；BPT 在其上加档位 + 双引擎 | 设计完成，**当日作废** |
| BPT-NEXT v1 | 2026-04-14 晚 | 改基于 `instructkr/claw-code`（Rust，MIT 在 Cargo.toml）；银芯容器构建通过 9 crate / 51 秒 | 构建验证 OK，**4-19 删除** |
| 内网 BPT | 2026-04-19 起 | 整条战线撤出银芯，移到内网 SVN 重新部署；银芯转为指导者（人工搬运协议） | **当前** |

**关键教训**：BPT-NEXT 在 6 天内换了 2 次底层引擎（自建 → occ-local → claw-code），说明上游 LLM agent 框架选型是 high-churn 决策点。内网重启时**不要再赌某个开源 agent 框架**——除非守密人已确认其上游稳定性。

## 八、4-19 删除时已确认的设计取舍

1. 另起 `projects/bpt/` 不重构 biav-desktop（self-evolve 毒 + `\r\n` 污染 + 16 路 IPC 全注册反模式）
2. Electron 不 Tauri（MCP spawn Python 自然 + TS 生态）
3. 银芯 MCP 从 9 砍 4（schema 成本腰斩）
4. BPE 不让 LLM 自由搜（精确复现 biav-desktop 死因条件）
5. bge-m3 不更小模型（120 个 1-2MB 配置切片可能 > 512 token，bge-base 会截断）
6. Phase 0 BPE 用 FTS5 兜底（sqlite-vss 跨平台编译有风险）

## 九、未解决的悬置问题（4-19 时点）

1. **公司网关是否兼容 `cache_control`** — 不兼容则 T1 红线失守，token 经济崩盘。退路：手动 system prompt 复用策略
2. **bge-m3 2.2GB SVN 首次下载** — 内网文件服务器单独分发可缓解
3. **sqlite-vss 跨平台编译** — Phase 0 用 FTS5，不堵交付
4. **tree-sitter C# 对 Unity 特殊语法支持** — fallback 按行数固定切（每 30 行一块）
5. **Haiku 重排质量** — 不稳定时退到纯向量相似度排序
6. **claw-code 上游 LICENSE** — 4-14 验证时 Cargo.toml 声明 MIT，根目录无 LICENSE 文件，建议守密人提 Issue 让上游补

## 十、银芯 → BPT 单向输出清单（4-26 锁定）

BPT 内网消费银芯公开数据的来源（黑池→银芯方向**完全关闭**）：

| 类别 | 路径 | 频率 |
|------|------|------|
| 运营数据 | `projects/news/output/*.json` / `daily-latest.md` | 每日 2 次 |
| 角色数据库 | `projects/wiki/data/db/characters.json` | Phase 2 多次 |
| Wiki 内容 | `projects/wiki/docs/**/*.md` | Phase 2 中后期 |
| 事实圣经 | `assets/data/*.json` | 低频 |
| 决策/方法论 | `memory/decisions.md` / `lessons-learned.md` / `methodology.md` | 持续 |

**传输机制**：BPT 侧自行 `git pull` 银芯公开仓库；银芯不主动 push 到 BPT（够不到内网）。

详见 `memory/archive/bpt-strategic-shift-2026-04-19/silver-blackpool-interface.md`。

## 十一、UI 视觉规范红线（来自 BPT-Desktop v0.1.15 逆向）

非程序员用户的肌肉记忆，下一代 BPT 重构时不可降级的 10 条：

1. 衬线默认（Noto Serif SC）body 级别
2. 金色 h3（Markdown 标题品牌视觉主锚）
3. 工具步骤微光（`toolShimmer` 2.5s 金色扫光）
4. 亮/暗双主题对等（独立调校，非简单反色）
5. CSS 变量三通道分离（`245 242 235` 不是 `#F5F2EB`）
6. 流式 25ms tick + blur 淡入（字符逐个 blur(2px) → blur(0)）
7. 侧边栏 `conv-title` 渐变 mask 截断
8. macOS 标题栏 `pl-[72px]` 让出红绿灯
9. Electron `nodeIntegration: false` + `contextIsolation: true`
10. IPC 通道名常量化（`channels.ts` preload/types/main 三方契约）

**IPC 命名空间**：`window.biav.*`（不是 `window.bpt.*`，4-14 守密人原文裁定）。

---

## 附录 A：归档目录速查

`memory/archive/bpt-strategic-shift-2026-04-19/`

| 文件 | 大小 | 主题 |
|------|------|------|
| `bpt-master-plan.md` | 26 KB | BPT 总规划 v2（本文主要摘录源） |
| `bpt-next-design.md` | 15 KB | bpt-next 旧版（occ-local 路径，4-14 当日作废） |
| `bpt-next-build-verification.md` | 6.5 KB | bpt-next 新版（claw-code 路径）银芯构建验证 |
| `bpt-desktop-design-spec-ref.md` | 4 KB | bpt-desktop UI 视觉规范入口 |
| `blackpool-architecture.md` | 16 KB | 黑池系统架构（BPT 消费的数据源） |
| `black-pool-design.md` | 9.5 KB | 黑池设计原始稿 |
| `silver-blackpool-interface.md` | 5.5 KB | 银芯-黑池单向接口规范（4-26 锁定） |

## 附录 B：本文与活档的关系

| 文件 | 关系 |
|------|------|
| `memory/bpt-guidance-protocol.md` | 当前活协议（v0.2，含 Code-BPT 角色） |
| `memory/bpt-architecture-snapshot-2026-04-19.md`（本文） | 4-19 冻结点基线，搬运包上下文锚 |
| `memory/bpt-architecture-summary-template.md` | 内网实例周更模板，由守密人搬回反馈包 |
| `memory/bpt-guidance-log.md` | 待创建——每轮搬运成果一行一条 |
