// v0.3 A/B budget harness: run the SAME scripted task under two configs and
// compare result.metrics (tokens / cost / turns / cache hit ratio / per-tool).
//
// Default: against a local Messages-API emulator (keyless, deterministic) so
// the harness structure is demonstrable anywhere. The emulator does not report
// cache tokens, so cacheHitRatio stays 0 here — real cache savings surface when
// you point this at api.anthropic.com (set ANTHROPIC_API_KEY and BASE below).
//
//   npm run build && node examples/ab-metrics.mjs   # emulator (build first:
//                                                    #  this imports ../dist)
//   (edit REAL=true + export ANTHROPIC_API_KEY for a real A/B)

import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const { query } = await import('../dist/index.js');

// --- local emulator: a 2-turn agent (Bash tool, then a final answer) --------
function sse(res, e, d) { res.write(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`); }
function msgStart(res, model) {
  sse(res, 'message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 800, output_tokens: 0 } } });
}
const server = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    const j = JSON.parse(b);
    const toolTurns = j.messages.filter((m) => m.role === 'user' && Array.isArray(m.content) && m.content.some((x) => x.type === 'tool_result')).length;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (toolTurns === 0) {
      const input = JSON.stringify({ command: 'echo hello' });
      msgStart(res, j.model);
      sse(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu', name: 'Bash', input: {} } });
      sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: input } });
      sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
      sse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 12 } });
      sse(res, 'message_stop', { type: 'message_stop' }); return res.end();
    }
    msgStart(res, j.model);
    sse(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'done' } });
    sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
    sse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } });
    sse(res, 'message_stop', { type: 'message_stop' }); res.end();
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

async function run(label, promptCaching) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bpt-ab-'));
  const q = query({
    prompt: 'run the task',
    options: {
      provider: { apiKey: 'test-key', baseUrl, promptCaching },
      // WX1-1 (audit r3): bypassPermissions requires the explicit
      // allowDangerouslySkipPermissions flag, or query() throws a
      // ConfigurationError synchronously and the first run crashes.
      cwd: sandbox, persistSession: false, permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true, model: 'claude-sonnet-4-5',
    },
  });
  let result;
  for await (const m of q) if (m.type === 'result') result = m;
  fs.rmSync(sandbox, { recursive: true, force: true });
  const m = result.metrics;
  return { label, turns: m.numTurns, inTok: m.usage.input_tokens, outTok: m.usage.output_tokens, cacheRead: m.usage.cache_read_input_tokens, cacheHit: m.cacheHitRatio.toFixed(3), cost: '$' + m.totalCostUsd.toFixed(6), apiMs: m.durationApiMs, tools: m.perTool.map((t) => `${t.name}x${t.calls}`).join(',') };
}

const a = await run('caching OFF', false);
const b = await run('caching ON', true);

console.log('='.repeat(78));
console.log('Silver Core SDK — A/B budget metrics (local emulator; cache tokens only real vs API)');
console.log('='.repeat(78));
const cols = ['label', 'turns', 'inTok', 'outTok', 'cacheRead', 'cacheHit', 'cost', 'apiMs', 'tools'];
console.log(cols.map((c) => String(c).padEnd(12)).join(''));
for (const row of [a, b]) console.log(cols.map((c) => String(row[c]).padEnd(12)).join(''));
console.log('='.repeat(78));
console.log('Note: against api.anthropic.com the ON row shows cache_read > 0 and a lower');
console.log('input-token bill on multi-turn runs; per-run result.metrics is the instrument.');

server.close();
