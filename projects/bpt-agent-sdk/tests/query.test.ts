/**
 * Module G end-to-end tests: query() driven through the real
 * AnthropicTransport against a scripted SSE fetch stub (no network).
 *
 * Every test supplies provider: { apiKey: 'test-key' } and mkdtemp
 * sandboxes for sessionDir and cwd.
 */

import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getSessionInfo,
  isAbortError,
  listSessions,
  query,
} from '../src/index.js';
import type {
  Options,
  Query,
  SDKAssistantMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
  SDKSystemMessage,
  SDKUserMessage,
  ToolResultBlockParam,
  ToolUseBlockParam,
} from '../src/types.js';
import {
  textReplyEvents,
  toolUseReplyEvents,
} from './helpers/mock-transport.js';
import { HANG_STREAM, makeSSEFetch } from './helpers/sse-fetch.js';
import type { SSEFetchStub } from './helpers/sse-fetch.js';

let sessionDir: string;
let cwd: string;

beforeEach(async () => {
  sessionDir = await mkdtemp(join(tmpdir(), 'bpt-query-sess-'));
  cwd = await mkdtemp(join(tmpdir(), 'bpt-query-cwd-'));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(sessionDir, { recursive: true, force: true });
  await rm(cwd, { recursive: true, force: true });
});

function baseOptions(extra: Partial<Options> = {}): Options {
  return {
    provider: { apiKey: 'test-key' },
    sessionDir,
    cwd,
    // Hermetic env: no ANTHROPIC_* leakage; PATH kept so Bash can spawn.
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    model: 'claude-sonnet-4-5',
    ...extra,
  };
}

function stubFetch(stub: SSEFetchStub): SSEFetchStub {
  vi.stubGlobal('fetch', stub);
  return stub;
}

async function collect(q: Query): Promise<SDKMessage[]> {
  const out: SDKMessage[] = [];
  for await (const m of q) out.push(m);
  return out;
}

function lastResult(messages: SDKMessage[]): SDKResultMessage {
  const last = messages[messages.length - 1];
  expect(last?.type).toBe('result');
  return last as SDKResultMessage;
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const BUILTIN_TOOL_NAMES = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'];

describe('query() e2e - happy path', () => {
  it('emits init, user echo, assistant, success result in order with one session_id', async () => {
    const fetchStub = stubFetch(makeSSEFetch([textReplyEvents('Hello, keeper.')]));
    const q = query({ prompt: 'hi there', options: baseOptions() });
    const messages = await collect(q);

    expect(messages.map((m) => m.type)).toEqual([
      'system',
      'user',
      'assistant',
      'result',
    ]);

    const init = messages[0] as SDKSystemMessage;
    expect(init.subtype).toBe('init');
    expect(init.tools).toEqual(expect.arrayContaining(BUILTIN_TOOL_NAMES));
    expect(init.model).toBe('claude-sonnet-4-5');
    expect(init.permissionMode).toBe('default');
    expect(init.apiKeySource).toBe('user');
    expect(init.cwd).toBe(cwd);

    const user = messages[1] as SDKUserMessage;
    expect(user.message).toEqual({ role: 'user', content: 'hi there' });
    expect(typeof user.uuid).toBe('string');
    expect(user.uuid?.length).toBeGreaterThan(0);

    const assistant = messages[2] as SDKAssistantMessage;
    expect(
      assistant.message.content.some(
        (b) => b.type === 'text' && b.text === 'Hello, keeper.',
      ),
    ).toBe(true);

    const result = lastResult(messages);
    expect(result.subtype).toBe('success');
    expect(result.is_error).toBe(false);
    if (result.subtype === 'success') {
      expect(result.result).toBe('Hello, keeper.');
      expect(result.stop_reason).toBe('end_turn');
    }
    expect(result.num_turns).toBe(1);
    expect(result.usage).toEqual({
      input_tokens: 25,
      output_tokens: 7,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    });
    expect(result.permission_denials).toEqual([]);

    // session_id consistent across every message.
    expect(new Set(messages.map((m) => m.session_id)).size).toBe(1);
    expect(init.session_id.length).toBeGreaterThan(0);

    // Request body: system prompt string, user message, stream flag, tools.
    expect(fetchStub.requests).toHaveLength(1);
    const body = fetchStub.requests[0]!.body;
    expect(typeof body.system).toBe('string');
    expect((body.system as string).length).toBeGreaterThan(0);
    expect(body.stream).toBe(true);
    expect(body.model).toBe('claude-sonnet-4-5');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi there' }]);
    const toolNames = (body.tools as Array<{ name: string }>).map((t) => t.name);
    expect(toolNames).toEqual(expect.arrayContaining(BUILTIN_TOOL_NAMES));
    expect(fetchStub.requests[0]!.headers['x-api-key']).toBe('test-key');
  });

  it('includePartialMessages yields stream_event messages for each raw event', async () => {
    stubFetch(makeSSEFetch([textReplyEvents('partial')]));
    const q = query({
      prompt: 'stream please',
      options: baseOptions({ includePartialMessages: true }),
    });
    const messages = await collect(q);

    const streamEvents = messages.filter(
      (m): m is SDKPartialAssistantMessage => m.type === 'stream_event',
    );
    expect(streamEvents.map((m) => m.event.type)).toEqual([
      'message_start',
      'content_block_start',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ]);
    // Partial events arrive between the user echo and the assistant message.
    expect(messages.map((m) => m.type)).toEqual([
      'system',
      'user',
      ...Array<string>(6).fill('stream_event'),
      'assistant',
      'result',
    ]);
    const sessionId = messages[0]!.session_id;
    for (const ev of streamEvents) expect(ev.session_id).toBe(sessionId);
  });
});

describe('query() e2e - tool roundtrip', () => {
  it('executes Bash and feeds tool_result back in the second request', async () => {
    const fetchStub = stubFetch(
      makeSSEFetch([
        toolUseReplyEvents('Bash', { command: 'echo hi' }),
        textReplyEvents('done'),
      ]),
    );
    const q = query({
      prompt: 'run echo',
      options: baseOptions({ permissionMode: 'bypassPermissions' }),
    });
    const messages = await collect(q);

    expect((messages[0] as SDKSystemMessage).permissionMode).toBe(
      'bypassPermissions',
    );
    expect(fetchStub.requests).toHaveLength(2);

    const body2 = fetchStub.requests[1]!.body;
    const msgs = body2.messages as Array<{ role: string; content: unknown }>;
    expect(msgs).toHaveLength(3);
    expect(msgs[0]).toEqual({ role: 'user', content: 'run echo' });
    expect(msgs[1]!.role).toBe('assistant');
    const toolUse = (msgs[1]!.content as ToolUseBlockParam[]).find(
      (b) => b.type === 'tool_use',
    );
    expect(toolUse?.name).toBe('Bash');
    expect(toolUse?.input).toEqual({ command: 'echo hi' });

    expect(msgs[2]!.role).toBe('user');
    const results = msgs[2]!.content as ToolResultBlockParam[];
    expect(Array.isArray(results)).toBe(true);
    expect(results[0]!.type).toBe('tool_result');
    expect(results[0]!.tool_use_id).toBe('toolu_mock_1');
    expect(results[0]!.is_error).not.toBe(true);
    expect(JSON.stringify(results[0]!.content)).toContain('hi');

    const result = lastResult(messages);
    expect(result.subtype).toBe('success');
    if (result.subtype === 'success') expect(result.result).toBe('done');
    expect(result.num_turns).toBe(2);
  });

  it('PreToolUse deny hook produces an is_error tool_result and a recorded denial', async () => {
    const fetchStub = stubFetch(
      makeSSEFetch([
        toolUseReplyEvents('Bash', { command: 'echo should-not-run' }),
        textReplyEvents('after deny'),
      ]),
    );
    const q = query({
      prompt: 'try a denied tool',
      options: baseOptions({
        hooks: {
          PreToolUse: [
            {
              hooks: [
                async () => ({
                  hookSpecificOutput: {
                    hookEventName: 'PreToolUse' as const,
                    permissionDecision: 'deny' as const,
                    permissionDecisionReason: 'denied by test hook',
                  },
                }),
              ],
            },
          ],
        },
      }),
    });
    const messages = await collect(q);

    expect(fetchStub.requests).toHaveLength(2);
    const msgs = fetchStub.requests[1]!.body.messages as Array<{
      role: string;
      content: unknown;
    }>;
    const results = msgs[2]!.content as ToolResultBlockParam[];
    expect(results[0]!.type).toBe('tool_result');
    expect(results[0]!.is_error).toBe(true);
    expect(String(results[0]!.content)).toContain('Bash');

    const result = lastResult(messages);
    expect(result.subtype).toBe('success');
    expect(result.permission_denials.length).toBeGreaterThan(0);
    expect(
      result.permission_denials.some(
        (d) => d.tool_name === 'Bash' && d.tool_use_id === 'toolu_mock_1',
      ),
    ).toBe(true);
  });
});

describe('query() e2e - UserPromptSubmit hooks', () => {
  it('appends additionalContext to the user prompt text', async () => {
    const fetchStub = stubFetch(makeSSEFetch([textReplyEvents('ok')]));
    const q = query({
      prompt: 'original prompt',
      options: baseOptions({
        hooks: {
          UserPromptSubmit: [
            {
              hooks: [
                async () => ({
                  hookSpecificOutput: {
                    hookEventName: 'UserPromptSubmit' as const,
                    additionalContext: 'context-from-hook',
                  },
                }),
              ],
            },
          ],
        },
      }),
    });
    const messages = await collect(q);

    const expected = 'original prompt\ncontext-from-hook';
    const echoed = messages.find((m) => m.type === 'user') as SDKUserMessage;
    expect(echoed.message.content).toBe(expected);
    expect(fetchStub.requests[0]!.body.messages).toEqual([
      { role: 'user', content: expected },
    ]);
    expect(lastResult(messages).subtype).toBe('success');
  });

  it('continue:false blocks the prompt: error_during_execution and no fetch call', async () => {
    const fetchStub = stubFetch(makeSSEFetch([textReplyEvents('never sent')]));
    const q = query({
      prompt: 'should be blocked',
      options: baseOptions({
        hooks: {
          UserPromptSubmit: [
            {
              hooks: [
                async () => ({ continue: false, stopReason: 'blocked by test' }),
              ],
            },
          ],
        },
      }),
    });
    const messages = await collect(q);

    expect(messages.map((m) => m.type)).toEqual(['system', 'result']);
    const result = lastResult(messages);
    expect(result.subtype).toBe('error_during_execution');
    expect(result.is_error).toBe(true);
    if (result.subtype !== 'success') {
      expect(result.errorMessage).toBe('blocked by test');
    }
    expect(fetchStub.requests).toHaveLength(0);
    expect(fetchStub).not.toHaveBeenCalled();
  });
});

describe('query() e2e - persistence and resume', () => {
  async function runOnce(prompt: string, reply: string): Promise<SDKMessage[]> {
    stubFetch(makeSSEFetch([textReplyEvents(reply)]));
    const q = query({ prompt, options: baseOptions() });
    return collect(q);
  }

  it('persists the transcript and resume: <id> replays prior turns', async () => {
    const first = await runOnce('first prompt', 'first reply');
    const sid = first[0]!.session_id;
    expect(await readdir(sessionDir)).toContain(`${sid}.jsonl`);

    const fetch2 = stubFetch(makeSSEFetch([textReplyEvents('second reply')]));
    const q2 = query({
      prompt: 'second prompt',
      options: baseOptions({ resume: sid }),
    });
    const second = await collect(q2);

    expect(second[0]!.session_id).toBe(sid);
    expect(new Set(second.map((m) => m.session_id)).size).toBe(1);
    const body = fetch2.requests[0]!.body;
    const msgs = body.messages as Array<{ role: string; content: unknown }>;
    expect(msgs).toHaveLength(3);
    expect(msgs[0]).toEqual({ role: 'user', content: 'first prompt' });
    expect(msgs[1]!.role).toBe('assistant');
    expect(JSON.stringify(msgs[1]!.content)).toContain('first reply');
    expect(msgs[2]).toEqual({ role: 'user', content: 'second prompt' });
    expect(lastResult(second).subtype).toBe('success');
  });

  it('forkSession copies the transcript under a fresh session id', async () => {
    const first = await runOnce('fork base', 'fork base reply');
    const sid = first[0]!.session_id;

    const fetch2 = stubFetch(makeSSEFetch([textReplyEvents('forked reply')]));
    const q2 = query({
      prompt: 'forked prompt',
      options: baseOptions({ resume: sid, forkSession: true }),
    });
    const second = await collect(q2);

    const forkedId = second[0]!.session_id;
    expect(forkedId).not.toBe(sid);
    expect(new Set(second.map((m) => m.session_id)).size).toBe(1);

    // Prior turns still ride into the first request of the forked run.
    const msgs = fetch2.requests[0]!.body.messages as Array<{
      role: string;
      content: unknown;
    }>;
    expect(msgs).toHaveLength(3);
    expect(msgs[0]).toEqual({ role: 'user', content: 'fork base' });

    // Both the original and the forked transcript exist on disk.
    const files = await readdir(sessionDir);
    expect(files).toContain(`${sid}.jsonl`);
    expect(files).toContain(`${forkedId}.jsonl`);
  });

  it('continue:true resumes the latest persisted session', async () => {
    const first = await runOnce('continue base', 'continue base reply');
    const sid = first[0]!.session_id;

    const fetch2 = stubFetch(makeSSEFetch([textReplyEvents('continued')]));
    const q2 = query({
      prompt: 'continue prompt',
      options: baseOptions({ continue: true }),
    });
    const second = await collect(q2);

    expect(second[0]!.session_id).toBe(sid);
    const msgs = fetch2.requests[0]!.body.messages as Array<{
      role: string;
      content: unknown;
    }>;
    expect(msgs).toHaveLength(3);
    expect(msgs[0]).toEqual({ role: 'user', content: 'continue base' });
  });

  it('persistSession:false writes nothing to the session directory', async () => {
    stubFetch(makeSSEFetch([textReplyEvents('ephemeral')]));
    const q = query({
      prompt: 'do not persist',
      options: baseOptions({ persistSession: false }),
    });
    const messages = await collect(q);
    expect(lastResult(messages).subtype).toBe('success');
    expect(await readdir(sessionDir)).toEqual([]);
  });

  it('listSessions/getSessionInfo surface the persisted session', async () => {
    const messages = await runOnce('list me please\nsecond line', 'ok');
    const sid = messages[0]!.session_id;

    const infos = await listSessions({ sessionDir });
    expect(infos).toHaveLength(1);
    expect(infos[0]!.sessionId).toBe(sid);
    expect(infos[0]!.firstPrompt).toBe('list me please\nsecond line');
    expect(infos[0]!.summary).toBe('list me please');
    expect(infos[0]!.fileSize).toBeGreaterThan(0);
    expect(infos[0]!.lastModified).toBeGreaterThan(0);

    const info = await getSessionInfo(sid, { sessionDir });
    expect(info).not.toBeNull();
    expect(info!.sessionId).toBe(sid);
    expect(info!.cwd).toBe(cwd);
    expect(info!.createdAt).toBeGreaterThan(0);

    expect(await getSessionInfo('no-such-session', { sessionDir })).toBeNull();
  });
});

describe('query() e2e - compat options, budget, control surface', () => {
  it('ACCEPTED options warn via debug stderr and do not throw', async () => {
    stubFetch(makeSSEFetch([textReplyEvents('compat ok')]));
    const lines: string[] = [];
    const options = baseOptions({
      debug: true,
      stderr: (data) => lines.push(data),
      settingSources: ['project'],
    });
    // 'plugins' is reference-SDK-only; migration call sites pass it through
    // a widened object.
    (options as Record<string, unknown>).plugins = [];

    const q = query({ prompt: 'compat run', options });
    const messages = await collect(q);
    expect(lastResult(messages).subtype).toBe('success');

    expect(lines.some((l) => l.includes("option 'settingSources'"))).toBe(true);
    expect(lines.some((l) => l.includes("option 'plugins'"))).toBe(true);
    expect(
      lines
        .filter((l) => l.includes("option '"))
        .every((l) => l.includes('no effect in v0.1')),
    ).toBe(true);
  });

  it('microscopic maxBudgetUsd with a priced model yields error_max_budget', async () => {
    stubFetch(
      makeSSEFetch([textReplyEvents('pricey', { model: 'claude-opus-4-8' })]),
    );
    const q = query({
      prompt: 'expensive',
      options: baseOptions({ maxBudgetUsd: 0.0000001 }),
    });
    const messages = await collect(q);

    expect(messages.map((m) => m.type)).toEqual([
      'system',
      'user',
      'assistant',
      'result',
    ]);
    const result = lastResult(messages);
    expect(result.subtype).toBe('error_max_budget');
    expect(result.is_error).toBe(true);
    // 25 in * $15/MTok + 7 out * $75/MTok = $0.0009 (opus-4 family pricing).
    expect(result.total_cost_usd).toBeCloseTo(0.0009, 9);
    expect(result.modelUsage['claude-opus-4-8']!.costUSD).toBeCloseTo(0.0009, 9);
    if (result.subtype !== 'success') {
      expect(result.errorMessage).toContain('maxBudgetUsd');
    }
  });

  it('supportedModels/supportedCommands/mcpServerStatus/accountInfo/initializationResult shapes', async () => {
    stubFetch(makeSSEFetch([textReplyEvents('surface ok')]));
    const q = query({ prompt: 'surfaces', options: baseOptions() });

    const models = await q.supportedModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models.every((m) => typeof m.id === 'string')).toBe(true);
    expect(models.some((m) => m.id === 'claude-sonnet-4-5')).toBe(true);

    expect(await q.supportedCommands()).toEqual([]);
    expect(await q.supportedAgents()).toEqual([]);
    expect(await q.mcpServerStatus()).toEqual([]);
    expect(await q.accountInfo()).toEqual({ apiKeySource: 'user' });

    const messages = await collect(q);
    expect(lastResult(messages).subtype).toBe('success');

    const init = await q.initializationResult();
    expect(init.commands).toEqual([]);
    expect(init.agents).toEqual([]);
    expect(init.output_style).toBe('default');
    expect(init.available_output_styles).toContain('default');
    expect(init.models.length).toBeGreaterThan(0);
    expect(init.account).toEqual({ apiKeySource: 'user' });
  });
});

describe('query() e2e - interrupt and close', () => {
  it('interrupt() in string mode ends the run', async () => {
    stubFetch(makeSSEFetch([[HANG_STREAM]]));
    const q = query({ prompt: 'interrupt me', options: baseOptions() });

    const first = await q.next();
    expect(first.done).toBe(false);
    expect((first.value as SDKMessage).type).toBe('system');
    const second = await q.next();
    expect((second.value as SDKMessage).type).toBe('user');

    const pending = q.next(); // enters the turn; the transport stream hangs
    await delay(25);
    await q.interrupt();

    const res = await pending;
    expect(res.done).toBe(true);
  });

  it('close() after the first message ends the generator promptly with no unhandled rejections', async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on('unhandledRejection', onRejection);
    try {
      stubFetch(makeSSEFetch([[HANG_STREAM]]));
      const q = query({ prompt: 'close me', options: baseOptions() });

      const first = await q.next();
      expect(first.done).toBe(false);
      expect((first.value as SDKMessage).type).toBe('system');
      const second = await q.next();
      expect((second.value as SDKMessage).type).toBe('user');

      const pending = q.next(); // mid-turn on a hanging stream
      await delay(25);
      q.close();

      // The pending next() must settle promptly: either the generator ends
      // (done) or it surfaces the abort as an AbortError.
      const settled = await pending.then(
        (r) => ({ rejected: false as const, r }),
        (e: unknown) => ({ rejected: true as const, e }),
      );
      if (settled.rejected) {
        expect(isAbortError(settled.e)).toBe(true);
      } else {
        expect(settled.r.done).toBe(true);
      }

      // The generator is finished afterwards.
      const after = await q
        .next()
        .then(
          (r) => r,
          (e: unknown) => {
            expect(isAbortError(e)).toBe(true);
            return { done: true as const, value: undefined };
          },
        );
      expect(after.done).toBe(true);

      // Give any stray rejection a chance to surface, then assert none did.
      await delay(50);
      expect(rejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });
});
