#!/usr/bin/env node
/* 代理 HTTP 层端到端测试（纯 Node，无外部依赖）：
   桩 Notion API + 真实 proxy/server.mjs，验证 GET /tasks 与 POST /writeback 契约。
   运行：node projects/bpt-pm/tests/proxy_e2e.mjs   （退出码 0=通过）*/
import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dir, "..", "proxy", "server.mjs");

function mk(id, name, dur, preds, con, res, pct, base) {
  return {
    "任务名称": { title: [{ plain_text: name }] }, "任务ID": { rich_text: [{ plain_text: id }] },
    "工期": { number: dur }, "前置依赖": { rich_text: [{ plain_text: preds }] },
    "约束": { rich_text: [{ plain_text: con }] }, "资源": { rich_text: [{ plain_text: res }] },
    "进度": { number: pct }, "基线结束": { date: { start: base } },
  };
}
const store = {
  "pg-T1": mk("T1", "解包", 3, "", "", "艾瑞卡", 100, "2026-07-08"),
  "pg-T2": mk("T2", "补齐", 5, "T1", "", "艾瑞卡", 60, "2026-07-14"),
  "pg-T3": mk("T3", "校验", 2, "T1", "", "守密人", 100, "2026-07-10"),
  "pg-T4": mk("T4", "生成", 4, "T2, T3", "", "艾瑞卡", 0, "2026-07-21"),
  "pg-T5": mk("T5", "联调", 3, "T4", "SNET 2026-07-23", "艾瑞卡", 0, "2026-07-24"),
  "pg-M1": mk("M1", "里程碑", 0, "T5", "", "守密人", 0, "2026-07-27"),
};
const patched = [];

function assert(name, cond) { console.log(`${cond ? "PASS" : "FAIL"}  ${name}`); if (!cond) process.exitCode = 1; }

async function main() {
  // 桩 Notion
  const stub = http.createServer((req, res) => {
    let d = ""; req.on("data", c => d += c); req.on("end", () => {
      if (req.method === "POST" && /\/databases\/.+\/query/.test(req.url)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ results: Object.entries(store).map(([id, props]) => ({ id, properties: props })), has_more: false }));
      }
      const m = req.url.match(/\/pages\/(.+)$/);
      if (req.method === "PATCH" && m) { patched.push({ id: m[1], props: JSON.parse(d || "{}").properties }); res.writeHead(200); return res.end("{}"); }
      res.writeHead(404); res.end("{}");
    });
  });
  await new Promise(r => stub.listen(0, r));
  const stubPort = stub.address().port;

  const PORT = 8791;
  const proxy = spawn("node", [SERVER], {
    env: { ...process.env, NOTION_TOKEN: "secret_stub", NOTION_DATABASE_ID: "stubdb",
      NOTION_API_BASE: `http://127.0.0.1:${stubPort}`, PORT: String(PORT),
      PROJECT_START: "2026-07-06", PROJECT_WORKDAYS: "1,2,3,4,5", PROJECT_HOLIDAYS: "2026-07-20" },
    stdio: "ignore",
  });
  await new Promise(r => setTimeout(r, 700));
  const base = `http://127.0.0.1:${PORT}`;

  try {
    // 拉取
    const data = await (await fetch(base + "/tasks")).json();
    assert("protocol", data.protocol === "bpt-pm/v1");
    assert("tasks=6", data.tasks.length === 6);
    const t4 = data.tasks.find(t => t.id === "T4");
    assert("T4 preds=2", t4.predecessors.length === 2);
    assert("T5 constraint", data.tasks.find(t => t.id === "T5").constraint?.type === "SNET");
    assert("baseline mapped", data.baseline?.tasks?.T4?.finish === "2026-07-21");

    // 写回（模拟网页算好的结果）
    const results = [
      { id: "T1", start: "2026-07-06", finish: "2026-07-08", slack: 0, critical: true },
      { id: "T4", start: "2026-07-16", finish: "2026-07-22", slack: 0, critical: true },
      { id: "T3", start: "2026-07-09", finish: "2026-07-10", slack: 3, critical: false },
    ];
    const wb = await (await fetch(base + "/writeback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tasks: results }) })).json();
    assert("writeback updated=3", wb.updated === 3);
    assert("no missing", (wb.missing || []).length === 0);
    const t4p = patched.find(p => p.id === "pg-T4")?.props;
    assert("T4 计算开始", t4p?.["计算开始"]?.date?.start === "2026-07-16");
    assert("T4 临界", t4p?.["临界"]?.checkbox === true);
    const t3p = patched.find(p => p.id === "pg-T3")?.props;
    assert("T3 总浮动=3", t3p?.["总浮动"]?.number === 3);
    assert("T3 临界=false", t3p?.["临界"]?.checkbox === false);

    // CORS 预检
    const opt = await fetch(base + "/tasks", { method: "OPTIONS" });
    assert("CORS preflight", opt.headers.get("access-control-allow-origin") === "*");
  } finally {
    proxy.kill(); stub.close();
  }
  console.log(process.exitCode ? "\n部分失败。" : "\n代理端到端契约全部通过。");
}
main();
