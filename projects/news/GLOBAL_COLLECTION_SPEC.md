# 全球 Morimens 信息采集规定（GLOBAL_COLLECTION_SPEC）

> 版本：v1.0 ｜ 制定：2026-06-03 ｜ 适用：news 子项目（使命#1 黑池公开信息入口）
> 性质：采集覆盖范围与接入纪律的**权威规定**。新增/调整数据源前必读，与 `sources.py`
> （单一真相源）配套执行。本规定只引用公开可查阅信息（CLAUDE.md §0）。
>
> 文档分工：
> - 本文 = **覆盖范围 + 接入协议 + 优先级**（规定层，回答「采什么、按什么纪律采」）
> - `COLLECTION_ARCHITECTURE.md` = 采集系统架构（实现层，回答「怎么跑」）
> - `scripts/sources.py` = 源清单代码真相源（回答「当前在产线采哪些」）

---

## §1 目标与范围原则

news 是黑池的「眼睛和耳朵」，目标是把**全世界**公开的 Morimens 相关信息单向汇入黑池。
本规定据 2026-06-03 全球语区实证勘测（见 §2）划定采集边界。

**三条范围原则：**

1. **覆盖跟着玩家走，不跟着官方运营走。** 官方无本地化、但有自发社区的语区（如韩区
   Arca.live、泰区 FB 群）同样是高价值目标；客户端支持但无独立社区的语区（拉美葡西、
   欧洲法德意）不单独投入采集。
2. **结构化源优先于论坛文本。** 已结构化的第三方数据库（Kaiden.gg / 灰机wiki / 日系
   攻略 wiki）信息密度远高于散落讨论，应作为解析首选。
3. **诚实边界，不臆造覆盖。** 经检索明确未发现 Morimens 存在的语区/平台（见 §2.3）
   不列为采集目标，不投入工时，不在报告中虚构其覆盖（CLAUDE.md §4.2 R1）。

---

## §2 语区 × 平台覆盖矩阵（2026-06-03 实证基线）

价值分级：**P0** 高价值且当前易漏 ｜ **P1** 高价值已部分覆盖 ｜ **P2** 长尾/低成本补位 ｜ **—** 明确不投入。

### §2.1 已确认存在的语区与主阵地

| 语区 | 官方本地化 | 玩家主阵地（采集目标）| `sources.py` 现状 | 价值 |
|------|-----------|---------------------|------------------|------|
| 简中（中国大陆）| 是 | TapTap 官方论坛 / B站官方号 + 攻略组 / 微博「忘却前夜记录局」/ **灰机wiki** / GameKee | taptap·bilibili·weibo 已采；**灰机wiki 未采** | P1 |
| 繁中（港澳台新马）| 是（独立官网）| **巴哈姆特哈啦板**（bsn=78829，台服主聚集地）/ QooApp | bahamut 已列 | P1 |
| 英语（全球版）| 是 | 官方 Discord(主~48.9k/全球~36k) / 官方 X @MorimensOfcl / 官方 FB / **Kaiden.gg** / Fandom·Miraheze | discord 已采；**Kaiden.gg 未采** | P0 |
| 日本 | 是（日服 2025-08 上线）| 官方日服 X / **Gamerch·WikiWiki·GameWith 三件套** / Note 攻略 / 4Gamer | note_com 已列；**日系 wiki 未采**（gamerch 在 LEGACY）| P0 |
| 韩国 | 半官方（韩文+民间翻译）| **Arca.live「망각전야 채널」**（最活跃主阵地）/ Namu wiki / Naver Cafe | arca_live·naver_cafe 已列，**频道精度待核实** | P0 |
| 东南亚（泰）| 全球版覆盖 | FB 群「Morimens Thailand [TH]」 | 未采 | P2 |
| 俄语 | 客户端 AI 翻译，无独立运营 | StopGame / DTF / 4PDA / Steam 俄语区 | stopgame 已列 | P2 |

### §2.2 第三方结构化数据库（跨语区高价值，单独立项）

| 站点 | 语言 | 内容 | 价值 | 备注 |
|------|------|------|------|------|
| **Kaiden.gg** | 英 | 角色库 + 命轮(Wheels) + tier list + 指南，活跃更新 | **P0** | 含 Erica 等角色页，可直接结构化解析 |
| **灰机wiki** morimens.huijiwiki.com | 简中 | 结构化角色/剧情维基 | P1 | 中文结构化盲区 |
| 日系 wiki（Gamerch / WikiWiki / GameWith）| 日 | 日服三大攻略 wiki，UGC 密度全球最高 | P0 | gamerch 现为 LEGACY，需重新评估激活 |
| Namu wiki | 韩 | 结构化词条 | P1 | — |
| Fandom / Miraheze | 英 | Awakers 四域(Caro/Chaos/Ultra/Aqueor)分类 | P2 | 质量中等 |

### §2.3 明确未发现 / 不投入（诚实边界）

下列为 2026-06-03 检索**明确未命中**或**确认无效**，不列为采集目标，禁止虚构覆盖：

- **Reddit 专属 subreddit**：未发现活跃专版（CONTEXT.md M2「确认 r/Morimens」结论 = 待
  再核实，当前不应假定存在繁荣专版）。
- **VK / 韩国 Inven / 韩国 DCInside**：均未发现 Morimens 专属板。
- **中东阿语区**：无本地化、无社区，确认无源。
- **拉美葡西 / 欧洲法德意**：客户端语言支持，但无独立社区，不单独投入。
- **Prydwen.gg**：核实为他游（Chaos Zero Nightmare），**不是** Morimens 源，剔除。
- **MementoMori / Game8 相关 tier 表**：他游同名干扰，剔除（CLAUDE.md §4.2 R1 纠偏）。

---

## §3 信息源接入协议（onboarding，硬规则）

新增任何数据源，必须按序完成全部 4 步，缺一不可（防止历史「采了不归档/归档了不审计」漂移）：

1. **登记单一真相源**：在 `scripts/sources.py` 写入规范源名，并按语义归入
   `KNOWN_SOURCES` / `CORE_SOURCES` / `SPARSE_SOURCES` / `BACKFILL_PLATFORMS` 之一或多个。
   源名归一化走 `SOURCE_ALIASES`。
2. **双路径登记（CLAUDE.md §4.1 硬约束）**：同时确认并记录该源的
   - 全量档案层路径：`data/platforms/{source}/YYYY-MM-DD.json`（Discord 走独立 `data/discord/`）
   - 输出展示层路径：`output/{source}-latest.json`
   两层语义不可互换，缺任一层不得上线。
3. **接入健康门控**：核心源纳入 `CORE_SOURCES`，由 `silent_sources_audit.py` 监控；
   长期 0 产出按 7 天降级 / 30 天休眠规则处理。停产但留有历史归档的源移入 `LEGACY_SOURCES`，
   不得直接删除（保留审计可见性）。
4. **更新文档**：在本规定 §2 矩阵登记语区/价值分级，在 `COLLECTION_ARCHITECTURE.md`
   登记采集方式。

**采集方式选型优先级**（成本与稳定性递减）：
官方/平台 API（有 key）→ RSS/JSON 端点 → 结构化页面解析（wiki/数据库站）→ Playwright 浏览器回退（反爬/登录态站点）。
能用 API 不用爬虫；能解析结构化页面不抓散落论坛文本。

---

## §4 多语言关键词规范

`global_collectors.py:KEYWORDS` 是全球召回的入口。现状：中/日/韩有本地化变体，其余语区
**仅单拉丁词 "Morimens"**，召回率存疑。规定如下：

1. **中/日/韩**：保留本地化全称 + 罗马音/英文混写变体（现状达标）：
   - zh：忘却前夜、忘卻前夜 ｜ ja：忘却前夜、モリメンス ｜ ko：망각전야、모리멘스、Morimens
2. **拉丁字母语区**：除 "Morimens" 外补大小写/词形变体（morimens / MORIMENS），并按平台
   附加平台内常用 tag（如官方 X handle @MorimensOfcl、日服 handle）作为检索锚点。
3. **关键词只增不默删**：删除任何关键词需在 commit message 说明依据，避免静默缩小召回。
4. **干扰词排除**：MementoMori、Chaos Zero Nightmare 等同名/近名他游须在解析层排除
   （CLAUDE.md §4.2 R1）。

> 说明：本规定属规定层，KEYWORDS 的实际代码修改由 Code-news 按 §3 协议执行
> （CONTEXT.md 派发纪律：主控台不亲自动 news 业务代码）。

---

## §5 数据纪律（援引 CLAUDE.md §4，采集场景强化）

1. **全量 vs 输出（§4.1）**：长窗口分析 / 完整性审计 / 情感长尾 / 历史回溯**必须**用
   全量档案层；日报 / 快查 / 热度榜用输出层。把输出层当全量 = 抽样率失真（lesson #30）。
2. **R1 整次失败（§4.2）**：多语区/多平台并行采集，任一子调用失败 = 整次失败，禁止从
   剩余成功输出提取数据生成「全球覆盖」结论。
3. **R2 事实只从直接产出引用（§4.2）**：源数量 / 条目数 / 社区规模等数字只能从直接产出
   该事实的工具或来源引用，禁止 grep 外推。社区规模（如 Discord ~48.9k）须标注来源与时间。
4. **R3 规定 ≠ 已实施（§4.2）**：本规定的覆盖矩阵是**目标与建议**，不等于「已落盘采集」。
   引用某源覆盖状态须以 `sources.py` 实际清单为准，区分「规定目标 vs 产线现状」。

---

## §6 落地路线图（对接 CONTEXT.md M2 信息齐备）

按 §2 价值分级排期，P0 优先：

| 优先级 | 任务 | 验证标准 |
|--------|------|---------|
| P0-1 | 核实并固定韩区 Arca.live「망각전야 채널」频道，确认 `arca_live` 实际产出 | data/platforms/arca_live/ 有连续日产出 |
| P0-2 | 新增 Kaiden.gg 结构化抓取（角色/命轮/tier）| 登记 sources.py + 双路径，首次产出非空 |
| P0-3 | 重评日系 wiki 三件套（Gamerch/WikiWiki/GameWith），将 gamerch 从 LEGACY 激活或确认废弃 | 决议落 sources.py，附依据 |
| P1-1 | 新增灰机wiki（简中结构化）+ 接通巴哈姆特哈啦板产出核实 | 双路径登记，产出非空 |
| P1-2 | 按 §4 补齐拉丁语区关键词变体 | KEYWORDS 更新 + 召回回归测试 |
| P2-1 | 低成本补位：泰国 FB 群 / 俄语 StopGame·DTF（FB Graph / 论坛 RSS）| 纳入 SPARSE_SOURCES，宽时间窗 |
| — | 阿语区 / Reddit 专版 / VK / Inven / DCInside：不投入，除非出现新证据 | 不立项 |

文档维护：每次按 §3 接入新源，同步更新本规定 §2 与 §6；覆盖矩阵的实证基线每季度复勘一次。
