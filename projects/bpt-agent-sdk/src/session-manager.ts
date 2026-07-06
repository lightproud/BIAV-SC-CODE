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

import { ConfigurationError } from './errors.js';
import { AnthropicTransport } from './transport/anthropic.js';
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
  SDKUserMessage,
  SessionManager,
  SessionManagerOptions,
  SessionManagerUsage,
} from './types.js';

// ---------------------------------------------------------------------------
// Usage accounting
// ---------------------------------------------------------------------------

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
 * `total_cost_usd` / `modelUsage` are conversation-cumulative (latest snapshot
 * wins here). usage() folds the ledgers at read time.
 */
type QueryLedger = {
  usage: NonNullableUsage;
  costUsd: number;
  modelUsage: Record<string, ModelUsage>;
};

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
  reconnect(serverName: string): Promise<void> {
    return this.inner.reconnect(serverName);
  }
  setEnabled(serverName: string, enabled: boolean): void {
    this.inner.setEnabled(serverName, enabled);
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
    const line = `[bpt-agent-sdk] ${msg}\n`;
    if (stderrCb !== undefined) stderrCb(line);
    else process.stderr.write(line);
  };

  if (recovery !== undefined) {
    debug(
      'options.recovery is accepted but has no effect yet: supervision lands ' +
        'in the next batch (SM-乙b)',
    );
  }

  // --- Shared collaborators (§4.1) -----------------------------------------
  // One transport per manager: a stateless requester (each stream() call is an
  // independent fetch+SSE holding only config), safe to share across
  // concurrent conversations.
  const transport = new AnthropicTransport({
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
        const r = await q.next(...nextArgs);
        if (r.done !== true && r.value.type === 'result') {
          record(ledger, r.value);
        }
        return r;
      },
      return: (value) => q.return(value),
      throw: (err?: unknown) => q.throw(err),
      [Symbol.asyncIterator](): Query {
        return wrapped;
      },
    };
    return wrapped;
  }

  /**
   * Single wrap point for every managed query run (the SM-乙b seam).
   *
   * SM-乙b (supervision/auto-resume, proposal §6) lands HERE in the next
   * batch: it will wrap `start` in a bounded supervision loop — classify the
   * failure via the stable error codes, re-invoke `start` with resume
   * arguments up to recovery.maxResumes, and emit observability messages.
   * SM-甲 only instruments usage accounting around the single run.
   */
  function runManaged(start: () => Query, ledger: QueryLedger): Query {
    const q = start();
    return instrumentUsage(q, ledger);
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
      return runManaged(
        () =>
          query({
            prompt: queryArgs.prompt,
            options: effective,
            _internal: { transport, mcpRegistry: shared },
          }),
        ledger,
      );
    },

    usage(): SessionManagerUsage {
      let totalCostUsd = 0;
      let usage = zeroUsage();
      const modelUsage: Record<string, ModelUsage> = {};
      for (const ledger of ledgers) {
        totalCostUsd += ledger.costUsd;
        usage = addUsage(usage, ledger.usage);
        mergeModelUsage(modelUsage, ledger.modelUsage);
      }
      return { totalCostUsd, usage, modelUsage, queries: ledgers.length };
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
