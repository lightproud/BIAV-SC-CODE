/**
 * v0.3 per-run budget instrumentation: result.metrics (SDKRunMetrics).
 * Exercises the full query() path with a tool roundtrip so perTurn + perTool
 * are populated, via the SSE fetch harness (no network).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { query } from '../src/index.js';
import type { SDKMessage, SDKResultMessage } from '../src/index.js';
import { makeSSEFetch } from './helpers/sse-fetch.js';
import { textReplyEvents, toolUseReplyEvents } from './helpers/mock-transport.js';

let sandbox: string;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bpt-metrics-'));
});
afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(sandbox, { recursive: true, force: true });
});

async function collect(q: AsyncGenerator<SDKMessage, void>): Promise<SDKMessage[]> {
  const out: SDKMessage[] = [];
  for await (const m of q) out.push(m);
  return out;
}

function opts(extra: Record<string, unknown> = {}) {
  return {
    provider: { apiKey: 'test-key', promptCaching: false },
    sessionDir: path.join(sandbox, '.sessions'),
    cwd: sandbox,
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    model: 'claude-sonnet-4-5',
    permissionMode: 'bypassPermissions' as const,
    allowDangerouslySkipPermissions: true,
    ...extra,
  };
}

describe('v0.3 result.metrics', () => {
  it('reports per-turn + per-tool metrics across a Bash tool roundtrip', async () => {
    vi.stubGlobal(
      'fetch',
      makeSSEFetch([
        toolUseReplyEvents('Bash', { command: 'echo hi' }),
        textReplyEvents('done'),
      ]),
    );
    const messages = await collect(query({ prompt: 'run it', options: opts() }));
    const result = messages[messages.length - 1] as SDKResultMessage;
    expect(result.type).toBe('result');
    expect(result.subtype).toBe('success');

    const m = result.metrics;
    expect(m).toBeDefined();
    if (!m) throw new Error('no metrics');

    // Two assistant turns (tool_use, then final text).
    expect(m.numTurns).toBe(2);
    expect(m.perTurn).toHaveLength(2);
    expect(m.perTurn[0]!.toolCalls).toBe(1);
    expect(m.perTurn[0]!.stopReason).toBe('tool_use');
    expect(m.perTurn[1]!.toolCalls).toBe(0);
    expect(m.perTurn[1]!.stopReason).toBe('end_turn');
    // perTurn.model reflects the RESPONSE model (mock returns 'claude-test-1'),
    // consistent with how modelUsage is keyed.
    expect(m.perTurn.every((t) => t.model === 'claude-test-1')).toBe(true);
    expect(Object.keys(m.modelUsage)).toContain('claude-test-1');

    // The Bash tool ran exactly once, no error.
    const bash = m.perTool.find((t) => t.name === 'Bash');
    expect(bash).toBeDefined();
    expect(bash!.calls).toBe(1);
    expect(bash!.errors).toBe(0);
    expect(bash!.totalMs).toBeGreaterThanOrEqual(0);

    // Totals line up with the flat result fields.
    expect(m.totalCostUsd).toBe(result.subtype === 'success' ? result.total_cost_usd : 0);
    expect(m.usage).toEqual(result.usage);
    expect(m.durationApiMs).toBe(result.duration_api_ms);
    // No cache reads in this run -> ratio 0.
    expect(m.cacheHitRatio).toBe(0);
  });

  it('per-turn costs sum to the total cost', async () => {
    vi.stubGlobal('fetch', makeSSEFetch([textReplyEvents('single turn')]));
    const messages = await collect(query({ prompt: 'hi', options: opts() }));
    const result = messages[messages.length - 1] as SDKResultMessage;
    const m = result.metrics!;
    expect(m.numTurns).toBe(1);
    const summed = m.perTurn.reduce((s, t) => s + t.costUsd, 0);
    expect(summed).toBeCloseTo(m.totalCostUsd, 10);
  });
});
