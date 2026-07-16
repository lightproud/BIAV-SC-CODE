#!/usr/bin/env node
/**
 * Soak report generator: folds a soak-emulator JSONL snapshot ledger into a
 * Markdown resource-curve report (leak slopes, plateaus, handle/fd stability).
 *
 * Usage: node tests/integration/soak-report.mjs --in=/path/soak.jsonl [--out=report.md]
 * Prints to stdout when --out is omitted. Pure read; no SDK import.
 */

import fs from 'node:fs';

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const IN = arg('in', '');
const OUT = arg('out', '');
if (!IN || !fs.existsSync(IN)) {
  console.error('soak-report: pass --in=<soak jsonl>');
  process.exit(1);
}

const rows = fs
  .readFileSync(IN, 'utf8')
  .split('\n')
  .filter((l) => l.trim().length > 0)
  .map((l) => JSON.parse(l));
if (rows.length < 2) {
  console.error('soak-report: not enough snapshots');
  process.exit(1);
}

const first = rows[0];
const last = rows[rows.length - 1];
const durMin = last.t_min - first.t_min;

/** Least-squares slope of `key` against t_min, over the steady-state tail
 *  (skip the first 10% as warm-up). */
function slopePerHour(key) {
  const tail = rows.slice(Math.floor(rows.length * 0.1));
  const n = tail.length;
  const mx = tail.reduce((s, r) => s + r.t_min, 0) / n;
  const my = tail.reduce((s, r) => s + (r[key] ?? 0), 0) / n;
  let num = 0;
  let den = 0;
  for (const r of tail) {
    num += (r.t_min - mx) * ((r[key] ?? 0) - my);
    den += (r.t_min - mx) ** 2;
  }
  return den === 0 ? 0 : (num / den) * 60; // per hour
}
function minMax(key) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of rows) {
    const v = r[key] ?? 0;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return { lo, hi };
}

const metrics = ['rss_mb', 'heap_used_mb', 'external_mb', 'array_buffers_mb', 'handles', 'fds'];
const verdictOf = (key, slope) => {
  const budget = { rss_mb: 8, heap_used_mb: 8, external_mb: 4, array_buffers_mb: 4, handles: 0.5, fds: 0.5 }[key];
  return Math.abs(slope) <= budget ? 'FLAT' : slope > 0 ? 'GROWING' : 'SHRINKING';
};

const lines = [];
lines.push('# Emulator soak report — resource curves');
lines.push('');
lines.push(
  `Run: ${durMin.toFixed(1)} min · ${last.sessions.toLocaleString()} sessions · ` +
    `${last.turns.toLocaleString()} turns · ${last.resumes.toLocaleString()} resumes · ` +
    `${last.forks.toLocaleString()} forks · ${last.compactions.toLocaleString()} compaction folds · ` +
    `${last.errors} errors${last.last_error ? ` (last: ${last.last_error})` : ''}`,
);
lines.push('');
lines.push(
  'Mix: sequential real sessions against the local Messages-API emulator — fresh / resume-chain (every 5th) / fork (every 17th), 2-tool loop + fat text turn per session, tiny compaction window (deterministic folds), store rotation every 200 sessions.',
);
lines.push('');
lines.push('| metric | start | end | min..max | steady-state slope /h | verdict |');
lines.push('|---|---|---|---|---|---|');
for (const key of metrics) {
  const s = slopePerHour(key);
  const { lo, hi } = minMax(key);
  lines.push(
    `| ${key} | ${first[key]} | ${last[key]} | ${lo}..${hi} | ${s >= 0 ? '+' : ''}${s.toFixed(2)} | ${verdictOf(key, s)} |`,
  );
}
lines.push('');
lines.push(`Throughput: ${(last.sessions / Math.max(1, durMin)).toFixed(0)} sessions/min, ` +
  `${(last.turns / Math.max(1, durMin)).toFixed(0)} turns/min (4-core container, concurrent with other load).`);
lines.push('');
lines.push('Reading the verdicts: FLAT within budget = no leak signal at this horizon; ' +
  'GROWING rss with FLAT heap usually means allocator retention, check external/arrayBuffers; ' +
  'GROWING handles or fds is a hard leak regardless of memory.');

const report = lines.join('\n') + '\n';
if (OUT) {
  fs.writeFileSync(OUT, report);
  console.log('written', OUT);
} else {
  process.stdout.write(report);
}
