#!/usr/bin/env node
/* 资源负载 + 超载检测单测（纯 Node，import 引擎）。
   运行：node projects/bpt-pm/tests/resource_load.mjs   （退出码 0=通过）*/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scheduleProject } from "../scripts/schedule.mjs";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.join(__dir, "..", "data", "sample-content-team.json"), "utf8"));
const res = scheduleProject(data);
const R = Object.fromEntries(res.resources.map(r => [r.id, r]));

function assert(name, cond) { console.log(`${cond ? "PASS" : "FAIL"}  ${name}`); if (!cond) process.exitCode = 1; }

assert("资源数=4", res.resources.length === 4);

// 主美（产能1）：07-08 X2+Y2 撞车 → 超载
const zm = R["主美"];
assert("主美 峰值=2", zm.peakLoad === 2);
assert("主美 超载1段", zm.overloads.length === 1);
assert("主美 超载日=07-08", zm.overloads[0]?.start === "2026-07-08" && zm.overloads[0]?.end === "2026-07-08");
assert("主美 冲突任务=X2,Y2", ["X2", "Y2"].every(t => zm.overloads[0]?.tasks.includes(t)));

// 原画（产能1）：07-06..07-07 X1+Y1 → 超载
const yh = R["原画"];
assert("原画 超载 07-06..07-07", yh.overloads[0]?.start === "2026-07-06" && yh.overloads[0]?.end === "2026-07-07");
assert("原画 冲突任务=X1,Y1", ["X1", "Y1"].every(t => yh.overloads[0]?.tasks.includes(t)));

// 外包A（产能2）：峰值2 = 满载但不超载（外包并发吸收）
const wb = R["外包A"];
assert("外包A 峰值=2", wb.peakLoad === 2);
assert("外包A 无超载（产能2吸收）", wb.overloads.length === 0);
assert("外包A 类型=vendor", wb.type === "vendor");

// 程序（产能1）：07-15..07-16 X4+Y4 → 超载
const cx = R["程序"];
assert("程序 超载 07-15..07-16", cx.overloads[0]?.start === "2026-07-15" && cx.overloads[0]?.end === "2026-07-16");

// 全局：3 个资源超载
const overCount = res.resources.filter(r => r.overloads.length).length;
assert("超载资源数=3", overCount === 3);

console.log(process.exitCode ? "\n部分失败。" : "\n资源负载 + 超载检测全部通过。");
