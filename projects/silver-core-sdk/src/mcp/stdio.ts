/**
 * Silver Core SDK - stdio MCP connection (module F).
 *
 * Speaks JSON-RPC 2.0 over newline-delimited stdin/stdout of a spawned MCP
 * server process (MCP stdio transport). Clean-room implementation written
 * from the public MCP specification only.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import process from 'node:process';
import type {
  CallToolResult,
  ElicitationHandler,
  McpResource,
  McpResourceContent,
  McpStdioServerConfig,
} from '../types.js';
import { AbortError, McpError } from '../errors.js';
import { resolveElicitation } from './elicitation.js';
import { planProcessKill } from '../internal/process-kill.js';
// Wire-shape layer shared with http.ts — constants, the JSON-RPC message shape
// and every pure result parser live there once (see protocol.ts).
import {
  CLIENT_INFO,
  DEFAULT_REQUEST_TIMEOUT_MS,
  MCP_PROTOCOL_VERSION,
  extractServerInfo,
  listToolsPaginated,
  negotiateProtocolVersion,
  normalizeCallToolResult,
  parseResourceContents,
  parseResourcesList,
  type JsonRpcId,
  type JsonRpcMessage,
  type McpToolDescriptor,
  rpcErrorToError as rpcErrorToErrorFor,
} from './protocol.js';

const KILL_GRACE_MS = 2_000;
/** W8-2 (audit r3): max bytes an unterminated stdout line may accumulate
 *  before we treat the stream as hostile. One JSON-RPC message per line; a
 *  server (or MITM) that never emits `\n` would otherwise grow the buffer
 *  without bound → OOM. 16 MiB is far above any legitimate MCP message. */
const MAX_STDOUT_LINE_BYTES = 16 * 1024 * 1024;

/** This connection's transport tag, bound once into the shared JSON-RPC error
 *  wrapper so every call site reads exactly as it did before. */
const rpcErrorToError = (label: string, error: { code?: number; message?: string }): Error =>
  rpcErrorToErrorFor(label, error, 'stdio');

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
  /** Exit code/signal of the server process, captured on 'exit' so the error
   *  raised on 'close' can NAME why the server died (see describeExit). */
  private lastExit: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  private readonly elicitation?: ElicitationHandler;
  /** Aborts in-flight elicitation handlers when the connection closes. */
  private readonly lifeController = new AbortController();

  constructor(
    config: McpStdioServerConfig,
    opts: {
      /** Label used in debug lines (usually the configured server name). */
      name?: string;
      debug?: (msg: string) => void;
      /** Base environment; config.env is merged over it. Defaults to process.env. */
      env?: Record<string, string | undefined>;
      requestTimeoutMs?: number;
      /** Host handler answering server-initiated elicitation/create requests. */
      elicitation?: ElicitationHandler;
    } = {},
  ) {
    this.config = config;
    this.label = opts.name ?? config.command;
    this.debug = opts.debug ?? (() => {});
    this.baseEnv = opts.env ?? process.env;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.elicitation = opts.elicitation;
  }

  /** Spawn the server process and run the MCP initialize handshake. */
  async connect(signal?: AbortSignal): Promise<void> {
    if (this.closed) {
      throw new McpError(
        'mcp_connection_closed',
        `MCP stdio connection '${this.label}' is closed`,
        { serverLabel: this.label, transport: 'stdio', phase: 'connect' },
      );
    }
    if (this.child) {
      throw new McpError(
        'mcp_already_connected',
        `MCP stdio connection '${this.label}' is already connected`,
        { serverLabel: this.label, transport: 'stdio', phase: 'connect' },
      );
    }

    // Merged environment: config.env entries win over the inherited base env.
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(this.baseEnv)) {
      if (value !== undefined) env[key] = value;
    }
    Object.assign(env, this.config.env ?? {});

    // detached:true makes the server a process-GROUP leader on POSIX, so
    // close() can signal the whole tree (`process.kill(-pid)`) instead of only
    // the direct child. MCP servers are almost always launched through a
    // wrapper (`npx`/`cmd /c`/`uvx`/`python -m`/`node launcher`), whose real,
    // long-lived server is a GRANDCHILD; a bare `child.kill()` orphans it,
    // leaving inherited stdio handles open that keep the host from exiting on
    // interrupt/teardown. Harmless on Windows (taskkill /T reaps the tree by
    // pid regardless). stdio stays piped (no unref), so the handshake below is
    // unaffected — the same posture bash.ts / shells.ts already use.
    const child = spawn(this.config.command, this.config.args ?? [], {
      cwd: this.config.cwd,
      env,
      detached: true,
    });
    this.child = child;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.onStdout(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      const text = chunk.trim();
      if (text) this.debug(`[mcp:${this.label}] stderr: ${text}`);
    });
    // The READ halves need the same guard the stdin write half already has: an
    // 'error' event on an EventEmitter with no listener is re-thrown as an
    // UNCAUGHT exception, which kills the HOST process — not just this MCP
    // connection. A child stdio pipe errors whenever it is torn down abruptly
    // rather than closed cleanly (ECONNRESET/EPIPE/EIO on the pipe); the most
    // reliable trigger is close()'s own teardown, which on Windows reaps the
    // tree with `taskkill /T /F` and resets the still-open stdio pipes. One
    // misbehaving MCP server must never take the host down with it.
    child.stdout.on('error', (err: Error) => {
      this.debug(`[mcp:${this.label}] stdout error: ${err.message}`);
    });
    child.stderr.on('error', (err: Error) => {
      this.debug(`[mcp:${this.label}] stderr error: ${err.message}`);
    });
    // Prevent EPIPE on stdin from crashing the host process.
    child.stdin.on('error', (err: Error) => {
      this.debug(`[mcp:${this.label}] stdin error: ${err.message}`);
    });
    let everSpawned = false;
    child.once('spawn', () => {
      everSpawned = true;
    });
    child.on('error', (err: Error) => {
      // audit 2026-07-14 L-5: a spawn failure (ENOENT etc.) fires 'error' but
      // NOT 'exit', so without flipping closed state here the connection stays
      // nominally "open" — a later request() would write to a dead stdin and
      // hang for the full 60s request timeout. Mark it closed (mirrors the
      // 'exit' handler) and drop the child so subsequent request()/write()
      // fail FAST with mcp_not_connected.
      this.closed = true;
      // Drop the handle ONLY when the process never spawned: a post-spawn
      // 'error' (e.g. a kill() failure) can fire with the process still
      // alive, and nulling the handle then would defeat close()'s killTree
      // and orphan the server (audit 2026-07-17 L34 — the 'exit' handler
      // deliberately keeps the handle for the same reason).
      if (!everSpawned) this.child = null;
      this.failAllPending(
        new McpError(
          'mcp_process_error',
          `MCP server '${this.label}' process error: ${err.message}`,
          { serverLabel: this.label, transport: 'stdio' },
        ),
      );
    });
    child.on('exit', (code, sig) => {
      this.debug(
        `[mcp:${this.label}] process exited (code=${String(code)}, signal=${String(sig)})`,
      );
      // The exit code / signal is the one fact that tells a consumer WHY the
      // server died (127 = launcher could not find it, 1 = it crashed on its
      // own config, SIGKILL = the OOM killer). It used to reach the debug
      // channel only, so the surfaced error — 'exited before responding' —
      // was unactionable whenever debug was off (the default).
      this.lastExit = { code, signal: sig };
      // Fail fast for NEW requests, but do NOT reject pending ones yet
      // (audit r2 I3): a server that writes its final response and exits
      // immediately may still have that response sitting in the stdout pipe
      // buffer when 'exit' fires. 'close' fires only after the stdio streams
      // have flushed, so deferring the rejection there lets the buffered
      // response reach its waiter instead of being rejected as
      // mcp_server_exited and then dropped as an unknown late line.
      this.closed = true;
    });
    child.on('close', () => {
      this.closed = true;
      // Wave5-L7 (leak): a child that CRASHES mid-session fires 'close'
      // automatically WITHOUT anyone calling close(), so lifeController — the
      // only thing that aborts an in-flight server-initiated elicitation
      // handler — was never signalled. A host handler that ignores its signal
      // (or is awaiting user input) then runs forever, defeating WV4-2's race-
      // against-abort protection precisely in the crash case. Abort here so the
      // handler settles to decline on any process death, not only explicit
      // close(). Idempotent with close()'s abort.
      this.lifeController.abort();
      // Rmcp-1 (audit r4): a server that writes its final response WITHOUT a
      // trailing newline then exits leaves that response in stdoutBuffer — the
      // onStdout line loop only consumes up to '\n'. 'close' fires after stdio
      // has flushed, so parse the remnant as a complete final line here, BEFORE
      // failing pending, letting an already-delivered response resolve its
      // waiter instead of being rejected as mcp_server_exited (the http SSE
      // path got this as M10; stdio lacked it).
      this.flushStdout();
      this.failAllPending(
        new McpError(
          'mcp_server_exited',
          `MCP server '${this.label}' exited before responding${this.describeExit()}`,
          { serverLabel: this.label, transport: 'stdio' },
        ),
      );
    });

    const initResult = await this.request(
      'initialize',
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: this.elicitation ? { elicitation: {} } : {},
        clientInfo: CLIENT_INFO,
      },
      signal,
    );
    this.info = extractServerInfo(initResult);
    // audit r4 Z6-2: verify the negotiated protocol version is one we can speak
    // (spec: the client SHOULD disconnect otherwise). An absent version is
    // tolerated (keep our advertised default); an explicit unsupported one
    // fails connect, which connectEntry surfaces as a 'failed' status.
    negotiateProtocolVersion(initResult, this.label, 'stdio');
    this.sendNotification('notifications/initialized');
  }

  /** serverInfo from the initialize handshake (undefined before connect). */
  serverInfo(): { name: string; version: string } | undefined {
    return this.info;
  }

  /** tools/list with cursor pagination (shared drain, see protocol.ts). */
  listTools(signal?: AbortSignal): Promise<McpToolDescriptor[]> {
    return listToolsPaginated(
      (method, params, sig) => this.request(method, params, sig),
      this.label,
      this.debug,
      signal,
    );
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

  /** resources/list (single page); [] when the server has no resources support. */
  async listResources(signal?: AbortSignal): Promise<McpResource[]> {
    try {
      const result = await this.request('resources/list', {}, signal);
      return parseResourcesList(result);
    } catch (err) {
      if (err instanceof AbortError) throw err;
      this.debug(`[mcp:${this.label}] resources/list failed: ${String(err)}`);
      return [];
    }
  }

  /** resources/read for one uri. */
  async readResource(uri: string, signal?: AbortSignal): Promise<McpResourceContent[]> {
    const result = await this.request('resources/read', { uri }, signal);
    return parseResourceContents(result);
  }

  /** resources/directory/read: direct children of a directory resource. Errors
   *  propagate (a server without directory support rejects the request). */
  async readResourceDir(uri: string, signal?: AbortSignal): Promise<McpResource[]> {
    const result = await this.request('resources/directory/read', { uri }, signal);
    return parseResourcesList(result);
  }

  /** Terminate the child: SIGTERM, then SIGKILL after a short grace period. */
  async close(): Promise<void> {
    this.lifeController.abort();
    this.closed = true;
    this.failAllPending(
      new McpError(
        'mcp_connection_closed',
        `MCP stdio connection '${this.label}' closed`,
        { serverLabel: this.label, transport: 'stdio', phase: 'close' },
      ),
    );
    const child = this.child;
    this.child = null;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    // Terminate the server's WHOLE tree, platform-correctly (planProcessKill):
    // POSIX signals the process group (-pid); Windows uses taskkill /T /F.
    // A bare child.kill() reaps only the wrapper and orphans the real server
    // grandchild — the exact latent bug bash.ts / shells.ts already fixed.
    this.killTree(child, 'SIGTERM');
    const exited = await waitForExit(child, KILL_GRACE_MS);
    if (!exited) {
      this.killTree(child, 'SIGKILL');
      await waitForExit(child, KILL_GRACE_MS);
    }
  }

  /** Signal the child's whole process tree, platform-correctly. Best-effort:
   *  a benign failure (the tree already exited) goes to debug, never thrown —
   *  close() must stay non-fatal. Mirrors bash.ts's killGroup. */
  private winKilled = false;
  private killTree(child: ChildProcessWithoutNullStreams, sig: NodeJS.Signals): void {
    const plan = planProcessKill(child.pid, sig);
    try {
      if (plan.kind === 'group') {
        process.kill(-plan.pid, plan.signal as NodeJS.Signals); // win-ok: posix branch of planProcessKill
      } else if (plan.kind === 'child') {
        child.kill(plan.signal as NodeJS.Signals);
      } else {
        // Windows: one taskkill /T /F reaps the whole tree; firing it twice
        // (SIGTERM then SIGKILL escalation) is redundant, so guard it.
        if (this.winKilled) return;
        this.winKilled = true;
        const tk = spawn('taskkill', ['/PID', String(plan.pid), '/T', '/F'], {
          stdio: 'ignore',
        });
        tk.on('error', (e) =>
          this.debug(`[mcp:${this.label}] taskkill failed for pid ${plan.pid}: ${e.message}`),
        );
        tk.unref();
      }
    } catch (err) {
      this.debug(`[mcp:${this.label}] kill(${sig}) failed: ${errMessage(err)}`);
    }
  }

  // -- wire plumbing ---------------------------------------------------------

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    // W8-2: an unterminated line past the cap means the server is streaming
    // without a message boundary — drop the runaway buffer and log, rather
    // than accumulating to OOM. (A legitimate message is orders of magnitude
    // smaller; the next real `\n` re-syncs parsing.)
    if (this.stdoutBuffer.length > MAX_STDOUT_LINE_BYTES && !this.stdoutBuffer.includes('\n')) {
      this.debug(
        `[mcp:${this.label}] dropping ${this.stdoutBuffer.length}-byte stdout line with no newline (cap ${MAX_STDOUT_LINE_BYTES})`,
      );
      this.stdoutBuffer = '';
      return;
    }
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
      // Server-initiated elicitation/create: resolve via the host handler and
      // reply with the resulting action payload (fail-closed to 'decline').
      if (msg.method === 'elicitation/create') {
        // NOTE: no `&& this.elicitation` guard - resolveElicitation itself maps a
        // missing handler to { action: 'decline' } (the documented auto-decline);
        // guarding here made that branch dead and replied -32601 instead
        // (found by the batch-3 onElicitation test, 2026-07-05).
        const replyId = msg.id as JsonRpcId;
        // Handler failure and DELIVERY failure are distinct (audit r2 I7):
        // a thrown handler falls back to the documented auto-decline payload
        // BEFORE the single reply write; a failed write is only logged —
        // never answered again, since a second reply to the same JSON-RPC id
        // violates JSON-RPC and can contradict an already-delivered reply.
        // Mirrors http.ts.
        void resolveElicitation(msg.params, this.elicitation, this.lifeController.signal)
          .catch(() => ({ action: 'decline' as const }))
          .then((result) => this.write({ jsonrpc: '2.0', id: replyId, result }))
          .catch((err: unknown) => {
            this.debug(
              `[mcp:${this.label}] elicitation reply failed: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          });
        return;
      }
      // Other server-initiated requests: this client implements no server-
      // callable methods, so answer with JSON-RPC "method not found".
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
        reject(
          new McpError(
            'mcp_not_connected',
            `MCP stdio connection '${this.label}' is not open`,
            { serverLabel: this.label, transport: 'stdio', phase: 'request' },
          ),
        );
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
      const onAbort = (): void => {
        // Rmcp-2 (audit r4): tell the server to stop before we walk away.
        if (!settled) this.sendCancellation(id, method);
        finish(() => reject(new AbortError()));
      };
      const timer = setTimeout(() => {
        if (!settled) this.sendCancellation(id, method);
        finish(() =>
          reject(
            new McpError(
              'mcp_request_timeout',
              `MCP request '${method}' to server '${this.label}' timed out after ${this.requestTimeoutMs}ms`,
              {
                serverLabel: this.label,
                transport: 'stdio',
                phase: 'request',
                timeoutMs: this.requestTimeoutMs,
              },
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
      throw new McpError(
        'mcp_not_connected',
        `MCP stdio connection '${this.label}' is not open`,
        { serverLabel: this.label, transport: 'stdio', phase: 'request' },
      );
    }
    child.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  /** Best-effort MCP cancellation (Rmcp-2, audit r4): tell the server to stop
   *  working on a request we abandoned (timeout/abort) so it does not keep
   *  computing and then emit a late response that lands on no waiter. The
   *  initialize request MUST NOT be cancelled this way (MCP spec); a dead child
   *  is skipped. */
  private sendCancellation(id: JsonRpcId, method: string): void {
    if (method === 'initialize' || this.closed || !this.child) return;
    try {
      this.write({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: id, reason: 'client cancelled the request' },
      });
    } catch {
      // Best-effort: the child may already be gone.
    }
  }

  /** Parse any newline-less remnant left in stdoutBuffer as one final line
   *  (Rmcp-1, audit r4). Idempotent: an empty buffer is a no-op. */
  private flushStdout(): void {
    const line = this.stdoutBuffer.trim();
    this.stdoutBuffer = '';
    if (!line) return;
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(line) as JsonRpcMessage;
    } catch {
      this.debug(`[mcp:${this.label}] ignoring non-JSON stdout remnant at EOF`);
      return;
    }
    this.dispatch(msg);
  }

  /** ` (exit code N)` / ` (killed by SIGTERM)` — empty when the process death
   *  carried neither (no 'exit' seen, e.g. a pre-spawn failure). */
  private describeExit(): string {
    const e = this.lastExit;
    if (e === null) return '';
    if (e.signal !== null) return ` (killed by ${e.signal})`;
    if (e.code !== null) return ` (exit code ${e.code})`;
    return '';
  }

  private failAllPending(err: Error): void {
    const entries = [...this.pending.values()];
    this.pending.clear();
    for (const entry of entries) entry.reject(err);
  }
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
