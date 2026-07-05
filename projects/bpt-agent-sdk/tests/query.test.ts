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
  ConfigurationError,
  getSessionInfo,
  isAbortError,
  listSessions,
  query,
} from '../src/index.js';
import type {
  APIMessageParam,
  Options,
  PermissionCheckResult,
  Query,
  SDKAssistantMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
  SDKSystemMessage,
  SDKUserMessage,
  TextBlockParam,
  ToolResultBlockParam,
  ToolUseBlockParam,
} from '../src/types.js';
import type {
  BuiltinTool,
  EngineConfig,
  EngineDeps,
  HookRunner,
  McpRegistry,
  McpToolEntry,
  PermissionGate,
  ToolContext,
} from '../src/internal/contracts.js';
import { runAgentLoop } from '../src/engine/loop.js';
import {
  MockTransport,
  textReplyEvents,
  toolUseReplyEvents,
} from './helpers/mock-transport.js';
import { HANG_STREAM, encodeSSEFrame, makeSSEFetch } from './helpers/sse-fetch.js';
import type { SSEFetchStub } from './helpers/sse-fetch.js';
import { DefaultPermissionGate } from '../src/permissions/gate.js';

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
    // promptCaching:false keeps the on-wire request shape un-cached so these
    // message-flow / persistence tests assert the plain string/array forms.
    // The default-on behavior is covered by its own dedicated test below.
    provider: { apiKey: 'test-key', promptCaching: false },
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

  it('prompt caching is ON by default: system + tools carry cache_control breakpoints', async () => {
    const fetchStub = stubFetch(makeSSEFetch([textReplyEvents('cached')]));
    // Default provider (no promptCaching field) -> caching on.
    const q = query({
      prompt: 'hi',
      options: {
        provider: { apiKey: 'test-key' },
        sessionDir,
        cwd,
        env: { PATH: process.env.PATH, HOME: process.env.HOME },
        model: 'claude-sonnet-4-5',
      },
    });
    await collect(q);
    const body = fetchStub.requests[0]!.body;
    // system is now an array of blocks with a cache_control breakpoint.
    expect(Array.isArray(body.system)).toBe(true);
    const sysBlocks = body.system as Array<{ cache_control?: unknown }>;
    expect(sysBlocks.some((b) => b.cache_control !== undefined)).toBe(true);
    // the tools array carries a breakpoint on its last entry.
    const tools = body.tools as Array<{ cache_control?: unknown }>;
    expect(tools.some((t) => t.cache_control !== undefined)).toBe(true);
    // never more than the Messages API max of 4 cache breakpoints.
    const countBreakpoints = (arr: Array<{ cache_control?: unknown }>) =>
      arr.filter((x) => x.cache_control !== undefined).length;
    const total =
      countBreakpoints(sysBlocks) +
      countBreakpoints(tools) +
      countBreakpoints(
        (body.messages as Array<{ content?: unknown }>).flatMap((m) =>
          Array.isArray(m.content) ? (m.content as Array<{ cache_control?: unknown }>) : [],
        ),
      );
    expect(total).toBeLessThanOrEqual(4);
  });

  it('cache split: the cwd tail rides in an UNCACHED trailing system block', async () => {
    // The cache optimization keeps the per-run cwd out of the cached prefix so
    // independent queries can reuse the cached stable prefix. Verify the cwd
    // sits in a trailing block WITHOUT cache_control, while an earlier block
    // (the stable prefix) carries the breakpoint.
    const fetchStub = stubFetch(makeSSEFetch([textReplyEvents('ok')]));
    const q = query({
      prompt: 'hi',
      options: {
        provider: { apiKey: 'test-key' },
        sessionDir,
        cwd,
        env: { PATH: process.env.PATH, HOME: process.env.HOME },
        model: 'claude-sonnet-4-5',
      },
    });
    await collect(q);
    const sys = fetchStub.requests[0]!.body.system as Array<{
      text?: string;
      cache_control?: unknown;
    }>;
    expect(Array.isArray(sys)).toBe(true);
    const cwdBlock = sys.find((b) => (b.text ?? '').includes(cwd));
    expect(cwdBlock).toBeDefined();
    // the cwd block must NOT be cached (it varies per run)...
    expect(cwdBlock!.cache_control).toBeUndefined();
    // ...and it must be the LAST block (rides after the breakpoint).
    expect(sys[sys.length - 1]).toBe(cwdBlock);
    // an earlier (stable) block carries the breakpoint.
    expect(sys.slice(0, -1).some((b) => b.cache_control !== undefined)).toBe(true);
  });

  it('segments systemPrompt: caller blocks forwarded verbatim with their own cache breakpoints', async () => {
    const fetchStub = stubFetch(makeSSEFetch([textReplyEvents('ok')]));
    const q = query({
      prompt: 'hi',
      options: {
        provider: { apiKey: 'test-key' },
        sessionDir,
        cwd,
        env: { PATH: process.env.PATH, HOME: process.env.HOME },
        model: 'claude-sonnet-4-5',
        // host-layered: core -> team -> user -> project (cwd stays out).
        systemPrompt: {
          type: 'segments',
          segments: [
            { text: 'CORE harness rules', cache: true },
            { text: 'TEAM conventions', cache: true },
            { text: 'USER preferences', cache: true },
            { text: 'PROJECT (untrusted) advisory', cache: false },
          ],
        },
      },
    });
    await collect(q);
    const sys = fetchStub.requests[0]!.body.system as Array<{
      text?: string;
      cache_control?: unknown;
    }>;
    expect(Array.isArray(sys)).toBe(true);
    // caller order + text preserved exactly
    expect(sys.map((b) => b.text)).toEqual([
      'CORE harness rules',
      'TEAM conventions',
      'USER preferences',
      'PROJECT (untrusted) advisory',
    ]);
    // the three cache:true segments carry breakpoints; the project block does not
    expect(sys[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(sys[1]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(sys[2]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(sys[3]!.cache_control).toBeUndefined();
    // total breakpoints (system + tools) never exceed the API's max of 4;
    // message-level caching is off in the segments path.
    const sysBp = sys.filter((b) => b.cache_control !== undefined).length;
    const tools = (fetchStub.requests[0]!.body.tools ?? []) as Array<{ cache_control?: unknown }>;
    const toolBp = tools.filter((t) => t.cache_control !== undefined).length;
    const msgs = (fetchStub.requests[0]!.body.messages ?? []) as Array<{ content?: unknown }>;
    const msgBp = msgs.flatMap((m) =>
      Array.isArray(m.content) ? (m.content as Array<{ cache_control?: unknown }>) : [],
    ).filter((c) => c.cache_control !== undefined).length;
    expect(sysBp + toolBp + msgBp).toBeLessThanOrEqual(4);
    expect(msgBp).toBe(0);
  });

  it('segments systemPrompt: a 4th cache:true segment is dropped from the budget (max 3 system breakpoints)', async () => {
    const fetchStub = stubFetch(makeSSEFetch([textReplyEvents('ok')]));
    const q = query({
      prompt: 'hi',
      options: {
        provider: { apiKey: 'test-key' },
        sessionDir,
        cwd,
        env: { PATH: process.env.PATH, HOME: process.env.HOME },
        model: 'claude-sonnet-4-5',
        systemPrompt: {
          type: 'segments',
          segments: [
            { text: 'A', cache: true },
            { text: 'B', cache: true },
            { text: 'C', cache: true },
            { text: 'D', cache: true },
          ],
        },
      },
    });
    await collect(q);
    const sys = fetchStub.requests[0]!.body.system as Array<{ cache_control?: unknown }>;
    const sysBp = sys.filter((b) => b.cache_control !== undefined).length;
    expect(sysBp).toBe(3); // 4th cache:true honored only if budget remains
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

describe('prompt cache: stable prefix does not drift across turns (a read can hit)', () => {
  it('the cached system prefix + tools are byte-identical between turn 1 and turn 2', async () => {
    // Diagnostic for the observed "writes happen but reads miss" A/B result:
    // if the cached prefix (everything up to its breakpoint) is byte-identical
    // across turns, the API CAN read it on turn 2+, so a 0% read rate on a
    // short task is a threshold/short-task artifact, NOT a prefix-drift bug.
    const fetchStub = stubFetch(
      makeSSEFetch([
        toolUseReplyEvents('Bash', { command: 'echo hi' }),
        textReplyEvents('done'),
      ]),
    );
    const q = query({
      prompt: 'run echo',
      options: baseOptions({
        provider: { apiKey: 'test-key' }, // caching ON (no promptCaching:false)
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
      }),
    });
    await collect(q);
    expect(fetchStub.requests).toHaveLength(2);

    type SysBlk = { text?: string; cache_control?: unknown };
    // The cached prefix = blocks up to and including the last system breakpoint.
    const cachedSystemPrefix = (body: { system: unknown }): string => {
      const sys = body.system as SysBlk[];
      let lastBp = -1;
      sys.forEach((b, i) => {
        if (b.cache_control !== undefined) lastBp = i;
      });
      return sys
        .slice(0, lastBp + 1)
        .map((b) => b.text ?? '')
        .join(' ');
    };
    const toolsJson = (body: { tools?: unknown }): string => JSON.stringify(body.tools ?? null);

    const p0 = cachedSystemPrefix(fetchStub.requests[0]!.body);
    const p1 = cachedSystemPrefix(fetchStub.requests[1]!.body);
    // A breakpoint must actually land on the stable prefix (not only the tail).
    expect(p0.length).toBeGreaterThan(0);
    // The cached system prefix and tools must not drift, or the API re-writes
    // instead of reading on turn 2.
    expect(p1).toBe(p0);
    expect(toolsJson(fetchStub.requests[1]!.body)).toBe(
      toolsJson(fetchStub.requests[0]!.body),
    );
  });

  it('places cache_control on tools + stable system + last message (wire is correct)', async () => {
    // Documents the wire truth found while root-causing the real-API 0-write:
    // all three breakpoints ARE placed and the tools breakpoint alone dominates
    // the cacheable prefix, so a 0 cache_creation is NOT a missing-breakpoint bug.
    const fetchStub = stubFetch(
      makeSSEFetch([
        toolUseReplyEvents('Bash', { command: 'echo hi' }),
        textReplyEvents('done'),
      ]),
    );
    const q = query({
      prompt: 'run echo',
      options: baseOptions({
        provider: { apiKey: 'test-key' }, // caching ON, minimal prompt (like the probe)
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
      }),
    });
    await collect(q);
    const b = fetchStub.requests[0]!.body;
    const tools = (b.tools ?? []) as Array<{ cache_control?: unknown }>;
    const sys = b.system as Array<{ text?: string; cache_control?: unknown }>;
    const lastMsg = (b.messages as Array<{ content: unknown }>).at(-1);
    const lastBlocks = Array.isArray(lastMsg?.content)
      ? (lastMsg!.content as Array<{ cache_control?: unknown }>)
      : [];
    // tools breakpoint on the last tool
    expect(tools.filter((t) => t.cache_control !== undefined).length).toBe(1);
    // system breakpoint on the STABLE block 0 (cwd rides in a later uncached block)
    expect(sys[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(sys.at(-1)!.cache_control).toBeUndefined();
    // message breakpoint on the last message's last block
    expect(lastBlocks.filter((c) => c.cache_control !== undefined).length).toBe(1);
    // the tools JSON alone is large (the dominant cacheable content)
    expect(JSON.stringify(tools).length).toBeGreaterThan(6000);
  });

  it('claude_code preset with no explicit variant resolves to the v5 default on the wire', async () => {
    // Locks the promoted default THROUGH the real query() path: query.ts must
    // pass harnessPromptVariant through as-is so buildSystemPromptParts applies
    // its v5 default. A regression that pins undefined -> 'v1' here would ship
    // the terse prompt while the unit default claimed v5.
    const fetchStub = stubFetch(makeSSEFetch([textReplyEvents('done')]));
    const q = query({
      prompt: 'hello',
      options: baseOptions({
        provider: { apiKey: 'test-key' },
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
      }),
    });
    await collect(q);
    const sys = fetchStub.requests[0]!.body.system as Array<{ text?: string }>;
    const stable = sys[0]?.text ?? '';
    expect(stable).toContain('Doing tasks:'); // v5 marker
    expect(stable).toContain('Measure twice, cut once.'); // v5 marker
    expect(stable).not.toContain('Tool guidance:'); // v1 marker absent
  });

  it('an explicit harnessPromptVariant:v1 still selects the terse prompt on the wire', async () => {
    const fetchStub = stubFetch(makeSSEFetch([textReplyEvents('done')]));
    const q = query({
      prompt: 'hello',
      options: baseOptions({
        provider: { apiKey: 'test-key' },
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        harnessPromptVariant: 'v1',
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
      }),
    });
    await collect(q);
    const sys = fetchStub.requests[0]!.body.system as Array<{ text?: string }>;
    const stable = sys[0]?.text ?? '';
    expect(stable).toContain('Tool guidance:'); // v1 marker
    expect(stable).not.toContain('Doing tasks:'); // v5 marker absent
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
      options: baseOptions({
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
      }),
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
    expect(info).toBeDefined();
    expect(info!.sessionId).toBe(sid);
    expect(info!.cwd).toBe(cwd);
    expect(info!.createdAt).toBeGreaterThan(0);

    // B2b: official return shape — undefined (not null) for an unknown id.
    expect(await getSessionInfo('no-such-session', { sessionDir })).toBeUndefined();
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
        .every((l) => l.includes('no effect in this SDK')),
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
        allowDangerouslySkipPermissions: true,
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
    expect(models.every((m) => typeof m.value === 'string')).toBe(true);
    expect(models.some((m) => m.value === 'claude-sonnet-4-5')).toBe(true);
    expect(models.every((m) => typeof m.displayName === 'string')).toBe(true);

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
      options: baseOptions({
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
      }),
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

  it('setMaxThinkingTokens re-enables thinking on a preset session that opted out (E1 live-switch, adversarial review 2026-07-05)', async () => {
    // Preset session opted out with maxThinkingTokens: 0 -> turn 1 sends no
    // thinking. A live setMaxThinkingTokens(4096) must turn it back ON for
    // turn 2 (the bug: the setter only touched the budget, never the on/off
    // switch, so the re-enable was a silent no-op).
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

    const q = query({
      prompt: inputs(),
      options: baseOptions({
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        maxThinkingTokens: 0,
      }),
    });
    let resultsSeen = 0;
    for await (const m of q) {
      if (m.type === 'result') {
        resultsSeen += 1;
        if (resultsSeen === 1) {
          await q.setMaxThinkingTokens(4096);
          releaseSecond();
        }
      }
    }

    expect(fetchStub.requests).toHaveLength(2);
    expect(fetchStub.requests[0]!.body).not.toHaveProperty('thinking');
    expect(fetchStub.requests[1]!.body.thinking).toEqual({
      type: 'enabled',
      budget_tokens: 4096,
    });
  });

  it('setMaxThinkingTokens(0) disables thinking mid-run on a preset default session (E1 live-switch)', async () => {
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

    const q = query({
      prompt: inputs(),
      options: baseOptions({
        systemPrompt: { type: 'preset', preset: 'claude_code' },
      }),
    });
    let resultsSeen = 0;
    for await (const m of q) {
      if (m.type === 'result') {
        resultsSeen += 1;
        if (resultsSeen === 1) {
          await q.setMaxThinkingTokens(0);
          releaseSecond();
        }
      }
    }

    expect(fetchStub.requests).toHaveLength(2);
    // Turn 1 = preset default adaptive (E7-01); turn 2 = disabled.
    expect(fetchStub.requests[0]!.body.thinking).toEqual({ type: 'adaptive' });
    expect(fetchStub.requests[1]!.body).not.toHaveProperty('thinking');
  });

  it('setMaxThinkingTokens(null) resets a fixed-budget preset session back to adaptive (E7-01 live-switch)', async () => {
    // Preset session pinned to a fixed budget -> turn 1 sends enabled/2048.
    // A live setMaxThinkingTokens(null) must restore the preset default
    // (adaptive, the official wire shape) for turn 2.
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

    const q = query({
      prompt: inputs(),
      options: baseOptions({
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        maxThinkingTokens: 2048,
      }),
    });
    let resultsSeen = 0;
    for await (const m of q) {
      if (m.type === 'result') {
        resultsSeen += 1;
        if (resultsSeen === 1) {
          await q.setMaxThinkingTokens(null);
          releaseSecond();
        }
      }
    }

    expect(fetchStub.requests).toHaveLength(2);
    expect(fetchStub.requests[0]!.body.thinking).toEqual({
      type: 'enabled',
      budget_tokens: 2048,
    });
    expect(fetchStub.requests[1]!.body.thinking).toEqual({ type: 'adaptive' });
  });

  it('reports per-result num_turns/usage with cumulative cost/apiMs across streaming turns (E2, KD-L5-04)', async () => {
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
    // Official reporting semantics (pinned live, run 28736460533): num_turns
    // and usage are PER-RESULT (this turn's own figures), total_cost_usd and
    // duration_api_ms are SESSION-cumulative (strictly increasing). Internal
    // maxTurns/maxBudgetUsd enforcement stays session-wide (#33 unchanged -
    // see the enforcement tests below).
    expect(results[0]!.num_turns).toBe(1);
    expect(results[1]!.num_turns).toBe(1);
    expect(results[1]!.usage.input_tokens).toBe(results[0]!.usage.input_tokens);
    expect(results[1]!.total_cost_usd).toBeCloseTo(
      results[0]!.total_cost_usd * 2,
      9,
    );
    expect(results[1]!.duration_api_ms).toBeGreaterThanOrEqual(
      results[0]!.duration_api_ms,
    );
    // modelUsage stays session-cumulative (official semantics unobserved).
    expect(
      results[1]!.modelUsage['claude-opus-4-8']!.inputTokens,
    ).toBe(results[0]!.modelUsage['claude-opus-4-8']!.inputTokens * 2);
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

// ---------------------------------------------------------------------------
// v0.2 CONFIRMED-finding regressions (loop.ts / query.ts)
// ---------------------------------------------------------------------------

/** Minimal allow-everything permission gate for the engine-level harness. */
function allowGate(): PermissionGate {
  return {
    async check(_toolName, input): Promise<PermissionCheckResult> {
      return { decision: 'allow', updatedInput: input };
    },
    setMode(): void {},
    getMode() {
      return 'default';
    },
    applyUpdates(): void {},
    denials() {
      return [];
    },
  };
}

/** No-hooks hook runner for the engine-level harness. */
function noHooks(): HookRunner {
  return {
    hasHooks(): boolean {
      return false;
    },
    async run() {
      return { continue: true, systemMessages: [], additionalContext: [] };
    },
  };
}

/** Empty MCP registry for the engine-level harness. */
function emptyMcp(): McpRegistry {
  return {
    async connectAll(): Promise<void> {},
    statuses() {
      return [];
    },
    allTools() {
      return [];
    },
    has() {
      return false;
    },
    async call() {
      return { content: [{ type: 'text', text: '' }], isError: false };
    },
    async reconnect(): Promise<void> {},
    setEnabled(): void {},
    async setServers() {
      return { servers: [] };
    },
    async closeAll(): Promise<void> {},
  };
}

describe('runAgentLoop - v0.2 confirmed-finding regressions (engine)', () => {
  function engineToolContext(): ToolContext {
    return {
      cwd,
      additionalDirectories: [],
      env: {},
      signal: new AbortController().signal,
      debug: () => {},
    };
  }
  function engineConfig(extra: Partial<EngineConfig> = {}): EngineConfig {
    return {
      model: 'claude-test-1',
      maxOutputTokens: 8192,
      systemPrompt: '',
      includePartialMessages: false,
      sessionId: 'sess-engine',
      cwd,
      ...extra,
    };
  }

  it('drains a completed background subagent result at natural end (#4)', async () => {
    const transport = new MockTransport([
      textReplyEvents('first'),
      textReplyEvents('second'),
    ]);
    const bgBlock: TextBlockParam = { type: 'text', text: 'BG_DONE' };
    let drainCalls = 0;
    const history: APIMessageParam[] = [{ role: 'user', content: 'go' }];
    const requestView = { messages: [...history] };
    const deps: EngineDeps = {
      transport,
      builtinTools: new Map(),
      mcp: emptyMcp(),
      permissions: allowGate(),
      hooks: noHooks(),
      toolContext: engineToolContext(),
      debug: () => {},
      requestView,
      drainSubagentResults: () => {
        drainCalls += 1;
        return drainCalls === 1 ? [bgBlock] : [];
      },
    };

    const msgs: SDKMessage[] = [];
    for await (const m of runAgentLoop(history, deps, engineConfig())) msgs.push(m);

    // Fix: turn-1 natural end drains the pending note, injects it as a user
    // turn and continues, so a SECOND assistant turn runs. Pre-fix the note was
    // dropped and the run ended after turn 1 (a single request, result 'first').
    expect(transport.requests).toHaveLength(2);
    const result = msgs.filter((m): m is SDKResultMessage => m.type === 'result').at(-1)!;
    expect(result.subtype).toBe('success');
    if (result.subtype === 'success') expect(result.result).toBe('second');
    // The drained note was surfaced as a user turn the model actually saw.
    expect(
      requestView.messages.some(
        (m) =>
          m.role === 'user' &&
          Array.isArray(m.content) &&
          m.content.some((b) => b.type === 'text' && b.text === 'BG_DONE'),
      ),
    ).toBe(true);
  });

  it('recomputes tool-def overhead per turn so mid-run tool growth trips compaction (#11)', async () => {
    // An MCP registry whose tool set GROWS after a tool runs, mimicking a
    // tool-search / lazy MCP load that surfaces a large schema mid-run.
    class GrowingMcp implements McpRegistry {
      loaded = false;
      private readonly big: McpToolEntry = {
        qualifiedName: 'mcp__x__big',
        serverName: 'x',
        toolName: 'big',
        description: 'D'.repeat(6000),
        inputSchema: { type: 'object', properties: {} },
      };
      async connectAll(): Promise<void> {}
      statuses() {
        return [];
      }
      allTools(): McpToolEntry[] {
        return this.loaded ? [this.big] : [];
      }
      has(): boolean {
        return false;
      }
      async call() {
        return { content: [{ type: 'text' as const, text: '' }], isError: false };
      }
      async reconnect(): Promise<void> {}
      setEnabled(): void {}
      async setServers() {
        return { servers: [] };
      }
      async closeAll(): Promise<void> {}
    }
    const mcp = new GrowingMcp();
    const loadTool: BuiltinTool = {
      name: 'Load',
      description: 'load',
      inputSchema: { type: 'object', properties: {} },
      readOnly: false,
      async execute() {
        mcp.loaded = true; // schema becomes visible from the next turn on
        return { content: 'loaded' };
      },
    };
    const transport = new MockTransport([
      toolUseReplyEvents('Load', {}),
      textReplyEvents('done'),
    ]);
    const debugLines: string[] = [];
    const history: APIMessageParam[] = [{ role: 'user', content: 'go' }];
    const deps: EngineDeps = {
      transport,
      builtinTools: new Map([['Load', loadTool]]),
      mcp,
      permissions: allowGate(),
      hooks: noHooks(),
      toolContext: engineToolContext(),
      debug: (m) => debugLines.push(m),
      requestView: { messages: [...history] },
    };
    // Tight window so the freshly loaded ~1.5k-token schema (but NOT the empty
    // turn-0 tool set) pushes the estimate over the auto-compaction trigger.
    const config = engineConfig({
      maxOutputTokens: 100,
      compaction: {
        enabled: true,
        autoThresholdRatio: 0.85,
        keepRatio: 0.3,
        minRecentTurns: 2,
        useApiSummary: false,
        recognizeCommand: false,
        contextWindowTokens: 1000,
      },
    });

    for await (const _m of runAgentLoop(history, deps, config)) {
      // drain
    }

    // Fix: turn-2's compaction check re-counts the loaded schema, fires the
    // trigger, and performCompaction (with only one genuine user turn) logs
    // 'nothing safe to fold'. Pre-fix the stale turn-0 overhead (0 tokens) never
    // trips the trigger, so that log never appears.
    expect(debugLines.some((l) => l.includes('nothing safe to fold'))).toBe(true);
    expect(transport.requests).toHaveLength(2);
  });

  // ----- remnant #1: MCP readOnlyHint drives the gate's auto-approve -----

  function mcpWith(tool: McpToolEntry, calls: string[]): McpRegistry {
    return {
      async connectAll(): Promise<void> {},
      statuses() {
        return [];
      },
      allTools(): McpToolEntry[] {
        return [tool];
      },
      has(q: string): boolean {
        return q === tool.qualifiedName;
      },
      async call(q: string) {
        calls.push(q);
        return { content: [{ type: 'text' as const, text: `ran ${tool.toolName}` }], isError: false };
      },
      async reconnect(): Promise<void> {},
      setEnabled(): void {},
      async setServers() {
        return { servers: [] };
      },
      async closeAll(): Promise<void> {},
    };
  }

  async function runOneMcpCall(
    tool: McpToolEntry,
  ): Promise<{ calls: string[]; results: ToolResultBlockParam[] }> {
    const calls: string[] = [];
    const transport = new MockTransport([
      toolUseReplyEvents(tool.qualifiedName, {}),
      textReplyEvents('done'),
    ]);
    const history: APIMessageParam[] = [{ role: 'user', content: 'go' }];
    const deps: EngineDeps = {
      transport,
      builtinTools: new Map(),
      mcp: mcpWith(tool, calls),
      // Real gate, default mode, NO canUseTool: only readOnly tools auto-approve.
      permissions: new DefaultPermissionGate({ debug: () => {} }),
      hooks: noHooks(),
      toolContext: engineToolContext(),
      debug: () => {},
    };
    for await (const _m of runAgentLoop(history, deps, engineConfig())) {
      /* drain */
    }
    const userTurn = history.find((m) => m.role === 'user' && Array.isArray(m.content));
    return { calls, results: (userTurn?.content ?? []) as ToolResultBlockParam[] };
  }

  it('auto-approves a read-only MCP tool (readOnlyHint) in default mode without canUseTool', async () => {
    const { calls, results } = await runOneMcpCall({
      qualifiedName: 'mcp__x__peek',
      serverName: 'x',
      toolName: 'peek',
      inputSchema: { type: 'object' },
      annotations: { readOnlyHint: true },
    });
    expect(calls).toEqual(['mcp__x__peek']); // executed
    expect(results[0]!.is_error).not.toBe(true);
    // Result content is the MCP tool's block array; its text carries the output.
    expect(JSON.stringify(results[0]!.content)).toContain('ran peek');
  });

  it('does NOT auto-approve a non-read-only MCP tool in default mode without canUseTool', async () => {
    const { calls, results } = await runOneMcpCall({
      qualifiedName: 'mcp__x__poke',
      serverName: 'x',
      toolName: 'poke',
      inputSchema: { type: 'object' },
    });
    expect(calls).toEqual([]); // never executed
    expect(results[0]!.is_error).toBe(true);
  });
});

describe('query() e2e - v0.2 confirmed-finding regressions (query)', () => {
  it('setMaxThinkingTokens mid-turn applies to the next sub-turn request (#12)', async () => {
    const fetchStub = stubFetch(
      makeSSEFetch([
        toolUseReplyEvents('Bash', { command: 'echo hi' }),
        textReplyEvents('done'),
      ]),
    );
    const q = query({
      prompt: 'go',
      options: baseOptions({
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        thinking: { type: 'enabled' },
        maxThinkingTokens: 5000,
      }),
    });
    let firstAssistantSeen = false;
    for await (const m of q) {
      if (m.type === 'assistant' && !firstAssistantSeen) {
        firstAssistantSeen = true;
        // Mutate the live thinking budget between the two sub-turns of THIS run.
        await q.setMaxThinkingTokens(2000);
      }
    }

    expect(fetchStub.requests).toHaveLength(2);
    // Fix: the thinking param is recomputed per turn, so sub-turn 2 carries the
    // new budget. Pre-fix it was snapshotted once and both requests read 5000.
    expect(fetchStub.requests[0]!.body.thinking).toEqual({
      type: 'enabled',
      budget_tokens: 5000,
    });
    expect(fetchStub.requests[1]!.body.thinking).toEqual({
      type: 'enabled',
      budget_tokens: 2000,
    });
  });

  it('measures ttft from the delivered fallback attempt, not the discarded one (#13)', async () => {
    const msgStart = (model: string): object => ({
      type: 'message_start',
      message: {
        id: 'msg_x',
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 25,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    });
    let call = 0;
    const fetchImpl = async (
      _input: unknown,
      _init?: RequestInit,
    ): Promise<Response> => {
      const idx = call;
      call += 1;
      if (idx === 0) {
        // Attempt 1: emit content_block_start IMMEDIATELY (this is what latches
        // ttft under the bug), then a mid-stream overloaded_error -> 529 -> the
        // loop retries the turn on the fallback model.
        const events: object[] = [
          msgStart('claude-sonnet-4-5'),
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'error', error: { type: 'overloaded_error', message: 'overloaded' } },
        ];
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            for (const e of events) c.enqueue(encodeSSEFrame(e));
            c.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      // Attempt 2 (fallback, delivered): a real ~80ms gap BEFORE the first
      // content token, so ttft anchored to THIS attempt is measurably > 0.
      const stream = new ReadableStream<Uint8Array>({
        async start(c) {
          c.enqueue(encodeSSEFrame(msgStart('claude-opus-4-8')));
          await delay(80);
          c.enqueue(
            encodeSSEFrame({
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'text', text: '' },
            }),
          );
          c.enqueue(
            encodeSSEFrame({
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: 'recovered' },
            }),
          );
          c.enqueue(encodeSSEFrame({ type: 'content_block_stop', index: 0 }));
          c.enqueue(
            encodeSSEFrame({
              type: 'message_delta',
              delta: { stop_reason: 'end_turn', stop_sequence: null },
              usage: { output_tokens: 5 },
            }),
          );
          c.enqueue(encodeSSEFrame({ type: 'message_stop' }));
          c.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    };
    vi.stubGlobal('fetch', vi.fn(fetchImpl));

    const q = query({
      prompt: 'go',
      options: baseOptions({ fallbackModel: 'claude-opus-4-8' }),
    });
    const messages = await collect(q);
    const result = lastResult(messages);
    expect(result.subtype).toBe('success');
    if (result.subtype === 'success') expect(result.result).toBe('recovered');
    // Fix: ttft reflects the fallback attempt's ~80ms time-to-first-token.
    // Pre-fix it stayed anchored to the discarded first attempt (~0ms).
    expect(result.ttft_stream_ms).toBeGreaterThan(40);
  });

  it('tears down a background subagent on NORMAL query completion (#14)', async () => {
    let resolveStop!: () => void;
    const stopFired = new Promise<void>((r) => {
      resolveStop = r;
    });

    let parentCall = 0;
    const fetchImpl = async (
      _input: unknown,
      init?: RequestInit,
    ): Promise<Response> => {
      const body = JSON.parse(String(init?.body)) as { system?: unknown };
      const isChild = String(body.system ?? '').includes('WORKER_SYS_PROMPT');
      if (isChild) {
        // The child stream never yields and never closes: it hangs until its
        // controller is aborted, which only happens if the parent tears it down.
        const stream = new ReadableStream<Uint8Array>({ start() {} });
        return new Response(stream, {
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
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          for (const e of events) c.enqueue(encodeSSEFrame(e));
          c.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    };
    vi.stubGlobal('fetch', vi.fn(fetchImpl));

    const q = query({
      prompt: 'go',
      options: baseOptions({
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        agents: { worker: { description: 'w', prompt: 'WORKER_SYS_PROMPT' } },
        hooks: {
          SubagentStop: [
            {
              hooks: [
                async () => {
                  resolveStop();
                  return {};
                },
              ],
            },
          ],
        },
      }),
    });

    // The parent finishes normally (natural end on turn 2); its generator's
    // finally must abort the still-hanging background child so its SubagentStop
    // fires. Pre-fix the child leaked and SubagentStop never ran.
    const messages = await collect(q);
    expect(lastResult(messages).subtype).toBe('success');

    await Promise.race([
      stopFired,
      delay(2000).then(() => {
        throw new Error(
          'SubagentStop never fired: background child leaked past normal completion (#14)',
        );
      }),
    ]);
  });
});

describe('bypassPermissions safety interlock', () => {
  it('query() throws ConfigurationError when bypass is set without the unlock flag', () => {
    expect(() =>
      query({
        prompt: 'hi',
        options: baseOptions({ permissionMode: 'bypassPermissions' }),
      }),
    ).toThrow(ConfigurationError);
  });

  it('query() constructs and runs when bypass is unlocked', async () => {
    stubFetch(makeSSEFetch([textReplyEvents('ok')]));
    const q = query({
      prompt: 'hi',
      options: baseOptions({
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
      }),
    });
    const messages = await collect(q);
    expect((messages[0] as SDKSystemMessage).permissionMode).toBe('bypassPermissions');
    expect(lastResult(messages).subtype).toBe('success');
  });

  it('setPermissionMode(bypass) rejects without the unlock flag', async () => {
    stubFetch(makeSSEFetch([textReplyEvents('ok')]));
    const q = query({ prompt: 'hi', options: baseOptions() });
    await expect(q.setPermissionMode('bypassPermissions')).rejects.toBeInstanceOf(
      ConfigurationError,
    );
    await q.close();
  });

  it('setPermissionMode(bypass) resolves when the unlock flag is set', async () => {
    stubFetch(makeSSEFetch([textReplyEvents('ok')]));
    const q = query({
      prompt: 'hi',
      options: baseOptions({ allowDangerouslySkipPermissions: true }),
    });
    await expect(q.setPermissionMode('bypassPermissions')).resolves.toBeUndefined();
    await q.close();
  });
});
