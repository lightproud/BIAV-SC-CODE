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
| `tasks[]` | `id` / `name` / `duration`(工作日,0=里程碑) / `predecessors[]`（{id,type,lag}，type∈FS/SS/FF/SF）/ `constraint`(ASAP/SNET/MSO) / `resource` / `percentComplete` |
| `baseline` | 基线快照：`capturedAt` + `tasks{id→{start,finish,duration}}`，可为 null |

样例数据：`data/sample-project.json`（亦内嵌于页面「载入样例」按钮，离线可用）。

## 排期引擎（CPM）

在**工作日索引空间**计算，再经 `WorkCalendar` 映射回日历日期（跳过周末/节假日）：

- **前向计算**：拓扑排序 → 早开始 es / 早结束 ef（依赖 FS/SS/FF/SF + lag + SNET/MSO 约束）
- **后向计算**：逆拓扑 → 晚开始 ls / 晚结束 lf → **总浮动 slack = ls − es**
- **临界路径**：slack ≤ 0 即临界（表格行红字 + 甘特条红色 + 依赖连线红色）
- **环检测 / 悬空依赖**：拓扑期报警告，不静默

## 结构

```
projects/bpt-pm/
├── index.html                 # 单网页工作台（引擎 + 表格 + 甘特图，自包含）
├── schema/task-schema.json    # bpt-pm/v1 数据协议（JSON Schema）
├── data/sample-project.json   # 样例项目数据
├── scripts/schedule.mjs       # CPM 调度器 CLI（与网页内联引擎同算法，供外部数据源桥接复用）
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
