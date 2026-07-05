#!/usr/bin/env node
/* ==========================================================================
   BPT PM — CPM 调度器（命令行版，与 index.html 内联引擎同算法）
   用途：桥接外部数据源（如 Notion）时复用同一套排期逻辑，避免算法漂移。
   用法：cat project.json | node schedule.mjs   # stdin 读 bpt-pm/v1，stdout 出计算结果
        node schedule.mjs project.json          # 或直接传文件
   输出：{ projEnd, completion, errors, slipCount, ordersAtRisk,
          tasks:[{id,start,finish,slack,freeSlack,critical,milestone,externalMargin,isSummary,depth}], resources, orders }
   ========================================================================== */
const MS_DAY = 86400000;
const parseDate = s => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fmtDate = dt => dt.toISOString().slice(0, 10);
const addDays = (dt, n) => new Date(dt.getTime() + n * MS_DAY);
const isoWeekday = dt => { const w = dt.getUTCDay(); return w === 0 ? 7 : w; };

export class WorkCalendar {
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
  // 全体任务（含摘要）先解析出来；WBS 层据 parent 引用识别摘要，摘要不入 CPM/资源/错峰。
  const allTasks = data.tasks.map(t => ({
    id: t.id, name: t.name,
    dur: Math.max(0, Number(t.duration ?? 1)),
    preds: (t.predecessors || []).map(p => ({ id: p.id, type: p.type || "FS", lag: Number(p.lag || 0) })),
    constraint: t.constraint || null,
    pct: Number(t.percentComplete || 0),
    resource: t.resource || "",
    parent: (t.parent != null && t.parent !== "") ? t.parent : null,
  }));
  const allById = new Map(allTasks.map(t => [t.id, t]));

  // WBS（契约③）：被别的任务当 parent 引用者 = 摘要任务；depth = parent 链层级（缩进用）；childrenOf 卷积用。
  const summaryIds = new Set();
  const childrenOf = new Map();
  for (const t of allTasks) {
    if (t.parent && allById.has(t.parent)) {
      summaryIds.add(t.parent);
      if (!childrenOf.has(t.parent)) childrenOf.set(t.parent, []);
      childrenOf.get(t.parent).push(t.id);
    }
  }
  const depthOf = t => { let d = 0, cur = t, g = 0; while (cur.parent && allById.has(cur.parent) && g++ < 10000) { d++; cur = allById.get(cur.parent); } return d; };
  const depth = new Map(allTasks.map(t => [t.id, depthOf(t)]));

  // 叶任务（非 summary）才参与 CPM / computeResourceLoad / suggestLeveling。
  const tasks = allTasks.filter(t => !summaryIds.has(t.id));
  const byId = new Map(tasks.map(t => [t.id, t]));

  const warnings = [];   // 契约④：聚合 cycle/missing-pred + constraint-conflict/negative-slack/infeasible-window
  const order = [], visiting = new Set(), done = new Set(), errors = [];
  function visit(t, stack) {
    if (done.has(t.id)) return;
    if (visiting.has(t.id)) { const desc = "依赖存在环：" + [...stack, t.id].join(" → "); errors.push(desc); warnings.push({ type: "cycle", taskId: t.id, desc }); return; }
    visiting.add(t.id);
    for (const p of t.preds) {
      const pt = byId.get(p.id);
      if (!pt) { const desc = `任务 ${t.id} 引用了不存在的前置 ${p.id}`; errors.push(desc); warnings.push({ type: "missing-pred", taskId: t.id, desc }); continue; }
      visit(pt, [...stack, t.id]);
    }
    visiting.delete(t.id); done.add(t.id); order.push(t);
  }
  tasks.forEach(t => visit(t, []));
  const succ = new Map(tasks.map(t => [t.id, []]));
  tasks.forEach(t => t.preds.forEach(p => { if (byId.has(p.id)) succ.get(p.id).push({ id: t.id, type: p.type, lag: p.lag }); }));

  // 约束助手（v3 8 型完备）：前向抬早开始 / 后向 cap 晚限（见契约①，与 index.html 内联版同实现）
  const forwardConstraint = (es, t) => {
    const c = t.constraint; if (!c || !c.date) return es;
    const di = cal.toIndex(c.date);
    switch (c.type) {
      case "SNET": return Math.max(es, di);          // 不早于某日开始
      case "FNET": return Math.max(es, di - t.dur);  // 不早于某日结束 ⇒ es≥di−dur
      case "MSO": return di;                          // 必须某日开始（硬）
      case "MFO": return di - t.dur;                  // 必须某日结束（硬）⇒ es=di−dur
      default: return es;                             // ASAP/ALAP/SNLT/FNLT 不抬前向
    }
  };
  const capBackward = (lf, t) => {
    const c = t.constraint; if (!c || !c.date) return lf;
    const di = cal.toIndex(c.date);
    if (c.type === "SNLT") return Math.min(lf, di + t.dur); // ls≤di ⇒ lf≤di+dur
    if (c.type === "FNLT") return Math.min(lf, di);          // lf≤di
    return lf;
  };

  const scheduleFrom = data.project.scheduleFrom === "finish" ? "finish" : "start";
  let projEnd;

  if (scheduleFrom === "finish") {
    // 倒排（scheduleFrom=finish）：projEnd 锚在 project.finish，后向优先，es=ls（默认 ALAP 取向）。
    // projEnd 用排他上界空间：finish 当日工作日索引 +1，令末任务 ef=projEnd → 结束落在 project.finish。
    const finishStr = data.project.finish || data.project.start;
    projEnd = cal.toIndex(finishStr) + 1;
    for (let i = order.length - 1; i >= 0; i--) {
      const t = order[i];
      const outs = succ.get(t.id);
      let lf = outs.length ? Infinity : projEnd;
      for (const s of outs) {
        const st = byId.get(s.id);
        switch (s.type) {
          case "FS": lf = Math.min(lf, st.ls - s.lag); break;
          case "SS": lf = Math.min(lf, st.ls - s.lag + t.dur); break;
          case "FF": lf = Math.min(lf, st.lf - s.lag); break;
          case "SF": lf = Math.min(lf, st.lf - s.lag + t.dur); break;
        }
      }
      if (!isFinite(lf)) lf = projEnd;
      lf = capBackward(lf, t);
      t.lf = lf; t.ls = lf - t.dur;
      let es = t.ls;
      if (es < 0) { warnings.push({ type: "infeasible-window", taskId: t.id, desc: `任务 ${t.id} 倒排窗口放不下（早开始 ${es}<0），已 clamp 0` }); es = 0; }
      t.es = es; t.ef = es + t.dur; t.slack = t.ls - t.es; t.critical = t.slack <= 0;
    }
  } else {
    // 前向调度（scheduleFrom=start，默认）
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
      const esNatural = es;
      es = forwardConstraint(es, t);
      // 硬约束冲突（契约④）：MSO/MFO 把 es 钉死，但前置要求更晚（前置派生 es > 约束钉死值）。
      if (t.constraint && (t.constraint.type === "MSO" || t.constraint.type === "MFO") && t.constraint.date && esNatural > es) {
        warnings.push({ type: "constraint-conflict", taskId: t.id, desc: `任务 ${t.id} 硬约束 ${t.constraint.type} 与前置矛盾（前置要求早开始 ${esNatural} > 约束钉死 ${es}）` });
      }
      es = Math.max(es, 0);
      t.es = es; t.ef = es + t.dur;
    }
    projEnd = tasks.reduce((m, t) => Math.max(m, t.ef), 0);
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
      lf = capBackward(lf, t);
      t.lf = lf; t.ls = lf - t.dur; t.slack = t.ls - t.es; t.critical = t.slack <= 0;
    }
    // ALAP 后处理：把 ALAP 任务浮到最晚（es←ls / ef←lf），随后 freeSlack 重算
    for (const t of tasks) {
      if (t.constraint && t.constraint.type === "ALAP") {
        t.es = t.ls; t.ef = t.lf; t.slack = t.ls - t.es; t.critical = t.slack <= 0;
      }
    }
  }

  // 负浮动检测（契约④）：ls<es（多由 SNLT/FNLT 晚限约束致），已报 infeasible-window 的不重复报。
  const infeasibleSet = new Set(warnings.filter(w => w.type === "infeasible-window").map(w => w.taskId));
  for (const t of tasks) {
    if (t.slack < 0 && !infeasibleSet.has(t.id)) warnings.push({ type: "negative-slack", taskId: t.id, desc: `任务 ${t.id} 负浮动（ls ${t.ls} < es ${t.es}，晚限约束致冲突）` });
  }

  // 自由浮动 freeSlack（每任务，工作日，≥0）：对每条后继链路算 headroom=es_后继 − minEsFromLink，
  // minEsFromLink: FS=ef_i+lag / SS=es_i+lag / FF=ef_i+lag−dur_后继 / SF=es_i+lag−dur_后继；min clamp≥0；无后继=totalSlack。
  for (const t of tasks) {
    const outs = succ.get(t.id);
    if (!outs.length) { t.freeSlack = t.slack; continue; }
    let fs = Infinity;
    for (const s of outs) {
      const st = byId.get(s.id); if (!st) continue;
      let minEs;
      switch (s.type) {
        case "FS": minEs = t.ef + s.lag; break;
        case "SS": minEs = t.es + s.lag; break;
        case "FF": minEs = t.ef + s.lag - st.dur; break;
        case "SF": minEs = t.es + s.lag - st.dur; break;
        default: minEs = t.ef + s.lag;
      }
      fs = Math.min(fs, st.es - minEs);
    }
    t.freeSlack = isFinite(fs) ? Math.max(0, fs) : t.slack;
  }

  // WBS 卷积（契约③）：叶任务工作日索引区间入 rolled；摘要按 depth 深者优先自底向上卷积
  // start=min(子 start)、finish=max(子 finish)、dur=跨度工作日（支持嵌套 parent 链）。
  const rolled = new Map(); // id -> { startIdx, finishIdx }
  for (const t of tasks) rolled.set(t.id, { startIdx: t.es, finishIdx: t.dur > 0 ? t.ef - 1 : t.es });
  const summaryList = allTasks.filter(t => summaryIds.has(t.id)).sort((a, b) => depth.get(b.id) - depth.get(a.id));
  for (const s of summaryList) {
    const kids = childrenOf.get(s.id) || [];
    let mn = Infinity, mx = -Infinity;
    for (const k of kids) { const r = rolled.get(k); if (!r) continue; if (r.startIdx < mn) mn = r.startIdx; if (r.finishIdx > mx) mx = r.finishIdx; }
    if (!isFinite(mn)) { mn = 0; mx = 0; }
    rolled.set(s.id, { startIdx: mn, finishIdx: mx });
  }

  // 对外更新日期（项目级一个日期）：其工作日索引，供每任务算「对外更新余量」= 该日 − 结束（负=会跳票）
  const updateIdx = data.project.updateDate ? cal.toIndex(data.project.updateDate) : null;
  let completion = cal.start;
  const out = data.tasks.map(orig => {
    const dp = depth.get(orig.id) ?? 0;
    if (summaryIds.has(orig.id)) {
      const r = rolled.get(orig.id);
      const startDate = cal.fromIndex(r.startIdx);
      const finishDate = cal.fromIndex(r.finishIdx);
      if (finishDate > completion) completion = finishDate;
      return {
        id: orig.id, name: orig.name, start: fmtDate(startDate), finish: fmtDate(finishDate),
        dur: r.finishIdx - r.startIdx + 1, slack: null, freeSlack: null, critical: false, milestone: false,
        externalMargin: null, isSummary: true, childIds: (childrenOf.get(orig.id) || []).slice(), depth: dp,
      };
    }
    const t = byId.get(orig.id);
    const startDate = cal.fromIndex(t.es);
    const finishDate = t.dur > 0 ? cal.fromIndex(t.ef - 1) : startDate;
    if (finishDate > completion) completion = finishDate;
    // 结束工作日索引：dur>0 用 ef-1（含尾工作日），里程碑用 es（结束=开始）。
    const finishIdx = t.dur > 0 ? t.ef - 1 : t.es;
    // 对外更新余量（工作日）：对外更新日期 − 任务结束；正=还有余量，负/0=会跳票。无对外更新日期则 null。
    const externalMargin = updateIdx != null ? updateIdx - finishIdx : null;
    return { id: t.id, name: t.name, start: fmtDate(startDate), finish: fmtDate(finishDate), dur: t.dur, slack: t.slack, freeSlack: t.freeSlack, critical: t.critical, milestone: t.dur === 0, externalMargin, isSummary: false, depth: dp };
  });
  const slipCount = out.filter(t => t.externalMargin != null && t.externalMargin < 0).length;
  const resources = computeResourceLoad(tasks, data.resources, cal, projEnd);
  const orders = analyzeOrders(data.orders, out);
  const ordersAtRisk = orders.filter(o => o.atRisk).length;
  // 叶任务内部快照（索引空间，es/ef/preds/resource），供 suggestLeveling 与外部消费者（additive）
  const leaves = tasks.map(t => ({ id: t.id, es: t.es, ef: t.ef, dur: t.dur, resource: t.resource, slack: t.slack, preds: t.preds }));
  return { projEnd, scheduleFrom, completion: fmtDate(completion), errors, warnings, warningCount: warnings.length, tasks: out, resources, slipCount, orders, ordersAtRisk, leaves };
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

/* ---------- 资源错峰建议（层3 引擎②，纯函数、只算不改，与 index.html 内联版同实现） ----------
   贪心串行错峰：把撞车任务在其资源上串成不超产能的排布，输出「建议」而不改原排期。
   入参 leafTasks：叶任务归一化数组 [{id, es, ef, dur, resource, slack, preds:[{id,type,lag}]}]（索引空间）。
   算法：拓扑就绪帧内按 (总浮动升, es 升, id 升) 选任务（保证前置先落 + 优先级）；
        每资源维护已提交半开区间 [a,b)，产能=capacity 允许并发；
        逐任务取 earliestStart=前置在建议表中的完成派生下界（按链接类型 FS/SS/FF/SF），
        再向后找该资源窗口内并发<capacity 的最早可行 start 提交。
   返回 {suggested:[{id,start,finish,shifted,shiftDays}], newProjEnd, movedCount, residualOverloads}。
   目标残余超载=0；依赖/单资源本身不可解时如实报 residualOverloads。 */
export function suggestLeveling(leafTasks, resourcesDef, cal) {
  const resMap = new Map();
  (resourcesDef || []).forEach(r => resMap.set(r.id, {
    id: r.id, name: r.name || r.id, type: r.type || "person", capacity: Math.max(1, Number(r.capacity || 1)),
  }));
  const tasks = (leafTasks || []).map(t => {
    const dur = Math.max(0, Number(t.dur ?? 0));
    const es = Number(t.es || 0);
    return {
      id: t.id, dur, es,
      ef: t.ef != null ? Number(t.ef) : es + dur,
      resource: t.resource || "",
      slack: Number(t.slack || 0),
      preds: (t.preds || []).map(p => ({ id: p.id, type: p.type || "FS", lag: Number(p.lag || 0) })),
    };
  });
  tasks.forEach(t => { if (t.dur > 0 && t.resource && !resMap.has(t.resource)) resMap.set(t.resource, { id: t.resource, name: t.resource, type: "person", capacity: 1 }); });
  const byId = new Map(tasks.map(t => [t.id, t]));
  const placed = new Map();        // id -> { startIdx, dur }
  const committed = new Map();     // resId -> [{ a, b }] 已提交半开区间

  // 窗口 [a,b) 内单日最大已提交并发
  const loadInWindow = (intervals, a, b) => {
    let peak = 0;
    for (let i = a; i < b; i++) {
      let c = 0;
      for (const iv of intervals) if (i >= iv.a && i < iv.b) c++;
      if (c > peak) peak = c;
    }
    return peak;
  };
  // 前置派生的最早可行开始（前置已落用建议区间，否则回落其原始 es/ef 下界）
  const earliestFrom = t => {
    let est = 0;
    for (const p of t.preds) {
      const pl = placed.get(p.id), src = byId.get(p.id);
      let ps, pe;
      if (pl) { ps = pl.startIdx; pe = pl.startIdx + pl.dur; }
      else if (src) { ps = src.es; pe = src.ef; }
      else continue;
      switch (p.type) {
        case "SS": est = Math.max(est, ps + p.lag); break;
        case "FF": est = Math.max(est, pe + p.lag - t.dur); break;
        case "SF": est = Math.max(est, ps + p.lag - t.dur); break;
        default: est = Math.max(est, pe + p.lag); // FS
      }
    }
    return Math.max(0, est);
  };
  const priorityLess = (a, b) => (a.slack - b.slack) || (a.es - b.es) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const remaining = new Set(tasks.map(t => t.id));
  let guard = 0;
  while (remaining.size && guard++ < 100000) {
    let ready = [...remaining].map(id => byId.get(id)).filter(t => t.preds.every(p => !byId.has(p.id) || placed.has(p.id)));
    if (!ready.length) ready = [...remaining].map(id => byId.get(id)); // 环/缺前置兜底
    ready.sort(priorityLess);
    const t = ready[0];
    remaining.delete(t.id);
    let start = earliestFrom(t);
    if (t.dur > 0 && t.resource) {
      const cap = (resMap.get(t.resource) || { capacity: 1 }).capacity;
      if (!committed.has(t.resource)) committed.set(t.resource, []);
      const intervals = committed.get(t.resource);
      let g2 = 0;
      while (loadInWindow(intervals, start, start + t.dur) >= cap && g2++ < 100000) start++;
      intervals.push({ a: start, b: start + t.dur });
    }
    placed.set(t.id, { startIdx: start, dur: t.dur });
  }

  const suggested = tasks.map(t => {
    const pl = placed.get(t.id);
    const startIdx = pl ? pl.startIdx : t.es;
    const shiftDays = startIdx - t.es;
    const startDate = cal.fromIndex(startIdx);
    const finishDate = t.dur > 0 ? cal.fromIndex(startIdx + t.dur - 1) : startDate;
    return { id: t.id, start: fmtDate(startDate), finish: fmtDate(finishDate), shifted: shiftDays !== 0, shiftDays };
  });
  const movedCount = suggested.filter(s => s.shifted).length;
  let newProjEnd = 0;
  for (const t of tasks) { const pl = placed.get(t.id); const ef = (pl ? pl.startIdx : t.es) + t.dur; if (ef > newProjEnd) newProjEnd = ef; }

  // 残余超载：按建议区间重算超 capacity 的连续段
  const residualOverloads = [];
  for (const [resId, meta] of resMap) {
    const intervals = committed.get(resId) || [];
    if (!intervals.length) continue;
    const idxs = new Set();
    intervals.forEach(iv => { for (let i = iv.a; i < iv.b; i++) idxs.add(i); });
    let cur = null;
    for (const i of [...idxs].sort((a, b) => a - b)) {
      let load = 0; intervals.forEach(iv => { if (i >= iv.a && i < iv.b) load++; });
      if (load > meta.capacity) {
        if (cur && i === cur.endIdx + 1) { cur.endIdx = i; cur.load = Math.max(cur.load, load); }
        else { if (cur) residualOverloads.push(cur); cur = { resource: resId, startIdx: i, endIdx: i, load }; }
      }
    }
    if (cur) residualOverloads.push(cur);
  }
  const residual = residualOverloads.map(s => ({
    resource: s.resource, start: fmtDate(cal.fromIndex(s.startIdx)), end: fmtDate(cal.fromIndex(s.endIdx)),
    load: s.load, capacity: (resMap.get(s.resource) || {}).capacity,
  }));
  return { suggested, newProjEnd, movedCount, residualOverloads: residual };
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
    res.tasks.forEach(t => console.log(`  ${" ".repeat((t.depth || 0) * 2)}${t.id.padEnd(4)} ${t.start}→${t.finish} ${t.isSummary ? `[摘要 ${t.dur}d ← ${t.childIds.join(",")}]` : `slack=${t.slack}${t.critical ? " CRIT" : ""}`}`));
    console.log("资源负载：");
    res.resources.forEach(r => {
      const flag = r.overloads.length ? `超载 ${r.overloads.map(o => `${o.start}..${o.end}(${o.load}/${r.capacity}:${o.tasks.join(",")})`).join(" ")}` : "无冲突";
      console.log(`  ${r.name}（${r.type} 产能${r.capacity}｜峰值${r.peakLoad}）→ ${flag}`);
    });
    // 对外更新余量（项目级对外更新日期）：负=会跳票
    if (res.tasks.some(t => t.externalMargin != null)) {
      console.log(`对外更新余量（跳票风险 ${res.slipCount} 项）：`);
      res.tasks.filter(t => t.externalMargin != null).forEach(t => console.log(`  ${t.id.padEnd(4)} 结束 ${t.finish} · 对外更新余量 ${t.externalMargin} 工作日${t.externalMargin < 0 ? "（会跳票）" : ""}`));
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
