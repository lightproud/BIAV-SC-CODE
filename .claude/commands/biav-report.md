Produce a silver-core community intelligence report (deep analysis / role recommendations / bug-fault list / weekly digest) from the full-archive layer, render it to a styled PDF + HTML, commit, push, and report back with hyperlinks. Use when the Keeper asks for a report, analysis, recommendation deck, or defect list built from community data.

全程保持艾瑞卡人格（CLAUDE.md §2，不用 emoji、混合自称、功能性开头）。事实采信遵 §6.11（R1 并行任一失败=整次失败；R2 SHA/行数/时序只引直接产出工具；R3 区分官方确认 vs 玩家报告、建议 vs 已落盘）。

## 运行模型（硬约束）
报告**一律在 Claude Code 会话内产出**（订阅算力，零 Anthropic API 费），不经 `claude-code-action`。数据采集层在 CI 持续免费跑（update-news / collect-comments / collect-fanart / 商店评价累积归档），只用 Discord/YouTube 等 key。落地形态：**按需产出，报昨日单日**（多日窗口为例外，需守密人明示）。

## 步骤 1 — 确认数据层（§4 硬约束）
报告类一律走全量档案层 `projects/news/data/`，禁用输出层充全量（lesson #30）。

## 步骤 2 — 导出当日全部新信息（单脚本，放 /tmp）
把当日 **Discord 所有频道 + 所有平台源**的当日新内容导出，**一源/一频道一文件**：
- Discord：`discord/channel_index.json` 映射 `{id→{name,dir}}`；消息在 `channels/{dir}/{date}.jsonl`（字段 content/author_id/author_bot/timestamp/reactions/attachments）。
- 平台（17+ 目录，凡当日有新条目即导）：steam steam_review appstore google_play reddit official youtube **youtube_comments** dcinside ruliweb gamerch telegram bilibili weibo weixin pixiv stopgame。字段 title/summary/content/lang/url/time/engagement；steam_review 留 `metadata.voted_up` 与 `[正面/负面]`。
- **不设长度门槛**——真信号常是短消息（「营收破纪录了」「取消300抽加三围」、一句 bug、一句差评）。过滤只按**噪声类型**：去 bot；剥 emoji/贴纸/GIF·图床链接/纯@/纯 URL 后凡含实义文字即留；连发重复去重。

## 步骤 3 — 全量阅读：动态编排分片并行（最高优先，铁律）
**所有渠道、所有源、所有当日新信息，无一例外 100% 全读**。不是只读 Discord、不是平台抽样、不是只读两个大频道。一个 agent 读不完就**分片并行派子 agent**（map-reduce）：
- **Map**：把所有源文件按体量分 N 批（小源合批；mega 源如 team-building/game-question/russian/Steam 评价单独成批或再切）。并行派多个子 agent（Explore / general-purpose），每个把分到的源**从头读到尾 100%**，回交结构化摘记：逐源「主要内容概述 + 代表原声原文 + 信号(按下方透镜) + bug + 情绪倾向 + 量级」。
- **Reduce**：艾瑞卡收齐**所有**子 agent 摘记 → 跨语去冗余、跨源印证升信度 → 写报告。
- **覆盖度自检**：报告须能列出当日有数据的**全部频道与平台源**清单，逐一有交代（哪怕「该源当日无新信号」也要点到）。杜绝「只读了几个 / 只读了 DC」。

**阅读透镜**（读时按这些信号类型提取）：官方口径/故障（official-q-a、game-announcement 带状态标签）· 组织化运动/抗议 · 跨源印证的情绪 · 本地化/区域差 · 叙事/lore 深度 · UGC/二创。

**三条判断纪律**：① ♥反应数**不作排序依据**（真信号多为 ♥0，按 ♥ 排只顶出段子）② 跨语冗余（同一 tier list 多语复读=去重）≠ 跨源印证（同一信号多源独立出现=升信度）③ copypasta 看意图（贫富段子=噪声；抗议刷屏=信号）。

**时效**：平台/PV 一律按**发布日**（记录 `time` 字段，区别采集时间）筛；预热内容不充当窗口当日热度。

## 步骤 4 — 甄别归纳
信度 A（硬事实可复算）/ B（多源归纳）/ C（推断需标注）；每条锚定可查证据（平台+日期+原文片段），禁止无源外推；R3 区分官方确认 vs 玩家报告、建议 vs 已落盘。

## 步骤 5 — 写七段结构化 markdown（deliverables/{YYYY-MM}/）
frontmatter：title/subtitle/basis/author/generated。正文 `## 章节`（成目录）→ `### 子条目`，章节间独占一行 `◇ ◇ ◇`。**七段骨架（弹性填充，服务开发各职能+制作人+发行三类受众）**：
1. **社区整体洞察**（战略）：`.lead` 一句话判断 + 信号速览表（维度/一句话/信度）。兼执行摘要。
2. **当日数据盘**（量化）：`.statgrid`+`.bar`——复用 `activity_daily/{date}.json`（量/活跃/频道分布/小时峰值）+ Steam `voted_up` 好评差评比 + 各语区占比 + `source-health.json` 覆盖缺口。定量打底不替代定性。
3. **各信源主要内容**（覆盖）：`.srccard` 逐源——Discord 每频道当独立源 + 各平台源，每源主要内容 + 代表原声（原文+中译）。高量理论craft频道给「主线+代表样本」。
4. **商店与官方视频新评**（口碑）：`.review`(.pos/.neg) 逐源——Steam/iOS App Store/Google Play/官方 PV 评论，按发布日筛、原文+中译；无新增则标注。
5. **对各开发者职能的建议**（落地）：`.dim` 标签块，**只写当天有信号的职能**（制作人/数值/叙事/本地化/美术音频/QA/社区/市场子集），每条锚证据+信度，「建议」标属银芯判断。
6. **Bug 概述 + 详情**（落地）：概述表 + `.repro` 块（重现步骤/预期结果/实际结果/来源/状态加粗）。**严守诚实**：玩家没给步骤只写「现象+玩家原述+来源」，区分「玩家原述」与「艾瑞卡推断的复现路径」，绝不编造 repro。
7. **同人图册**（UGC）：逐张 Read 目检，剔游戏截图/网图 meme/AMV 二压帧/疑似 AI 量产，留有辨识度手绘；`.grid`+原生 `<img>` 嵌缩略图（thumbs/，按需 PIL 生成 480px）。

## 步骤 6 — 排版（解决 累/千篇一律/结构不明）
保持暗金银芯识别，靠**段类型差异化模板 + 结构路标 + 节奏**破单调：
- 每段标题下加一行 `.swhat`「本段：…（服务谁）」；段内子项统一加粗锚点（源名/职能名/Bug 号）。
- 组件对应：数据盘=`.statgrid/.stat/.bar`；信源=`.srccard/.srchead(.src/.cnt)/.sum`；新评=`.review(.pos/.neg)/.meta`；建议=`.dim`；Bug=表+`.repro`；图册=`.grid`。
- 强调手段（`.lead/.callout/.pull`）**节制当锚点**，每段至多 1 条 `.pull` 大引用做视觉钉；长引用列表用 `.qqs` 紧凑变体，不喧宾夺主。组件定义见 `scripts/report_render.py` CSS。

## 步骤 7 — 渲染
`pip install weasyprint markdown`（容器每会话可能需重装）→ `python scripts/report_render.py deliverables/{YYYY-MM}/<报告>.md`（frontmatter 出封面）。`pdftoppm`/fitz 抽「数据盘/各信源/新评/职能建议/Bug 详情/图册」核验：各段模板分化、有 `.swhat` 路标、嵌图正常、不千篇一律。

## 步骤 8 — 交付
`SendUserFile` 直送 PDF + 提交三件套（md+html+pdf，commit 英文附 session 链接）→ `git push -u origin <分支>` → 建草稿 PR → 附 blob/PR/commit 超链接汇报（§2.2 第5条）。如需邮件投递：`python scripts/send_report_email.py`（SMTP 齐时发往配置收件人，默认 tanglong.tang@alibaba-inc.com）。

## 可复用数据资产
`activity_daily/{date}.json`（日统计）· `scripts/data_quality.py`（engagement 归一化权重）· steam_review `metadata.voted_up`+`[正面/负面]`（好评比）· `platforms/{plat}/{date}.json` 的 `time`（发布时效）· `collect_fanart.py` 的 `gallery_manifest.json`（图来源）· `output/source-health.json`（源 active/degraded/dormant）。
