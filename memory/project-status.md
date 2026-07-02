# 项目状态一览

> 最后更新：2026-07-02 by 艾瑞卡会话（第二轮：degraded 源排查修复——6 源系审计器不识区服分层的假警报已修、taptap_review 真因为 VALID_SOURCES 白名单漂移已修、youtube_comments 写旧读新错位已修并合并归档；wiki W2 数据桥接回完成、CharacterGrid 上线图鉴页。同日第一轮：全仓档案漂移修复）
>
> **本档案是子项目状态与实时进度的唯一权威**（CLAUDE.md §1.3 裁定）：
> 进度数字只在此维护，其他档案（含 CLAUDE.md）一律指针、不复刻。
> 战略规划详见 `memory/strategic-plan-2026.md`

## 2026-06-09 状态核验（实测）

- **Phase 2 进行中**（2026-04-27 → 07-19，84 天，已过 43 天）
- **采集自动化持续运行**：git log 顶部为连续机器提交（Discord 回填 / 视频评论归档 / 社区新闻），无中断迹象
- **工作流 19 个**：2026-06-05 新增 `collect-comments`（每日 02:00 UTC 视频评论归档）与 `recover-fanart`（手动触发，刷新 Discord 过期 URL 恢复同人图）
- **daily-report 定时已停用**：报告改在 Claude Code 会话内订阅生成（零 API 费），workflow 仅留手动触发备用
- **wiki 结构化层已清空（2026-06-15 守密人裁定）**：`data/db/` 全 6 个 JSON + 24 个生成角色详情页删除。原 `characters.json` 24/72 全为 partial/fixture 占位、game_version 全 None，长期误导引用，故整层删除。数据桥 `characters.ts` 改导出空数组（保留类型/组件脚手架），VitePress 构建已验证通过（BUILD_OK）。W2 重建基线必须以 `data/extracted/` 一手解包字段为唯一数据源，禁止再用合成占位
- **CLAUDE.md 治理**：易腐清单去枚举化 + 战略状态指针化（本档案权威化）+ 路径引用 CI 对账（`tests/test_claude_md.py`）
- 下方 4-26 快照中的待办事项（守密人本地删分支 / dependabot #136-140）未在本次复核范围，实际状态以 GitHub 为准

## 2026-04-26 仓库整顿快照（历史，部分待办状态未复核）

- ✅ **直推 main 政策正式落地**（PR #141 已合并）—— CLAUDE.md / claude.yml / BIAV-SC.md 全部对齐 `decisions.md` 2026-03-29 决策
- ✅ **SessionStart 同步 hook 上线** — `.claude/hooks/session-start-sync.sh` 自动同步 local main 与 origin/main，根治 Cloudflare HTTP 413 推送堵塞（lesson #28）。**（该 hook 已于 2026-06-14 随全部会话钩子退役删除，413 防护改为 git 层 `.githooks/pre-push`，见 CLAUDE.md §7.4）**
- ✅ **24 个未合并 claude/* 分支审计完成** — 全部决定删除（详见 lesson #29）
- ⏳ **守密人本地待执行**：批量删除 37 个 stale 分支（含 13 个安全 + 24 个审计后决定删 + 本会话清理分支）
- ⏳ **5 个 dependabot PR 待批量升级**（#136-140）— 已派任务给 Code-news（参 batch dependency update 文字派单）

## 子项目状态

| 子项目 | 状态 | 负责会话 | 下一步 |
|--------|------|---------|--------|
| site（主站 + 部署 + 视觉） | 已部署，维护模式 | Code-site | 无新任务 |
| news（新闻聚合 + 报告系统） | 自动化持续运行（采集 / 回填 / 评论 / 同人图） | Code-news | M2 信息齐备期任务见 `projects/news/CONTEXT.md`；dependabot #136-140 实际状态待核 |
| wiki（数据集 + Wiki 站点） | **W2 基线已重建 + 数据桥已接回（2026-07-02）**：可信基线 `data/processed/characters.json`（72 真实角色，一手解包）→ 58 真实唤醒体页 + 运行时数据桥 `characters.runtime.json`（生成器单点产出）→ `characters.ts` 消费，CharacterGrid（72 卡片、界域/类目/搜索筛选）挂载图鉴页，SSR 构建验证通过 | 艾瑞卡会话 | 真实字段缺口推进（skills/命轮/立绘/三语）见 `wiki-phase-2-gap-inventory.md`；贡献流程（M3）待跑通 |
| game（衍生游戏） | 暂缓 | 待创建 | 不主线派发 |

> BPT 战线（bpt-web / bpt-desktop / bpt-next / graphify-ext / occ-local）已于 2026-04-19 战略转向中从银芯仓库删除，不再在银芯内部开发。银芯转为 BPT 指导者，协议见 `memory/bpt-guidance-protocol.md`。

## News 新闻聚合 + 报告系统

### 实时聚合器
- **已完成**：前端页面、B站抓取、GitHub Actions 自动化
- **阻塞**：Twitter/X 需付费 Token（未接入）；bahamut / arca_live / note_com 零产出待核
  （Arca 实测 PW 选择器超时，`.vrow` 不可见——疑站点改版）
- **2026-07-02 degraded 排查结论（已修复）**：
  - steam / youtube / official / steam_discussion / appstore / google_play 六源为**假警报**——
    数据自 06-22 起正常写入区服分层新路径（`steam/global/review/` 等），
    `silent_sources_audit.py` 只扫平级旧布局误判沉默；审计器已改为识别折叠映射 + 递归区服目录
  - **taptap_review 真沉默真因**：`aggregator_base.VALID_SOURCES` 私有硬编码白名单
    未随 06-21 采集规范收录 `taptap_review`，采到的评论（CI 实测单轮 108 条）在校验层被整批丢弃；
    白名单已改从 `sources.py` 单一真相源派生，下轮采集起恢复入流
  - **youtube_comments 写旧读新**：`collect_video_comments.py` 迁移后仍写旧路径
    `data/platforms/`，权威档案断更 10 天；已改写 `Record/Community/youtube_comments/`
    并将两段历史按评论 id 并集合并（1,727 条唯一）
  - ruliweb 沉默 7 天为边界情况（帖子内容日期偏旧致归档桶不新），非故障，观察即可
- **数据落盘位置**：
  - `projects/news/output/news.json` — 所有数据源合并的原始输出（由 aggregator.py 写入）
  - `projects/news/output/` — **Chat 会话统一读取入口**，按数据源分割的 JSON 文件
    - `bilibili-latest.json`、`steam-latest.json`、`taptap-latest.json` 等
    - `all-latest.json` — 所有源合并（适合日报/分析场景）
    - 每次 workflow 运行后自动更新（由 split_output.py 生成）
- **数据源状态**：
  - [x] Bilibili — 正常运行
  - [x] Reddit — 代码就绪
  - [ ] Twitter/X — 需 TWITTER_BEARER_TOKEN
  - [ ] NGA — 无采集器实现（2026-07-02 核实，原「需 NGA_FORUM_ID」描述作废；小红书同此）
  - [x] TapTap — Playwright 采集运行中（source-health: active）
  - [x] Discord — 已实现（Bot 已配置，全量归档 + 聚合器双通道）；多 guild 分层归档（2026-06-21 迁 `Public-Info-Pool/Record/Community/discord/`）：Global（`discord/` 根）/ 志愿者（`discord/guilds/`）/ 日服（接入中，2026-06-17，`discord/guilds/`）
  - [x] YouTube — 代码就绪，需配置 API 密钥

### 报告系统（新增，来自 new-session-7Plu3）
- **已完成**：29 平台采集器、AI 分析模块、报告生成、多渠道通知（Email/Discord/Telegram/Bark/Webhook）
- **待验证**：整合到新目录结构后的 GitHub Actions 流水线
- **待配置**：各平台 API 密钥

## Wiki 数据集 + 站点

### 游戏数据集（原 database）

> **重大状态变更（2026-06）**：原 `data/db/` 结构化层（characters.json 全 6 JSON + 派生页）
> 已于 **2026-06-15 守密人裁定整层清空**（原 24/72 全为 partial/fixture 占位、长期误导）；
> 外部合成数据抓取链（fetch_* 等）已于 **PR #253 整套退役删除**。本节下方凡涉及
> `data/db/` 旧内容 / 24-72 自举进度 / Fandom 抓取的描述均为**清空前历史记录**，现行以本框为准。

- **现行数据源（唯一）**：`projects/wiki/data/extracted/categorized/character_data.txt`
  （客户端一手解包字段）；角色真实总数 **72**（含皮肤/联动/彩蛋）
- **W2 进度**：可信 `characters` 基线**已重建**于 `projects/wiki/data/processed/characters.json`
  （72 真实角色，一手解包，多维证据法分类 playable/unreleased/easter_egg，**无合成占位**）；
  `scripts/generate_wiki_pages.py`（读 `data/processed/`）已据此生成 58 个真实唤醒体静态页。
  **剩余收尾已完成（2026-07-02）**：运行时数据桥已接回 processed/ 基线（经生成器产物
  `characters.runtime.json`）；真实字段缺口见
  `memory/wiki-phase-2-gap-inventory.md`，进度以本档「子项目状态」为准
- **现存解包/索引脚本**（`projects/wiki/scripts/`）：`decrypt_and_extract.py` / `extract_client_data.py` /
  `build_drop_index.py` / `generate_rss.py` / `check_version.py` /
  `validate_data.py`（精确清单以 `ls` 为准；`build_banner_character_index.py` 2026-07-02 随死代码清理退役）
- **已退役（PR #253）**：11 个外部抓取/生成脚本（`fetch_portraits/skills/cards/stats/stages/wheels/lore/voice_lines/steam_assets.py`、
  `extract_game_data.py`、`generate_pages.py`）+ `fetch-wiki-data.yml` workflow，理由：外部源为合成/二手数据，与「一手解包为唯一源」纪律冲突

### Wiki 站点

- **剧情正文层深化（2026-06-21）**：`generate_wiki_pages.py` 修复收藏馆富文本标记渲染
  （`<Title:>`/`<Quality:>`/`<▼>` 此前被 esc 成乱码或被当 HTML 静默吞字），新增
  `_clean_lore_markup`/`_clean_title` 并加 15 条单测守护。`story.md` 重构为**剧情正文读本**
  （关卡引言 + 长篇正文 + 词条速览 + 番外未编章节正文 78 篇，含「开学日」575 字）；
  剧情↔角色双向交叉链接 + 章节概览可点目录；新增**功能解锁条件**页（feature_unlock，145 项）。
  全部一手解包原文，pytest 全绿、VitePress 构建通过
- **现状（2026-06-28 实测）**：VitePress 站点框架在；`docs/` 下 Markdown **约 81 页**，含
  **58 个真实唤醒体角色页**（`docs/zh/awakeners/{角色ID}.md`，由 `scripts/generate_wiki_pages.py`
  读 `data/processed/characters.json` 一手字段生成，如 `15560.md` 潘狄娅含界域/职业/档案表）
  + 剧情正文/功能解锁/索引页。原「1 个 Pandia fixture 角色页」已被 58 真实页取代（`pandia.md` 已删）；
  原「约 580+ 页（ZH/EN/JA 三语全量）」系清空前假数据，三语全量尚未恢复
- **数据桥（2026-07-02 已接回）**：`generate_wiki_pages.py:generate_runtime_data()` 从 processed
  基线 + 玩法层单点产出 `docs/.vitepress/theme/data/characters.runtime.json`（72 条，含
  realm/role/status/has_page），`characters.ts` 导入消费；CharacterGrid 挂载图鉴页
  `characters.md`「交互检索」段（base 感知链接、无立绘占位符、界域/类目/搜索筛选），
  SSR 实测 72 卡片 + 14 枚非可玩类目章；VitePress 构建通过（20.6s）。其余组件
  （CharacterSheet 等详情向）仍为脚手架，待字段缺口补全后启用
- **Vue 组件（约 12 个，2026-06 重建集，角色数据展示向）**：CharacterGrid / CharacterInfobox /
  CharacterSheet / SkillTable / TrinketRecommendationCard / AscensionMaterialBlock / BondRewardList /
  StatGrowthChart / AffinityTags / PortraitGallery / VoiceLineList / FixtureBadge（精确以
  `ls docs/.vitepress/theme/components/` 为准）。**原列的 GachaSimulator/TeamBuilder/DamageCalculator
  等计算器/模拟器组件已不在当前组件集**
- **技术栈**：VitePress 1.6.4 + Vue 3.5.13；**部署**：Code-site 统一管理（`deploy-site.yml`），wiki 在 `/wiki/` 子路径
- 详细开发上下文与 milestone 见 `projects/wiki/CONTEXT.md`

## Game 衍生游戏

- **已完成**：无
- **待决策**：游戏类型、技术选型、美术方向

## 当前阶段

**Phase 2 银芯使命建设期**（2026-04-27 → 07-19，4-19/4-20 压缩时间表）。原「三新使命」之 #3「Studio 团队 AI 协作训练场」2026-06-28 退役，收敛为二核心使命（news / wiki）。

Phase 0/1 已验收归档（2026-04-04）：Phase 0 止血完成、Stage 1 日报 14 天验证
通过、记忆系统 9 模块 + 做梦 Agent 三层上线（**该两系统已于 2026-06-14/06-20 整套退役删除**，
见下方「记忆系统 + 做梦 Agent」退役记录）。详见 `memory/strategic-plan-2026.md`。

## Workflow 触发方式（**常用项摘录，非全量**；触发节奏属非显然信息故保留）

> 全量清单与权威以 `ls .github/workflows/` 为准（CLAUDE.md §7.2）。下表只记「从文件名看不出
> 触发节奏」的常用项；backfill-* / test-* / build-capability-registry / cleanup-stale-branches /
> discord-archive-volunteer / collect-fanart / discord-history-backfill 等回填/测试/运维类不在表内。
> 已删除 workflow（`dream.yml` / `fetch-wiki-data.yml` / `daily-report.yml`）已从表中移除。

| Workflow | 触发 | 状态 |
|----------|------|------|
| update-news.yml | 每小时（`0 * * * *`） | 运行中 |
| discord-archive.yml | 每日 18:00 UTC + 每月 1 日月度归档（Global 服） | 运行中 |
| discord-archive-jp.yml | 手动 dispatch；填 `JP_GUILD_ID` 后开 `:45` cron | 待启用（2026-06-17 新增，日服 guild，Guard 保护空 ID 安全跳过） |
| discord-discover-guilds.yml | 手动 dispatch | 可用（2026-06-17 新增，列 bot 所在 guild 以发现日服 ID） |
| collect-comments.yml | 每日 02:00 UTC | 运行中（2026-06-05 新增） |
| recover-fanart.yml | 手动 dispatch | 可用（2026-06-05 新增） |
| deploy-site.yml | push 触发 | 运行中 |
| check-version.yml | 每周一 06:00 UTC | 运行中 |
| validate-data.yml | push 触发 | 运行中 |
| claude.yml | Issue 触发 | 可用 |
| extract-game-data.yml | release / trigger 文件 / 手动 dispatch | 可用 |

报告类：`daily-report.yml` 定时已停用且 workflow 已删，报告改 Claude Code 会话内订阅生成（见上「子项目状态」）。

## 基础设施状态

| 组件 | 状态 | 备注 |
|------|------|------|
| GitHub PAT (Issues) | 已配置 | Fine-grained, brain-in-a-vat only |
| Claude GitHub App | 已安装 | 权限已更新 |
| .github/workflows/claude.yml | 已部署 | 含 id-token:write |
| ANTHROPIC_API_KEY Secret | ✅ 已配置 | 余额已恢复（2026-04-04） |
| Actions 自动化 | ✅ 可用 | claude.yml 已激活；自造记忆/做梦自动化 2026-06-20 退役 |

## 记忆系统 + 做梦 Agent（2026-06-14/06-20 整套退役删除）

原自建记忆栈（9 模块 / 约 3410 行：TF-IDF 检索 `memory_search` / 知识图谱
`knowledge_graph` / MemRL `memrl` / 事实库 `fact_store` / 虚拟上下文 `context_manager` /
写回 `memory_writeback` / 简报 `session_briefing` / Reflexion / 做梦系 `dream*`）
+ 做梦 Agent 三层（浅睡/深睡/REM，`dream.yml`）已于 **2026-06-14 退役自动环、
2026-06-20 连代码（23 脚本 + workflow）带数据（vectors / knowledge-graph / digests）
整套删除**。理由：自造记忆与 Claude 平台原生记忆定位冲突。

现状：记忆定位收回**平台原生上下文管理** + `memory/*.md` 人工策展层；跨档案检索改
`ripgrep`；MCP `biav-sc-memory` 仅留 **4 工具**（`character_persona` / `record_decision` /
`record_lesson` / `current_continuity`，平台原生记忆互补）。退役溯源见
`memory/decisions-archive.md` 2026-06-14/06-20 条 + CLAUDE.md §1.4。
