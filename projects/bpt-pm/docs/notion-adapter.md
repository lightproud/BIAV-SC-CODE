# BPT PM × Notion 适配器

把 **Notion 数据库**当作 bpt-pm 的数据源：从 Notion 拉任务 → 跑 CPM 自动排期 →
把算出的开始/结束/浮动/临界写回 Notion。本文记录字段映射、工作流与实测踩坑。

> 实测状态（2026-07-05）：艾瑞卡已对真实工作区「唐 龙的工作空间」端到端跑通一次完整
> 读→排→写闭环（建库 + 6 任务 + 写回 + 抽验落库）。试跑库：**BPT PM 排期（试跑）**
> `https://app.notion.com/p/dbcfca53752d4ba79d59724e4ff0176a`（data source `collection://734f4055-9b45-4ebd-8bc4-a639fafb4b31`）。

## 架构：为什么需要适配器

`index.html` 是**纯静态单网页、零后端**，浏览器出于 CORS + 鉴权无法直接调 Notion API。
所以 Notion 不是被网页直连，而是经一个**适配器**在 Notion ↔ `bpt-pm/v1` JSON 之间搬运：

```
Notion 数据库  ──(拉取)──▶  bpt-pm/v1 JSON  ──▶  index.html（人工排期确认）
     ▲                          │
     └──────(写回)──────  schedule.mjs（CPM 引擎）
```

适配器的「执行者」有两种形态，取同一套映射：
1. **艾瑞卡 + Notion MCP**（本次实测用法）：会话内用 MCP 工具 `notion-fetch` / `notion-create-pages` /
   `notion-update-page` 读写，中间用 `projects/bpt-pm/scripts/schedule.mjs` 算排期。无需自建服务。
2. **带 Token 的脚本**（自动化用法）：用 Notion 官方 API + integration token 实现同样的拉取/写回，
   排期仍复用 `schedule.mjs`。适合脱离会话的定时同步。

排期算法**只有一处真相**：`scripts/schedule.mjs`（与 `index.html` 内联引擎同算法）。
适配器绝不重写 CPM，只做数据搬运与字段翻译。

## 字段映射（Notion 列 ↔ bpt-pm/v1）

Notion 数据库建库 DDL 见本仓 `docs/notion-adapter.md` 顶部实测库；列与协议字段对应如下：

| Notion 列 | 类型 | bpt-pm/v1 字段 | 方向 | 说明 |
|-----------|------|----------------|------|------|
| 任务名称 | title | `name` | 拉取 | 标题列 |
| 任务ID | text | `id` | 拉取 | 全项目唯一，供依赖引用 |
| 工期 | number | `duration` | 拉取 | 工作日；0=里程碑 |
| 前置依赖 | text | `predecessors` | 拉取 | 迷你语法 `T1, T2SS+2, T3FF-1`，适配器 `parsePreds` 展开 |
| 约束 | text | `constraint` | 拉取 | `ASAP` / `SNET 2026-07-23` / `MSO 2026-07-10` |
| 资源 | text | `resource` | 拉取 | 负责人 |
| 进度 | number | `percentComplete` | 拉取 | 0–100 |
| 基线结束 | date | `baseline.tasks[id].finish` | 拉取 | 基线快照，供偏差比对 |
| 计算开始 | date | 计算结果 `start` | **写回** | 排期产出 |
| 计算结束 | date | 计算结果 `finish` | **写回** | 排期产出 |
| 总浮动 | number | 计算结果 `slack` | **写回** | 工作日；0=临界 |
| 临界 | checkbox | 计算结果 `critical` | **写回** | 是否在关键路径 |

**项目级配置**（`project.start` 锚点日期 + `calendar` 工作日历）不属单行任务，Notion 库里没有
天然落点。约定放在**数据库描述**或一条独立「项目配置」页，拉取时由适配器读出；本次实测中
由适配器直接注入（start=2026-07-06，holidays=[2026-07-20]）。

## 工作流（读→排→写）

1. **拉取**：逐页 `notion-fetch` 读任务行 → 按上表翻译成 `bpt-pm/v1` JSON（`前置依赖`/`约束` 文本经
   `parsePreds`/`parseConstraint` 展开）。
2. **排期**：`cat pulled.json | node projects/bpt-pm/scripts/schedule.mjs` → 得每任务 `start/finish/slack/critical` + 总工期。
   （或在 `index.html` 里可视化确认、设基线、看甘特图。）
3. **写回**：对每个任务页 `notion-update-page`（`update_properties`）写 `计算开始`/`计算结束`/`总浮动`/`临界`。

## 实测踩坑（4 条，附小学生比喻）

1. **批量读被计费墙拦**：`query-data-sources`（SQL/视图查询）需 Business 版 + Notion AI，本工作区没有。
   → 改走**逐页 `fetch`**（用建库/创建时拿到的 page id 挨个读）。比喻：不能一次性把整柜档案倒出来，
   但每个抽屉贴了编号、可以一个一个抽。
2. **个人主页不能装数据库**：`personal_home_page` 父级建库报 `cannot contain databases`。
   → 建在**工作区顶层**（省略 parent）或普通页面下。比喻：卧室（个人主页）不让摆大货架，得搬到客厅。
3. **日期列要拆三段**：写日期不是 `计算开始="..."`，而是 `date:计算开始:start` / `:end` / `:is_datetime`。
   比喻：填日期不是写一格，而是「起、止、含不含钟点」三个小格分开填。
4. **列名 `id`/`url` 有保留冲突**：若列真叫 `id`/`url`，更新时要写 `userDefined:id`。故本库用「任务ID」避雷。
   复选框写 `__YES__`/`__NO__`，不是 true/false。比喻：柜子上「编号」这个词是保安专用暗号，自己贴标签得换个说法。

## 复现命令

```bash
# 排期（把拉取好的 bpt-pm/v1 JSON 喂给调度器）
cat pulled.json | node projects/bpt-pm/scripts/schedule.mjs
```

拉取与写回经 Notion MCP 工具进行（会话内由艾瑞卡执行），或用带 token 的脚本复刻同一映射。
