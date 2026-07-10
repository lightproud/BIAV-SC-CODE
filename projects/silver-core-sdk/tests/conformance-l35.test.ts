/**
 * L3.5 subagent lifecycle - our-arm keyless lock + documented dual-arm KDs
 * (testing-side sweep, B3).
 *
 * Our-arm subagent/hook lifecycle already has end-to-end coverage in
 * observability-v04.test.ts; this file adds the CONFORMANCE-framed lock that
 * pins the exact lifecycle VOCABULARY + WIRE ENCODING our engine emits on a
 * foreground Agent spawn, so the L3.5 differential findings below are guarded
 * on our side. The dual-arm differential itself lives in run-l35.mjs and is
 * REPORT-ONLY (arms make different POST counts on a spawn - a count-based hard
 * gate would be flaky/version-sensitive).
 *
 * KD-L35-01 (vocabulary): on a FOREGROUND subagent spawn, ours emits
 *   task_progress (official does not) and official emits task_notification
 *   (ours reserves that for BACKGROUND agents). Observed stable 2026-07-05
 *   (agent-sdk 0.3.199 / claude-code 2.1.201). E8b ruling: task_progress
 *   stays as a BPT superset; no foreground task_notification backfill.
 * KD-L35-02 (encoding): RETIRED 2026-07-05 (B2a/E8, v0.7). Both arms now
 *   emit the lifecycle events as system SUBTYPES ({type:'system',
 *   subtype:'task_started'}); the lock below is FLIPPED to pin the official
 *   encoding so a regression back to top-level types goes red.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { query, type Options, type Query, type SDKMessage } from '../src/index.js';
import { makeSSEFetch, type SSEFetchStub } from './helpers/sse-fetch.js';
import { textReplyEvents, toolUseReplyEvents } from './helpers/mock-transport.js';

let cwd: string;
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'l35-'));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(cwd, { recursive: true, force: true });
});

function opts(extra: Partial<Options> = {}): Options {
  return {
    provider: { apiKey: 'test-key', promptCaching: false },
    sessionDir: join(cwd, '.sessions'),
    cwd,
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    model: 'claude-sonnet-4-5',
    agents: { 'general-purpose': { description: 'worker', prompt: 'You are a worker.' } },
    ...extra,
  };
}
function stub(scripts: ReadonlyArray<readonly object[]>): SSEFetchStub {
  const s = makeSSEFetch(scripts);
  vi.stubGlobal('fetch', s);
  return s;
}

async function lifecycleOf(): Promise<{ names: string[]; vocab: string[]; encoding: Record<string, string> }> {
  const scripts = [
    toolUseReplyEvents('Agent', { subagent_type: 'general-purpose', description: 'demo', prompt: 'do work' }, { id: 'toolu_agent_1' }),
    textReplyEvents('SUBAGENT DONE'),
    textReplyEvents('MAIN DONE'),
  ];
  stub(scripts);
  const q: Query = query({ prompt: 'Delegate to a subagent.', options: opts({ allowedTools: ['Agent'] }) });
  const messages: SDKMessage[] = [];
  for await (const m of q) messages.push(m);
  // One ordered NAME per message: the lifecycle name (from type OR subtype)
  // when present, else the top-level type — so ordering assertions survive
  // the v0.7 system+subtype re-encoding.
  const names: string[] = [];
  const vocab = new Set<string>();
  const encoding: Record<string, string> = {};
  for (const m of messages) {
    let name = m.type as string;
    for (const c of [m.type, (m as { subtype?: string }).subtype]) {
      if (typeof c === 'string' && /^(task_|hook_)/.test(c)) {
        name = c;
        vocab.add(c);
        encoding[c] = m.type === 'system' ? 'system-subtype' : 'top-level-type';
      }
    }
    names.push(name);
  }
  return { names, vocab: [...vocab].sort(), encoding };
}

describe('L3.5 subagent lifecycle (our-arm lock)', () => {
  it('foreground spawn emits task_started -> task_progress -> task_updated before the result', async () => {
    const { names } = await lifecycleOf();
    expect(names.indexOf('task_started')).toBeGreaterThanOrEqual(0);
    expect(names.indexOf('task_started')).toBeLessThan(names.indexOf('task_progress'));
    expect(names.indexOf('task_progress')).toBeLessThan(names.indexOf('task_updated'));
    expect(names.indexOf('task_updated')).toBeLessThan(names.indexOf('result'));
  });

  it('KD-L35-01: our foreground vocabulary is exactly {started, progress, updated} (no task_notification foreground)', async () => {
    const { vocab } = await lifecycleOf();
    expect(vocab).toEqual(['task_progress', 'task_started', 'task_updated']);
    expect(vocab).not.toContain('task_notification'); // reserved for background agents on our arm
  });

  it('KD-L35-02 retired: task_* events are system SUBTYPES (official encoding, v0.7)', async () => {
    const { encoding } = await lifecycleOf();
    expect(encoding.task_started).toBe('system-subtype');
    expect(encoding.task_updated).toBe('system-subtype');
    expect(encoding.task_progress).toBe('system-subtype');
  });
});
