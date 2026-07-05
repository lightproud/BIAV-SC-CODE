#!/usr/bin/env node
/* 表格生成器 gen_tables.mjs 单测（纯 Node）。运行：node projects/bpt-pm/tests/tables.mjs */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const GEN = path.join(__dir, "..", "scripts", "gen_tables.mjs");
const SAMPLE = path.join(__dir, "..", "data", "sample-content-team.json");
let fails = 0;
const assert = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) { fails++; process.exitCode = 1; } };

const seeded = JSON.parse(execFileSync("node", [GEN, SAMPLE, "--json"], { encoding: "utf8" }));
assert("protocol==bpt-pm/table-v1", seeded.protocol === "bpt-pm/table-v1");
assert("五张表齐全", ["项目表", "任务表", "资源表", "外包单表", "模板表"].every(k => k in seeded.tables));
assert("项目表 1 行", seeded.tables["项目表"].length === 1);
assert("任务表 9 行", seeded.tables["任务表"].length === 9);
assert("资源表 4 行", seeded.tables["资源表"].length === 4);
assert("外包单表 2 行", seeded.tables["外包单表"].length === 2);
assert("模板表 4 行（art 4 阶段）", seeded.tables["模板表"].length === 4);
// 列名协议
const rt = seeded.tables["资源表"][0];
assert("资源表列: 资源ID/名称/类型/产能", ["资源ID", "名称", "类型", "产能"].every(c => c in rt));
assert("资源表 外包A 产能2 vendor", seeded.tables["资源表"].some(r => r["资源ID"] === "外包A" && r["产能"] === 2 && r["类型"] === "vendor"));
// 前置迷你语法摊平
const t4 = seeded.tables["任务表"].find(r => r["任务ID"] === "X4");
assert("任务表 X4 前置=X3", t4 && t4["前置依赖"] === "X3");
// 写回列建表时为空
assert("写回列(计算开始)建表留空", seeded.tables["任务表"].every(r => r["计算开始"] === ""));

// 空表模板：五张表 0 行
const blank = JSON.parse(execFileSync("node", [GEN, "--blank", "--json"], { encoding: "utf8" }));
assert("空表模板五张表均 0 行", Object.values(blank.tables).every(v => v.length === 0));

console.log(fails ? `\n${fails} 项失败。` : "\n表格生成器全部通过。");
