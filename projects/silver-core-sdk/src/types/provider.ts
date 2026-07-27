/**
 * Silver Core SDK 公开类型面 — 供应商/传输层配置（BPT 扩展）。
 *
 * 自 src/types.ts 按其自带的分节切出（结构审视 P7，2026-07-27）：切分依据是文件
 * 原本就标好的分节注释，不是新发明的边界。src/types.ts 保留为 barrel，所有
 * `from '../types.js'` 的既有 import 一行未动。
 *
 * 溯源与合规声明见 src/types.ts 头注（clean-room，仅据公开文档）。
 */

import type { ApiKeySource } from './messages.js';

// ---------------------------------------------------------------------------
// Provider transport configuration (BPT extension)
// ---------------------------------------------------------------------------

/**
 * Caller-supplied price entry (BPT-EXTENSION, audit 2026-07-10): USD per MTok
 * for a model-id prefix, merged OVER the static Claude price table (overrides
 * win on prefix match). Lets a gateway consumer price non-Claude models so
 * cost metrics and `maxBudgetUsd` are enforceable on the OpenAI protocol.
 */
export type PriceOverride = {
  /** USD per MTok of regular input tokens. */
  input: number;
  /** USD per MTok of output tokens. */
  output: number;
  /** USD per MTok of cache-creation input; default input x1.25. */
  cacheWrite?: number;
  /** USD per MTok of cache-read input; default input x0.1. */
  cacheRead?: number;
};

/**
 * Tuning for the OpenAI-protocol transport (BPT-EXTENSION). Read only when
 * `ProviderConfig.protocol` is 'openai-chat'; see docs/OPENAI-PROTOCOL.md.
 */
export type OpenAIProtocolOptions = {
  /**
   * Wire-model remapping applied by the transport just before the request is
   * encoded: `modelMap[model] ?? model`. Keys are the RESOLVED model ids that
   * would otherwise hit the wire — including Claude defaults baked into
   * subsystems (generators' utility model, verifier, alias table), e.g.
   * `{ 'claude-haiku-4-5': 'gpt-4o-mini' }`. One knob instead of chasing every
   * per-call-site model override; unmapped `claude-*` ids on this protocol
   * log a debug warning (they will 404 on an OpenAI endpoint).
   */
  modelMap?: Record<string, string>;
  /**
   * Name of the credential header (default 'authorization', sent as
   * `Bearer <key>`). Any other name sends the RAW key under that header —
   * e.g. 'api-key' for Azure OpenAI-style gateways.
   */
  authHeaderName?: string;
  /**
   * Extra query parameters appended to the chat/completions URL on every
   * request — e.g. `{ 'api-version': '2024-06-01' }` for Azure-style gateways.
   */
  extraQueryParams?: Record<string, string>;
  /**
   * Which wire param carries the output-token cap. Default 'max_tokens' (the
   * param every OpenAI-compatible gateway accepts); api.openai.com reasoning
   * models reject it and require 'max_completion_tokens'.
   */
  maxTokensParam?: 'max_tokens' | 'max_completion_tokens';
  /**
   * Forwarded verbatim as `reasoning_effort`. The Anthropic `thinking` config
   * has no Chat Completions equivalent and is dropped from the wire; this is
   * the OpenAI-native reasoning knob instead.
   */
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  /**
   * Role for the system message on the wire. Defaults to `'system'`. Set to
   * `'developer'` for api.openai.com reasoning models (o1/o3), which 400 on
   * `role:'system'` (audit r4 Soa-3). Left as an explicit opt-in because the
   * many OpenAI-compatible gateways this transport targets (vLLM / DeepSeek /
   * one-api) accept `'system'` fine, so a heuristic remap would misfire.
   */
  systemRole?: 'system' | 'developer';
  /**
   * Extra top-level body fields merged into every request (gateway params,
   * e.g. `{ enable_thinking: false }`). Translator-owned keys win on conflict.
   */
  extraBody?: Record<string, unknown>;
  /**
   * OPT-IN (default false): send `strict: true` on the `response_format`
   * `json_schema` for structured-output requests. When set, api.openai.com
   * uses constrained decoding to GUARANTEE the model's output matches the
   * schema — eliminating the engine-side validate-and-retry churn that a
   * best-effort (non-strict) schema incurs (audit r2 2026-07-17 B3).
   *
   * Left off by default because strict mode is NOT free: OpenAI requires the
   * schema to satisfy the strict subset (`additionalProperties: false` on every
   * object, every property listed in `required`, supported keywords only) and
   * REJECTS a non-conforming schema with a request-time 400 — worse than the
   * silent best-effort degrade. Many OpenAI-compatible gateways (older vLLM,
   * one-api variants) also do not implement strict. Enable this ONLY when the
   * endpoint supports strict mode AND every structured-output schema you pass
   * is strict-compatible.
   */
  strictStructuredOutput?: boolean;
};

/**
 * Structured capability declaration for ONE endpoint (BPT-EXTENSION, keeper
 * memo 2026-07-18 §3): what the endpoint TRULY supports, declared by the
 * host that connected it. The engine degrades per declaration — with a debug
 * diagnostic, never silently — instead of assuming full capability for every
 * gateway. Omitted object or omitted fields keep the current per-protocol
 * behavior exactly (drop-in). This is a declaration seam, NOT a model
 * profile: no probing, no inference, no per-model tables (the "model surface
 * profile" mechanism stays un-chartered per the same memo).
 */
export type ProviderCapabilities = {
  /**
   * Usage-reporting precision of the endpoint's stream. 'exact' (the
   * default assumption): token counts are authoritative. 'approximate':
   * counts exist but are estimates (cost figures are directional).
   * 'none': the endpoint reports no usage — cost estimation and
   * `maxBudgetUsd` are unenforceable; the engine says so once at startup
   * instead of quietly booking $0.
   */
  usage?: 'exact' | 'approximate' | 'none';
  /**
   * The endpoint's prompt-caching semantics. 'explicit' (Anthropic
   * cache_control breakpoints honored — the anthropic-protocol default),
   * 'automatic' (the endpoint caches on its own; breakpoint markers are
   * stripped from the wire so a strict gateway never 400s on them),
   * 'none' (no caching at all; markers stripped likewise). The openai-chat
   * translator never emits cache_control regardless.
   */
  promptCaching?: 'explicit' | 'automatic' | 'none';
  /**
   * Whether the endpoint supports thinking / reasoning output. `false`
   * strips the `thinking` request field from the anthropic wire and
   * suppresses `provider.openai.reasoningEffort` on the openai wire —
   * for gateways that 400 on either.
   */
  thinking?: boolean;
  /**
   * Whether the endpoint supports parallel tool calls. `false` asks the
   * endpoint for at most one tool call per turn: `disable_parallel_tool_use`
   * on the anthropic wire, `parallel_tool_calls: false` on the openai wire.
   */
  parallelToolCalls?: boolean;
};

/**
 * BPT extension: direct-API transport settings. The reference SDK spawns a
 * CLI subprocess; this SDK talks to the Messages API itself, so connection
 * settings live here. Falls back to ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN /
 * ANTHROPIC_BASE_URL environment variables when omitted.
 */
export type ProviderConfig = {
  /**
   * Wire protocol this transport speaks (BPT-EXTENSION). 'anthropic' (default)
   * drives the Messages API directly; 'openai-chat' drives an OpenAI-compatible
   * Chat Completions endpoint through a translating transport — the engine
   * keeps speaking Messages API shapes, translation happens at the wire
   * boundary only. With 'openai-chat', credentials resolve from apiKey /
   * authToken / OPENAI_API_KEY and baseUrl defaults to
   * 'https://api.openai.com/v1' (OPENAI_BASE_URL env fallback); `options.model`
   * must name a model the endpoint serves. See docs/OPENAI-PROTOCOL.md.
   */
  protocol?: 'anthropic' | 'openai-chat';
  /** OpenAI-protocol tuning; read only when protocol is 'openai-chat'. */
  openai?: OpenAIProtocolOptions;
  /**
   * Structured declaration of what THIS endpoint truly supports (usage
   * precision / prompt-caching semantics / thinking / parallel tool calls).
   * The engine degrades per declaration with a debug diagnostic — never a
   * silent full-capability assumption. Omit to keep per-protocol defaults.
   */
  capabilities?: ProviderCapabilities;
  /**
   * Custom model pricing (BPT-EXTENSION, audit 2026-07-10): USD-per-MTok
   * entries keyed by model-id prefix, merged over the static Claude table
   * (overrides win on prefix match). Required for cost metrics /
   * `maxBudgetUsd` enforcement on non-Claude models (protocol 'openai-chat');
   * also usable to correct a stale static entry.
   */
  pricing?: Record<string, PriceOverride>;
  apiKey?: string;
  /** Bearer token auth (gateways); mutually exclusive with apiKey. */
  authToken?: string;
  baseUrl?: string;
  apiVersion?: string;
  defaultHeaders?: Record<string, string>;
  maxRetries?: number;
  /**
   * Per-request timeout in milliseconds (default 600000). Governs the REQUEST
   * phase (connect through response headers) of each attempt. Once the stream
   * is flowing, the body is governed by the idle watchdog plus the optional
   * `streamMaxDurationMs` hard cap instead — a healthy long turn is never cut
   * mid-flow by a clock that ignores progress. Fallback: when the idle
   * watchdog is explicitly disabled (`streamIdleTimeoutMs: 0`) and no hard cap
   * is set, this timeout keeps governing the body too, so no configuration is
   * ever unbounded.
   */
  timeoutMs?: number;
  /**
   * Idle watchdog for the streaming phase: abort the stream if no SSE event
   * arrives for this many milliseconds (default 300000; `0` disables). Fires
   * faster and more diagnosably than the whole-request timeout when a stream
   * silently stalls — the API emits periodic `ping` events, so a gap this long
   * means the connection is stuck, not merely slow.
   */
  streamIdleTimeoutMs?: number;
  /**
   * Optional hard cap on TOTAL streaming duration in milliseconds (default 0 =
   * disabled; env fallback `BPT_STREAM_MAX_DURATION_MS`). Unlike the idle
   * watchdog this fires even on a flowing stream; when it does, content blocks
   * delivered whole remain salvageable (E3) instead of the turn being voided.
   * BPT-EXTENSION: the primary body governor is the idle watchdog — set this
   * only when an absolute wall-clock bound per turn is required.
   */
  streamMaxDurationMs?: number;
  /**
   * Cap on concurrently in-flight Messages API requests through THIS transport
   * (default 0 = unlimited). When many conversations share one transport (a
   * SessionManager), N concurrent `mgr.query()` drives open N streams at once
   * and can thrash the API rate limit; set this to bound the API concurrency
   * while `runConcurrent`'s `concurrency` bounds the conversations. Excess
   * requests queue (FIFO) until a slot frees; a request holds its slot for the
   * whole streaming lifetime. Env fallback: `BPT_MAX_CONCURRENT_REQUESTS`.
   * BPT-EXTENSION: the official SDK has no such knob (its CLI owns concurrency).
   */
  maxConcurrentRequests?: number;
  /**
   * Custom fetch implementation used for EVERY HTTP request this transport
   * issues. BPT-EXTENSION. Highest-priority override: when set it wins over
   * `httpClient` and the built-in default. The seam for proxies, mTLS, and
   * request instrumentation (recipes: docs/PERFORMANCE.md). The function
   * receives exactly what the transport would pass to global fetch (endpoint
   * URL + RequestInit including signal) and must resolve to a WHATWG
   * Response whose body is the SSE stream.
   */
  fetch?: (input: string | URL, init?: RequestInit) => Promise<Response>;
  /**
   * Which built-in HTTP client drives requests when `fetch` is not injected
   * (BPT-EXTENSION; default 'node', env fallback `BPT_HTTP_CLIENT`).
   * - 'node' (default since v0.45.0): the SDK's zero-dependency node:http(s)
   *   adapter with long keep-alive agents + TLS session cache — connections
   *   survive slow tool runs instead of re-paying a TCP+TLS handshake
   *   (typically 100-300ms) each turn, the way global fetch's ~4s idle pool
   *   does. Idle sockets are unref'd, so the warm pool never blocks process
   *   exit. Divergences from fetch (all inert against the Messages API): no
   *   redirect following, no accept-encoding, bodies always carry an
   *   explicit content-length.
   * - 'fetch': the pre-v0.45 behavior — the CURRENT global fetch, resolved
   *   at call time. Pick this when you rely on undici semantics such as
   *   setGlobalDispatcher / NODE_USE_ENV_PROXY proxying or global-fetch
   *   test stubs.
   */
  httpClient?: 'node' | 'fetch';
  /**
   * Fire ONE fire-and-forget unauthenticated HEAD to the endpoint at
   * transport construction (BPT-EXTENSION; default false, env fallback
   * `BPT_PRECONNECT=1`). Warms DNS+TCP+TLS in parallel with MCP connect /
   * session resolution so the first real request skips the handshake
   * (~100-300ms off first-turn TTFT). Off by default: it is extra traffic
   * the caller did not ask for. Failures are swallowed (never a failure
   * source); no credential rides the probe.
   */
  preconnect?: boolean;
  /**
   * Per-request output-token cap (`max_tokens` / the configured
   * maxTokensParam on the wire). Default is protocol-aware: 8192 on
   * 'anthropic' (that API 400s a cap above the model's output ceiling and no
   * per-model table is bundled), 128000 on 'openai-chat' (BPT ruling
   * 2026-07-14 — agentic turns on large-output gateway models were starved
   * at 8192). A model/gateway whose ceiling is lower rejects the request
   * with a clear surfaced APIStatusError; set this explicitly to match your
   * endpoint. Note: compaction budgets derive from `contextWindow -
   * maxOutputTokens`, so a cap at/above the model's context window disables
   * compaction (logged, not silent).
   */
  maxOutputTokens?: number;
  /** Automatic prompt caching via cache_control breakpoints; default true. */
  promptCaching?: boolean;
  /**
   * Cache lifetime for the prompt-cache breakpoints this engine places.
   * '5m' (default when omitted) is the 5-minute ephemeral cache; '1h' is the
   * 1-hour cache (2x write price, GA). BPT-EXTENSION: the official Agent SDK
   * exposes NO cache-TTL knob (its wrapped CLI decides internally); this
   * direct-API engine lets the caller choose. No effect when promptCaching is
   * false.
   */
  cacheTtl?: '5m' | '1h';
};

/**
 * Opaque handle to the SDK's internal Transport contract (BPT-EXTENSION,
 * cross-protocol subagent routing 2026-07-13). The public type surface cannot
 * import `internal/contracts.ts` (contracts imports types.ts — a cycle), so
 * this structural stand-in carries transports across the
 * `resolveSubagentTransport` boundary. Treat values as opaque: obtain them
 * from `input.parentTransport` or `createSubagentTransportResolver()`; the
 * real internal Transport satisfies this shape.
 */
export interface SubagentTransportHandle {
  stream(req: never): AsyncGenerator<unknown, void>;
  apiKeySource(): ApiKeySource;
  /** Optional resource release (idle connection pools etc.). The built-in
   *  transports self-clean (unref'd keep-alive sockets with a TTL) and do not
   *  implement it; a custom transport may. Called by the subagent runtime at
   *  query teardown for resolutions returned with `owned: true`. */
  dispose?(): void;
}

/**
 * What `resolveSubagentTransport` returns for one isolated-subagent spawn
 * (BPT-EXTENSION, cross-protocol subagent routing 2026-07-13).
 */
export type SubagentTransportResolution = {
  /** Transport the child loop must drive. Return the parent's own instance
   *  (or `undefined` from the resolver) to share it. */
  transport: SubagentTransportHandle;
  /**
   * True hands the transport's lifecycle to the subagent runtime: its
   * `dispose()` (when implemented) is called once at query teardown, after
   * every child settled. False (default) means the host owns it — e.g. an
   * instance memoized across spawns. Children NEVER dispose a shared parent
   * transport regardless of this flag.
   */
  owned?: boolean;
  /** Wire protocol of `transport`, for the spawn log line only. */
  protocol?: 'anthropic' | 'openai-chat';
  /**
   * Thinking config for the child. Omitted + transport SWITCHED + child model
   * id without 'claude' -> the runtime safely drops the inherited thinking
   * config (a Claude-shaped `thinking` param sent to a non-Claude model is
   * gateway-rejected more often than honored). Omitted + transport shared ->
   * the parent config is inherited unchanged (existing behavior). NOTE this
   * value is the config-level INTENT: the engine still fits the wire form to
   * the live child model per turn (computeThinking — adaptive vs
   * budget_tokens), exactly as it does for the main loop's Options.thinking.
   */
  thinking?: ThinkingConfigParam;
  /** Child maxThinkingTokens; same defaulting rules as `thinking`. */
  maxThinkingTokens?: number;
  /** Child promptCaching; inherited from the parent when omitted. */
  promptCaching?: boolean;
};

/** Input handed to `resolveSubagentTransport` for one internal model call. */
export type SubagentTransportRequest = {
  /** Fully resolved child model id (per-call override / agentDef.model /
   *  parent fallback, aliases expanded). */
  model: string;
  /**
   * Which internal call is asking (v0.55.0): 'subagent' (isolated child
   * spawn), 'utility' (generator calls, e.g. hook `condition` evaluation on
   * the default Haiku-tier utility model), or 'compaction' (the summarizer
   * when `compaction.model` differs from the session model). The standard
   * resolver routes purely by model; hosts may branch on this for logging or
   * per-purpose policy.
   */
  purpose: 'subagent' | 'utility' | 'compaction';
  /** The live parent model id. */
  parentModel: string;
  /** Wire protocol of the parent transport. */
  parentProtocol: 'anthropic' | 'openai-chat';
  parentTransport: SubagentTransportHandle;
  /** The query's provider config (undefined when the caller passed none). */
  parentProvider?: ProviderConfig;
  /** The query's resolved env (credential/base-URL fallback chains). */
  env: Record<string, string | undefined>;
  /** Always false in v1: forks NEVER consult the resolver (a fork's cached
   *  prefix requires the parent model + transport). Field kept so the shape
   *  is forward-compatible should that ever loosen. */
  fork: boolean;
  debug: (msg: string) => void;
};

/**
 * Host callback resolving the transport an ISOLATED subagent drives
 * (BPT-EXTENSION, cross-protocol subagent routing 2026-07-13). Called once
 * per isolated spawn AFTER the child model is resolved; never called for
 * forks. Return `undefined` to share the parent transport (the default when
 * the option is absent — existing single-protocol behavior is unchanged).
 * `createSubagentTransportResolver()` builds the common implementation from a
 * model->protocol routing table with per-protocol transport memoization.
 */
export type SubagentTransportResolver = (
  input: SubagentTransportRequest,
) =>
  | SubagentTransportResolution
  | undefined
  | Promise<SubagentTransportResolution | undefined>;

/**
 * Bash sandbox configuration (BPT-shaped object form of Options.sandbox).
 * Restriction scope v1: write-denial outside allowed dirs + network isolation
 * (binary) + sandbox-writable $TMPDIR — exactly what the archived guidance
 * describes, nothing invented.
 */
export type SandboxOptions = {
  /** Default true when a backend resolves. */
  enabled?: boolean;
  /** Sandboxed commands get network access (default false: `--unshare-net`). */
  allowNetwork?: boolean;
  /**
   * Extra absolute directories writable inside the sandbox. cwd,
   * additionalDirectories, the shell state dir and the sandbox tmp dir are
   * always writable automatically.
   */
  writablePaths?: string[];
  /**
   * false = mandatory mode: the Bash `dangerouslyDisableSandbox` parameter is
   * disabled by policy (removed from the schema; calls refused).
   */
  allowEscape?: boolean;
  /**
   * BPT extension: inject a custom sandbox backend (tests; a host-provided
   * Seatbelt implementation). When set it is used verbatim, no probing.
   */
  backend?: SandboxBackend;
  /**
   * OPT-IN (default off): restrict the environment a SANDBOXED command inherits.
   * By default the sandbox does NOT isolate the environment — a sandboxed
   * command reads the whole `options.env ?? process.env`, including every host
   * secret (API keys, cloud credentials), since bubblewrap does not scrub env
   * (audit r2 2026-07-17 Q1). This matters because the sandbox exists to
   * contain model-driven commands, and `options.env` cannot be scrubbed on its
   * own to hide secrets — the API transport resolves its credential from that
   * SAME env, so scrubbing it there breaks auth unless `provider.apiKey` is set.
   *
   *  - `true`         → keep only a built-in set of non-secret essentials
   *                     (PATH/HOME/USER/LOGNAME/SHELL/LANG/LANGUAGE/TERM/TZ/PWD),
   *                     dropping everything else. The one-liner "hide my
   *                     secrets from sandboxed commands" switch.
   *  - `{ allow }`    → keep ONLY the listed keys (the host owns the full set;
   *                     the sandbox `$TMPDIR` overlay is always applied after).
   *  - unset / false  → current behavior: the full env is inherited (parity).
   *
   * The scrub applies to sandboxed spawns only; an unsandboxed / escaped
   * command (which makes no containment claim) always inherits the full env.
   */
  envScrub?: boolean | { allow?: readonly string[] };
};

/** One shell invocation a sandbox backend wraps (foreground and background). */
export type SandboxSpawnRequest = {
  shell: string;
  command: string;
  cwd: string;
  writablePaths: string[];
  tmpDir: string;
  allowNetwork: boolean;
};

/** The transformed spawn a backend returns: program + argv tail (+ env overlay). */
export type SandboxSpawnPlan = {
  command: string;
  args: string[];
  env?: Record<string, string>;
};

/** A pluggable sandbox implementation: pure argv transformation, no I/O. */
export interface SandboxBackend {
  readonly name: string;
  wrap(req: SandboxSpawnRequest): SandboxSpawnPlan;
}

/**
 * Resolved per-query sandbox state (threaded through ToolContext). Absent on a
 * context means Bash runs unsandboxed — honestly, with no sandbox prompts.
 */
export type SandboxContext = {
  backend: SandboxBackend;
  /** Per-query sandbox-writable temp dir ($TMPDIR target). */
  tmpDir: string;
  /** cwd + additionalDirectories + writablePaths + shell state dir + tmpDir. */
  writablePaths: string[];
  allowNetwork: boolean;
  /** false = mandatory mode: dangerouslyDisableSandbox is disabled by policy. */
  allowEscape: boolean;
  /**
   * Resolved from SandboxOptions.envScrub (audit r2 2026-07-17 Q1). When set,
   * a sandboxed spawn inherits ONLY these env keys (the sandbox $TMPDIR overlay
   * is still applied on top); undefined = inherit the full env (default parity).
   */
  envAllowlist?: readonly string[];
};

/** NEW-IN-DOCS: how reasoning content is surfaced (Options.thinking `display`).
 *  Forwarded verbatim to the wire thinking param (P2); the API owns the actual
 *  summarize/omit behavior. */
export type ThinkingDisplay = 'summarized' | 'omitted';

export type ThinkingConfigParam =
  | { type: 'adaptive'; display?: ThinkingDisplay }
  | {
      type: 'enabled';
      budgetTokens?: number;
      budget_tokens?: number;
      budget?: number;
      /** NEW-IN-DOCS. Forwarded to the wire thinking param (P2). */
      display?: ThinkingDisplay;
    }
  | { type: 'disabled' };
