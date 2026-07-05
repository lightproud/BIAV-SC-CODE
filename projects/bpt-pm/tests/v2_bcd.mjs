#!/usr/bin/env node
/* v2 三特性（B 周期守护 / C 流水线模板 / D 外包发单）单测（纯 Node，import 引擎）。
   运行：node projects/bpt-pm/tests/v2_bcd.mjs   （退出码 0=通过）
   与网页内联引擎同算法：仅走 scripts/schedule.mjs 导出的三个纯函数。*/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scheduleProject, instantiateTemplate, analyzeOrders } from "../scripts/schedule.mjs";

const __dir = path.dirname(fileURLToPath(import.meta.url));
function assert(name, cond) { console.log(`${cond ? "PASS" : "FAIL"}  ${name}`); if (!cond) process.exitCode = 1; }

// ---------- B 周期守护：deadline 软截止叠加 ----------
const data = JSON.parse(fs.readFileSync(path.join(__dir, "..", "data", "sample-content-team.json"), "utf8"));
const res = scheduleProject(data);
const T = Object.fromEntries(res.tasks.map(t => [t.id, t]));

console.log("== B 周期守护 ==");
assert("M1 late===true", T["M1"]?.late === true);
assert("M1 lateDays===1", T["M1"]?.lateDays === 1);
assert("X4 late===false", T["X4"]?.late === false);
assert("顶层 lateCount>=1", res.lateCount >= 1);

// ---------- C 流水线模板 + 返修回环 ----------
console.log("== C 流水线模板 ==");
const artTemplate = {
  id: "art", name: "角色美术流水线",
  stages: [
    { key: "concept", name: "概念草图", duration: 2, resource: "原画" },
    { key: "review", name: "原画终审", duration: 1, resource: "主美" },
    { key: "model", name: "建模（外包）", duration: 4, resource: "外包A", revisionRounds: 1, revisionResource: "主美", revisionDuration: 2 },
    { key: "integrate", name: "引擎接入", duration: 2, resource: "程序" },
  ],
};
const gen = instantiateTemplate(artTemplate, { prefix: "Z", assetName: "角色Z" });
const G = Object.fromEntries(gen.map(t => [t.id, t]));
const wantIds = ["Z_concept", "Z_review", "Z_model", "Z_model_审1", "Z_model_返1", "Z_integrate"];
wantIds.forEach(id => assert(`含任务 ${id}`, !!G[id]));
const integratePreds = (G["Z_integrate"]?.predecessors || []).map(p => p.id);
assert("Z_integrate 依赖 Z_model_返1", integratePreds.length === 1 && integratePreds[0] === "Z_model_返1");
assert("Z_model_审1.resource===主美", G["Z_model_审1"]?.resource === "主美");
assert("Z_model_返1.duration===2", G["Z_model_返1"]?.duration === 2);
assert("首阶段 Z_concept 无前置", (G["Z_concept"]?.predecessors || []).length === 0);
const reviewPreds = (G["Z_review"]?.predecessors || []).map(p => p.id);
assert("非返修阶段 Z_review FS 接 Z_concept", reviewPreds.length === 1 && reviewPreds[0] === "Z_concept");
assert("Z_model_审1 FS 接 Z_model", (G["Z_model_审1"]?.predecessors || [])[0]?.id === "Z_model");

// ---------- D 外包发单对象：交付风险 ----------
console.log("== D 外包发单 ==");
const orders = analyzeOrders(data.orders, res.tasks);
const O = Object.fromEntries(orders.map(o => [o.id, o]));
assert("PO-002.atRisk===true", O["PO-002"]?.atRisk === true);
assert("PO-001.atRisk===false", O["PO-001"]?.atRisk === false);
assert("顶层 ordersAtRisk===1", res.ordersAtRisk === 1);

console.log(process.exitCode ? "\n部分失败。" : "\nv2 B/C/D 全部通过。");
