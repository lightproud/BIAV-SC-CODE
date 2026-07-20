# 全球 Morimens 信息采集规定（GLOBAL_COLLECTION_SPEC）

> 版本：v1.1 ｜ 制定：2026-06-03 ｜ 适用：news 子项目（使命#1 黑池信息入口）
> 性质：采集覆盖范围与接入纪律的**权威规定**。新增/调整数据源前必读，与 `sources.py`
> （单一真相源）配套执行。本规定只引用公开可查阅信息（CLAUDE.md §0）。
>
> **v1.1 守密人裁定（2026-06-03）**：WIKI 类结构化站（Kaiden.gg / 灰机wiki / 日系攻略
> wiki / Namu / Fandom 等）**完成度不一且会带来数据混淆，不入库**，降为「观察动态层」
> （见 §2.4，仅追踪不进采集管线）。其余非 wiki 源全部深入推进，接入规格见 §6。
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
2. **WIKI 类不入库，只观察动态。** 第三方结构化数据库 / 攻略 wiki（Kaiden.gg / 灰机wiki /
   日系攻略 wiki 等）完成度不一、且会与社区 UGC 数据混淆，按守密人裁定不进采集管线，
   仅作动态观察（§2.4）。采集入库目标聚焦社区 UGC / 官方渠道 / 商店评价。
3. **诚实边界，不臆造覆盖。** 经检索明确未发现 Morimens 存在的语区/平台（见 §2.3）
   不列为采集目标，不投入工时，不在报告中虚构其覆盖（CLAUDE.md §4.2 R1）。

---

## §2 语区 × 平台覆盖矩阵（2026-06-03 实证基线）

价值分级：**P0** 高价值且当前易漏 ｜ **P1** 高价值已部分覆盖 ｜ **P2** 长尾/低成本补位 ｜ **—** 明确不投入。

### §2.1 已确认存在的语区与主阵地（采集目标，UGC/社区/商店）

「接入现状」据 2026-06-03 `global_collectors.py` 实现盘点；不含 wiki 类（wiki 见 §2.4 观察层）。

| 语区 | 官方本地化 | 玩家主阵地（采集目标）| 接入现状 | 价值 |
|------|-----------|---------------------|---------|------|
| 简中（中国大陆）| 是 | TapTap 官方论坛 / B站官方号 + 攻略组 / 微博「忘却前夜记录局」/ 小红书 / 知乎 | taptap·bilibili·weibo·zhihu **已实装真采** | P1 |
| 繁中（港澳台新马）| 是（独立官网）| **巴哈姆特哈啦板**（bsn=78829，台服主聚集地）/ QooApp | bahamut **已实装**（搜索模式；BSN 模式待配置，见 §6 P1-1）| P0 |
| 英语（全球版）| 是 | 官方 Discord(主~48.9k/全球~36k，据外部检索) / 官方 X @MorimensOfcl / 官方 FB | discord 已采；X/FB **占位未实装**（需 token，见 §6）| P0 |
| 日本 | 是（日服 2025-08 上线）| 日服官方 X @bokyakuzenya / Note 攻略 / 5ch / 4Gamer | note_com·fivech **已实装真采** | P1 |
| 韩国 | 半官方（韩文+民间翻译）| **Arca.live「망각전야 채널」**（forgettingeve，最活跃主阵地）/ Naver Cafe | arca_live·naver_cafe **已实装真采**（待核实产出，见 §6 P0-1）| P0 |
| 东南亚（泰）| 全球版覆盖 | （原 FB 群目标已放弃，见 §2.3）→ 转官方 Discord 泰语内容 / 官方 FB 主页 | 经 Discord 间接覆盖 | P2 |
| 俄语 | 客户端 AI 翻译，无独立运营 | **DTF**（dtf.ru，有公开 API）/ StopGame / Steam 俄语区 | stopgame 已实装；**DTF 未采**（真缺口，见 §6 P1-2）| P2 |

### §2.2 占位未实装（需 token / 政策受限）

| 源 | 语区 | 现状 | 接入条件 |
|----|------|------|---------|
| twitter/X | 全球 | 占位无 fetch 函数 | 需 `TWITTER_BEARER_TOKEN`（付费），目标 handle @MorimensOfcl / @bokyakuzenya |
| facebook | 全球 | 占位无 fetch 函数 | 仅官方 **Page**（MorimensOfficial）可走 Graph API，需 App Review；**FB 群已无 API**（§2.3）|
| tiktok / instagram / twitch | 全球 | 占位无 fetch 函数 | 各需 OAuth/token，优先级低 |

### §2.3 明确未发现 / 不投入（诚实边界）

下列为 2026-06-03 检索**明确未命中**或**确认无效**，不列为采集目标，禁止虚构覆盖：

- **泰国 FB 群「Morimens Thailand [TH]」**：Meta 已于 2024-04 彻底废弃 Facebook Groups
  API，无合规程序化读群帖通道，无可靠替代。**放弃**该群本体，泰语信号改由官方 Discord
  泰语内容 / 官方 FB 主页（Page 路径）间接覆盖。
- **Reddit 专属 subreddit**：未发现活跃专版（CONTEXT.md M2「确认 r/Morimens」结论 = 待
  再核实，当前不应假定存在繁荣专版）。
- **VK / 韩国 Inven / 韩国 DCInside**：均未发现 Morimens 专属板。
- **中东阿语区**：无本地化、无社区，确认无源。
- **拉美葡西 / 欧洲法德意**：客户端语言支持，但无独立社区，不单独投入。
- **Prydwen.gg**：核实为他游（Chaos Zero Nightmare），**不是** Morimens 源，剔除。
- **MementoMori / Monochrome Mobius / Game8 相关 tier 表**：他游同名/近名干扰，剔除
  （CLAUDE.md §4.2 R1 纠偏）。

### §2.4 WIKI 观察动态层（守密人裁定：不入库）

WIKI 类结构化站**完成度不一、且会与社区 UGC 数据混淆**，守密人 2026-06-03 裁定**不进采集
管线、不进 `sources.py` 产线清单、不进全量档案层**。仅作「观察动态」用途：人工/做梦
Agent 按需追踪线索，不自动入库，不计入覆盖率统计。

| 站点 | 语言 | 内容 | 观察用途 |
|------|------|------|---------|
| Kaiden.gg | 英 | 角色 + 命轮 + tier，活跃更新 | 角色/数值动态线索（检索曾命中 Erica 页）|
| 灰机wiki morimens.huijiwiki.com | 简中 | 结构化角色/剧情 | 中文结构化参照 |
| 日系 wiki（Gamerch / WikiWiki / GameWith）| 日 | 日服攻略 | 日服攻略动态 |
| Namu wiki | 韩 | 结构化词条 | 韩区词条动态 |
| Fandom / Miraheze | 英 | Awakers 四域分类 | 英文设定参照 |

> 注：`sources.py:LEGACY_SOURCES` 中的 `gamerch` / `miraheze_wiki` 维持遗留状态（仅历史
> 归档可见），**不重新激活入库**，与本裁定一致。

---

## §3 信息源接入协议（onboarding，硬规则）

新增任何数据源，必须按序完成全部 4 步，缺一不可（防止历史「采了不归档/归档了不审计」漂移）：

1. **登记单一真相源**：在 `scripts/sources.py` 写入规范源名，并按语义归入
   `KNOWN_SOURCES` / `CORE_SOURCES` / `SPARSE_SOURCES` / `BACKFILL_PLATFORMS` 之一或多个。
   源名归一化走 `SOURCE_ALIASES`。
2. **双路径登记（CLAUDE.md §4.1 硬约束）**：同时确认并记录该源的
   - 全量档案层路径：`Public-Info-Pool/Record/Community/{source}/YYYY-MM-DD.json`（Discord 走 `Public-Info-Pool/Record/Community/discord/`；2026-06-21 BPT 4R 迁移，原 `data/platforms/`·`data/discord/` 根已废）
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
   - ru：补 `Морименс`（俄文译名，现状仅拉丁 Morimens）
2. **拉丁字母语区**：除 "Morimens" 外补大小写/词形变体（morimens / MORIMENS），并附平台内
   检索锚点（已确认）：
   - 官方 handle：全球 X **@MorimensOfcl**；日服 X **@bokyakuzenya**；官方 FB 主页 **MorimensOfficial**；Steam AppID **3052450**
   - 通用 hashtag：**#Morimens**
3. **关键词只增不默删**：删除任何关键词需在 commit message 说明依据，避免静默缩小召回。
4. **干扰词排除（已确认须排除）**：`MementoMori`、`Monochrome Mobius` / `Mobius`、
   `Chaos Zero Nightmare`（Prydwen 误收）等同名/近名他游；handle 须按精确拼写过滤，
   排除 `@Morimenss`（双 s）、`@morimen`（日文「森」个人号）（CLAUDE.md §4.2 R1）。

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

按 §2 价值分级排期，P0 优先。**全部为非 wiki 源**（wiki 已按裁定移出，§2.4）。
接入规格据 2026-06-03 实测（HTTP 200 / 选择器 / 端点均为实证，未确认项已标注）。

| 优先级 | 任务 | 接入规格（实证）| 验证标准 |
|--------|------|----------------|---------|
| **P0-1** | 核实韩区 `arca_live`（已实装）实际产出，修正抽样失真 | requests + 浏览器 UA（非默认 UA，否则 403）抓 `arca.live/b/forgettingeve?p=N`，解析 `a.vrow.column`；**剔除** `notice-*`/`filtered` 置顶行；时间用 `.col-time` 内 `<time datetime>` ISO8601；间隔 ≥2s，cloudscraper 兜底 challenge。**无需 Playwright/登录** | Public-Info-Pool/Record/Community/arca_live/ 有连续日产出且不含置顶噪声 |
| **P1-1** | 巴哈姆特（已实装搜索模式）升级为板内直采 | 配 `BAHAMUT_BSN=78829`；requests + 浏览器 UA 抓 `B.php?bsn=78829&page=N`，解析 `.b-list__row`；**剔除** `.b-list__row--sticky`；时间 `.b-list__time__edittime` 为繁中文本需自写解析器。**无需 Playwright/登录** | bahamut 产出来自 78829 板、含 GP/回复数、置顶已剔 |
| **P1-2** | 新增 `dtf`（俄语真缺口）| DTF 官方 API `https://api.dtf.ru/v1.6`：`GET /layout/hashtag/morimens` 探测，无果退站内搜索；**必带** 规范 `User-Agent`，限速 **≤3 req/s**；字段映射 Entry/Comment 模型。按 §3 登记 sources.py + 双路径 | dtf 首次产出非空（或确认 DTF 无 Morimens 内容后移入 §2.3）|
| **P1-3** | StopGame（已实装 HTML）补 RSS 提升稳定性 | 补 `rss.stopgame.ru/rss_news.xml`·`rss_review.xml`·`rss_preview.xml` + 关键词 `Morimens`/`Морименс` 过滤；评分/评测仍爬词条页 | RSS 路径产出非空 |
| **P2-1** | 按 §4 补齐 ru 关键词 `Морименс` + 拉丁锚点/干扰词排除 | KEYWORDS 增 `Морименс`，解析层加干扰词黑名单 | 召回回归 + 干扰词不入库 |
| **P2-2** | twitter/X、facebook Page：占位转实装（如守密人批 token）| 见 §2.2 接入条件 | token 就位后实装 |
| — | 泰 FB 群 / 阿语区 / Reddit 专版 / VK / Inven / DCInside / 全部 wiki 入库：不投入 | — | 不立项 |

文档维护：每次按 §3 接入新源，同步更新本规定 §2 与 §6；覆盖矩阵的实证基线每季度复勘一次。
未确认项（Arca board 列表 JSON 端点、两站速率阈值、巴哈留言 Ajax 端点、DTF Morimens tag 是否存在）由 Code-news 开发时抓包核实，不外推。
