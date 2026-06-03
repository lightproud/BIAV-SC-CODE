Produce a silver-core community intelligence report (deep analysis / role recommendations / bug-fault list / weekly digest) from the full-archive layer, render it to a styled PDF + HTML, commit, push, and report back with hyperlinks. Use when the Keeper asks for a report, analysis, recommendation deck, or defect list built from community data.

全程保持艾瑞卡人格（CLAUDE.md §2，不用 emoji、混合自称、功能性开头）。事实采信遵 §6.11（R1 并行任一失败=整次失败，扫描用单脚本；R2 SHA/行数/时序只引直接产出工具；R3 区分官方确认 vs 玩家报告、建议 vs 已落盘）。

## 运行模型（硬约束）

报告**一律在 Claude Code 会话内产出**（守密人订阅算力，零 Anthropic API 费）。**不**经 GitHub Actions 的 `claude-code-action` 跑分析（那按 token 计 API 费，已退役；原 `daily-report.yml` 已删）。数据采集层在 CI 持续免费运行（`update-news` 每小时、`collect-comments` 每日、`collect-fanart` 每日、商店评价累积归档），只用 Discord/YouTube 等 key，不碰 Anthropic。落地形态：**会话内按需产出，报昨日单日**（多日窗口为例外，需守密人明示）。

## 固定产出结构（守密人定，六段，不得随意增删段）

1. **社区整体洞察** — `.lead` 一句话判断 + 当日信号速览表（维度 / 一句话 / 信度）。
2. **重点内容呈现与翻译** — 官方动作（版本/活动/PV/维护）+ **官方 PV/主题曲 YouTube 视频评论**原文+中译（按主题归类，取自 `platforms/youtube_comments/{date}.json`）+ 其他重点原声（游戏内社区，原文+中译）。
3. **对各开发者职能的建议** — 逐职能分诊：制作人 / 数值策划 / 主文案叙事 / 本地化 / 美术音频 / QA / 社区运营 / 市场发行。每条锚定证据 + 信度，「建议」标注属银芯输出层判断。
4. **Bug 概述** — 故障表（故障 / 状态官方确认vs待核实 / 平台语区 / 信度）。
5. **Bug 详情** — 逐条 **重现步骤 / 预期结果 / 实际结果 / 来源 / 状态**（加粗 label）。
6. **同人图册** — 甄别后的手绘同人平铺（`.grid` + 原生 `<img src>` 标签，非 markdown `![]()`——markdown 图在 raw HTML div 内不渲染）。

## 数据纪律（每次必做）

- **数据层**（§4 硬约束）：报告类一律走全量档案层 `projects/news/data/`，禁用输出层充全量（lesson #30）。
- **单脚本提取**（放 `/tmp/`，不并行多脚本）：
  - Discord：`discord/channel_index.json` 映射 `{name→dir}`；消息在 `discord/channels/{dir}/{date}.jsonl` 逐行 JSON，字段 `content`/`author_id`/`author_bot`(过滤bot)/`timestamp`/`reactions[].count`。**逐频道全量通读（map-reduce 分批，不抽样）**。
  - 平台：`platforms/{plat}/{date}.json`（含 steam steam_review appstore google_play reddit official youtube **youtube_comments** pixiv weibo 等），字段 `title`/`summary`/`lang`/`url`/`engagement`。
  - 故障/官方动态优先锚定 `🔸有問必答┊official-q-a` 与 `🔸遊戲公告┊game-announcement`（带状态标签）。
  - 多语关键词覆盖中/英/韩/俄/西/葡/越/泰/印尼/法/德/日；命中后人工读原文剔噪（error↔terror、broken↔超模）。
- **时效甄别（硬约束）**：采集时间 ≠ 发布时间。YouTube 用真龄判断（联动 PV 多为预热期发布，非窗口当日）；商店评价按真实发布日筛；微博/快照类标「采集快照」。预热内容不得当窗口当日事件。
- **同人图甄别**：逐张 Read 目检，剔除游戏截图（卡牌/对话/战斗界面）、网图 meme（动物/表情包照片）、AMV/视频二压帧、疑似 AI 与低质重复；**保留全部有辨识度的手绘**（守密人要「看到所有同人图」，过滤是为去噪非删量）。缩略图在会话内按需用 PIL 生成 `fanart/{date}/thumbs/`（480px），图册嵌 thumbs 控体积。
- **信度**：A 硬事实可复算 / B 多源归纳 / C 推断需标注；每条结论锚定可查证据（平台+日期+原文片段），禁止无源外推。每条原声就地给原文+中译，**不设末尾附录**。

## 渲染与交付

- markdown 写 `deliverables/{YYYY-MM}/`。frontmatter：title / subtitle / basis / author / generated。正文 `## 章节`（成目录）→ `### 子条目`，章节间独占一行 `◇ ◇ ◇` 分隔。视觉规范 `memory/style-guide.md`。
- 渲染：`pip install weasyprint markdown`（容器每会话可能需重装）→ `python scripts/report_render.py deliverables/{YYYY-MM}/<报告>.md`（frontmatter 出封面，`--title/--subtitle/--meta` 可覆盖）。渲染后 `pdftoppm`/fitz 抽页核验封面、各职能建议、Bug 详情、**同人图册嵌图**正常。
- 交付：`SendUserFile` 直送 PDF + 提交三件套（md+html+pdf，commit 英文附 session 链接）→ `git push -u origin <分支>` → 建草稿 PR → 向守密人汇报附 blob/PR/commit 超链接（§2.2 第5条）。如需邮件投递，`python scripts/send_report_email.py`（SMTP 凭据齐时发往配置收件人，默认 tanglong.tang@alibaba-inc.com）。
