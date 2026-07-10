/**
 * B2b batch alignment tests (2026-07-05): T2-2 / T2-3 / T2-4 / T2-7 shape
 * alignments + session-face audit tail items. Each test exercises the REAL
 * runtime behavior behind the type change — no assertion here is satisfied by
 * a type-only edit.
 */

import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ConfigurationError,
  createSdkMcpServer,
  getSessionInfo,
  getSessionMessages,
  listSessions,
  query,
  renameSession,
  tool,
} from '../src/index.js';
import type {
  McpServerToolInfo,
  Options,
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from '../src/types.js';
import { DefaultPermissionGate } from '../src/permissions/gate.js';
import { JsonlSessionStore } from '../src/sessions/store.js';
import { runAgentLoop } from '../src/engine/loop.js';
import type { EngineConfig, EngineDeps } from '../src/internal/contracts.js';
import {
  MockTransport,
  textReplyEvents,
  toolUseReplyEvents,
} from './helpers/mock-transport.js';
import { makeSSEFetch } from './helpers/sse-fetch.js';

let sessionDir: string;
let cwd: string;

beforeEach(async () => {
  sessionDir = await mkdtemp(join(tmpdir(), 'bpt-b2b-sess-'));
  cwd = await mkdtemp(join(tmpdir(), 'bpt-b2b-cwd-'));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(sessionDir, { recursive: true, force: true });
  await rm(cwd, { recursive: true, force: true });
});

async function collect(q: Query): Promise<SDKMessage[]> {
  const out: SDKMessage[] = [];
  for await (const m of q) out.push(m);
  return out;
}

/** Streaming input that never yields — keeps the session open with no turn. */
function pendingInput(): AsyncIterable<SDKUserMessage> {
  return {
    [Symbol.asyncIterator]() {
      return { next: () => new Promise<IteratorResult<SDKUserMessage>>(() => {}) };
    },
  };
}

// ---------------------------------------------------------------------------
// T2-3: official runtime-ACCEPTED Options fields on the type surface (21 warn;
// debugFile graduated to honored in P2, so it no longer warns)
// ---------------------------------------------------------------------------

describe('T2-3: official ACCEPTED Options fields are typed + warn once each', () => {
  it('a fully-populated official options literal typechecks and each key warns', async () => {
    const lines: string[] = [];
    // This literal is the test: every field below is OFFICIAL Options surface.
    // Before T2-3 an object literal carrying them failed excess-property
    // checking; now it compiles, and the runtime ACCEPTED loop warns per key.
    const options: Options = {
      debug: true,
      stderr: (d) => lines.push(d),
      persistSession: false,
      provider: { apiKey: 'test-key' },
      cwd,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      // --- the T2-3 fields (debugFile now honored, not warned) ---
      agent: 'main-agent',
      agentProgressSummaries: true,
      debugFile: join(cwd, 'debug.log'),
      effort: 'high',
      executable: 'node',
      executableArgs: ['--max-old-space-size=512'],
      extraArgs: { 'some-flag': null },
      forwardSubagentText: true,
      managedSettings: { permissions: {} },
      pathToClaudeCodeExecutable: '/usr/local/bin/claude',
      permissionPromptToolName: 'mcp__perm__prompt',
      planModeInstructions: 'plan carefully',
      plugins: [{ type: 'local', path: join(cwd, 'plugin') }],
      promptSuggestions: true,
      resumeSessionAt: '00000000-0000-4000-8000-000000000001',
      settings: { outputStyle: 'default' },
      skills: 'all',
      spawnClaudeCodeProcess: () => {
        throw new Error('never spawned (N/A-by-design)');
      },
      taskBudget: { total: 10_000 },
      title: 'B2b test session',
      toolAliases: { Bash: 'mcp__workspace__bash' },
      toolConfig: { askUserQuestion: { previewFormat: 'markdown' } },
    };
    const q = query({ prompt: pendingInput(), options });
    // Warnings are emitted synchronously at query() construction.
    const accepted = [
      'agent',
      'agentProgressSummaries',
      // debugFile graduated out of ACCEPTED-IGNORED in P2 — it is now honored
      // (debug lines appended to the file), so it no longer warns.
      'effort',
      'executable',
      'executableArgs',
      'extraArgs',
      'forwardSubagentText',
      'managedSettings',
      'pathToClaudeCodeExecutable',
      'permissionPromptToolName',
      'planModeInstructions',
      'plugins',
      'promptSuggestions',
      'resumeSessionAt',
      'settings',
      'skills',
      'spawnClaudeCodeProcess',
      'taskBudget',
      'title',
      'toolAliases',
      'toolConfig',
    ];
    expect(accepted).toHaveLength(21);
    for (const key of accepted) {
      expect(
        lines.some((l) => l.includes(`option '${key}' is accepted for compatibility`)),
        `expected an ACCEPTED warning for '${key}'`,
      ).toBe(true);
    }
    q.close();
  });
});

// ---------------------------------------------------------------------------
// T2-7: removeDirectories is honored at runtime
// ---------------------------------------------------------------------------

describe('T2-7: PermissionUpdate removeDirectories real revocation', () => {
  it('revokes base + session dirs, re-grant clears, non-session ignored', () => {
    const gate = new DefaultPermissionGate({ debug: () => {} });
    const base = [join(cwd, 'base')];
    const extra = join(cwd, 'extra');

    gate.applyUpdates([
      { type: 'addDirectories', directories: [extra], destination: 'session' },
    ]);
    expect(gate.effectiveAdditionalDirectories(base)).toEqual([...base, extra]);

    gate.applyUpdates([
      { type: 'removeDirectories', directories: [extra, base[0]!], destination: 'session' },
    ]);
    expect(gate.effectiveAdditionalDirectories(base)).toEqual([]);
    expect(gate.removedDirectories()).toEqual([extra, base[0]!]);
    expect(gate.addedDirectories()).toEqual([]);

    // A later addDirectories for the same path clears the revocation.
    gate.applyUpdates([
      { type: 'addDirectories', directories: [base[0]!], destination: 'session' },
    ]);
    expect(gate.effectiveAdditionalDirectories(base)).toEqual([base[0]!]);

    // Non-session destinations stay debug-ignored (unchanged policy).
    gate.applyUpdates([
      { type: 'removeDirectories', directories: [base[0]!], destination: 'userSettings' },
    ]);
    expect(gate.effectiveAdditionalDirectories(base)).toEqual([base[0]!]);
  });
});

// ---------------------------------------------------------------------------
// T2-2: setMcpServers official diff + mcpServerStatus official tools shape
// ---------------------------------------------------------------------------

describe('T2-2/T2-7: MCP surface official shapes', () => {
  it('setMcpServers reports real added/removed/errors; status tools are objects', async () => {
    const q = query({
      prompt: pendingInput(),
      options: {
        persistSession: false,
        provider: { apiKey: 'test-key' },
        cwd,
        env: { PATH: process.env.PATH, HOME: process.env.HOME },
      },
    });
    try {
      const echo = tool(
        'echo',
        'Echo tool',
        {},
        async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
        { readOnlyHint: true },
      );
      const alpha = createSdkMcpServer({ name: 'alpha', tools: [echo] });

      const res1 = await q.setMcpServers({ alpha });
      expect(res1.added).toEqual(['alpha']);
      expect(res1.removed).toEqual([]);
      expect(res1.errors).toEqual({});
      // Deprecated dual-track payload still present during the transition.
      expect(Array.isArray(res1.servers)).toBe(true);

      // Official tools element shape on mcpServerStatus().
      const statuses = await q.mcpServerStatus();
      const st = statuses.find((s) => s.name === 'alpha');
      expect(st?.status).toBe('connected');
      const tools = st?.tools as McpServerToolInfo[];
      expect(tools).toHaveLength(1);
      expect(tools[0]).toEqual({
        name: 'echo',
        description: 'Echo tool',
        annotations: { readOnly: true },
      });

      // Removal diff + a failing server lands in errors (sse is unsupported).
      const res2 = await q.setMcpServers({
        broken: { type: 'sse', url: 'http://localhost:1/sse' },
      });
      expect(res2.added).toEqual(['broken']);
      expect(res2.removed).toEqual(['alpha']);
      expect(Object.keys(res2.errors ?? {})).toEqual(['broken']);
      expect(res2.errors!['broken']).toBeTruthy();
    } finally {
      q.close();
    }
  });
});

// ---------------------------------------------------------------------------
// T2-4: stop_reason on both result arms
// ---------------------------------------------------------------------------

function makeEngineDeps(transport: MockTransport): EngineDeps {
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
    hooks: {
      hasHooks: () => false,
      async run() {
        return { continue: true, systemMessages: [], additionalContext: [] };
      },
    },
    toolContext: {
      cwd,
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
    sessionId: 'sess-b2b',
    cwd,
    ...overrides,
  };
}

describe('T2-4: SDKResultMessage.stop_reason both arms', () => {
  it('success arm carries the required API stop_reason', async () => {
    const transport = new MockTransport([textReplyEvents('done')]);
    const messages: SDKMessage[] = [];
    for await (const m of runAgentLoop(
      [{ role: 'user', content: 'hi' }],
      makeEngineDeps(transport),
      engineConfig(),
    )) {
      messages.push(m);
    }
    const result = messages[messages.length - 1] as SDKResultMessage;
    expect(result.subtype).toBe('success');
    expect(result.stop_reason).toBe('end_turn');
  });

  it('error arm carries the LAST observed stop_reason (tool_use before max_turns)', async () => {
    // Turn 1 requests a nonexistent tool (stop_reason tool_use); maxTurns 1
    // then trips before turn 2 — the error result must report 'tool_use'.
    const transport = new MockTransport([toolUseReplyEvents('NoSuchTool', {})]);
    const messages: SDKMessage[] = [];
    for await (const m of runAgentLoop(
      [{ role: 'user', content: 'hi' }],
      makeEngineDeps(transport),
      engineConfig({ maxTurns: 1 }),
    )) {
      messages.push(m);
    }
    const result = messages[messages.length - 1] as SDKResultMessage;
    expect(result.subtype).toBe('error_max_turns');
    if (result.subtype === 'success') return;
    expect(result.stop_reason).toBe('tool_use');
    // ModelUsage official metering fields (T2-4) ride every result.
    const mu = result.modelUsage['claude-test-1']!;
    expect(mu.contextWindow).toBe(200_000);
    expect(mu.maxOutputTokens).toBe(1024);
  });
});

// ---------------------------------------------------------------------------
// Session-face audit tail (#123/#124)
// ---------------------------------------------------------------------------

describe('session-face tail items', () => {
  function seedSession(id: string, firstPrompt = 'hello world'): void {
    const store = new JsonlSessionStore({ sessionDir });
    store.append(id, {
      type: 'meta',
      sessionId: id,
      createdAt: Date.now(),
      cwd,
      firstPrompt,
    });
    store.append(id, {
      type: 'user',
      uuid: 'u1',
      message: { role: 'user', content: firstPrompt },
    });
    store.append(id, {
      type: 'assistant',
      uuid: 'a1',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
    });
    store.append(id, {
      type: 'user',
      uuid: 'u2',
      message: { role: 'user', content: 'second' },
    });
  }

  it('getSessionInfo returns undefined (official) for an unknown id', async () => {
    expect(await getSessionInfo('missing-session', { sessionDir })).toBeUndefined();
  });

  it('renameSession rejects blank titles and persists the trimmed title', async () => {
    seedSession('sess-rename');
    await expect(renameSession('sess-rename', '   ', { sessionDir })).rejects.toBeInstanceOf(
      ConfigurationError,
    );
    // Official `dir` alias works on the mutation side too.
    await renameSession('sess-rename', '  Neat title  ', { dir: sessionDir });
    const info = await getSessionInfo('sess-rename', { dir: sessionDir });
    expect(info?.customTitle).toBe('Neat title');
    expect(info?.summary).toBe('Neat title');
  });

  it('getSessionMessages honors the official dir alias + limit/offset', async () => {
    seedSession('sess-msgs');
    const all = await getSessionMessages('sess-msgs', { dir: sessionDir });
    expect(all).toHaveLength(3);
    const page = await getSessionMessages('sess-msgs', {
      dir: sessionDir,
      offset: 1,
      limit: 1,
    });
    expect(page).toHaveLength(1);
    expect(page[0]!.type).toBe('assistant');
  });

  it('listSessions accepts the official includeWorktrees name (no-op)', async () => {
    seedSession('sess-list');
    const infos = await listSessions({ sessionDir, includeWorktrees: true });
    expect(infos.map((s) => s.sessionId)).toContain('sess-list');
  });

  it('query() persists gitBranch into the session meta; listSessions reads it back', async () => {
    execFileSync('git', ['init', '-b', 'b2b-branch'], { cwd, stdio: 'ignore' });
    vi.stubGlobal('fetch', makeSSEFetch([textReplyEvents('ok')]));
    const messages = await collect(
      query({
        prompt: 'hi',
        options: {
          provider: { apiKey: 'test-key' },
          sessionDir,
          cwd,
          env: { PATH: process.env.PATH, HOME: process.env.HOME },
        },
      }),
    );
    expect((messages[messages.length - 1] as SDKResultMessage).subtype).toBe('success');
    const infos = await listSessions({ sessionDir });
    expect(infos).toHaveLength(1);
    expect(infos[0]!.gitBranch).toBe('b2b-branch');
    const info = await getSessionInfo(infos[0]!.sessionId, { dir: sessionDir });
    expect(info?.gitBranch).toBe('b2b-branch');
  });
});
