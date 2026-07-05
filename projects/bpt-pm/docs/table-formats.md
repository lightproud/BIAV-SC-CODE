# BPT PM 表格格式协议（bpt-pm/table-v1）

**数据源无关**的多表格式标准。把 bpt-pm 排期数据拆成 5 张标准表，任何表格型数据源
（阿里 AI 表格 / alidocs、Notion、飞书多维表、DingTalk 多维表、Excel/CSV）按此建表即可被排期工具消费。
与单文件 JSON 协议 `bpt-pm/v1`（`schema/task-schema.json`）一一对应——表是它的**扁平投影**。

> 建新格式：`node scripts/gen_tables.mjs --blank` 产出 5 张**只表头空表**，导入你的 base 即成标准格式；
> 或 `node scripts/gen_tables.mjs <bpt-pm-v1.json>` 产出**填好样例**的 CSV（UTF-8 BOM，中文直读）。
> 灌样例后可 `node scripts/gen_tables.mjs data/sample-content-team.json` 一键得到可导入的示范表。

## 列约定

- **列名即协议**：列名须与下表一致（中文），排期工具按名取列，多一列少一列不影响。
- **输入列 vs 写回列**：输入列由人填；**写回列**由排期工具算出后回填（建表时留空即可）。
- **一个 base 放多表**：同一 base/工作簿里并列建这几张表；工具按表名识别（任务表 / 资源表 / 外包单表 / 项目表 / 模板表）。
- **产能语义**：资源表 `类型=person` 产能常为 1（主美/绑定等瓶颈岗）；`vendor` 产能=可并发接单数（外包）。

## 五张表

### 1. 项目表（1 行）
| 列 | 类型 | 说明 | → bpt-pm/v1 |
|----|------|------|-------------|
| 项目名 | 文本 | | `project.name` |
| 起算日 | 日期 YYYY-MM-DD | 排期锚点 | `project.start` |
| 调度方向 | `start`/`finish` | 缺省 start；finish=从完成日倒排 | `project.scheduleFrom` |
| 完成日 | 日期 | 倒排锚点（调度方向=finish 时） | `project.finish` |
| 工作日 | 空格分隔 ISO 星期号 | 如 `1 2 3 4 5` | `project.calendar.workdays` |
| 节假日 | 空格分隔日期 | 如 `2026-07-20` | `project.calendar.holidays` |

### 2. 任务表（每行一任务）
| 列 | 类型 | 说明 | → bpt-pm/v1 |
|----|------|------|-------------|
| 任务ID | 文本 | 全项目唯一，供前置/上级引用 | `id` |
| 名称 | 文本 | | `name` |
| 工期 | 数字 | 工作日；0=里程碑 | `duration` |
| 前置依赖 | 文本 | 迷你语法 `T1, T2SS+2, T3FF-1`（FS/SS/FF/SF+延时） | `predecessors` |
| 约束 | 文本 | `SNET 2026-07-23` / `MSO` / `ALAP` / `SNLT` / `FNET` / `FNLT` / `MFO` / 空=ASAP | `constraint` |
| 资源 | 文本 | **排期占用键**：引用资源表的资源ID；驱动冲突/错峰/负载。占用者可能是外包 vendor，不等于问责人 | `resource` |
| 负责人 | 文本 | 可选。**问责人**（纯元数据，引擎不参与排期占用）。与「资源」两义正交、不合一 | `owner` |
| 进度 | 数字 0–100 | | `percentComplete` |
| 截止 | 日期 | 软截止线（不移动任务，仅算误期） | `deadline` |
| 上级 | 文本 | WBS 父任务的任务ID（构成层级；被引用者=摘要） | `parent` |
| **计算开始** | 日期 | 写回 | 排期产出 |
| **计算结束** | 日期 | 写回 | 排期产出 |
| **松弛** | 数字 | 写回：总浮动（工作日，0=临界） | 排期产出 |
| **自由浮动** | 数字 | 写回：不连累后继的可拖天数 | 排期产出 |
| **临界** | 布尔 | 写回：是否在关键路径 | 排期产出 |
| **误期** | 数字 | 写回：相对截止的误期工作日（>0 误期） | 排期产出 |

### 3. 资源表（每行一资源）
| 列 | 类型 | 说明 | → bpt-pm/v1 |
|----|------|------|-------------|
| 资源ID | 文本 | 任务表「资源」列引用它 | `id` |
| 名称 | 文本 | | `name` |
| 类型 | `person`/`vendor` | | `type` |
| 产能 | 数字 ≥1 | 并发承载数；人=1、外包=N | `capacity` |

### 4. 外包单表（每行一发单）
| 列 | 类型 | 说明 | → bpt-pm/v1 |
|----|------|------|-------------|
| 单号 | 文本 | | `orders[].id` |
| 供应商 | 文本 | 引用资源表中 vendor 的资源ID | `vendor` |
| 资产 | 文本 | | `asset` |
| PO日 | 日期 | 发单日 | `poDate` |
| 预计交付 | 日期 | | `expectedDelivery` |
| 实际交付 | 日期 | | `actualDelivery` |
| 返修轮次 | 数字 | | `revisionRounds` |
| 状态 | 枚举 | 待发/已发/画中/回稿/内审/返修/已验收/入库 | `status` |
| 关联任务 | 文本 | 任务ID（该发单对应的排期任务） | `linkedTaskId` |
| **交付风险** | 布尔 | 写回：排期结束晚于预计交付 | 排期产出 |

### 5. 模板表（每行一「模板×阶段」，可选）
流水线模板扁平化：一个模板多行，按「阶段序」排。工具据此把模板一键实例化成任务链（含返修回环）。
| 列 | 类型 | 说明 |
|----|------|------|
| 模板ID / 模板名 | 文本 | 同模板多行共用 |
| 阶段序 | 数字 | 阶段顺序（1,2,3…），决定 FS 串接 |
| 阶段键 / 阶段名 | 文本 | 生成任务 id/名用 |
| 工期 | 数字 | 阶段主任务工期 |
| 资源 | 文本 | 阶段主任务资源 |
| 依赖类型 / 延时 | `FS`… / 数字 | 接上一阶段的依赖类型与延时 |
| 返修轮次 | 数字 | >0 时插入 N 轮「审核+返修」 |
| 返修资源 / 返修工期 | 文本 / 数字 | 返修回环参数 |

## 迷你语法速查

- **前置依赖**：`T1`（默认 FS+0）、`T2SS+2`、`T3FF-1`、`T4SF`；多个逗号分隔。
- **约束**：`SNET 日期`（不早于开始）、`SNLT 日期`（不晚于开始）、`FNET/FNLT 日期`（不早/晚于结束）、
  `MSO/MFO 日期`（必须某日开始/结束，硬）、`ALAP`（尽量晚）、空=`ASAP`（尽量早）。

## 跨线收敛约定（2026-07-05，正主 projects/bpt-pm ↔ BIAV-SC table-v1）

两条独立实现（正主：钉钉 AI 表格为源、shell 启动；本线：table-v1）在资源冲突/外包发单上自然收敛到同一设计。
以下为对齐结论，`table-v1` 列名为**规范名**，双方各自 fieldMap 认对方别名。

### 列名别名（双向 blessed，fieldMap 单一真相源）
| 概念 | table-v1 规范名 | 正主别名 |
|------|----------------|---------|
| WBS 上级 | 上级 | 父任务 |
| 写回·关键路径 | 临界 | 关键路径 |
| 外包发单日 | PO日 | 发单日 |
| 外包关联任务 | 关联任务 | 关联任务（已同名） |

### 四点定夺
1. **任务「资源」两义不合一**：`资源`=排期占用键（驱动冲突/错峰/负载，可为 vendor）；`负责人`=可选问责人（引擎忽略）。
   排期只认「资源」；问责走「负责人」。占用资源 ≠ 问责人（外包建模占 vendor 产能，但问责人常是内部制作人）。
2. **写回统一 `误期`（数字，误期工作日天数）**为规范。布尔「超期」= 派生别名（`误期 > 0`）；信息量更高，正主引擎补输出天数。
3. **约束：协议保留全 8 型，引擎能力分层 + 优雅降级**。
   - 保证互通的最低集 = **SNET 子集**（≈ earliestStart），双方现均支持。
   - 不支持的约束类型（SNLT/FNET/FNLT/MFO/ALAP）由引擎**忽略 + 告警**，绝不误排——协议不因某引擎能力弱而被砍。
   - **更强收敛（建议）**：直接共享引擎 `scripts/schedule.mjs`（零依赖 ES 模块，纯函数导出
     `scheduleProject`/`suggestLeveling`/`instantiateTemplate`/`analyzeOrders`/`computeResourceLoad`）。
     正主 import/vendor 它，即一次性抹平约束/错峰/WBS/倒排/模板全部能力差；此后各线只维护「数据源适配器 + UI」。
4. **项目表必读、模板表可选**：起算日/节假日/工作日历直接决定所有日期，任何引擎都应读**项目表**
   （UI 手选起算日不够——漏节假日会算错工期）。**模板表→任务链（含返修回环）**若采纳 schedule.mjs 则经
   `instantiateTemplate` 免费得到；否则暂由 table-v1 线负责。

## 与数据源适配器的关系

- 本协议只定义**表长什么样**；「怎么读写某个具体 base」由各数据源适配器实现——
  Notion 见 `docs/notion-adapter.md` + `proxy/server.mjs`；阿里 AI 表格 / 飞书多维表同理（按上表列名建表即可对接）。
- 排期算法唯一真相在 `scripts/schedule.mjs`（与 `index.html` 内联版同算法）；适配器只做「表 ↔ bpt-pm/v1 JSON」翻译。

## 生成器 `scripts/gen_tables.mjs`

```bash
node scripts/gen_tables.mjs --blank                       # 5 张空表模板（建新格式）
node scripts/gen_tables.mjs data/sample-content-team.json # 填好样例的 CSV（可直接导入 base）
node scripts/gen_tables.mjs <in.json> --json              # 摊平表以 JSON 打到 stdout
node scripts/gen_tables.mjs <in.json> --out <dir>         # 指定输出目录（缺省 Public-Info-Pool/Rough/bpt-pm-tables/）
```
