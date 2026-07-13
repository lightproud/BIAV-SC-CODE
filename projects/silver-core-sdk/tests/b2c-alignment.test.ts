/**
 * B2c batch alignment tests (2026-07-05): NEW-IN-DOCS additive surface above
 * the pinned baseline (agent-sdk 0.3.199 / claude-code 2.1.201). Two kinds of
 * assertion:
 *   1. Compile-time `satisfies` checks pinning the exact field/enum shapes of
 *      every additive type (six new hook inputs, MessageDisplay incremental
 *      protocol, and the pure-type additions).
 *   2. One runtime check that the MessageDisplay hook actually fires with the
 *      official incremental fields populated (turn_id/message_id/index/final/
 *      delta) — the only new hook with a natural runtime hook point; the other
 *      six are typed-not-fired by design and asserted type-only.
 *
 * None of these touch pinned observable behavior; the conformance suite stays
 * green alongside this file.
 */

import { describe, expect, it } from 'vitest';

import { DefaultHookRunner } from '../src/hooks/runner.js';
import { DefaultPermissionGate } from '../src/permissions/gate.js';
import { runAgentLoop } from '../src/engine/loop.js';
import type { EngineConfig, EngineDeps } from '../src/internal/contracts.js';
import type {
  ApiKeySource,
  BackgroundTaskSummary,
  ConfigChangeHookInput,
  FastModeState,
  HookEvent,
  HookInput,
  MessageDisplayHookInput,
  Options,
  SDKAssistantMessage,
  SDKAssistantMessageError,
  SDKControlInitializeResponse,
  SDKMessage,
  SDKMessageOrigin,
  SDKResultMessage,
  SDKUserMessage,
  SessionCronSummary,
  TerminalReason,
  SetupHookInput,
  StopHookInput,
  SubagentStopHookInput,
  TaskCompletedHookInput,
  TeammateIdleHookInput,
  ThinkingConfigParam,
  ThinkingDisplay,
  WorktreeCreateHookInput,
  WorktreeRemoveHookInput,
} from '../src/types.js';
import { MockTransport, textReplyEvents } from './helpers/mock-transport.js';

// ---------------------------------------------------------------------------
// A. Six new hook events — typed (all typed-not-fired; see HookEvent note)
// ---------------------------------------------------------------------------

describe('B2c-A: six NEW-IN-DOCS hook events are typed', () => {
  it('every new event name is assignable to HookEvent', () => {
    const events = [
      'Setup',
      'TeammateIdle',
      'TaskCompleted',
      'ConfigChange',
      'WorktreeCreate',
      'WorktreeRemove',
    ] as const satisfies readonly HookEvent[];
    expect(events).toHaveLength(6);
  });

  it('input types carry the official fields (compile-time shape locks)', () => {
    const base = { session_id: 's', cwd: '/w' };

    const setup = {
      ...base,
      hook_event_name: 'Setup',
      trigger: 'maintenance',
    } satisfies SetupHookInput;

    const teammate = {
      ...base,
      hook_event_name: 'TeammateIdle',
      teammate_name: 'ada',
      team_name: 'core',
    } satisfies TeammateIdleHookInput;

    const task = {
      ...base,
      hook_event_name: 'TaskCompleted',
      task_id: 't1',
      task_subject: 'ship it',
      task_description: 'details',
    } satisfies TaskCompletedHookInput;

    const config = {
      ...base,
      hook_event_name: 'ConfigChange',
      source: 'local_settings',
      file_path: '/w/.claude/settings.json',
    } satisfies ConfigChangeHookInput;

    const wtCreate = {
      ...base,
      hook_event_name: 'WorktreeCreate',
      name: 'feature-x',
    } satisfies WorktreeCreateHookInput;

    const wtRemove = {
      ...base,
      hook_event_name: 'WorktreeRemove',
      worktree_path: '/w/.worktrees/feature-x',
    } satisfies WorktreeRemoveHookInput;

    // Each is a member of the HookInput union.
    const inputs: HookInput[] = [setup, teammate, task, config, wtCreate, wtRemove];
    expect(inputs.map((i) => i.hook_event_name)).toEqual([
      'Setup',
      'TeammateIdle',
      'TaskCompleted',
      'ConfigChange',
      'WorktreeCreate',
      'WorktreeRemove',
    ]);
  });

  it('BaseHookInput carries the new prompt_id/permission_mode/effort optionals', () => {
    const setup = {
      session_id: 's',
      cwd: '/w',
      hook_event_name: 'Setup',
      trigger: 'init',
      prompt_id: '00000000-0000-4000-8000-000000000001',
      permission_mode: 'default',
      effort: { level: 'high' },
    } satisfies SetupHookInput;
    expect(setup.effort.level).toBe('high');
  });
});

// ---------------------------------------------------------------------------
// A'. Stop / SubagentStop background_tasks / session_crons (typed-not-populated)
// ---------------------------------------------------------------------------

describe('B2c-A2: Stop/SubagentStop background_tasks + session_crons typed', () => {
  it('accepts the official summary shapes', () => {
    const bg = {
      id: 'bg1',
      type: 'shell',
      status: 'running',
      description: 'long build',
    } satisfies BackgroundTaskSummary;
    const cron = {
      id: 'c1',
      schedule: '0 * * * *',
      recurring: true,
      prompt: 'hourly check',
    } satisfies SessionCronSummary;

    const stop = {
      session_id: 's',
      cwd: '/w',
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: 'done',
      background_tasks: [bg],
      session_crons: [cron],
    } satisfies StopHookInput;

    const subStop = {
      session_id: 's',
      cwd: '/w',
      hook_event_name: 'SubagentStop',
      stop_hook_active: false,
      background_tasks: [bg],
      session_crons: [cron],
    } satisfies SubagentStopHookInput;

    expect(stop.background_tasks?.[0]?.id).toBe('bg1');
    expect(subStop.session_crons?.[0]?.recurring).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// B. MessageDisplay incremental protocol — type shape + real emission
// ---------------------------------------------------------------------------

describe('B2c-B: MessageDisplay incremental protocol', () => {
  it('type carries official fields + deprecated message_text dual track', () => {
    const input = {
      session_id: 's',
      cwd: '/w',
      hook_event_name: 'MessageDisplay',
      turn_id: '1',
      message_id: 'msg_1',
      index: 0,
      final: true,
      delta: 'hello',
      message_text: 'hello',
    } satisfies MessageDisplayHookInput;
    expect(input.final).toBe(true);
    expect(input.delta).toBe(input.message_text);
  });

  it('fires once per completed message with official fields populated', async () => {
    const captured: MessageDisplayHookInput[] = [];
    const hooks = new DefaultHookRunner({
      hooks: {
        MessageDisplay: [
          {
            hooks: [
              async (input) => {
                captured.push(input as MessageDisplayHookInput);
                return { continue: true };
              },
            ],
          },
        ],
      },
      debug: () => {},
    });

    const transport = new MockTransport([textReplyEvents('the answer')]);
    const messages: SDKMessage[] = [];
    for await (const m of runAgentLoop(
      [{ role: 'user', content: 'hi' }],
      makeEngineDeps(transport, hooks),
      engineConfig(),
    )) {
      messages.push(m);
    }

    expect(captured).toHaveLength(1);
    const md = captured[0]!;
    // Non-incremental honest subset: one emit per completed message.
    expect(md.final).toBe(true);
    expect(md.index).toBe(0);
    expect(md.delta).toBe('the answer');
    // Dual-track legacy field still carries the same whole text.
    expect(md.message_text).toBe('the answer');
    // turn_id is the (1-based) turn number; message_id is a stable string.
    expect(md.turn_id).toBe('1');
    expect(typeof md.message_id).toBe('string');
    expect(md.message_id.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// C. Pure-type additions (drop-in type surface)
// ---------------------------------------------------------------------------

describe('B2c-C: pure-type NEW-IN-DOCS additions', () => {
  it('SDKAssistantMessage.error (10-value enum)', () => {
    const errs = [
      'authentication_failed',
      'oauth_org_not_allowed',
      'billing_error',
      'rate_limit',
      'overloaded',
      'invalid_request',
      'model_not_found',
      'server_error',
      'max_output_tokens',
      'unknown',
    ] as const satisfies readonly SDKAssistantMessageError[];
    expect(errs).toHaveLength(10);

    const msg = {
      type: 'assistant',
      uuid: 'u',
      session_id: 's',
      message: {
        id: 'm',
        type: 'message',
        role: 'assistant',
        model: 'claude-test-1',
        content: [],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
      parent_tool_use_id: null,
      error: 'overloaded',
    } satisfies SDKAssistantMessage;
    expect(msg.error).toBe('overloaded');
  });

  it('SDKMessageOrigin (6 kinds) + origin envelope on user message', () => {
    const origins = [
      { kind: 'human' },
      { kind: 'channel', server: 'srv' },
      { kind: 'peer', from: 'a', name: 'n', senderTaskId: 't' },
      { kind: 'task-notification' },
      { kind: 'coordinator' },
      { kind: 'auto-continuation' },
    ] as const satisfies readonly SDKMessageOrigin[];
    expect(origins).toHaveLength(6);

    const user = {
      type: 'user',
      session_id: 's',
      message: { role: 'user', content: 'hi' },
      parent_tool_use_id: null,
      origin: { kind: 'human' },
    } satisfies SDKUserMessage;
    expect(user.origin?.kind).toBe('human');
  });

  it('SDKResultMessage terminal_reason (18) + fast_mode_state (3) + origin', () => {
    // Exhaustive lock on the union (0.3.207 chase added six members to the
    // original twelve). `satisfies readonly TerminalReason[]` reds the build
    // if a member here is dropped from the type.
    const reasons = [
      'completed',
      'max_turns',
      'tool_deferred',
      'aborted_streaming',
      'aborted_tools',
      'hook_stopped',
      'stop_hook_prevented',
      'blocking_limit',
      'rapid_refill_breaker',
      'prompt_too_long',
      'image_error',
      'model_error',
      'api_error',
      'malformed_tool_use_exhausted',
      'budget_exhausted',
      'structured_output_retry_exhausted',
      'tool_deferred_unavailable',
      'turn_setup_failed',
    ] as const satisfies readonly TerminalReason[];
    expect(new Set(reasons).size).toBe(18);

    const result = {
      type: 'result',
      subtype: 'success',
      uuid: 'u',
      session_id: 's',
      duration_ms: 1,
      duration_api_ms: 1,
      is_error: false,
      num_turns: 1,
      result: 'ok',
      stop_reason: 'end_turn',
      total_cost_usd: 0,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      modelUsage: {},
      permission_denials: [],
      terminal_reason: 'completed',
      fast_mode_state: 'on',
      origin: { kind: 'task-notification' },
    } satisfies SDKResultMessage;
    if (result.subtype !== 'success') throw new Error('unreachable');
    expect(result.terminal_reason).toBe('completed');

    const fastStates = ['on', 'off', 'cooldown'] as const satisfies readonly FastModeState[];
    expect(fastStates).toHaveLength(3);
  });

  it('SDKControlInitializeResponse.fast_mode_state optional', () => {
    const init = {
      commands: [],
      agents: [],
      output_style: 'default',
      available_output_styles: [],
      models: [],
      account: { apiKeySource: 'oauth' },
      fast_mode_state: 'cooldown',
    } satisfies SDKControlInitializeResponse;
    expect(init.fast_mode_state).toBe('cooldown');
  });

  it("ApiKeySource includes 'oauth'", () => {
    const src: ApiKeySource = 'oauth';
    expect(src).toBe('oauth');
  });

  it('ThinkingConfigParam.display + ThinkingDisplay', () => {
    const displays = ['summarized', 'omitted'] as const satisfies readonly ThinkingDisplay[];
    expect(displays).toHaveLength(2);
    const adaptive = { type: 'adaptive', display: 'summarized' } satisfies ThinkingConfigParam;
    const enabled = {
      type: 'enabled',
      budgetTokens: 4096,
      display: 'omitted',
    } satisfies ThinkingConfigParam;
    expect(adaptive.type).toBe('adaptive');
    expect(enabled.type).toBe('enabled');
  });

  it('systemPrompt preset excludeDynamicSections', () => {
    const opts = {
      provider: { apiKey: 'k' },
      systemPrompt: { type: 'preset', preset: 'claude_code', excludeDynamicSections: true },
    } satisfies Options;
    const sp = opts.systemPrompt;
    if (typeof sp === 'string' || !('preset' in sp)) throw new Error('unreachable');
    expect(sp.excludeDynamicSections).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Engine-deps helper (mirrors the b2b template; hooks parametrized)
// ---------------------------------------------------------------------------

function makeEngineDeps(transport: MockTransport, hooks: DefaultHookRunner): EngineDeps {
  return {
    transport,
    builtinTools: new Map(),
    mcp: {
      async connectAll() {},
      statuses: () => [],
      allTools: () => [],
      has: () => false,
      async call() {
        return { content: [{ type: 'text' as const, text: 'x' }], isError: true };
      },
      async listResources() {
        return [];
      },
      async readResource() {
        return [];
      },
      async reconnect() {},
      setEnabled() {},
      async setServers() {
        return {};
      },
      async closeAll() {},
    },
    permissions: new DefaultPermissionGate({ debug: () => {}, mode: 'bypassPermissions' }),
    hooks,
    toolContext: {
      cwd: '/w',
      additionalDirectories: [],
      env: {},
      signal: new AbortController().signal,
      debug: () => {},
    },
    debug: () => {},
  };
}

function engineConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return {
    model: 'claude-test-1',
    maxOutputTokens: 1024,
    systemPrompt: 'You are a test agent.',
    includePartialMessages: false,
    sessionId: 'sess-b2c',
    cwd: '/w',
    ...overrides,
  };
}
