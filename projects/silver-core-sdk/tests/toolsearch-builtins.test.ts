/**
 * Unified tool-search: deferring COLD BUILT-IN schemas (not just MCP tools)
 * behind the ONE ToolSearch builtin, plus the 银芯/SVN-world variant.
 *
 * The pre-unification behavior deferred MCP tools only; built-in schemas were
 * always advertised inline (the ~16k resident cost this reclaims). These tests
 * pin the new, previously un-pinned invariants:
 *  - a cold built-in's schema is withheld from the request while deferred, and
 *    resurfaces the turn after a ToolSearch load (lazy load, one namespace);
 *  - the drop-in default (toolSearch undefined) is byte-unchanged: no built-in
 *    is deferred, no ToolSearch appears;
 *  - the variant DISABLES EnterWorktree (removed, not merely deferred) while the
 *    faithful createBuiltinTools() factory stays untouched.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  query,
  silverCoreToolOptions,
  DEFAULT_DEFERRED_BUILTINS,
  type Options,
  type Query,
  type SDKMessage,
} from '../src/index.js';
import {
  DeferredMcpRegistry,
  makeToolSearchTool,
  type DeferredBuiltinEntry,
} from '../src/tools/toolsearch.js';
import type { McpRegistry, McpToolEntry, ToolContext } from '../src/internal/contracts.js';
import { makeSSEFetch, type SSEFetchStub } from './helpers/sse-fetch.js';
import { textReplyEvents, toolUseReplyEvents } from './helpers/mock-transport.js';

// ---------------------------------------------------------------------------
// Unit: the cold-built-in surface of DeferredMcpRegistry (the unification seam)
// ---------------------------------------------------------------------------

function coldEntry(name: string): DeferredBuiltinEntry {
  return { name, description: `${name} does ${name}`, inputSchema: { type: 'object', properties: {} } };
}
function mcpEntry(server: string, name: string): McpToolEntry {
  return {
    qualifiedName: `mcp__${server}__${name}`,
    serverName: server,
    toolName: name,
    description: `${name} does ${name}`,
    inputSchema: { type: 'object', properties: { x: { type: 'string' } } },
  };
}
function fakeRegistry(tools: McpToolEntry[]): McpRegistry {
  const set = new Set(tools.map((t) => t.qualifiedName));
  return {
    async connectAll() {},
    statuses: () => [],
    allTools: () => tools,
    has: (q) => set.has(q),
    async call() {
      return { content: [{ type: 'text', text: 'ok' }] };
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
      return { servers: [] };
    },
    async closeAll() {},
  };
}
const fakeCtx = {} as ToolContext;

describe('DeferredMcpRegistry — cold built-ins', () => {
  it('withholds a cold built-in only while active AND unloaded', () => {
    const reg = new DeferredMcpRegistry(fakeRegistry([]));
    reg.attachColdBuiltins([coldEntry('Workflow'), coldEntry('Monitor')]);
    // Inactive: nothing is deferred (the exact pre-unification behavior).
    expect(reg.isBuiltinDeferred('Workflow')).toBe(false);
    reg.activateIfNeeded(true);
    expect(reg.isActive()).toBe(true);
    // Active + cold + unloaded -> withheld.
    expect(reg.isBuiltinDeferred('Workflow')).toBe(true);
    expect(reg.isBuiltinDeferred('Monitor')).toBe(true);
    // A HOT built-in (never attached) is never deferred.
    expect(reg.isBuiltinDeferred('Read')).toBe(false);
    // Loading it (via ToolSearch) surfaces it from the next turn on.
    reg.markLoaded(['Workflow']);
    expect(reg.isBuiltinDeferred('Workflow')).toBe(false);
    expect(reg.isBuiltinDeferred('Monitor')).toBe(true);
  });

  it('exposes cold built-ins in the searchable catalog even with zero MCP tools', () => {
    const reg = new DeferredMcpRegistry(fakeRegistry([]));
    expect(reg.hasDeferrableTools()).toBe(false);
    reg.attachColdBuiltins([coldEntry('Workflow')]);
    expect(reg.hasDeferrableTools()).toBe(true);
    expect(reg.coldBuiltinCatalog().map((e) => e.name)).toEqual(['Workflow']);
  });

  it('ToolSearch loads a cold built-in and an MCP tool through ONE shared path', async () => {
    const reg = new DeferredMcpRegistry(fakeRegistry([mcpEntry('gh', 'issue')]), {});
    reg.attachColdBuiltins([coldEntry('Workflow')]);
    reg.activateIfNeeded(true);
    const ts = makeToolSearchTool(reg);

    // Exact-name load of a built-in.
    const r1 = await ts.execute({ names: ['Workflow'] }, fakeCtx);
    expect(r1.content as string).toContain('Workflow');
    expect(r1.content as string).toContain('input_schema');
    expect(reg.isBuiltinDeferred('Workflow')).toBe(false);

    // Substring query spanning both kinds (the shared `loaded` namespace).
    const r2 = await ts.execute({ query: 'issue' }, fakeCtx);
    expect(r2.content as string).toContain('mcp__gh__issue');
    expect(reg.allTools().map((t) => t.qualifiedName)).toContain('mcp__gh__issue');

    // No match still guides.
    const r3 = await ts.execute({ query: 'nonexistent-zzz' }, fakeCtx);
    expect(r3.content as string).toContain('No tools matched');
  });
});

// ---------------------------------------------------------------------------
// e2e: request-shape contract through query()
// ---------------------------------------------------------------------------

let cwd: string;
let sessionDir: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'tsb-'));
  sessionDir = join(cwd, '.sessions');
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(cwd, { recursive: true, force: true });
});

function baseOptions(extra: Partial<Options> = {}): Options {
  return {
    provider: { apiKey: 'test-key', promptCaching: false },
    sessionDir,
    cwd,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, BPT_HTTP_CLIENT: 'fetch' },
    model: 'claude-sonnet-4-5',
    ...extra,
  };
}
function stub(scripts: ReadonlyArray<readonly object[]>): SSEFetchStub {
  const s = makeSSEFetch(scripts);
  vi.stubGlobal('fetch', s);
  return s;
}
async function drain(q: Query): Promise<SDKMessage[]> {
  const out: SDKMessage[] = [];
  for await (const m of q) out.push(m);
  return out;
}
const toolNames = (body: Record<string, unknown>): string[] =>
  Array.isArray(body.tools) ? body.tools.map((t: { name?: string }) => t.name).filter(Boolean) : [];

const HOT = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'] as const;

describe('query() — unified built-in deferral', () => {
  it('toolSearch:true defers the cold built-in schemas even with zero MCP servers', async () => {
    const f = stub([textReplyEvents('ok')]);
    await drain(query({ prompt: 'hi', options: baseOptions({ toolSearch: true }) }));
    const names = toolNames(f.requests[0]!.body);
    // ToolSearch is the loader — always inline.
    expect(names).toContain('ToolSearch');
    // The reflexively-used core stays hot.
    expect(names).toEqual(expect.arrayContaining([...HOT]));
    // The cold set is withheld from the first request.
    for (const cold of ['Workflow', 'Monitor', 'WebFetch', 'WebSearch', 'ExitPlanMode', 'TaskCreate']) {
      expect(names).not.toContain(cold);
    }
  });

  it('the default path (toolSearch undefined) is byte-unchanged: no deferral, no ToolSearch', async () => {
    const f = stub([textReplyEvents('ok')]);
    await drain(query({ prompt: 'hi', options: baseOptions() }));
    const names = toolNames(f.requests[0]!.body);
    expect(names).not.toContain('ToolSearch');
    // Every built-in is advertised inline, exactly as before.
    expect(names).toContain('Workflow');
    expect(names).toContain('Monitor');
    expect(names).toContain('WebFetch');
  });

  it('cuts the advertised tool count vs the inline default', async () => {
    const fDefault = stub([textReplyEvents('ok')]);
    await drain(query({ prompt: 'hi', options: baseOptions() }));
    const defaultCount = toolNames(fDefault.requests[0]!.body).length;

    const fLean = stub([textReplyEvents('ok')]);
    await drain(query({ prompt: 'hi', options: baseOptions({ toolSearch: true }) }));
    const leanCount = toolNames(fLean.requests[0]!.body).length;

    // Most of the built-in set is cold, so the request shrinks substantially.
    expect(leanCount).toBeLessThan(defaultCount);
    expect(defaultCount - leanCount).toBeGreaterThanOrEqual(10);
  });

  it('a ToolSearch load surfaces the built-in schema on the NEXT request', async () => {
    const f = stub([
      toolUseReplyEvents('ToolSearch', { names: ['Workflow'] }, { id: 'tu1' }),
      textReplyEvents('done'),
    ]);
    await drain(query({ prompt: 'hi', options: baseOptions({ toolSearch: true }) }));
    // Turn 1: Workflow withheld.
    expect(toolNames(f.requests[0]!.body)).not.toContain('Workflow');
    // Turn 2 (after the ToolSearch load): Workflow's schema is now advertised.
    expect(toolNames(f.requests[1]!.body)).toContain('Workflow');
  });
});

describe('silverCoreToolOptions — the SVN-world variant', () => {
  it('returns the opt-in bundle (worktree disabled by default)', () => {
    expect(silverCoreToolOptions()).toEqual({
      toolSearch: true,
      disallowedTools: ['EnterWorktree'],
    });
    expect(silverCoreToolOptions({ disableWorktree: false })).toEqual({ toolSearch: true });
  });

  it('DISABLES EnterWorktree (removed, not loadable) while Workflow stays DEFERRED (loadable)', async () => {
    const f = stub([
      toolUseReplyEvents('ToolSearch', { names: ['EnterWorktree', 'Workflow'] }, { id: 'tu1' }),
      textReplyEvents('done'),
    ]);
    await drain(query({ prompt: 'hi', options: baseOptions({ ...silverCoreToolOptions() }) }));

    const names0 = toolNames(f.requests[0]!.body);
    expect(names0).toContain('ToolSearch');
    expect(names0).not.toContain('EnterWorktree'); // removed
    expect(names0).not.toContain('Workflow'); // deferred

    // ToolSearch can load the DEFERRED tool but not the REMOVED one.
    const names1 = toolNames(f.requests[1]!.body);
    expect(names1).toContain('Workflow');
    expect(names1).not.toContain('EnterWorktree');
  });
});

describe('DEFAULT_DEFERRED_BUILTINS', () => {
  it('leads with the largest schema and keeps the reflexive core hot', () => {
    expect(DEFAULT_DEFERRED_BUILTINS[0]).toBe('Workflow');
    for (const hot of [...HOT, 'Agent', 'AskUserQuestion', 'ToolSearch']) {
      expect(DEFAULT_DEFERRED_BUILTINS).not.toContain(hot);
    }
  });
});
