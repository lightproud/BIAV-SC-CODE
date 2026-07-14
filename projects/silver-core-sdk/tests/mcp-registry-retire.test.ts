/**
 * audit 2026-07-14 M-4: MCP registry retired-entry sweep.
 *
 * Before: closeAll()/setServers() only closed entries whose connection was
 * ALREADY published. An entry still handshaking (entry.connection null,
 * entry.connecting in flight — up to 60s) was skipped; when the handshake
 * later resolved it published a live connection onto the abandoned entry and
 * nothing ever closed it again — the stdio child process leaked forever.
 * After: closeAll retires every entry first, awaits in-flight handshakes and
 * sweeps what they produced; connectEntryInner checks the retired flag after
 * the handshake and closes the fresh connection instead of publishing it.
 *
 * Harness: buildConnection is stubbed per-instance (the configs are inert),
 * so connect timing is fully scripted and no child process is ever spawned.
 */

import { describe, expect, it } from 'vitest';

import { DefaultMcpRegistry } from '../src/mcp/registry.js';
import type { McpServerConfig } from '../src/types.js';

type FakeConn = {
  connect: (signal?: AbortSignal) => Promise<void>;
  serverInfo: () => { name: string; version: string } | undefined;
  listTools: (signal?: AbortSignal) => Promise<Array<{ name: string; inputSchema: object }>>;
  callTool: () => Promise<{ content: never[] }>;
  listResources: () => Promise<never[]>;
  readResource: () => Promise<never[]>;
  close: () => Promise<void>;
  closed: boolean;
};

/** A fake connection whose connect() blocks until release() is called. */
function makeGatedConn(name: string): { conn: FakeConn; release: () => void } {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const conn: FakeConn = {
    closed: false,
    connect: async () => {
      await gate;
    },
    serverInfo: () => ({ name, version: '1.0.0' }),
    listTools: async () => [{ name: 'tick', inputSchema: { type: 'object' } }],
    callTool: async () => ({ content: [] }),
    listResources: async () => [],
    readResource: async () => [],
    close: async () => {
      conn.closed = true;
    },
  };
  return { conn, release };
}

/** A fake connection that connects immediately. */
function makeInstantConn(name: string): FakeConn {
  const { conn, release } = makeGatedConn(name);
  release();
  return conn;
}

/** Registry over inert configs, with buildConnection stubbed to the fakes. */
function stubRegistry(fakes: Record<string, FakeConn>): DefaultMcpRegistry {
  const servers = Object.fromEntries(
    Object.keys(fakes).map((n) => [n, { command: 'noop' } as McpServerConfig]),
  );
  const reg = new DefaultMcpRegistry({ servers, debug: () => {} });
  restub(reg, fakes);
  return reg;
}

/** Point (or re-point, for setServers) buildConnection at a fake set. */
function restub(reg: DefaultMcpRegistry, fakes: Record<string, FakeConn>): void {
  (reg as unknown as { buildConnection: (name: string) => FakeConn }).buildConnection = (
    name: string,
  ) => {
    const fake = fakes[name];
    if (fake === undefined) throw new Error(`no fake connection scripted for '${name}'`);
    return fake;
  };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('DefaultMcpRegistry retired-entry sweep (audit 2026-07-14 M-4)', () => {
  it('a connect resolving AFTER closeAll() gets its fresh connection closed (no zombie)', async () => {
    const { conn, release } = makeGatedConn('slow');
    const reg = stubRegistry({ slow: conn });

    const connecting = reg.connectAll(); // handshake parked on the gate
    await tick();
    expect(conn.closed).toBe(false);

    const closing = reg.closeAll(); // entry.connection is still null here
    release(); // handshake resolves only now
    await Promise.all([connecting, closing]);

    // The late handshake must NOT have published a live connection.
    expect(conn.closed).toBe(true);
    expect(reg.statuses()[0]!.status).not.toBe('connected');
    expect(reg.allTools()).toEqual([]);
  });

  it('setServers() during connectAll() closes the old in-flight connection and connects the new set', async () => {
    const { conn: oldConn, release } = makeGatedConn('old');
    const reg = stubRegistry({ old: oldConn });

    const connecting = reg.connectAll();
    await tick();

    restub(reg, { fresh: makeInstantConn('fresh') });
    const swapping = reg.setServers({ fresh: { command: 'noop' } as McpServerConfig });
    release(); // the old handshake resolves while the swap is in progress
    await Promise.all([connecting, swapping]);

    expect(oldConn.closed).toBe(true); // no zombie from the replaced set
    const statuses = reg.statuses();
    expect(statuses.map((s) => s.name)).toEqual(['fresh']);
    expect(statuses[0]!.status).toBe('connected');
    expect(reg.allTools().map((t) => t.qualifiedName)).toEqual(['mcp__fresh__tick']);
  });

  it('normal connect -> use -> closeAll stays unchanged', async () => {
    const conn = makeInstantConn('srv');
    const reg = stubRegistry({ srv: conn });

    await reg.connectAll();
    expect(reg.statuses()[0]!.status).toBe('connected');
    expect(reg.has('mcp__srv__tick')).toBe(true);

    await reg.closeAll();
    expect(conn.closed).toBe(true);
    expect(reg.statuses()[0]!.status).toBe('pending');
    expect(reg.allTools()).toEqual([]);
  });

  it('connectAll() after closeAll() does not resurrect a retired entry', async () => {
    const conn = makeInstantConn('srv');
    const reg = stubRegistry({ srv: conn });
    await reg.connectAll();
    await reg.closeAll();
    conn.closed = false; // would flip back if a new connect published

    await reg.connectAll(); // retired entries must not start a new connect
    expect(reg.statuses()[0]!.status).not.toBe('connected');
    expect(reg.allTools()).toEqual([]);
  });
});
