/**
 * Keeper ruling 2026-07-29 (待裁②) — a SECOND delivery channel for
 * background-task lifecycle events, aligning with the official
 * conversation / background-task split.
 *
 * This engine has always had the message TYPES for that world and emits four of
 * them, but they rode the SAME single pull-based SDKMessage stream as the
 * conversation, because there was no second delivery surface — three modules
 * say so in their own words (tools/monitor.ts "NO push delivery ... needs an
 * engine channel this SDK does not have", tools/workflow.ts "the engine has no
 * such channel for tool-launched work", SDKBackgroundTasksChangedMessage
 * "TYPED, not emitted").
 *
 * One channel is what made "a result ends the stream" bind background events
 * too: `abortAll()` runs in the query's teardown finally, so a terminal event
 * for a child it kills had nowhere legitimate to land — and a host task tracker
 * kept that child showing as "running" forever.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { query } from '../src/index.js';
import type { Options, Query, SDKBackgroundEvent, SDKMessage } from '../src/types.js';
import { encodeSSEFrame } from './helpers/sse-fetch.js';
import { textReplyEvents, toolUseReplyEvents } from './helpers/mock-transport.js';

let cwd: string;
let sessionDir: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'bpt-w22-bg-cwd-'));
  sessionDir = await mkdtemp(join(tmpdir(), 'bpt-w22-bg-sess-'));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(cwd, { recursive: true, force: true });
  await rm(sessionDir, { recursive: true, force: true });
});

function baseOptions(extra: Partial<Options> = {}): Options {
  return {
    provider: { apiKey: 'test-key', promptCaching: false },
    sessionDir,
    cwd,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, BPT_HTTP_CLIENT: 'fetch' },
    model: 'claude-sonnet-4-5',
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    agents: { worker: { description: 'w', prompt: 'WORKER_SYS_PROMPT' } },
    ...extra,
  };
}

/** Parent spawns ONE background subagent, then finishes normally. The child's
 *  stream never yields and never closes, so it is still running when the query
 *  tears down — the exact shape abortAll() exists for. */
function stubSpawnBackgroundChild(): void {
  let parentCall = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: unknown, init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init?.body)) as { system?: unknown };
      if (String(body.system ?? '').includes('WORKER_SYS_PROMPT')) {
        return new Response(new ReadableStream<Uint8Array>({ start() {} }), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      const idx = parentCall;
      parentCall += 1;
      const events =
        idx === 0
          ? toolUseReplyEvents('Agent', {
              subagent_type: 'worker',
              prompt: 'do work',
              description: 'bg',
              run_in_background: true,
            })
          : textReplyEvents('parent done');
      return new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            for (const e of events) c.enqueue(encodeSSEFrame(e));
            c.close();
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    }),
  );
}

async function collect(q: Query): Promise<SDKMessage[]> {
  const out: SDKMessage[] = [];
  for await (const m of q) out.push(m);
  return out;
}

const backgroundSubtypes = (msgs: SDKMessage[]): string[] =>
  msgs
    .filter(
      (m): m is SDKMessage & { subtype: string } =>
        m.type === 'system' && typeof (m as { subtype?: unknown }).subtype === 'string',
    )
    .map((m) => m.subtype)
    .filter((s) => s.startsWith('task_') || s === 'background_tasks_changed');

describe('wave22: the background-task delivery channel', () => {
  it('routes task lifecycle events to onBackgroundEvent, not into the stream', async () => {
    stubSpawnBackgroundChild();
    const seen: SDKBackgroundEvent[] = [];
    const messages = await collect(
      query({
        prompt: 'go',
        options: baseOptions({ onBackgroundEvent: (e) => seen.push(e) }),
      }),
    );

    expect(seen.map((e) => e.subtype)).toContain('task_started');
    // ...and the SAME events are NOT also in the stream: no de-duplication
    // burden on the host.
    expect(backgroundSubtypes(messages)).toEqual([]);
  });

  it('abortAll now emits a terminal event for the child it kills', async () => {
    stubSpawnBackgroundChild();
    const seen: SDKBackgroundEvent[] = [];
    await collect(
      query({
        prompt: 'go',
        options: baseOptions({ onBackgroundEvent: (e) => seen.push(e) }),
      }),
    );

    const terminal = seen.filter(
      (e): e is SDKBackgroundEvent & { subtype: 'task_updated'; patch: { status?: string } } =>
        e.subtype === 'task_updated',
    );
    // Before the channel existed the child was killed silently and a host task
    // tracker kept it "running" forever.
    expect(terminal.some((e) => e.patch.status === 'killed')).toBe(true);
    // Every started task reaches a terminal state.
    const started = seen.filter((e) => e.subtype === 'task_started').length;
    expect(started).toBeGreaterThan(0);
    expect(terminal.length).toBeGreaterThanOrEqual(started);
  });

  it('the stream still ends with the result — the contract is not traded away', async () => {
    stubSpawnBackgroundChild();
    const messages = await collect(
      query({ prompt: 'go', options: baseOptions({ onBackgroundEvent: () => {} }) }),
    );
    expect(messages[messages.length - 1]?.type).toBe('result');
  });

  it('a throwing host sink cannot alter or abort the run', async () => {
    stubSpawnBackgroundChild();
    const messages = await collect(
      query({
        prompt: 'go',
        options: baseOptions({
          onBackgroundEvent: () => {
            throw new Error('host sink exploded');
          },
        }),
      }),
    );
    expect(messages[messages.length - 1]).toMatchObject({ type: 'result', subtype: 'success' });
  });

  // --- negative controls: omitting the option changes nothing ---------------

  it('WITHOUT the option the events stay in the stream, exactly as before', async () => {
    stubSpawnBackgroundChild();
    const messages = await collect(query({ prompt: 'go', options: baseOptions() }));
    expect(backgroundSubtypes(messages)).toContain('task_started');
    expect(messages[messages.length - 1]?.type).toBe('result');
  });

  it('WITHOUT the option abortAll stays silent, rather than breaking the stream', async () => {
    // The previous behavior is preserved deliberately: with one channel a
    // teardown event would land BEHIND the terminal result. Trading a missing
    // event for a broken stream contract is not a fix.
    stubSpawnBackgroundChild();
    const messages = await collect(query({ prompt: 'go', options: baseOptions() }));
    const afterResult = messages.slice(
      messages.findIndex((m) => m.type === 'result') + 1,
    );
    expect(afterResult).toEqual([]);
  });
});
