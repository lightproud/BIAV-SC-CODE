/**
 * Module G end-to-end tests: query() driven through the real
 * AnthropicTransport against a scripted SSE fetch stub (no network).
 *
 * Every test supplies provider: { apiKey: 'test-key' } and mkdtemp
 * sandboxes for sessionDir and cwd.
 */

import { getEventListeners } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
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

/** A streaming-input user message with a plain string body. */
const userMsg = (content: string): SDKUserMessage => ({
  type: 'user',
  session_id: '',
  message: { role: 'user', content },
  parent_tool_use_id: null,
});

function resultsOf(messages: SDKMessage[]): SDKResultMessage[] {
  return messages.filter((m): m is SDKResultMessage => m.type === 'result');
}

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

  it('microscopic maxBudgetUsd with a priced model yields error_max_budget_usd before the next billable call', async () => {
    // Post-#3 the budget is enforced only when about to CONTINUE the loop with
    // another (billable) API call, so exercise a tool_use turn: turn 1 spends,
    // the gate fires before turn 2, and the second script is never consumed.
    const fetchStub = stubFetch(
      makeSSEFetch([
        toolUseReplyEvents('Bash', { command: 'echo hi' }, { model: 'claude-opus-4-8' }),
        textReplyEvents('should not run', { model: 'claude-opus-4-8' }),
      ]),
    );
    const q = query({
      prompt: 'expensive',
      options: baseOptions({
        maxBudgetUsd: 0.0000001,
        permissionMode: 'bypassPermissions',
      }),
    });
    const messages = await collect(q);

    const result = lastResult(messages);
    expect(result.subtype).toBe('error_max_budget_usd');
    expect(result.is_error).toBe(true);
    // opus-4 family: 25 in * $15/MTok + 11 out * $75/MTok = $0.0012.
    expect(result.total_cost_usd).toBeCloseTo(0.0012, 9);
    expect(result.modelUsage['claude-opus-4-8']!.costUSD).toBeCloseTo(0.0012, 9);
    if (result.subtype !== 'success') {
      expect(result.errorMessage).toContain('maxBudgetUsd');
    }
    // Budget gate fired BEFORE the second (billable) API call.
    expect(fetchStub.requests).toHaveLength(1);
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
  it('interrupt() in string mode emits a terminal result then ends the run (#36)', async () => {
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

    // Post-fix, a string-mode interrupt surfaces a terminal result rather than
    // silently ending, so a consumer awaiting a result is not left hanging.
    const res = await pending;
    expect(res.done).toBe(false);
    const result = res.value as SDKResultMessage;
    expect(result.type).toBe('result');
    expect(result.subtype).toBe('error_during_execution');
    if (result.subtype !== 'success') {
      expect(result.errorMessage).toContain('interrupted');
    }

    // The generator is finished afterwards.
    const after = await q.next();
    expect(after.done).toBe(true);
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

describe('query() e2e - confirmed-finding regressions', () => {
  it('initializationResult() settles even if the query is never iterated (#14/#28)', async () => {
    stubFetch(makeSSEFetch([textReplyEvents('never iterated')]));
    const q = query({ prompt: 'hi', options: baseOptions() });

    // Awaiting init BEFORE the first next() previously deadlocked forever.
    const init = await Promise.race([
      q.initializationResult(),
      delay(1500).then(() => {
        throw new Error('initializationResult() timed out (deadlock)');
      }),
    ]);
    expect(init.output_style).toBe('default');
    expect(init.models.length).toBeGreaterThan(0);
    q.close();
  });

  it('does not leak abort listeners when one AbortController is reused across queries (#16)', async () => {
    const controller = new AbortController();
    for (let i = 0; i < 5; i += 1) {
      stubFetch(makeSSEFetch([textReplyEvents(`reply ${i}`)]));
      const q = query({
        prompt: `run ${i}`,
        options: baseOptions({ abortController: controller }),
      });
      expect(lastResult(await collect(q)).subtype).toBe('success');
    }
    // Every completed query must have removed its own listener.
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });

  it('yields a tool_result user message on the SDK stream in order (#27)', async () => {
    stubFetch(
      makeSSEFetch([
        toolUseReplyEvents('Bash', { command: 'echo hi' }),
        textReplyEvents('done'),
      ]),
    );
    const q = query({
      prompt: 'run',
      options: baseOptions({ permissionMode: 'bypassPermissions' }),
    });
    const messages = await collect(q);

    // Full ordered stream: the tool_result user turn appears between the
    // tool_use assistant and the final assistant answer.
    expect(messages.map((m) => m.type)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
      'assistant',
      'result',
    ]);

    const userMsgs = messages.filter(
      (m): m is SDKUserMessage => m.type === 'user',
    );
    expect(userMsgs).toHaveLength(2); // echo + tool_result
    const toolResultUser = userMsgs[1]!;
    const blocks = toolResultUser.message.content as ToolResultBlockParam[];
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks[0]!.type).toBe('tool_result');
    expect(blocks[0]!.tool_use_id).toBe('toolu_mock_1');
    expect(toolResultUser.session_id).toBe(messages[0]!.session_id);
  });

  it('setModel between streaming turns applies to the next turn request (#29)', async () => {
    const fetchStub = stubFetch(
      makeSSEFetch([textReplyEvents('r1'), textReplyEvents('r2')]),
    );
    let releaseSecond!: () => void;
    const secondGate = new Promise<void>((r) => {
      releaseSecond = r;
    });
    async function* inputs(): AsyncGenerator<SDKUserMessage> {
      yield userMsg('first');
      await secondGate;
      yield userMsg('second');
    }

    const q = query({ prompt: inputs(), options: baseOptions() });
    let resultsSeen = 0;
    for await (const m of q) {
      if (m.type === 'result') {
        resultsSeen += 1;
        if (resultsSeen === 1) {
          await q.setModel('claude-opus-4-8');
          releaseSecond();
        }
      }
    }

    expect(fetchStub.requests).toHaveLength(2);
    expect(fetchStub.requests[0]!.body.model).toBe('claude-sonnet-4-5');
    expect(fetchStub.requests[1]!.body.model).toBe('claude-opus-4-8');
  });

  it('accumulates usage/cost/turns session-wide across streaming turns (#33)', async () => {
    const fetchStub = stubFetch(
      makeSSEFetch([
        textReplyEvents('r1', { model: 'claude-opus-4-8' }),
        textReplyEvents('r2', { model: 'claude-opus-4-8' }),
      ]),
    );
    async function* inputs(): AsyncGenerator<SDKUserMessage> {
      yield userMsg('first');
      yield userMsg('second');
    }
    const q = query({ prompt: inputs(), options: baseOptions() });
    const results = resultsOf(await collect(q));

    expect(results).toHaveLength(2);
    // First result = turn-1 totals; second = cumulative (turn1 + turn2).
    expect(results[0]!.num_turns).toBe(1);
    expect(results[1]!.num_turns).toBe(2);
    expect(results[1]!.total_cost_usd).toBeCloseTo(
      results[0]!.total_cost_usd * 2,
      9,
    );
    expect(results[1]!.usage.input_tokens).toBe(
      results[0]!.usage.input_tokens * 2,
    );
    expect(fetchStub.requests).toHaveLength(2);
  });

  it('enforces maxBudgetUsd session-wide across streaming turns (#33)', async () => {
    const fetchStub = stubFetch(
      makeSSEFetch([
        textReplyEvents('r1', { model: 'claude-opus-4-8' }),
        textReplyEvents('r2', { model: 'claude-opus-4-8' }),
      ]),
    );
    async function* inputs(): AsyncGenerator<SDKUserMessage> {
      yield userMsg('first');
      yield userMsg('second');
    }
    // Turn 1 (~$0.0009) alone exceeds the cap, so turn 2 must be blocked
    // before its (billable) API call by the session-wide budget.
    const q = query({
      prompt: inputs(),
      options: baseOptions({ maxBudgetUsd: 0.0005 }),
    });
    const results = resultsOf(await collect(q));

    expect(results[0]!.subtype).toBe('success');
    expect(results[results.length - 1]!.subtype).toBe('error_max_budget_usd');
    expect(fetchStub.requests).toHaveLength(1);
  });

  it('persists the final assistant answer even if the consumer breaks after it (#34)', async () => {
    stubFetch(makeSSEFetch([textReplyEvents('the final answer')]));
    const q = query({ prompt: 'question', options: baseOptions() });

    let sid = '';
    for await (const m of q) {
      if (m.type === 'system') sid = m.session_id;
      if (m.type === 'assistant') break; // stop before the result message
    }

    const contents = await readFile(join(sessionDir, `${sid}.jsonl`), 'utf8');
    const lines = contents
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { type: string });
    expect(lines.some((l) => l.type === 'assistant')).toBe(true);
    expect(contents).toContain('the final answer');
  });

  it('UserPromptSubmit block skips only the blocked prompt in streaming mode (#35)', async () => {
    const fetchStub = stubFetch(
      makeSSEFetch([textReplyEvents('reply A'), textReplyEvents('reply C')]),
    );
    async function* inputs(): AsyncGenerator<SDKUserMessage> {
      yield userMsg('prompt A');
      yield userMsg('prompt B'); // blocked
      yield userMsg('prompt C');
    }
    let seen = 0;
    const q = query({
      prompt: inputs(),
      options: baseOptions({
        hooks: {
          UserPromptSubmit: [
            {
              hooks: [
                async () => {
                  seen += 1;
                  return seen === 2
                    ? { continue: false, stopReason: 'no B allowed' }
                    : {};
                },
              ],
            },
          ],
        },
      }),
    });
    const messages = await collect(q);

    // Two turns ran (A and C); B was skipped rather than ending the session.
    const results = resultsOf(messages);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.subtype === 'success')).toBe(true);
    expect(fetchStub.requests).toHaveLength(2);
    const echoes = messages
      .filter((m): m is SDKUserMessage => m.type === 'user')
      .map((m) => m.message.content);
    expect(echoes).toEqual(['prompt A', 'prompt C']);
  });

  it('interrupt() right after init cancels the upcoming turn (#36)', async () => {
    stubFetch(makeSSEFetch([[HANG_STREAM]]));
    const q = query({ prompt: 'go', options: baseOptions() });

    const first = await q.next();
    expect((first.value as SDKMessage).type).toBe('system');
    // No turn is active yet; the cancel must still take effect on the next one.
    await q.interrupt();

    const rest: SDKMessage[] = [];
    for await (const m of q) rest.push(m);
    const result = rest[rest.length - 1] as SDKResultMessage;
    expect(result.type).toBe('result');
    expect(result.subtype).toBe('error_during_execution');
  });

  it('options.sessionId labels a fresh session without auto-resuming prior content (#38)', async () => {
    stubFetch(makeSSEFetch([textReplyEvents('first reply')]));
    await collect(
      query({ prompt: 'first', options: baseOptions({ sessionId: 'fixed-id' }) }),
    );

    const fetch2 = stubFetch(makeSSEFetch([textReplyEvents('second reply')]));
    const q2 = query({
      prompt: 'second',
      options: baseOptions({ sessionId: 'fixed-id' }),
    });
    const messages = await collect(q2);

    expect(messages[0]!.session_id).toBe('fixed-id');
    // The second run must NOT prepend the first run's transcript.
    expect(fetch2.requests[0]!.body.messages).toEqual([
      { role: 'user', content: 'second' },
    ]);
  });

  it('forkSession stamps the current cwd, not the source session cwd (#39)', async () => {
    const cwdA = await mkdtemp(join(tmpdir(), 'bpt-query-cwdA-'));
    try {
      stubFetch(makeSSEFetch([textReplyEvents('base')]));
      const first = await collect(
        query({ prompt: 'base', options: baseOptions({ cwd: cwdA }) }),
      );
      const sid = first[0]!.session_id;

      stubFetch(makeSSEFetch([textReplyEvents('forked')]));
      const second = await collect(
        query({
          prompt: 'forked',
          options: baseOptions({ resume: sid, forkSession: true }),
        }),
      );
      const forkedId = second[0]!.session_id;
      expect(forkedId).not.toBe(sid);

      const info = await getSessionInfo(forkedId, { sessionDir });
      // Fork's future turns run under the current query cwd, not cwdA.
      expect(info!.cwd).toBe(cwd);
    } finally {
      await rm(cwdA, { recursive: true, force: true });
    }
  });

  it('resume of a missing session with forkSession mints a fresh id (#39)', async () => {
    stubFetch(makeSSEFetch([textReplyEvents('forked fresh')]));
    const q = query({
      prompt: 'go',
      options: baseOptions({ resume: 'no-such-id', forkSession: true }),
    });
    const messages = await collect(q);

    expect(messages[0]!.session_id).not.toBe('no-such-id');
    // Nothing was ever written under the missing id.
    expect(await readdir(sessionDir)).not.toContain('no-such-id.jsonl');
  });

  it('the v0.1.1 audit-added compat keys warn instead of being silently ignored', async () => {
    stubFetch(makeSSEFetch([textReplyEvents('ok')]));
    const lines: string[] = [];
    const options = baseOptions({ debug: true, stderr: (d) => lines.push(d) });
    (options as Record<string, unknown>).settings = {};
    (options as Record<string, unknown>).permissionPromptToolName = 'Ask';
    (options as Record<string, unknown>).extraArgs = { foo: 'bar' };

    await collect(query({ prompt: 'go', options }));
    for (const key of ['settings', 'permissionPromptToolName', 'extraArgs']) {
      expect(lines.some((l) => l.includes(`option '${key}'`))).toBe(true);
    }
  });

  it('bare-name disallowedTools removes the tool definition from the request (audit P0)', async () => {
    const fetchStub = stubFetch(makeSSEFetch([textReplyEvents('ok')]));
    const q = query({
      prompt: 'go',
      options: baseOptions({ disallowedTools: ['Bash'] }),
    });
    const messages = await collect(q);

    const init = messages[0] as SDKSystemMessage;
    expect(init.tools).not.toContain('Bash');
    expect(init.tools).toContain('Read');
    const toolNames = (
      fetchStub.requests[0]!.body.tools as Array<{ name: string }>
    ).map((t) => t.name);
    expect(toolNames).not.toContain('Bash');
    expect(toolNames).toContain('Read');
  });

  it('scoped disallowedTools keeps the tool definition (call-time gate only)', async () => {
    const fetchStub = stubFetch(makeSSEFetch([textReplyEvents('ok')]));
    const q = query({
      prompt: 'go',
      options: baseOptions({ disallowedTools: ['Bash(sudo:*)'] }),
    });
    await collect(q);

    const toolNames = (
      fetchStub.requests[0]!.body.tools as Array<{ name: string }>
    ).map((t) => t.name);
    expect(toolNames).toContain('Bash');
  });
});
