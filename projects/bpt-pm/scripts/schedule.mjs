#!/usr/bin/env node
/* ==========================================================================
   BPT PM — CPM 调度器（命令行版，与 index.html 内联引擎同算法）
   用途：桥接外部数据源（如 Notion）时复用同一套排期逻辑，避免算法漂移。
   用法：cat project.json | node schedule.mjs   # stdin 读 bpt-pm/v1，stdout 出计算结果
        node schedule.mjs project.json          # 或直接传文件
   输出：{ projEnd, completion, errors, lateCount, ordersAtRisk,
          tasks:[{id,start,finish,slack,critical,milestone,deadline,late,lateDays}], resources, orders }
   ========================================================================== */
const MS_DAY = 86400000;
const parseDate = s => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fmtDate = dt => dt.toISOString().slice(0, 10);
const addDays = (dt, n) => new Date(dt.getTime() + n * MS_DAY);
const isoWeekday = dt => { const w = dt.getUTCDay(); return w === 0 ? 7 : w; };

class WorkCalendar {
  constructor(startStr, cal) {
    cal = cal || {};
    this.workdays = new Set(cal.workdays && cal.workdays.length ? cal.workdays : [1, 2, 3, 4, 5]);
    this.holidays = new Set(cal.holidays || []);
    this.start = this.forward(parseDate(startStr));
  }
  isWorking(dt) { return this.workdays.has(isoWeekday(dt)) && !this.holidays.has(fmtDate(dt)); }
  forward(dt) { let d = dt, g = 0; while (!this.isWorking(d) && g++ < 4000) d = addDays(d, 1); return d; }
  next(dt) { let d = addDays(dt, 1), g = 0; while (!this.isWorking(d) && g++ < 4000) d = addDays(d, 1); return d; }
  fromIndex(n) { if (n <= 0) return this.start; let d = this.start; for (let i = 0; i < n; i++) d = this.next(d); return d; }
  toIndex(str) { const t = this.forward(parseDate(str)); if (t <= this.start) return 0; let d = this.start, i = 0, g = 0; while (d < t && g++ < 40000) { d = this.next(d); i++; } return i; }
}

export function scheduleProject(data) {
  const cal = new WorkCalendar(data.project.start, data.project.calendar);
  const tasks = data.tasks.map(t => ({
    id: t.id, name: t.name,
    dur: Math.max(0, Number(t.duration ?? 1)),
    preds: (t.predecessors || []).map(p => ({ id: p.id, type: p.type || "FS", lag: Number(p.lag || 0) })),
    constraint: t.constraint || null,
    pct: Number(t.percentComplete || 0),
    resource: t.resource || "",
    deadline: t.deadline || null,
  }));
  const byId = new Map(tasks.map(t => [t.id, t]));
  const order = [], visiting = new Set(), done = new Set(), errors = [];
  function visit(t, stack) {
    if (done.has(t.id)) return;
    if (visiting.has(t.id)) { errors.push("依赖存在环：" + [...stack, t.id].join(" → ")); return; }
    visiting.add(t.id);
    for (const p of t.preds) {
      const pt = byId.get(p.id);
      if (!pt) { errors.push(`任务 ${t.id} 引用了不存在的前置 ${p.id}`); continue; }
      visit(pt, [...stack, t.id]);
    }
    visiting.delete(t.id); done.add(t.id); order.push(t);
  }
  tasks.forEach(t => visit(t, []));
  const succ = new Map(tasks.map(t => [t.id, []]));
  tasks.forEach(t => t.preds.forEach(p => { if (byId.has(p.id)) succ.get(p.id).push({ id: t.id, type: p.type, lag: p.lag }); }));

  for (const t of order) {
    let es = 0;
    for (const p of t.preds) {
      const pt = byId.get(p.id); if (!pt) continue;
      switch (p.type) {
        case "FS": es = Math.max(es, pt.ef + p.lag); break;
        case "SS": es = Math.max(es, pt.es + p.lag); break;
        case "FF": es = Math.max(es, pt.ef + p.lag - t.dur); break;
        case "SF": es = Math.max(es, pt.es + p.lag - t.dur); break;
      }
    }
    if (t.constraint && t.constraint.date) {
      const ci = cal.toIndex(t.constraint.date);
      if (t.constraint.type === "SNET") es = Math.max(es, ci);
      else if (t.constraint.type === "MSO") es = ci;
    }
    es = Math.max(es, 0);
    t.es = es; t.ef = es + t.dur;
  }
  const projEnd = tasks.reduce((m, t) => Math.max(m, t.ef), 0);
  for (let i = order.length - 1; i >= 0; i--) {
    const t = order[i];
    const outs = succ.get(t.id);
    let lf = outs.length ? Infinity : Math.max(projEnd, t.ef);
    for (const s of outs) {
      const st = byId.get(s.id);
      switch (s.type) {
        case "FS": lf = Math.min(lf, st.ls - s.lag); break;
        case "SS": lf = Math.min(lf, st.ls - s.lag + t.dur); break;
        case "FF": lf = Math.min(lf, st.lf - s.lag); break;
        case "SF": lf = Math.min(lf, st.lf - s.lag + t.dur); break;
      }
    }
    if (!isFinite(lf)) lf = Math.max(projEnd, t.ef);
    t.lf = lf; t.ls = lf - t.dur; t.slack = t.ls - t.es; t.critical = t.slack <= 0;
  }
  let completion = cal.start;
  const out = tasks.map(t => {
    const startDate = cal.fromIndex(t.es);
    const finishDate = t.dur > 0 ? cal.fromIndex(t.ef - 1) : startDate;
    if (finishDate > completion) completion = finishDate;
    // 周期守护（特性 B）：deadline 软截止叠加，不改 CPM slack/临界。
    // 结束工作日索引：dur>0 用 ef-1（含尾工作日），里程碑用 es（结束=开始）。
    const finishIdx = t.dur > 0 ? t.ef - 1 : t.es;
    let late = false, lateDays = null;
    if (t.deadline) {
      const di = cal.toIndex(t.deadline);
      lateDays = finishIdx - di;
      late = lateDays > 0;
    }
    return { id: t.id, name: t.name, start: fmtDate(startDate), finish: fmtDate(finishDate), dur: t.dur, slack: t.slack, critical: t.critical, milestone: t.dur === 0, deadline: t.deadline || null, late, lateDays };
  });
  const lateCount = out.filter(t => t.late).length;
  const resources = computeResourceLoad(tasks, data.resources, cal, projEnd);
  const orders = analyzeOrders(data.orders, out);
  const ordersAtRisk = orders.filter(o => o.atRisk).length;
  return { projEnd, completion: fmtDate(completion), errors, tasks: out, resources, lateCount, orders, ordersAtRisk };
}

/* ---------- 流水线模板实例化（特性 C，纯函数，与 index.html 内联版同实现） ----------
   把一个模板展开成一串 FS 链接的 bpt-pm 任务：每 stage 一个主任务，
   revisionRounds R>0 时在主任务后插入 R 轮「审核（dur1，revisionResource）+ 返修
   （revisionDuration，沿用阶段 resource）」链；下一 stage 依赖本 stage 链的最后一个任务。 */
export function instantiateTemplate(template, opts) {
  opts = opts || {};
  const prefix = opts.prefix || "";
  const assetName = opts.assetName || "";
  const out = [];
  let prevLastId = null; // 上一 stage 链的最后一个任务 id
  (template.stages || []).forEach(stage => {
    const type = stage.type || "FS";
    const lag = Number(stage.lag || 0);
    const mainId = `${prefix}_${stage.key}`;
    const mainTask = {
      id: mainId,
      name: `${assetName} ${stage.name}`,
      duration: Number(stage.duration ?? 1),
      predecessors: prevLastId ? [{ id: prevLastId, type, lag }] : [],
    };
    if (stage.resource) mainTask.resource = stage.resource;
    out.push(mainTask);
    let chainLastId = mainId;
    const R = Math.max(0, Number(stage.revisionRounds || 0));
    if (R > 0) {
      const revDur = stage.revisionDuration == null ? 1 : Number(stage.revisionDuration);
      for (let r = 1; r <= R; r++) {
        const reviewId = `${prefix}_${stage.key}_审${r}`;
        const reviewTask = {
          id: reviewId,
          name: `${assetName} ${stage.name} 审核${r}`,
          duration: 1,
          predecessors: [{ id: chainLastId, type: "FS", lag: 0 }],
        };
        if (stage.revisionResource) reviewTask.resource = stage.revisionResource;
        out.push(reviewTask);
        const fixId = `${prefix}_${stage.key}_返${r}`;
        const fixTask = {
          id: fixId,
          name: `${assetName} ${stage.name} 返修${r}`,
          duration: revDur,
          predecessors: [{ id: reviewId, type: "FS", lag: 0 }],
        };
        if (stage.resource) fixTask.resource = stage.resource;
        out.push(fixTask);
        chainLastId = fixId;
      }
    }
    prevLastId = chainLastId;
  });
  return out;
}

/* ---------- 外包发单交付风险分析（特性 D，纯函数，与 index.html 内联版同实现） ----------
   每单加 atRisk：有 linkedTaskId 且该任务计算结束日晚于 expectedDelivery = 交付风险。
   taskResults 兼容三形态：数组 [{id,finish}] / Map<id,{finish}> / 普通对象 {id:{finish}}。 */
export function analyzeOrders(orders, taskResults) {
  const finishOf = id => {
    if (!taskResults || !id) return null;
    let r = null;
    if (taskResults instanceof Map) r = taskResults.get(id);
    else if (Array.isArray(taskResults)) r = taskResults.find(x => x.id === id);
    else r = taskResults[id];
    return r ? r.finish : null;
  };
  return (orders || []).map(o => {
    let atRisk = false;
    if (o.linkedTaskId) {
      const fin = finishOf(o.linkedTaskId);
      if (fin && o.expectedDelivery) atRisk = parseDate(fin) > parseDate(o.expectedDelivery);
    }
    return { ...o, atRisk };
  });
}

/* ---------- 资源负载 + 超载检测 ----------
   每个 dur>0 的任务在其 [es, ef) 工作日索引区间占用其资源 1 个并发槽。
   某工作日某资源承载任务数 > capacity 即超载。未登记资源按「人、产能1」处理。 */
export function computeResourceLoad(tasks, resourcesDef, cal, projEnd) {
  const resMap = new Map();
  (resourcesDef || []).forEach(r => resMap.set(r.id, {
    id: r.id, name: r.name || r.id, type: r.type || "person", capacity: Math.max(1, Number(r.capacity || 1)),
  }));
  for (const t of tasks) { if (t.dur > 0 && t.resource && !resMap.has(t.resource)) resMap.set(t.resource, { id: t.resource, name: t.resource, type: "person", capacity: 1 }); }
  const perRes = new Map(); // resId -> Map(dayIdx -> [taskIds])
  for (const t of tasks) {
    if (!(t.dur > 0) || !t.resource) continue;
    if (!perRes.has(t.resource)) perRes.set(t.resource, new Map());
    const m = perRes.get(t.resource);
    for (let i = t.es; i < t.ef; i++) { if (!m.has(i)) m.set(i, []); m.get(i).push(t.id); }
  }
  const out = [];
  for (const [id, meta] of resMap) {
    const m = perRes.get(id) || new Map();
    const idxs = [...m.keys()].sort((a, b) => a - b);
    const loadByDate = {}; let peak = 0;
    for (const i of idxs) { const arr = m.get(i); loadByDate[fmtDate(cal.fromIndex(i))] = { load: arr.length, tasks: arr }; if (arr.length > peak) peak = arr.length; }
    const segs = []; let cur = null;
    for (const i of idxs) {
      const load = m.get(i).length;
      if (load > meta.capacity) {
        if (cur && i === cur.endIdx + 1) { cur.endIdx = i; cur.load = Math.max(cur.load, load); m.get(i).forEach(x => cur.tasks.add(x)); }
        else { if (cur) segs.push(cur); cur = { startIdx: i, endIdx: i, load, tasks: new Set(m.get(i)) }; }
      }
    }
    if (cur) segs.push(cur);
    out.push({
      id, name: meta.name, type: meta.type, capacity: meta.capacity, peakLoad: peak, loadByDate,
      overloads: segs.map(s => ({ start: fmtDate(cal.fromIndex(s.startIdx)), end: fmtDate(cal.fromIndex(s.endIdx)), load: s.load, tasks: [...s.tasks] })),
    });
  }
  return out;
}

// CLI 入口
if (import.meta.url === `file://${process.argv[1]}`) {
  const fs = await import("fs");
  const fileArg = process.argv.slice(2).find(a => !a.startsWith("--"));
  const src = fileArg ? fs.readFileSync(fileArg, "utf8") : fs.readFileSync(0, "utf8");
  const data = JSON.parse(src);
  const res = scheduleProject(data);
  if (process.argv.includes("--summary")) {
    console.log(`总工期 ${res.projEnd} 工作日 · 完工 ${res.completion}`);
    res.tasks.forEach(t => console.log(`  ${t.id.padEnd(4)} ${t.start}→${t.finish} slack=${t.slack} ${t.critical ? "CRIT" : ""}`));
    console.log("资源负载：");
    res.resources.forEach(r => {
      const flag = r.overloads.length ? `超载 ${r.overloads.map(o => `${o.start}..${o.end}(${o.load}/${r.capacity}:${o.tasks.join(",")})`).join(" ")}` : "无冲突";
      console.log(`  ${r.name}（${r.type} 产能${r.capacity}｜峰值${r.peakLoad}）→ ${flag}`);
    });
    // 周期守护：误期任务（特性 B）
    const lateTasks = res.tasks.filter(t => t.late);
    if (lateTasks.length) {
      console.log(`误期任务（${res.lateCount}）：`);
      lateTasks.forEach(t => console.log(`  ${t.id.padEnd(4)} 结束 ${t.finish} 晚于 deadline ${t.deadline} · 误期 ${t.lateDays} 工作日`));
    } else {
      console.log("误期任务：无");
    }
    // 外包发单风险（特性 D）
    if (res.orders && res.orders.length) {
      console.log(`发单风险（${res.ordersAtRisk}/${res.orders.length}）：`);
      res.orders.forEach(o => {
        console.log(`  ${String(o.id).padEnd(7)} ${o.vendor}｜${o.asset}｜预计交付 ${o.expectedDelivery}｜关联 ${o.linkedTaskId || "—"} → ${o.atRisk ? "风险" : "正常"}`);
      });
    }
  } else {
    console.log(JSON.stringify(res, null, 2));
  }
}
