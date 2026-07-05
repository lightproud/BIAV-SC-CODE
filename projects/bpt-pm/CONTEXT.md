# bpt-pm — 子项目会话上下文

## 定位

BPT PM：**单网页项目排期工作台**。一份 JSON 描述一个项目（锚点日期 + 工作日历 +
任务列表 + 可选基线），本地单 HTML 页读取后做**类微软 Project 的自动排期**（关键路径法
CPM）、**基线比对**，确认后**写回同一数据源**。零后端、零依赖、零网络——双击 `index.html`
即用（现代浏览器经 File System Access API 直接读写本地文件，回退为拖放/下载）。

- 派发来源：守密人 2026-07-05 会话（「新建 BPT PM 子项目，约定数据表格式协议，
  单网页读取 → 自动排期 + 基线比对 → 写回数据源」）。
- 非使命线工程产物，与 news/wiki 双核心主线无耦合；与 §1.1-HC 黑池防火墙同向：
  本工具仅处理银芯自有公开排期数据，不触碰任何黑池/内部数据。

## 数据表格式协议（bpt-pm/v1）

单文件 JSON，权威定义见 `schema/task-schema.json`（JSON Schema draft-07）。三段：

| 段 | 内容 |
|----|------|
| `project` | 项目名 + `start` 锚点日期 + `calendar`（workdays ISO 星期号集合 / holidays 节假日例外）|
| `tasks[]` | `id` / `name` / `duration`(工作日,0=里程碑) / `predecessors[]`（{id,type,lag}，type∈FS/SS/FF/SF）/ `constraint`(ASAP/SNET/MSO) / `resource`(引用 resources.id) / `percentComplete` |
| `resources[]` | **（v2）** 资源注册表：`id` / `name` / `type`(person/vendor) / `capacity`(并发产能，人=1、外包=N)。可选 |
| `baseline` | 基线快照：`capturedAt` + `tasks{id→{start,finish,duration}}`，可为 null |

样例数据：`data/sample-content-team.json`（内容团队美术交付 + 外包 + 资源冲突，内嵌于「载入样例」按钮）；
`data/sample-project.json`（早期 wiki 冲刺样例，无资源）。

## 排期引擎（CPM）

在**工作日索引空间**计算，再经 `WorkCalendar` 映射回日历日期（跳过周末/节假日）：

- **前向计算**：拓扑排序 → 早开始 es / 早结束 ef（依赖 FS/SS/FF/SF + lag + SNET/MSO 约束）
- **后向计算**：逆拓扑 → 晚开始 ls / 晚结束 lf → **总浮动 slack = ls − es**
- **临界路径**：slack ≤ 0 即临界（表格行红字 + 甘特条红色 + 依赖连线红色）
- **环检测 / 悬空依赖**：拓扑期报警告，不静默

## 资源冲突可视化（v2-A，守密人 2026-07-05 定向）

面向 60 人内容团队痛点「资源冲突」（含外包发单产能）。`computeResourceLoad`（引擎内联 +
`scripts/schedule.mjs` 同逻辑）在排期后算每资源逐工作日负载：任务在 [es,ef) 占其资源 1 个并发槽，
某工作日承载数 > `capacity` 即**超载**。网页「切到资源负载」按钮切出**资源 × 日热力图**：
空=透明、未满=绿、超载=红并标数字；行标注类型/产能/超载红点；状态栏汇总超载资源数。

- **两类资源语义**：`person`（产能常 1，如主美/绑定瓶颈岗）vs `vendor`（外包，产能=并发接单数）。
  外包满载（load=capacity）显绿不报红——演示并发产能吸收，区别于人力超载。
- 回归：`tests/resource_load.mjs`（主美/原画/程序超载、外包A 满载不冲突、超载资源数=3）。
- 截图：`docs/screenshot-resource.png`。
- **未来（D 阶段，外包发单尚无系统 → 从零建模）**：发单为一等对象（供应商/PO/返修轮次/验收/付款）
  + 状态流水，关联排期；供应商产能喂给本冲突视图。规划见「按痛点选功能」分析（会话 2026-07-05）。

## v2 三特性 B/C/D（守密人 2026-07-05，全部 additive 向后兼容）

面向内容团队交付痛点叠加三组能力，均**不改 CPM 主算法**（余量只做叠加，不动 slack/临界），
协议字段一律 optional（`schema/task-schema.json`），旧数据零改动可读。引擎放置见 `scripts/schedule.mjs`，
网页内联同实现（`index.html`），回归 `tests/v2_bcd.mjs`。

- **B 版本周期守护（余量模型，2026-07-05 重构）**：项目级一个 `project.updateDate`（对外更新日期，
  **不移动任务**）。排期后每任务写回 `externalMargin`（对外更新余量）= 对外更新日期工作日索引 − 任务结束索引；
  正=有余量，负/0=会跳票；顶层汇总 `slipCount`。样例 M1（封板）结束 07-17、对外更新日期 07-16 → 余量 −1（会跳票）。
  「误期/截止」旧概念已删，改用「余量为负=跳票」——与「版本交付余量/任务交付余量」统一为三个「余量」框架。
  小学生比喻：给整版画一条「对外答应的更新日」，每件内容标「离那天还剩几天」，负数=赶不上、会跳票。
- **C 流水线模板 + 返修回环**：项目级可选 `templates[]`（`{id,name,stages[]}`，stage 含 `key/name/duration/
  resource/type/lag/revisionRounds/revisionResource/revisionDuration`）。纯函数 `instantiateTemplate(tpl,{prefix,assetName})`
  把模板展开成一串 FS 链接任务：每 stage 一主任务，`revisionRounds` R>0 时在主任务后插 R 轮「审核（dur1，
  revisionResource）→ 返修（revisionDuration，沿用阶段 resource）」，下一 stage 依赖本 stage 链**最后一个**任务。
  小学生比喻：一张「先打草稿→老师批→改→再交」的流程贴纸，贴到哪个角色身上就自动生成那一串待办。
- **D 外包发单对象**：项目级可选 `orders[]`（`{id,vendor,asset,poDate,quoteAmount?,expectedDelivery,
  actualDelivery?,revisionRounds?,status,linkedTaskId?,notes?}`，status∈待发/已发/画中/回稿/内审/返修/已验收/入库）。
  纯函数 `analyzeOrders(orders,taskResults)` 给每单加 `atRisk`（有 linkedTaskId 且关联任务计算结束日 >
  expectedDelivery = 交付风险）；顶层汇总 `ordersAtRisk`。样例 PO-002 预计交付 07-12 < Y3 结束 07-14 → 风险。
  小学生比喻：给每张外包订单贴一张「说好哪天到货」的便签，排期一算发现真到货比说好的晚，便签就变红。

## v3 四组（守密人 2026-07-05 Ultracode 全做，工作流编排，全部 additive）

引擎四组均在 `scripts/schedule.mjs` 与 `index.html` 内联版同实现，回归 `tests/v3.mjs`（20 断言全过）。

- **① 引擎完备性**：`freeSlack` 自由浮动（后继 headroom min，clamp≥0，无后继=总浮动）；约束补齐 **8 型**（新增 ALAP/SNLT/FNET/FNLT/MFO，`forwardConstraint` 抬前向 + `capBackward` 后向 cap + ALAP 后处理浮到最晚）；**从完成日倒排** `project.scheduleFrom="finish"`+`finish`（后向锚定，末任务落在 finish，窗口不足报 `infeasible-window`）。
  比喻：自由浮动=「你一个人能偷懒几天不连累任何人」；倒排=「定死交付日往前倒推每步最晚该动手」。
- **② 资源错峰建议**：纯函数 `suggestLeveling(leaves,resources,cal)` 贪心串行——按(浮动升,es升,id)排，每资源产能内并发提交、撞车者右移。只出建议不改排期。返回 `{suggested,newProjEnd,movedCount,residualOverloads}`；content-team 三处单资源撞车全消解、残余超载 0。`scheduleProject` 新增 additive `leaves`（叶内部快照）供其消费。
  比喻：一台打印机前两人同按，让第二个往后挪到打完再打；产能2 的外包=两台打印机，两人同按不用挪。
- **③ WBS 层级摘要**：`task.parent` 引用摘要；被引用者=summary，**排除出** CPM/资源/错峰，改由子任务卷积（start=min子/finish=max子/dur=跨度，支持嵌套）；每任务加 `depth`，摘要加 `isSummary`/`childIds`。无 parent 的样例零摘要、行为不变。
  比喻：摘要像文件夹，自己不干活，只把里头文件的最早最晚框成一个大区间。
- **④ 冲突显式告警**：顶层 `warnings[]`/`warningCount`，聚合 cycle/missing-pred + 新增 `constraint-conflict`(MSO/MFO 与前置矛盾)/`negative-slack`(ls<es)/`infeasible-window`(倒排放不下)。
  比喻：排期表的「体检红灯」——硬约束打架、浮动变负、倒排塞不下各亮一盏。

**UI 现状（已收尾）**：自由浮动列、8 约束解析、调度方向切换(#btnDir)、告警面板(#stWarn/#warnPanel + 行红旗)、错峰视图(#btnLevel)、第二样例(#btnSampleV3)；
**WBS 折叠三角 + 甘特摘要条**（摘要行 ▶/▼ 折叠子任务、甘特摘要括号条）、**错峰「应用建议」按钮**（把移动任务写成 SNET 约束重排，实测超载 3→0）均已补齐，无头冒烟零 JS 报错。

## 表格格式协议（bpt-pm/table-v1，数据源无关）

把 bpt-pm/v1 拆成 5 张标准表（项目/任务/资源/外包单/模板），任何表格型数据源（阿里 AI 表格/alidocs、Notion、飞书多维表、Excel）
按 `docs/table-formats.md` 建表即可对接；列名即协议、标注「输入 vs 写回」列。生成器 `scripts/gen_tables.mjs`：
`--blank` 出空表模板（建新格式）、`<in.json>` 出填好样例的 CSV（UTF-8 BOM）。回归 `tests/tables.mjs`。

## 结构

```
projects/bpt-pm/
├── index.html                 # 单网页工作台（引擎 + 表格 + 甘特图，自包含）
├── schema/task-schema.json    # bpt-pm/v1 数据协议（JSON Schema）
├── data/sample-project.json   # 样例项目数据
├── data/sample-content-team.json # v2 样例：内容团队美术交付 + 外包 + 资源冲突（内嵌为默认样例）
├── scripts/schedule.mjs       # CPM 调度器 CLI + 资源负载/超载检测（与网页内联引擎同算法）
├── tests/                     # 纯 Node 端到端/单测：proxy_e2e.mjs · resource_load.mjs · v2_bcd.mjs
├── proxy/                     # 本地 Notion 代理（让网页按钮直连生效）
│   ├── server.mjs            #   零依赖 Node 代理：GET /tasks 拉取 · POST /writeback 写回
│   ├── .env.example         #   配置模板（NOTION_TOKEN / DATABASE_ID / 项目锚点），.env 被 gitignore
│   └── README.md            #   设置 + 启动 + 接口契约
├── docs/screenshot.png        # 运行时截图
├── docs/notion-adapter.md     # Notion 作数据源的适配器（字段映射 + 读排写工作流 + 踩坑）
├── CONTEXT.md                 # 本文件
└── README.md                  # 人类入口 + 使用说明
```

## 外部数据源桥接

`index.html` 是纯静态零后端页，浏览器出于 CORS + 令牌暴露**不能直连** Notion。两条落地路径：

1. **旁路同步（无后端）**：网页只碰本地 JSON；Notion 由艾瑞卡经 MCP 或带 token 的脚本搬运，
   排期用 `scripts/schedule.mjs`（唯一算法真相）。字段映射与踩坑见 `docs/notion-adapter.md`。
   ```bash
   cat pulled.json | node projects/bpt-pm/scripts/schedule.mjs   # stdin bpt-pm/v1 → stdout 计算结果
   ```
2. **本地代理（网页按钮直连生效，守密人 2026-07-05 选定）**：起 `proxy/server.mjs`（持 token 跑
   localhost），网页「从 Notion 拉取 / 写回 Notion」按钮经 `http://localhost:8787` 调它，代理走
   Notion REST（`databases.query` / `pages.PATCH`，不撞 MCP 会员墙）。设置见 `proxy/README.md`。
   端到端已验证（桩 Notion + 真 server + 浏览器：拉取→排期→写回 6 页载荷正确，零 JS 报错）；
   唯一未跑真令牌那一跳（代码路径同桩，仅 API base 不同）。

## 用法

1. 浏览器打开 `projects/bpt-pm/index.html`（双击或 `file://`）。
2. 「载入样例」看效果，或「打开数据源」选本地 `*.json`（Chrome/Edge 可写回同文件）。
3. 编辑表格（ID/名称/工期/前置/约束/资源/%，均可原地编辑）。
4. 「自动排期」→ 计算开始/结束/浮动 + 临界路径 + 甘特图。
5. 「设为基线」捕获当前排期为基准；再次排期后「偏差」列显示相对基线结束日的漂移。
6. 「写入数据源」→ 写回已打开文件（或下载 JSON）。

前置迷你语法：`T1`（默认 FS+0）、`T2SS+2`、`T3FF-1`、`T4SF`，逗号分隔。
约束语法：`SNET 2026-07-23` / `MSO 2026-07-10`，留空即 ASAP。

## 验证

- CPM 逻辑离线复算：临界路径 T1→T2→T4→T5→M1、T3 浮动 3 工作日、节假日跳过均正确。
- 无头 Chromium 冒烟：载入/排期/设基线/再排期零 JS 报错，6 任务条 + 6 基线条 + 偏差列 +1d 正常渲染。
