/**
 * R5 LoopControl tool (SCS-REQ-REPOS-01 §3 R5).
 *
 * Propose-only semantics: a call delivers the structured proposal to the
 * host's onProposal callback and acknowledges; the ENGINE's behavior never
 * changes — the loop drives on to the next turn exactly as if no proposal
 * existed. Registration is opt-in via options.loopControl (never in the
 * default built-in set).
 */

import { describe, expect, it } from 'vitest';

import { runAgentLoop } from '../src/engine/loop.js';
import { query } from '../src/query.js';
import {
  LOOP_CONTROL_TOOL_NAME,
  createLoopControlTool,
} from '../src/loop-support/loop-control.js';
import { DefaultPermissionGate } from '../src/permissions/gate.js';
import type {
  BuiltinTool,
  CallToolResult,
  EngineConfig,
  EngineDeps,
  McpRegistry,
} from '../src/internal/contracts.js';
import type {
  LoopStopProposal,
  McpServerStatus,
  SDKMessage,
  SDKResultMessage,
  SDKSystemMessage,
  ToolContext,
} from '../src/types.js';
import {
  MockTransport,
  textReplyEvents,
  toolUseReplyEvents,
} from './helpers/mock-transport.js';
import { makeSSEFetch } from './helpers/sse-fetch.js';

class FakeMcp implements McpRegistry {
  async connectAll(): Promise<void> {}
  statuses(): McpServerStatus[] {
    return [];
  }
  allTools(): [] {
    return [];
  }
  has(_qualifiedName: string): boolean {
    return false;
  }
  async call(): Promise<CallToolResult> {
    return { content: [{ type: 'text', text: 'unexpected mcp call' }], isError: true };
  }
  async reconnect(_serverName: string): Promise<void> {}
  setEnabled(_serverName: string, _enabled: boolean): void {}
  async closeAll(): Promise<void> {}
}

const noHooks = {
  hasHooks: () => false,
  run: async () => ({ continue: true, systemMessages: [], additionalContext: [] }),
};

function ctx(): ToolContext {
  return {
    cwd: '/tmp/loop-control-test',
    additionalDirectories: [],
    env: {},
    signal: new AbortController().signal,
    debug: () => {},
  } as unknown as ToolContext;
}

function makeDeps(transport: MockTransport, tools: BuiltinTool[]): EngineDeps {
  return {
    transport,
    builtinTools: new Map(tools.map((t) => [t.name, t])),
    mcp: new FakeMcp(),
    permissions: new DefaultPermissionGate({}),
    hooks: noHooks,
    toolContext: ctx(),
    debug: () => {},
  } as unknown as EngineDeps;
}

function makeConfig(): EngineConfig {
  return {
    model: 'claude-sonnet-4-5',
    maxOutputTokens: 1024,
    systemPrompt: 'You are a test agent.',
    includePartialMessages: false,
    sessionId: 'sess-loop-control',
    cwd: '/tmp/loop-control-test',
  };
}

async function collect(gen: AsyncGenerator<SDKMessage, void>): Promise<SDKMessage[]> {
  const out: SDKMessage[] = [];
  for await (const m of gen) out.push(m);
  return out;
}

describe('LoopControl tool unit', () => {
  it('pins the model-side surface byte-exactly (description + schema)', () => {
    // The description and schema ARE the model-side surface — pinned like the
    // prompt goldens so drift is deliberate, never accidental. Revise only
    // alongside the COMPAT "待对齐" note (self-designed pending an official
    // command-tool corpus).
    const tool = createLoopControlTool({});
    expect(tool.name).toBe(LOOP_CONTROL_TOOL_NAME);
    expect(tool.readOnly).toBe(true);
    expect(tool.description).toBe(
      'Propose that the host stop the current loop. The proposal is ' +
        'delivered to the host as a structured event; the host alone decides ' +
        'whether the loop continues — calling this tool does not stop, pause, ' +
        'or change anything by itself. Use it when the loop objective appears ' +
        'complete, or when continuing appears pointless or harmful. Give a ' +
        'concrete reason the host can act on.',
    );
    expect(tool.inputSchema).toStrictEqual({
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['propose_stop'],
          description: 'The only supported action: propose stopping the loop.',
        },
        reason: {
          type: 'string',
          description: 'Why the loop should stop (shown to the host).',
        },
      },
      required: ['action', 'reason'],
    });
  });

  it('acknowledges byte-exactly, with or without a wired callback', async () => {
    const expectAck =
      'Stop proposal recorded and delivered to the host. The host decides ' +
      'whether the loop continues — keep working until instructed otherwise.';
    // No callback wired: optional chaining must hold (no crash, same ack).
    const bare = createLoopControlTool({});
    const debugLines: string[] = [];
    const dctx = {
      ...ctx(),
      debug: (m: string) => debugLines.push(m),
    } as unknown as ToolContext;
    const res = await bare.execute(
      { action: 'propose_stop', reason: 'quota met' },
      dctx,
    );
    expect(res.content).toBe(expectAck);
    expect(debugLines.some((l) => l.includes('stop proposed — quota met'))).toBe(true);
  });

  it('delivers the structured proposal and acknowledges without stopping anything', async () => {
    const proposals: LoopStopProposal[] = [];
    const tool = createLoopControlTool({ onProposal: (p) => proposals.push(p) });
    const res = await tool.execute(
      { action: 'propose_stop', reason: 'objective complete' },
      ctx(),
    );
    expect(res.isError).not.toBe(true);
    expect(String(res.content)).toContain('host decides');
    expect(proposals).toEqual([
      { action: 'propose_stop', reason: 'objective complete' },
    ]);
  });

  it('rejects a bad action or an empty/non-string reason, naming the defect', async () => {
    const tool = createLoopControlTool({});
    const bad1 = await tool.execute({ action: 'stop', reason: 'x' }, ctx());
    expect(bad1.isError).toBe(true);
    expect(String(bad1.content)).toContain('unsupported action "stop"');
    expect(String(bad1.content)).toContain('"propose_stop"');
    const bad2 = await tool.execute({ action: 'propose_stop', reason: '  ' }, ctx());
    expect(bad2.isError).toBe(true);
    expect(String(bad2.content)).toContain('"reason" must be a non-empty string');
    const bad3 = await tool.execute({ action: 'propose_stop', reason: 42 }, ctx());
    expect(bad3.isError).toBe(true);
  });

  it('contains a throwing host callback (proposal-independence holds)', async () => {
    const tool = createLoopControlTool({
      onProposal: () => {
        throw new Error('host bug');
      },
    });
    const debugLines: string[] = [];
    const dctx = {
      ...ctx(),
      debug: (m: string) => debugLines.push(m),
    } as unknown as ToolContext;
    const res = await tool.execute({ action: 'propose_stop', reason: 'r' }, dctx);
    expect(res.isError).not.toBe(true);
    // The containment is observable: the host error lands in debug, named.
    expect(
      debugLines.some((l) => l.includes('onProposal callback threw') && l.includes('host bug')),
    ).toBe(true);
  });
});

describe('LoopControl in the engine loop', () => {
  it('the loop CONTINUES past a proposal — engine behavior is proposal-independent', async () => {
    const proposals: LoopStopProposal[] = [];
    const tool = createLoopControlTool({ onProposal: (p) => proposals.push(p) });
    const transport = new MockTransport([
      toolUseReplyEvents(LOOP_CONTROL_TOOL_NAME, {
        action: 'propose_stop',
        reason: 'target count reached',
      }),
      textReplyEvents('kept working after the proposal'),
    ]);
    const messages = await collect(
      runAgentLoop(
        [{ role: 'user', content: 'loop round' }],
        makeDeps(transport, [tool]),
        makeConfig(),
      ),
    );
    // The proposal reached the host…
    expect(proposals).toEqual([
      { action: 'propose_stop', reason: 'target count reached' },
    ]);
    // …and the run went on to a SECOND model turn and ended successfully.
    expect(transport.requests.length).toBe(2);
    const result = messages[messages.length - 1] as SDKResultMessage;
    expect(result.subtype).toBe('success');
    expect(result.result).toContain('kept working');
  });
});

describe('LoopControl registration (opt-in)', () => {
  it('absent by default; present when options.loopControl is wired', async () => {
    const off = query({
      prompt: 'hi',
      options: {
        provider: { apiKey: 'k', fetch: makeSSEFetch([textReplyEvents('a')]) },
        persistSession: false,
        env: { PATH: process.env.PATH, HOME: process.env.HOME },
      },
    });
    const offMsgs = await collect(off);
    const offInit = offMsgs[0] as SDKSystemMessage;
    expect(offInit.tools).not.toContain(LOOP_CONTROL_TOOL_NAME);

    const on = query({
      prompt: 'hi',
      options: {
        provider: { apiKey: 'k', fetch: makeSSEFetch([textReplyEvents('a')]) },
        persistSession: false,
        env: { PATH: process.env.PATH, HOME: process.env.HOME },
        loopControl: {},
      },
    });
    const onMsgs = await collect(on);
    const onInit = onMsgs[0] as SDKSystemMessage;
    expect(onInit.tools).toContain(LOOP_CONTROL_TOOL_NAME);
  });
});
