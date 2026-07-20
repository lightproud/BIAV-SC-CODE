/**
 * Module F (MCP) test suite: sdk-server tool()/createSdkMcpServer/
 * SdkMcpConnection, DefaultMcpRegistry over sdk/stdio/http connections,
 * stdio child lifecycle, env forwarding, and failure/abort paths.
 *
 * Fixtures (plain node scripts, zero deps):
 * - tests/fixtures/mcp-echo-server.mjs  (stdio, newline-delimited JSON-RPC)
 * - tests/fixtures/mcp-http-server.mjs  (streamable HTTP, application/json)
 */

import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createSdkMcpServer, SdkMcpConnection, tool } from '../src/mcp/sdk-server.js';
import { HttpMcpConnection } from '../src/mcp/http.js';
import { parseResourcesList, parseResourceContents, StdioMcpConnection } from '../src/mcp/stdio.js';
import { DefaultMcpRegistry } from '../src/mcp/registry.js';
import type { CallToolResult, ElicitationHandler, SdkMcpToolDefinition } from '../src/types.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ECHO_FIXTURE = path.join(HERE, 'fixtures', 'mcp-echo-server.mjs');
const HTTP_FIXTURE = path.join(HERE, 'fixtures', 'mcp-http-server.mjs');
const ELICIT_FIXTURE = path.join(HERE, 'fixtures', 'mcp-elicit-server.mjs');

/** Fresh non-aborted signal for registry calls. */
function liveSignal(): AbortSignal {
  return new AbortController().signal;
}

/** Concatenated text of all text parts in a CallToolResult. */
function textOf(result: CallToolResult): string {
  return result.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('');
}

/** Invoke a wrapped tool handler with deliberately untyped/raw arguments. */
function callRaw(
  def: SdkMcpToolDefinition<never>,
  args: unknown,
  extra: unknown = {},
): Promise<CallToolResult> {
  return (def.handler as (a: unknown, e: unknown) => Promise<CallToolResult>)(args, extra);
}

/** Poll until the pid no longer exists (process reaped), or time out. */
async function waitForPidExit(pid: number, timeoutMs = 4000): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch {
      return true; // ESRCH: gone.
    }
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
}

// ---------------------------------------------------------------------------
// sdk-server: tool() / createSdkMcpServer / SdkMcpConnection
// ---------------------------------------------------------------------------

describe('mcp/sdk-server tool()', () => {
  it('derives JSON Schema from the zod shape with $schema stripped', () => {
    const def = tool(
      'add',
      'Add two numbers',
      { n: z.number(), tag: z.string().optional() },
      async (args) => ({ content: [{ type: 'text', text: String(args.n) }] }),
    );

    expect(def.name).toBe('add');
    expect(def.description).toBe('Add two numbers');
    expect(def.inputJsonSchema).not.toHaveProperty('$schema');
    expect(def.inputJsonSchema.type).toBe('object');
    expect(def.inputJsonSchema.properties).toMatchObject({
      n: expect.objectContaining({ type: 'number' }),
      tag: expect.objectContaining({ type: 'string' }),
    });
    expect(def.inputJsonSchema.required).toContain('n');
    expect(def.inputJsonSchema.required ?? []).not.toContain('tag');
  });

  it('forwards ToolAnnotations onto the definition (task #17)', () => {
    const withAnn = tool(
      'annotated',
      'read-only tool',
      { q: z.string() },
      async () => ({ content: [] }),
      { readOnlyHint: true, title: 'Reader', idempotentHint: true },
    );
    expect(withAnn.annotations).toEqual({
      readOnlyHint: true,
      title: 'Reader',
      idempotentHint: true,
    });

    const noAnn = tool('plain', 'no annotations', {}, async () => ({ content: [] }));
    expect(noAnn.annotations).toBeUndefined();
  });

  it('accepts the official extras wrapper form { annotations: {...} } (T1-2)', () => {
    const wrapped = tool(
      'wrapped',
      'official extras form',
      { q: z.string() },
      async () => ({ content: [] }),
      { annotations: { readOnlyHint: true, openWorldHint: true } },
    );
    expect(wrapped.annotations).toEqual({ readOnlyHint: true, openWorldHint: true });

    // Wrapper present but annotations omitted: no annotations on the definition.
    const emptyWrapper = tool(
      'empty-wrapper',
      'extras without annotations',
      {},
      async () => ({ content: [] }),
      {},
    );
    expect(emptyWrapper.annotations).toBeUndefined();
  });

  it('still accepts the legacy bare ToolAnnotations form alongside the wrapper (T1-2)', () => {
    const bare = tool(
      'bare',
      'legacy bare form',
      { q: z.string() },
      async () => ({ content: [] }),
      { readOnlyHint: true, title: 'Bare' },
    );
    expect(bare.annotations).toEqual({ readOnlyHint: true, title: 'Bare' });

    // Detection rule: an object carrying an 'annotations' key is always the
    // wrapper. An EMPTY inner object carries no information and normalizes to
    // undefined, symmetric with the bare `{}` form (audit 2026-07-17 L64).
    const wrappedEmpty = tool(
      'wrapped-empty',
      'wrapper with empty annotations',
      {},
      async () => ({ content: [] }),
      { annotations: {} },
    );
    expect(wrappedEmpty.annotations).toBeUndefined();
  });

  it('passes zod-validated args (defaults applied) to the handler', async () => {
    let seen: unknown;
    const def = tool(
      'with-default',
      'records validated args',
      { n: z.number(), s: z.string().default('dflt') },
      async (args) => {
        seen = args;
        return { content: [{ type: 'text', text: 'ok' }] };
      },
    );

    const result = await callRaw(def as SdkMcpToolDefinition<never>, { n: 7 });
    expect(result.isError).not.toBe(true);
    expect(seen).toEqual({ n: 7, s: 'dflt' });
  });

  it('returns an isError text result for wrong-type args without throwing', async () => {
    let handlerRan = false;
    const def = tool('typed', 'strict input', { n: z.number() }, async () => {
      handlerRan = true;
      return { content: [{ type: 'text', text: 'should not happen' }] };
    });

    const result = await callRaw(def as SdkMcpToolDefinition<never>, { n: 'not-a-number' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.type).toBe('text');
    expect(textOf(result)).toContain('typed');
    expect(handlerRan).toBe(false);
  });

  it('converts a throwing handler into an isError result via SdkMcpConnection', async () => {
    const def = tool('kaboom', 'always throws', {}, async () => {
      throw new Error('handler exploded');
    });
    const cfg = createSdkMcpServer({ name: 'boomsrv', tools: [def] });
    const conn = new SdkMcpConnection(cfg.instance);

    const result = await conn.callTool('kaboom', {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('handler exploded');
  });

  it('createSdkMcpServer builds the documented instance shape', () => {
    const a = tool('a', 'tool a', {}, async () => ({ content: [] }));
    const cfg = createSdkMcpServer({ name: 'shapesrv', version: '3.1.4', tools: [a] });

    expect(cfg.type).toBe('sdk');
    expect(cfg.name).toBe('shapesrv');
    expect(cfg.instance.name).toBe('shapesrv');
    expect(cfg.instance.version).toBe('3.1.4');
    expect(cfg.instance.tools).toBeInstanceOf(Map);
    expect(cfg.instance.tools.get('a')).toBe(a);

    const defaulted = createSdkMcpServer({ name: 'nover' });
    expect(defaulted.instance.version).toBe('1.0.0');
    expect(defaulted.instance.tools.size).toBe(0);
  });

  it('callTool preserves a structuredContent payload on the result', async () => {
    const def = tool('struct', 'returns structured data', {}, async () => ({
      content: [{ type: 'text', text: 'see structured' }],
      structuredContent: { ok: true, items: [1, 2, 3] },
    }));
    const cfg = createSdkMcpServer({ name: 'structsrv', tools: [def] });
    const conn = new SdkMcpConnection(cfg.instance);
    const result = await conn.callTool('struct', {});
    expect(result.structuredContent).toEqual({ ok: true, items: [1, 2, 3] });
  });

  it('duplicate tool names follow last-wins Map semantics', async () => {
    const first = tool('dup', 'first', {}, async () => ({
      content: [{ type: 'text', text: 'first' }],
    }));
    const second = tool('dup', 'second', {}, async () => ({
      content: [{ type: 'text', text: 'second' }],
    }));
    const cfg = createSdkMcpServer({ name: 'dupsrv', tools: [first, second] });

    expect(cfg.instance.tools.size).toBe(1);
    expect(cfg.instance.tools.get('dup')).toBe(second);

    const conn = new SdkMcpConnection(cfg.instance);
    expect(textOf(await conn.callTool('dup', {}))).toBe('second');
  });

  it('SdkMcpConnection: unknown tool -> isError, pre-aborted signal -> AbortError', async () => {
    const cfg = createSdkMcpServer({ name: 'lonely', tools: [] });
    const conn = new SdkMcpConnection(cfg.instance);

    const result = await conn.callTool('ghost', {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('ghost');

    const ac = new AbortController();
    ac.abort();
    await expect(conn.callTool('ghost', {}, ac.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});

// ---------------------------------------------------------------------------
// registry + in-process sdk server
// ---------------------------------------------------------------------------

describe('DefaultMcpRegistry with an sdk instance', () => {
  function makeRegistry(): DefaultMcpRegistry {
    const add = tool('add', 'Add two numbers', { a: z.number(), b: z.number() }, async (args) => ({
      content: [{ type: 'text', text: String(args.a + args.b) }],
    }));
    const cfg = createSdkMcpServer({ name: 'calc', version: '1.0.0', tools: [add] });
    return new DefaultMcpRegistry({ servers: { calc: cfg }, debug: () => {} });
  }

  it('connectAll -> connected status with serverInfo; tools qualified', async () => {
    const reg = makeRegistry();
    await reg.connectAll();

    const statuses = reg.statuses();
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({
      name: 'calc',
      status: 'connected',
      serverInfo: { name: 'calc', version: '1.0.0' },
    });
    // task #17: status carries the config it was registered with + per-server
    // tools once connected (official object form since v0.7 T2-7).
    expect(statuses[0]!.config).toBeDefined();
    expect(statuses[0]!.tools?.map((t) => t.name)).toEqual(['add']);

    const tools = reg.allTools();
    expect(tools.map((t) => t.qualifiedName)).toEqual(['mcp__calc__add']);
    expect(tools[0]).toMatchObject({ serverName: 'calc', toolName: 'add' });
    expect(reg.has('mcp__calc__add')).toBe(true);
    expect(reg.has('mcp__calc__nope')).toBe(false);
    await reg.closeAll();
  });

  it('carries a tool readOnlyHint annotation through to McpToolEntry (remnant #1)', async () => {
    const ro = tool(
      'peek',
      'a read-only tool',
      { q: z.string() },
      async () => ({ content: [] }),
      { readOnlyHint: true, title: 'Peek' },
    );
    const rw = tool('poke', 'a writing tool', { q: z.string() }, async () => ({ content: [] }));
    const cfg = createSdkMcpServer({ name: 'srv', tools: [ro, rw] });
    const reg = new DefaultMcpRegistry({ servers: { srv: cfg }, debug: () => {} });
    await reg.connectAll();

    const tools = reg.allTools();
    const peek = tools.find((t) => t.toolName === 'peek');
    const poke = tools.find((t) => t.toolName === 'poke');
    expect(peek!.annotations?.readOnlyHint).toBe(true);
    expect(peek!.annotations?.title).toBe('Peek');
    expect(poke!.annotations).toBeUndefined();
    await reg.closeAll();
  });

  it('call() routes to the handler and returns its result', async () => {
    const reg = makeRegistry();
    await reg.connectAll();
    const result = await reg.call('mcp__calc__add', { a: 2, b: 40 }, liveSignal());
    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toBe('42');
    await reg.closeAll();
  });

  it('call() surfaces zod validation failures as isError results', async () => {
    const reg = makeRegistry();
    await reg.connectAll();
    const result = await reg.call('mcp__calc__add', { a: 'x', b: 2 }, liveSignal());
    expect(result.isError).toBe(true);
    await reg.closeAll();
  });

  it('unknown tool or server name -> isError result, never a throw', async () => {
    const reg = makeRegistry();
    await reg.connectAll();

    const missingTool = await reg.call('mcp__calc__missing', {}, liveSignal());
    expect(missingTool.isError).toBe(true);
    expect(textOf(missingTool)).toContain('mcp__calc__missing');

    const missingServer = await reg.call('mcp__ghost__tool', {}, liveSignal());
    expect(missingServer.isError).toBe(true);
    await reg.closeAll();
  });

  it('setEnabled(false) -> disabled status, tools excluded, call isError; re-enable restores', async () => {
    const reg = makeRegistry();
    await reg.connectAll();

    reg.setEnabled('calc', false);
    expect(reg.statuses()[0]?.status).toBe('disabled');
    expect(reg.allTools()).toEqual([]);
    expect(reg.has('mcp__calc__add')).toBe(false);
    const denied = await reg.call('mcp__calc__add', { a: 1, b: 1 }, liveSignal());
    expect(denied.isError).toBe(true);
    expect(textOf(denied)).toContain('disabled');

    reg.setEnabled('calc', true);
    expect(reg.statuses()[0]?.status).toBe('connected');
    expect(reg.allTools()).toHaveLength(1);
    expect(textOf(await reg.call('mcp__calc__add', { a: 1, b: 1 }, liveSignal()))).toBe('2');
    await reg.closeAll();
  });

  it('closeAll drops connections: no tools, status no longer connected', async () => {
    const reg = makeRegistry();
    await reg.connectAll();
    await reg.closeAll();

    expect(reg.allTools()).toEqual([]);
    expect(reg.statuses()[0]?.status).toBe('pending');
    const after = await reg.call('mcp__calc__add', { a: 1, b: 1 }, liveSignal());
    expect(after.isError).toBe(true);
  });

  it('a pre-aborted signal propagates as AbortError from call()', async () => {
    const reg = makeRegistry();
    await reg.connectAll();
    const ac = new AbortController();
    ac.abort();
    await expect(reg.call('mcp__calc__add', { a: 1, b: 1 }, ac.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    await reg.closeAll();
  });
});

// ---------------------------------------------------------------------------
// registry failure path: unspawnable stdio command
// ---------------------------------------------------------------------------

describe('DefaultMcpRegistry stdio failure', () => {
  it('connectAll resolves with a failed status (never throws); call -> isError', async () => {
    const reg = new DefaultMcpRegistry({
      servers: { broken: { command: 'definitely-not-a-real-cmd-xyz' } },
      debug: () => {},
    });

    await expect(reg.connectAll()).resolves.toBeUndefined();

    const status = reg.statuses()[0];
    expect(status).toBeDefined();
    expect(status?.name).toBe('broken');
    expect(status?.status).toBe('failed');
    expect(typeof status?.error).toBe('string');
    expect(status?.error?.length).toBeGreaterThan(0);
    expect(reg.allTools()).toEqual([]);

    const result = await reg.call('mcp__broken__anything', {}, liveSignal());
    expect(result.isError).toBe(true);
    await reg.closeAll();
  });
});

// ---------------------------------------------------------------------------
// stdio transport via the echo fixture
// ---------------------------------------------------------------------------

describe('StdioMcpConnection via DefaultMcpRegistry (echo fixture)', () => {
  let reg: DefaultMcpRegistry;

  beforeAll(async () => {
    reg = new DefaultMcpRegistry({
      servers: { echo: { command: 'node', args: [ECHO_FIXTURE] } },
      debug: () => {},
    });
    await reg.connectAll();
  });

  afterAll(async () => {
    await reg.closeAll();
  });

  it('connects: status connected with serverInfo from initialize', () => {
    const status = reg.statuses()[0];
    expect(status).toMatchObject({
      name: 'echo',
      status: 'connected',
      serverInfo: { name: 'echo-fixture', version: '9.9.9' },
    });
  });

  it('lists tools across both pagination pages with qualified names', () => {
    const names = reg
      .allTools()
      .map((t) => t.qualifiedName)
      .sort();
    expect(names).toEqual([
      'mcp__echo__boom',
      'mcp__echo__echo',
      'mcp__echo__marker',
      'mcp__echo__pid',
    ]);
    const echoTool = reg.allTools().find((t) => t.toolName === 'echo');
    expect(echoTool?.inputSchema).toMatchObject({ type: 'object' });
    expect(echoTool?.description).toContain('Echo');
  });

  it('tools/call roundtrip: args echoed back as JSON text', async () => {
    const result = await reg.call(
      'mcp__echo__echo',
      { payload: 'hello', deep: { k: [1, 2, 3] } },
      liveSignal(),
    );
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(textOf(result))).toEqual({ payload: 'hello', deep: { k: [1, 2, 3] } });
  });

  it('JSON-RPC error responses become isError results (registry converts)', async () => {
    const result = await reg.call('mcp__echo__boom', {}, liveSignal());
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('boom exploded as designed');
    expect(textOf(result)).toContain('-32000');
  });

  it('a pre-aborted signal propagates as AbortError over stdio', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(reg.call('mcp__echo__echo', {}, ac.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('closeAll terminates the child process', async () => {
    const pidResult = await reg.call('mcp__echo__pid', {}, liveSignal());
    const pid = Number.parseInt(textOf(pidResult), 10);
    expect(Number.isInteger(pid)).toBe(true);
    expect(pid).toBeGreaterThan(0);

    await reg.closeAll();

    expect(await waitForPidExit(pid)).toBe(true);
    expect(reg.statuses()[0]?.status).toBe('pending');
    expect(reg.allTools()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// stdio elicitation reply teardown: the fallback decline write must not leak
// an unhandled rejection when the connection is closing (twin of the HTTP
// "finding 15" guard in tools-v2.test.ts; the terminal .catch was applied to
// http.ts but originally missed on stdio.ts).
// ---------------------------------------------------------------------------

describe('StdioMcpConnection elicitation reply teardown', () => {
  it('does not emit an unhandled rejection when both reply writes fail on a closing connection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);

    let conn: StdioMcpConnection | undefined;
    // Closing the connection while resolving the elicitation makes BOTH the
    // result write AND the fallback decline write throw McpError (not open).
    const handler: ElicitationHandler = async () => {
      await conn?.close();
      return { action: 'accept', content: { name: 'x' } };
    };

    try {
      conn = new StdioMcpConnection(
        { type: 'stdio', command: process.execPath, args: [ELICIT_FIXTURE] },
        { name: 'elicit', elicitation: handler },
      );
      await conn.connect();
      try {
        await conn.callTool('ask', {});
      } catch {
        // callTool rejects once close() fails all pending; not the point.
      }
      // Give the detached decline-write time to throw and surface (if unhandled).
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
      await conn?.close().catch(() => {});
    }
  });
});

// ---------------------------------------------------------------------------
// env forwarding to stdio servers
// ---------------------------------------------------------------------------

describe('stdio env forwarding', () => {
  it('registry-level env reaches the spawned server', async () => {
    const reg = new DefaultMcpRegistry({
      servers: { echo: { command: 'node', args: [ECHO_FIXTURE] } },
      env: { ...process.env, MCP_TEST_MARKER: 'base-marker' },
      debug: () => {},
    });
    try {
      await reg.connectAll();
      expect(reg.statuses()[0]?.status).toBe('connected');
      const result = await reg.call('mcp__echo__marker', {}, liveSignal());
      expect(textOf(result)).toBe('base-marker');
    } finally {
      await reg.closeAll();
    }
  });

  it('config.env overrides the registry base env', async () => {
    const reg = new DefaultMcpRegistry({
      servers: {
        echo: {
          command: 'node',
          args: [ECHO_FIXTURE],
          env: { MCP_TEST_MARKER: 'override-marker' },
        },
      },
      env: { ...process.env, MCP_TEST_MARKER: 'base-marker' },
      debug: () => {},
    });
    try {
      await reg.connectAll();
      const result = await reg.call('mcp__echo__marker', {}, liveSignal());
      expect(textOf(result)).toBe('override-marker');
    } finally {
      await reg.closeAll();
    }
  });
});

// ---------------------------------------------------------------------------
// streamable HTTP transport via the http fixture
// ---------------------------------------------------------------------------

describe('HttpMcpConnection via DefaultMcpRegistry (http fixture)', () => {
  let child: ChildProcess | undefined;
  let reg: DefaultMcpRegistry;

  beforeAll(async () => {
    const started = await new Promise<{ child: ChildProcess; port: number }>(
      (resolve, reject) => {
        const proc = spawn(process.execPath, [HTTP_FIXTURE], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let out = '';
        const timer = setTimeout(() => {
          proc.kill('SIGKILL');
          reject(new Error(`http fixture did not report a port; stdout: ${out}`));
        }, 5000);
        proc.stdout?.setEncoding('utf8');
        proc.stdout?.on('data', (chunk: string) => {
          out += chunk;
          const m = out.match(/PORT:(\d+)/);
          if (m) {
            clearTimeout(timer);
            resolve({ child: proc, port: Number(m[1]) });
          }
        });
        proc.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
        proc.on('exit', (code) => {
          clearTimeout(timer);
          reject(new Error(`http fixture exited early (code=${String(code)})`));
        });
      },
    );
    child = started.child;
    child.removeAllListeners('exit');

    reg = new DefaultMcpRegistry({
      servers: { web: { type: 'http', url: `http://127.0.0.1:${started.port}/mcp` } },
      debug: () => {},
    });
    await reg.connectAll();
  });

  afterAll(async () => {
    await reg?.closeAll();
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  });

  it('connects over application/json JSON-RPC with serverInfo and tools', () => {
    const status = reg.statuses()[0];
    expect(status).toMatchObject({
      name: 'web',
      status: 'connected',
      serverInfo: { name: 'http-fixture', version: '2.0.0' },
    });
    expect(reg.allTools().map((t) => t.qualifiedName)).toEqual(['mcp__web__ping']);
  });

  it('echoes the Mcp-Session-Id assigned on initialize in later requests', async () => {
    const result = await reg.call('mcp__web__ping', { probe: 1 }, liveSignal());
    expect(result.isError).not.toBe(true);
    const seen = JSON.parse(textOf(result)) as {
      sessionId: string | null;
      protocolVersion: string | null;
      args: Record<string, unknown>;
    };
    expect(seen.sessionId).toBe('sess-fixture-123');
    expect(seen.protocolVersion).toBe('2025-06-18');
    expect(seen.args).toEqual({ probe: 1 });
  });

  it("legacy type:'sse' config -> failed status mentioning not implemented", async () => {
    const sseReg = new DefaultMcpRegistry({
      servers: { legacy: { type: 'sse', url: 'http://127.0.0.1:9/never' } },
      debug: () => {},
    });
    await expect(sseReg.connectAll()).resolves.toBeUndefined();
    const status = sseReg.statuses()[0];
    expect(status?.status).toBe('failed');
    expect(status?.error?.toLowerCase()).toContain('not implemented');
    const result = await sseReg.call('mcp__legacy__anything', {}, liveSignal());
    expect(result.isError).toBe(true);
    await sseReg.closeAll();
  });
});

// ---------------------------------------------------------------------------
// Regression: sdk-server tool() input-side JSON Schema (findings #17, #20)
// ---------------------------------------------------------------------------

describe('mcp/sdk-server tool() input-side schema (regression #17/#20)', () => {
  it('#20: a .default() field is NOT emitted in the schema required array', () => {
    const def = tool(
      'search',
      'search with a defaulted limit',
      { q: z.string(), limit: z.number().default(10) },
      async (args) => ({ content: [{ type: 'text', text: String(args.limit) }] }),
    );
    const required = (def.inputJsonSchema.required ?? []) as string[];
    expect(required).toContain('q');
    // Before the io:'input' fix, output-side conversion listed 'limit' as
    // required, contradicting the handler which applies the default.
    expect(required).not.toContain('limit');
    // The default annotation still survives in properties.
    expect(def.inputJsonSchema.properties).toMatchObject({
      limit: expect.objectContaining({ default: 10 }),
    });
  });

  it('#17: a .transform() input field does not throw at tool-definition time', () => {
    // Output-side conversion throws "Transforms cannot be represented in JSON
    // Schema"; input-side emits the pre-transform type instead.
    let def: ReturnType<typeof tool> | undefined;
    expect(() => {
      def = tool(
        'parse_when',
        'parse a date string',
        { when: z.string().transform((s) => new Date(s)) },
        async () => ({ content: [{ type: 'text', text: 'ok' }] }),
      );
    }).not.toThrow();
    expect(def?.inputJsonSchema.properties).toMatchObject({
      when: expect.objectContaining({ type: 'string' }),
    });
  });

  it('#17: a z.date() input field does not throw and the handler still validates', async () => {
    let def: ReturnType<typeof tool> | undefined;
    expect(() => {
      def = tool(
        'at',
        'takes a date',
        { at: z.date() },
        async () => ({ content: [{ type: 'text', text: 'ok' }] }),
      );
    }).not.toThrow();
    // Handler-side zod validation is unaffected: a non-date is rejected.
    const result = await callRaw(def as unknown as SdkMcpToolDefinition<never>, { at: 'nope' });
    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Regression: HttpMcpConnection header casing + server-initiated requests
// (findings #18, #19). Uses an inline node:http server per test.
// ---------------------------------------------------------------------------

/** Start an inline http server; returns its base URL and a stop() fn. */
async function startServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void,
): Promise<{ url: string; stop: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => handler(req, res, body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

describe('HttpMcpConnection header casing (regression #18)', () => {
  it('a case-variant config Content-Type replaces the default, no comma-joined dup', async () => {
    const seenContentTypes: string[] = [];
    const srv = await startServer((req, res, body) => {
      seenContentTypes.push(String(req.headers['content-type'] ?? ''));
      const { id } = JSON.parse(body) as { id: number | string | null };
      if (id === undefined || id === null) {
        res.writeHead(202);
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            serverInfo: { name: 'hdr', version: '1.0.0' },
          },
        }),
      );
    });
    try {
      const conn = new HttpMcpConnection({
        type: 'http',
        url: srv.url,
        // Natural casing differing only in case from the hardcoded lowercase
        // 'content-type'; must REPLACE it, not produce a duplicate.
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
      await conn.connect();
      await conn.close();
    } finally {
      await srv.stop();
    }

    expect(seenContentTypes.length).toBeGreaterThan(0);
    for (const ct of seenContentTypes) {
      // User override wins; exactly one value, never the malformed merge.
      expect(ct).toBe('application/json; charset=utf-8');
      expect(ct).not.toContain(',');
    }
  });
});

describe('HttpMcpConnection server-initiated request over SSE (regression #19)', () => {
  it('answers a server request on the SSE stream with JSON-RPC -32601', async () => {
    const replies: Array<{ id: unknown; error?: { code?: number } }> = [];
    const srv = await startServer((req, res, body) => {
      const msg = JSON.parse(body) as {
        id: number | string | null;
        method?: string;
        error?: { code?: number };
      };
      const { id, method } = msg;

      // The client's fire-and-forget reply to the server request: no method,
      // carries the server's id + an error object. Record and ack it.
      if (method === undefined && msg.error) {
        replies.push({ id, error: msg.error });
        res.writeHead(202);
        res.end();
        return;
      }
      if (id === undefined || id === null) {
        res.writeHead(202);
        res.end();
        return;
      }
      if (method === 'initialize') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2025-06-18',
              capabilities: {},
              serverInfo: { name: 'sse', version: '1.0.0' },
            },
          }),
        );
        return;
      }
      if (method === 'tools/call') {
        // SSE stream: first a server-initiated request (method + id), then the
        // actual tools/call response. The client must answer the former.
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(
          `data: ${JSON.stringify({ jsonrpc: '2.0', id: 'srv-ping-1', method: 'ping' })}\n\n`,
        );
        res.write(
          `data: ${JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text: 'pong' }] },
          })}\n\n`,
        );
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: 'nope' } }));
    });

    try {
      const conn = new HttpMcpConnection({ type: 'http', url: srv.url });
      await conn.connect();
      const result = await conn.callTool('anything', {});
      expect(textOf(result)).toBe('pong');

      // Give the fire-and-forget reply POST a moment to land.
      for (let i = 0; i < 40 && replies.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 25));
      }
      await conn.close();

      expect(replies.length).toBeGreaterThan(0);
      expect(replies[0]?.id).toBe('srv-ping-1');
      expect(replies[0]?.error?.code).toBe(-32601);
    } finally {
      await srv.stop();
    }
  });
});

describe('MCP resources wire parsing + registry aggregation', () => {
  it('parseResourcesList picks well-formed resource descriptors', () => {
    const parsed = parseResourcesList({
      resources: [
        { uri: 'file:///a', name: 'A', description: 'd', mimeType: 'text/plain' },
        { uri: 'file:///b' },
        { name: 'no-uri' }, // dropped: no uri
        'garbage', // dropped
      ],
    });
    expect(parsed).toEqual([
      { uri: 'file:///a', name: 'A', description: 'd', mimeType: 'text/plain' },
      { uri: 'file:///b' },
    ]);
    expect(parseResourcesList(null)).toEqual([]);
    expect(parseResourcesList({})).toEqual([]);
  });

  it('parseResourceContents keeps text and blob variants', () => {
    const parsed = parseResourceContents({
      contents: [
        { uri: 'file:///a', mimeType: 'text/plain', text: 'hi' },
        { uri: 'file:///b', blob: 'YmFzZTY0' },
        { mimeType: 'x' }, // dropped: no uri
      ],
    });
    expect(parsed).toEqual([
      { uri: 'file:///a', mimeType: 'text/plain', text: 'hi' },
      { uri: 'file:///b', blob: 'YmFzZTY0' },
    ]);
  });

  it('registry.listResources returns [] for an sdk server (tools-only)', async () => {
    const t = tool('add', 'add', { a: z.number() }, async () => ({ content: [] }));
    const cfg = createSdkMcpServer({ name: 'calc', tools: [t] });
    const reg = new DefaultMcpRegistry({ servers: { calc: cfg }, debug: () => {} });
    await reg.connectAll();
    const list = await reg.listResources(undefined, new AbortController().signal);
    expect(list).toEqual([]);
    await reg.closeAll();
  });
});
