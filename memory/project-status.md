# 项目状态一览

> 最后更新：2026-07-26 by 仓库审视会话（守密人「两簿一并回填」裁定）：① 子项目表
> silver-core-sdk 行由 **v0.63.1 刷至 v0.76.0**（滞后 13 个次版本、9 天），数字全部**实机实测**
> 而非转抄——agent 3216 通过 / 5 跳过（197 档）、maestro 362 通过（29 档）、testbed 33 通过、
> pytest 2927 通过 / 51 跳过；② 仓库拓扑变更入档：**数据湖已迁 BIAV-SC-DATA、代码仓改名
> BIAV-SC-CODE、git 历史 07-20 压扁为单提交基线**（clone ~1G→39M），本地会话消费社区档案须先
> 设 `BIAV_SC_DATA_ROOT`；③ 值班面诚实记录：store-patrol 与 testbed-patrol 两条每日巡检链
> **07-19 → 07-25 连续 7 天全红**（已于本会话修复，见 `memory/decisions.md` 同日条与 todo T57/T64）；
> ④ T60 撞号让号为 T64。**滞后成因记档**：07-19 起裁定只入 todo 欠条簿、未回流本档与决策簿，
> 三簿失衡九天——维护期节拍下本档仍须随版本变更同步，否则「状态唯一权威」名存实亡。
> 前批 2026-07-17 by T49 批B 修复会话（silver-core-sdk 0.63.1：审计六项 P0 存量高危+安全修复 H1–H5+M17，回归锁 21 测、vitest 2476 绿；T49 批B 销案标注入 todo）。前批同日 by SCS-REQ-REPOS-01 实现会话（silver-core-sdk 0.63.0：引擎层定位改写 + 循环支撑接口面 R1–R6 + 斜杠退役一刀切净 + goal 结构化 + 装配验收收口；子项目表 silver-core-sdk 行已同步，T41–T48 销案）。前批 2026-07-12 by Phase 2 收口三条裁定会话（守密人三条裁定落档：① **Phase 2 提前收口
> 判定「基本达成」**——M7 验收①基础设施齐备✅②自动化跑稳✅、③贡献流程项随 wiki 使命取消作废，
> 即时生效不待 07-19；② **wiki 使命取消 + 银芯定位第三次收敛**——二使命 = 黑池信息入口（news）
> + 通用 AI 底层能力开发基地（silver-core-sdk 事实使命转正），wiki 子项目冻结（成果保留不删
> 不派发），社区数据采集必要性重估同日续批裁定「维持现状」销案（#T36，触发线站岗）；③ **银芯即时进入稳态维护期** + 过时 demo 清理令（续批已裁：deploy-site.yml「+ bpt-web」注释订正、清理令闭环）
> （扫描已执行：Releases 与 Public-Info-Pool 演示性残留为零，仅 1 处活文档注释候选待守密人裁，
> 报告落 `Public-Info-Pool/Resource/repo-engineering/`），news 推送形态挂账 #T37。裁定全文
> `memory/decisions.md` 同日三条；下方子项目表 wiki / silver-core-sdk 两行已同步）。
> 前批 2026-07-11 by 自我改进闭环需求归档会话（同会话三批：① SCS-REQ-002 草案落
> `memory/active/self-improvement-requirements.md`、阻塞项挂账 #T25/#T26；② 守密人四裁定落
> `memory/decisions.md` 并销 T25/T26——评分模型 Sonnet 5 / 预算帽 $30/月 / 题目来源混合 /
> 沙箱独立 checkout，Phase 1 解锁；③ Phase 0+1 实装落地 v0.49.0——`options.memory.pitfalls`
> 踩坑记录腿 + `evals/` 20 草题（挂账 #T32 待定稿）+ `runEvals()` 双层运行器）。
> 前次 2026-07-10 by 记忆档案事实核对会话（全 memory/ 档案对账审计：修正本档 5 处漂移——
> 头部日期滞后（正文已含 07-07/07-08/07-10 条目）、状态表 silver-core-sdk 行版本/测试数
> v0.12.0/1427→v0.42.0/1651（对齐 package.json 与 O-B2 节）、数据源清单补 bahamut/note_com/arca_live
> 三源修复状态、Discord 行改方案甲三服平级布局、06-09 核验节补历史快照标注；同会话另修 CLAUDE.md
> 5 处漂移，PR #569）。
> 前次 2026-07-06 by 艾瑞卡评估会话（bpt-agent-sdk 工程评估：实机跑验证程序取地面真值——
> 1414 单测全绿 + 2 skipped / tsc+build exit 0；校正状态行过期摘要（v0.2+v0.3/668→v0.11.0/1414、
> 0.3.199→0.3.201）；评估全文落 `Public-Info-Pool/Resource/repo-engineering/bpt-agent-sdk-evaluation-20260706.md`，
> 含 P2–P4 投资路线 backlog）。
> 前次 2026-07-05 by 向量腿接手会话（chunk2 完成：CI 传 Release + restore 非 tar 资产；
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

## 2026-06-09 状态核验（历史快照，数字为当日实测；现值以 `ls` / 权威源为准，如工作流数今为 34）

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

<!-- STATUS-FACTS:BEGIN 机器生成，勿手改；重算 `python3 scripts/build_status_facts.py` -->

### 机器生成事实（版本 / 规模 / 台账）

> 本块由 `scripts/build_status_facts.py` 从权威源生成，`tests/test_status_facts.py` 守同步。
> **勿手抄这些数字到别处**——要引用就指这里（2026-07-26 抗漂移裁定，提案招一）。
> 测试**通过数**不在此列：那要真跑才知道，属实测记录、随文注明日期，不是静态事实。

| 事实 | 值 | 权威源 |
|------|----|--------|
| Silver Core Agent SDK 版本 | `2.2.3` | `projects/silver-core-sdk/package.json` |
| Silver Core Maestro SDK 版本 | `2.2.3` | `projects/silver-core-maestro-sdk/package.json`（与 agent 锁步同号）|
| testbed 试金石 | `0.0.0`（private，永不发布）| `projects/silver-core-testbed/package.json` |
| agent SDK 源文件 / 测试档 | 141 / 213 | 磁盘实况 |
| maestro SDK 源文件 / 测试档 | 20 / 40 | 磁盘实况 |
| testbed 源文件 / 测试档 | 6 / 3 | 磁盘实况 |
| Python 测试档 | 151 | 磁盘实况 |
| CI 工作流 / 其中定时 | 49 / 21 | `.github/workflows/` |
| 挂账台账 开 / 已清 | 21 / 65 | `memory/todo.md` |

<!-- STATUS-FACTS:END -->

## 子项目状态

| 子项目 | 状态 | 负责会话 | 下一步 |
|--------|------|---------|--------|
| site（主站 + 部署 + 视觉） | 已部署，维护模式 | Code-site | 无新任务 |
| news（新闻聚合 + 报告系统） | 自动化持续运行（采集 / 回填 / 评论 / 同人图） | Code-news | M2 信息齐备期任务见 `projects/news/CONTEXT.md`；dependabot #136-140 实际状态待核 |
| wiki（数据集 + Wiki 站点） | **已冻结（守密人 2026-07-12 裁定：原使命#2「社区共建知识底座」取消，wiki 不再承载正式使命）**。已建成果保留不删不派发：可信基线 `data/processed/characters.json`（72 真实角色，一手解包）→ 58 真实唤醒体页 + 运行时数据桥 `characters.runtime.json` → `characters.ts` 消费，CharacterGrid 挂载图鉴页，SSR 构建验证通过（2026-07-02 冻结前状态）。站点随 deploy-site.yml 继续对外可读 | 艾瑞卡会话 | 无（冻结，不派发）。原字段缺口任务（skills/命轮/立绘/三语，见 `wiki-phase-2-gap-inventory.md`）随冻结停派；社区数据采集必要性重估已裁维持现状（T36 销案 2026-07-12，见 `memory/todo.md` 已清节） |
| game（衍生游戏） | 暂缓 | 待创建 | 不主线派发 |
| **black-pool-agent**（使命#2「通用 AI 底层能力开发基地」**现行核心载体**，守密人 2026-08-02 换轨裁定 · Hermes Agent（NousResearch/hermes-agent，MIT）改造扩展层 · 银芯→黑池单向输出物） | **M0 立项完成（2026-08-02）**：决策落档 + 脚手架 `projects/black-pool-agent/CONTEXT.md`。三条工程铁律立项即定：上游跟随 + 扩展层（否决硬 fork 魔改）/ 银芯→黑池单向输出 / MIT 合规。详见「## Black Pool Agent」节 | 艾瑞卡会话 | M1 上游深读评估待守密人点火（挂账 `memory/todo.md` #T79：扩展点测绘 + BPT 需求缺口对照 + 工程形态设计） |
| **silver-core-sdk**（原名 bpt-agent-sdk，2026-07-10 更名 · Claude Agent SDK 公开信息再现 · **原使命#2 核心载体**，守密人 2026-07-12 裁定事实使命转正、**2026-08-02 换轨裁定转维护态**（现行载体 black-pool-agent，只修不建，BPT 换装完成后冻结 #T78） · 银芯→黑池单向输出物） | **v0.76.0（家族锁步同版，2026-07-22）——2026-07-26 仓库审视会话实机取地面真值**：agent SDK **3216 通过 / 5 跳过（197 测试档）**、maestro SDK **362 通过（29 档）**、testbed **33 通过**、pytest **2927 通过 / 51 跳过**，双包 tsc build 干净。**0.64 → 0.76 历程摘要**（逐条明细以两包 CHANGELOG 为准，本档不复刻）：0.64.1–0.64.3 T49 四批 100 缺陷全销 · 0.65.5–0.67.2 T52 第四轮 205 项处置（159 修复 + 46 诚实归档）· 0.68.0 起**版本钟与 maestro 锁步同号**（守密人 2026-07-18 口谕）· 0.69.1–0.71.3 T51 第三轮 99 项八批全销 · 0.71.0 testbed 四缝采纳（G1–G4）· 0.72.1 WV2-4 推理态 temperature 裁③ · 0.72.0–0.74.0 T56 maestro 五轮审计 67 缺陷收官 · **0.75.0**（2026-07-20）R7 会话末写回可观测（`SDKMemoryHealth.sessionEndUpdate` 九态 + `memoryHealthSnapshot()`，源自 BPT memory-rot 诊断）· **0.76.0**（2026-07-22）`cancelled` 封闭终局语义（BPT P0-D1：用户主动取消为一等终局，与 failed 可区分且永不自动重跑）。**家族现为三件**：agent SDK（122 源文件）+ maestro SDK（16 源文件，钟 / 跨会话状态 / 会话装配）+ testbed 试金石（private / 永不发布 / 第三方消费者契约，已进 maestro CI）。前批 **v0.63.1（2026-07-17 T49 批B · P0 存量高危+安全 6 项修复：H1 Edit 非 UTF-8 拒改 / H2 thinking 按实发模型 / H3 openai 尾窗收束 / H4 截断工具参数降级拒执行 / H5 结构化输出 schema-aware / M17 transport 租户身份键；回归锁 21 测、vitest 2476 绿，详见下方专节）；前批 v0.63.0（2026-07-17 SCS-REQ-REPOS-01 整天目标循环全量落地，守密人驱动令）：引擎层定位改写（POSITIONING 三否定一肯定 + 扩展面三缝 + 钩子契约总则、COMPAT 降级参照笔记、decisions 两条覆盖注）+ 循环支撑接口面 R1–R6（prelude/getSessionAccounting、budget 事件流带收尾报告、压缩保留区、ReportLedger、LoopControl 提议工具、declareEngineSurface）+ 斜杠退役一刀切净（/loop /goal 文本面与自定义命令展开层整体删除、goal 改 options.goal 结构化唯一入口宿主注入评估器、透传回归锁 + 源码残留 grep 守卫）+ §7.1 装配验收（仅公开接口拼 loop 全五断言、零真实钟）；vitest 2456 绿 + tsc/build 干净，变异新靶 loop-support 五轮 72.41→93.73 入棋轮；T41–T48 全销，CHANGELOG 0.63.0 单条入账；前批 v0.51.0（2026-07-12 自我改进闭环推进：REQ-1.2 趋势比对 + Phase 2 harness 全 8 题解锁 + REQ-2.2 回归门禁；0.43–0.62 历程见专节逐条）**：TypeScript 重实现（公开信息再现、自研引擎），直驱 Anthropic Messages API（fetch+SSE，无 CLI 子进程），**1885 单测全绿 + 2 skipped、tsc/build exit 0**（0712 实录；v0.49.0 时点为 1848+2）；对官方 SDK **0.3.205** 约 90%+ 表面等价（对标基线 2026-07-10 由 0.3.201 追齐至 0.3.205，见 `docs/COMPAT.md`「0.3.201 -> 0.3.205 chase」；v0.40.0 落 7 个新类型 + interrupt 收据 + parent_agent_id，全类型化、诚实源外 typed-not-emitted），一致性金字塔 L1–L5 全封顶、首轮真 API L5 两臂打平 88.9%。**评估 backlog P2/P3/P4 全落（2026-07-06）**：**P2**（PR #501）逐条过 COMPAT 39 项 PARTIAL 分诊——~14 行「文档滞后」收敛为 FULL + 8 个真缺口闭合各带测试（Edit 读前写门 / stream_event ttft_ms / PostToolBatch tool_calls[] / SubagentStop agent_transcript_path / thinking.display / debugFile / mcpServerStatus scope / maxThinkingTokens @deprecated；notebook·sse 显式暂缓）；**P3** 漂移哨兵升「报+自动开草稿 PR」（`conformance-drift.yml` + `drift-check.mjs --emit-*`，选择性追踪纪律不动、绝不自动改基线）；**P4** `docs/ONBOARDING.md` 新维护者 30 分钟上手（降总线因子）。中间里程碑（v0.4→v0.11）详见下方专节 | 艾瑞卡会话 | 无阻塞待办；评估全文 `Public-Info-Pool/Resource/repo-engineering/bpt-agent-sdk-evaluation-20260706.md`；**动手前必读** `projects/silver-core-sdk/CONTEXT.md` + `docs/ONBOARDING.md`，定位见 `docs/POSITIONING.md` |
| **bpt-pm**（项目排期工作台 · 非使命线） | **已删除（2026-07-12 守密人裁定，模块盘点逐个问答：已不使用）**。原单网页 CPM 排期工作台（协议 bpt-pm/v1，v1→v3 引擎 + Notion 适配 + 表格协议均曾落盘），全部代码与文档**已随 2026-07-20 全仓压扁不可恢复**（原「git 历史可追」失效，见 CLAUDE.md §6.3；删除判词为「已不使用」，价值损失近零，照实记录） | 艾瑞卡会话 | 无 |

> BPT 战线（bpt-web / bpt-desktop / bpt-next / graphify-ext / occ-local）已于 2026-04-19 战略转向中从银芯仓库删除，不再在银芯内部开发。银芯转为 BPT 指导者，协议见 `memory/bpt-guidance-protocol.md`。
> **例外辨析（勿混淆）**：上表 `silver-core-sdk`（原名 bpt-agent-sdk） **不属**上述被删 BPT 产品战线，**亦非**「银芯内部开发 BPT 产品」。它是银芯自有的**工程产物**（公开信息层），作为**银芯→黑池单向输出物**供 BPT Desktop 消费——方向与 §1.1-HC 防火墙一致（银芯→黑池单向输出），黑池数据从不回流。**定性升级（守密人 2026-07-12 裁定）**：由「非使命线工程产物」转正为**正式使命#2「通用 AI 底层能力开发基地」核心载体**（事实使命转正：20+ 真实消费者、BPT 在产）；背景事实——黑池侧已完全弃用 Claude Code、全面换装自有技术栈（BPT + silver-core-sdk 0.3x pin），SDK 存在理由由「应急替代」升格「常态底座」。**2026-08-02 换轨注（守密人裁定）**：放弃「BPT 100% 自研 + 模仿闭源 Claude Code」路线，使命#2 载体换轨 **black-pool-agent**（Hermes Agent 改造扩展层）；SDK 家族转维护态只修不建、BPT 换装完成后按 wiki 先例冻结（#T78）。本辨析对 hermes 子项目同样适用（银芯自有工程产物、银芯→黑池单向输出物，非 BPT 产品内部开发）。

## News 新闻聚合 + 报告系统

### 实时聚合器
- **已完成**：前端页面、B站抓取、GitHub Actions 自动化
- **零产出四源处置（2026-07-10 排查+修复，CI 日志 + live 探测定性）**：
  - [x] **bahamut 已修复**：真因 = `B.php?ajax=1` JSON 接口退役（返回整页 HTML）+
    `search.php` 需板編（bsn=0 报「沒有傳入板編」）且新版全站搜索纯 JS 渲染——旧双路径
    注定零产出。改为解析忘卻前夜专板（bsn=78829）列表页 HTML，本地实测 30 帖入流
  - [x] **note_com 已修复**：真因 = `/api/v3/searches` 已对非浏览器请求一律 403（浏览器头
    与 cloudscraper 均被拒）。改走 hashtag RSS（`/hashtag/忘却前夜/rss`），本地实测 25 条；
    RSS 无互动指标 → engagement 恒 0（同 weixin 已知限制）
  - [x] **arca_live 改走 CC 例程日采（守密人 2026-07-10 裁定方案 2 过渡桥；07-11 起
    自绑定模式）**：CI 基础设施性封锁（Cloudflare 拦 GitHub Actions 机房 IP——HTTP 403 /
    PW 挑战页超时 / App API 403 三路全堵），银芯 CC 云环境出口实测畅通。每日 02:37 UTC
    例程点火进主会话，运行单脚本 `projects/news/scripts/collect_arca_daily.py`（采集 →
    按日归档 → [skip ci] 提交推送，响亮失败；健康兜底 = 沉默源审计 arca_live 断更 >7d
    告警）。fresh-session 模式两连败退役（安全误判 + 空环境，见 lesson #48）。
    首日两轮实采 87 条 / 10 日期桶已入 `Record/Community/arca_live/`。GC 编排尝试保留——
    CF 若放行 Actions 则正常路径自动恢复、例程可退役
  - [~] **twitter 挂账未来再议**（守密人 2026-07-10 裁定，覆盖节拍表决议④的 07-19 期限）：
    免 key syndication 路径已 429 全灭，源保持注册静默空转。挂账见 `memory/todo.md` #T9
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
  - [x] Discord — 已实现（Bot 已配置，全量归档 + 聚合器双通道）；三服平级分层归档（2026-07-10 方案甲统一，`Public-Info-Pool/Record/Community/discord/{global,jp,volunteer}/`；guild↔区服映射唯一源 `archive_layout.py` `DISCORD_GUILD_REGIONS`。原「Global 在根 / guilds/ 子目录」旧布局已迁移消灭）
  - [x] YouTube — 代码就绪，需配置 API 密钥
  - [x] Bahamut — 已修复（2026-07-10：旧 JSON 接口退役，改解析忘卻前夜专板 bsn=78829 列表页 HTML）
  - [x] note.com — 已修复（2026-07-10：搜索 API 一律 403，改走 hashtag RSS；无互动指标、engagement 恒 0）
  - [x] arca.live — CC 例程日采过渡桥（2026-07-10 方案 2：CI 机房 IP 被 Cloudflare 封锁，每日 fresh-session 例程跑 `collect_arca_daily.py`；CF 放行 Actions 则正常路径自动恢复）

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

## Silver Core Maestro SDK（`projects/silver-core-maestro-sdk/`，npm 名 `silver-core-maestro-sdk`，2026-07-18 立项施工，同日定名——曾用 @biav/orchestrator-sdk）

> **一句话**：银芯编排 SDK——持有分子（钟 / 跨会话状态 / 会话装配），把「活得比一次调用久」的
> agent 脏活做成可复用零件交宿主装配；与代理 SDK 分界 = 代理持原子（一次结构化调用）、编排持分子。
> 需求裁定书 `Public-Info-Pool/Resource/repo-engineering/scs-req-orchestrator-sdk-20260717.md`。
>
> **当前 v2.2.3（2026-07-29）**，与 agent SDK **锁步同版**（2026-07-18 守密人裁定覆盖需求档 §2 双钟制，
> CI 守卫相等）。**八族零件、成熟度两级**（标尺见需求档 §6：「已验证」须有非为演示它而写的消费方）——
> `ledger` / `driver` / `scheduler` 已验证；`workflow` / `goal` / `delivery` / `assembly` / `routine` 为实验面。
> 在产消费方两个：`projects/silver-core-maestro-sdk/examples/store-patrol.mjs`（每日北京 15:15 商店巡检）
> 与 silver-core-testbed。硬性质：对 agent SDK **零 import 零依赖**，依赖方向 maestro→agent 单向由 CI 执法。
>
> **2026-08-02 起随 T78 转维护态**：纯维稳、仅修影响生产的 bug、零新功能；家族工程守卫工作流
> 已降级为手动触发；BPT 换装完成后按 wiki 先例冻结。
>
> **逐版全文以本包 `projects/silver-core-maestro-sdk/CHANGELOG.md` 为唯一权威**——锁步纪元下约四成
> 版本为「本包零改动」的空转对齐，用 `python3 scripts/sdk_substantive_versions.py` 可筛出对消费方
> 有实质变更的那些（T70 建，格式由 `tests/test_sdk_changelog_lockstep.py` 钉死）。
> 文档：`docs/ONBOARDING.md`（宿主 store 样板）/ `docs/CONCURRENCY.md`（并发模型）/ `docs/ASSEMBLY.md`（四原语接线谱）。
>
> **2026-08-08 之前累积的逐版发布编年史 + 六战施工记录 + T56 五轮审计战报摘要已下沉**
> `memory/archive/maestro-status-chronicle-20260808.md`（原文逐字未改）。

## Silver Core Testbed（`projects/silver-core-testbed/`，试金石，2026-07-18 施工封面立项）

> **一句话**：两包效果验证床——以「无宿主世界观的第二消费者」身份（private / 永不发布 /
> 锁步豁免 / 仅公开导出面）自举巡检本仓，台账即评测数据源；漏缝清单为一等产出。
> 权威档：`projects/silver-core-testbed/CONTEXT.md` + `GAPS.md` + `SOAK.md`。
>
> **进度**（2026-07-18 施工日，四战一次落成）：① 骨架——workspace 注册（消费者豁免注
> 入根 package.json）、JSON 文件台账店、**LedgerStore 契约套件 14 例自写全绿**（验收 1；
> SDK 未随包交付契约套件 = 漏缝 G1）、driverctl 启停脚本；② 巡检集——四巡检器
> （CI 状态 / 文档死链 / 版本锁步 / 变异棘轮地板对账）目标清单全热层 json + 每日做梦
> 归并卡（R9 三段卡经 agent SDK 校验器准入、R6 常驻索引、R8 保留剪除；记忆工具+台账+
> 调度三件套全真实使用），首轮生产真跑 5 会话全 done；③ 浸泡演练（真实钟，封面明示
> 反向豁免 fake-timer 纪律）——kill -9 恢复（慢 tick 保证在飞孤儿，崩溃自扫送回重试路径）
> + 停机补偿（latest 恰 1 发 / all 逐点补齐）10 检查全 PASS，报告落 `state/drills/`；
> ④ 首份效果基线 `testbed-baseline.json` 入库（完成率 1.0 / 熄火 0 / tokens 诚实 null
> 留三配置实验槽）。CI `testbed-patrol.yml` 每日北京 15:20 无人值守（cron 刻意晚于
> fire point，**每天走一遍错过补偿路径**）。**漏缝四条实缝**（G1 契约套件缺交付 /
> G2 认领无租约 kill -9 孤儿靠宿主自扫 / G3 Scheduler 短命宿主零号日死锁 + sched id
> 无公开构造器 / G4 memory 无原样读回），全走公开面绕行、无一触碰非公开面。
> **收尾双裁定（守密人 2026-07-18「甲甲」）**：T58 = CI 积累先行、72h 连跑缓议（转观察）；
> T59 = **四缝全采纳、同日落地家族锁步 0.71.0（原编 0.69.0，合并时因 main 并行会话占号让号）**——G1 随包契约套件 / G2 认领租约 + 每 tick
> 过期清扫 / G3 seedFirstRun + scheduleSessionId / G4 MemoryStore.read 原样读回；testbed
> 换装消费新面（primeSchedules 绕行件删除），GAPS.md 四缝全销、绕行件留作回归证据。
> **验收 2 已达成（2026-08-08 核账销 T57）**：D+7 窗口 07-26 → 08-01 七轮定时全绿 + 台账/值班卡/报告/索引逐层核实，明细见 todo 已清 T57 与子项目 `CONTEXT.md`。首日真实发现：
> agent SDK `mutation-ratchet.json` 的 loop-support 靶（地板 94.35）不在周检矩阵、从未被
> 实测（T64 站岗，原编 T60，2026-07-26 撞号让号；ratchet 巡检器每日盯防此类缺口）。

## Black Pool Agent（`projects/black-pool-agent/`，使命#2 现行核心载体，2026-08-02 换轨裁定）

> **一句话**：基于 **Hermes Agent**（[NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)，
> MIT）的改造扩展层——放弃「BPT 100% 自研 + 模仿闭源 Claude Code」路线（守密人 2026-08-02 裁定），
> 银芯→黑池单向输出。决策见 `memory/decisions.md` 同日各条；铁律与上游档案见子项目 `CONTEXT.md`。

- **M0 立项（2026-08-02）**：完成——四项配套裁定落档 + 脚手架 + 首钉 `v2026.7.30` 快照 vendor + 上游套件容器内全量实证（22,766 过零真缺陷，报告在 Resource/repo-engineering）。
- **需求 #2 对话成本面板已交付（2026-08-02）**：`conversation-cost-panel.patch`（白名单特性补丁，上下文零品牌词可叠加换装）——网关 4 字段透传 + 前端差分成轮 + 面板挂状态栏 + i18n 五语种，测试三绿。
- **施工边界文书接收（2026-08-02 同日）**：15 条裁定 + 禁止十条即时生效，原文归档 `Public-Info-Pool/Resource/repo-engineering/bpt-hermes-charter-20260802.md`（唯一权威）。核心零侵入 / 切面化「代码公开配置内网」/ idealab 唯一通道；upstream/ 定位 = **银芯开发镜像**（SVN vendor 生产供应链在黑池侧）；patches 白名单 + 骨架完整由 `tests/test_hermes_charter.py` 机械守卫。
- **起手式转黑池侧建议（守密人 2026-08-02 裁定，T79 销案）**：文书 §6 七步银芯不追踪执行；银芯常态职责 = 追官方新版 + gaps.md 值守 + 按需供材料（点名派发另计）。
- **需求 #1 品牌换装已交付（2026-08-02）**：Silver Core 品牌 + 知识层统一称「知识底座」——零侵入套件
  （SOUL.md 模板 / CLI 别名）+ patches/ 白名单制（`build/rebrand.py` 规则引擎生成 388 文件补丁，含
  desktop/web 裸词换装——守密人补充「主要消费面是 desktop」后扩面；四不碰红线，upstream 零修改组装期应用）；台账 `BRANDING.md`。
- **首件便携整包已实证落桶（2026-08-02，三轮迭代绿，run 30750724034）**：`silver-core-win64.zip`（1.04GB，sha256 在册）落 `silver-core-bundle` Release——合箱单目录搬移自愈冒烟全通；前两轮两坑（pyvenv.cfg 绝对路径 / 冒烟 cwd）均修入工作流。
- **上游移 pin `v2026.8.3` / 0.20.0（2026-08-04，守密人派发）**：快照替换 + 哨兵同步 + 补丁重生成/重放
  全绿（`UPSTREAM.md`）；浅色降饱和 12 令牌（`BRANDING.md`）；套件复跑 25,176 过零真缺陷（testrun-20260804）。
- **上游周更例程已建（2026-08-09，守密人四裁：会话例程载体 / 全绿即直推 main / 合并后自动出包 / 只出私有版）**：每周一 00:00 北京（Routine cron `0 16 * * 0`）起新会话，照 `projects/black-pool-agent/WEEKLY-UPDATE.md` 跑机械腿 `build/sync_upstream.py`（探版 / 换装 / 变更清单 / 公告），补丁冲突以退出码 3 交人工重放；出包触发 `assemble-black-pool-bundle.yml`，公告落 `Resource/repo-engineering/hermes-weekly-update-*`。
  撞面判定走**补丁面文件交集**而非关键词（0.19.1→0.20.0 区间：关键词报 257/945 条高风险，交集报 38 条且正中当次真需人工重放的文件）。守卫 `tests/test_hermes_weekly_update.py`（13 项）。

## Silver Core SDK（`projects/silver-core-sdk/`，原名 BPT Agent SDK，2026-07-10 守密人裁定更名；npm 名 `silver-core-agent-sdk`，2026-07-18 定名，品牌名 Silver Core Agent SDK）

> **更名注**：包名 `bpt-agent-sdk` → `silver-core-sdk`（0.41.0 起，含目录 / UA / clientInfo /
> 日志前缀 / CI 工作流 `silver-core-sdk.yml`）。本节及决策档中 2026-07-10 前的历史叙述保留旧名，
> 归档产物文件名（`Public-Info-Pool/Resource/**/bpt-*`）不追溯改名。
>
> **一句话**：官方 `@anthropic-ai/claude-agent-sdk` 的**公开信息再现**（自研引擎），drop-in 兼容公开接口，
> 但引擎**直驱 Anthropic Messages API**（fetch + SSE，**不打包 CLI 子进程**）。用途：让 BPT Desktop
> （Electron）脱离被禁的 `claude.exe` 子进程引擎。**定位辨析见「## 子项目状态」表下方例外辨析**——
> 银芯→黑池单向输出物，与 §1.1-HC 防火墙同向，非 BPT 产品内部开发。
>
> **维护态（守密人 2026-08-02 换轨裁定；同日施工边界文书裁 3 收紧）**：使命#2 载体换轨
> `projects/black-pool-agent/`（见上节）；本家族三包（agent / maestro / testbed）即日起
> **纯维稳**——版本冻结、仅修影响生产的 bug、零新功能，BPT 在产 pin 消费者不断供；
> 迁移终裁 = BPT 核心功能对照表逐项打勾齐（文书裁 14），完成后按 wiki 先例冻结
> （成果保留不删不派发，触发线 `memory/todo.md` #T78）。

- **动手前必读**：`projects/silver-core-sdk/CONTEXT.md`（会话上下文 + 当前 milestone）
- **v2.2.3（2026-07-29）**：**观察项批收口（守密人裁「修复 然后合并」）**——2.2.2 审计留观察位的静默回落全线收紧 + 三处「工具说了不实话」订正：①Grep/Glob `path` 非字符串静默搜 cwd 改报错（错作用域满置信答案）· ②Grep 选项 present-but-mis-typed 一律点名（布尔组 `-i`/`-n`/`multiline`/`-o` + 计数组 `-A`/`-B`/`-C`/`context`/`offset`/`head_limit` + `glob` 数组形并给 `"*.{ts,tsx}"` 写法）· ③Grep 对显式文件目标不再声称「node_modules/.git 已排除」（该过滤对具名文件根本没跑），三处编码旧不实文案的既有断言同步订正 · ④Bash `truncated` 改用 `CappedStream` 真实丢弃计数（原正则嗅探自家渲染文本，命令 echo 标记形字符串即假阳性）· ⑤Bash 后台 ack 补 `backgroundTaskId` 结构化产出 · ⑥Bash NUL 字节由 `ConfigurationError`（环境判词）改命令错（模型可自纠），既有测试同步订正为断言新行为 · ⑦SendMessage 包裹 `bridge.send` · ⑧`GrepOutput.numFiles` 跨模式语义落进类型契约。另修 `--` 悬空分隔符；`displayTruncated` 写明纵深防御且刻意不放宽为 `>=`。测试 21 例；全量 3460 绿。
- **逐版发布叙述已下沉（2026-07-27 治理精简）**：本节曾累积 **653 行**发布编年史 +
  验收轮记录，与 `projects/silver-core-sdk/CHANGELOG.md`（发布史**唯一权威**）职责重复。
  逐版全文一律查 CHANGELOG；**验收轮实测数字**（真 L5 的 run id / 预算实耗 / gate B 差值、
  双臂差分收官、i18n 成本调查等 CHANGELOG 没有的验证史）原文逐字留存于
  `memory/archive/sdk-status-chronicle-20260727.md`（归档层，只供追溯）。
  本节今后只留**定位 + 最近版叙述**，新版本进来时把上一版交给 CHANGELOG，不再在此累积。


## BPT-V2T 语音代替输入（已删除）

> **2026-07-12 守密人裁定删除**（模块盘点逐个问答：非使命线、已不使用）。原为本地语音代替
> 输入工具 + 专名热词桥（2026-07-05 首期落盘，13/13 单测绿）。全部代码**已随 2026-07-20 全仓压扁
> 不可恢复**（原「git 历史可追」失效，见 CLAUDE.md §6.3；PR #646 的 diff 视图亦随历史消失）。

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

> **现状**：静态 OKF bundle 已升级为艾瑞卡运行时可动态导航的知识库。MCP `biav-sc-memory` 上
> **11 工具**（记忆四件 + 导航七件 `kb_search` / `kb_get` / `kb_neighbors` / `kb_overview` /
> `kb_activate` / `kb_vector_search` / `kb_anchor`）；静态导航索引 `okf/kb_index.json` 由
> `scripts/build_kb_index.py` 生成（倒排表 + 邻接表，词典法**确定性零 ML 零常驻**），随
> `scripts/build_okf_bundle.py` 末尾自动重建。三条消费腿的路由见 CLAUDE.md §5；北极星定位与
> 改造路线 A–E（**五支柱已全部落地**）见 `memory/knowledge-layer-design.md`。
>
> **向量腿**（2026-07-05 守密人裁定(A) 解除零 ML 红线；**反转是 scoped 的**——白盒脊柱仍确定性
> 零 ML，只新增隔离 ML 腿，§1.1-HC 防火墙无涉）：`scripts/kb_vector.py` + `scripts/build_kb_vectors.py`
> （Voyage 嵌入，缺 key 优雅降级回退 `kb_search`），索引经 Release `community-assets` 存取。
> 真 Voyage 语义铁证已过（CI `kb-semantic-proof.yml`：voyage 超 chance 地板 **0.7059**，
> grep / 脊柱恒 0，stub 负控贴地板）。合流腿 `scripts/kb_anchor.py` 先锚后扩，别名侧表
> `projects/wiki/data/processed/aliases.json` 守三墙。
>
> **有效性评判四仪器**（命令见 CLAUDE.md §7.1）：`kb_eval.py` 黄金集 hit@k · `kb_telemetry.py`
> 使用遥测 + 零命中回流 · `kb_ab.py` 对照 grep（含最强 grep 反稻草人臂）· `kb_qual.py` 四 probe
> （层 / 身份 / 边界 / 关系类型，测 hit@k 测不出的维度）；另有 `kb_golden_gen.py` 图驱动扩容与
> `kb_semantic_ab.py` 语义 harness。
>
> **待办**：`scripts/extract_aliases.py` 生成期批量抽取跑第一轮（manual-seed 之外喂大侧表，
> 守密人本轮未勾选）；带 key 会话验运行时真语义查询。
>
> **2026-07-04 / 07-05 两日的逐支柱、逐 chunk 建设编年史已下沉**
> `memory/archive/kb-buildout-chronicle-20260808.md`（原文逐字未改，含各轮实测数字与诚实注）。
> 设计全文 `Public-Info-Pool/Resource/proposal/silver-core-vector-leg-design-20260705.md`。
