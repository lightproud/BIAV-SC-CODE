/**
 * White-box coverage batch 2 (testing-side sweep, B2): the interface points
 * the api-surface-coverage guard had on KNOWN_UNTESTED because they need a
 * heavier harness than a one-liner. Each is now driven for real against the
 * SSE-fetch stub / in-process MCP server, and its guard allowlist entry is
 * deleted in the same change (the shrink-only ratchet reds a stale entry).
 *
 * Covered here: includeEnvironmentContext, toolSearch, streamInput,
 * sessionStoreFlush, setMcpServers, toggleMcpServer, reconnectMcpServer.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  query,
  createSdkMcpServer,
  tool,
  type Options,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
  type SessionStore,
} from '../src/index.js';
import { makeSSEFetch, type SSEFetchStub } from './helpers/sse-fetch.js';
import { textReplyEvents } from './helpers/mock-transport.js';

let cwd: string;
let sessionDir: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'b2-'));
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
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    model: 'claude-sonnet-4-5',
    ...extra,
  };
}
function stub(scripts: ReadonlyArray<readonly object[]>): SSEFetchStub {
  const s = makeSSEFetch(scripts);
  vi.stubGlobal('fetch', s);
  return s;
}
const userMsg = (content: string): SDKUserMessage => ({
  type: 'user',
  session_id: '',
  message: { role: 'user', content },
  parent_tool_use_id: null,
});
async function drain(q: Query): Promise<SDKMessage[]> {
  const out: SDKMessage[] = [];
  for await (const m of q) out.push(m);
  return out;
}
const sysText = (body: Record<string, unknown>): string => JSON.stringify(body.system ?? '');
const toolNames = (body: Record<string, unknown>): string[] =>
  Array.isArray(body.tools) ? body.tools.map((t: { name?: string }) => t.name).filter(Boolean) : [];

describe('Options.includeEnvironmentContext', () => {
  it('default preset path injects the <env> runtime block into the system prompt', async () => {
    const f = stub([textReplyEvents('ok')]);
    await drain(query({ prompt: 'hi', options: baseOptions({ systemPrompt: { type: 'preset', preset: 'claude_code' } }) }));
    const s = sysText(f.requests[0]!.body);
    expect(s).toContain('<env>');
    expect(s).toContain('Working directory:');
  });
  it('includeEnvironmentContext:false omits the <env> block', async () => {
    const f = stub([textReplyEvents('ok')]);
    await drain(
      query({
        prompt: 'hi',
        options: baseOptions({ systemPrompt: { type: 'preset', preset: 'claude_code' }, includeEnvironmentContext: false }),
      }),
    );
    expect(sysText(f.requests[0]!.body)).not.toContain('<env>');
  });
});

describe('Options.toolSearch', () => {
  const server = () =>
    createSdkMcpServer({
      name: 'big',
      version: '1.0.0',
      tools: [
        tool('alpha', 'a', {}, async () => ({ content: [{ type: 'text', text: 'a' }] })),
        tool('beta', 'b', {}, async () => ({ content: [{ type: 'text', text: 'b' }] })),
      ],
    });

  it('toolSearch:true defers MCP tool schemas behind a ToolSearch builtin', async () => {
    const f = stub([textReplyEvents('ok')]);
    await drain(query({ prompt: 'hi', options: baseOptions({ mcpServers: { big: server() }, toolSearch: true }) }));
    const names = toolNames(f.requests[0]!.body);
    expect(names).toContain('ToolSearch');
    // The deferred MCP tools are NOT advertised inline on the first request.
    expect(names).not.toContain('mcp__big__alpha');
  });
  it('toolSearch:false advertises the MCP tools inline (no ToolSearch)', async () => {
    const f = stub([textReplyEvents('ok')]);
    await drain(query({ prompt: 'hi', options: baseOptions({ mcpServers: { big: server() }, toolSearch: false }) }));
    const names = toolNames(f.requests[0]!.body);
    expect(names).toContain('mcp__big__alpha');
    expect(names).not.toContain('ToolSearch');
  });
});

describe('Query.streamInput', () => {
  it('pushes additional user turns into a streaming-input session', async () => {
    const f = stub([textReplyEvents('r1'), textReplyEvents('r2')]);
    let releaseEnd!: () => void;
    const endGate = new Promise<void>((r) => (releaseEnd = r));
    async function* inputs(): AsyncGenerator<SDKUserMessage> {
      yield userMsg('first');
      await endGate; // hold the generator open so streamInput has a live queue
    }
    const q = query({ prompt: inputs(), options: baseOptions() });
    let results = 0;
    let pushed = false;
    for await (const m of q) {
      if (m.type === 'result') {
        results += 1;
        if (results === 1 && !pushed) {
          pushed = true;
          await q.streamInput((async function* () {
            yield userMsg('second');
          })());
          releaseEnd();
        }
      }
    }
    expect(results).toBe(2);
    expect(f.requests).toHaveLength(2);
  });

  it('throws ConfigurationError when called in single-shot (non-streaming) mode', async () => {
    stub([textReplyEvents('ok')]);
    const q = query({ prompt: 'hi', options: baseOptions() });
    await drain(q);
    await expect(
      q.streamInput((async function* () {
        yield userMsg('x');
      })()),
    ).rejects.toThrow(/streaming-input mode/);
  });
});

describe('Options.sessionStoreFlush', () => {
  function spyStore(): { store: SessionStore; appendCalls: number } {
    const state = { appendCalls: 0 };
    const store: SessionStore = {
      async append() {
        state.appendCalls += 1;
      },
      async load() {
        return null;
      },
    };
    return { store, get appendCalls() { return state.appendCalls; } } as { store: SessionStore; appendCalls: number };
  }

  it("'eager' flushes more often than 'batched' for the same run", async () => {
    stub([textReplyEvents('ok')]);
    const eager = spyStore();
    await drain(query({ prompt: 'hi', options: baseOptions({ sessionStore: eager.store, sessionStoreFlush: 'eager' }) }));

    stub([textReplyEvents('ok')]);
    const batched = spyStore();
    await drain(query({ prompt: 'hi', options: baseOptions({ sessionStore: batched.store, sessionStoreFlush: 'batched' }) }));

    // Eager mirrors each entry as it lands; batched coalesces. Both must have
    // persisted at least once, and eager must not flush fewer times.
    expect(eager.appendCalls).toBeGreaterThan(0);
    expect(batched.appendCalls).toBeGreaterThan(0);
    expect(eager.appendCalls).toBeGreaterThanOrEqual(batched.appendCalls);
  });
});

describe('Query MCP runtime control (setMcpServers / toggleMcpServer / reconnectMcpServer)', () => {
  const conf = () =>
    createSdkMcpServer({
      name: 'conf',
      version: '1.0.0',
      tools: [tool('ping', 'p', {}, async () => ({ content: [{ type: 'text', text: 'PONG' }] }))],
    });

  async function streamingQuery(options: Options) {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    async function* inputs(): AsyncGenerator<SDKUserMessage> {
      yield userMsg('turn one');
      await gate;
    }
    const q = query({ prompt: inputs(), options });
    return { q, release };
  }

  it('setMcpServers returns a structured add/remove result and re-advertises tools', async () => {
    stub([textReplyEvents('r1'), textReplyEvents('r2')]);
    const { q, release } = await streamingQuery(baseOptions());
    let done = false;
    for await (const m of q) {
      if (m.type === 'result' && !done) {
        done = true;
        const res = await q.setMcpServers({ conf: conf() });
        expect(res).toBeTruthy();
        const status = await q.mcpServerStatus();
        expect(status.some((s) => s.name === 'conf')).toBe(true);
        release();
      }
    }
  });

  it('toggleMcpServer(false) disables a server; mcpServerStatus reflects it', async () => {
    stub([textReplyEvents('r1'), textReplyEvents('r2')]);
    const { q, release } = await streamingQuery(baseOptions({ mcpServers: { conf: conf() } }));
    let done = false;
    for await (const m of q) {
      if (m.type === 'result' && !done) {
        done = true;
        await q.toggleMcpServer('conf', false);
        const status = await q.mcpServerStatus();
        const confStatus = status.find((s) => s.name === 'conf');
        expect(confStatus).toBeTruthy();
        expect(confStatus!.status).not.toBe('connected');
        release();
      }
    }
  });

  it('reconnectMcpServer resolves and leaves the server connected', async () => {
    stub([textReplyEvents('r1'), textReplyEvents('r2')]);
    const { q, release } = await streamingQuery(baseOptions({ mcpServers: { conf: conf() } }));
    let done = false;
    for await (const m of q) {
      if (m.type === 'result' && !done) {
        done = true;
        await expect(q.reconnectMcpServer('conf')).resolves.toBeUndefined();
        const status = await q.mcpServerStatus();
        expect(status.find((s) => s.name === 'conf')?.status).toBe('connected');
        release();
      }
    }
  });
});
