Produce a silver-core community intelligence report (deep analysis / role recommendations / bug-fault list / weekly digest) from the full-archive layer, render it to a styled PDF + HTML, commit, push, and report back with hyperlinks. Use when the Keeper asks for a report, analysis, recommendation deck, or defect list built from community data.

全程保持艾瑞卡人格（CLAUDE.md §2，不用 emoji、混合自称、功能性开头）。事实采信遵 §6.11（R1 并行任一失败=整次失败；R2 SHA/行数/时序只引直接产出工具；R3 区分官方确认 vs 玩家报告、建议 vs 已落盘）。

## 运行模型（硬约束）
报告**一律在 Claude Code 会话内产出**（订阅算力，零 Anthropic API 费），不经 `claude-code-action`。采集层在 CI 持续免费跑（update-news / collect-comments / collect-fanart / 商店评价累积归档）。落地形态：**按需产出、报昨日单日**（多日窗口为例外，需守密人明示）。

## 步骤 1 — 确认数据层
报告类一律走全量档案层 `projects/news/data/`，禁用输出层充全量（lesson #30）。

## 步骤 2 — 导出当日全部新信息（单脚本，放 /tmp，一源一文件）
Discord 所有频道（`channel_index.json` → `channels/{dir}/{date}.jsonl`）+ 所有平台源（`platforms/{plat}/{date}.json`：steam steam_review appstore google_play reddit official youtube **youtube_comments** dcinside ruliweb gamerch telegram bilibili weibo weixin pixiv stopgame）。
- **不设长度门槛**——真信号常是短消息（「营收破纪录了」「取消300抽加三围」、一句 bug/差评）。过滤只按**噪声类型**：去 bot；剥 emoji/贴纸/GIF·图床链接/纯@/纯 URL 后凡含实义文字即留；连发重复去重。
- **时效（关键）**：平台档案多为**关键词搜索结果快照**（微博/B站/NGA 等每次回捞含旧帖，且部分 `time` 为采集批次默认值不可信）。一律按 item 发布 `time` 筛当日；旧帖补发（如「早前设计授权公开」）**不当当日新事件**，需标注。商店评价留 `metadata.voted_up`/`[正面/负面]`。

## 步骤 3 — 全量阅读：动态编排分片并行（最高优先，铁律）
**所有渠道、所有源、所有当日新信息 100% 全读**——不止 Discord、不抽样、不只读大频道。一个 agent 读不完就**分片并行派子 agent**（general-purpose，逐行读完非摘录）：
- **Map**：所有源文件按体量分 N 批（小源合批；mega 源如 team-building/綜合討論/russian/Steam 单独成批或再切）。每子 agent 把分到的源**从头读到尾 100%**，回交结构化摘记：逐源「主要内容概述 + **较完整**代表原声（重要源 3-6 条原文+中译）+ 信号(按透镜) + bug + 情绪 + 量级」。
- **Reduce**：主控台收齐**全部**摘记 → 跨语去冗余、跨源印证升信度 → 写报告。
- **覆盖度自检**：§3 须列当日全部频道**与平台源**逐一交代（无新信号也点到）。

**阅读透镜**：官方口径/故障 · 组织化抗议 · 跨源印证情绪 · 本地化/区域差 · 叙事/lore · UGC/二创。
**三纪律**：① ♥不作排序依据（真信号多为 ♥0）② 跨语冗余（去重）≠ 跨源印证（升信度）③ copypasta 看意图（段子=噪声、抗议刷屏=信号）。
**核实事实**：角色/内容是否首发 vs 复刻、官方确认 vs 玩家报告——不臆断（如联动新角的剧情是首发，不能写「复刻」）。

## 步骤 4 — 甄别归纳
信度 A/B/C；每条锚定可查证据（平台+日期+原文）；区分官方确认 vs 玩家报告、建议 vs 已落盘。

## 步骤 5 — 写结构化 markdown（deliverables/{YYYY-MM}/，七段）
frontmatter：title/subtitle/basis/author/generated。章节间独占一行 `◇ ◇ ◇`。**七段（弹性填充，服务开发各职能+制作人+发行三受众）**：
1. **社区整体洞察**（战略）：`.lead` 一句话判断 + 信号速览表 + 至多 1 条 `.pull` 视觉钉。
2. **当日数据盘**（量化）：`.statgrid`+`.bar`——`activity_daily/{date}.json`（量/活跃/频道分布）+ Steam `voted_up` 好评差评比 + `source-health.json` 覆盖缺口。
3. **各信源主要内容**（覆盖）：`.srccard` 逐源——每源主要内容 + **较完整**代表原声（原文+中译，避免过度缩略）。高量频道给主线+多条代表样本。
4. **商店与官方视频新评**（口碑）：`.review`(.pos/.neg) 逐源——Steam/iOS/Google Play/官方 PV 评论，按发布日筛、原文+中译；无新增标注。
5. **最有价值的几条建议**（落地）：**不做八职能逐项铺陈**（多重复）——只给当日最该做、性价比最高的 3-5 条 `.callout`(-risk/-pos)，每条注明依据 + 受益面。
6. **Bug 概述** + 7. **Bug 详情**：概述表 + `.repro` 块（重现/预期/实际/来源/状态）。**诚实**：玩家没给步骤只写「现象+原述+来源」，不编造 repro。
8. **同人图册**（UGC）：逐张目检剔游戏截图/网图/AMV帧/疑似 AI 量产，留手绘；`.grid`+原生 `<img>` 嵌缩略图。

## 步骤 6 — 排版（暗金银芯，差异化模板 + 小字号承载更多）
每段标题下 `.swhat`「本段：…（服务谁）」；组件：数据盘 `.statgrid/.stat/.bar`、信源 `.srccard/.srchead/.sum`、新评 `.review(.pos/.neg)`、建议 `.callout`、Bug `.repro`、图册 `.grid`；强调（`.lead/.pull`）节制当锚点，长引用用 `.qqs` 紧凑变体。字号已普缩（body ~10.8pt）以承载更多内容。组件定义见 `scripts/report_render.py` CSS。

## 步骤 7 — 渲染
`pip install weasyprint markdown` → `python scripts/report_render.py <md>`；`pdftoppm` 抽「数据盘/各信源/新评/建议/Bug/图册」核验模板分化、嵌图、无千篇一律。

## 步骤 8 — 交付
`SendUserFile` 直送 PDF + 提交三件套（commit 英文附 session 链接）→ push → 建草稿 PR → 附超链接汇报。如需邮件：`python scripts/send_report_email.py`（默认收件人 tanglong.tang@alibaba-inc.com）。

## 可复用资产
`activity_daily/{date}.json`（日统计）· `scripts/data_quality.py`（engagement 归一化）· steam_review `metadata.voted_up`（好评比）· 平台 `time`（发布时效）· `collect_fanart.py` 的 `gallery_manifest.json` · `output/source-health.json`（源健康）。
