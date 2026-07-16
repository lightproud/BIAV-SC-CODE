/**
 * Silver Core SDK - MCP registry (module F).
 *
 * Owns one connection per configured server, exposes qualified tool names
 * (mcp__{server}__{tool}) to the engine, and isolates the agent loop from
 * individual server failures: connect failures become 'failed' statuses and
 * call failures become isError tool results - never thrown (aborts excepted).
 */

import process from 'node:process';
import type { McpRegistry, McpToolEntry } from '../internal/contracts.js';
import type {
  CallToolResult,
  ElicitationHandler,
  JSONSchema,
  McpHttpServerConfig,
  McpResource,
  McpResourceContent,
  McpSSEServerConfig,
  McpSdkServerConfigWithInstance,
  McpServerConfig,
  McpServerStatus,
  McpStdioServerConfig,
  ToolAnnotations,
} from '../types.js';
import { AbortError, ConfigurationError, McpError, isAbortError } from '../errors.js';
import { StdioMcpConnection } from './stdio.js';
import { HttpMcpConnection } from './http.js';
import { SdkMcpConnection } from './sdk-server.js';

const CONNECT_TIMEOUT_MS = 60_000;

/** Structural contract satisfied by all three connection classes. */
type McpConnectionLike = {
  connect(signal?: AbortSignal): Promise<void>;
  serverInfo(): { name: string; version: string } | undefined;
  listTools(
    signal?: AbortSignal,
  ): Promise<
    Array<{
      name: string;
      description?: string;
      inputSchema: JSONSchema;
      annotations?: ToolAnnotations;
    }>
  >;
  callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<CallToolResult>;
  listResources(signal?: AbortSignal): Promise<McpResource[]>;
  readResource(uri: string, signal?: AbortSignal): Promise<McpResourceContent[]>;
  readResourceDir(uri: string, signal?: AbortSignal): Promise<McpResource[]>;
  close(): Promise<void>;
};

type ServerEntry = {
  name: string;
  config: McpServerConfig;
  connection: McpConnectionLike | null;
  /** Status ignoring the enabled flag; statuses() overlays 'disabled'. */
  baseStatus: 'pending' | 'connected' | 'failed' | 'needs-auth';
  error?: string;
  serverInfo?: { name: string; version: string };
  tools: McpToolEntry[];
  enabled: boolean;
  /** Finding M4 — in-flight connect latch. Set synchronously before the
   *  connect+listTools await so a concurrent connectAll()/reconnect() for the
   *  same entry coalesces onto it instead of spawning a second connection. */
  connecting?: Promise<void> | null;
  /** audit 2026-07-14 M-4 — set when closeAll()/setServers() abandons this
   *  entry. A handshake that resolves AFTERWARDS must close its fresh
   *  connection instead of publishing it onto the abandoned entry, where the
   *  child process would leak forever (nothing closes it again). */
  retired?: boolean;
};

export class DefaultMcpRegistry implements McpRegistry {
  private readonly entries: ServerEntry[];
  private readonly env: Record<string, string | undefined>;
  private readonly debug: (msg: string) => void;
  private readonly elicitation?: ElicitationHandler;

  constructor(
    opts: {
      servers?: Record<string, McpServerConfig>;
      /** Base env for stdio server spawns (config.env merges over it). */
      env?: Record<string, string | undefined>;
      debug?: (msg: string) => void;
      /** Host handler answering server-initiated elicitation/create requests. */
      elicitation?: ElicitationHandler;
    } = {},
  ) {
    this.env = opts.env ?? process.env;
    this.debug = opts.debug ?? (() => {});
    this.elicitation = opts.elicitation;
    this.entries = Object.entries(opts.servers ?? {}).map(([name, config]) => ({
      name,
      config,
      connection: null,
      baseStatus: 'pending',
      tools: [],
      enabled: true,
    }));
  }

  /** Connect every enabled, not-yet-connected server in parallel. Never throws. */
  async connectAll(): Promise<void> {
    await Promise.all(
      this.entries.map(async (entry) => {
        if (!entry.enabled || entry.connection) return;
        await this.connectEntry(entry);
      }),
    );
  }

  statuses(): McpServerStatus[] {
    return this.entries.map((entry) => {
      const status: McpServerStatus = {
        name: entry.name,
        status: entry.enabled ? entry.baseStatus : 'disabled',
        config: entry.config,
      };
      if (entry.serverInfo) status.serverInfo = entry.serverInfo;
      if (entry.error) status.error = entry.error;
      // Per-server tools, once the server is connected (task #17; official
      // object form since v0.7 T2-7 — name + description + mapped hints).
      if (entry.enabled && entry.baseStatus === 'connected' && entry.tools.length > 0) {
        status.tools = entry.tools.map((t) => {
          const a = t.annotations;
          const annotations =
            a !== undefined &&
            (a.readOnlyHint !== undefined ||
              a.destructiveHint !== undefined ||
              a.openWorldHint !== undefined)
              ? {
                  ...(a.readOnlyHint !== undefined ? { readOnly: a.readOnlyHint } : {}),
                  ...(a.destructiveHint !== undefined
                    ? { destructive: a.destructiveHint }
                    : {}),
                  ...(a.openWorldHint !== undefined ? { openWorld: a.openWorldHint } : {}),
                }
              : undefined;
          return {
            name: t.toolName,
            ...(t.description !== undefined ? { description: t.description } : {}),
            ...(annotations !== undefined ? { annotations } : {}),
          };
        });
      }
      return status;
    });
  }

  allTools(): McpToolEntry[] {
    const tools: McpToolEntry[] = [];
    for (const entry of this.entries) {
      if (entry.enabled && entry.baseStatus === 'connected') tools.push(...entry.tools);
    }
    return tools;
  }

  has(qualifiedName: string): boolean {
    const entry = this.entryForQualifiedName(qualifiedName);
    if (!entry || !entry.enabled || entry.baseStatus !== 'connected') return false;
    const toolName = qualifiedName.slice(`mcp__${entry.name}__`.length);
    return entry.tools.some((t) => t.toolName === toolName);
  }

  /**
   * Call a qualified tool. Unknown/disabled/disconnected targets and server
   * failures produce isError results; only aborts propagate as AbortError.
   */
  async call(
    qualifiedName: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<CallToolResult> {
    const entry = this.entryForQualifiedName(qualifiedName);
    if (!entry) return errorResult(`No such MCP tool: ${qualifiedName}`);
    if (!entry.enabled) {
      return errorResult(`MCP server '${entry.name}' is disabled`);
    }
    if (entry.baseStatus !== 'connected' || !entry.connection) {
      return errorResult(
        `MCP server '${entry.name}' is not connected${entry.error ? ` (${entry.error})` : ''}`,
      );
    }
    const toolName = qualifiedName.slice(`mcp__${entry.name}__`.length);
    if (!entry.tools.some((t) => t.toolName === toolName)) {
      return errorResult(`No such MCP tool: ${qualifiedName}`);
    }
    try {
      return await entry.connection.callTool(toolName, args, signal);
    } catch (err) {
      // The ONLY reason to abort the whole run is a genuine CALLER abort (the
      // passed signal). An AbortError raised while the signal is NOT aborted
      // means the connection was closed mid-call (setServers/reconnect) — the
      // HTTP path throws AbortError('...closed') there, unlike stdio which
      // throws a plain McpError. Degrade it to an isError result like the stdio
      // close does, rather than tearing down the entire agent run over one
      // tool call. (Contract: "call failures become isError results — never
      // thrown, aborts excepted".)
      if (signal.aborted) throw new AbortError();
      return errorResult(`MCP tool '${qualifiedName}' failed: ${errMessage(err)}`);
    }
  }

  /** List resources across connected servers (or one named server). */
  async listResources(
    server: string | undefined,
    signal: AbortSignal,
  ): Promise<McpResource[]> {
    const out: McpResource[] = [];
    for (const entry of this.entries) {
      if (server !== undefined && entry.name !== server) continue;
      if (!entry.enabled || entry.baseStatus !== 'connected' || !entry.connection) continue;
      try {
        const list = await entry.connection.listResources(signal);
        for (const r of list) out.push({ ...r, server: entry.name });
      } catch (err) {
        if (isAbortError(err)) throw err;
        this.debug(`[mcp] listResources '${entry.name}' failed: ${errMessage(err)}`);
      }
    }
    return out;
  }

  /** Read one resource's contents from a named, connected server. */
  async readResource(
    server: string,
    uri: string,
    signal: AbortSignal,
  ): Promise<McpResourceContent[]> {
    const entry = this.entries.find((e) => e.name === server);
    if (!entry) {
      throw new McpError('mcp_unknown_server', `No such MCP server: ${server}`, {
        serverLabel: server,
      });
    }
    if (!entry.enabled || entry.baseStatus !== 'connected' || !entry.connection) {
      throw new McpError('mcp_not_connected', `MCP server '${server}' is not connected`, {
        serverLabel: server,
        phase: 'request',
      });
    }
    return await entry.connection.readResource(uri, signal);
  }

  async readResourceDir(
    server: string,
    uri: string,
    signal: AbortSignal,
  ): Promise<McpResource[]> {
    const entry = this.entries.find((e) => e.name === server);
    if (!entry) {
      throw new McpError('mcp_unknown_server', `No such MCP server: ${server}`, {
        serverLabel: server,
      });
    }
    if (!entry.enabled || entry.baseStatus !== 'connected' || !entry.connection) {
      throw new McpError('mcp_not_connected', `MCP server '${server}' is not connected`, {
        serverLabel: server,
        phase: 'request',
      });
    }
    return await entry.connection.readResourceDir(uri, signal);
  }

  /** Tear down and re-establish one server's connection. Never throws. */
  async reconnect(serverName: string): Promise<void> {
    const entry = this.entries.find((e) => e.name === serverName);
    if (!entry) {
      this.debug(`[mcp] reconnect: unknown server '${serverName}'`);
      return;
    }
    if (entry.connection) {
      try {
        await entry.connection.close();
      } catch (err) {
        this.debug(`[mcp] error closing '${entry.name}': ${errMessage(err)}`);
      }
      entry.connection = null;
    }
    entry.tools = [];
    entry.serverInfo = undefined;
    entry.error = undefined;
    entry.baseStatus = 'pending';
    if (!entry.enabled) return; // Stays disconnected until re-enabled.
    await this.connectEntry(entry);
  }

  setEnabled(serverName: string, enabled: boolean): void {
    const entry = this.entries.find((e) => e.name === serverName);
    if (!entry) {
      this.debug(`[mcp] setEnabled: unknown server '${serverName}'`);
      return;
    }
    entry.enabled = enabled;
  }

  /** Replace the live server set: tear down current connections, swap in the
   *  new configs, and connect them. The caller reads statuses()/diffs for the
   *  public McpSetServersResult (query.ts owns the official shape). */
  async setServers(servers: Record<string, McpServerConfig>): Promise<void> {
    await this.closeAll();
    const next: ServerEntry[] = Object.entries(servers).map(([name, config]) => ({
      name,
      config,
      connection: null,
      baseStatus: 'pending' as const,
      tools: [],
      enabled: true,
    }));
    this.entries.splice(0, this.entries.length, ...next);
    await this.connectAll();
  }

  /** Close every connection (best-effort, parallel). */
  async closeAll(): Promise<void> {
    // audit 2026-07-14 M-4: retire every entry FIRST, synchronously, so a
    // handshake that resolves while we await below sees the flag and closes
    // its fresh connection instead of publishing onto an abandoned entry.
    // (setServers() replaces the entry array afterwards; the query teardown
    // paths never reconnect a closed registry, so retirement is final.)
    for (const entry of this.entries) entry.retired = true;
    await Promise.all(
      this.entries.map(async (entry) => {
        // Await any in-flight handshake so the child it may have spawned is
        // settled before we sweep: it either published entry.connection
        // (closed below) or self-closed on the retired flag. connectEntryInner
        // never rejects, but guard anyway — closeAll stays best-effort.
        if (entry.connecting) {
          try {
            await entry.connecting;
          } catch (err) {
            this.debug(
              `[mcp] error awaiting in-flight connect of '${entry.name}': ${errMessage(err)}`,
            );
          }
        }
        if (!entry.connection) return;
        try {
          await entry.connection.close();
        } catch (err) {
          this.debug(`[mcp] error closing '${entry.name}': ${errMessage(err)}`);
        }
        entry.connection = null;
        entry.tools = [];
        if (entry.baseStatus === 'connected') entry.baseStatus = 'pending';
      }),
    );
  }

  // -- internals -------------------------------------------------------------

  /** Connect one server, coalescing concurrent callers onto ONE in-flight
   *  attempt (finding M4). Without the latch, entry.connection was published
   *  only after the up-to-60s connect+listTools await, so a second concurrent
   *  entry (a racing connectAll, or reconnect() during startup) passed the
   *  `!entry.connection` guard and spawned a SECOND child process; the loser
   *  was never close()d and leaked. */
  private connectEntry(entry: ServerEntry): Promise<void> {
    // audit 2026-07-14 M-4: an abandoned entry never starts a new connect.
    if (entry.retired) return Promise.resolve();
    if (entry.connecting) return entry.connecting;
    const p = this.connectEntryInner(entry).finally(() => {
      entry.connecting = null;
    });
    entry.connecting = p;
    return p;
  }

  /** Connect one server with a per-server timeout; failures land in status. */
  private async connectEntryInner(entry: ServerEntry): Promise<void> {
    entry.baseStatus = 'pending';
    entry.error = undefined;
    entry.tools = [];
    entry.serverInfo = undefined;

    let connection: McpConnectionLike | null = null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
    if (typeof timer.unref === 'function') timer.unref();
    try {
      const conn = this.buildConnection(entry.name, entry.config);
      connection = conn;
      const work = (async () => {
        await conn.connect(controller.signal);
        return await conn.listTools(controller.signal);
      })();
      const tools = await raceWithAbort(
        work,
        controller.signal,
        () =>
          new McpError(
            'mcp_connect_timeout',
            `MCP server '${entry.name}' timed out after ${CONNECT_TIMEOUT_MS}ms while connecting`,
            { serverLabel: entry.name, phase: 'connect', timeoutMs: CONNECT_TIMEOUT_MS },
          ),
      );
      // audit 2026-07-14 M-4: closeAll()/setServers() may have retired this
      // entry while the (up to 60s) handshake was in flight. Publishing now
      // would hang a live connection on an abandoned entry — nothing would
      // ever close it again and the child process would leak forever. Close
      // the fresh connection instead and leave the entry unpublished.
      if (entry.retired) {
        this.debug(
          `[mcp] '${entry.name}' was retired during connect; closing the fresh connection`,
        );
        try {
          await conn.close();
        } catch (err) {
          this.debug(`[mcp] error closing retired '${entry.name}': ${errMessage(err)}`);
        }
        return;
      }
      entry.connection = conn;
      entry.serverInfo = conn.serverInfo();
      entry.tools = tools.map((t) => ({
        qualifiedName: `mcp__${entry.name}__${t.name}`,
        serverName: entry.name,
        toolName: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        ...(t.annotations !== undefined ? { annotations: t.annotations } : {}),
      }));
      entry.baseStatus = 'connected';
      this.debug(`[mcp] connected '${entry.name}' (${entry.tools.length} tools)`);
    } catch (err) {
      entry.baseStatus = 'failed';
      entry.error = errMessage(err);
      entry.connection = null;
      this.debug(`[mcp] failed to connect '${entry.name}': ${entry.error}`);
      if (connection) {
        try {
          await connection.close();
        } catch {
          // Best-effort cleanup after a failed connect.
        }
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private buildConnection(name: string, config: McpServerConfig): McpConnectionLike {
    // Default to stdio when no explicit type but a command is present.
    const type =
      config.type ?? ('command' in config && typeof config.command === 'string' ? 'stdio' : undefined);
    switch (type) {
      case 'stdio':
        return new StdioMcpConnection(config as McpStdioServerConfig, {
          name,
          env: this.env,
          debug: this.debug,
          elicitation: this.elicitation,
        });
      case 'http':
      case 'sse':
        // The 'sse' constructor throws NotImplementedError, which lands in
        // connectEntry's catch and surfaces as a 'failed' status.
        return new HttpMcpConnection(config as McpHttpServerConfig | McpSSEServerConfig, {
          name,
          debug: this.debug,
          elicitation: this.elicitation,
        });
      case 'sdk':
        return new SdkMcpConnection((config as McpSdkServerConfigWithInstance).instance, {
          debug: this.debug,
        });
      default:
        throw new ConfigurationError(
          `MCP server '${name}' has an unrecognized configuration (expected a stdio command, an http url, or an sdk instance)`,
        );
    }
  }

  /** Longest-server-name match, so names containing '__' resolve correctly. */
  private entryForQualifiedName(qualifiedName: string): ServerEntry | undefined {
    let best: ServerEntry | undefined;
    for (const entry of this.entries) {
      if (
        qualifiedName.startsWith(`mcp__${entry.name}__`) &&
        (!best || entry.name.length > best.name.length)
      ) {
        best = entry;
      }
    }
    return best;
  }
}

// -- helpers -----------------------------------------------------------------

function errorResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Resolve with the work promise, or reject with the caller-built timeout
 * error when the signal fires first. The work promise always keeps a
 * rejection handler attached, so a late failure never becomes an unhandled
 * rejection.
 */
function raceWithAbort<T>(
  work: Promise<T>,
  signal: AbortSignal,
  timeoutError: () => Error,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(timeoutError());
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}
