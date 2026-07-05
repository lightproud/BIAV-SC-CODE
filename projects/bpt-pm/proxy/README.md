# BPT PM — 本地 Notion 代理

让 `index.html` 的「从 Notion 拉取 / 写回 Notion」按钮**直接生效**所需的极小后端。
浏览器出于 CORS + 令牌暴露无法直连 Notion，本代理持令牌跑在 `localhost`，替网页办事。

```
index.html ──http://localhost:8787──▶ server.mjs（持 token）──▶ Notion REST API
   ▲  从 Notion 拉取 / 写回 Notion 按钮                          databases.query / pages.PATCH
```

- **零依赖**：只用 Node 18+ 内置 `http` + `fetch`，无需 npm install。
- **令牌只在本地**：读 `proxy/.env`，绝不进浏览器、绝不进仓库（`.gitignore` 已挡 `.env`）。
- **不撞会员墙**：官方 REST 的 `databases.query` 所有套餐可用（Business 墙只在 Notion-AI-MCP 侧）。

## 一次性设置

1. **建集成拿令牌**：打开 <https://www.notion.so/my-integrations> → 新建「内部集成」→ 复制
   `secret_xxx` 令牌。
2. **把数据库共享给集成**：在目标数据库页面 `···` → 连接 → 选你的集成（否则 REST 读不到）。
3. **配置**：
   ```bash
   cd projects/bpt-pm/proxy
   cp .env.example .env
   # 编辑 .env：填 NOTION_TOKEN、NOTION_DATABASE_ID，按需改 PROJECT_START / 工作日 / 节假日
   ```

## 启动

```bash
node server.mjs               # 起在 http://localhost:8787
node server.mjs --selftest    # 离线自测 Notion→bpt-pm/v1 映射（不连网）
```

## 用法（网页侧）

1. 浏览器打开 `../index.html`。
2. 点「代理…」确认地址为 `http://localhost:8787`（存 localStorage，只需设一次）。
3. 点「**从 Notion 拉取**」→ 拉任务、自动排期、出甘特图。
4. 在网页里调整、设基线、复核。
5. 点「**写回 Notion**」→ 把 `计算开始 / 计算结束 / 总浮动 / 临界` 写回各任务页。

## 接口契约

| 方法 | 路由 | 作用 |
|------|------|------|
| GET | `/health` | 健康检查 → `{ok:true,db}` |
| GET | `/tasks` | 查库 → 返回 `bpt-pm/v1` JSON（含由「基线结束」列组的 baseline）|
| POST | `/writeback` | body `{tasks:[{id,start,finish,slack,critical}]}` → 按「任务ID」匹配页并 PATCH；返回 `{updated,missing}` |

字段映射见 `../docs/notion-adapter.md`。项目级配置（锚点日期 / 工作日历）在 `.env` 注入。

## 字段前提

数据库需含这些列（名称须一致）：`任务名称`(title)、`任务ID`(text)、`工期`(number)、
`前置依赖`(text)、`约束`(text)、`资源`(text)、`进度`(number)、`基线结束`(date)、
以及写回目标 `计算开始`(date)、`计算结束`(date)、`总浮动`(number)、`临界`(checkbox)。
试跑库 `dbcfca53752d4ba79d59724e4ff0176a` 已按此建好。

## 安全

- 令牌只在 `.env`（gitignored）与代理进程内存里；网页只经 `localhost` 说话，令牌不过浏览器。
- 代理默认 `Access-Control-Allow-Origin: *` 便于 `file://` 打开的网页访问——**仅本机自用**；
  勿把此代理暴露到公网。要托管公网访问请改走 Cloudflare Worker + Secret（本仓当前只实现本地形态）。

## 测试

- 映射逻辑：`node server.mjs --selftest`（离线）。
- 全链路（桩 Notion + 真 server + 浏览器）：见 `projects/bpt-pm/tests/`（如提供）或 CONTEXT.md 记录的 e2e 冒烟。
