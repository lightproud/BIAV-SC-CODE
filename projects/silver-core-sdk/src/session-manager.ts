/**
 * SessionManager (SM-甲): in-process shared coordination across conversations.
 *
 * Implements 职责一 of the approved proposal
 * (Public-Info-Pool/Resource/proposal/bpt-sdk-session-manager-20260706.md):
 * one shared AnthropicTransport + one shared MCP registry per manager, with
 * every mgr.query() borrowing both instead of constructing its own
 * (the src/query.ts:384/:492 lift). BPT-EXTENSION — the official SDK has no
 * in-process multi-conversation coordinator.
 *
 * Lifecycle contract (§4.2, the design's #1 correctness constraint):
 *   - the MANAGER owns the shared connections (connectAll once, coalesced);
 *   - queries BORROW and never close them (query.ts guards every closeAll
 *     site with `ownsMcp`);
 *   - mgr.close() is the single teardown point; after close(), mgr.query()
 *     throws ConfigurationError.
 *
 * 职责二 (persistence + supervision, §5/§6) belongs to SM-乙: this file only
 * leaves the seams — `options.recovery` is typed-but-inert and runManaged()
 * is the single wrap point where the supervision loop will land.
 */

import process from 'node:process';
import { randomUUID } from 'node:crypto';

import { APIStatusError, ConfigurationError, errorCodeOf, isAbortError } from './errors.js';
import { createProviderTransport } from './transport/factory.js';
import { DefaultMcpRegistry } from './mcp/registry.js';
import { loadProjectMcpServers } from './mcp/project-config.js';
import { query } from './query.js';
import type { McpRegistry, McpToolEntry } from './internal/contracts.js';
import type {
  CallToolResult,
  McpResource,
  McpResourceContent,
  McpServerConfig,
  McpServerStatus,
  ModelUsage,
  NonNullableUsage,
  Options,
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKStatusMessage,
  SDKUserMessage,
  SessionManager,
  SessionManagerOptions,
  SessionManagerUsage,
} from './types.js';

// ---------------------------------------------------------------------------
// Usage accounting
// ---------------------------------------------------------------------------

/** An input stream that closes immediately: a resume re-drive replays nothing
 *  from the caller — the resumed query's §5.2 redrive continues the
 *  interrupted turn from the persisted transcript, then the empty stream ends
 *  the run. */
async function* emptyInputStream(): AsyncGenerator<SDKUserMessage, void> {
  // Intentionally yields nothing.
}

const zeroUsage = (): NonNullableUsage => ({
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
});

function addUsage(a: NonNullableUsage, b: NonNullableUsage): NonNullableUsage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_creation_input_tokens:
      a.cache_creation_input_tokens + b.cache_creation_input_tokens,
    cache_read_input_tokens: a.cache_read_input_tokens + b.cache_read_input_tokens,
  };
}

/** Additive merge of one per-model usage map into an accumulator (same
 *  semantics as query.ts's session accumulator: counters add, static
 *  per-model figures latest-wins with fallback). */
function mergeModelUsage(
  into: Record<string, ModelUsage>,
  from: Record<string, ModelUsage>,
): void {
  for (const [modelId, mu] of Object.entries(from)) {
    const prev = into[modelId];
    into[modelId] =
      prev === undefined
        ? { ...mu }
        : {
            inputTokens: prev.inputTokens + mu.inputTokens,
            outputTokens: prev.outputTokens + mu.outputTokens,
            cacheReadInputTokens: prev.cacheReadInputTokens + mu.cacheReadInputTokens,
            cacheCreationInputTokens:
              prev.cacheCreationInputTokens + mu.cacheCreationInputTokens,
            webSearchRequests: prev.webSearchRequests + mu.webSearchRequests,
            costUSD: prev.costUSD + mu.costUSD,
            contextWindow: mu.contextWindow ?? prev.contextWindow,
            maxOutputTokens: mu.maxOutputTokens ?? prev.maxOutputTokens,
          };
  }
}

/**
 * Per-conversation ledger. Result messages carry two reporting semantics
 * (E2/KD-L5-04): `usage` is THAT turn's own figures (summed here), while
 * `total_cost_usd` / `modelUsage` are cumulative PER QUERY RUN (latest snapshot
 * wins here). Within one run "latest wins" is exact; across a transparent
 * auto-resume the fresh run's accumulator restarts at 0, so the supervised
 * path adds a base offset of the swallowed runs' spend (audit 2026-07-14 M-7).
 * usage() folds the ledgers at read time.
 */
type QueryLedger = {
  usage: NonNullableUsage;
  costUsd: number;
  modelUsage: Record<string, ModelUsage>;
};

/** The error arm of the SDKResultMessage union (carries error_code /
 *  api_error_status / errorMessage — the fields supervision classifies on). */
type SDKResultErrorMessage = Exclude<SDKResultMessage, { subtype: 'success' }>;

// ---------------------------------------------------------------------------
// Shared registry facade
// ---------------------------------------------------------------------------

/**
 * Manager-owned view of the shared DefaultMcpRegistry handed to every managed
 * query. Two jobs:
 *
 * 1. connect-once latch: connectAll() coalesces every caller (the manager's
 *    constructor kick-off AND each query's own connect barrier) onto ONE
 *    in-flight connect, so a query starting while the manager is still
 *    connecting can never double-spawn a stdio server or double-open an HTTP
 *    session.
 * 2. defense-in-depth on the lifecycle contract: borrowers cannot tear the
 *    shared pool down. query.ts's `ownsMcp` guard is the primary protection
 *    (a managed query never calls closeAll); this facade additionally makes
 *    closeAll() a no-op and setServers() an explicit ConfigurationError, so
 *    even a Query.setMcpServers() control call cannot dismantle connections
 *    that sibling conversations are multiplexing. Teardown authority lives in
 *    SessionManager.close() alone, which closes the INNER registry directly.
 */
class SharedMcpRegistry implements McpRegistry {
  private connectOnce: Promise<void> | null = null;

  constructor(
    private readonly inner: DefaultMcpRegistry,
    private readonly debug: (msg: string) => void,
  ) {}

  connectAll(): Promise<void> {
    this.connectOnce ??= this.inner.connectAll();
    return this.connectOnce;
  }
  statuses(): McpServerStatus[] {
    return this.inner.statuses();
  }
  allTools(): McpToolEntry[] {
    return this.inner.allTools();
  }
  has(qualifiedName: string): boolean {
    return this.inner.has(qualifiedName);
  }
  call(
    qualifiedName: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<CallToolResult> {
    return this.inner.call(qualifiedName, args, signal);
  }
  listResources(server: string | undefined, signal: AbortSignal): Promise<McpResource[]> {
    return this.inner.listResources(server, signal);
  }
  readResource(server: string, uri: string, signal: AbortSignal): Promise<McpResourceContent[]> {
    return this.inner.readResource(server, uri, signal);
  }
  readResourceDir(server: string, uri: string, signal: AbortSignal): Promise<McpResource[]> {
    return this.inner.readResourceDir(server, uri, signal);
  }
  reconnect(serverName: string): Promise<void> {
    // Reconnect is shared RECOVERY (a failed server is failed for every
    // borrower; reconnecting fixes it for all), not a per-session preference —
    // safe to pass through.
    return this.inner.reconnect(serverName);
  }
  setEnabled(serverName: string, enabled: boolean): void {
    // enable/disable is a per-SESSION preference, but the registry is SHARED:
    // passing it through would enable/disable the server for every sibling
    // conversation (one session's toggleMcpServer(name,false) blanks the tool
    // for all of them). The shared layer cannot offer per-session views, so —
    // like setServers — this is refused loudly rather than leaked silently.
    throw new ConfigurationError(
      'toggleMcpServer / setEnabled is not available on a SessionManager-managed ' +
        'query: the MCP server set is shared across sibling conversations, so a ' +
        'per-session enable/disable would affect them all. Configure servers on ' +
        'createBptSession.',
    );
  }
  setServers(): Promise<void> {
    // setServers() internally closes every connection before swapping the set
    // — from a borrower that is exactly the #1 red line, so it is refused
    // loudly rather than ignored quietly.
    return Promise.reject(
      new ConfigurationError(
        'setMcpServers is not available on a SessionManager-managed query: ' +
          'the MCP server set is owned by the shared layer (configure it on ' +
          'createBptSession).',
      ),
    );
  }
  closeAll(): Promise<void> {
    // Borrowers never tear down the shared pool (lifecycle contract §4.2).
    this.debug(
      '[session-manager] closeAll() ignored on the shared MCP registry ' +
        '(manager-owned; use SessionManager.close())',
    );
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// createBptSession()
// ---------------------------------------------------------------------------

/**
 * Create a SessionManager: the in-process coordinator sharing one transport +
 * one MCP connection pool across many query() conversations (BPT-EXTENSION,
 * proposal 层一 职责一). See the SessionManager interface JSDoc in types.ts
 * for the API contract.
 */
export function createBptSession(options: SessionManagerOptions = {}): SessionManager {
  const { recovery, ...base } = options;

  const cwd = base.cwd ?? process.cwd();
  const env: Record<string, string | undefined> = base.env ?? process.env;
  const debugEnabled = base.debug === true;
  const stderrCb = base.stderr;
  const debug = (msg: string): void => {
    if (!debugEnabled) return;
    const line = `[silver-core-sdk] ${msg}\n`;
    if (stderrCb !== undefined) stderrCb(line);
    else process.stderr.write(line);
  };

  // --- Shared collaborators (§4.1) -----------------------------------------
  // One transport per manager: a stateless requester (each stream() call is an
  // independent fetch+SSE holding only config), safe to share across
  // concurrent conversations.
  const transport = createProviderTransport({
    provider: base.provider,
    env,
    debug,
    betas: base.betas,
  });
  // One MCP registry per manager: same merge the standalone query() performs
  // (project .mcp.json under explicit mcpServers), built once, connected once.
  // Responses are request-id correlated, so cross-conversation concurrency
  // multiplexes without cross-talk (§4.1).
  const projectServers = loadProjectMcpServers(cwd, base.settingSources, debug);
  const mergedServers: Record<string, McpServerConfig> = {
    ...projectServers,
    ...(base.mcpServers ?? {}),
  };
  const registry = new DefaultMcpRegistry({
    servers: mergedServers,
    env,
    debug,
    elicitation: base.onElicitation,
  });
  const shared = new SharedMcpRegistry(registry, debug);
  // Kick the shared connect off at construction; connectAll never throws
  // (per-server failures land in statuses). Queries' own connect barriers
  // coalesce onto this same promise via the facade latch.
  void shared.connectAll();

  // --- Manager state ---------------------------------------------------------
  let closed = false;
  const ledgers: QueryLedger[] = [];
  // L61 (audit 2026-07-17): ledgers of FINISHED queries fold into this settled
  // aggregate and are evicted, so a long-lived manager's memory no longer
  // grows with its lifetime query count. usage() = settled + live ledgers.
  let settledCount = 0;
  let settledCostUsd = 0;
  let settledUsage = zeroUsage();
  const settledModelUsage: Record<string, ModelUsage> = {};
  const settleLedger = (ledger: QueryLedger): void => {
    const idx = ledgers.indexOf(ledger);
    if (idx === -1) return; // already settled (done fires once, but be safe)
    ledgers.splice(idx, 1);
    settledCount += 1;
    settledCostUsd += ledger.costUsd;
    settledUsage = addUsage(settledUsage, ledger.usage);
    mergeModelUsage(settledModelUsage, ledger.modelUsage);
  };

  /** Validate + assemble the effective options for one managed query.
   *  Per-query options override per-conversation knobs; provider/mcpServers
   *  come from the shared layer only (D1). */
  function managedOptions(perQuery: Options | undefined): Options {
    if (perQuery?.provider !== undefined) {
      throw new ConfigurationError(
        "SessionManager.query: per-query 'provider' is not supported — the " +
          'transport is shared and configured once on createBptSession().',
      );
    }
    if (perQuery?.mcpServers !== undefined) {
      throw new ConfigurationError(
        "SessionManager.query: per-query 'mcpServers' is not supported (D1) — " +
          'MCP servers come from the shared pool configured on ' +
          'createBptSession(); a private per-query MCP overlay is deferred to v2.',
      );
    }
    const merged: Options = { ...base, ...perQuery };
    // The registry is injected; the query must not re-merge a server set of
    // its own (query.ts also short-circuits this on the borrowed path).
    delete merged.mcpServers;
    return merged;
  }

  /** Fold one result message into this conversation's ledger. The update is
   *  a synchronous single-tick read-modify-write — JS's run-to-completion
   *  semantics make it atomic (the serialization §4.1 asks of the aggregate
   *  ledger). Do not introduce an await between the reads and writes. */
  function record(ledger: QueryLedger, r: SDKResultMessage): void {
    ledger.usage = addUsage(ledger.usage, r.usage); // per-turn figures: sum
    ledger.costUsd = r.total_cost_usd; // conversation-cumulative: latest wins
    const snapshot: Record<string, ModelUsage> = {};
    mergeModelUsage(snapshot, r.modelUsage); // deep copy
    ledger.modelUsage = snapshot; // conversation-cumulative: latest wins
  }

  /** Wrap a managed query so its result stream feeds the usage ledger while
   *  every control method delegates to the underlying Query untouched. */
  function instrumentUsage(q: Query, ledger: QueryLedger): Query {
    const wrapped: Query = {
      ...q,
      next: async (
        ...nextArgs: [] | [unknown]
      ): Promise<IteratorResult<SDKMessage, void>> => {
        let r: IteratorResult<SDKMessage, void>;
        try {
          r = await q.next(...nextArgs);
        } catch (err) {
          settleLedger(ledger); // the generator is finished (threw)
          throw err;
        }
        if (r.done === true) {
          settleLedger(ledger);
        } else if (r.value.type === 'result') {
          record(ledger, r.value);
        }
        return r;
      },
      return: async (value) => {
        const r = await q.return(value);
        settleLedger(ledger);
        return r;
      },
      throw: (err?: unknown) => q.throw(err),
      [Symbol.asyncIterator](): Query {
        return wrapped;
      },
    };
    return wrapped;
  }

  /**
   * §6.1 recovery decision — classification is by the stable machine `code`
   * (E6c) / HTTP status, never by message text.
   *   - recoverable: APIConnectionError (network / malformed SSE / idle
   *     watchdog), MCP connection-class McpError, APIStatusError 429 or >=500
   *     (transport already exhausted its own retries before surfacing);
   *   - terminal: AbortError (user), ConfigurationError, NotImplementedError,
   *     APIStatusError 4xx (non-429), and — fail-closed — any UNKNOWN /
   *     codeless failure (never auto-resumed).
   */
  function isRecoverableCode(code: string | undefined): boolean {
    switch (code) {
      case 'api_connection_failed':
      case 'sse_malformed_frame':
      case 'stream_idle_timeout':
      case 'mcp_connect_timeout':
      case 'mcp_connection_closed':
      case 'mcp_server_exited':
      case 'mcp_process_error':
        return true;
      default:
        // Fail-closed: an unknown / codeless failure is never auto-resumed.
        return false;
    }
  }

  /** Classify a THROWN error. AbortError is the only failure this engine throws
   *  to the query layer; API/connection failures surface as error RESULTS
   *  (classified by isRecoverableResult). */
  function isRecoverableError(err: unknown): boolean {
    if (isAbortError(err)) return false;
    if (err instanceof APIStatusError) return err.status === 429 || err.status >= 500;
    return isRecoverableCode(errorCodeOf(err));
  }

  /** Classify an is_error RESULT (the engine's actual API-failure surface):
   *  by HTTP status when present (429|>=500 recoverable, other 4xx terminal),
   *  else by the stable error_code the engine stamps on the result. */
  function isRecoverableResult(r: SDKResultErrorMessage): boolean {
    if (r.api_error_status !== undefined) {
      return r.api_error_status === 429 || r.api_error_status >= 500;
    }
    return isRecoverableCode(r.error_code);
  }

  /** §6.2 observability: one status message per auto-resume, carrying the
   *  attempt count and the classified failure so the resume leaves a trace in
   *  the consumer's own message stream (SDKStatusMessage — an existing
   *  observability variant, no new type). */
  function resumeObservation(
    sessionId: string,
    attempt: number,
    maxResumes: number,
    code: string,
    reason: string,
  ): SDKStatusMessage {
    return {
      type: 'system',
      subtype: 'status',
      uuid: randomUUID(),
      session_id: sessionId,
      status: 'auto-resume',
      details: { attempt, maxResumes, code, reason },
    };
  }

  /**
   * Single wrap point for every managed query run. When `supervise` is off
   * (no store, streaming input, or autoResume:false) this only instruments
   * usage — behaviourally identical to SM-甲.
   *
   * When on, it merges usage instrumentation with the §6 supervision loop into
   * ONE wrapped generator. DESIGN RECORD: the engine surfaces API / connection
   * failures as an is_error RESULT message (only AbortError is thrown), so
   * supervision keys off recoverable error RESULTS, not only throws:
   *   - a recoverable error result is SWALLOWED (not forwarded); a status
   *     observation is emitted and `start` is re-invoked with a resume arg so
   *     the §5.2 redrive continues the interrupted turn — up to `maxResumes`;
   *   - a terminal error result is FORWARDED unchanged (the honest terminal
   *     outcome), never resumed;
   *   - on exhaustion the last recoverable error result is forwarded with a
   *     `resumeAttempts` field attached (the result-surface analog of the
   *     spec's "rethrow with resumeAttempts" — preserving the engine's
   *     result-not-throw surface keeps managed and standalone consumers
   *     interoperable);
   *   - a genuine THROW (AbortError) is rethrown, with `resumeAttempts`
   *     attached iff at least one resume was tried.
   * Standalone query() is untouched (no manager, no supervision).
   */
  function runManaged(
    start: (resume?: { sessionId: string }) => Query,
    ledger: QueryLedger,
    supervise: boolean,
  ): Query {
    let q = start();
    if (!supervise) {
      return instrumentUsage(q, ledger);
    }

    const maxResumes = recovery?.maxResumes ?? 2;
    let sessionId: string | undefined;
    let attempts = 0;
    // audit 2026-07-14 L-7: whether the FIRST system/init already reached the
    // consumer. A transparent auto-resume starts a fresh query() run that
    // re-emits its own init; only the first one is forwarded (see below).
    let initForwarded = false;
    // Status observations queued to surface (in the consumer's stream) just
    // before the retried query's first message.
    const observations: SDKMessage[] = [];

    // audit 2026-07-14 M-7: `total_cost_usd` / `modelUsage` are cumulative PER
    // QUERY RUN, but a transparent resume starts a FRESH run whose accumulator
    // restarts at 0 — plain "latest wins" recording would let the post-resume
    // snapshot OVERWRITE the pre-resume spend and under-report mgr.usage().
    // So the supervised path keeps a base offset: each swallowed recoverable
    // error result folds its cumulative figures into the base, and every
    // recorded snapshot is accounted as base + latest. (`usage` needs no base:
    // each result's usage covers only its own run, and record() already SUMS
    // it — that semantics is preserved below.)
    let costBase = 0;
    const modelUsageBase: Record<string, ModelUsage> = {};

    /** Base-aware record(): same single-tick read-modify-write discipline. */
    const recordSupervised = (r: SDKResultMessage): void => {
      ledger.usage = addUsage(ledger.usage, r.usage); // per-turn figures: sum
      ledger.costUsd = costBase + r.total_cost_usd; // swallowed runs + latest run
      const snapshot: Record<string, ModelUsage> = {};
      mergeModelUsage(snapshot, modelUsageBase);
      mergeModelUsage(snapshot, r.modelUsage);
      ledger.modelUsage = snapshot;
    };

    /** Fold a swallowed run's cumulative spend into the base (called exactly
     *  once per swallowed error result, right before the resume re-drive). */
    const foldIntoBase = (r: SDKResultMessage): void => {
      costBase += r.total_cost_usd;
      mergeModelUsage(modelUsageBase, r.modelUsage);
    };

    /** Arm a transparent resume: emit the observation, re-drive, bump count. */
    const scheduleResume = async (code: string, reason: string): Promise<void> => {
      attempts += 1;
      debug(
        `[session-manager] auto-resume ${attempts}/${maxResumes} ` +
          `(session ${sessionId}, code ${code})`,
      );
      observations.push(
        resumeObservation(sessionId!, attempts, maxResumes, code, reason),
      );
      // Retire the abandoned query FIRST: after a recoverable error RESULT it
      // is suspended at the yield that surfaced that result, so its run()
      // finally (background-shell teardown, sandbox tmpdir removal, subagent
      // settle, SessionEnd hooks, session-store flush) never runs unless we
      // drive it to completion. The store flush in particular must land
      // BEFORE the resumed query re-reads the persisted history (audit
      // 2026-07-14 H-2). On the throw path the generator already completed,
      // where return() is a harmless no-op.
      try {
        await q.return(undefined);
      } catch (err) {
        // Retiring failed: the abandoned run's finally (session-store flush
        // included) may NOT have completed, so the "flush before the resumed
        // query re-reads history" guarantee (audit 2026-07-14 H-2) is not
        // assured for this resume. A debug line alone hid that from the
        // consumer (audit 2026-07-17 L73) — surface a status observation so
        // the host can see the resume ran degraded.
        const msg = err instanceof Error ? err.message : String(err);
        debug(`[session-manager] retiring the interrupted query failed: ${msg}`);
        observations.push({
          type: 'system',
          subtype: 'status',
          uuid: randomUUID(),
          session_id: sessionId!,
          status: 'auto-resume-degraded',
          details: {
            attempt: attempts,
            maxResumes,
            code: 'teardown_failed',
            reason:
              `retiring the interrupted query failed (${msg}); the resumed ` +
              `history may miss that run's final flush`,
          },
        });
      }
      // No prompt is re-sent (the resumed query's §5.2 redrive continues the
      // interrupted turn against the persisted history).
      q = start({ sessionId: sessionId! });
    };

    const wrapped: Query = {
      async next(
        ...nextArgs: [] | [unknown]
      ): Promise<IteratorResult<SDKMessage, void>> {
        for (;;) {
          const obs = observations.shift();
          if (obs !== undefined) return { done: false, value: obs };

          let r: IteratorResult<SDKMessage, void>;
          try {
            r = await q.next(...nextArgs);
          } catch (err) {
            // The engine throws only AbortError (terminal); classify anyway.
            if (
              isRecoverableError(err) &&
              sessionId !== undefined &&
              attempts < maxResumes
            ) {
              await scheduleResume(
                errorCodeOf(err) ?? 'unknown',
                err instanceof Error ? err.message : String(err),
              );
              continue;
            }
            settleLedger(ledger); // terminal throw: the run is finished
            if (attempts > 0 && err !== null && typeof err === 'object') {
              throw Object.assign(err, { resumeAttempts: attempts });
            }
            throw err;
          }

          if (r.done === true) {
            settleLedger(ledger);
            return r;
          }

          const v = r.value;
          if (v.type === 'system' && v.subtype === 'init') {
            sessionId = v.session_id;
            // audit 2026-07-14 L-7: after a transparent auto-resume the
            // resumed query re-emits its own system/init. Forwarding that
            // SECOND init would make a downstream UI that treats init as a
            // session boundary render a ghost "new session" for what the
            // supervisor promised is ONE continuous session. The session_id
            // was already read above for internal use; swallow every init
            // after the first and keep fetching the next message.
            if (initForwarded) continue;
            initForwarded = true;
          }

          // The `subtype` discriminant (not is_error) narrows to the error arm.
          if (v.type === 'result' && v.subtype !== 'success') {
            recordSupervised(v);
            if (
              isRecoverableResult(v) &&
              sessionId !== undefined &&
              attempts < maxResumes
            ) {
              // Swallow this error result and re-drive transparently. Its
              // cumulative spend goes into the base FIRST (audit 2026-07-14
              // M-7): the resumed run restarts its accumulator at 0, so
              // without the fold its first result would overwrite this run's
              // spend in the ledger.
              foldIntoBase(v);
              await scheduleResume(
                v.error_code ?? `http_${v.api_error_status ?? 'error'}`,
                v.errorMessage ?? 'recoverable error',
              );
              continue;
            }
            // Terminal or exhausted: forward the result, annotated with the
            // resume scene when at least one resume was tried.
            if (attempts > 0) {
              return {
                done: false,
                value: Object.assign({ ...v }, { resumeAttempts: attempts }) as SDKMessage,
              };
            }
            return r;
          }

          if (v.type === 'result') recordSupervised(v);
          return r;
        }
      },
      // Iterator + control plane all delegate to the CURRENT q (it is
      // reassigned on each transparent resume), so a consumer that calls
      // return()/throw()/interrupt()/... after a resume reaches the live query,
      // not the abandoned one.
      return: async (value) => {
        const r = await q.return(value);
        settleLedger(ledger);
        return r;
      },
      throw: (err?: unknown) => q.throw(err),
      [Symbol.asyncIterator](): Query {
        return wrapped;
      },
      interrupt: () => q.interrupt(),
      setPermissionMode: (mode) => q.setPermissionMode(mode),
      setModel: (model) => q.setModel(model),
      setMaxThinkingTokens: (n) => q.setMaxThinkingTokens(n),
      initializationResult: () => q.initializationResult(),
      supportedCommands: () => q.supportedCommands(),
      supportedModels: () => q.supportedModels(),
      supportedAgents: () => q.supportedAgents(),
      mcpServerStatus: () => q.mcpServerStatus(),
      accountInfo: () => q.accountInfo(),
      reconnectMcpServer: (name) => q.reconnectMcpServer(name),
      toggleMcpServer: (name, enabled) => q.toggleMcpServer(name, enabled),
      setMcpServers: (servers) => q.setMcpServers(servers),
      rewindFiles: (id, opts) => q.rewindFiles(id, opts),
      stopTask: (taskId) => q.stopTask(taskId),
      setRetainedRegion: (region) => q.setRetainedRegion(region),
      removeRetainedRegion: (id) => q.removeRetainedRegion(id),
      streamInput: (stream) => q.streamInput(stream),
      close: () => q.close(),
    };
    return wrapped;
  }

  const mgr: SessionManager = {
    query(queryArgs: {
      prompt: string | AsyncIterable<SDKUserMessage>;
      options?: Options;
    }): Query {
      if (closed) {
        throw new ConfigurationError(
          'SessionManager is closed: its shared connections were torn down. ' +
            'Create a new manager with createBptSession().',
        );
      }
      const effective = managedOptions(queryArgs.options);
      const ledger: QueryLedger = {
        usage: zeroUsage(),
        costUsd: 0,
        modelUsage: {},
      };
      ledgers.push(ledger);
      // §6.2 activation gate: supervise only when a store is attached (nowhere
      // to resume from otherwise, R2), autoResume is not disabled, and the
      // prompt is a string (v1 scope — a streaming-input conversation owns its
      // own input channel and is not supervised).
      const supervise =
        effective.sessionStore !== undefined &&
        recovery?.autoResume !== false &&
        typeof queryArgs.prompt === 'string';
      return runManaged(
        (resume) =>
          query({
            // On a resume re-drive no prompt is re-sent: an immediately-closing
            // input stream lets the resumed query's §5.2 redrive continue the
            // interrupted turn, then end.
            prompt: resume !== undefined ? emptyInputStream() : queryArgs.prompt,
            options:
              resume !== undefined
                ? { ...effective, resume: resume.sessionId }
                : effective,
            _internal: { transport, mcpRegistry: shared },
          }),
        ledger,
        supervise,
      );
    },

    usage(): SessionManagerUsage {
      let totalCostUsd = settledCostUsd;
      let usage = addUsage(zeroUsage(), settledUsage);
      const modelUsage: Record<string, ModelUsage> = {};
      mergeModelUsage(modelUsage, settledModelUsage);
      for (const ledger of ledgers) {
        totalCostUsd += ledger.costUsd;
        usage = addUsage(usage, ledger.usage);
        mergeModelUsage(modelUsage, ledger.modelUsage);
      }
      return {
        totalCostUsd,
        usage,
        modelUsage,
        queries: settledCount + ledgers.length,
      };
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      // Unified teardown (§4.2): the manager closes the INNER registry
      // directly — the facade's closeAll is a borrower-facing no-op. The
      // shared transport holds no open resources between calls (stateless
      // requester), so there is nothing further to release.
      await registry.closeAll();
    },
  };

  return mgr;
}

// ---------------------------------------------------------------------------
// runConcurrent — the missing "drive N conversations in parallel" helper
// ---------------------------------------------------------------------------

/** One conversation to run: the same args shape as SessionManager.query(). */
export type ManagedTask = {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
};

/** Outcome of one task in runConcurrent, tagged by its input index. */
export type RunConcurrentOutcome = {
  /** Index into the input `tasks` array (results are index-tagged, not
   *  completion-ordered). */
  index: number;
  /** The conversation's terminal result message, or null if it produced none
   *  (e.g. the drive threw before any result). */
  result: SDKResultMessage | null;
  /** All messages, in order — only when `collectMessages` is set (off by
   *  default to keep memory flat for large fan-outs). */
  messages?: SDKMessage[];
  /** Set when driving this conversation threw (the batch never rejects — one
   *  bad task does not sink its siblings). */
  error?: unknown;
};

/**
 * Drive many managed conversations CONCURRENTLY over one SessionManager, at most
 * `concurrency` in flight at a time. This is the helper that closes the
 * pull-driven footgun: `SessionManager.query()` only advances when its iterator
 * is pulled, so `for (const t of tasks) { for await (…mgr.query(t)) {} }` runs
 * them SEQUENTIALLY even though the manager supports true parallelism. This
 * function pulls up to `concurrency` iterators at once, so the conversations
 * actually overlap on the shared transport + MCP pool.
 *
 * Failure isolation: a task whose drive throws resolves to an outcome with
 * `error` set (and `result: null`); the batch as a whole never rejects. Results
 * are returned index-aligned with `tasks`, regardless of completion order.
 *
 * `concurrency` defaults to min(tasks.length, 8). Pair it with the transport's
 * `maxConcurrentRequests` (provider-level) so a large fan-out does not thrash
 * the API rate limit — this bounds *conversations*, that bounds *requests*.
 */
export async function runConcurrent(
  mgr: SessionManager,
  tasks: ManagedTask[],
  opts?: {
    concurrency?: number;
    collectMessages?: boolean;
    /** Observe every message as it arrives, tagged by task index. */
    onMessage?: (index: number, message: SDKMessage) => void;
  },
): Promise<RunConcurrentOutcome[]> {
  const outcomes = new Array<RunConcurrentOutcome>(tasks.length);
  const collect = opts?.collectMessages === true;
  const onMessage = opts?.onMessage;
  const concurrency = Math.max(
    1,
    Math.min(opts?.concurrency ?? 8, tasks.length || 1),
  );

  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= tasks.length) return;
      const task = tasks[index]!;
      const messages: SDKMessage[] = [];
      let result: SDKResultMessage | null = null;
      try {
        for await (const message of mgr.query(task)) {
          if (onMessage) onMessage(index, message);
          if (collect) messages.push(message);
          if (message.type === 'result') result = message;
        }
        outcomes[index] = collect ? { index, result, messages } : { index, result };
      } catch (error) {
        outcomes[index] = collect
          ? { index, result, messages, error }
          : { index, result, error };
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return outcomes;
}
