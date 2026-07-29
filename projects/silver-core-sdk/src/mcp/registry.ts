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
  /** M19 (audit 2026-07-17) — per-entry reconnect serialization chain. Two
   *  concurrent reconnect() calls used to interleave close/reset/connect: one
   *  suspended in close() could resume AFTER the other had already published a
   *  fresh connection, null it out, and orphan its child process. Reconnects
   *  for the same server now queue onto this chain. */
  reconnecting?: Promise<void> | null;
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
    const seen = new Set<string>();
    let collision = false;
    for (const entry of this.entries) {
      if (!entry.enabled || entry.baseStatus !== 'connected') continue;
      for (const tool of entry.tools) {
        if (seen.has(tool.qualifiedName)) collision = true;
        else seen.add(tool.qualifiedName);
        tools.push(tool);
      }
    }
    if (!collision) return tools;
    // ACROSS-SERVER duplicate qualified name. listToolsPaginated already dedupes
    // one server's pages because ONE duplicate advertised tool name 400s the
    // ENTIRE Messages API request (poisoning every turn of the session); two
    // servers can produce the same `mcp__{server}__{tool}` too, whenever one
    // server name is a `__`-extension of another (server 'a' tool 'b__c' vs
    // server 'a__b' tool 'c' — the same collision entryForQualifiedName below
    // already resolves for CALL routing). Keep exactly the entry that call()
    // would route to (longest server name, matching that resolver's ordering)
    // so what is advertised is what actually executes.
    const byName = new Map<string, McpToolEntry>();
    for (const tool of tools) {
      const prev = byName.get(tool.qualifiedName);
      if (prev === undefined || tool.serverName.length > prev.serverName.length) {
        byName.set(tool.qualifiedName, tool);
      }
    }
    this.debug(
      `[mcp] ${String(tools.length - byName.size)} MCP tool(s) collide on an ` +
        'already-taken qualified name (server names differing by "__"); keeping the ' +
        'definition the call router resolves to, since duplicate tool names reject ' +
        'the whole request',
    );
    return [...byName.values()];
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

  /** Tear down and re-establish one server's connection. Never throws.
   *  Concurrent calls for the same server run one after another (M19): the
   *  close/reset/connect sequence is not interleave-safe, so each caller
   *  queues onto the entry's reconnect chain. */
  async reconnect(serverName: string): Promise<void> {
    const entry = this.entries.find((e) => e.name === serverName);
    if (!entry) {
      this.debug(`[mcp] reconnect: unknown server '${serverName}'`);
      return;
    }
    const run = async (): Promise<void> => {
      // Let any in-flight connect publish (or fail) first, so the close below
      // sees the real current connection instead of racing its publication.
      if (entry.connecting) {
        try {
          await entry.connecting;
        } catch {
          // connectEntry never rejects; belt-and-braces only.
        }
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
    };
    const prev = entry.reconnecting ?? Promise.resolve();
    const next = prev.then(run, run);
    entry.reconnecting = next;
    try {
      await next;
    } finally {
      if (entry.reconnecting === next) entry.reconnecting = null;
    }
  }

  setEnabled(serverName: string, enabled: boolean): void {
    const entry = this.entries.find((e) => e.name === serverName);
    if (!entry) {
      this.debug(`[mcp] setEnabled: unknown server '${serverName}'`);
      return;
    }
    entry.enabled = enabled;
  }

  /**
   * Replace the live server set INCREMENTALLY (BPT finding D, 2026-07-29).
   *
   * Was: closeAll() + rebuild every entry + connectAll(). One call therefore
   * bounced EVERY connected server — including the in-process 'sdk' ones the
   * current turn's own tools are served by — so a mid-conversation
   * setMcpServers() (a skill load, say) made the whole tool surface flicker
   * even when the caller only meant to append one server.
   *
   * Now: same name AND structurally equal config => the existing entry is kept
   * verbatim, connection, tools, serverInfo and enabled flag included. Only
   * genuinely removed (or reconfigured) servers are closed, and only genuinely
   * new (or reconfigured) ones connect. A kept server is never touched, so the
   * added/removed the caller derives from statuses() describes real work.
   *
   * The caller reads statuses()/diffs for the public McpSetServersResult
   * (query.ts owns the official shape).
   */
  async setServers(servers: Record<string, McpServerConfig>): Promise<void> {
    const byName = new Map<string, ServerEntry>();
    for (const entry of this.entries) {
      if (!byName.has(entry.name)) byName.set(entry.name, entry);
    }

    const next: ServerEntry[] = [];
    const kept = new Set<ServerEntry>();
    const added: string[] = [];
    const reconfigured: string[] = [];
    for (const [name, config] of Object.entries(servers)) {
      const prev = byName.get(name);
      // A retired entry is dead for good (connectEntry refuses to start a new
      // connect on it), so re-registering that name must build a FRESH entry
      // even when the config is identical.
      if (prev !== undefined && prev.retired !== true && configsEqual(prev.config, config)) {
        kept.add(prev);
        next.push(prev);
        continue;
      }
      (prev === undefined ? added : reconfigured).push(name);
      next.push({
        name,
        config,
        connection: null,
        baseStatus: 'pending' as const,
        tools: [],
        enabled: true,
      });
    }
    const dropped = this.entries.filter((entry) => !kept.has(entry));
    const removed = dropped
      .filter((entry) => !Object.prototype.hasOwnProperty.call(servers, entry.name))
      .map((entry) => entry.name);
    this.debug(
      `[mcp] setServers: kept ${String(kept.size)}, added ${String(added.length)}` +
        `${added.length > 0 ? ` (${added.join(', ')})` : ''}, removed ${String(removed.length)}` +
        `${removed.length > 0 ? ` (${removed.join(', ')})` : ''}, reconfigured ` +
        `${String(reconfigured.length)}${reconfigured.length > 0 ? ` (${reconfigured.join(', ')})` : ''}`,
    );

    this.entries.splice(0, this.entries.length, ...next);
    // Close the abandoned entries BEFORE connecting the new ones. A server
    // whose config CHANGED appears on both lists (old entry dropped, fresh
    // entry added under the same name); running the two phases concurrently
    // would spawn the replacement child / open the second HTTP session while
    // the outgoing one is still alive.
    await this.retireAndClose(dropped);
    await this.connectAll();
  }

  /** Close every connection (best-effort, parallel). */
  async closeAll(): Promise<void> {
    // Snapshot: retireAndClose awaits in-flight handshakes, and this.entries is
    // a live array that setServers() may splice underneath it.
    await this.retireAndClose([...this.entries]);
  }

  /** Retire and close a SUBSET of entries (closeAll passes all of them;
   *  setServers passes only the ones the new set abandons). */
  private async retireAndClose(entries: readonly ServerEntry[]): Promise<void> {
    // audit 2026-07-14 M-4: retire every entry FIRST, synchronously, so a
    // handshake that resolves while we await below sees the flag and closes
    // its fresh connection instead of publishing onto an abandoned entry.
    // (setServers() has already dropped these entries from the array; the query
    // teardown paths never reconnect a closed registry, so retirement is final.)
    for (const entry of entries) entry.retired = true;
    await Promise.all(
      entries.map(async (entry) => {
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
      // 'needs-auth' is a declared public status (types.ts McpServerStatus)
      // that previously had NO producing path — an HTTP 401/403 handshake
      // failure collapsed into 'failed', so a consumer's auth flow could
      // never observe that authentication (not the server) is what's missing.
      const httpStatus = err instanceof McpError ? err.context.httpStatus : undefined;
      entry.baseStatus = httpStatus === 401 || httpStatus === 403 ? 'needs-auth' : 'failed';
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
      default: {
        // Untyped configs reach here from `.mcp.json` (JSON, so the TS union
        // does not guard them). The old text said "expected ... an http url"
        // even when the entry DID carry a url — the reader then re-checked a
        // field that was already right instead of the missing `type`
        // discriminator. Name what this entry actually looks like.
        const cfg = config as Record<string, unknown>;
        let detail: string;
        if (cfg['type'] !== undefined) {
          detail = `unsupported transport type ${JSON.stringify(cfg['type'])} (expected 'stdio', 'http' or 'sdk')`;
        } else if (typeof cfg['url'] === 'string') {
          detail = `it declares a url but no transport type — add "type": "http"`;
        } else if (cfg['command'] !== undefined) {
          detail = `its "command" is ${typeof cfg['command']}, not a string`;
        } else {
          const keys = Object.keys(cfg);
          detail =
            `it declares neither a stdio "command", an http "url" (with "type": "http"), ` +
            `nor an sdk "instance" (keys present: ${keys.length > 0 ? keys.join(', ') : 'none'})`;
        }
        throw new ConfigurationError(
          `MCP server '${name}' has an unusable configuration: ${detail}`,
        );
      }
    }
  }

  /** Longest-server-name match, so names containing '__' resolve correctly.
   *  When SEVERAL server names prefix-match the same qualified name (pathological
   *  '__' collisions like server 'a' tool 'b__c' vs server 'a__b' tool 'c'),
   *  prefer the candidate that actually SERVES the residual tool — bare
   *  longest-match made the shorter server's tool permanently unreachable
   *  (audit 2026-07-17 L37). Falls back to the longest match so the existing
   *  disabled/disconnected error paths keep their attribution. */
  private entryForQualifiedName(qualifiedName: string): ServerEntry | undefined {
    const candidates = this.entries
      .filter((e) => qualifiedName.startsWith(`mcp__${e.name}__`))
      .sort((a, b) => b.name.length - a.name.length);
    if (candidates.length <= 1) return candidates[0];
    const serves = (entry: ServerEntry): boolean => {
      const toolName = qualifiedName.slice(`mcp__${entry.name}__`.length);
      return entry.tools.some((t) => t.toolName === toolName);
    };
    // WV4-10 (audit r3): prefer an ENABLED+connected server that serves the
    // tool. A disabled server keeps its stale `tools`, so under a `__` name
    // collision it could shadow a live server and make the tool unreachable.
    for (const entry of candidates) {
      if (entry.enabled && entry.baseStatus === 'connected' && serves(entry)) return entry;
    }
    for (const entry of candidates) {
      if (serves(entry)) return entry;
    }
    return candidates[0];
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
 * Can a same-named server keep its live connection across setServers()?
 *
 * Structural equality over the config, with two deliberate rules:
 *  - keys whose value is `undefined` are absent (`{command:'x', args:undefined}`
 *    is the same server as `{command:'x'}` — an optional field a caller spelled
 *    out is not a reconfiguration);
 *  - anything that is not a plain object or array compares by IDENTITY. That
 *    covers the 'sdk' transport's `instance` (its `tools` is a Map holding
 *    handler closures): a freshly built instance is treated as a different
 *    server and reconnects, which is the safe direction — the handlers may not
 *    be the ones that are already live.
 */
function configsEqual(a: McpServerConfig, b: McpServerConfig): boolean {
  return deepEqual(a, b);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  const aKeys = definedKeys(a);
  const bKeys = definedKeys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function definedKeys(obj: Record<string, unknown>): string[] {
  return Object.keys(obj).filter((k) => obj[k] !== undefined);
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
