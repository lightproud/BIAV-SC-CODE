Produce a silver-core community intelligence report (deep analysis / role recommendations / bug-fault list / weekly digest) from the full-archive layer, render it to a styled PDF + HTML, commit, push, and report back with hyperlinks. Use when the Keeper asks for a report, analysis, recommendation deck, or defect list built from community data.

全程保持艾瑞卡人格（CLAUDE.md §2，不用 emoji、混合自称、功能性开头）。事实采信遵 §6.11（R1 并行任一失败=整次失败，扫描用单脚本；R2 SHA/行数/时序只引直接产出工具；R3 区分官方确认 vs 玩家报告、建议 vs 已落盘）。

1. 确认数据层（§4 硬约束）：报告类一律走全量档案层 `Public-Info-Pool/Record/Community/`（2026-06-21 迁入，text 全量永驻 git），禁用输出层充全量（lesson #30）。日报/快查才用 `projects/news/output/*-latest.json`。

2. 单脚本提取（放 `/tmp/`，不并行多脚本）：
   - Discord：`Public-Info-Pool/Record/Community/discord/channel_index.json` 映射 `{name→dir}`；消息在 `Public-Info-Pool/Record/Community/discord/channels/{id_suffix}/{date}.jsonl` 逐行 JSON，字段 `content`/`author_id`/`author_bot`(过滤bot)/`timestamp`/`reactions`。**紧凑 schema（缺字段=默认值，见 CLAUDE.md §5.2）：读取必用 `.get(默认)`**，需稳定全字段调 `projects/news/scripts/discord_compact.py` 的 `expand_record()`。
   - 平台：`Public-Info-Pool/Record/Community/{plat}/{date}.json`（含区服子层时为 `{plat}/{region}/{type}/{date}.json`；平台清单以 `ls Public-Info-Pool/Record/Community/` 为准），字段 `title`/`summary`/`lang`/`url`/`content_type`/`engagement`。
   - 限定窗口、去重、保留原文+平台+日期+反应数 → `/tmp/extract/*.txt` 供人工甄别。
   - 故障/官方动态报告优先锚定 `🔸有問必答┊official-q-a` 与 `🔸遊戲公告┊game-announcement`（带状态标签：处理中/已解决/Resolved）。
   - 多语言关键词扫描覆盖中/英/韩/俄/西/葡/越/泰/印尼/法/德/日；命中后人工读原文剔噪声（error↔terror、broken↔角色超模）。

3. 甄别归纳：标信度 A（硬事实可复算）/ B（多源归纳）/ C（推断需标注）；每条结论锚定可查证据（平台+日期+原文片段），禁止无源外推。

4. 落点用脚本算路径（强约定，勿手编）：`python scripts/deliverable_path.py path --type <类型> --topic <主题> --date YYYYMMDD [--rev N] --ext md`，落到 `Public-Info-Pool/Resource/{类型}/{主题}-{YYYYMMDD}[-rN].md`。类型走开放注册表 `Public-Info-Pool/types.json`（新类型先 `register`）。frontmatter（渲染器自动读取拼封面）：title / subtitle / basis / author / generated。正文 `# H1` → `## 章节`（成目录项）→ `### 子条目`，章节间用独占一行 `◇ ◇ ◇` 分隔；标准条目用加粗 label（重现步骤 / 实际结果 / 预期结果 / 来源 / 状态）。视觉规范见 `memory/style-guide.md`。

5. 渲染：`pip install weasyprint markdown`（ephemeral 容器每次会话可能需重装），然后 `python scripts/report_render.py Public-Info-Pool/Resource/{类型}/<报告>.md`（默认从 frontmatter 出封面，`--title/--subtitle/--meta` 可覆盖）。渲染后用 pymupdf(fitz) 抽 1-2 页核验封面与正文渲染正常。

6. 交付：提交三件套（md+html+pdf，commit 用英文附 session 链接）→ `git push -u origin <分支>` → 建草稿 PR（若无）→ 向守密人汇报附 blob/PR/commit 超链接（§2.2 第5条）并用 SendUserFile 直送 PDF。
