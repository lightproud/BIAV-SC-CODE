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
 *   (agent-sdk 0.3.199 / claude-code 2.1.201).
 * KD-L35-02 (encoding): the shared names (task_started / task_updated) are
 *   TOP-LEVEL message types on our arm ({type:'task_started'}) but system
 *   SUBTYPES on the official arm ({type:'system', subtype:'task_started'}) -
 *   the same type-vs-subtype granularity family as KD-05. An engine-alignment
 *   candidate for Desktop consumers that switch on message.type.
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

async function lifecycleOf(): Promise<{ types: string[]; vocab: string[]; encoding: Record<string, string> }> {
  const scripts = [
    toolUseReplyEvents('Agent', { subagent_type: 'general-purpose', description: 'demo', prompt: 'do work' }, { id: 'toolu_agent_1' }),
    textReplyEvents('SUBAGENT DONE'),
    textReplyEvents('MAIN DONE'),
  ];
  stub(scripts);
  const q: Query = query({ prompt: 'Delegate to a subagent.', options: opts({ allowedTools: ['Agent'] }) });
  const messages: SDKMessage[] = [];
  for await (const m of q) messages.push(m);
  const types = messages.map((m) => m.type);
  const vocab = new Set<string>();
  const encoding: Record<string, string> = {};
  for (const m of messages) {
    for (const c of [m.type, (m as { subtype?: string }).subtype]) {
      if (typeof c === 'string' && /^(task_|hook_)/.test(c)) {
        vocab.add(c);
        encoding[c] = m.type === 'system' ? 'system-subtype' : 'top-level-type';
      }
    }
  }
  return { types, vocab: [...vocab].sort(), encoding };
}

describe('L3.5 subagent lifecycle (our-arm lock)', () => {
  it('foreground spawn emits task_started -> task_progress -> task_updated before the result', async () => {
    const { types } = await lifecycleOf();
    expect(types.indexOf('task_started')).toBeGreaterThanOrEqual(0);
    expect(types.indexOf('task_started')).toBeLessThan(types.indexOf('task_progress'));
    expect(types.indexOf('task_progress')).toBeLessThan(types.indexOf('task_updated'));
    expect(types.indexOf('task_updated')).toBeLessThan(types.indexOf('result'));
  });

  it('KD-L35-01: our foreground vocabulary is exactly {started, progress, updated} (no task_notification foreground)', async () => {
    const { vocab } = await lifecycleOf();
    expect(vocab).toEqual(['task_progress', 'task_started', 'task_updated']);
    expect(vocab).not.toContain('task_notification'); // reserved for background agents on our arm
  });

  it('KD-L35-02: our task_* events are TOP-LEVEL message types (not system subtypes)', async () => {
    const { encoding } = await lifecycleOf();
    expect(encoding.task_started).toBe('top-level-type');
    expect(encoding.task_updated).toBe('top-level-type');
    expect(encoding.task_progress).toBe('top-level-type');
  });
});
