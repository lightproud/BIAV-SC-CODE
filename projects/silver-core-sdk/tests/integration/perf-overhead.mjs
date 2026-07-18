/**
 * SDK-overhead latency probe (zero-key, emulator-driven).
 *
 * Measures the latency the SDK ITSELF adds around the model stream — the
 * response-time budget the engine controls — using the conformance emulator
 * as an instant local model, so every millisecond measured is client-side
 * work (request assembly, SSE parsing, accumulation, dispatch, bookkeeping),
 * not model or network time.
 *
 * Scenarios:
 *   tool-loop    30-turn agent loop (4KB assistant text + one read-only Glob
 *                per turn) — exercises per-turn request assembly, history
 *                growth, tool dispatch, compaction estimation.
 *   event-storm  one turn delivering 8000 small text deltas — exercises the
 *                per-SSE-event path (parser, watchdog, accumulator).
 *
 * Metrics per scenario (median of --repeat runs, default 5):
 *   wallMs      end-to-end query wall time
 *   apiMs       engine durationApiMs (stream open -> close; on a localhost
 *               emulator this is dominated by SDK per-event processing)
 *   toolMs      sum of per-tool execution time
 *   overheadMs  wallMs - apiMs - toolMs (pure engine bookkeeping)
 *   cpuMs       process CPU (user+system) consumed by the run
 *
 * Usage:  node tests/integration/perf-overhead.mjs [--repeat=5] [--out=path.json]
 * Requires `npm run build` first (imports the compiled dist).
 * NOT part of `npm test`: a timing probe, inherently machine-dependent.
 */

import { startEmulator, textReply } from '../conformance/emulator.mjs';
import { query } from '../../dist/index.js';

const args = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const eq = a.indexOf('=');
    return eq === -1 ? [a.slice(2), true] : [a.slice(2, eq), a.slice(eq + 1)];
  }),
);
const REPEAT = Math.max(1, Number.parseInt(args.repeat, 10) || 5);

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** Assistant turn: one sizeable text block + one tool_use (unique ids). */
function textPlusToolUse(turnIdx, text, name, input) {
  const id = `msg_perf_${turnIdx}`;
  return [
    { type: 'message_start', message: { id, type: 'message', role: 'assistant', model: 'claude-emulator-1', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: `toolu_perf_${turnIdx}`, name, input: {} } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } },
    { type: 'message_stop' },
  ];
}

/** One turn made of `n` small text deltas. */
function deltaStorm(n) {
  const events = [
    { type: 'message_start', message: { id: 'msg_perf_storm', type: 'message', role: 'assistant', model: 'claude-emulator-1', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  ];
  for (let i = 0; i < n; i++) {
    events.push({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `token-${i % 97} ` } });
  }
  events.push(
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: n } },
    { type: 'message_stop' },
  );
  return events;
}

async function runOnce(scripts, promptText) {
  const emulator = await startEmulator(scripts);
  const cpu0 = process.cpuUsage();
  const t0 = performance.now();
  let metrics;
  // WX5-2 (audit r3): capture wall/CPU the instant the run finishes, INSIDE the
  // try — before `finally` awaits the emulator socket teardown. Measuring after
  // close() folded teardown latency into wallMs and inflated overheadMs.
  let wallMs = 0;
  let cpu = { user: 0, system: 0 };
  try {
    const q = query({
      prompt: promptText,
      options: {
        provider: { apiKey: 'perf-key', baseUrl: emulator.url },
        persistSession: false,
        maxTurns: 100,
      },
    });
    for await (const msg of q) {
      if (msg.type === 'result') metrics = msg.metrics;
    }
    wallMs = performance.now() - t0;
    cpu = process.cpuUsage(cpu0);
  } finally {
    await emulator.close();
  }
  const apiMs = metrics?.durationApiMs ?? 0;
  const toolMs = (metrics?.perTool ?? []).reduce((n, t) => n + t.totalMs, 0);
  return {
    wallMs,
    apiMs,
    toolMs,
    overheadMs: wallMs - apiMs - toolMs,
    cpuMs: (cpu.user + cpu.system) / 1000,
  };
}

const FILLER = 'The quick brown fox jumps over the lazy dog. 敏捷的棕毛狐狸跳过了懒狗。'.repeat(60); // ~4KB

function toolLoopScripts(turns) {
  const scripts = [];
  for (let i = 0; i < turns; i++) {
    scripts.push({ kind: 'sse', events: textPlusToolUse(i, FILLER, 'Glob', { pattern: '*.json' }) });
  }
  scripts.push({ kind: 'sse', events: textReply('done.') });
  return scripts;
}

async function scenario(name, mkScripts, promptText) {
  const runs = [];
  for (let i = 0; i < REPEAT; i++) {
    runs.push(await runOnce(mkScripts(), promptText));
  }
  const agg = {};
  for (const key of ['wallMs', 'apiMs', 'toolMs', 'overheadMs', 'cpuMs']) {
    agg[key] = Number(median(runs.map((r) => r[key])).toFixed(1));
  }
  console.log(`${name.padEnd(12)} wall=${agg.wallMs}ms api=${agg.apiMs}ms tool=${agg.toolMs}ms overhead=${agg.overheadMs}ms cpu=${agg.cpuMs}ms`);
  return agg;
}

const report = { node: process.version, repeat: REPEAT, scenarios: {} };
report.scenarios['tool-loop'] = await scenario('tool-loop', () => toolLoopScripts(30), 'perf probe: run the tool loop');
report.scenarios['event-storm'] = await scenario('event-storm', () => [{ kind: 'sse', events: deltaStorm(8000) }], 'perf probe: long answer');

if (typeof args.out === 'string') {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(args.out, JSON.stringify(report, null, 2));
  console.log(`report written: ${args.out}`);
}
