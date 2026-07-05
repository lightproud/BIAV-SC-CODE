# 项目状态一览

> 最后更新：2026-07-05 by 向量腿接手会话（chunk2 完成：CI 传 Release + restore 非 tar 资产；
> chunk3 厚锚落地：别名侧表三墙 + silver_aliases/extract_aliases/kb_anchor + mention 边纳社区档案
> + 别名 A/B 关系腿，MCP 工具 10→11；同会话续批：真 Voyage 铁证双绿（超地板 0.7059）+
> 索引扩到架构上限 60k 分层采样，详见「向量检索腿」节）。
> 前次 2026-07-04 by 艾瑞卡会话（bpt-agent-sdk v0.3 全线 + 桶1 + 桶1 遗留全收口：#16 观测流（#384）/
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
| **bpt-agent-sdk**（Claude Agent SDK 公开信息再现 · 银芯→黑池单向输出物） | **v0.2+v0.3 已合并 main（2026-07-04，本体 #380 @ 8bd4a54 + v0.3 收尾 #384/#387/#388）**：TypeScript 重实现（公开信息再现、自研引擎），直驱 Anthropic Messages API（fetch+SSE，无 CLI 子进程），**668 单测全绿**，对官方 SDK 0.3.199 约 90%+ 表面等价（v0.3 #16 观测流 + #17 长尾 + 桶1 三项 #391 + 桶1 遗留两项 #394 + 并发 surface-alignment #385 均收口） | 艾瑞卡会话 | 无阻塞待办；后续方向由守密人指派（可选：追 0.3.201 基线漂移 / 重跑审计出新记分牌 / 真 API 端到端验证）；**动手前必读** `projects/bpt-agent-sdk/CONTEXT.md`，定位见 `projects/bpt-agent-sdk/docs/POSITIONING.md` |
| **bpt-pm**（项目排期工作台 · 非使命线工程产物） | **v1 首版已建（2026-07-05）**：单网页 `index.html` 零依赖零后端，数据协议 `bpt-pm/v1`（`schema/task-schema.json`），CPM 前向/后向自动排期 + 临界路径 + 4 依赖类型（FS/SS/FF/SF）+ 工作日历 + SNET/MSO 约束 + 基线比对甘特图；File System Access 读写回写。CPM 离线复算 + 无头 Chromium 冒烟均通过。**Notion 数据源已端到端实测（2026-07-05）**：适配器 `docs/notion-adapter.md` + CLI `scripts/schedule.mjs`，对真实工作区跑通建库→拉取→CPM→写回→抽验闭环。**本地 Notion 代理已建**（`proxy/server.mjs` 持 token 跑 localhost，网页按钮直连 Notion，端到端 12 项契约通过）。**v2-A 资源冲突可视化已落（2026-07-05，面向 60 人内容团队痛点）**：协议加 `resources`（人/外包 + 并发产能），引擎算逐日负载 + 超载检测，网页资源×日热力图（超载红/满载绿），`tests/resource_load.mjs` 全过。**v2 B/C/D 三特性已实现（2026-07-05，全部 additive 向后兼容，CPM 主算法不改）**：B 版本周期守护（任务级 `deadline` 软截止 → `late`/`lateDays`/顶层 `lateCount`）/ C 流水线模板+返修回环（项目级 `templates` + 纯函数 `instantiateTemplate`，stage FS 链 + R 轮审核→返修）/ D 外包发单对象（项目级 `orders` + 纯函数 `analyzeOrders` → `atRisk`/顶层 `ordersAtRisk`）；三函数在 `scripts/schedule.mjs` 导出、`index.html` 内联同实现，回归 `tests/v2_bcd.mjs`（15 断言全过）。**v3 引擎四组已实现（2026-07-05，工作流编排，全 additive）**：① 完备性（自由浮动 `freeSlack` + 约束补齐 8 型 ALAP/SNLT/FNET/FNLT/MFO + 从完成日倒排 `scheduleFrom=finish`）/ ② 资源错峰建议（纯函数 `suggestLeveling` 贪心串行，残余超载消解）/ ③ WBS 层级摘要（`parent` + 卷积 `isSummary`/`depth`/`childIds`，摘要排除出 CPM/资源/错峰）/ ④ 冲突显式告警（`warnings`/`warningCount`：constraint-conflict/negative-slack/infeasible-window）；引擎两处同实现，回归 `tests/v3.mjs`（20 断言全过）。UI 全部收尾：自由浮动列/8约束/调度方向切换/告警面板/#btnSampleV3/错峰视图/**WBS 折叠三角+甘特摘要条**/**错峰应用建议按钮**（实测超载 3→0）。**表格格式协议 bpt-pm/table-v1 已加（2026-07-05）**：`docs/table-formats.md`（5 张数据源无关标准表：项目/任务/资源/外包单/模板，列名即协议、标输入vs写回）+ 生成器 `scripts/gen_tables.mjs`（空表模板/样例 CSV）+ `tests/tables.mjs`；服务阿里 AI 表格/Notion/飞书多维表等任意 base 建新格式 | 艾瑞卡会话 | 无阻塞待办；可选：消费上限恢复后重跑 v3 对抗验证工作流二次背书；**动手前必读** `projects/bpt-pm/CONTEXT.md` |

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

> **一句话**：官方 `@anthropic-ai/claude-agent-sdk` 的**公开信息再现**（自研引擎），drop-in 兼容公开接口，
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
  dispatch 输入。`pytest` 无涉、Node 侧 **`npx vitest run` 715 单测全绿（21 文件）**；`tsc` + `build` exit 0
- **提示词线（2026-07-04 起，2026-07-05 v5 提为默认）**：系统提示词五变体 v1–v5（公开信息再现，`src/engine/prompts.ts`，`harnessPromptVariant` 开关）。
  v2=v1 补真实行为纪律；v3=v2 补公开最佳实践四技法；v4=忠实再现官方主循环核心；**v5=全面忠实再现官方主循环**（Doing tasks/Tool use/
  Executing actions with care/Communicating 四节，工具引用适配本 SDK、不引未提供工具，~3774 tok）。**v5 已提为 claude_code preset 默认**
  （守密人 2026-07-05「2 模拟行为」+「目标是跟官方提示词一致」裁定）；v1–v4 保留为显式变体（要极简可 `harnessPromptVariant:'v1'`）。
  - **⚠ A/B 测量 bug 翻案（2026-07-05，踩坑 #44）**：早前判「v2/v3/v4 无可测收益」**作废**——A/B harness 选 variant 却没设 `systemPrompt` preset，
    variant 只在 preset 路径生效被静默忽略，两臂实际都跑极简默认。修复后 v1-vs-v5 真对照：**v5 ~3× 便宜**（$0.0089 vs $0.0272）、同正确（2/2）、略快，
    真因缓存（v5 95% 命中 vs v1 0%）。**反直觉正解：更大更忠实的提示词跨过缓存门槛反而更省**。
  - **缓存根因定论（受控探针实证）**：Haiku **有效**缓存门槛远高于名义 2048；~3.5k 精简前缀落「过名义门槛却小到不被真正归档」的**死区**（写≈0/读=0），
    v5 ~3.7k / --big ~8k 舒服落**可靠缓存区**（每轮+跨 request 命中 6000-8800 tok，同官方 99% 同构）。**非代码 bug**（wire 落位正确/跨轮累加无误/大前缀同路径完美缓存）。灌水非解、真实大而共享前缀（org 分层）才是。
  - A/B 基准 `tests/integration/ab-benchmark.mjs` 加**会真失败的硬任务** id 10/11（`verify(dir)` 动态 import 跑产物代码）；受控缓存探针 `tests/integration/cache-probe.mjs`（背靠背 N 次，per-turn 写/读，`--big` 隔离尺寸死区）。
  提示词架构综述见 `Public-Info-Pool/Resource/repo-engineering/bpt-sdk-prompt-cache-milestone-20260704.md`；对照实证见 `Public-Info-Pool/Resource/data-diagnostics/bpt-sdk-comparison-baseline-20260705.md`（§4 翻案 + §5 对齐重跑）
  - **vs-official 对齐重跑（run 28726339967，我方 v5 默认 vs 官方，提示词轴对齐）**：我方缓存从旧的 0%(短)/45%(长) **跳到 95-98%**、与官方 96-99% **打平**；成本差从旧的 ~8% **拉大到 ~3.6×**（$0.0533 vs $0.1918，我方省 72%，因官方每轮重读巨大缓存上下文 967,958 tok + 我方轮数更少 39 vs 55）；速度 **2.8× 保持**（40.6s vs 112.8s）；正确性 **11/11 vs 10/11**（官方 #11 反硬编码 33%，极可能无头 CLI 噪声、不宣「更准」）。守密人「跟官方一致」在行为层兑现：既模拟官方提示词与缓存经济学、又保住自研引擎结构性省钱提速
- **G 系列收官 + G8 决策落档（2026-07-05）**：G1 压缩前置层 / G2 Haiku 摘要 / G3 双缓存断点 / G4 子代理 Fork（对抗审查揪出 blocker、守密人「先修完整」后修好合入）/ G7 定位反转扫尾均已落（PR #435）；**G8 两条裁定入 `decisions.md`**（守密人 2026-07-05 授权代写）：定位反转 clean-room→公开信息再现、提示词装配层 Track B + v5 默认。
- **v0.6 起步 —— 生成器/分类器产品功能（守密人 2026-07-05「V0.6 加这些产品功能吧，这就是我们看到的黑盒」反转裁定，已落）**：把主循环**之外**的辅助 utility 模型调用作为真实公开 SDK 功能发货（`src/generators/`）——用户在 Claude Code 观测到的「黑盒」。五件：`detectCommandPrefix`（命令前缀/注入判定→权限白名单，**fail-closed** 空回复判 injection）/ `classifyBackgroundState`（后台运行状态→手机通知门，**fail-safe** 不伪造 blocked，接 v0.5 后台 Bash）/ `generateSessionTitle` / `generateTitleAndBranch`（分支强规整 kebab）/ `generateSessionName`。每件 = 忠实复现提示词（5 面 provenance + corpus-sync 守护）+ 一次性运行时（默认 Haiku、temp 0、注入式 transport 离线单测）+ 健壮解析（`extractJsonObject` 认字符串内花括号/转义）。红线满足（能力与提示词一并发货、有真实调用方）。**`npx vitest run` 838 单测全绿（+46）**、`tsc --noEmit` exit 0。原 G6「未发货不复现」判定被此裁定反转。
- **v0.6 剩余 Batch 1（守密人 2026-07-05「ultracode 推进 V0.6 剩余」裁定，已落）**：ultracode 8 代理工作流（6 设计 + 综合 + 红线批判 ADJUST）产执行路线图 `Public-Info-Pool/Resource/proposal/bpt-sdk-v06-remaining-execution-roadmap-20260705.md`（Tier 1 残项 + Tier 2/3 依赖排序、逐项过红线）；首批实现 ① **G-VERIFY**（`src/verifier/`）三态验证器 CONFIRMED/PLAUSIBLE/REFUTED + recall-biased 忠实复现（3 面 provenance + corpus-sync）+ `adversarialVerify` 公开 API + `parseVerdict` **fail-closed**（乱码/歧义/空→REFUTED、绝不 keep 未验证发现）+ 默认 haiku（批判揪出 sonnet 未测赌注、改齐）；② **G-SUMMARY** compaction 摘要器 no-tools 守卫 + verbatim 安全保全条（SUMMARIZER_SYSTEM 字节不变、旧金标保绿）+ `extractSummaryFromReply`（`<analysis>/<summary>` 契约、旧行为严格超集）+ `generateAwaySummary`（第 6 面生成器）。**`npx vitest run` 881 全绿（+43）**、`tsc` exit 0。G-HOOKCOND/G-SANDBOX 与编排/DSL/沙箱/技能留后续批（依赖排序见路线图档）。
- **v0.6 剩余 Batch 2 —— 补 hook 分类器子系统（守密人「这意味着我们内部没有实现对应的功能，补！」裁定，已落）**：反转原「3 hook 分类器降级 design-only」——降级唯一原因是「无消费子系统」，故建子系统、让分类器像 v0.6 生成器一样「功能与提示词一并发货」。① **上下文提示**（`src/tips/`）：情境目录注册表（复现 manual-polling/persistent-memory 两情境、可扩展）+ `selectContextTip`（复现 context-tip-selector，**fail-safe** 默认 no-tip、只返 eligible∩catalog 内 id、幻觉丢弃）+ `evaluateTipReception`（复现 reception-evaluator）；② **记忆文件选择**（生成器族第 7 面）`selectMemoryFilesToAttach`（复现 determine-which-memory-files-to-attach，接 settingSources/记忆加载，**≤5、只返可用集内文件名、幻觉丢弃、fail-safe 空表**、无文件零调用短路）。5 条新复现字节级与归档一致（reverse-diff）。**930 全绿（+55）**。云端 slug 仍 reference-only（本地引擎不造云面），本地形态归 Track 2/3。
- **v0.6 剩余 Batch 2 续 —— G-HOOKCOND + O-B0（守密人「继续」，已落）**：① `HookCallbackMatcher.condition` 条件门控（忠实复现 hook-condition 评估器 base+stop 双变体，**fail-closed**：不满足/乱码/出错跳过回调；无 condition 零调用、存量行为不变）；② worker-fork preset（忠实复现 framing + `buildWorkerForkPrompt` + `WORKER_FORK_AGENT`，挂 G4 fork 机制零 runtime 改动；coordinator 留 O-B2 先建 SendMessage 本体）。3 条新复现字节级一致。**952 全绿（+22）**。
- **v0.6 剩余 Batch 3 —— G-SANDBOX + 卫生批（守密人「G-SANDBOX 推荐 / 网络默认断网」裁定，已落）**：默认开启的 Bash 沙箱、可插拔后端（`src/sandbox/`）：`resolveSandboxBackend`（Linux+bwrap→BwrapBackend，否则 null 优雅降级；注入式后端接缝）+ `BwrapBackend`（纯 argv ro-root + writablePath rw-bind + `--unshare-net` 默认断网 + `$TMPDIR`，只做归档描述的限制、不发明读隐藏/seccomp）+ 证据检测（沙箱致败→`[sandbox]` 提示）。双 spawn 位经 `planShellSpawn` 同接缝、持久 cwd/env 沙箱内仍工作；escape 走权限门 ask（Bash 非只读天然不自动放行）、mandatory 政策拒绝。**描述/schema 门控红线**（未激活字节不变、无 param、不含 "sandbox"；激活加 17 忠实指引片段 corpus-sync 字节对齐 + param；断网默认才装网络证据片段）。**Windows/macOS 无后端如实降级、不假装隔离**。卫生批：红线常驻守卫 `tests/red-line-tool-names.test.ts` + plan 注释订正 + 任务#17（G-cmp 一致性套件 M1-M4 早封顶）对账 completed；conformance/emulator 钉 `sandbox:false` 保确定性。**1026 全绿 + 2 skipped（真 bwrap 测试）**、`tsc`+`build` exit 0。**v0.6 Tier-1 ship-now 批至此全部收官**（PR #455 已合并）。
- **引擎对齐批 E1–E5（2026-07-05，隔壁 L5 会话交接档 `bpt-sdk-engine-alignment-handoff-20260705.md` 派单，已落）**：五条引擎侧官方对齐，关键行全部对**真官方臂**双臂实测收敛——① **E1** `claude_code` preset 默认开思考（官方 54/54 留痕实证默认开；预算 4096 为**我方选定值**、官方预算不可观测、COMPAT 登记 KD；`maxThinkingTokens:0` / `thinking disabled` 显式关闭口；非 preset 路径零变化；预算经 maxThinkingTokens 注入使 live `setMaxThinkingTokens(0)` 也能关）；② **E4** Write 读前写门（官方语义 L5 活体钉死：新建放行/未读已存在拦/读后放行，错误文案**逐字**官方；`readFilePaths` 每 query 一份、子代理同引用穿线；Read/Write/Edit 成功自注册防 create-then-revise 自锁；**L3-WRITE-02 对官方臂 CONTENT_MATCH、KD-L3-06 退役**）；③ **E5** maxBudgetUsd 执行前截停（超限时请求中的工具组零执行、不发 tool_result 用户轮、终态 error_max_budget_usd，对齐官方公开流形态；自然收尾轮不作废语义保留；**L2 s12 DIVERGENT→MATCH、engineFinding 退役**）；④ **E3** 截断轮优雅降级（transport 标记 `midStreamTruncation` + accumulator `salvageTruncated` 只留整块：text 部分产出成 success 答案、完整 tool_use **照常执行 + 续轮送 tool_result**（无论 stop_reason 是否送达）、未闭合 tool_use 绝不执行；连接错误作非致命注记入 `result.errors`；**L4 三条保红行 engineFinding 全清、KD-L4-04 全退役、KD-L4-02 收窄至 errorPresent 单 facet**；官方 spike-S4「result 后迭代器抛错」怪癖刻意不复刻）；⑤ **E2** result 口径对齐（`num_turns`/`usage` 改逐 result、`total_cost_usd`/`duration_api_ms` 会话累计；**破坏性**：存量把末 result 的 num_turns/usage 当会话总量的消费方须改跨 result 求和，见 MIGRATION 5e；内部会话级 maxTurns/maxBudgetUsd 强制执行不动；联动 run-l5 `perResultArm` 按臂聚合分支合并单规则、**KD-L5-04 退役**、KD-L5-03 标注 RESOLVED-by-E1 待下轮真 L5 确认）。**1049 全绿 + 2 skipped**、`tsc`+`build` exit 0、棘轮基线三次升级（全为 improvement 方向）。E1 最终验收 = 守密人派发一轮真 L5（`conformance_l5` dispatch，$1.5 帽内）。
- **官方文档逐条接口对账（2026-07-05，守密人「逐条比对官方文档的接口说明」派发，已落）**：live 官方 TypeScript
  参考全文（3550 行，`.md` 直取）快照入 `Public-Info-Pool/Reference/Agent-SDK-Docs/typescript-20260705.md`；
  五区段并行代理逐条比对（函数/Options 61 字段/Query/消息流 32 变体/Hook 20 事件/工具输入输出 27+22 型/权限/沙箱），
  审计档 `Public-Info-Pool/Resource/repo-engineering/bpt-sdk-official-docs-interface-audit-20260705.md`
  （07-03 完成度审计 146 行矩阵的字段级续篇）。**三层产出**：① drop-in 破坏级差异 15 项总榜（头部：
  ToolInput/OutputSchemas 两章零导出 / 观测臂 8 变体判别式反向其中 6 个真发射 / tool() 第 5 参 extras 包装形态不兼容 /
  deferred_tool_use 三字段名错位 / 4 个类型导出名拼写差 / RewindFilesResult·McpSetServersResult 零共同字段 /
  Task 四件套缺席且 TodoWrite 默认轨反向 / Grep `context` 静默丢参）；② **COMPAT.md 15 处陈旧行已同步修订**
  （五 Query 方法假 UNSUPPORTED、permissionMode auto 自相矛盾、hooks 表 5 行、init 四字段假 absent、
  ACCEPTED 大杂烩行 5 项已毕业等）；③ NEW-IN-DOCS 挂账（settingSources 默认语义 live 反转为唯一行为级反转、
  六新 hook 事件、SDKMessageOrigin、claudeai-proxy 等，与漂移哨兵 0.3.201 同一升钉裁定点）。
  修复 backlog P0/P1/P2 建议在审计档 §5，待守密人裁定后开工（本轮纯文档、零代码改动）。
- **Desktop UI 参考线（2026-07-04，07-05 r2 修订 + 路线草案收口）**：BPT Desktop 前端参考情报档
  （守密人转交 GPT-5.5 搜索梗概 + AnySearch 许可证逐项实锤 + UI 组件↔`SDKMessage` 流对接表）落
  `Public-Info-Pool/Resource/repo-engineering/bpt-desktop-ui-reference-20260704-r2.md`——
  绿区（MIT/Apache 可借码：assistant-ui / AI Elements / Goose / LibreChat 等）/ 黄区（Open WebUI 品牌条款、
  LobeChat 社区许可证）/ 红区（Cherry Studio AGPL 双许可、Chatbox GPLv3 只看不抄）三级红绿灯 +
  净室边界（Claude Desktop 逆向产物零复制）。**第二弹（同日）**：Claude Desktop 本体全结构黑箱观察规格
  `Public-Info-Pool/Resource/repo-engineering/claude-desktop-ui-structure-20260704-r2.md`（三标签 Chat/Cowork/Code
  逐节结构；Code 标签为官方文档全文取证最高置信——会话/worktree 模型、权限五档、八 pane、diff 行评、
  CI 状态条、computer use 三档 app 权限、快捷键全表；附证据分级与残余盲区；同日修订融入
  **Claude Design** 节——Labs 视觉工作区双平面布局 / 画布编辑 / Export 交接 / 桌面集成反模式教训）
  + 配套单文件线框图 `claude-desktop-ui-wireframe-20260704.html`（四线框：Chat/Cowork/Code/Design）。
  **07-05 自洽审视后 r2**：两档 git mv 升 `-r2`（对接表补 TodoWrite/AskUserQuestion/compact_boundary/
  thinking/斜杠命令五行、权限模式清单补全并标注 Desktop auto 档 SDK 不提供、底座三层辨析
  ——引擎底座 bpt-agent-sdk / UI 组件底座 assistant-ui·AI Elements / Vercel AI SDK 不需引入仅涉 adapter）；
  **第四弹落地路线草案** `Public-Info-Pool/Resource/repo-engineering/bpt-desktop-ui-roadmap-20260705.md`
  （M0 引擎接线与 IPC 契约 → M1 最小可信对话环 → M2 agent 透明化 → M3 工程面 → M4 演进留位，
  每 M 带行为级验收；待守密人回填 BPT 现状后升 r2 校准）
- **一致性测试套件（2026-07-05 拷问定稿开工，设计蓝图
  `Public-Info-Pool/Resource/repo-engineering/bpt-sdk-conformance-suite-design-20260705-r2.md`）**：
  五层金字塔（L1 流语法 / L2 选项语义 / L3 工具差分 / L4 故障注入 / L5 端到端统计带，L6 行为指纹后置留痕）；
  硬约束「净室观测边界」已录 decisions.md（对照物白名单 / 内容盲纪律 / 泄漏衍生禁引 claw-code 系）。
  **spike 三断点全通**（官方臂无头 + localhost 仿真器 + 协议面极窄，$0，剖面档
  `bpt-sdk-official-arm-protocol-profile-20260705.md`）→ 活体差分架构成立。
  **M1 已落地**：`tests/conformance/`（内容盲仿真器正式版 + L1 差分 `run-l1.mjs` + 双包同钉 pins.json）
  + CI `conformance-l1` 无钥零费常跑 + vitest 流语法回归锁；**首份矩阵 3/3 MATCH_WITH_KNOWN_DIFFS、
  零未解释分歧**，KD-01~05 已知差异登记（KD-05 消息粒度 = 官方逐块/逐 tool_result 拆消息 vs 本 SDK 按轮合批，
  引擎对齐候选）。708 单测全绿（+6）。
  **M2 已落地（2026-07-05，ultracode 编排：8 代理 / 测绘-实现-集成-对抗审查四阶段）**：L2 选项语义差分
  15 场景（`run-l2.mjs`，12 已知差异内全等 + 2 条**有意保红引擎发现**：s6 bypass 互锁为 BPT 独有严格性
  ——官方 0.3.199/2.1.201 实测不执行互锁；s12 maxBudgetUsd 我方在途工具执行后才截停、官方执行前截停
  ——对齐候选）+ L2 单臂语义锁 16 条（`conformance-l2-locks.test.ts`）+ L3 工具行为差分 20 用例
  （`run-l3.mjs`，tool_result 内容级，0 未解释分歧，KD-L3-01~21 登记；**Write 缺读前写门**为加固候选
  ——官方拒绝覆写未读文件、我方直接覆写）。流 KD 表扩至 KD-01~11（含作用域限定机制防允许表泛化遮蔽）。
  CI `conformance` 作业 L1-L3 三连无钥常跑。对抗审查 2 major + 4 minor 全部修复（s2/s3 空转改承重设计、
  s14 会话继承污染清洗 + 存储级连续性证明、KD-10 归因模式校验、crossCompare 无 KD 豁免洞封死）。
  **770 单测全绿（28 文件）**。
  **M3+M4 已落地（2026-07-05，第二轮 ultracode：9 代理零错误）**：L4 故障注入差分 9 用例
  （429/风暴/500/400/截断×3/悬挂+abort/脚本耗尽，POST 计数硬判重试语义；KD-12 + KD-L4-01~04 登记；
  **3 条有意保红引擎发现**：截断轮官方优雅降级续跑、我方丢轮丢工具执行——加固候选）+ **记分牌棘轮升格
  CI 门禁**（`baseline.json` 51 行入库，绿灯只增不减、判劣/覆盖丢失/新 KD/新引擎发现全红，`--update`
  显式升基线带 RED-LOCK 警告）+ **漂移哨兵**（周 cron 只报不追；**首跑即抓到真漂移：官方 agent-sdk
  0.3.199→0.3.201 已发布，待守密人裁定是否追**）+ **L5 五维任务库 18 任务**（中文变体贯穿 + 跨轮记忆
  长会话；`run-l5.mjs` 真 API 双臂 + 乙门禁 ≤5pp + $1.5 预算护栏 + L6 官方臂公开流留痕 + `--smoke`
  无钥自证；CI `conformance_l5` dispatch 输入就绪）。对抗审查 1 major + 7 minor 全修（截断场景故障
  显形锁 + cutMarker 响亮失败 + 棋轮零条目拒收/RED-LOCK + L5 预算盲区/trace 容错/分片门禁确认旗）。
  **799 单测全绿（29 文件）**；一致性验证体系 M1-M4 全部封顶，**首轮真 L5 已收官（run 28736460533，repeat=3，108/108 跑完，$1.12 < $1.5 帽）：
  乙门禁 PASS——聚合通过率两臂完全打平 48/54 (88.9%) vs 48/54 (88.9%)，差值 0.0pp（容忍 -5pp）**；
  效率轴（只记分）本 SDK 几乎每任务更便宜更快（如 code-04：$0.0103 vs $0.0292、4 轮 vs 12 轮）；
  双臂缓存均 scenario a（首轮官方臂 scenario b 系单跑冷启动假象）；L6 官方臂留痕 54 份入 artifact。
  任务级线索（非门禁项，可选跟进）：本 SDK 稳定挂 chat-03/code-01、官方稳定挂 longconv-02(中文跨轮记忆)+code-03。
  **L5 失败点解剖已收官（2026-07-05，挂账 A 完成）**：四点解剖档
  `Public-Info-Pool/Resource/repo-engineering/bpt-sdk-l5-failure-dissection-20260705.md`——收敛到三系统变量 + 一度量伪影：
  **S1 思考不对称**（官方 CLI 默认开 thinking，54/54 留痕含 thinking_tokens 事件计 1161 次；我方引擎默认关）= 我方 chat-03（逆字母序
  8-token 抢答答成正序）与 code-01（只排序不处理偶数长度；官方带思考也仅 2/3）的共同真因；**S2 /tmp 锚定 + 跨 repeat 污染**（官方
  Write 强制绝对路径→Haiku 猜 /tmp/<文件名>，r1 遗留物经读前写门把 r2/r3 引进死胡同）= 官方 code-03 r2/r3 + longconv-02 r3 真因，
  无污染反事实官方 code-03 ≈ 3/3；**S3 官方安全姿态过敏**（把良性中文「记住 X 只需确认」判为注入拒绝）= 官方 longconv-02 r1/r2；
  **M1 度量伪影**：官方臂流式多轮每轮各发 result、runOne 取 lastResult → 报表 turns=1，「提前终局」系误读（上下文实际跨轮保留）。
  修复方案：Fix-1 claude_code preset 默认开 thinking（budget 4096 起步，管线 computeThinking 已就绪；预算值不可知——读官方请求体越
  内容盲边界，登记 KD）/ Fix-2 L5 双臂 maxThinkingTokens 显式同参拆变量；退出标准 chat-03 ≥2/3、code-01 ≥官方−1、乙门禁保 PASS。
  顺手实锤 B②规格：官方 Write 读前写门仅拦已存在文件、新建不拦。
  **L5 测试用例层加固已落（2026-07-05，解剖挂账三项 + 附带新 KD）**：① S2 污染面封堵——任务库 11 个带档案产物任务加 `strays`
  声明（任务自有文件名白名单），runner 每 run 前后在 tmpdir 根定点清扫（pre 恢复 ENOENT 自救信号 / post 把「本 run 写歪了」升为
  行级观测字段 `strayArtifacts`，判分语义零变动）；② M1 度量修正——双臂流式多轮均逐轮发 result，按臂聚合（官方 num_turns/usage
  逐 result 求和、cost/apiMs 取累计末值；我方全字段累计取末值、apiMs 逐 run 求和）；③ KD 表 `L5_KNOWN_DIFFERENCES` 落任务库并
  透传报告 per-task 汇总（KD-L5-01 官方 /tmp 锚定 / KD-L5-02 官方注入误判方差 / KD-L5-03 思考不对称）。**附带发现 KD-L5-04**：
  两引擎 result 累计口径本身分歧（官方 num_turns/usage 逐 result vs 我方 finding #33 全字段会话累计）——drop-in 面引擎对齐候选。
  `--smoke` 3/3 绿 + 预置散落物清扫实测 + `npx vitest run` 981 全绿。
  **净室 r3 内容盲解除 + 请求体线缆差分已落（2026-07-05，守密人「放弃净室规定」裁定，范围问答定为「仅解除内容盲(②)」）**：
  decisions.md r3 修订——一致性观测中官方臂请求体现允许读取对照（内容按 #421 已属公开、读之不泄新信息），①对照物白名单/③泄漏禁引/
  §1.1-HC 防火墙三者不变永久保留。工程：`emulator.mjs` 请求体从无缓冲丢弃升级为**可选捕获**（`{captureBodies}`，默认仍丢弃、
  既有 L1-L5 逐字节不变），`assertContentBlind` 降级为产物体积卫生检查（既有报告仍无请求体故仍 PASS）；新增结构指纹
  `wire-fingerprint.mjs`（系统分段/缓存断点/工具集/thinking 配置）+ 双臂差分 `run-wire.mjs`（keyless，两臂各驱一轮、
  对比请求体结构）+ 机制自证 `tests/conformance-wire.test.ts`（6 用例，无需官方臂）。**首跑真发现（本地官方臂 0.3.199/2.1.201）**：
  官方 thinking **`{type:"adaptive"}` 无固定预算**——推翻解剖「预算不可观测、只能猜 4096」的判断（内容盲解除后直接读到），
  引擎对齐候选=claude_code 默认改自适应思考（可能顺带移动 code-01 残余，比固定 --thinking 探针更干净）；另官方工具 cache_control
  断点 0 vs 我方 1（缓存策略差）。工具集 34 vs 13 归「预期表面差」（CLI 自带 Cron*/Task*/Workflow/Skills 等产品工具、SDK 不发）。
  `tsc` + `npx vitest run` **1085 全绿**。
  **SSE 网关方言容错已落（2026-07-05，BPT 产线故障闭环）**：BPT 实测「Malformed SSE payload for event "(none)"」
  经双侧协作定型——BPT `curl -N` 抓原始字节实锤 idealab 网关 `/api/anthropic` 端点带 OpenAI 方言遗留
  （流尾追加 `data: [DONE]`、错误帧无 event 行）；官方客户端 message_stop 即收工不碰尾卡、我方读到流关闭才撞上。
  修复（`src/transport/anthropic.ts`）：① message_stop 即收工（官方同款生命周期，尾部废卡不进解析器）
  ② stop 前无 event 名非 JSON 帧跳过（debug 留片段）③ 有 event 名坏帧照抛且带现场（前 120 字符 + 已解析帧数
  ——交接单 **E6b 就地落地**，交接档 r2 已注记引擎侧勿重做）。5 条回归测试；`npx vitest run` **1030 全绿（35 文件）**、
  `tsc` + build exit 0。BPT 侧只需装新 build 验证。
  **测试用例完备性全面推进已落（2026-07-05，守密人「全面推进」裁定，四缺口一批清）**：
  ① **环境保真轴建轴**——仿真器加 `sse-gateway` 脚本类（`[DONE]` 尾卡 / 无 event 名帧，复刻 idealab 原始字节形状），
  L4 新增 3 场景双臂差分：`[DONE]` 尾卡（文本轮 + 工具链轮）**双臂全绿**（#461 修复差分成立）；无名错误帧抓到**真发现
  KD-L4-05**（两轮稳定）：官方 2.1.201 不认无名错误帧、当「空/畸形响应」**重试一次**并把失败编码成 assistant 文本 +
  result/success——对 BPT 产线的实义：官方客户端在 idealab 后面会重试并 success 化 API 错误、我方快速失败带真错误类型；
  ② **MCP 差分首批（L3 扩容）**——arm.mjs `buildOptions` 加每臂 SDK 句柄（各臂用自家 `tool()`/`createSdkMcpServer`
  建进程内服务器），4 场景：ping/软失败 isError **双臂 CONTENT_MATCH**（结果编码逐字一致），抛异常/未注册工具措辞差
  两轮稳定入 KD-L3-22/23（zod schema 语义留第二批）；③ **Fix-2 落地**——run-l5 `--thinking=N` 双臂同预算钉死
  （拆引擎差 vs 思考差），workflow 加 `l5_thinking` dispatch 输入；④ **聚合自证**——runner 度量规则抽成
  `l5-aggregate.mjs`，vitest 喂 run 28736460533 真实官方 result 序列锁定（多 result 求和/取末值、空跑、缺字段防 NaN）。
  棘轮基线 +7 行全改进项锁入；L1-L4 双臂全跑收敛（L4 12/12、L3 零发散、零未分诊候选）；`npx vitest run` **1060 全绿**。
  剩余挂账：MCP 差分第二批（schema 语义/annotations/stdio-http 传输）、子代理/hook 差分（L3.5，大活）。
  **白盒接口覆盖计划已立（2026-07-05，守密人「针对每个接口白盒测试」裁定）**：现状厘清——黑盒差分（L1-L5）是官方臂
  内容盲边界下的必然形态，我方自身侧本就有千余条白盒单测，但**测试随功能长、没人逐接口对过账**。对账结果：公开面
  66 导出 + 48 Options 字段 + 17 Query 方法中，**15 个接口点全测试树零覆盖**。处置：① 7 个导出缺口当批补齐
  （`tests/api-surface-gaps.test.ts`：NotImplementedError / COMMAND_INJECTION_TOKEN 哨兵契约 / DEFAULT_UTILITY_MODEL /
  resolveUtilityTransport 注入席位 / runVerification fail-closed / renderCatalog / buildSelectorUserTurn）；
  ② **永久性覆盖守卫**（`tests/api-surface-coverage.test.ts`）：枚举导出+Options+Query 三面对账全测试树，
  新接口不带测试即红、白名单只减不增（陈旧条目自动红）——覆盖率地板制度化；③ 剩余 8 点挂守卫白名单可见化
  （4 Options 字段 includeEnvironmentContext/onElicitation/sessionStoreFlush/toolSearch + 4 Query 方法
  reconnectMcpServer/toggleMcpServer/setMcpServers/streamInput，各标欠账原因）= **白盒补齐 batch 2**。
  `npx vitest run` **1079 全绿（37 文件，+19）**。
  **E1 后验收轮真 L5 已收官（2026-07-05，run 28741914245，repeat=3，108/108，$1.156 < $1.5 帽，双引擎各自默认）**：
  **乙门禁 PASS 且首次正向拉开——我方 50/54（92.6%）vs 官方 43/54（79.6%），差值 +13.0pp**（首轮为 88.9% 打平）。
  退出标准三过一未过：**chat-03 0/3→3/3 兑现**（E1 思考直接修复，KD-L5-03 的答前计算半边正式 RESOLVED）；econ 轴我方
  总开销 $0.355 vs 官方 $0.801（省 2.25×）✓；门禁 PASS ✓；**code-01 仍 0/3 未过**（三跑仍只排序不处理偶数长度；官方 2/3
  且花 ~3× token——残余是 diligence 概率而非思考开关位，KD-L5-03 注记已改「chat 半边 RESOLVED / code-01 残余保留」，
  候选隔离手段 Fix-2 同预算轮；**反 Goodhart：不为过题往 v5 塞私货条款**）。官方本轮大跌的主因是 **KD-L5-01 /tmp 锚定
  在散落物清扫恢复逐跑独立后原形毕露**：54 跑中 11 次 stray 实录（longconv-01 三跑全歪 0/3、code-03 1/3、code-05 1/3、
  longconv-02 1/3、code-02 2/3）——首轮官方 88.9% 部分靠污染假象撑起；KD-L5-02 注入拒绝本轮零发作（方差实锤）。
  **新观测**：思考开启后我方 chat-01 r3 出现 202 output tokens 但可见文本为空的「纯思考回复」边缘（1/54），
  已记 KD-L5-03 注记尾，引擎跟进候选。
  （首轮 run 28735894053 因预算护栏冷启动外推误停 2/180，护栏已修 #447）。**一致性验证体系 M1-M4 全部封顶**
- **完成度（表面等价）**：对官方 SDK **0.3.199 基线**约 **89.5%**（v0.1 基线 68.3% → v0.2+v0.3 补齐后重算）。
  审计矩阵与逐行台账落 `Public-Info-Pool/Resource/repo-engineering/bpt-agent-sdk-completion-audit-20260703.md`
  + 同名 `-matrix-20260703.json`（146 行）
- **两轴保真模型（关键认知，勿混淆两轴）**：
  - **表面完整度（SURFACE）**：可收敛，约 90%+——接口、类型、消息变体、工具/MCP/hooks 面照抄公开契约即可补齐
  - **行为保真度（BEHAVIORAL）**：**可逼近、残余主要由模型选择决定**（2026-07-04 定位反转）——放弃 clean-room 后，
    官方提示词结构可经公开还原研读、按自有工具适配，此前「因拒看专有而永补不平」的结构性封顶**解除**；残余行为差的主导项
    是 BPT 主权模型选择（换模型换手感），非提示词。追平官方逐版行为仍非北极星（体验主权在 BPT 自己）
- **v0.3 头号交付**：**per-run 预算/效率仪表**（`result.metrics` = `SDKRunMetrics`：perTurn / perTool /
  cacheHitRatio / 模型用量 / 成本 / API 耗时）。回应守密人「整体效率低下会累积成巨大差别」之忧——
  把「效率」从不可见变成每轮可量。A/B 演示 harness：`examples/ab-metrics.mjs`（缓存开/关对照表）
- **默认配置决策**：**提示词缓存默认开**（`provider.promptCaching !== false`，v0.3 翻转，多轮对话省 input 账单）
- **公开信息再现纪律（2026-07-04 守密人裁定，覆盖原「干净室硬约束」）**：定位从 clean-room 反转为**公开信息再现、明确署名**。
  四条腿构建：公开文档 + 提示词还原（Piebald 等，公开 GitHub/MIT/逆向自公开分发 CLI）+ 自研引擎 + 参考其他开源 CC 还原项目。
  **不变**：§1.1-HC 黑池防火墙、拒绝真正的内部未授权泄漏、不逐字大段克隆（工程卫生 + 版权 + 他们提示词是给他们工具调的、照抄反劣化）。
  裁定见 `memory/decisions.md`；架构推断成果见 `Public-Info-Pool/Resource/repo-engineering/official-cc-prompt-architecture-inference-20260704.md`
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
- **沙箱**：**再现且默认开启**（守密人 2026-07-04「全做、一样默认开启」裁定，**更新** 2026-07-03「N/A-by-design」旧裁定）。
  即 `bash-sandbox-*` 能力本体照官方再现、BPT 默认启用，与全做其余项一致

## BPT-V2T 语音代替输入（`projects/bpt-v2t/`）

> **一句话**：本地「语音代替键盘输入」工具——按热键说话 → 转文字 → 注入正在打字处，
> 用《忘却前夜》专名词典提升识别率。**非使命线**工程子项目。

- **动手前必读**：`projects/bpt-v2t/CONTEXT.md`
- **派发 + 三连降维（守密人 2026-07-05）**：原诉求「持续录音 + 声纹录入识别 + 专名增益、
  对标钉钉听记」，同会话守密人降维——① 转录引擎重决策（FunASR/云/sherpa）**暂缓**；
  ② 交付层收敛为**仅语音代替输入**（不做持续会议转录/听记完整体验）；③ 声纹**暂不做**。
- **首期已落盘（2026-07-05）**：`projects/bpt-v2t/` 骨架。内核（云端可测）+ 本地薄壳两分：
  内核 `hotwords.py`（复用 `scripts/silver_tokenizer.domain_dict()`，热词 **125 词**、
  偏置串按世界观词→角色名优先级填 whisper `initial_prompt`）+ 可插拔后端 `backends/`
  （`fake` 测试后端 + `faster-whisper` 默认离线引擎，惰性加载、注册表可 `register` 挂 FunASR）；
  外壳 `recorder.py`（麦克风）/`injector.py`（print/clipboard/type）/`cli.py`（推挽循环），须本机跑。
  **验证**：`pytest projects/bpt-v2t/tests -v` **13/13 全绿**（仅依赖内核 + 假后端，无需麦克风/真模型）。
- **硬事实**：云端容器无麦克风，故内核云端可建可测、录音+注入外壳只能守密人本机跑。
- **后续轮次候选**（守密人裁定后再动）：换/加真引擎（FunASR 热词+流式/云 API）、声纹录入识别、
  持续录音+实时字幕+说话人分离（听记级）、VAD 断句 + 托盘壳 + 全局快捷键。

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

**全仓知识组织（2026-07-04 同日，ultracode 多代理编排落地）**：承接上条，OKF bundle 从 4 层
扩到**覆盖全仓知识域**——**12 层 / ~293 概念**：原生 characters(72)/sources(17)/memory(45,扩全层)/
story(11,扩) + 新增 assets(12,事实圣经)/wiki-data(26)/**community(19,归档社区全量档案 7.5M+ 条分析镜头)**/
news-output(23)/unpacked(13)/extracted(4)/resource(34)/projects(17,含 CLAUDE.md/README 入口+CONTEXT+藏宝图+设计文档)。新层由 import-only
库 `scripts/okf_pointer_layers.py` 确定性生成；kb_index 覆盖 294 概念、`kb_*` 导航跨全仓。三条铁律守恒
（归档 2.1G/解包 44M 只指针不复刻、data_layer 标层、无黑池数据）。守护 `tests/test_okf_pointer_layers.py`。
编排溯源：`organize-repo-knowledge`（测绘+合成+批判）+ `verify-repo-knowledge-org`（5 维对抗式核验）工作流。

**知识层北极星锚定 + 治理不变量地基（2026-07-04，Pillar B）**：守密人会话把知识层定位结晶为
**神经符号白盒骨架**（`memory/knowledge-layer-design.md`：OKF=有结构的概念网络承载白盒知识，
区别于神经网络黑盒；三命令=白盒只花骨架/测不变量/守覆盖哨兵；改造路线 A 连网络→B 治理→C 覆盖哨兵
→D 扩散激活→E 减易变）。**Pillar B 已落地**：`tests/test_kb_governance.py`——生成器假设绊线
（no domain:misc / unpacked slug / memory·story 白名单⊆实况 / 层非空）+ **结构指纹 keystone**
（`build_okf_bundle.structural_fingerprint`，排易变量的规范哈希；不变量：committed okf/ 结构须恒等于
源重建，抓「改源忘重建」stale commit）。现状基线：约 200/293 概念度数=0（孤立指针群岛）。
**Pillar A 已落地（2026-07-04，守密人边策略裁定「选 1」）**：实测证明选项 1（不造噪声星）下几无可加的
干净高信号边，故 A 从「加边」诚实收束为「**显式声明两层结构**」——skeleton（characters/sources/community/
news-output，连通 76%）vs search（参考层，有意孤立、kb_search 可达）。tier 落 kb_index/graph 节点 +
kb_navigator overview 报告；绊线 `test_skeleton_is_actually_connected`（骨架连通≥60%）锁设计属性。
**Pillar D 扩散激活检索已落地（2026-07-04「再 D」）**：`kb_activate`（MCP 第 9 工具）从种子沿骨架
多跳带衰减扩散、按边类型加权（剪枝即加权），返回被点亮子图=联想召回。实证 `activate("discord")`
跨层点亮全量镜头+输出抽样+分析索引（搜索连不到的结构）。MCP 工具 8→9。
**Pillar C 覆盖哨兵 + E 减易变已落地（2026-07-04「再做 CE」）**：C=`tests/test_kb_coverage_sentinel.py`
扫全仓知识文件断言每个被概念覆盖（守假完备，实测仅 processed/README.md meta 豁免）；E=`_magnitude()`
把 community 每时增长的精确条数→量级桶「百万级（精确值见指针本体）」（杀 churn、锐化白/黑盒边界）。
**至此北极星五支柱全落地**：A 两层结构 / B 治理不变量 / D 扩散激活 / C 覆盖哨兵 / E 减易变，**改造路线收尾完成**。

**知识库有效性评判体系（2026-07-04「如何追踪评判是否有效」派发，逐个推进）**：
- **#1 黄金问题集已落地（v2 定制化，守密人 2026-07-04「应该定制化设计」）**：`scripts/kb_eval.py`（评分器，**按能力分打分**）+ `tests/kb_golden_questions.json`（17 题，每题标 `capability`+`distinctive`）+ `tests/test_kb_golden.py`。**定制化核心洞察**：通用「X 是谁」关键词题测的是 KB=grep 的维度、稀释了 KB 价值；应按 **KB 独门能力**出题（associative/cross_layer/layer_aware/identity），`distinctive=true`（grep 到不了的 token 脱节题）的命中率才是**「KB 作用」的分数**。实测**★distinctive hit@3=1.00（4/4）**、总 0.94、门槛（总 0.62 / distinctive 0.80）。**验证守密人点**：定制化后 A/B 的 Δ 从 +0.10 跳到 **+0.24**（通用集稀释了 KB 优势）。诚实边界：hit@k 只测检索类能力（associative/keyword）；层判定/身份/边界等**质性能力**靠不变量测试与遥测，非黄金集能盖全——「验证 KB 作用」本就是多仪器的事。记分卡 `python3 scripts/kb_eval.py`。
  - **图驱动黄金集扩容（守密人 2026-07-04「黄金集数量太少」）**：洞察=**白盒图每条带类型边本身就是一条标准答案**，故能从图**自动生成**黄金集。`scripts/kb_golden_gen.py`（内存生成、不落 committed 文件防 churn，复用 `kb_eval`/`kb_ab`）从图确定性造四类题（identity/associative 1 跳/associative 2 跳 token 脱节/layer），**262 题、其中 162 distinctive**（手写集仅 4）。规模化 A/B：**KB 0.98 vs grep 0.37（Δ+0.61）**——联想题 176 道 KB 171/grep 11，规模上稳稳复现「联想是 KB 独占、grep 结构上塌」。**诚实注**：生成的联想题对 KB 是「送分题」（activate 顺边走必中），故本集测的是**grep-gap 与覆盖广度在规模上稳不稳**、非刁难 KB；真 held-out 难题靠 #2 遥测零命中回流。守护 `tests/test_kb_golden_generated.py`（规模≥150/distinctive≥80、Δ≥0.30、KB 自生成 distinctive 命中≥0.90）。生成器 `python3 scripts/kb_golden_gen.py`。
- **#2 MCP 工具埋点已落地**（追踪的地基）：`scripts/kb_telemetry.py`（`log_call` best-effort 埋点 + `summarize` 使用报告）；`mcp_server` 的 5 个 `kb_*` 工具在消费边界接入埋点（只记真实消费、不记测试/CLI）。日志落 **gitignored** `Public-Info-Pool/Rough/kb_usage.jsonl`（瞬态、不 churn）。报告 `python3 scripts/kb_telemetry.py` 暴露：调用分布 / 触达概念率 / **死概念**（从未导航到=剪枝候选）/ **零命中查询**（覆盖哨兵看不见的需求缺口）。守护 `tests/test_kb_telemetry.py`。
  - **零命中回流（2026-07-04 推进，闭合 #1↔#2）**：`harvest_gaps()` 把「用户真的问了、KB 却零命中」的查询抽成 **held-out 难题候选**（`capability=held_out`、`expect` 待人工分诊）。补上评判 #1 的诚实缺口——图驱动生成的黄金集对 KB 是「送分题」（顺边必中），**真难题只能来自需求侧现实**。两条腿：生成集管够多够全、遥测回流管够难够真。`python3 scripts/kb_telemetry.py --harvest`。
- **#3 反事实 A/B 已落地**（检索层确定性半）：`scripts/kb_ab.py` 比 KB 结构化检索 vs 朴素 grep（同语料 okf 概念、同黄金目标）。**实测 KB 0.80 vs grep 0.70（Δ+0.10）**——**分模式铁证「OKF ≠ 搜索」**：关键词题 KB=grep=13（打平，纯查串 grep 就够）、联想题 KB=3/grep=1（KB 胜，grep 无从遍历 token 脱节 lore 边，如「萝坦→奥吉尔」零共享字）。守护 `tests/test_kb_ab.py`（KB 不劣于 grep + 联想题严格胜）。
  - **最强 grep 基线（2026-07-04 推进，反稻草人）**：`grep_baseline_strong` 把朴素 grep 一切能占的便宜给足（整串短语命中 ×10 + id/标题字段命中 ×5 + 逐 token TF）。实测**联想题上 KB=6 而最强 grep 仍只 2**——证明 KB 的联想优势是**结构**（顺关系边遍历），非拿弱基线凑的假象。新增回归 `test_kb_wins_associative_even_vs_strongest_grep`，彻底堵死「你的 grep 是稻草人」。
  - **全量 LLM 答题反事实（人工协议·金标准偶检）**：检索层 A/B 测的是喂给 LLM 的检索，非最终答案质量（后者需 LLM+裁判在环，做不成 pytest）。人工偶检协议：取黄金集问题，令艾瑞卡各答两遍——一遍允许 `kb_*` 工具、一遍只 ripgrep，由守密人/独立会话对「正确性/落地率/是否脑补」打分对比。题库复用 `tests/kb_golden_questions.json`。
- **#4 质性能力 probe 已落地**（守密人「针对专有能力 grep 还是好用」逼出）：真相=hit@k 是 grep 主场（只测找文本），KB 真价值在检索之后的结构化知识（层/身份/边界），grep 结构上给不了、hit@k 测不出。`scripts/kb_qual.py` 四 probe（2026-07-04 从三扩到四）：层判定（16 平台 KB 区分 16/grep 0，防 lesson #30）、身份消歧（唯一 type=character 规范，KB 5/grep 0）、边界枚举（KB 可枚举 72 角色/59 全量、grep 给不了）、**类型化关系**（KB 对 312 条边给出关系类型 mention/cross/cv/variant/lore——『A 与 B 是什么关系』，grep 只给共现给不了类型，是白盒图最本质、grep 结构上永远给不了的维度）。**实测 KB 4/4、grep 0/4**。守护 `tests/test_kb_qual.py`。
- **评判体系四仪器齐 + 逐个加固（2026-07-04）**：#1 黄金集（检索 hit@k，**图驱动扩容 262 题**）/ #2 使用遥测（追踪，**零命中回流 held-out 难题**）/ #3 反事实 A/B（对照 grep，**最强 grep 反稻草人**）/ #4 质性 probe（层/身份/边界/**关系类型**，测 hit@k 测不出的 KB 真价值）。四项各获一轮深化，评判体系闭环加固。

**Pillar A+ 提及边 + OKF vs 向量定位（2026-07-04 守密人两问）**：Q1 定位——向量=黑盒联想（需 ML/不可审计），
OKF=白盒联想（带类型/零 ML/可单测），银芯选 OKF 因零 ML 红线；二者互补（向量更好的搜索、OKF 可解释结构层）。
Q2 修正 Pillar A「参考层几无边」当时太保守——**关系在正文里**：`build_graph` 提及边抽取（领域词典 72 角色名扫
策展正文源，字面点名建 `mention` 带类型边）。**孤立率 65%→37%**（+214 提及边），search-tier 96%→44%，
golden MRR 0.775→0.80。守护 `tests/test_kb_governance.py`（高信号+连回角色+岛屿<50%）。北极星 §十。

**向量检索腿（§八「厚锚撑向量」参照实现，2026-07-05 守密人裁定(A) 解除零 ML 红线）**：
- **反转 scoped**：白盒脊柱（kb_index/community_index/tokenizer）**仍确定性零 ML、不动**；只新增**隔离的** ML 向量长尾腿。§1.1-HC 防火墙无涉（吃银芯自有公开社区档案）。
- **Phase 0+1 已落地**（PR #438）：`scripts/kb_vector.py`（可插拔嵌入=生产 Voyage / 离线确定性桩；纯 Python 余弦；缺索引优雅降级）+ `scripts/build_kb_vectors.py`（复用 `build_community_index.iter_records` 流式有界取样 `--limit`，gzip 索引 `okf/kb_vectors.json.gz`，放指针不放本体）+ MCP `kb_vector_search`（**工具 9→10**）+ `tests/test_kb_vector.py`（桩后端 8 测全绿、零网络）。索引本体 `.gitignore` 排除、CI 建后传 Release、运行时 `restore_release_data.py` 还原。
- **✅ key 已验证 + 首个真索引已建（2026-07-05）**：守密人配好 `VOYAGE_API_KEY` secret + Voyage 绑支付方式（免费 200M token 额度仍在、有界原型 ≈ $0，仅放开限流）。`build-community-vectors.yml`（workflow_dispatch）跑绿：guard 过 → Voyage 真嵌入 1500 条有界切片（`voyage-3-lite` 512 维）→ artifact `kb-vectors-bounded`。向量腿从「桩验管线」升级到「真语义可跑」。
- **correctness 硬化已落（2026-07-05，设计工作流对抗核验揪出 2 真 bug + reviewer 复核无残留）**：① `kb_vector.write_index` 改**确定性 gzip**（`GzipFile mtime=0`——原裸 gzip 含 mtime，同内容字节不同，入 git 必 churn）；② `kb_vector.search` **围栏 embed 调用**（voyage 索引在运行时缺包/缺 key 时 embed 抛 ImportError，原未捕获会穿透、把「脊柱托底」带崩——§八 8.3 合流依赖此处就地降级；窄捕获不吞 cosine 真 bug）；③ `build_kb_vectors` 默认 `--out` 迁 gitignored `Public-Info-Pool/Rough/`（防本地桩索引污染 okf/，CI 建生产索引显式传 `--out okf/ --backend voyage`）。守护 `tests/test_kb_vector.py`（10 测：+确定性字节相同 +「voyage 索引+运行时无 key」降级）。全量 pytest 2562 passed。
- **守密人 2026-07-05 三裁定（解锁剩余）**：(a) 索引落存 = **Release community-assets + restore**（合本仓「二进制→Release、git 留指针」范式，不入 git 免撞瘦身）；(b) 运行时激活 = 守密人已配环境侧 `VOYAGE_API_KEY` + `voyageai`（**对新会话生效**，本会话实测仍缺、走降级）；(c) chunk3 厚锚：mention 边**不刻意排除**社区档案（令真实黑话可成别名边）+ 别名 A/B 铁证**改立关系腿**（kb_neighbors/kb_activate，非「grep 找不到别名→角色」稻草人）。
- **✅ Phase 2 语义铁证 harness 已落（2026-07-05，经对抗 reviewer C1/C2 加固）**：`scripts/kb_semantic_ab.py`（paraphrase-recall 四臂 vector/grep/grep_strong/spine，主分 `vector_exclusive_win_rate`；自足黄金现场嵌入、不依赖已建索引）+ `tests/kb_semantic_golden.jsonl`（**17 条种子**，query=真社区消息零共享-token 语义改写，出身牌+防火墙齐；ratchet 只增不减、向百条量级长）+ `tests/test_kb_semantic_ab.py`（诚实性不变量=grep/脊柱恒 0 + stub 贴 chance 地板负控 + 确定性 + 防火墙，7 测零网络）+ `.github/workflows/kb-semantic-proof.yml`（CI 真 Voyage 门：voyage 绝对胜率 + 超 chance 地板 margin，不以飘 stub 为减数）。**reviewer 加固**：C1 黄金 7→17（功效↑，文档「百余条」订正为真实数）；C2 `_STUB_DIM` 64→512 压碰撞（stub 底噪 0.29→0.0588=chance 地板）。**stub 实测**：grep/grep_strong/spine 全 0（黄金真不可达）、stub vector 贴地板（证词法袋赢不了语义）。**真胜负数字待 CI dispatch `kb-semantic-proof.yml`**（需 Voyage，本会话取不到 key）。
- **✅ chunk2 已落（2026-07-05 接手会话）**：`build-community-vectors.yml` build 步补显式 `--out okf/kb_vectors.json.gz`（修 #449 默认迁 Rough/ 后 artifact 步断链）+ 新增 `gh release upload community-assets --clobber` 步（`permissions: contents: write`，照 fanart-archive.yml）；`restore_release_data.py` 扩展**非 tar 资产平拷贝**（`kb_vectors.json.gz` 是纯 gzip JSON、原 tarfile 解包必炸 ReadError——交接档还原命令现逐字可用）。桩端到端实测：建索引 200×512 → `kb_vector.search` degraded=false。**真索引传 Release 待本轮合并 main 后 dispatch**（workflow_dispatch 只认默认分支）；运行时查询嵌入待有 key 的会话验证（本会话环境实测仍无 `VOYAGE_API_KEY`/`voyageai`）。
- **✅ chunk3 厚锚已落（2026-07-05 接手会话，按 (c) 裁定 3-甲/3-乙）**：
  - **别名侧表** `projects/wiki/data/processed/aliases.json`（sibling 不改 characters.json；三墙=出身牌/可撤回/惰性确认态）：manual-seed 7 条全带真实社区引文（融朵/熔朵→熔毁·朵尔 bilibili 17/10 档、Ramona/Pandia/Saya discord 讨论正文、潘迪娅/菲英特单档未确认压权重）。读取层 `scripts/silver_aliases.py`（import-only，缺表/损坏优雅返空）；生成期工作面 `scripts/extract_aliases.py`（grep-evidence 核证据 / add 默认未确认 / confirm / revoke 删条撤回 / harvest 收割零锚喂料——AI 自动识别、人只留否决）。
  - **别名流经白盒**：`silver_tokenizer.domain_dict` 只吸收 confirmed 纯 CJK 别名（融朵整词切出）；`build_okf_bundle.build_graph` mention 边纳入社区档案（3-甲：目录指针有界确定性抽样 ≤3 文件×500KB，文件指针直读 text 后缀）+ **已确认别名边**（拉丁整词边界防子串误连）——mention 边 223→290，`提及:Saya/Pandia/Ramona` 等真实黑话边从社区档案长出；角色概念页浮出「社区别名」行（未确认显式标注）。
  - **先锚后扩合流** `scripts/kb_anchor.py` `anchor_expand()`：脊柱锚定（附侧表别名）→ 已确认别名扩词 → 向量捞长尾 + 据锚去杂（anchored 标记排前、不删召回）；**扩腿函数内吞全异常**（critique 致命洞：「有真 voyage 索引+运行时无 key」绝不带崩脊柱托底，测试专项覆盖）；零锚查询自动喂 `Rough/alias_gaps.jsonl` 闭环。MCP 注册 `kb_anchor`（**工具 10→11**）。
  - **别名 A/B 立关系腿**（3-乙）：`tests/test_kb_alias_relation.py`——「提及:{别名}」标签边存在即证「只写别名的档案→角色」pair 非本名可达（本名扫描在先+pair 去重）；kb_neighbors/kb_activate 顺边可达；未确认别名绝不进图。kb_ab/kb_golden_gen 经查**本无**「别名 search 题」稻草人断言，无需删。守护另有 `tests/test_silver_aliases.py`（三墙+防御）+ `tests/test_kb_anchor.py`（降级契约 8 测）。
- **✅ 真索引已传 Release + 真 Voyage 铁证已过（2026-07-05 合并后 dispatch 双绿）**：`build-community-vectors.yml` run 28738986075 建 1500×512 voyage-3-lite 并上传 Release `community-assets`（本会话经 `--months` 回退还原实测成功，meta 对上）；`kb-semantic-proof.yml` run 28738986658 **语义铁证通过**——voyage 超 chance 地板 **0.7059**（阈 0.5/0.3），paraphrase_recall 14 题独胜率 **0.7857** / cross_lingual 3 题 0.6667，grep/grep_strong/spine 恒 0、stub 负控 0.0588 贴地板。「只有语义能赢」从 stub 推定升格为真 Voyage 数据事实。
- **✅ 索引扩到架构上限（守密人 2026-07-05「完全生成」裁定→AskUserQuestion 选「架构上限」档）**：默认规模 1500→**60000**（实测水位：gz≈92MB 单 Release 资产 / 全表扫描≈1.9s / 加载一次≈27s / `load_index` 加 `array('f')` 常驻压缩 ~944MB→~140MB）。**采样修正**：v1「取前 N 条」在语料极端偏斜下（discord 753 万=99.5%、其余 16 平台合计 ~3.4 万）是前缀失真（lesson #30 同源）——v2 两遍流式**分层采样**（`_quotas` 水填：小源全收、大源吃剩余；源内确定性跨步，跨全频道全时间落点），meta 落 `sampling/per_source` 可审计。真语料实测 14 源全进样。全量 757 万=量产子工程（量化+分片+ANN），未裁定不动。守护 `tests/test_build_kb_vectors_sampling.py`（10 测）。
- **待办**：`extract_aliases.py` 生成期批量抽取跑第一轮（manual-seed 之外喂大侧表，本轮守密人未勾选、留后续）；带 key 会话验运行时真语义查询。设计全文 `Public-Info-Pool/Resource/proposal/silver-core-vector-leg-design-20260705.md`，交接档 `Public-Info-Pool/Resource/repo-engineering/kb-vector-remaining-handoff-20260705.md`，决策见 `memory/decisions.md`。
