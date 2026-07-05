#!/usr/bin/env node
/* ==========================================================================
   BPT PM — 本地 Notion 代理（零依赖，Node 18+）
   为什么需要它：index.html 是纯静态页，浏览器出于 CORS + 令牌暴露无法直连
   Notion。本代理持 token 跑在 localhost，替网页去 Notion REST API 办事：
     GET  /tasks      —— 从 Notion 数据库拉任务 → 返回 bpt-pm/v1 JSON
     POST /writeback  —— 把网页算出的开始/结束/浮动/临界写回 Notion 各页
   token 只待在本地 .env，绝不进浏览器、绝不进仓库（.gitignore 已挡）。
   Notion 官方 REST 的 databases.query 不分套餐可用（会员墙只在 MCP 侧）。

   用法：
     cp .env.example .env  &&  填 NOTION_TOKEN / NOTION_DATABASE_ID
     node server.mjs              # 起在 http://localhost:8787
     node server.mjs --selftest   # 离线自测映射逻辑（不连网）
   ========================================================================== */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));

/* ---------- 读 .env（极简，无需 dotenv） ---------- */
function loadEnv() {
  const p = path.join(__dir, ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const NOTION_TOKEN = process.env.NOTION_TOKEN || "";
const DB_ID = (process.env.NOTION_DATABASE_ID || "").replace(/-/g, "");
const PORT = Number(process.env.PORT || 8787);
const NOTION_VERSION = "2022-06-28";
// 项目级配置（Notion 单行任务放不下，经环境注入）
const PROJECT = {
  name: process.env.PROJECT_NAME || "Notion 排期",
  start: process.env.PROJECT_START || new Date().toISOString().slice(0, 10),
  calendar: {
    workdays: (process.env.PROJECT_WORKDAYS || "1,2,3,4,5").split(",").map(Number).filter(Boolean),
    holidays: (process.env.PROJECT_HOLIDAYS || "").split(",").map(s => s.trim()).filter(Boolean),
  },
};

/* ---------- Notion 属性读写辅助 ---------- */
const readTitle = p => (p?.title || []).map(t => t.plain_text).join("") || "";
const readText = p => (p?.rich_text || []).map(t => t.plain_text).join("") || "";
const readNum = p => (p?.number ?? null);
const readDate = p => (p?.date?.start || null);
const readCheck = p => !!(p?.checkbox);

/* ---------- Notion 页 → bpt-pm/v1 任务 ---------- */
function parsePreds(str) {
  if (!str || !str.trim()) return [];
  return str.split(/[,;，；]/).map(s => s.trim()).filter(Boolean).map(tok => {
    let m = tok.match(/([+-]\s*\d+)\s*$/); let lag = 0;
    if (m) { lag = parseInt(m[1].replace(/\s+/g, ""), 10); tok = tok.slice(0, m.index).trim(); }
    m = tok.match(/(FS|SS|FF|SF)$/i); let type = "FS";
    if (m) { type = m[1].toUpperCase(); tok = tok.slice(0, m.index).trim(); }
    return { id: tok, type, lag };
  }).filter(p => p.id);
}
function parseConstraint(str) {
  if (!str || !str.trim()) return null;
  const m = str.trim().match(/^(ASAP|SNET|MSO)\s*(\d{4}-\d{2}-\d{2})?$/i);
  if (!m) return null;
  const type = m[1].toUpperCase();
  if (type === "ASAP") return null;
  return { type, date: m[2] || null };
}
function pageToTask(page) {
  const P = page.properties;
  const id = readText(P["任务ID"]);
  const t = {
    id, name: readTitle(P["任务名称"]),
    duration: readNum(P["工期"]) ?? 1,
    predecessors: parsePreds(readText(P["前置依赖"])),
    resource: readText(P["资源"]),
    percentComplete: readNum(P["进度"]) ?? 0,
    _pageId: page.id,
    _baselineFinish: readDate(P["基线结束"]),
  };
  const c = parseConstraint(readText(P["约束"]));
  if (c) t.constraint = c;
  return t;
}
function pagesToProject(pages) {
  const tasks = pages.map(pageToTask).filter(t => t.id);
  const baselineTasks = {};
  let hasBaseline = false;
  for (const t of tasks) {
    if (t._baselineFinish) { hasBaseline = true; baselineTasks[t.id] = { start: t._baselineFinish, finish: t._baselineFinish }; }
    delete t._baselineFinish; delete t._pageId;
  }
  const data = { protocol: "bpt-pm/v1", project: PROJECT, tasks };
  if (hasBaseline) data.baseline = { capturedAt: "notion", tasks: baselineTasks };
  return data;
}

/* ---------- Notion REST 调用 ---------- */
const API_BASE = process.env.NOTION_API_BASE || "https://api.notion.com/v1"; // 可注入，仅供离线测试指向桩服务
async function notion(method, urlPath, body) {
  const res = await fetch(API_BASE + urlPath, {
    method,
    headers: {
      "Authorization": "Bearer " + NOTION_TOKEN,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Notion ${method} ${urlPath} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}
async function queryAllPages() {
  const pages = []; let cursor = undefined;
  do {
    const body = cursor ? { start_cursor: cursor, page_size: 100 } : { page_size: 100 };
    const r = await notion("POST", `/databases/${DB_ID}/query`, body);
    pages.push(...r.results); cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return pages;
}

/* ---------- 写回：网页计算结果 → Notion 页属性 ---------- */
async function writeback(results) {
  const pages = await queryAllPages();
  const byTaskId = new Map();
  for (const pg of pages) { const tid = readText(pg.properties["任务ID"]); if (tid) byTaskId.set(tid, pg.id); }
  let updated = 0; const missing = [];
  for (const r of results) {
    const pageId = byTaskId.get(r.id);
    if (!pageId) { missing.push(r.id); continue; }
    const props = {
      "计算开始": { date: r.start ? { start: r.start } : null },
      "计算结束": { date: r.finish ? { start: r.finish } : null },
      "总浮动": { number: (r.slack ?? null) },
      "临界": { checkbox: !!r.critical },
    };
    await notion("PATCH", `/pages/${pageId}`, { properties: props });
    updated++;
  }
  return { updated, missing };
}

/* ---------- HTTP 服务 ---------- */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
function send(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", ...CORS });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = ""; req.on("data", c => { d += c; if (d.length > 5e6) req.destroy(); });
    req.on("end", () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

function startServer() {
  if (!NOTION_TOKEN || !DB_ID) {
    console.error("缺少 NOTION_TOKEN 或 NOTION_DATABASE_ID —— 请复制 .env.example 为 .env 并填写。");
    process.exit(1);
  }
  http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }
    try {
      const url = new URL(req.url, "http://x");
      if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true, db: DB_ID });
      if (req.method === "GET" && url.pathname === "/tasks") {
        const pages = await queryAllPages();
        return send(res, 200, pagesToProject(pages));
      }
      if (req.method === "POST" && url.pathname === "/writeback") {
        const body = await readBody(req);
        const results = Array.isArray(body) ? body : (body.tasks || []);
        return send(res, 200, await writeback(results));
      }
      return send(res, 404, { error: "未知路由。可用：GET /health, GET /tasks, POST /writeback" });
    } catch (e) {
      return send(res, 500, { error: String(e.message || e) });
    }
  }).listen(PORT, () => {
    console.log(`BPT PM Notion 代理已就绪 → http://localhost:${PORT}`);
    console.log(`  数据库 ${DB_ID}｜项目锚点 ${PROJECT.start}｜工作日 [${PROJECT.calendar.workdays}]`);
    console.log(`  GET /tasks 拉取｜POST /writeback 写回｜GET /health 健康检查`);
  });
}

/* ---------- 离线自测：映射逻辑不连网 ---------- */
function selftest() {
  const fixture = [{
    id: "page-t4", properties: {
      "任务名称": { title: [{ plain_text: "生成 VitePress 角色页" }] },
      "任务ID": { rich_text: [{ plain_text: "T4" }] },
      "工期": { number: 4 },
      "前置依赖": { rich_text: [{ plain_text: "T2, T3SS+1" }] },
      "约束": { rich_text: [{ plain_text: "SNET 2026-07-23" }] },
      "资源": { rich_text: [{ plain_text: "艾瑞卡" }] },
      "进度": { number: 0 },
      "基线结束": { date: { start: "2026-07-21" } },
    },
  }];
  const proj = pagesToProject(fixture);
  const t = proj.tasks[0];
  const checks = [
    ["protocol", proj.protocol === "bpt-pm/v1"],
    ["id", t.id === "T4"],
    ["name", t.name === "生成 VitePress 角色页"],
    ["duration", t.duration === 4],
    ["preds.len", t.predecessors.length === 2],
    ["preds.T3.type", t.predecessors[1].type === "SS"],
    ["preds.T3.lag", t.predecessors[1].lag === 1],
    ["constraint", t.constraint?.type === "SNET" && t.constraint.date === "2026-07-23"],
    ["resource", t.resource === "艾瑞卡"],
    ["baseline", proj.baseline?.tasks?.T4?.finish === "2026-07-21"],
  ];
  let ok = true;
  for (const [name, pass] of checks) { console.log(`${pass ? "PASS" : "FAIL"}  ${name}`); if (!pass) ok = false; }
  console.log(ok ? "\n自测通过：Notion → bpt-pm/v1 映射正确。" : "\n自测失败。");
  process.exit(ok ? 0 : 1);
}

if (process.argv.includes("--selftest")) selftest();
else startServer();

export { pagesToProject, pageToTask, parsePreds, parseConstraint };
