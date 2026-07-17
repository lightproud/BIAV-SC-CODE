/**
 * Cross-protocol subagent transport routing (P0, 2026-07-13).
 *
 * Before this feature the subagent runtime handed EVERY child the parent
 * transport unconditionally; a child model served only on the gateway's other
 * wire protocol rode the wrong route and 400'd "model not found". These tests
 * lock the acceptance matrix: resolver absent / same-protocol -> shared
 * parent transport (byte-for-byte the old behavior); cross-protocol ->
 * resolver-provided transport, per-child model integrity under concurrency,
 * owned-transport disposal at query teardown, fork never switching, and the
 * thinking safe-degradation rules for non-Claude child models.
 */

import { describe, expect, it, vi } from 'vitest';

import { createSubagentRuntime, type SubagentRuntimeOptions } from '../src/subagents/runtime.js';
import { createSubagentTransportResolver } from '../src/subagents/transport-resolver.js';
import { runUtilityCall } from '../src/generators/runtime.js';
import { buildCompactionConfig, maybeAutoCompact } from '../src/engine/compaction.js';
import { AnthropicTransport } from '../src/transport/anthropic.js';
import { OpenAIChatTransport } from '../src/transport/openai.js';
import { DefaultHookRunner } from '../src/hooks/runner.js';
import { DefaultPermissionGate } from '../src/permissions/gate.js';
import type {
  BuiltinTool,
  EngineConfig,
  McpRegistry,
  SpawnSubagentParams,
  Transport,
} from '../src/internal/contracts.js';
import type {
  AgentDefinition,
  APIMessageParam,
  CallToolResult,
  McpServerStatus,
  ProviderConfig,
  RawMessageStreamEvent,
  SubagentTransportHandle,
  SubagentTransportRequest,
  SubagentTransportResolver,
  ThinkingConfigParam,
} from '../src/types.js';
import { MockTransport, textReplyEvents } from './helpers/mock-transport.js';

class FakeMcp implements McpRegistry {
  async connectAll(): Promise<void> {}
  statuses(): McpServerStatus[] {
    return [];
  }
  allTools(): [] {
    return [];
  }
  has(): boolean {
    return false;
  }
  async call(): Promise<CallToolResult> {
    return { content: [{ type: 'text', text: 'x' }], isError: true };
  }
  async reconnect(): Promise<void> {}
  setEnabled(): void {}
  async setServers() {
    return { servers: [] };
  }
  async closeAll(): Promise<void> {}
}

function makeConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return {
    model: 'azure/gpt-5-parent',
    maxOutputTokens: 1024,
    systemPrompt: 'parent',
    includePartialMessages: false,
    sessionId: 'parent-sess',
    cwd: '/tmp/sub-transport-test',
    ...overrides,
  };
}

function makeRuntime(cfg: {
  parentScripts?: RawMessageStreamEvent[][];
  agents?: Record<string, AgentDefinition>;
  engineConfig?: Partial<EngineConfig>;
  provider?: ProviderConfig;
  resolveSubagentTransport?: SubagentTransportResolver;
  parentTransport?: MockTransport;
  debugSink?: string[];
}) {
  const parent = cfg.parentTransport ?? new MockTransport(cfg.parentScripts ?? []);
  const debugSink = cfg.debugSink ?? [];
  const engineConfig = makeConfig(cfg.engineConfig);
  const opts: SubagentRuntimeOptions = {
    agents: cfg.agents ?? {},
    baseBuiltins: new Map<string, BuiltinTool>(),
    mcp: new FakeMcp(),
    transport: parent,
    hooks: new DefaultHookRunner({ hooks: {}, debug: () => {} }),
    parentGate: new DefaultPermissionGate({ debug: () => {} }),
    engineConfig,
    provider: cfg.provider,
    resolveSubagentTransport: cfg.resolveSubagentTransport,
    cwd: '/tmp/sub-transport-test',
    env: {},
    additionalDirectories: [],
    outerSignal: new AbortController().signal,
    sessionId: () => engineConfig.sessionId,
    debug: (m) => debugSink.push(m),
  };
  return { runtime: createSubagentRuntime(opts), parent, debugSink };
}

const baseParams = (over: Partial<SpawnSubagentParams> = {}): SpawnSubagentParams => ({
  subagentType: 'worker',
  prompt: 'do the task',
  toolUseId: '',
  signal: new AbortController().signal,
  ...over,
});

const WORKER: AgentDefinition = {
  description: 'cross-protocol worker',
  prompt: 'you are the worker',
  model: 'bailian/deepseek-v4-pro',
  tools: [],
};

/** MockTransport with a dispose spy (the built-ins implement none). */
class DisposableMockTransport extends MockTransport {
  disposed = 0;
  dispose(): void {
    this.disposed += 1;
  }
}

const asHandle = (t: Transport): SubagentTransportHandle => t as SubagentTransportHandle;

describe('subagent transport routing (runtime)', () => {
  it('no resolver -> the child rides the parent transport (existing behavior)', async () => {
    const { runtime, parent } = makeRuntime({
      parentScripts: [textReplyEvents('child done')],
      agents: { worker: WORKER },
    });
    const res = await runtime.makeSpawnFn(0)(baseParams());
    expect(res.isError).toBe(false);
    expect(parent.requests).toHaveLength(1);
    expect(parent.requests[0]?.model).toBe('bailian/deepseek-v4-pro');
  });

  it('resolver returning undefined -> shared parent + shared-parent log line', async () => {
    const debugSink: string[] = [];
    const resolver = vi.fn(() => undefined);
    const { runtime, parent } = makeRuntime({
      parentScripts: [textReplyEvents('child done')],
      agents: { worker: WORKER },
      provider: { protocol: 'openai-chat' },
      resolveSubagentTransport: resolver,
      debugSink,
    });
    const res = await runtime.makeSpawnFn(0)(baseParams());
    expect(res.isError).toBe(false);
    expect(parent.requests).toHaveLength(1);
    expect(resolver).toHaveBeenCalledOnce();
    const input = resolver.mock.calls[0]?.[0] as SubagentTransportRequest;
    expect(input.model).toBe('bailian/deepseek-v4-pro');
    expect(input.parentModel).toBe('azure/gpt-5-parent');
    expect(input.parentProtocol).toBe('openai-chat');
    expect(input.fork).toBe(false);
    const log = debugSink.find((l) => l.includes('"transportMode"'));
    expect(log).toContain('"transportMode":"shared-parent"');
  });

  it('cross-protocol resolution -> child request rides the NEW transport, parent untouched', async () => {
    const child = new MockTransport([textReplyEvents('child done')]);
    const debugSink: string[] = [];
    const { runtime, parent } = makeRuntime({
      parentScripts: [],
      agents: { worker: WORKER },
      provider: { protocol: 'openai-chat' },
      resolveSubagentTransport: () => ({
        transport: asHandle(child),
        protocol: 'anthropic',
      }),
      debugSink,
    });
    const res = await runtime.makeSpawnFn(0)(baseParams());
    expect(res.isError).toBe(false);
    expect(parent.requests).toHaveLength(0);
    expect(child.requests).toHaveLength(1);
    expect(child.requests[0]?.model).toBe('bailian/deepseek-v4-pro');
    const log = debugSink.find((l) => l.includes('"transportMode"'));
    expect(log).toContain('"childProtocol":"anthropic"');
    expect(log).toContain('"parentProtocol":"openai-chat"');
    expect(log).toContain('"transportMode":"resolver-shared"');
  });

  it('fork: true never consults the resolver and keeps the parent transport + model', async () => {
    const resolver = vi.fn(() => {
      throw new Error('resolver must not be called for forks');
    });
    const { runtime, parent } = makeRuntime({
      parentScripts: [textReplyEvents('fork done')],
      agents: { worker: WORKER },
      provider: { protocol: 'openai-chat' },
      resolveSubagentTransport: resolver,
    });
    const res = await runtime.makeSpawnFn(0)(
      baseParams({
        fork: true,
        parentHistory: [{ role: 'user', content: 'earlier turn' }],
      }),
    );
    expect(res.isError).toBe(false);
    expect(resolver).not.toHaveBeenCalled();
    expect(parent.requests).toHaveLength(1);
    expect(parent.requests[0]?.model).toBe('azure/gpt-5-parent');
  });

  it('owned child transport is disposed at settleAll; a shared parent never is', async () => {
    const child = new DisposableMockTransport([textReplyEvents('child done')]);
    const parent = new DisposableMockTransport([]);
    const { runtime } = makeRuntime({
      agents: { worker: WORKER },
      parentTransport: parent,
      provider: { protocol: 'openai-chat' },
      resolveSubagentTransport: () => ({
        transport: asHandle(child),
        owned: true,
        protocol: 'anthropic',
      }),
    });
    const res = await runtime.makeSpawnFn(0)(baseParams());
    expect(res.isError).toBe(false);
    expect(child.disposed).toBe(0); // NOT per-child: SendMessage can revive it
    await runtime.settleAll();
    expect(child.disposed).toBe(1);
    expect(parent.disposed).toBe(0);
    await runtime.settleAll(); // idempotent
    expect(child.disposed).toBe(1);
  });

  it('a throwing resolver fails the spawn honestly (no request leaves on the wrong route)', async () => {
    const { runtime, parent } = makeRuntime({
      agents: { worker: WORKER },
      provider: { protocol: 'openai-chat' },
      resolveSubagentTransport: () => {
        throw new Error('no route for model');
      },
    });
    const res = await runtime.makeSpawnFn(0)(baseParams());
    expect(res.isError).toBe(true);
    expect(res.content).toContain('transport resolution failed');
    expect(res.content).toContain('no route for model');
    expect(parent.requests).toHaveLength(0);
  });

  it('two concurrent cross-protocol children keep their own models on their own transports', async () => {
    const anthropicChild = new MockTransport([
      textReplyEvents('a done'),
      textReplyEvents('a2 done'),
    ]);
    const { runtime, parent } = makeRuntime({
      parentScripts: [textReplyEvents('p done')],
      agents: {
        worker: WORKER,
        native: { description: 'same-protocol worker', prompt: 'p', model: 'azure/gpt-5-mini', tools: [] },
      },
      provider: { protocol: 'openai-chat' },
      resolveSubagentTransport: ({ model }) =>
        model.startsWith('azure/')
          ? undefined
          : { transport: asHandle(anthropicChild), protocol: 'anthropic' },
    });
    const spawn = runtime.makeSpawnFn(0);
    const [a, b, c] = await Promise.all([
      spawn(baseParams()),
      spawn(baseParams({ subagentType: 'native' })),
      spawn(baseParams()),
    ]);
    expect(a?.isError).toBe(false);
    expect(b?.isError).toBe(false);
    expect(c?.isError).toBe(false);
    expect(parent.requests.map((r) => r.model)).toEqual(['azure/gpt-5-mini']);
    expect(anthropicChild.requests.map((r) => r.model)).toEqual([
      'bailian/deepseek-v4-pro',
      'bailian/deepseek-v4-pro',
    ]);
  });

  it('child usage on a switched transport still lands in the shared ledger', async () => {
    const child = new MockTransport([
      textReplyEvents('child done', {
        model: 'bailian/deepseek-v4-pro',
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    ]);
    const { runtime } = makeRuntime({
      agents: { worker: WORKER },
      provider: { protocol: 'openai-chat' },
      resolveSubagentTransport: () => ({ transport: asHandle(child), protocol: 'anthropic' }),
    });
    const res = await runtime.makeSpawnFn(0)(baseParams());
    expect(res.isError).toBe(false);
    const ledger = runtime.drainUsageLedger();
    expect(ledger.usage.input_tokens).toBeGreaterThan(0);
    expect(Object.keys(ledger.modelUsage)).toContain('bailian/deepseek-v4-pro');
  });
});

describe('subagent thinking re-derivation', () => {
  const spawnAndCapture = async (cfg: {
    childModel: string;
    resolution?: { thinking?: ThinkingConfigParam; maxThinkingTokens?: number };
    switched: boolean;
  }) => {
    const child = new MockTransport([textReplyEvents('done')]);
    const { runtime, parent } = makeRuntime({
      parentScripts: cfg.switched ? [] : [textReplyEvents('done')],
      agents: {
        worker: { ...WORKER, model: cfg.childModel },
      },
      // maxOutputTokens must leave room for the API's 1024-token thinking
      // budget floor on the pre-adaptive (enabled+budget) wire form.
      engineConfig: {
        thinking: { type: 'adaptive' },
        maxThinkingTokens: 9000,
        maxOutputTokens: 8192,
      },
      provider: { protocol: 'openai-chat' },
      resolveSubagentTransport: cfg.switched
        ? () => ({
            transport: asHandle(child),
            protocol: 'anthropic',
            ...(cfg.resolution ?? {}),
          })
        : () => undefined,
    });
    const res = await runtime.makeSpawnFn(0)(baseParams());
    expect(res.isError).toBe(false);
    const req = (cfg.switched ? child : parent).requests[0];
    expect(req).toBeDefined();
    return req!;
  };

  it('switched transport + non-Claude child model -> inherited thinking is DROPPED', async () => {
    const req = await spawnAndCapture({
      childModel: 'bailian/deepseek-v4-pro',
      switched: true,
    });
    expect(req.thinking).toBeUndefined();
  });

  it('switched transport + Claude child model -> thinking survives (computeThinking fits the form)', async () => {
    const req = await spawnAndCapture({
      childModel: 'claude-sonnet-5',
      switched: true,
    });
    expect(req.thinking).toEqual({ type: 'adaptive' });
  });

  it('resolution.thinking wins over the inherited config (engine still fits the wire form per model)', async () => {
    // Pre-adaptive Claude child: the engine's computeThinking keeps the
    // enabled+budget form, so the resolver's 2048 budget (vs the parent's
    // inherited adaptive + maxThinkingTokens 9000) is observable on the wire.
    const req = await spawnAndCapture({
      childModel: 'claude-haiku-4-5',
      switched: true,
      resolution: { thinking: { type: 'enabled', budgetTokens: 2048 } },
    });
    expect(req.thinking).toEqual({ type: 'enabled', budget_tokens: 2048 });
  });

  it('resolution.thinking on a non-Claude model: intent passes through, wire form stays model-fitted', async () => {
    // SDK-wide engine semantics (computeThinking, thinking-model.ts): an
    // unknown model id is treated as adaptive-capable, so an explicit
    // enabled+budget intent still hits the wire as {type:'adaptive'} — the
    // same normalization the MAIN loop applies to Options.thinking. Locked
    // here so a future capability-table change is a conscious one.
    const req = await spawnAndCapture({
      childModel: 'bailian/deepseek-v4-pro',
      switched: true,
      resolution: { thinking: { type: 'enabled', budgetTokens: 2048 } },
    });
    expect(req.thinking).toEqual({ type: 'adaptive' });
  });

  it('shared transport -> inherited thinking is untouched (existing behavior)', async () => {
    const req = await spawnAndCapture({
      childModel: 'bailian/deepseek-v4-pro',
      switched: false,
    });
    // Non-Claude id defaults to the adaptive wire form on the shared route —
    // pre-existing behavior, intentionally NOT changed for shared transports.
    expect(req.thinking).toEqual({ type: 'adaptive' });
  });
});

describe('createSubagentTransportResolver (standard implementation)', () => {
  const ENV = {
    ANTHROPIC_API_KEY: 'anthropic-env-key',
    OPENAI_API_KEY: 'openai-env-key',
  };
  const input = (over: Partial<SubagentTransportRequest> = {}): SubagentTransportRequest => ({
    model: 'bailian/deepseek-v4-pro',
    purpose: 'subagent',
    parentModel: 'azure/gpt-5-parent',
    parentProtocol: 'openai-chat',
    parentTransport: asHandle(new MockTransport([])),
    parentProvider: {
      protocol: 'openai-chat',
      baseUrl: 'https://gw.example/v1',
      apiKey: 'parent-gateway-key',
      maxRetries: 7,
      pricing: { 'bailian/': { input: 1, output: 2 } },
    },
    env: ENV,
    fork: false,
    debug: () => {},
    ...over,
  });
  const routing = (m: string) => (m.startsWith('azure/') ? 'openai-chat' as const : 'anthropic' as const);

  it('same protocol -> undefined (share parent); fork -> undefined', () => {
    const resolve = createSubagentTransportResolver({ protocolForModel: routing });
    expect(resolve(input({ model: 'azure/gpt-5-mini' }))).toBeUndefined();
    expect(resolve(input({ fork: true }))).toBeUndefined();
  });

  it('cross-protocol -> a real transport of the right protocol, memoized across spawns', async () => {
    const resolve = createSubagentTransportResolver({ protocolForModel: routing });
    const first = await resolve(input());
    const second = await resolve(input({ model: 'bailian/qwen-x' }));
    expect(first?.transport).toBeInstanceOf(AnthropicTransport);
    expect(first?.protocol).toBe('anthropic');
    expect(first?.owned).toBe(false);
    expect(second?.transport).toBe(first?.transport);
  });

  it('reverse direction: anthropic parent -> openai-chat child transport', async () => {
    const resolve = createSubagentTransportResolver({ protocolForModel: routing });
    const res = await resolve(
      input({
        model: 'azure/gpt-5-mini',
        parentProtocol: 'anthropic',
        parentProvider: { protocol: 'anthropic' },
      }),
    );
    expect(res?.transport).toBeInstanceOf(OpenAIChatTransport);
    expect(res?.protocol).toBe('openai-chat');
  });

  it('protocol-SPECIFIC parent fields (baseUrl/apiKey) are NOT carried across the switch', async () => {
    const resolve = createSubagentTransportResolver({ protocolForModel: routing });
    const res = await resolve(input());
    const transport = res?.transport as unknown as {
      endpoint: string;
      apiKeySource(): string;
    };
    // The openai-chat parent baseUrl ends in /v1; a blind copy would produce
    // https://gw.example/v1/v1/messages. The child must fall back to the
    // protocol's own default chain instead.
    expect(transport.endpoint).toBe('https://api.anthropic.com/v1/messages');
    // Credential comes from env.ANTHROPIC_API_KEY ('project'), never from the
    // parent's provider.apiKey ('user' would betray a carried key).
    expect(transport.apiKeySource()).toBe('project');
  });

  it('explicit per-protocol provider config wins; protocol-agnostic knobs carry from the parent', async () => {
    const resolve = createSubagentTransportResolver({
      protocolForModel: routing,
      providers: {
        anthropic: { baseUrl: 'https://gw.example/anthropic', apiKey: 'child-key' },
      },
    });
    const res = await resolve(input());
    const transport = res?.transport as unknown as {
      endpoint: string;
      apiKeySource(): string;
      provider: ProviderConfig;
    };
    expect(transport.endpoint).toBe('https://gw.example/anthropic/v1/messages');
    expect(transport.apiKeySource()).toBe('user');
    expect(transport.provider.maxRetries).toBe(7);
    expect(transport.provider.pricing).toEqual({ 'bailian/': { input: 1, output: 2 } });
    expect(transport.provider.baseUrl).toBe('https://gw.example/anthropic');
  });
});

// ===========================================================================
// v0.55.0: the same resolver routes utility + compaction calls (purpose field)
// ===========================================================================

describe('utility-call transport routing (runUtilityCall.resolveTransport)', () => {
  it('resolveTransport(model) wins over the provider-built default', async () => {
    const utility = new MockTransport([textReplyEvents('classified: safe')]);
    const seen: string[] = [];
    const text = await runUtilityCall(
      'You are a classifier.',
      'ls -la',
      {
        provider: { protocol: 'openai-chat' },
        resolveTransport: (model) => {
          seen.push(model);
          return utility;
        },
      },
      128,
    );
    expect(text).toBe('classified: safe');
    expect(utility.requests).toHaveLength(1);
    // The resolver receives the RESOLVED utility model (default Haiku tier).
    expect(seen).toEqual([utility.requests[0]!.model]);
    expect(utility.requests[0]!.model).toBe('claude-haiku-4-5');
  });

  it('explicit transport injection still wins over resolveTransport', async () => {
    const injected = new MockTransport([textReplyEvents('ok')]);
    const resolver = vi.fn();
    await runUtilityCall('sys', 'user', { transport: injected, resolveTransport: resolver }, 64);
    expect(injected.requests).toHaveLength(1);
    expect(resolver).not.toHaveBeenCalled();
  });
});

describe('compaction summary transport routing (deps.transportForModel)', () => {
  const userMsg = (text: string): APIMessageParam => ({ role: 'user', content: text });
  const bigHistory = (n: number): APIMessageParam[] =>
    Array.from({ length: n }, (_, i) => userMsg(`turn ${i} ${'x'.repeat(400)}`));

  const compactionDeps = (
    transport: Transport,
    transportForModel?: (
      model: string,
      purpose: 'utility' | 'compaction',
    ) => Transport | Promise<Transport>,
  ) =>
    ({
      transport,
      ...(transportForModel !== undefined ? { transportForModel } : {}),
      builtinTools: new Map(),
      mcp: {} as never,
      permissions: {} as never,
      hooks: new DefaultHookRunner({ hooks: {}, debug: () => {} }),
      toolContext: {} as never,
      debug: () => {},
    }) as unknown as Parameters<typeof maybeAutoCompact>[1];

  const drive = async (
    sessionTransport: Transport,
    summaryModel: string | undefined,
    transportForModel?: (m: string, p: 'utility' | 'compaction') => Transport | Promise<Transport>,
  ) => {
    const config = {
      model: 'azure/gpt-5-parent',
      maxOutputTokens: 500,
      systemPrompt: '',
      includePartialMessages: false,
      sessionId: 'sess-routing',
      cwd: '/work',
      compaction: buildCompactionConfig({
        contextWindowTokens: 2000,
        useApiSummary: true,
        ...(summaryModel !== undefined ? { model: summaryModel } : {}),
      }),
    } as unknown as Parameters<typeof maybeAutoCompact>[2];
    const view = { messages: bigHistory(24) };
    const gen = maybeAutoCompact(
      view,
      compactionDeps(sessionTransport, transportForModel),
      config,
      0,
      new AbortController().signal,
    );
    for await (const _msg of gen) {
      void _msg;
    }
  };

  it('a differing compaction.model routes the summary through transportForModel', async () => {
    const session = new MockTransport([]);
    const summary = new MockTransport([textReplyEvents('SUMMARY')]);
    const calls: Array<[string, string]> = [];
    await drive(session, 'bailian/deepseek-v4-pro', (m, p) => {
      calls.push([m, p]);
      return summary;
    });
    expect(session.requests).toHaveLength(0);
    expect(summary.requests).toHaveLength(1);
    expect(summary.requests[0]!.model).toBe('bailian/deepseek-v4-pro');
    expect(calls).toEqual([['bailian/deepseek-v4-pro', 'compaction']]);
  });

  it('same summary model (or no composer) keeps the session transport', async () => {
    const session = new MockTransport([textReplyEvents('SUMMARY')]);
    const resolver = vi.fn();
    await drive(session, undefined, resolver);
    expect(session.requests).toHaveLength(1);
    expect(resolver).not.toHaveBeenCalled();

    const session2 = new MockTransport([textReplyEvents('SUMMARY')]);
    await drive(session2, 'bailian/deepseek-v4-pro'); // no composer at all
    expect(session2.requests).toHaveLength(1);
    expect(session2.requests[0]!.model).toBe('bailian/deepseek-v4-pro');
  });
});
