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
| Python 测试档 | 144 | 磁盘实况 |
| CI 工作流 / 其中定时 | 45 / 26 | `.github/workflows/` |
| 挂账台账 开 / 已清 | 20 / 63 | `memory/todo.md` |

<!-- STATUS-FACTS:END -->

## 子项目状态

| 子项目 | 状态 | 负责会话 | 下一步 |
|--------|------|---------|--------|
| site（主站 + 部署 + 视觉） | 已部署，维护模式 | Code-site | 无新任务 |
| news（新闻聚合 + 报告系统） | 自动化持续运行（采集 / 回填 / 评论 / 同人图） | Code-news | M2 信息齐备期任务见 `projects/news/CONTEXT.md`；dependabot #136-140 实际状态待核 |
| wiki（数据集 + Wiki 站点） | **已冻结（守密人 2026-07-12 裁定：原使命#2「社区共建知识底座」取消，wiki 不再承载正式使命）**。已建成果保留不删不派发：可信基线 `data/processed/characters.json`（72 真实角色，一手解包）→ 58 真实唤醒体页 + 运行时数据桥 `characters.runtime.json` → `characters.ts` 消费，CharacterGrid 挂载图鉴页，SSR 构建验证通过（2026-07-02 冻结前状态）。站点随 deploy-site.yml 继续对外可读 | 艾瑞卡会话 | 无（冻结，不派发）。原字段缺口任务（skills/命轮/立绘/三语，见 `wiki-phase-2-gap-inventory.md`）随冻结停派；社区数据采集必要性重估已裁维持现状（T36 销案 2026-07-12，见 `memory/todo.md` 已清节） |
| game（衍生游戏） | 暂缓 | 待创建 | 不主线派发 |
| **silver-core-sdk**（原名 bpt-agent-sdk，2026-07-10 更名 · Claude Agent SDK 公开信息再现 · **正式使命#2「通用 AI 底层能力开发基地」核心载体**，守密人 2026-07-12 裁定由「非使命线」事实使命转正 · 银芯→黑池单向输出物） | **v0.76.0（家族锁步同版，2026-07-22）——2026-07-26 仓库审视会话实机取地面真值**：agent SDK **3216 通过 / 5 跳过（197 测试档）**、maestro SDK **362 通过（29 档）**、testbed **33 通过**、pytest **2927 通过 / 51 跳过**，双包 tsc build 干净。**0.64 → 0.76 历程摘要**（逐条明细以两包 CHANGELOG 为准，本档不复刻）：0.64.1–0.64.3 T49 四批 100 缺陷全销 · 0.65.5–0.67.2 T52 第四轮 205 项处置（159 修复 + 46 诚实归档）· 0.68.0 起**版本钟与 maestro 锁步同号**（守密人 2026-07-18 口谕）· 0.69.1–0.71.3 T51 第三轮 99 项八批全销 · 0.71.0 testbed 四缝采纳（G1–G4）· 0.72.1 WV2-4 推理态 temperature 裁③ · 0.72.0–0.74.0 T56 maestro 五轮审计 67 缺陷收官 · **0.75.0**（2026-07-20）R7 会话末写回可观测（`SDKMemoryHealth.sessionEndUpdate` 九态 + `memoryHealthSnapshot()`，源自 BPT memory-rot 诊断）· **0.76.0**（2026-07-22）`cancelled` 封闭终局语义（BPT P0-D1：用户主动取消为一等终局，与 failed 可区分且永不自动重跑）。**家族现为三件**：agent SDK（122 源文件）+ maestro SDK（16 源文件，钟 / 跨会话状态 / 会话装配）+ testbed 试金石（private / 永不发布 / 第三方消费者契约，已进 maestro CI）。前批 **v0.63.1（2026-07-17 T49 批B · P0 存量高危+安全 6 项修复：H1 Edit 非 UTF-8 拒改 / H2 thinking 按实发模型 / H3 openai 尾窗收束 / H4 截断工具参数降级拒执行 / H5 结构化输出 schema-aware / M17 transport 租户身份键；回归锁 21 测、vitest 2476 绿，详见下方专节）；前批 v0.63.0（2026-07-17 SCS-REQ-REPOS-01 整天目标循环全量落地，守密人驱动令）：引擎层定位改写（POSITIONING 三否定一肯定 + 扩展面三缝 + 钩子契约总则、COMPAT 降级参照笔记、decisions 两条覆盖注）+ 循环支撑接口面 R1–R6（prelude/getSessionAccounting、budget 事件流带收尾报告、压缩保留区、ReportLedger、LoopControl 提议工具、declareEngineSurface）+ 斜杠退役一刀切净（/loop /goal 文本面与自定义命令展开层整体删除、goal 改 options.goal 结构化唯一入口宿主注入评估器、透传回归锁 + 源码残留 grep 守卫）+ §7.1 装配验收（仅公开接口拼 loop 全五断言、零真实钟）；vitest 2456 绿 + tsc/build 干净，变异新靶 loop-support 五轮 72.41→93.73 入棋轮；T41–T48 全销，CHANGELOG 0.63.0 单条入账；前批 v0.51.0（2026-07-12 自我改进闭环推进：REQ-1.2 趋势比对 + Phase 2 harness 全 8 题解锁 + REQ-2.2 回归门禁；0.43–0.62 历程见专节逐条）**：TypeScript 重实现（公开信息再现、自研引擎），直驱 Anthropic Messages API（fetch+SSE，无 CLI 子进程），**1885 单测全绿 + 2 skipped、tsc/build exit 0**（0712 实录；v0.49.0 时点为 1848+2）；对官方 SDK **0.3.205** 约 90%+ 表面等价（对标基线 2026-07-10 由 0.3.201 追齐至 0.3.205，见 `docs/COMPAT.md`「0.3.201 -> 0.3.205 chase」；v0.40.0 落 7 个新类型 + interrupt 收据 + parent_agent_id，全类型化、诚实源外 typed-not-emitted），一致性金字塔 L1–L5 全封顶、首轮真 API L5 两臂打平 88.9%。**评估 backlog P2/P3/P4 全落（2026-07-06）**：**P2**（PR #501）逐条过 COMPAT 39 项 PARTIAL 分诊——~14 行「文档滞后」收敛为 FULL + 8 个真缺口闭合各带测试（Edit 读前写门 / stream_event ttft_ms / PostToolBatch tool_calls[] / SubagentStop agent_transcript_path / thinking.display / debugFile / mcpServerStatus scope / maxThinkingTokens @deprecated；notebook·sse 显式暂缓）；**P3** 漂移哨兵升「报+自动开草稿 PR」（`conformance-drift.yml` + `drift-check.mjs --emit-*`，选择性追踪纪律不动、绝不自动改基线）；**P4** `docs/ONBOARDING.md` 新维护者 30 分钟上手（降总线因子）。中间里程碑（v0.4→v0.11）详见下方专节 | 艾瑞卡会话 | 无阻塞待办；评估全文 `Public-Info-Pool/Resource/repo-engineering/bpt-agent-sdk-evaluation-20260706.md`；**动手前必读** `projects/silver-core-sdk/CONTEXT.md` + `docs/ONBOARDING.md`，定位见 `docs/POSITIONING.md` |
| **bpt-pm**（项目排期工作台 · 非使命线） | **已删除（2026-07-12 守密人裁定，模块盘点逐个问答：已不使用）**。原单网页 CPM 排期工作台（协议 bpt-pm/v1，v1→v3 引擎 + Notion 适配 + 表格协议均曾落盘），全部代码与文档**已随 2026-07-20 全仓压扁不可恢复**（原「git 历史可追」失效，见 CLAUDE.md §6.3；删除判词为「已不使用」，价值损失近零，照实记录） | 艾瑞卡会话 | 无 |

> BPT 战线（bpt-web / bpt-desktop / bpt-next / graphify-ext / occ-local）已于 2026-04-19 战略转向中从银芯仓库删除，不再在银芯内部开发。银芯转为 BPT 指导者，协议见 `memory/bpt-guidance-protocol.md`。
> **例外辨析（勿混淆）**：上表 `silver-core-sdk`（原名 bpt-agent-sdk） **不属**上述被删 BPT 产品战线，**亦非**「银芯内部开发 BPT 产品」。它是银芯自有的**工程产物**（公开信息层），作为**银芯→黑池单向输出物**供 BPT Desktop 消费——方向与 §1.1-HC 防火墙一致（银芯→黑池单向输出），黑池数据从不回流。**定性升级（守密人 2026-07-12 裁定）**：由「非使命线工程产物」转正为**正式使命#2「通用 AI 底层能力开发基地」核心载体**（事实使命转正：20+ 真实消费者、BPT 在产）；背景事实——黑池侧已完全弃用 Claude Code、全面换装自有技术栈（BPT + silver-core-sdk 0.3x pin），SDK 存在理由由「应急替代」升格「常态底座」。

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

- **v2.2.3（2026-07-29）**：锁步对齐（本包零代码改动）——家族版本钟随 agent SDK 2.2.3（观察项批收口）前进。
- **v2.2.2（2026-07-29）**：锁步对齐（本包零代码改动）——家族版本钟随 agent SDK 2.2.2（工具调用参数健壮性七修）前进。
- **v2.2.1（2026-07-29）**：锁步对齐（本包零代码改动）——家族版本钟随 agent SDK 2.2.1（输入形状诊断）前进。
- **v2.2.0（2026-07-29）**：**设计第三轮落地（四原语装配，agent 侧纯锁步）**——设计档 `Public-Info-Pool/Resource/repo-engineering/maestro-sdk-agent-assembly-design-20260729.md`（裁1–裁5 + D2–D8 十一项当日交互裁定）当日实现：第七族 `assembly/agent-executor.ts`（**注入式** `createAgentExecutor` + `extractPlainAgent`/`extractGoalRound`/`extractWorkflowNode`——宿主递 query 函数进驱动器执行座位，本包对 agent SDK 维持零 import 零依赖、P1 不重开；fail-loud 无请求即响亮落错；abort 桥接 interrupt→宽限→close；重试=重跑，恢复=宿主 reopen+payload.resume，D6）+ 第八族 `routine/manager.ts`（`RoutineManager` 值班例程管理面：命名/停启/triggerNow/lastFireAt·nextFireAt·lastSession 反查；停启表纯内存+宿主持久化 D4；手动触发幂等键 `manual:{id}:{firedAt}` **独立段永不污染 Scheduler 恢复足迹**）+ 足迹解析抽出 `schedule/footprint.ts` 单一共享纯核（Scheduler 恢复行为逐字节不变）+ `WorkflowNode.manualClaim` 确认门节点（`runAt:null` 派发停在 pending+manualClaim，Cowork awaiting_confirm 投影**零新状态**，裁3；拒绝=cancelSession fail-fast、修订=reopen 链）+ `QueryRecord.costUsd` 成本入账（D2：executor 转录引擎估算，驱动器转发，Σ listQueries 即会话累计）+ `docs/ASSEMBLY.md` 四原语接线谱 + 例程五号 `agent-loop.mjs`（无钥可跑的注入式活体证明；**不建 LoopRunner，组合即 loop**，D3；宪章 §3 已补 D8 覆盖注）。测试 429→479（+50）。两新族按两级标尺标实验面并**随档指定首消费方**（设计档 §10——memory-tidy 生产化 / BPT Cowork / testbed·store-patrol 例程面改造），防 P2 判词重演。
- **v2.0.0（2026-07-29）**：**锁步对齐（家族首个 major，本包零运行时改动）**——随 agent SDK 2.0.0（T75：cards 退役 BREAKING + frontmatter + 选择性附着）前进；本包面无破坏，agent 侧 cards 消费者先迁移再 pin。
- **v1.4.0（2026-07-28）**：**审计第十七波（本包份额）**——两处**只被测试替身的宽容挡住**的真缺陷：①`claimDue` 把 `limit`（即 `LedgerDriver.maxConcurrent` 的批量上限）套在存储**恰好**返回的顺序上，而 `LedgerStore` 契约**根本不规定顺序**（随包契约套件比对前一律先排序 id，即顺序刻意在契约外）。全部测试替身都是 Map 支撑、列举序恰好等于派发序也就等于到期序，于是这条从来没被测过：对一个**完全合规**、按最新在前列举的存储，`maxConcurrent: 1` + 三个恒到期会话，实测 30 个 tick 里同一个会话占满槽位、另两个**一次没跑**；即便在内存存储上，5000/1000/100ms 三个到期点也会认领**最不逾期**的那个。现按 `nextRunAt` → `createdAt` 排序，完全并列者靠稳定排序保留存储序 · ②**32 位定时器溢出把每个毫秒旋钮顶部反转**：`systemClock.setTimeout` 把延时直接交给全局定时器，而超过 2^31-1 ms 后 Node 不是睡更久、是**溢出成 1 ms**。30 天的 `queryTimeoutMs` 通过了构造期的有限/正数校验，然后在执行器第一个 `await` 恢复之前就中止了每一次尝试、落 `retrying` + `lastError: 'timeout'`——**没有任何一次尝试可能完成**；同一反转把刻意设稀的 `pollIntervalMs`（驱动器与调度器皆然）变成对宿主存储的 1 ms 锤击。仅在交给全局的那一步封顶，注入钟与 NaN/Infinity 不动。
- **v1.3.0（2026-07-28）**：**审计第十五 + 十六波（本包份额，非空转）**——①`LedgerDriver` 在 try/catch **之外**解引用宿主执行器的返回值，执行器少写一个 `return` 即产生无人处理的拒绝、Node 宿主以 `ERR_UNHANDLED_REJECTION` 死掉、会话搁浅在 `running`，与「驱动器绝不因执行器失败而崩溃」的明文承诺相悖 · ②`GoalChaser` 从不校验评审器返回的判词形状（agent 侧对**同一个** 0.83.0 统一形状是校验的）：仍说旧 `{achieved, feedback}` 的评审器在 agent 侧会被响亮抓住，在本包却当「未达成」放过——第 1 轮就报成功的追逐实跑了 5 轮驱动器执行、最后落 `exhausted` · ③工作流加载器围栏扫描器把长围栏内的三反引号行读作闭合，**文档示例图顶替真图**被加载派发，而寻常的包裹写法反被判为「没有图」· ④UTF-8 BOM 被格式嗅探当无意义（`trimStart` 吃掉它）、又被 `JSON.parse` 当有意义，Notepad / PowerShell 存的合法图被静默跳过 · ⑤`nextFireAt` 的 `dailyAt` 分支撞上 `Date.UTC` 的两位年份重映射（0–99 → 1900+year，而 `getUTCFullYear()` 报真年），一世纪时间戳的触发点偏出约 1900 年、`firesBetween` 静默丢掉全部到期点（70 万随机元组证明改法在该窗口外与 `Date.UTC` 逐位相同）。另订正台账：破坏性的 `GoalVerdict` 统一被记在 0.85.0，而它真正发布的 0.83.0 被写成「本包零改动」——消费方据此把 0.83.0 当免费重 pin。
- **v1.1.0（2026-07-28）**：**审计第十三波**——**存储契约套件会给坏存储发合格证**（它是交付给宿主验证自家实现的东西，误判通过是此处最坏的缺陷）：`dueBefore` 检查名为 `<=` 却只测过 `500 <= 1000`，用严格小于过滤的存储照样 13/13 通过、却永久扣留每个恰在轮询时刻到期的会话；「按 id 创建或替换」从不断言一 id 一行，追加式存储照样通过而 `listSessions` 一直把旧世代交给调用方；`assertDeepEq` 比 `JSON.stringify` 输出，把**键序**写进了契约，字段全对但按列重建行的存储反而不合格。另修 goal 追逐器：中止落在宿主评审器决策期间仍会多买一轮，循环已派发第 N+1 轮且驱动器执行之后 `#awaitTerminal` 才拒绝（`WorkflowRun.run()` 早有对称守卫）。
- **v0.99.0（2026-07-28）**：**审计第十波（本包份额）**——`docs/ONBOARDING.md` 称契约套件有「16 项」，实为 13 项基础 + 2 项可选缝检查，宿主按 `report.total === 16` 断言会误判三项静默未跑；另本包 `terminal-vocabulary` 守卫射程注明「仅 src」，testbed 的基线导出器与浸泡演练都在射程外重复了被禁写法（已在 testbed 侧修正，规则归属本包故并记）。
- **v0.98.0（2026-07-28）**：**审计第九波（本包份额，全在从未审计面）**——变异棘轮守卫两处静默退出 0（与 agent 侧孪生同款）· **`examples/store-patrol.mjs`（每日在产 CI）五处**：损坏的 committed `ledger.json` 令巡检在构造期永久停摆、截断的 `latest.json` 基线令该店面此后每次尝试都抛、快照非原子写（中途被杀即发布半截文件而工作流照样提交）、`cancelled` 会话被读作在飞而烧光 120 秒排水超时并丢弃健康成果、失败过滤只认 `'failed'` 故未巡检的目标也报「全部巡检完毕」并退出 0 · `examples/memory-tidy.mjs` 把目录项喂给 `readFileSync`（`fragments/` 下一个嵌套目录即 EISDIR，整理此后再不运行）· 三个示例重复了 `terminal-vocabulary` 测试在 `src/` 禁止、而其射程注明「仅 src」的 `done || failed` 写法。
- **v0.95.0（2026-07-28）**：**台账两处缺陷 + 驱动器并发上限竞态修正**（家族审计波及本包，非空转）——`reopenSession` 并发 CAS 落败永久丢溯源链接、`recordOutcome` 回填路径写入词表外 outcome、`stop()`+`start()` 交错令两代 tick 各自认领满额致并发翻倍。

> **一句话**：银芯编排 SDK——持有分子（钟 / 跨会话状态 / 会话装配），把「活得比一次调用久」的
> agent 脏活做成可复用零件交宿主装配；与代理 SDK 分界 = 代理持原子（一次结构化调用）、编排持分子。
> 需求裁定书 `Public-Info-Pool/Resource/repo-engineering/scs-req-orchestrator-sdk-20260717.md`。
>
> **进度**（2026-07-18）：第零战 monorepo 迁移完成（仓库转 npm workspace 双包、silver-core-sdk
> npm 名经 `@biav/agent-sdk`（0.66.0）定为 `silver-core-agent-sdk`（0.67.0，守密人同日定名）、依赖方向守卫 CI 执法（maestro→agent 单向，双向违规红证实测））；
> 第一战任务台账 + 驱动器完成（0.2.0）：封闭状态机（pending/running/retrying/failed/done，定稿回填
> 需求档 §4）+ `LedgerStore` 宿主注入缝 + `TaskLedger` + `LedgerDriver` 持钟活组件 + 例程一最小 loop
> （消费代理侧 R2 预算事件流，e2e 对本地仿真器真跑）；纯核 state.ts **变异分 100%**（83/83，
> 棘轮地板 100 入 `sdk-mutation-ratchet.yml` 周检）；第二战商店巡检真实场景接入完成
> （2026-07-18 守密人点火）：`examples/store-patrol.mjs` 生产循环任务长在台账 + 驱动器上——
> Morimens Steam 双端点每日指纹比对，快照 + 变更日志落 `Public-Info-Pool/Record/store-patrol/`，
> CI `store-patrol.yml` 每日北京 15:15 自动跑，e2e 四场景 + 首次生产真跑绿；第三至六战
> （0.4.0，2026-07-18 动态编排令：4 实现代理 + 2 对抗审查 + 单脑整合）完成——schedule（例程二：
> 定点触发/错过补偿/跨重启恢复）+ workflow 图执行器（例程三：图即数据、fail-fast、幂等键断点续跑）
> + goal 追逐器（跨 query 重发起、轮=会话）+ 送达契约（审计先行）；审查抓 4 major + 1 minor 全修全锁
> （类型化 DuplicateSessionError / claimSession 单会话认领 / 四处 id 冒号封禁 / goal 排水超时）；
> 变异靶四处（ledger-state 100 / schedule-spec 100 / workflow-graph 97.14 / goal-decision 100）；测试 171。
> **未做**：周报 loop 生产切换（机制已备，待 T37 推送形态裁定）。
> **版本钟**：2026-07-18 守密人裁定两包**锁步同版**（覆盖需求档 §2 双钟制），0.68.0 起同号、
> CI 守卫相等；此后本节版本号即家族版本号。
>
> **第七战（0.69.0，2026-07-18 守密人待办批 4/5 项）**：workflow 声明式加载
> （`parseWorkflowGraphSource` / `loadWorkflowGraphFile`，json / md fence、坏文件永不抛降级跳过，
> 变异分 100）+ 例程四「综合整理任务」（`examples/memory-tidy.mjs`：定时派发→读健康面
> `assessMemoryStoreHealth`→归并写卡→删碎片→台账收口，黑池做梦例程原型，假钟 e2e）+
> schedule 错过补偿核对（已实现有测试，免补）+ 质量切换：棘轮五族全靶（新增 delivery-channel 100 /
> workflow-load 100，CI 矩阵六靶）、四份 e2e 全部假钟化（三连稳、秒级降毫秒级）；测试 171→180。
>
> **v0.92.0（2026-07-27，锁步对齐）**：本包零代码改动；随 agent SDK 0.92.0（Workflow 改真异步启动）前进。

> **v0.90.0（2026-07-27，锁步对齐）**：本包零代码改动；随 agent SDK 0.90.0（checkpoint blob 上限，T74 甲案）前进。
> **v0.89.0（2026-07-27，锁步对齐）**：本包零代码改动；随 agent SDK 0.89.0（类型面漂移检测工具化，首跑挖出四条「发货了却没声明」的类型缺陷）前进。
> **v0.86.1（2026-07-27，锁步对齐）**：本包零代码改动；随 agent SDK 0.87.1（嵌套路径普查：timedOutAfterMs 移回基类）前进。
> **v0.86.0（2026-07-27，锁步对齐）**：本包零代码改动；随 agent SDK 0.86.0（主循环提示词补回开篇句 + 输出类型普查续：ReadMcpResource 错误字段 + WebSearch 结构化结果）前进。
> **v0.84.0（2026-07-27，锁步对齐）**：本包零代码改动；随 agent SDK 0.84.0（记忆索引纪律 + 整理规程）前进。
> **v0.85.0（2026-07-27，goal 判词家族统一）**：**BREAKING（实验面）**——`GoalVerdict` 迁移为与 agent SDK 逐字同形的 `{status: 'achieved'|'not_achieved'|'impossible', reason?}`（原 `{achieved, feedback, impossible?}`）。起因：BPT 接入后报「goal 没效果、模型照样停」，排查定位两包**同名不同形**判词——评审器误用另一包形状时引擎按设计 fail-open 把 malformed verdict 放行为允许停止，goal 无声失效。守密人裁「统一判词类型」：agent 侧 `{status}` 为正典（BPT 实接层不动），Maestro goal 族（零调用点实验面）赶在 GoalChaser 首次接线前迁移；声明式重复不跨包 import（硬性质 §1.2），一个宿主评审器经结构类型同时服务两缝；`GoalRoundPayload.feedback` 字段名保留、改承载 `reason`。迁移映射见 CHANGELOG 0.85.0。
> **v0.85.0（2026-07-27，锁步对齐）**：本包零代码改动；随 agent SDK 0.85.0（工具产出结构化结果 + MCP 接受列表扩容）前进。
>
> **v0.82.0（2026-07-27，锁步对齐）**：本包零代码改动；随 agent SDK 0.82.0（Read 通读 >256KB 拒绝）前进。
>
> **v0.81.0（2026-07-27，锁步对齐）**：本包零代码改动；随 agent SDK 0.81.0（Read 截断页脚补齐官方三件套）前进。
>
> **v0.80.2（2026-07-27，锁步对齐）**：本包零代码改动；随 agent SDK 0.80.2（对齐 2.1.216 快照基准）前进。
>
> **v0.80.1（2026-07-27，锁步对齐）**：本包零代码改动；随 agent SDK 0.80.1（两条提示词溯源 slug 改锚 + 刷新 cron 补自检）前进。
>
> **v0.80.0（2026-07-27，锁步对齐）**：本包零代码改动；随 agent SDK 0.80.0（工具输出上限对齐 Claude Code 2.1.141：WebFetch 100_000 → Read 的 50_000、Grep `head_limit` 三模式统一默认 250、Bash 输出截断改保尾去头）前进。
>
> **v0.79.1（2026-07-27，锁步对齐）**：本包零代码改动；随 agent SDK 0.79.1（transport / MCP 内部去重）前进。
>
> **v0.79.0（2026-07-26）**：**重开语义（T67 甲案）+ 三项余项推进**（守密人「按你建议推进」）——`TaskLedger.reopenSession`/`reopenChain`（新会话 + `reopenOf`/`attemptRound` 链，**封闭状态机未动**：终态不可变是 CAS 围栏/幂等派发/重启不复活的共同立足点，缺的从来不是边而是链接；前驱须终态、`cancelled` 默认拒绝、后继 id 从链根派生、payload 可覆盖）· **T68** `docs/CONCURRENCY.md`（本包第二份文档）· **T69** 棘轮 `cadence` 分档（三个零消费靶降月检，加字段不删腿，cadence 自身三条治理断言）· **T70** 空转措辞钉死 + `scripts/sdk_substantive_versions.py`（守卫首跑抓到两条真漂移）。测试 404 → **421**。
> **v0.78.1（2026-07-26）**：**产品审视四项裁定**（审视档 `Public-Info-Pool/Resource/repo-engineering/maestro-sdk-product-review-20260726.md`，同日第二轮，问「作为产品是否成立/有效」）——**P1** 删除无代码支撑的 peerDependency（src 对代理零 import，npm 7+ 自动装 peer 与硬性质①冲突）· **P2** 六族两级成熟度标注（`ledger`/`driver`/`scheduler` **已验证**：两个互不相干真实消费方；`workflow`/`goal`/`delivery` **实验面零调用点**）+ 需求档 §6 补「已验证」标尺（须有非为演示它而写的消费方）· **P3** 首份 `docs/ONBOARDING.md`（store 可复制样板，实测两消费方各自手写 43/38 行、相似度 86%；**测试从 markdown 提取样板真跑契约套件**）· **P5** 判别式补第三维「触发权」（delivery 归属正当、是判据漏维）。**运行时行为零变化**，测试 400 → **404**。
> **v0.78.0（2026-07-26）**：**设计审视四缝全修**（审视档 `Public-Info-Pool/Resource/repo-engineering/maestro-sdk-design-review-20260726.md`，守密人同日四裁均取推荐案）——F1 `cancelled` 终态穿透场景层（三处硬编码 `done || failed`，默认配置下用户取消致工作流/目标追逐**永久挂死**；`graphStatus` 判 fail-fast、`GoalChaser` 新 action `'cancelled'`，新增 `isTerminal`/`isUnsuccessfulTerminal` + **禁字面量终态对的治理守卫**）· F2 驱动器 `maxConcurrent`（实测 200 到期→峰值 200）+ `claimDue(now,{limit})` · F3 可选存储缝 `deleteSession?` + 网关 `purgeSession`（契约套件 +4 检查）· F4 两长跑组件收 `AbortSignal`。测试 362 → **400**，三机制逐条回退负控实证。**未纳入**：Scheduler 全表扫、F5「重开」语义（挂待裁）。
> **v0.77.0（2026-07-26）**：锁步对齐 agent 侧 Windows 正确性清扫，本包零代码改动。
> 值得记一笔——同轮 Windows 探路中 agent SDK 15 个测试档失败，**maestro 362/362 全绿且无需任何改动**，
> 编排层不含宿主路径与 shell 假设。
>
> **当前版本 v0.76.0（2026-07-22）· 0.70.0→0.76.0 合并摘要（2026-07-26 哨兵首跑抓出补写）**：
> 本节此前停在 0.69.0，与 agent 侧同款漂移，由新建的跨档对账哨兵
> `tests/test_status_doc_facts.py` 首跑当场抓出。逐版全文以本包 `CHANGELOG.md` 为唯一权威。
> **T56「500 缺陷战役」五轮审计是本段主线**：0.70.0 轮一（17 finder 代理 + 对抗验证，确认 29 项真
> 缺陷全修带 fail-on-old 锁）· 0.72.0 轮二（6 换镜 finder，16 项含 3 个 P1，含 memory-tidy 经
> `store.view` 归并的数据丢失）· 0.73.0 轮四（4 路故障注入镜，11 项——台账并发大修：attempt 围栏 +
> 每会话互斥 + `putSessionIf` CAS 缝 + settle-then-append 提交序 + 恶意输入硬化）· 0.74.0 轮五
> （6 项：回填分支围栏 / 读面序列化 / 送达通道租约竞态 / 驱动器搁浅信号 / 分数 fireAt 恢复）；
> 战报 `Public-Info-Pool/Resource/repo-engineering/silver-core-maestro-sdk-bug-audit-r4-20260718.md`。
> **0.71.0** testbed 漏缝 G1–G3 采纳（`runLedgerStoreContractSuite` 12 检查 + `claimLeaseMs` 认领租约 +
> `scheduleSessionId()` / `seedFirstRun` 短命宿主收口）；**0.71.3** 打包三修（`files` 带 `src` /
> `prepublishOnly` / `exports` 子路径，与 agent 同缺陷同治）；**0.70.1 / 0.71.1 / 0.71.2 / 0.75.0**
> 为锁步对齐（本包零改动，跟随 agent 侧 deny 绕过修复、r3 批 N+P、批 R+S+T、R7 可观测性）；
> **0.76.0** `cancelled` 封闭终局（BPT P0-D1：用户主动取消升为一等终态，台账可与 `failed` 区分、
> 永不自动重跑；`TaskLedger.cancelSession()` 幂等 + CAS，取消与在飞尝试双向竞态均已钉死，
> 驱动器静默吞掉取消导致的迟到 `InvalidTransitionError`——用户取消不得读作驱动器故障）。
> **实测复核（2026-07-26 本地现跑）**：vitest **362 通过 / 29 文件**（冷态经新 `pretest` 自举）·
> 锁步 agent = maestro = 0.76.0 · dep-direction 守卫 OK。

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
> **等待真实时间**：验收 2「连续 7 天无人值守」自 CI 首轮起算（T57）。首日真实发现：
> agent SDK `mutation-ratchet.json` 的 loop-support 靶（地板 94.35）不在周检矩阵、从未被
> 实测（T64 站岗，原编 T60，2026-07-26 撞号让号；ratchet 巡检器每日盯防此类缺口）。

## Silver Core SDK（`projects/silver-core-sdk/`，原名 BPT Agent SDK，2026-07-10 守密人裁定更名；npm 名 `silver-core-agent-sdk`，2026-07-18 定名，品牌名 Silver Core Agent SDK）

> **更名注**：包名 `bpt-agent-sdk` → `silver-core-sdk`（0.41.0 起，含目录 / UA / clientInfo /
> 日志前缀 / CI 工作流 `silver-core-sdk.yml`）。本节及决策档中 2026-07-10 前的历史叙述保留旧名，
> 归档产物文件名（`Public-Info-Pool/Resource/**/bpt-*`）不追溯改名。
>
> **一句话**：官方 `@anthropic-ai/claude-agent-sdk` 的**公开信息再现**（自研引擎），drop-in 兼容公开接口，
> 但引擎**直驱 Anthropic Messages API**（fetch + SSE，**不打包 CLI 子进程**）。用途：让 BPT Desktop
> （Electron）脱离被禁的 `claude.exe` 子进程引擎。**定位辨析见「## 子项目状态」表下方例外辨析**——
> 银芯→黑池单向输出物，与 §1.1-HC 防火墙同向，非 BPT 产品内部开发。

- **动手前必读**：`projects/silver-core-sdk/CONTEXT.md`（会话上下文 + 当前 milestone）
- **v2.2.3（2026-07-29）**：**观察项批收口（守密人裁「修复 然后合并」）**——2.2.2 审计留观察位的静默回落全线收紧 + 三处「工具说了不实话」订正：①Grep/Glob `path` 非字符串静默搜 cwd 改报错（错作用域满置信答案）· ②Grep 选项 present-but-mis-typed 一律点名（布尔组 `-i`/`-n`/`multiline`/`-o` + 计数组 `-A`/`-B`/`-C`/`context`/`offset`/`head_limit` + `glob` 数组形并给 `"*.{ts,tsx}"` 写法）· ③Grep 对显式文件目标不再声称「node_modules/.git 已排除」（该过滤对具名文件根本没跑），三处编码旧不实文案的既有断言同步订正 · ④Bash `truncated` 改用 `CappedStream` 真实丢弃计数（原正则嗅探自家渲染文本，命令 echo 标记形字符串即假阳性）· ⑤Bash 后台 ack 补 `backgroundTaskId` 结构化产出 · ⑥Bash NUL 字节由 `ConfigurationError`（环境判词）改命令错（模型可自纠），既有测试同步订正为断言新行为 · ⑦SendMessage 包裹 `bridge.send` · ⑧`GrepOutput.numFiles` 跨模式语义落进类型契约。另修 `--` 悬空分隔符；`displayTruncated` 写明纵深防御且刻意不放宽为 `>=`。测试 21 例；全量 3460 绿。
- **v2.2.2（2026-07-29）**：**工具调用参数健壮性七修（2.2.1 同族续扫，守密人「继续查找工具调用 bug」）**——三代理审计全工具面，同「参数静默出错而非诊断报错」族六缺陷全修 + 一权限旗镜头判 CLEAN：①Grep/Glob 纯否定 glob（`!*.test.ts` / `!**/*.md`）令 fast-glob 返回空、把含命中语料报「No matches」（HIGH，补 `**/*` 正向基作排除底）· ②Bash `run_in_background:"true"` 字符串静默转前台、长驻服务被超时杀（HIGH，改诊断报错）· ③Bash `timeout:"5000"` 字符串静默回落 120s 默认（MED，改诊断报错）· ④WebSearch 后端 null 元素在 try 外崩 `r.url`、整批丢失（MED，filter/render 前丢非对象）· ⑤AskUserQuestion 应答未过 singleLine、换行伪造记录行（LOW，同 WebSearch 1.4.0 同型）· ⑥memory 注入 store 非 Error 抛值得 content undefined（MED，String 化，L74 唯一漏网）。权限旗镜头（写工具误标 readOnly 全模式自动放行）+ 挂载边界 + worktree/plan 态审计均 CLEAN。`tests/tool-param-robustness.test.ts` 11 例锁；全量 3450 绿。
- **v2.2.1（2026-07-29）**：**输入形状诊断（守密人裁定 2026-07-29，BPT Edit `old_string` 盲试循环案）**——黑池会话里 Edit 连报 `"old_string" must be a string`、模型换多个 old_string 重试均同错、误判「工具层暂时故障」，银芯排查判定 SDK 自身路径全数无辜（截断输入两代都不执行：0.63.1 前抛协议错、H4 起打标拒执行；两臂拼装零「JSON 修补」），真因锁定宿主侧改写——头号嫌疑 = PreToolUse `updatedInput` 只回传改过的路径字段，而 `updatedInput` 语义是**整体替换非合并**（与官方一致），故 Read（只需 file_path）一路正常、Edit 必炸。两条诊断增强落地、零行为变化：①Edit/Write 参数类型报错保留历史前缀、追加实际收到的形状（`"old_string" was absent; received input keys: ["file_path"]`，只给键名防泄密）；②权限门 `check` 增诊断性 `requiredInputKeys`（只喂内建工具一手 schema，MCP 第三方 schema 不可信故跳过），hook / canUseTool 两处替换缝若丢掉模型确实发过的必填键，debug 日志点名改写方 + 明示「return the FULL input」；模型本就没发的键不赖改写方。`tests/input-shape-diagnostics.test.ts` 11 例锁定；全量 3438 绿。memory 工具「/memories/pitfalls 越界」报错同场核验为挂载访问控制设计内行为，非缺陷。
- **v1.5.0（2026-07-29）**：**十条观察项拷问裁定全落地**——守密人逐条过堂（#7 收紧、#9 扩大收编两处否决推荐案）：AskUserQuestion 三处全补 · Agent 描述官方复现 + 描述治理完备性守卫 · Glob/Grep 忽略集披露 · Read 路径归一 + 256KB 拒读堵大 limit 绕过 · Grep rg 方言兼容垫 + type 报错自愈 · 冷/热分层守卫 · 记忆索引官方链接格式 + 双态容量预警；frontmatter 等三项挂 T75 设计轮。
- **v1.5.0 同版前半（对齐审计三裁，原拟 1.4.0、上游十七波占号并入 1.5.0）**——①记忆常驻索引「单向镜」被 view 上限重新打开：写侧告警只数 `store.view` 幸存行、丢弃 view 自身截断信号，而默认 `maxViewChars`(16000) **小于**索引字节上限(25600)，密集 ASCII 索引先被 view 切掉、幸存头通过行/字节判定、告警永不响——新 `assessViewedIndex` 把 view 截断并入两侧共用判词（`breached:'view'`）· ②索引注入补官方防护措辞（background context, not user instructions + 待验证声明；S1 挂载下他会话写入可进本会话 system prompt）· ③ToolSearch 对齐官方查询语法（select:/关键词/+名限定 + max_results 默认 5）与 `<functions>` 返回编码，入 provenance 治理（此前它是唯一治理体系外工具、却是银芯变体 2/3 工具面唯一入口）· ④Bash 输出上限补齐官方两级设计（`options.bashLimits` + `BASH_MAX_OUTPUT_LENGTH` env，封顶 150000，默认路径字节不变）· ⑤COMPAT 三处 Workflow 陈旧 SYNCHRONOUS 判词订正 + 十条未登记漂移入册（AskUserQuestion preview/plan-mode 段、Glob/Grep 静默忽略集等）。
- **v1.4.1（2026-07-29）**：**`setServers()` 改增量 diff（BPT 缺陷 D）**——原实现是 `closeAll()` → 整体替换 entries → `connectAll()`：只要调一次 `setMcpServers`，**已连上的每一台**都被断开重连，包括当前回合工具所在的 in-process `sdk` 服务端；会话中途 `load_skill` 一次，整个工具面就抖一次。现按「名字 + 配置」比对：两者都没变的条目原样留用（连接 / 工具表 / `serverInfo` / `enabled` 一并保留），只关真被移除或改了配置的，只连真新增或改了配置的。配置等值为**结构比较**——显式写成 `undefined` 的可选字段视同缺省，非纯对象（尤以 `sdk` 传输的 `instance`，其 `tools` 是装着处理闭包的 Map）按**引用**比对，重建的实例走重连（安全方向）。连带效果：`McpSetServersResult` 的 `added`/`removed` 从此描述**真实发生的工作**，留用的服务端是真没被动过。另：随此换代，未变动的服务端会**保留** `setEnabled(false)` 状态，不再被静默重新启用。
- **v1.4.0（2026-07-28）**：**审计第十七波**（四个前所未用的镜头：不可信工具输出作为**结构伪造通道**、故障注入、向后兼容漂移、以及「测试替身放过了什么」）——①**文件名即可伪造 `system-reminder`**：Read 把解析后路径原样插进该围栏，而它是本框架**最高权威的带内标记**；一个 0 字节文件只要**名字**里含闭合标签再开一个，攻击者文本就以「框架自己下发」的身份进了上下文（所需字符全部是合法文件名字符——那个 `/` 来自路径分隔符）。`query.ts` 早有同款中和且注释点名此攻击，Read 是 `src/` 里最后一处漏网 · ②同款漏洞在**项目指令**上：CLAUDE.md / AGENTS.md 正文原样进围栏，文件里写一句闭合标签就把自己的信封劈开、余下部分变成顶层框架文本 · ③**WebSearch 的域名过滤可被整条绕过**：结果 `title` 里一个换行就伪造出完整的额外结果记录，而伪造记录**从不经过 `filterResults`**——允许域上的一个页面能给**明令封禁**的域渲染出一条格式完好的结果 · ④**网页搜索费从来没被计过**：`server_tool_use` 在折叠 `message_delta` 用量时被丢掉，而传输层只有流式、`message_start` 结构上不可能带搜索计数，故 `maxBudgetUsd` 可被整笔服务端工具账单突破而闸门不响 · ⑤**缓存断点白白空着一半**：分段系统提示下只要调用方标了任何东西，循环就把消息断点整个撤掉，实测 4 个槽只用 2 个——整轮工具循环每回合把**全部消息历史**当新 input token 重发（分段标记上限是 3，永远有空槽）· ⑥后台子代理的迟到花费只进最终结果、不进持久台账，宿主据以决定「下一轮还injects不injects」的那个缝可能漏掉一次会话几乎全部成本。
- **v1.3.0（2026-07-28）**：**审计第十五 + 十六波**（权限×钩子交互面、协议边缘 MCP stdio/HTTP、回合生命周期、以及对降级机制的故障注入镜头）——①**`Read(*.env)` 是一条空规则**：无字面前缀时编译成 `^[^/]*\.env$`，而取值一律解析为绝对路径，单个 `*` 永不跨 `/`，故该规则在任何目录下匹配不到任何输入；宿主以为 .env 读取已封，实际每一次都放行（`Write`/`Edit`/`NotebookEdit` 同形）· ②**deny 在包装器上失效**：`Bash(rm:*)` 拦不住 `sudo -u root rm -rf /`——剥掉旗标后落在旗标的**值**（`root`）上，离 `rm` 差一个 token 就停了（`timeout -s KILL`、`env -u FOO`、`xargs -I {}` 同款）· ③**子代理不继承会话规则**：子代理的门是按**构造期**选项数组建的，宿主经 `canUseTool` 中途加的 deny 规则主循环认、此后每个子代理都不认——子代理执行的正是宿主刚刚禁止的动作；而**模式**早已是 spawn 时实时读取，一半会话状态到得了孩子、一半到不了，这个不对称正是它藏得住的原因 · ④`auto` 模式下宿主分类器抛出会**整个逃出** `check()`，越过门、越过派发，回合以无决策无记录的方式死掉（孪生缝 `canUseTool` 遇同种失败是 fail-closed）· ⑤钩子 `condition` 门的模型评估只受调用方中止信号约束，提供方接下不吐流即**永久挂住**每个被门控的工具调用，而 matcher 明明声明了 `timeout` · ⑥`mcp/stdio` 只给 stdin 挂了 error 监听、stdout/stderr 没挂，无监听的 error 事件按未捕获异常重抛——一个 MCP 服务器的管道被粗暴拆掉就**杀掉整个 agent 宿主** · ⑦工作流加载器的围栏扫描器不看反引号根数，于是文档里被引用的示例图可以**顶替真图**被派发 · ⑧`error-normalize`——引擎错误链唯一指望「永不抛」的那个模块——遇 `.message` 被改写成对象即抛 TypeError，原始故障穿透到宿主、provider/可重试性/请求 id 全丢。
- **v1.2.0（2026-07-28）**：**审计第十四波**（两个新横切镜头：幂等性、资源上限；sessions/subagents 与 transport 按生命周期而非按档案的第四轮）——①**一个让进程退不出去的泄漏**：有界错误体读取调用 `response.text()` 会**锁住**流，10 秒上限触发时 `body.cancel()` 抛 `ReadableStream is locked` 被空 catch 吞掉、底层源的 cancel 从未运行；而 `.finally(releaseSignals)` 已把调用方中止与请求超时两条腿都摘下——**此后没有任何东西能中止那个 fetch**。503 可重试，故最多 11 次尝试各留一个永不结算的读取钉住 ref 住的 keep-alive socket，回合正常完成而进程再也退不出去（两个机制各自以为自己拥有取消权）· ②**一个从没有人写过的字段**：`parent_agent_id` 在 `session-functions.ts` 被读回，而全 `src/` 无任何写入方——该官方字段声称的用途（从磁盘元数据重建二层以上代理树）对本 SDK 写过的每条消息都报 `null` · ③**每次读都换一个身份**：子代理旁链记录不带 `uuid`，读取端的「遗留兼容」回退每次现造新 UUID，同一轮两次读出不同身份、去重永远合不拢 · ④`provider.baseUrl: ''` 非 nullish，压过环境变量与默认值产出相对端点，`fetch` 的 URL 解析错误被归类为可重试网络错误，一个配置笔误烧掉 11 次注定失败的 POST（同文件三个 token 外的环境变量分支早有 `nonEmpty` 守卫，provider 分支没有，两个传输都是）· ⑤运行期**移除**的保留区在透明自动续跑后复活；`Query.close()` 是第四条从不结算管理器台账的生成器出口，每关一个查询泄漏一条并被 `usage()` 折算终生；镜像存储按会话 id 永久保留缓冲与链条，而每个子代理转录都是独立 id，扇出即单调增长 · ⑥资源上限：`meta` 解析器无递归深度上限且其 `RangeError` 会绕过预检 catch，`mcp/http` 的纯 JSON 分支整体缓冲而 SSE 分支有 16 MiB 上限、stdio 有单行上限。
- **v1.1.0（2026-07-28）**：**审计第十三波**——三处令会话或请求**永久损坏**：①`registry.allTools()` 跨服务器发出重名限定工具名，而一处重名即 400 掉**整个** Messages 请求、会话每回合都死（服务器 `a` 的 `b__c` 与服务器 `a__b` 的 `c` 同归 `mcp__a__b__c`；同类碰撞在单服务器分页与调用路由上早已处理，唯独广告路径没守）· ②`repairPairing` 有孤儿工具对与角色交替两轮修复，却没有一轮保证重放历史**以 user 轮开头**，而 `load()` 有两条路径会吃掉开头的 user 行（首行撕裂被当非法 JSON 跳过；空轮守卫丢掉遗留的 `content: []` 开场轮）→ API 回 `messages.0: Unexpected role "assistant"`，此后该会话**每次 resume/continue/fork 都从第一轮 400，且档案永不自愈** · ③`system-field` 在调用方**没标**任何缓存断点时仍报 `callerBlocks: true`，请求只带工具断点出门，四个短时槽空置三个、整段对话每回合按未缓存重新计费。另修时区镜头四处（巴哈姆特台北时区、TapTap DOM 路径、`backfill_gap` 窗口与桶相位差 8 小时、`source-health` 两写入方时钟不一致）。两处替身盲区（假存储 `load()` 恒返回 null、仿真器不校验请求体）正是 ②能熬过前十二波的原因。
- **v1.0.0（2026-07-28）**：**审计第十二波**——两处令 API **从首条消息起拒绝整个会话**的工具定义缺陷，且同藏一个盲区：mock transport 记录每个请求却不校验任何内容，故从无测试断言过引擎组装的 `tools[]` 是 API 会接受的东西。①外部 MCP 服务器的 `mcp__{server}__{tool}` 名原样上线、无字符集校验（进程内 SDK 服务器**有**校验、OpenAI 编码器也警告自家 64 字符规则，唯独 anthropic 这条路两样都没有）：第三方服务器暴露 `search.web`（点号在 MCP 合法、在线上非法）即令整请求被拒，而每回合都重发同一份清单，会话从第一条消息起就死，报错还只给工具下标不给服务器名 · ②`normalizeInputSchema`——那个正因「宽容服务器的坏 schema 会杀死共用该清单的每个请求」而存在的守卫——只判「是不是普通对象」就停在 API 真正校验的字段上一层，`{}`（无参 MCP 工具的常见产出）直接 400。另修：**tip 提示词注入**（模型自写的 tip 未折行即插入行式表头，可伪造「用户说太好用了」的续文自评正面）· **价格覆写被吞**（`cacheTtl:'1h'` 下显式声明的 `cacheWrite` 让位给硬编码比率，声明 $9 却按 $2 计费，低报成本与预算上限）· **估算器崩溃**（`content: null` 的消息抛 TypeError，压缩触发器与公开估算器全查询失效）· **去重窗口永不重开**（`record()` 在年龄驱逐之前就对重复键短路，过了 `maxAgeMs` 仍永久压制，除非中间恰好记过别的键）· **验证器坍缩与真判词无法区分** · **沙箱 TMPDIR 为空时解析到只读根** · 八条把读者指向无辜组件的错误消息。
- **v0.99.0（2026-07-28）**：**审计第十波（首扫仓库自身的守卫机器）**——主线是**「守卫报 OK 却什么都没查」**：①**一致性台在零次比较上出具合格判词**——0.94.0 移除包内默认模型后 `run-l2`/`run-l4` 从未钉 `options.model`，L2 十五个场景死了十四个、L4 十五个故障用例全死在构造期（104 项检查失败、零次 POST），两条腿照常报告；另有八处标尺自身的洞（L1 算出官方臂检查失败却丢弃，两臂在 result 子型/正文/tool_result 条数上分歧仍记 MATCH；L3 只看预期条数故多出的 tool_result 隐形；某 L2 场景把任何抛错都当作权限互锁生效的证据；抛错的 `interrupt()` 被吞成 abort 而判据照样满足；sse-hang 遇未知标记发完整事件集而非失败；CI 把关的无钥烟测在零行时空绿）· ②**规模**（`htmlToText` 对 200KB 裸 `<` 卡 35 秒、5MB 上限下达数小时，且是**同步正则、超时与 AbortSignal 都打不断**；`partitionForCompaction` 每次检查 O(n²)，16k 消息 2.3 秒、130k 跑不完；`store.load` 整档读入，705MB 转录抛 RangeError 被裸 catch 吞掉、恢复静默报「无此会话」并开空对话继续往同一档追加，而 `list()` 仍宣称可恢复）· ③**消费者会照抄的文档**（README 的 `options.goal` 示例用了不存在的 API 形状：照抄即抛，猜名字改写则被判畸形判词而**放行每一次停止**，目标门无声失效；MIGRATION 给出 0.67 改名前的包名，另六份文档 13 处 import 解析不到，day-one 升级金丝雀因此永远认证本地检出而非安装的 tarball）· ④**守卫射程外**（`terminal-vocabulary` 只管 maestro `src/`，testbed 的基线导出器——评测数据源——与 kill-9 演练都在射程外手写终态判断，`cancelled` 会话永远算在飞、虚高完成率）。战报见 `Public-Info-Pool/Resource/repo-engineering/sdk-bug-audit-multiwave-20260728.md`。
- **v0.98.0（2026-07-28）**：**审计第九波（首扫从未审计面 + 四个新横切镜头）**——家族共 43 处，本包份额：**「守卫静默退出 0 却什么都没跑」**（变异棘轮守卫因检出路径含空格而整条 required CI 腿空转、非数字 floor 令任何分数经 NaN 比较通过；版本守卫把「不是 git 仓库」当成良性浅克隆跳过；type-parity 同款空转、打印不出东西却读作「无漂移」；run-evals 在计费 LIVE 轮跑完后因 `--out` 缺值丢弃报告、两个互斥 only 旗标合用则什么都不评估还退出 0）· **发射契约**（引擎就地并入的续接 user 轮送达模型却永不进消费者流；回合级中断时尾部 tool_result 轮已落盘却被丢出流，流式宿主的转录与磁盘永久分叉）· **数值边界**（`loadTimeoutMs` 30 天溢出 32 位定时器成 1ms、令每次会话加载超时；`preTierMaxToolResultChars: NaN` **摧毁**每个超长 tool_result 换成 `[…NaN chars elided…]`；`concurrency: NaN` 造出零工人返回数组空洞；`retentionDays: Infinity` 从「绝不抛错」的路径抛 RangeError）· **确定性**（`latestSessionId()` 与 `list()` 对同 mtime 会话互相矛盾，`continue:true` 恢复的不是列表显示的最新者）· **平台**（Edit 把纯 CRLF 档写成混合行尾、Windows 风格 glob 静默零匹配、`~\` 会话根写进 cwd）· **分支级产出缺口**（Grep 四条终止分支有两条不产 structuredOutput、WebSearch 用空串填必填 tool_use_id、Read 图片/PDF 分支从不产出）。战报见 `Public-Info-Pool/Resource/repo-engineering/sdk-bug-audit-multiwave-20260728.md`。
- **v0.97.0（2026-07-28）**：**导出权威 token 估算器 + 内建工具输出上限（黑池转派需求 2026-07-28）**——黑池「上下文构成」面板对未成请求素材（草稿 / 待注入记忆 / 知识库候选）只能手工镜像 SDK 估算算法，注释级「改 SDK 须同步本函数」人肉契约必然漂移。从包入口导出 `estimateTextTokens` / `estimateMessagesTokens` / `estimateToolDefsTokens`（引用级 re-export）与 `MAX_READ_OUTPUT_CHARS` + frozen `TOOL_OUTPUT_CAPS`（read 50000 / bash 30000 尾保留 / webFetch 50000 / grepHeadLimit 250 条目数，每值 import 自工具实际执行常量）。同 `buildSystemPromptParts` 先例（ADR 0014）：内部已有实现、只差入口 export。黑池删镜像后其既有测试断言即对齐验证。需求档已归档 `Public-Info-Pool/Resource/repo-engineering/scs-req-export-token-estimation-20260728.md`。原拟 0.95.0，两度与同日审计波次（#867 / #868）撞号，定 0.97.0。
- **v0.94.0（2026-07-28）**：**包内模型兜底默认值全数移除（BREAKING，黑池 sdk-bridge 转派需求 2026-07-28）**——黑池生产报错文案里出现其代码从未写过的 `claude-sonnet-4-5`，倒查出 `query.ts` 写死的 `DEFAULT_MODEL`：消费方任一路径漏传 `model`，包就静默换上一个自己都不知道对方网关认不认的 id，直到网关 400 才暴露。按黑池首选方案 A 根治：`query()` 缺 `options.model` 且缺 `ANTHROPIC_MODEL` → 构造期抛 `ConfigurationError`；`runUtilityCall` 全家缺 `opts.model` → 请求出门前拒；引擎内部 condition 调用改**继承会话模型**（与 compaction 摘要器同规）；`DEFAULT_UTILITY_MODEL` / `VERIFIER_DEFAULT_MODEL` 出口删除（0.3x 表面锁 `knownRemovals` 登记 + MIGRATION §3.10）。COMPAT `model` 行降 FULL → PARTIAL 如实记刻意偏离；一致性台架显式钉原默认 id，冻结基线字节不变；黑池已按铁律传全 id 的路径零行为变化。

  「SDK 在 windows 环境工具调用经常犯蠢」）**：3200+ 测试一直全绿却一条都看不见，因为全部跑在
  POSIX 宿主的 POSIX 方言下。三条真缺陷——① **路径域权限规则双向皆坏**：POSIX 写法 deny
  （`Read(//etc/**)`）在 Windows 上匹配不到任何东西（**在黑池唯一发货平台上 fail-open 的 deny**），
  Windows 写法 deny 则过度匹配（单 `*` 不在 `\` 处停、跨了目录边界），且大小写敏感可被 re-casing 绕开；
  三者统一到规范空间（`/` 分隔 + 小写）后消失，**只在 win32 生效**（POSIX 上反斜杠是合法文件名字符、
  大小写敏感，折叠即新洞）。明写代价：规则语法的 `//` 绝对写法在 win32 先折叠，故 UNC 域规则不可表达。
  ② **宿主传受控 env 时 Bash 工具整个消失**：Git 安装根只从 `options.env` 读，硬化 Electron 宿主只传
  `{PATH, HOME}` 即空候选表、每次调用死于「No POSIX shell found」；安装根属宿主装机事实，现回落
  `process.env`（调用方给的根仍优先、不向子进程泄漏新变量）+ 候选表去重。③ **Glob/Grep 与其余工具面
  路径方言不一致**：`fast-glob` 恒出 POSIX 分隔符，Windows 上一条路径两种拼写；现归一为原生分隔符
  （既有测试本就按 `path.join` 断言，是实现漂了）。测试侧 `MatchContext.platform` 令方言可注入，
  `tests/windows-path-semantics.test.ts` 20 例（含 POSIX 负控）在任意宿主断言 win32 行为；
  vitest 插件剥 `scripts/*.mjs` shebang、拆卸重试越过 EBUSY、8.3 短名归一。
  **Linux/macOS 零行为变化**，全量 **3236 通过 + 5 skipped**；maestro 同轮 **362/362 全绿零改动**。
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
