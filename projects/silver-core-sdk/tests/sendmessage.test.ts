/**
 * SendMessage (O-B2) tests: the continuation registry on the subagent runtime,
 * the SendMessage built-in tool, the TaskStop agent-id bridge, the official
 * <task-notification> XML drain format, and the coordinator preset's
 * corpus-sync anchors. Transport is the scripted MockTransport; gate + hooks
 * are the real implementations — end-to-end wiring, zero network.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  COORDINATOR_MODE_PROMPT,
  COORDINATOR_MODE_PROMPT_PROVENANCE,
  COORDINATOR_WORKER_AGENT,
  COORDINATOR_WORKER_INSTRUCTIONS,
  COORDINATOR_WORKER_PROVENANCE,
} from '../src/subagents/agents.js';
import {
  createSubagentRuntime,
  type SubagentRuntimeOptions,
} from '../src/subagents/runtime.js';
import { sendMessageTool } from '../src/tools/sendmessage.js';
import { taskStopTool } from '../src/tools/shells.js';
import { DefaultHookRunner } from '../src/hooks/runner.js';
import { DefaultPermissionGate } from '../src/permissions/gate.js';
import type {
  BuiltinTool,
  EngineConfig,
  McpRegistry,
  SessionStore,
  SpawnSubagentParams,
  StoredSession,
  StreamRequest,
  ToolContext,
} from '../src/internal/contracts.js';
import type {
  AgentDefinition,
  APIMessageParam,
  CallToolResult,
  McpServerStatus,
  RawMessageStreamEvent,
} from '../src/types.js';
import { MockTransport, textReplyEvents } from './helpers/mock-transport.js';

// ---------------------------------------------------------------------------
// Fakes / builders (same shapes as tests/subagents.test.ts)
// ---------------------------------------------------------------------------

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

class FakeStore implements SessionStore {
  readonly entries = new Map<string, Array<Record<string, unknown>>>();
  append(sessionId: string, entry: Record<string, unknown>): void {
    const arr = this.entries.get(sessionId) ?? [];
    arr.push(entry);
    this.entries.set(sessionId, arr);
  }
  async load(): Promise<StoredSession | null> {
    return null;
  }
  async list(): Promise<StoredSession[]> {
    return [];
  }
  async latestSessionId(): Promise<string | null> {
    return null;
  }
}

/** MockTransport whose Nth stream() call waits for an external gate first. */
class GatedTransport extends MockTransport {
  constructor(
    scripts: Array<RawMessageStreamEvent[] | (() => RawMessageStreamEvent[])>,
    private readonly gates: Map<number, Promise<void>>,
  ) {
    super(scripts);
  }
  private streamed = 0;
  override async *stream(
    req: StreamRequest,
  ): AsyncGenerator<RawMessageStreamEvent, void> {
    const idx = this.streamed++;
    const gate = this.gates.get(idx);
    if (gate !== undefined) await gate;
    yield* super.stream(req);
  }
}

function makeConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return {
    model: 'claude-sonnet-4-5',
    maxOutputTokens: 1024,
    systemPrompt: 'parent',
    includePartialMessages: false,
    sessionId: 'parent-sess',
    cwd: '/tmp/sendmsg-test',
    ...overrides,
  };
}

function makeRuntime(cfg: {
  transport: MockTransport;
  agents?: Record<string, AgentDefinition>;
  baseBuiltins?: Map<string, BuiltinTool>;
  store?: SessionStore;
  persist?: boolean;
}) {
  const engineConfig = makeConfig();
  const opts: SubagentRuntimeOptions = {
    agents: cfg.agents ?? {},
    baseBuiltins: cfg.baseBuiltins ?? new Map<string, BuiltinTool>(),
    mcp: new FakeMcp(),
    transport: cfg.transport,
    hooks: new DefaultHookRunner({ hooks: {}, debug: () => {} }),
    parentGate: new DefaultPermissionGate({ debug: () => {} }),
    engineConfig,
    store: cfg.store,
    persist: cfg.persist,
    cwd: '/tmp/sendmsg-test',
    env: {},
    additionalDirectories: [],
    outerSignal: new AbortController().signal,
    sessionId: () => engineConfig.sessionId,
    debug: () => {},
  };
  return createSubagentRuntime(opts);
}

const baseParams = (
  over: Partial<SpawnSubagentParams> = {},
): SpawnSubagentParams => ({
  subagentType: 'general-purpose',
  prompt: 'do the task',
  toolUseId: '',
  signal: new AbortController().signal,
  ...over,
});

function agentIdFromResult(content: string): string {
  const m = /agentId: ([\w-]+)/.exec(content);
  if (m === null || m[1] === undefined) throw new Error(`no agentId in: ${content}`);
  return m[1];
}

/** Serialized text of every user turn in a captured request. */
function userTurnTexts(messages: APIMessageParam[]): string[] {
  return messages
    .filter((m) => m.role === 'user')
    .map((m) =>
      typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    );
}

async function tick(n: number): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 1));
}

// ---------------------------------------------------------------------------
// Continuation: foreground children
// ---------------------------------------------------------------------------

describe('SubagentRuntime.sendMessage — foreground continuation', () => {
  it('continues a completed child with its transcript intact and returns the reply', async () => {
    const transport = new MockTransport([
      textReplyEvents('first reply'),
      textReplyEvents('second reply'),
    ]);
    const runtime = makeRuntime({ transport });
    const spawn = runtime.makeSpawnFn(0);
    const spawned = await spawn(baseParams());
    expect(spawned.isError).toBe(false);
    const agentId = spawned.agentId;
    expect(spawned.content).toContain(`agentId: ${agentId}`);

    const reply = await runtime.sendMessage({
      to: agentId,
      message: 'follow-up question',
      signal: new AbortController().signal,
    });
    expect(reply.isError).toBe(false);
    expect(reply.content).toBe('second reply');

    // Context intact: the continuation request replays the full transcript
    // (seed task + first assistant turn) plus the new user turn.
    expect(transport.requests).toHaveLength(2);
    const cont = transport.requests[1]!;
    const users = userTurnTexts(cont.messages);
    expect(users[0]).toContain('do the task');
    expect(users[users.length - 1]).toContain('follow-up question');
    const assistants = cont.messages.filter((m) => m.role === 'assistant');
    expect(JSON.stringify(assistants)).toContain('first reply');
  });

  it('serializes concurrent messages to the same agent in order', async () => {
    const transport = new MockTransport([
      textReplyEvents('initial'),
      textReplyEvents('reply A'),
      textReplyEvents('reply B'),
    ]);
    const runtime = makeRuntime({ transport });
    const spawned = await runtime.makeSpawnFn(0)(baseParams());
    const agentId = spawned.agentId;
    const signal = new AbortController().signal;

    const [a, b] = await Promise.all([
      runtime.sendMessage({ to: agentId, message: 'msg-A', signal }),
      runtime.sendMessage({ to: agentId, message: 'msg-B', signal }),
    ]);
    // Script consumption order proves the request order: msg-A's continuation
    // consumed script #2 ('reply A'), msg-B's script #3 ('reply B').
    expect(a.content).toBe('reply A');
    expect(b.content).toBe('reply B');
    expect(transport.requests).toHaveLength(3);
    // NOTE: the engine passes the LIVE history array by reference, so every
    // captured request shows the final transcript — assert the serialized
    // ORDER inside it (msg-A exchange strictly before msg-B), not per-request
    // tails.
    const finalUsers = userTurnTexts(transport.requests[2]!.messages);
    const iA = finalUsers.findIndex((u) => u.includes('msg-A'));
    const iB = finalUsers.findIndex((u) => u.includes('msg-B'));
    expect(iA).toBeGreaterThan(-1);
    expect(iB).toBeGreaterThan(iA);
    const assistants = transport.requests[2]!.messages
      .filter((m) => m.role === 'assistant')
      .map((m) => JSON.stringify(m.content));
    const jA = assistants.findIndex((c) => c.includes('reply A'));
    const jB = assistants.findIndex((c) => c.includes('reply B'));
    expect(jA).toBeGreaterThan(-1);
    expect(jB).toBeGreaterThan(jA);
  });

  it('errors honestly on an unknown agentId', async () => {
    const runtime = makeRuntime({ transport: new MockTransport([]) });
    const reply = await runtime.sendMessage({
      to: 'no-such-agent',
      message: 'hello',
      signal: new AbortController().signal,
    });
    expect(reply.isError).toBe(true);
    expect(reply.content).toContain('no subagent with agentId "no-such-agent"');
  });

  it('folds continuation usage into the subagent usage ledger', async () => {
    const transport = new MockTransport([
      textReplyEvents('first', { usage: { input_tokens: 3, output_tokens: 4 } }),
      textReplyEvents('second', { usage: { input_tokens: 5, output_tokens: 7 } }),
    ]);
    const runtime = makeRuntime({ transport });
    const spawned = await runtime.makeSpawnFn(0)(baseParams());
    runtime.drainUsageLedger(); // clear the initial run's share
    await runtime.sendMessage({
      to: spawned.agentId,
      message: 'more',
      signal: new AbortController().signal,
    });
    const ledger = runtime.drainUsageLedger();
    expect(ledger.usage.input_tokens).toBe(5);
    expect(ledger.usage.output_tokens).toBe(7);
  });

  it('persists each continuation as its own sidechain episode', async () => {
    const store = new FakeStore();
    const transport = new MockTransport([
      textReplyEvents('first'),
      textReplyEvents('second'),
    ]);
    const runtime = makeRuntime({ transport, store, persist: true });
    const spawned = await runtime.makeSpawnFn(0)(baseParams());
    await runtime.sendMessage({
      to: spawned.agentId,
      message: 'continue please',
      signal: new AbortController().signal,
    });
    const entries = store.entries.get(spawned.agentId) ?? [];
    const kinds = entries.map((e) => e['type']);
    expect(kinds.filter((k) => k === 'sidechain_start')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'sidechain_end')).toHaveLength(2);
    expect(
      entries.some(
        (e) =>
          e['type'] === 'user' &&
          JSON.stringify(e['message']).includes('continue please'),
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Continuation: background children + <task-notification> format
// ---------------------------------------------------------------------------

describe('SubagentRuntime.sendMessage — background flow', () => {
  it('drains the initial background result as official <task-notification> XML', async () => {
    const transport = new MockTransport([textReplyEvents('bg done')]);
    const runtime = makeRuntime({ transport });
    const spawned = await runtime.makeSpawnFn(0)(
      baseParams({ runInBackground: true, description: 'Investigate auth bug' }),
    );
    expect(spawned.background).toBe(true);
    await runtime.settleAll();
    const notes = runtime.drainCompletedResults();
    expect(notes).toHaveLength(1);
    const text = notes[0]!.text;
    expect(text).toContain('<task-notification>');
    expect(text).toContain(`<task-id>${spawned.agentId}</task-id>`);
    expect(text).toContain('<status>completed</status>');
    expect(text).toContain('<summary>Agent "Investigate auth bug" completed</summary>');
    expect(text).toContain('<result>bg done</result>');
    expect(text).toContain('<tool_uses>0</tool_uses>');
    expect(text).toContain('</task-notification>');
  });

  it('acks a message to a background agent and delivers the reply on a later drain', async () => {
    const transport = new MockTransport([
      textReplyEvents('bg done'),
      textReplyEvents('bg reply'),
    ]);
    const runtime = makeRuntime({ transport });
    const spawned = await runtime.makeSpawnFn(0)(
      baseParams({ runInBackground: true, description: 'bg worker' }),
    );
    await runtime.settleAll();
    runtime.drainCompletedResults(); // clear the completion note

    const ack = await runtime.sendMessage({
      to: spawned.agentId,
      message: 'one more thing',
      signal: new AbortController().signal,
    });
    expect(ack.isError).toBe(false);
    expect(ack.content).toContain('Message delivered to background subagent');
    await runtime.settleAll();
    const notes = runtime.drainCompletedResults();
    expect(notes).toHaveLength(1);
    expect(notes[0]!.text).toContain('<result>bg reply</result>');
    expect(notes[0]!.text).toContain('<summary>Agent "bg worker" replied</summary>');
  });

  it('a stopped (killed) background worker can be continued — official semantics', async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => {
      open = r;
    });
    const transport = new GatedTransport(
      [textReplyEvents('never delivered'), textReplyEvents('revived reply')],
      new Map([[0, gate]]),
    );
    const runtime = makeRuntime({ transport });
    const spawned = await runtime.makeSpawnFn(0)(
      baseParams({ runInBackground: true, description: 'stoppable' }),
    );
    await tick(2);
    // Stop it mid-run (the first stream is still gated).
    expect(runtime.stopAgent(spawned.agentId)).toContain('Stopped background subagent');
    open();
    await runtime.settleAll();
    runtime.drainCompletedResults();

    const ack = await runtime.sendMessage({
      to: spawned.agentId,
      message: 'pick it back up',
      signal: new AbortController().signal,
    });
    expect(ack.isError).toBe(false);
    await runtime.settleAll();
    const notes = runtime.drainCompletedResults();
    expect(notes.map((n) => n.text).join('\n')).toContain('revived reply');
  });

  it('stopAgent reports a non-running agent instead of emitting kill events', async () => {
    const transport = new MockTransport([textReplyEvents('done')]);
    const runtime = makeRuntime({ transport });
    const spawned = await runtime.makeSpawnFn(0)(baseParams());
    expect(runtime.stopAgent(spawned.agentId)).toContain('already completed');
    expect(runtime.stopAgent('nope')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The SendMessage built-in tool + TaskStop bridge
// ---------------------------------------------------------------------------

function toolCtx(over: Partial<ToolContext> = {}): ToolContext {
  return {
    cwd: '/tmp/sendmsg-test',
    additionalDirectories: [],
    env: {},
    signal: new AbortController().signal,
    debug: () => {},
    ...over,
  };
}

describe('SendMessage built-in tool', () => {
  it('validates input and requires the root-loop bridge', async () => {
    const missingTo = await sendMessageTool.execute({ message: 'x' }, toolCtx());
    expect(missingTo.isError).toBe(true);
    const missingMsg = await sendMessageTool.execute({ to: 'a' }, toolCtx());
    expect(missingMsg.isError).toBe(true);
    const noBridge = await sendMessageTool.execute(
      { to: 'a', message: 'x' },
      toolCtx(),
    );
    expect(noBridge.isError).toBe(true);
    expect(noBridge.content).toContain('root-loop-only');
  });

  it('delegates to the bridge and returns its result', async () => {
    const calls: Array<{ to: string; message: string }> = [];
    const ctx = toolCtx({
      subagents: {
        send: async (p) => {
          calls.push({ to: p.to, message: p.message });
          return { content: 'bridged reply', isError: false };
        },
        stop: () => undefined,
      },
    });
    const res = await sendMessageTool.execute(
      { to: 'agent-1', message: 'hi', summary: 'greet' },
      ctx,
    );
    expect(res.isError).toBeFalsy();
    expect(res.content).toBe('bridged reply');
    expect(calls).toEqual([{ to: 'agent-1', message: 'hi' }]);
  });
});

describe('TaskStop agent-id bridge', () => {
  it('stops a background subagent by agentId before falling through to shells', async () => {
    const transport = new MockTransport([textReplyEvents('done')]);
    const runtime = makeRuntime({ transport });
    const spawned = await runtime.makeSpawnFn(0)(baseParams());
    const ctx = toolCtx({
      subagents: {
        send: (p) => runtime.sendMessage(p),
        stop: (id) => runtime.stopAgent(id),
      },
    });
    const res = await taskStopTool.execute({ task_id: spawned.agentId }, ctx);
    expect(res.content).toContain(`already completed`);
    // Unknown ids still fall through to the shell manager path.
    const miss = await taskStopTool.execute({ task_id: 'not-an-agent' }, ctx);
    expect(miss.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Child tool-set policy
// ---------------------------------------------------------------------------

describe('child tool-set policy for SendMessage', () => {
  const fakeSendMessage: BuiltinTool = {
    name: 'SendMessage',
    description: 'x',
    inputSchema: { type: 'object', properties: {} },
    readOnly: false,
    async execute() {
      return { content: 'x' };
    },
  };

  it('withholds SendMessage from an isolated child, keeps it for a fork child', async () => {
    const transport = new MockTransport([
      textReplyEvents('iso'),
      textReplyEvents('fork'),
    ]);
    const runtime = makeRuntime({
      transport,
      baseBuiltins: new Map([[fakeSendMessage.name, fakeSendMessage]]),
    });
    const spawn = runtime.makeSpawnFn(0);
    await spawn(baseParams());
    await spawn(
      baseParams({
        fork: true,
        parentHistory: [{ role: 'user', content: 'parent context' }],
      }),
    );
    const isoTools = (transport.requests[0]!.tools ?? []).map((t) => t.name);
    const forkTools = (transport.requests[1]!.tools ?? []).map((t) => t.name);
    expect(isoTools).not.toContain('SendMessage');
    expect(forkTools).toContain('SendMessage');
  });
});

// ---------------------------------------------------------------------------
// Coordinator preset (corpus-sync anchors)
// ---------------------------------------------------------------------------

describe('coordinator preset (O-B2)', () => {
  const archive = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    'Public-Info-Pool',
    'Reference',
    'Claude-Code-System-Prompts',
    'system-prompts',
  );
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const stripHeader = (md: string) => md.replace(/^<!--[\s\S]*?-->\n?/, '');

  it('references only shipped tool names and pairs with the worker preset', () => {
    expect(COORDINATOR_MODE_PROMPT).toContain('**SendMessage**');
    expect(COORDINATOR_MODE_PROMPT).toContain('**Agent**');
    expect(COORDINATOR_MODE_PROMPT).toContain('**TaskStop**');
    // Gated omissions hold: no unshipped/cross-session machinery named.
    expect(COORDINATOR_MODE_PROMPT).not.toContain('subscribe_pr_activity');
    expect(COORDINATOR_MODE_PROMPT).not.toContain('ListAgents');
    expect(COORDINATOR_WORKER_AGENT.prompt).toBe(COORDINATOR_WORKER_INSTRUCTIONS);
    expect(COORDINATOR_WORKER_AGENT.maxTurns).toBe(200);
  });

  it('documents the exact <task-notification> shape the runtime emits', () => {
    for (const tag of [
      '<task-notification>',
      '<task-id>',
      '<status>completed|failed|killed</status>',
      '<subagent_tokens>',
    ]) {
      expect(COORDINATOR_MODE_PROMPT).toContain(tag);
    }
  });

  it.runIf(existsSync(archive))(
    'coordinator-mode prompt still anchors to its archive source',
    () => {
      const desc = norm(COORDINATOR_MODE_PROMPT);
      for (const slug of COORDINATOR_MODE_PROMPT_PROVENANCE.slugs) {
        const file = join(archive, `${slug}.md`);
        expect(existsSync(file), slug).toBe(true);
        const body = norm(stripHeader(readFileSync(file, 'utf8')));
        // Verbatim-reproduced sentences that survive the documented
        // adaptations (tool-name substitution happens in BOTH texts' shared
        // sentences below, so the anchors are substitution-free).
        const anchors = [
          'Parallelism is your superpower',
          'it retains its full prior transcript',
          "Workers can't see your conversation.",
          'proving the code works',
          'never write "based on your findings"',
        ];
        for (const anchor of anchors) {
          expect(body.includes(norm(anchor)), `archive lost: ${anchor}`).toBe(true);
          expect(desc.includes(norm(anchor)), `prompt lost: ${anchor}`).toBe(true);
        }
      }
    },
  );

  it.runIf(existsSync(archive))(
    'coordinator-worker instructions still anchor to their archive source',
    () => {
      const desc = norm(COORDINATOR_WORKER_INSTRUCTIONS);
      const file = join(archive, `${COORDINATOR_WORKER_PROVENANCE.slug}.md`);
      expect(existsSync(file)).toBe(true);
      const body = norm(stripHeader(readFileSync(file, 'utf8')));
      const anchors = body
        .split(/(?<=[.:])\s+/)
        .map(norm)
        .filter((s) => s.length >= 40 && !s.includes('${'))
        .map((s) => s.slice(0, 45));
      expect(anchors.length).toBeGreaterThan(3);
      for (const a of anchors) {
        expect(desc.includes(a), `not represented: ${a}`).toBe(true);
      }
    },
  );
});
