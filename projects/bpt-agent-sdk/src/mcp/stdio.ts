/**
 * BPT Agent SDK - stdio MCP connection (module F).
 *
 * Speaks JSON-RPC 2.0 over newline-delimited stdin/stdout of a spawned MCP
 * server process (MCP stdio transport). Clean-room implementation written
 * from the public MCP specification only.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import process from 'node:process';
import type {
  CallToolResult,
  CallToolResultContent,
  JSONSchema,
  McpStdioServerConfig,
} from '../types.js';
import { AbortError } from '../errors.js';

const MCP_PROTOCOL_VERSION = '2025-06-18';
const CLIENT_INFO = { name: 'bpt-agent-sdk', version: '0.1.0' } as const;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const KILL_GRACE_MS = 2_000;
/** Safety cap on tools/list pagination to avoid a misbehaving-server loop. */
const MAX_LIST_PAGES = 100;

type JsonRpcId = string | number;

type JsonRpcMessage = {
  jsonrpc?: unknown;
  id?: JsonRpcId | null;
  method?: unknown;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string } | null;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
};

/**
 * One stdio MCP server connection. Lifecycle:
 * connect() -> listTools()/callTool()* -> close().
 */
export class StdioMcpConnection {
  private readonly config: McpStdioServerConfig;
  private readonly label: string;
  private readonly debug: (msg: string) => void;
  private readonly baseEnv: Record<string, string | undefined>;
  private readonly requestTimeoutMs: number;

  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuffer = '';
  private nextId = 1;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private closed = false;
  private info: { name: string; version: string } | undefined;

  constructor(
    config: McpStdioServerConfig,
    opts: {
      /** Label used in debug lines (usually the configured server name). */
      name?: string;
      debug?: (msg: string) => void;
      /** Base environment; config.env is merged over it. Defaults to process.env. */
      env?: Record<string, string | undefined>;
      requestTimeoutMs?: number;
    } = {},
  ) {
    this.config = config;
    this.label = opts.name ?? config.command;
    this.debug = opts.debug ?? (() => {});
    this.baseEnv = opts.env ?? process.env;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  /** Spawn the server process and run the MCP initialize handshake. */
  async connect(signal?: AbortSignal): Promise<void> {
    if (this.closed) {
      throw new Error(`MCP stdio connection '${this.label}' is closed`);
    }
    if (this.child) {
      throw new Error(`MCP stdio connection '${this.label}' is already connected`);
    }

    // Merged environment: config.env entries win over the inherited base env.
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(this.baseEnv)) {
      if (value !== undefined) env[key] = value;
    }
    Object.assign(env, this.config.env ?? {});

    const child = spawn(this.config.command, this.config.args ?? [], {
      cwd: this.config.cwd,
      env,
    });
    this.child = child;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.onStdout(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      const text = chunk.trim();
      if (text) this.debug(`[mcp:${this.label}] stderr: ${text}`);
    });
    // Prevent EPIPE on stdin from crashing the host process.
    child.stdin.on('error', (err: Error) => {
      this.debug(`[mcp:${this.label}] stdin error: ${err.message}`);
    });
    child.on('error', (err: Error) => {
      this.failAllPending(
        new Error(`MCP server '${this.label}' process error: ${err.message}`),
      );
    });
    child.on('exit', (code, sig) => {
      this.debug(
        `[mcp:${this.label}] process exited (code=${String(code)}, signal=${String(sig)})`,
      );
      this.closed = true;
      this.failAllPending(
        new Error(`MCP server '${this.label}' exited before responding`),
      );
    });

    const initResult = await this.request(
      'initialize',
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: CLIENT_INFO,
      },
      signal,
    );
    this.info = extractServerInfo(initResult);
    this.sendNotification('notifications/initialized');
  }

  /** serverInfo from the initialize handshake (undefined before connect). */
  serverInfo(): { name: string; version: string } | undefined {
    return this.info;
  }

  /** tools/list with cursor pagination. */
  async listTools(
    signal?: AbortSignal,
  ): Promise<Array<{ name: string; description?: string; inputSchema: JSONSchema }>> {
    const tools: Array<{ name: string; description?: string; inputSchema: JSONSchema }> = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const result = await this.request(
        'tools/list',
        cursor === undefined ? {} : { cursor },
        signal,
      );
      const { list, nextCursor } = parseToolsListResult(result);
      tools.push(...list);
      if (!nextCursor) return tools;
      cursor = nextCursor;
    }
    this.debug(
      `[mcp:${this.label}] tools/list pagination exceeded ${MAX_LIST_PAGES} pages; truncating`,
    );
    return tools;
  }

  /** tools/call; unknown result content types are stringified to text. */
  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<CallToolResult> {
    const result = await this.request('tools/call', { name, arguments: args }, signal);
    return normalizeCallToolResult(result);
  }

  /** Terminate the child: SIGTERM, then SIGKILL after a short grace period. */
  async close(): Promise<void> {
    this.closed = true;
    this.failAllPending(new Error(`MCP stdio connection '${this.label}' closed`));
    const child = this.child;
    this.child = null;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    const exited = await waitForExit(child, KILL_GRACE_MS);
    if (!exited) {
      child.kill('SIGKILL');
      await waitForExit(child, KILL_GRACE_MS);
    }
  }

  // -- wire plumbing ---------------------------------------------------------

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    // One JSON object per line; tolerate multiple or partial lines per chunk.
    let newlineIdx: number;
    while ((newlineIdx = this.stdoutBuffer.indexOf('\n')) !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIdx).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIdx + 1);
      if (!line) continue;
      let msg: JsonRpcMessage;
      try {
        msg = JSON.parse(line) as JsonRpcMessage;
      } catch {
        this.debug(`[mcp:${this.label}] ignoring non-JSON stdout line`);
        continue;
      }
      this.dispatch(msg);
    }
  }

  private dispatch(msg: JsonRpcMessage): void {
    const hasId = msg.id !== undefined && msg.id !== null;
    const isResponse =
      hasId && msg.method === undefined && ('result' in msg || 'error' in msg);

    if (isResponse) {
      const id = msg.id as JsonRpcId;
      const entry = this.pending.get(id);
      if (!entry) {
        this.debug(`[mcp:${this.label}] response for unknown request id ${String(id)}`);
        return;
      }
      this.pending.delete(id);
      if (msg.error) {
        entry.reject(rpcErrorToError(this.label, msg.error));
      } else {
        entry.resolve(msg.result);
      }
      return;
    }

    if (typeof msg.method === 'string' && hasId) {
      // Server-initiated request: this client implements no server-callable
      // methods, so answer with JSON-RPC "method not found".
      try {
        this.write({
          jsonrpc: '2.0',
          id: msg.id as JsonRpcId,
          error: { code: -32601, message: 'Method not found' },
        });
      } catch (err) {
        this.debug(
          `[mcp:${this.label}] failed to answer server request: ${errMessage(err)}`,
        );
      }
      return;
    }

    if (typeof msg.method === 'string') {
      // Notifications are ignored in v0.1.
      this.debug(`[mcp:${this.label}] ignoring notification '${msg.method}'`);
      return;
    }

    this.debug(`[mcp:${this.label}] ignoring unrecognized message`);
  }

  private request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      if (this.closed || !this.child) {
        reject(new Error(`MCP stdio connection '${this.label}' is not open`));
        return;
      }
      if (signal?.aborted) {
        reject(new AbortError());
        return;
      }
      const id = this.nextId++;
      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        this.pending.delete(id);
        fn();
      };
      const onAbort = (): void => finish(() => reject(new AbortError()));
      const timer = setTimeout(() => {
        finish(() =>
          reject(
            new Error(
              `MCP request '${method}' to server '${this.label}' timed out after ${this.requestTimeoutMs}ms`,
            ),
          ),
        );
      }, this.requestTimeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(id, {
        resolve: (value) => finish(() => resolve(value)),
        reject: (err) => finish(() => reject(err)),
      });
      try {
        this.write({ jsonrpc: '2.0', id, method, params });
      } catch (err) {
        finish(() => reject(err));
      }
    });
  }

  private sendNotification(method: string, params?: unknown): void {
    const msg: Record<string, unknown> = { jsonrpc: '2.0', method };
    if (params !== undefined) msg.params = params;
    this.write(msg);
  }

  private write(msg: Record<string, unknown>): void {
    const child = this.child;
    if (!child || this.closed) {
      throw new Error(`MCP stdio connection '${this.label}' is not open`);
    }
    child.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  private failAllPending(err: Error): void {
    const entries = [...this.pending.values()];
    this.pending.clear();
    for (const entry of entries) entry.reject(err);
  }
}

// -- shared-shape helpers (kept module-private; see registry for consumers) --

function extractServerInfo(result: unknown): { name: string; version: string } | undefined {
  if (result && typeof result === 'object' && 'serverInfo' in result) {
    const si = (result as { serverInfo?: unknown }).serverInfo;
    if (si && typeof si === 'object') {
      const { name, version } = si as { name?: unknown; version?: unknown };
      return {
        name: typeof name === 'string' ? name : 'unknown',
        version: typeof version === 'string' ? version : 'unknown',
      };
    }
  }
  return undefined;
}

function parseToolsListResult(result: unknown): {
  list: Array<{ name: string; description?: string; inputSchema: JSONSchema }>;
  nextCursor?: string;
} {
  const list: Array<{ name: string; description?: string; inputSchema: JSONSchema }> = [];
  if (!result || typeof result !== 'object') return { list };
  const obj = result as { tools?: unknown; nextCursor?: unknown };
  if (Array.isArray(obj.tools)) {
    for (const raw of obj.tools) {
      if (!raw || typeof raw !== 'object') continue;
      const t = raw as { name?: unknown; description?: unknown; inputSchema?: unknown };
      if (typeof t.name !== 'string' || t.name.length === 0) continue;
      list.push({
        name: t.name,
        description: typeof t.description === 'string' ? t.description : undefined,
        inputSchema:
          t.inputSchema && typeof t.inputSchema === 'object' && !Array.isArray(t.inputSchema)
            ? (t.inputSchema as JSONSchema)
            : { type: 'object' },
      });
    }
  }
  const nextCursor =
    typeof obj.nextCursor === 'string' && obj.nextCursor.length > 0
      ? obj.nextCursor
      : undefined;
  return { list, nextCursor };
}

function normalizeCallToolResult(raw: unknown): CallToolResult {
  if (!raw || typeof raw !== 'object') {
    return { content: [{ type: 'text', text: JSON.stringify(raw ?? null) }] };
  }
  const obj = raw as { content?: unknown; isError?: unknown };
  const content: CallToolResultContent[] = [];
  if (Array.isArray(obj.content)) {
    for (const item of obj.content) content.push(normalizeContentItem(item));
  }
  const result: CallToolResult = { content };
  if (obj.isError === true) result.isError = true;
  return result;
}

function normalizeContentItem(item: unknown): CallToolResultContent {
  if (item && typeof item === 'object') {
    const t = item as {
      type?: unknown;
      text?: unknown;
      data?: unknown;
      mimeType?: unknown;
      resource?: unknown;
    };
    if (t.type === 'text' && typeof t.text === 'string') {
      return { type: 'text', text: t.text };
    }
    if (t.type === 'image' && typeof t.data === 'string' && typeof t.mimeType === 'string') {
      return { type: 'image', data: t.data, mimeType: t.mimeType };
    }
    if (t.type === 'resource' && t.resource && typeof t.resource === 'object') {
      const r = t.resource as { uri?: unknown; mimeType?: unknown; text?: unknown };
      if (typeof r.uri === 'string') {
        const resource: { uri: string; mimeType?: string; text?: string } = { uri: r.uri };
        if (typeof r.mimeType === 'string') resource.mimeType = r.mimeType;
        if (typeof r.text === 'string') resource.text = r.text;
        return { type: 'resource', resource };
      }
    }
  }
  // Unknown content types are surfaced as stringified text rather than dropped.
  return { type: 'text', text: JSON.stringify(item ?? null) };
}

function rpcErrorToError(label: string, error: { code?: number; message?: string }): Error {
  const code = typeof error.code === 'number' ? ` ${String(error.code)}` : '';
  return new Error(
    `MCP server '${label}' returned JSON-RPC error${code}: ${error.message ?? 'unknown error'}`,
  );
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(true);
      return;
    }
    const onExit = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      resolve(false);
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    child.once('exit', onExit);
  });
}
