# 项目状态一览

> 最后更新：2026-07-04 by 艾瑞卡会话（bpt-agent-sdk v0.3 全线 + 桶1 + 桶1 遗留全收口：#16 观测流（#384）/
> #17 长尾（#387/#388）/ 桶1 三项（#391）/ 桶1 遗留两项（MCP readOnlyHint 链 · PDF live-smoke，#394）
> 均合并 main（并发 surface-alignment #385 亦并入），668 单测全绿，本档 bpt-agent-sdk 行 + 专节已同步；
> 早前同会话落交接锚点（#382/#383）。
> 前次 2026-07-02 by 艾瑞卡会话（第三轮·体质改进批次，守密人授权动态编排执行：
> ① `archive_layout.py` 归档布局单一真相源落地，写方读方全收编（含发现并修复
> repair_gaps 仍扫已死旧根、backfill 写平级两颗雷）；② 平级历史 1,382+13 文件
> 一次性归位区服/类型分层，逐源唯一键集合验证零丢失（taptap 系按裁定⑧落 cn）；
> ③ CI 测试工作流 sparse checkout（2.6G→约 100MB），required 检查重启项进提案待裁定；
> ④ 校验丢弃升格一等指标（validation-drops → source-health → --strict 门控）；
> ⑤ 输出层契约 v1（output-latest.schema.json + contract_version 盖章）；
> ⑥ 断档检测默认收敛近 60 天窗口；⑦ 命轮→角色归属判定为一手数据盲区、落档
> gap-inventory 不合成；⑧ 维护态节拍表提案落 Resource/proposal/。
> 同日前两轮：全仓档案漂移修复 / degraded 源排查 + wiki 数据桥接回）
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
| **bpt-agent-sdk**（Claude Agent SDK 干净重实现 · 银芯→黑池单向输出物） | **v0.2+v0.3 已合并 main（2026-07-04，本体 #380 @ 8bd4a54 + v0.3 收尾 #384/#387/#388）**：干净室 TypeScript 重实现，直驱 Anthropic Messages API（fetch+SSE，无 CLI 子进程），**668 单测全绿**，对官方 SDK 0.3.199 约 90%+ 表面等价（v0.3 #16 观测流 + #17 长尾 + 桶1 三项 #391 + 桶1 遗留两项 #394 + 并发 surface-alignment #385 均收口） | 艾瑞卡会话 | 无阻塞待办；后续方向由守密人指派（可选：追 0.3.201 基线漂移 / 重跑审计出新记分牌 / 真 API 端到端验证）；**动手前必读** `projects/bpt-agent-sdk/CONTEXT.md`，定位见 `projects/bpt-agent-sdk/docs/POSITIONING.md` |

> BPT 战线（bpt-web / bpt-desktop / bpt-next / graphify-ext / occ-local）已于 2026-04-19 战略转向中从银芯仓库删除，不再在银芯内部开发。银芯转为 BPT 指导者，协议见 `memory/bpt-guidance-protocol.md`。
> **例外辨析（勿混淆）**：上表 `bpt-agent-sdk` **不属**上述被删 BPT 产品战线，**亦非**「银芯内部开发 BPT 产品」。它是银芯自有的**工程产物**（公开信息层），作为**银芯→黑池单向输出物**供 BPT Desktop 消费（令其脱离被禁的 `claude.exe` 子进程引擎）——方向与 §1.1-HC 防火墙一致（银芯→黑池单向输出），黑池数据从不回流。

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

## BPT Agent SDK（`projects/bpt-agent-sdk/`）

> **一句话**：官方 `@anthropic-ai/claude-agent-sdk` 的**干净室重实现**，drop-in 兼容公开接口，
> 但引擎**直驱 Anthropic Messages API**（fetch + SSE，**不打包 CLI 子进程**）。用途：让 BPT Desktop
> （Electron）脱离被禁的 `claude.exe` 子进程引擎。**定位辨析见「## 子项目状态」表下方例外辨析**——
> 银芯→黑池单向输出物，与 §1.1-HC 防火墙同向，非 BPT 产品内部开发。

- **动手前必读**：`projects/bpt-agent-sdk/CONTEXT.md`（会话上下文 + 当前 milestone）
- **当前状态（2026-07-04 实测）**：**v0.2 + v0.3 已合并 main**（本体 PR #380 @ `8bd4a54`；v0.3 收尾
  #384 观测流 / #387 Read 图像 / #388 类型面尾批 / #391 桶1 三项）。**v0.3 两待办 #16 + #17 +
  「桶1」（PDF document 块 / 重试流桥接 / 只读工具并行）均已收口。**
  **v0.4 已合并 main（PR #397）**：观测臂生命周期真发射——subagent 任务生命周期
  task_started/progress/updated/notification + hook 生命周期 hook_started/hook_response
  （`includeHookEvents` 门控）经共享观测队列在消息边界真发射；error 结果臂补官方 `errors: string[]`；
  权限规则 `*` / `mcp__*` glob；COMPAT.md 陈旧行对账（会话三函数与 canUseTool suggestions 实为 v0.2 已落地）。
  **v0.5 三线并进（守密人 2026-07-04 裁定：换装就绪包为主线 + background Bash 一族 + A/B 测量收尾）**：
  ① Bash `run_in_background` + BashOutput/KillShell + 前台 cwd/env 状态档持久（ShellManager 每 query 一个，
  子代理共享，query 结束清场）；② 换装就绪包 `docs/MIGRATION.md` + `examples/electron-host.mjs` +
  `npm pack` tarball 干净目录实测装通；③ A/B 七任务基准 `tests/integration/ab-benchmark.mjs`
  （含中文两项，offender 排序，POSITIONING §7 测量强制令）挂 `bpt-agent-sdk.yml` `ab_benchmark`
  dispatch 输入。`pytest` 无涉、Node 侧 **`npx vitest run` 691 单测全绿（20 文件）**；`tsc` + `build` exit 0
- **完成度（表面等价）**：对官方 SDK **0.3.199 基线**约 **89.5%**（v0.1 基线 68.3% → v0.2+v0.3 补齐后重算）。
  审计矩阵与逐行台账落 `Public-Info-Pool/Resource/repo-engineering/bpt-agent-sdk-completion-audit-20260703.md`
  + 同名 `-matrix-20260703.json`（146 行）
- **两轴保真模型（关键认知，勿混淆两轴）**：
  - **表面完整度（SURFACE）**：可收敛，约 90%+——接口、类型、消息变体、工具/MCP/hooks 面照抄公开契约即可补齐
  - **行为保真度（BEHAVIORAL）**：**结构性封顶**——官方系统提示词是专有的，干净室纪律禁止复制，
    故 agent 循环的「转数 / 决策」层永远无法逐比特对齐。追平只谈 SURFACE，BEHAVIORAL 天花板不可逾越
- **v0.3 头号交付**：**per-run 预算/效率仪表**（`result.metrics` = `SDKRunMetrics`：perTurn / perTool /
  cacheHitRatio / 模型用量 / 成本 / API 耗时）。回应守密人「整体效率低下会累积成巨大差别」之忧——
  把「效率」从不可见变成每轮可量。A/B 演示 harness：`examples/ab-metrics.mjs`（缓存开/关对照表）
- **默认配置决策**：**提示词缓存默认开**（`provider.promptCaching !== false`，v0.3 翻转，多轮对话省 input 账单）
- **干净室纪律（硬约束，PR 安全声明 + 防火墙纪律双重要求）**：**绝不**复制官方专有代码 / 系统提示词。
  接口面对照公开文档实现，引擎自研。这也是 BEHAVIORAL 天花板的根因
- **定位/战略**：`docs/POSITIONING.md`（兼容表面 / 独立引擎 / 钉死基线 0.3.199 / 选择性追踪 +
  四档效率齿轮；含可粘贴进 `decisions.md` 的决策条）
- **文档索引**：`CONTEXT.md`（上下文）/ `docs/POSITIONING.md`（战略）/ `docs/COMPAT.md`（兼容面 + 毕业清单）/
  `docs/ARCHITECTURE.md`（架构）/ `README.md`（总览）
- **CI**：`.github/workflows/bpt-agent-sdk.yml`（Node 单测无钥常跑 + live-smoke 手动 dispatch 用 `secrets.ANTHROPIC_API_KEY`）
- **v0.3 收尾已完成**：
  - **task #16 观测消息流扩容**（#384）：`SDKMessage` union 补齐观测臂 25 变体（`SDKObservabilityMessage`），
    `permission_denied` 真发射（gate deny 时 yield，与 `result.permission_denials` 台账一致），余类型化待驱动源（COMPAT.md 记发射 vs 类型化）
  - **task #17 P1/P2 长尾**：Read 图像（#387，PNG/JPEG/GIF/WebP magic-byte 嗅探→image 块）+ tool() ToolAnnotations 转发 /
    mcpServerStatus 富化（config·tools[]） / listSessions option（dir 别名·limit） / Usage 字段（server_tool_use·service_tier）（#388）
- **桶1 已收口（守密人「都先全面实现」，#391）**：① Read PDF→base64 `document` 块（claude-code-guide
  核实官方文档：document 块可入 tool_result）；② `rate_limit_event`/`api_retry` 真发射（transport `onRetry`
  桥接进流）；③ 连续≥2 只读内建工具**并行执行**（Promise.all，结果保序，stop/defer 覆盖同组后续为
  「Not executed」，interrupt 语义保绿）。**668 单测全绿。**
- **遗留两项已清（守密人「清遗留」，#394）**：① **MCP `readOnlyHint` 注解链**——`listTools` 经
  sdk/stdio/http 把注解捕获到 `McpToolEntry.annotations`，loop `isReadOnlyTool` 统一 builtin.readOnly +
  MCP readOnlyHint，喂进 gate（default/plan/acceptEdits 只读自动放行）+ 并行分组；真 gate 端到端测试证明
  只读 MCP 工具自动放行、非只读被拒。② **PDF base64 源 live-API 确认**——`tests/integration/live-real-api.mjs`
  加阶段2（生成合法最小 PDF→模型 Read→成功即 API 接受 document 块），随 live-smoke workflow 手动
  dispatch 用 `secrets.ANTHROPIC_API_KEY` 跑。（同期并发合并 #385 surface-alignment：MCP resources /
  Grep offset·-o / bypass 联锁 / ModelInfo.value。）
- **沙箱**：按 BPT 高开放权限信任模型判定 **N/A-by-design**（云沙箱在 BPT 内部场景不适用，守密人 2026-07-03 认可）

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
`ripgrep`；MCP `biav-sc-memory` 记忆四工具（`character_persona` / `record_decision` /
`record_lesson` / `current_continuity`，平台原生记忆互补）。退役溯源见
`memory/decisions-archive.md` 2026-06-14/06-20 条 + CLAUDE.md §1.4。

## 知识库运行时动态导航（2026-07-04 落地）

守密人 2026-07-04 裁定「动态编排根据 OKF 和 LLMwiki 的思想实现银芯知识库」——把静态
OKF bundle 升级为**艾瑞卡运行时可动态导航的知识库**。落地：`scripts/build_kb_index.py`
从 bundle（concept + `graph.json`）造静态导航索引 `okf/kb_index.json`（倒排表 + 邻接表，
词典法零 ML）；MCP `biav-sc-memory` 增 **知识库导航四工具** `kb_search` / `kb_get` /
`kb_neighbors` / `kb_overview`（后端 `scripts/kb_navigator.py`，import-only），MCP 工具
总数 **4→8**。索引随 `build_okf_bundle.py` 末尾自动重生成、随 `--tarball` 单向输出物一起走。
守护 `tests/test_kb_index.py`（索引完整性 + 导航四原语 + MCP 工具）。溯源见
`memory/decisions.md` 2026-07-04 条 + CLAUDE.md §1.4 第 5 条 / §6.1。
