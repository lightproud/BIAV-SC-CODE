#!/usr/bin/env node
/* ==========================================================================
   BPT PM — 表格格式生成器（bpt-pm/table-v1）
   把 bpt-pm/v1 JSON 摊平成「数据源无关」的多张标准表（任务/资源/外包单/项目/模板），
   或产出**空表模板**（只表头）用于在 阿里 AI 表格 / Notion / 飞书多维表 / Excel 里建新格式。
   列定义与「输入 vs 写回」标注见 docs/table-formats.md。

   用法：
     node gen_tables.mjs <input.json> [--out <dir>]   # 从 bpt-pm/v1 生成填好样例的 CSV+JSON
     node gen_tables.mjs --blank [--out <dir>]         # 只表头空表模板（建新格式用）
     node gen_tables.mjs <input.json> --json           # 摊平表以 JSON 打到 stdout（不写文件）
   缺省 --out：Public-Info-Pool/Rough/bpt-pm-tables/
   ========================================================================== */
import fs from "node:fs";
import path from "node:path";

// —— 表定义（bpt-pm/table-v1）：列名(中文,数据源无关) + 是否写回列 ——
// 写回列由排期工具算出后回填，建表时留空。
const TABLES = {
  "项目表": { cols: ["项目名", "起算日", "对外更新日期", "调度方向", "完成日", "工作日", "节假日"], writeback: [] },
  "任务表": {
    cols: ["任务ID", "名称", "工期", "前置依赖", "约束", "资源", "负责人", "进度", "父任务",
      "计算开始", "计算结束", "对外更新余量", "版本交付余量", "任务交付余量", "关键路径"],
    writeback: ["计算开始", "计算结束", "对外更新余量", "版本交付余量", "任务交付余量", "关键路径"],
  },
  "资源表": { cols: ["资源ID", "名称", "类型", "产能"], writeback: [] },
  "外包单表": {
    cols: ["单号", "供应商", "资产", "发单日", "预计交付", "实际交付", "返修轮次", "状态", "关联任务", "交付风险"],
    writeback: ["交付风险"],
  },
  "模板表": {
    cols: ["模板ID", "模板名", "阶段序", "阶段键", "阶段名", "工期", "资源", "依赖类型", "延时", "返修轮次", "返修资源", "返修工期"],
    writeback: [],
  },
};

// —— bpt-pm/v1 内部语法 → 单元格文本 ——
const predsToStr = preds => (preds || []).map(p => {
  let s = p.id; if (p.type && p.type !== "FS") s += p.type; if (p.lag) s += (p.lag > 0 ? "+" : "") + p.lag; return s;
}).join(", ");
const constraintToStr = c => (!c || !c.type || c.type === "ASAP") ? "" : c.type + (c.date ? " " + c.date : "");

// —— bpt-pm/v1 JSON → 各表行对象 ——
function toTables(data) {
  const t = {};
  const p = data.project || {};
  t["项目表"] = [{
    "项目名": p.name || "", "起算日": p.start || "", "对外更新日期": p.updateDate || "", "调度方向": p.scheduleFrom || "start",
    "完成日": p.finish || "", "工作日": (p.calendar?.workdays || [1, 2, 3, 4, 5]).join(" "),
    "节假日": (p.calendar?.holidays || []).join(" "),
  }];
  t["任务表"] = (data.tasks || []).map(x => ({
    "任务ID": x.id, "名称": x.name || "", "工期": x.duration ?? 1, "前置依赖": predsToStr(x.predecessors),
    "约束": constraintToStr(x.constraint), "资源": x.resource || "", "负责人": x.owner || "", "进度": x.percentComplete ?? 0,
    "父任务": x.parent || "",
    "计算开始": "", "计算结束": "", "对外更新余量": "", "版本交付余量": "", "任务交付余量": "", "关键路径": "",
  }));
  t["资源表"] = (data.resources || []).map(r => ({
    "资源ID": r.id, "名称": r.name || "", "类型": r.type || "person", "产能": r.capacity ?? 1,
  }));
  t["外包单表"] = (data.orders || []).map(o => ({
    "单号": o.id, "供应商": o.vendor || "", "资产": o.asset || "", "发单日": o.poDate || "",
    "预计交付": o.expectedDelivery || "", "实际交付": o.actualDelivery || "", "返修轮次": o.revisionRounds ?? "",
    "状态": o.status || "", "关联任务": o.linkedTaskId || "", "交付风险": "",
  }));
  t["模板表"] = (data.templates || []).flatMap(tp => (tp.stages || []).map((s, i) => ({
    "模板ID": tp.id, "模板名": tp.name || "", "阶段序": i + 1, "阶段键": s.key, "阶段名": s.name || "",
    "工期": s.duration ?? 1, "资源": s.resource || "", "依赖类型": s.type || "FS", "延时": s.lag ?? 0,
    "返修轮次": s.revisionRounds ?? 0, "返修资源": s.revisionResource || "", "返修工期": s.revisionDuration ?? "",
  })));
  return t;
}

// —— 行对象数组 → CSV（UTF-8 BOM，供 Excel/alidocs 正确识别中文）——
function toCsv(cols, rows) {
  const esc = v => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [cols.join(",")];
  for (const r of rows) lines.push(cols.map(c => esc(r[c])).join(","));
  return "﻿" + lines.join("\n") + "\n";
}

// —— 主流程 ——
const args = process.argv.slice(2);
const blank = args.includes("--blank");
const asJson = args.includes("--json");
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : "Public-Info-Pool/Rough/bpt-pm-tables";
const inFile = args.find(a => !a.startsWith("--") && a !== (outIdx >= 0 ? args[outIdx + 1] : null));

let tables;
if (blank || !inFile) {
  tables = Object.fromEntries(Object.keys(TABLES).map(k => [k, []]));  // 空表（只表头）
} else {
  const data = JSON.parse(fs.readFileSync(inFile, "utf8"));
  if (data.protocol !== "bpt-pm/v1") { console.error("非 bpt-pm/v1 协议"); process.exit(1); }
  tables = toTables(data);
}

if (asJson) {
  console.log(JSON.stringify({ protocol: "bpt-pm/table-v1", tables }, null, 2));
} else {
  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, def] of Object.entries(TABLES)) {
    const csv = toCsv(def.cols, tables[name] || []);
    fs.writeFileSync(path.join(outDir, name + ".csv"), csv);
    console.log(`${name}.csv  ${(tables[name] || []).length} 行  (${def.cols.length} 列${def.writeback.length ? `，写回列 ${def.writeback.join("/")}` : ""})`);
  }
  console.log(`\n已写入 ${outDir}/（${blank ? "空表模板" : "样例数据"}）`);
}
