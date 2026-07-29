/**
 * BPT finding D (2026-07-29): setServers() was a full rebuild, not a diff.
 *
 * Before: every call ran closeAll() -> replace the entry array -> connectAll(),
 * so appending ONE server disconnected and re-handshook every other server,
 * in-process 'sdk' ones included. A skill load mid-conversation made the whole
 * tool surface flicker.
 * After: a server whose name AND config are unchanged keeps its live entry
 * (connection, tools, serverInfo, enabled flag); only what the new set really
 * drops is closed, only what it really adds connects.
 *
 * Harness: buildConnection is stubbed per-instance (the configs are inert), so
 * no child process is ever spawned and every handshake is counted.
 */

import { describe, expect, it } from 'vitest';

import { DefaultMcpRegistry } from '../src/mcp/registry.js';
import type { McpServerConfig, SdkMcpServerInstance } from '../src/types.js';

type FakeConn = {
  name: string;
  closed: boolean;
  connect: () => Promise<void>;
  serverInfo: () => { name: string; version: string };
  listTools: () => Promise<Array<{ name: string; inputSchema: object }>>;
  callTool: () => Promise<{ content: never[] }>;
  listResources: () => Promise<never[]>;
  readResource: () => Promise<never[]>;
  readResourceDir: () => Promise<never[]>;
  close: () => Promise<void>;
};

function makeConn(name: string): FakeConn {
  const conn: FakeConn = {
    name,
    closed: false,
    connect: async () => {},
    serverInfo: () => ({ name, version: '1.0.0' }),
    listTools: async () => [{ name: 'tick', inputSchema: { type: 'object' } }],
    callTool: async () => ({ content: [] }),
    listResources: async () => [],
    readResource: async () => [],
    readResourceDir: async () => [],
    close: async () => {
      conn.closed = true;
    },
  };
  return conn;
}

/** Registry over inert configs; every handshake is recorded in `built`. */
function harness(servers: Record<string, McpServerConfig>): {
  reg: DefaultMcpRegistry;
  built: FakeConn[];
  connsFor: (name: string) => FakeConn[];
} {
  const built: FakeConn[] = [];
  const reg = new DefaultMcpRegistry({ servers, debug: () => {} });
  (reg as unknown as { buildConnection: (name: string) => FakeConn }).buildConnection = (
    name: string,
  ) => {
    const conn = makeConn(name);
    built.push(conn);
    return conn;
  };
  return { reg, built, connsFor: (name) => built.filter((c) => c.name === name) };
}

const stdio = (command: string): McpServerConfig => ({ command }) as McpServerConfig;

describe('DefaultMcpRegistry.setServers() incremental diff (BPT finding D)', () => {
  it('keeps an unchanged server connected while a new one is added', async () => {
    const { reg, built, connsFor } = harness({ keep: stdio('noop'), drop: stdio('noop') });
    await reg.connectAll();
    expect(built).toHaveLength(2);
    const keepConn = connsFor('keep')[0]!;
    const dropConn = connsFor('drop')[0]!;

    await reg.setServers({ keep: stdio('noop'), fresh: stdio('noop') });

    // The untouched server was never bounced: no second handshake, no close.
    expect(connsFor('keep')).toHaveLength(1);
    expect(keepConn.closed).toBe(false);
    // Only the genuinely removed one was closed, only the new one connected.
    expect(dropConn.closed).toBe(true);
    expect(connsFor('fresh')).toHaveLength(1);
    expect(built).toHaveLength(3);

    const statuses = reg.statuses();
    expect(statuses.map((s) => s.name)).toEqual(['keep', 'fresh']); // new map's order
    expect(statuses.every((s) => s.status === 'connected')).toBe(true);
    expect(reg.allTools().map((t) => t.qualifiedName)).toEqual([
      'mcp__keep__tick',
      'mcp__fresh__tick',
    ]);
  });

  it('re-registering the identical set is a complete no-op', async () => {
    const { reg, built } = harness({ a: stdio('noop'), b: stdio('noop') });
    await reg.connectAll();

    await reg.setServers({ a: stdio('noop'), b: stdio('noop') });

    expect(built).toHaveLength(2);
    expect(built.some((c) => c.closed)).toBe(false);
    expect(reg.statuses().map((s) => s.status)).toEqual(['connected', 'connected']);
  });

  it('an explicitly-undefined optional field is not a reconfiguration', async () => {
    const { reg, built } = harness({ a: { command: 'noop' } as McpServerConfig });
    await reg.connectAll();

    await reg.setServers({
      a: { command: 'noop', args: undefined, env: undefined } as unknown as McpServerConfig,
    });

    expect(built).toHaveLength(1);
    expect(built[0]!.closed).toBe(false);
  });

  it('a CHANGED config closes the old connection and connects a fresh one', async () => {
    const { reg, connsFor } = harness({ a: stdio('old-cmd') });
    await reg.connectAll();
    const oldConn = connsFor('a')[0]!;

    await reg.setServers({ a: stdio('new-cmd') });

    expect(oldConn.closed).toBe(true);
    expect(connsFor('a')).toHaveLength(2);
    expect(connsFor('a')[1]!.closed).toBe(false);
    expect(reg.statuses()[0]!.status).toBe('connected');
    expect(reg.statuses()[0]!.config).toEqual({ command: 'new-cmd' });
  });

  it('nested config differences are detected (args array, env map, headers)', async () => {
    const cfg = (args: string[]): McpServerConfig =>
      ({ command: 'noop', args, env: { A: '1' } }) as McpServerConfig;
    const { reg, connsFor } = harness({ a: cfg(['x']) });
    await reg.connectAll();

    await reg.setServers({ a: cfg(['x']) }); // structurally equal -> kept
    expect(connsFor('a')).toHaveLength(1);

    await reg.setServers({ a: cfg(['x', 'y']) }); // longer args -> reconnect
    expect(connsFor('a')).toHaveLength(2);
    expect(connsFor('a')[0]!.closed).toBe(true);
  });

  it("an in-process 'sdk' server keeps its connection while its instance is the same object", async () => {
    const instance: SdkMcpServerInstance = { name: 'bpt', version: '1.0.0', tools: new Map() };
    const sdkCfg = (inst: SdkMcpServerInstance): McpServerConfig => ({
      type: 'sdk',
      name: 'bpt',
      instance: inst,
    });
    const { reg, connsFor } = harness({ bpt: sdkCfg(instance) });
    await reg.connectAll();

    // Same instance object: this is the load_skill case — the current turn's
    // in-process tools must NOT flicker.
    await reg.setServers({ bpt: sdkCfg(instance), other: stdio('noop') });
    expect(connsFor('bpt')).toHaveLength(1);
    expect(connsFor('bpt')[0]!.closed).toBe(false);

    // A rebuilt instance carries different handlers -> reconnect (safe side).
    await reg.setServers({
      bpt: sdkCfg({ name: 'bpt', version: '1.0.0', tools: new Map() }),
      other: stdio('noop'),
    });
    expect(connsFor('bpt')).toHaveLength(2);
    expect(connsFor('bpt')[0]!.closed).toBe(true);
    expect(connsFor('other')).toHaveLength(1); // still untouched
  });

  it('a kept server keeps its enabled flag; a re-registered one is enabled', async () => {
    const { reg } = harness({ a: stdio('noop'), b: stdio('old') });
    await reg.connectAll();
    reg.setEnabled('a', false);
    reg.setEnabled('b', false);

    await reg.setServers({ a: stdio('noop'), b: stdio('new') });

    const byName = new Map(reg.statuses().map((s) => [s.name, s.status]));
    expect(byName.get('a')).toBe('disabled'); // untouched entry, state preserved
    expect(byName.get('b')).toBe('connected'); // reconfigured = a new registration
  });

  it('removing every server closes everything and leaves no tools', async () => {
    const { reg, built } = harness({ a: stdio('noop'), b: stdio('noop') });
    await reg.connectAll();

    await reg.setServers({});

    expect(built.every((c) => c.closed)).toBe(true);
    expect(reg.statuses()).toEqual([]);
    expect(reg.allTools()).toEqual([]);
  });

  it('re-adding a name after closeAll() builds a fresh entry (retired is final)', async () => {
    const { reg, connsFor } = harness({ a: stdio('noop') });
    await reg.connectAll();
    await reg.closeAll();

    await reg.setServers({ a: stdio('noop') });

    expect(connsFor('a')).toHaveLength(2);
    expect(reg.statuses()[0]!.status).toBe('connected');
    expect(reg.allTools().map((t) => t.qualifiedName)).toEqual(['mcp__a__tick']);
  });

  it('a failed server with an unchanged config is retried, not left dead', async () => {
    const built: FakeConn[] = [];
    const reg = new DefaultMcpRegistry({ servers: { a: stdio('noop') }, debug: () => {} });
    let failNext = true;
    (reg as unknown as { buildConnection: (name: string) => FakeConn }).buildConnection = (
      name: string,
    ) => {
      const conn = makeConn(name);
      if (failNext) {
        failNext = false;
        conn.connect = async () => {
          throw new Error('boom');
        };
      }
      built.push(conn);
      return conn;
    };

    await reg.connectAll();
    expect(reg.statuses()[0]!.status).toBe('failed');

    await reg.setServers({ a: stdio('noop') });
    expect(reg.statuses()[0]!.status).toBe('connected');
    expect(built).toHaveLength(2);
  });
});
