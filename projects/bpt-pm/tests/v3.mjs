#!/usr/bin/env node
/* v3 单测（纯 Node，import 引擎）：①引擎完备性 ②资源错峰 ③WBS ④告警。
   不变量断言，任一 FAIL 置 process.exitCode=1。运行：node projects/bpt-pm/tests/v3.mjs */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scheduleProject, suggestLeveling, WorkCalendar } from "../scripts/schedule.mjs";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const load = f => JSON.parse(fs.readFileSync(path.join(__dir, "..", "data", f), "utf8"));
const clone = o => JSON.parse(JSON.stringify(o));
const v3 = load("sample-v3.json");
const ct = load("sample-content-team.json");
let fails = 0;
const assert = (name, cond) => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}`); if (!cond) { fails++; process.exitCode = 1; } };
const T = (res, id) => res.tasks.find(t => t.id === id);

// ---------- ① 自由浮动 ----------
console.log("== ① 自由浮动 ==");
const r0 = scheduleProject(v3);
assert("所有 freeSlack ≥ 0（叶）", r0.tasks.filter(t => !t.isSummary).every(t => t.freeSlack >= 0));
assert("freeSlack ≤ totalSlack（Y1）", T(r0, "Y1").freeSlack <= T(r0, "Y1").slack);
assert("末端 Y3 freeSlack==totalSlack==1", T(r0, "Y3").freeSlack === 1 && T(r0, "Y3").slack === 1);

// ---------- ① 约束补全 ----------
console.log("== ① 约束（SNET/MSO/ALAP）==");
const cal = new WorkCalendar(v3.project.start, v3.project.calendar);
const snet = clone(v3); snet.tasks.find(t => t.id === "Y1").constraint = { type: "SNET", date: "2026-07-09" };
assert("SNET 抬 Y1 开始到 2026-07-09", T(scheduleProject(snet), "Y1").start === "2026-07-09");
const mso = clone(v3); mso.tasks.find(t => t.id === "Y1").constraint = { type: "MSO", date: "2026-07-08" };
assert("MSO 钉死 Y1 开始==2026-07-08", T(scheduleProject(mso), "Y1").start === "2026-07-08");
const alap = clone(v3); alap.tasks.find(t => t.id === "Y3").constraint = { type: "ALAP" };
{ const r = scheduleProject(alap); const y3 = T(r, "Y3"); assert("ALAP 令 Y3 浮到最晚（总浮动→0）", y3.slack === 0 && y3.start === "2026-07-14"); }

// ---------- ① 从完成日倒排 ----------
console.log("== ① 倒排 scheduleFrom=finish ==");
const bw = clone(v3); bw.project.scheduleFrom = "finish"; bw.project.finish = "2026-07-24";
{ const r = scheduleProject(bw); assert("倒排无告警", r.warningCount === 0); assert("倒排完工落在 project.finish=2026-07-24", r.completion === "2026-07-24"); }
const bwBad = clone(v3); bwBad.project.scheduleFrom = "finish"; bwBad.project.finish = "2026-07-08";
assert("倒排窗口过早触发 infeasible-window 告警", scheduleProject(bwBad).warnings.some(w => w.type === "infeasible-window"));

// ---------- ② 资源错峰建议 ----------
console.log("== ② 资源错峰 ==");
const rct = scheduleProject(ct);
const cal2 = new WorkCalendar(ct.project.start, ct.project.calendar);
const lev = suggestLeveling(rct.leaves, ct.resources, cal2);
assert("错峰后残余超载==0（content-team 可解）", lev.residualOverloads.length === 0);
assert("错峰至少移动 1 个任务", lev.movedCount >= 1);
// 独立复核：建议表按资源逐日并发 ≤ capacity
{
  const capOf = id => { const r = (ct.resources || []).find(x => x.id === id); return r ? Math.max(1, r.capacity || 1) : 1; };
  const byRes = {};
  for (const s of lev.suggested) {
    const t = rct.leaves.find(x => x.id === s.id); if (!t || t.dur <= 0 || !t.resource) continue;
    const a = cal2.toIndex(s.start); const b = a + t.dur;
    (byRes[t.resource] ||= []).push([a, b, capOf(t.resource)]);
  }
  let ok = true;
  for (const [res, ivs] of Object.entries(byRes)) {
    const cap = ivs[0][2];
    const lo = Math.min(...ivs.map(x => x[0])), hi = Math.max(...ivs.map(x => x[1]));
    for (let d = lo; d < hi; d++) { const load = ivs.filter(x => x[0] <= d && d < x[1]).length; if (load > cap) { ok = false; } }
  }
  assert("建议表中同资源逐日并发≤产能", ok);
}

// ---------- ③ WBS 卷积 ----------
console.log("== ③ WBS 卷积 ==");
const sx = T(r0, "SUM_X");
assert("SUM_X isSummary", sx.isSummary === true);
assert("SUM_X.start==min(子 start)", sx.start === "2026-07-06");
assert("SUM_X.finish==max(子 finish)==2026-07-14", sx.finish === "2026-07-14");
assert("叶任务 depth≥1", T(r0, "X1").depth >= 1);
assert("摘要 depth==0", sx.depth === 0);
assert("向后兼容：content-team 零摘要", rct.tasks.every(t => !t.isSummary));

// ---------- ④ 告警 ----------
console.log("== ④ 告警 ==");
assert("正常 sample-v3 warningCount==0", r0.warningCount === 0);
const conflict = {
  protocol: "bpt-pm/v1", project: { name: "冲突", start: "2026-07-06" },
  tasks: [
    { id: "A", name: "A", duration: 5 },
    { id: "B", name: "B", duration: 1, predecessors: [{ id: "A" }], constraint: { type: "MSO", date: "2026-07-07" } },
  ],
};
assert("MSO 与前置矛盾触发 constraint-conflict", scheduleProject(conflict).warnings.some(w => w.type === "constraint-conflict"));

console.log(fails ? `\n${fails} 项失败。` : "\nv3 ①②③④ 全部通过。");
