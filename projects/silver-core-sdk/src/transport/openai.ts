/**
 * Silver Core SDK - OpenAI-protocol translating transport (BPT-EXTENSION).
 *
 * Implements the same internal `Transport` contract as AnthropicTransport but
 * drives an OpenAI-compatible Chat Completions endpoint
 * (`POST {base}/chat/completions`, `stream: true`). The engine keeps speaking
 * Anthropic Messages API shapes end to end; this module translates at the wire
 * boundary only:
 *
 *   request  : StreamRequest (Messages API shape) -> Chat Completions body
 *   response : chat.completion.chunk SSE          -> RawMessageStreamEvent
 *
 * That keeps the agent loop, accumulator, tools, permissions and sessions
 * byte-identical across providers — the seam is exactly the one the module-A
 * contract drew. Selected via `ProviderConfig.protocol: 'openai-chat'`;
 * default stays 'anthropic' (zero behavior change for existing consumers).
 *
 * Translation limits (documented in docs/OPENAI-PROTOCOL.md):
 *  - `thinking` config does not translate and is DROPPED from the wire
 *    (use `provider.openai.reasoningEffort` for OpenAI reasoning models);
 *    DeepSeek-style `reasoning_content` deltas in the RESPONSE are surfaced
 *    as thinking blocks (empty signature; never replayed on the wire).
 *  - `cache_control` breakpoints are stripped (OpenAI-side caching is
 *    automatic); cached prompt tokens are read back from
 *    `usage.prompt_tokens_details.cached_tokens`.
 *  - image blocks translate to `image_url` parts; PDF/document blocks have no
 *    Chat Completions equivalent and degrade to an honest text placeholder.
 *
 * The HTTP retry/backoff/watchdog policy mirrors AnthropicTransport (the
 * resolve* helpers and semaphore are imported from it); the request loop is
 * kept local rather than refactoring the Anthropic path, so the conformance-
 * locked Anthropic transport stays byte-untouched.
 */

import {
  AbortError,
  APIConnectionError,
  APIStatusError,
  ConfigurationError,
  isAbortError,
} from '../errors.js';
import type {
  APIMessageParam,
  APIToolDefinition,
  ApiKeySource,
  ContentBlockParam,
  DocumentBlockParam,
  ImageBlockParam,
  OpenAIProtocolOptions,
  ProviderConfig,
  RawMessageStreamEvent,
  StopReason,
  TextBlockParam,
  ToolChoice,
  ToolResultBlockParam,
} from '../types.js';
import type { RetryInfo, StreamRequest, Transport } from '../internal/contracts.js';
import { parseSSE } from './sse.js';
import { SDK_USER_AGENT } from '../version.js';
import {
  RequestSemaphore,
  resolveMaxConcurrent,
  resolveMaxRetries,
  resolveStreamIdleMs,
  resolveStreamMaxMs,
} from './anthropic.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_TIMEOUT_MS = 600_000;
const USER_AGENT = SDK_USER_AGENT;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_FACTOR = 2;
const BACKOFF_MAX_MS = 60_000;

/** Normalized (Anthropic-vocabulary) error type per HTTP status, so engine-
 *  side handling keyed on Messages API error types works unchanged. */
const STATUS_ERROR_TYPE: Record<number, string> = {
  400: 'invalid_request_error',
  401: 'authentication_error',
  403: 'permission_error',
  404: 'not_found_error',
  408: 'timeout_error',
  413: 'request_too_large',
  429: 'rate_limit_error',
  529: 'overloaded_error',
};

type ResolvedCredential = { value: string; source: ApiKeySource };

type TransportConfig = {
  provider?: ProviderConfig;
  env: Record<string, string | undefined>;
  debug: (m: string) => void;
};

// ---------------------------------------------------------------------------
// Request encoding: Messages API shape -> Chat Completions body
// ---------------------------------------------------------------------------

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

type OpenAIToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

type OpenAIChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | OpenAIContentPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAIToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

/** Join the system field's text blocks. The engine's cache-split blocks are
 *  slices/sections of one logical prompt; '\n' matches the engine's own
 *  single-string join (loop.ts flat path). */
function encodeSystem(system: string | TextBlockParam[] | undefined): string | undefined {
  if (system === undefined) return undefined;
  if (typeof system === 'string') return system.length > 0 ? system : undefined;
  const text = system.map((b) => b.text).join('\n');
  return text.length > 0 ? text : undefined;
}

function imagePartUrl(block: ImageBlockParam): string {
  return block.source.type === 'base64'
    ? `data:${block.source.media_type};base64,${block.source.data}`
    : block.source.url;
}

/** Flatten a tool_result's content to the string an OpenAI `tool` message
 *  carries. Non-text blocks degrade to honest placeholders (never dropped
 *  silently). */
function flattenToolResultContent(block: ToolResultBlockParam): string {
  const content = block.content;
  if (content === undefined) return '';
  if (typeof content === 'string') return content;
  const parts: string[] = [];
  for (const item of content) {
    if (item.type === 'text') parts.push(item.text);
    else if (item.type === 'image') {
      parts.push('[image content omitted: not representable in an OpenAI tool result]');
    } else {
      parts.push(documentFallbackText(item));
    }
  }
  return parts.join('\n');
}

function documentFallbackText(block: DocumentBlockParam): string {
  if (block.source.type === 'text') return block.source.data;
  const label = block.title ?? (block.source.type === 'url' ? block.source.url : 'PDF');
  return `[document "${label}" omitted: no Chat Completions equivalent]`;
}

/** Translate one Anthropic message-param into its OpenAI message(s). A user
 *  turn carrying tool_result blocks fans out into `tool` role messages (which
 *  must directly follow the assistant tool_calls turn), then any remaining
 *  user content. */
function encodeMessage(msg: APIMessageParam): OpenAIChatMessage[] {
  if (typeof msg.content === 'string') {
    return msg.role === 'user'
      ? [{ role: 'user', content: msg.content }]
      : [{ role: 'assistant', content: msg.content }];
  }
  if (msg.role === 'assistant') {
    const texts: string[] = [];
    const toolCalls: OpenAIToolCall[] = [];
    for (const block of msg.content) {
      if (block.type === 'text') texts.push(block.text);
      else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: { name: block.name, arguments: JSON.stringify(block.input) },
        });
      }
      // thinking / redacted_thinking never translate to the OpenAI wire.
    }
    const content = texts.length > 0 ? texts.join('\n') : null;
    if (content === null && toolCalls.length === 0) return [];
    return [
      {
        role: 'assistant',
        content,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      },
    ];
  }
  // user turn with blocks: tool results first (protocol adjacency), then the
  // remaining text/image parts as one user message.
  const out: OpenAIChatMessage[] = [];
  const parts: OpenAIContentPart[] = [];
  for (const block of msg.content as ContentBlockParam[]) {
    switch (block.type) {
      case 'tool_result':
        out.push({
          role: 'tool',
          tool_call_id: block.tool_use_id,
          content: flattenToolResultContent(block),
        });
        break;
      case 'text':
        parts.push({ type: 'text', text: block.text });
        break;
      case 'image':
        parts.push({ type: 'image_url', image_url: { url: imagePartUrl(block) } });
        break;
      default:
        if ((block as { type?: string }).type === 'document') {
          parts.push({
            type: 'text',
            text: documentFallbackText(block as unknown as DocumentBlockParam),
          });
        }
        // tool_use / thinking blocks never appear in user turns.
        break;
    }
  }
  if (parts.length > 0) {
    const onlyText = parts.every((p) => p.type === 'text');
    out.push({
      role: 'user',
      content: onlyText
        ? parts.map((p) => (p as { type: 'text'; text: string }).text).join('\n')
        : parts,
    });
  }
  return out;
}

function encodeToolChoice(
  choice: ToolChoice,
): { tool_choice?: unknown; parallel_tool_calls?: boolean } {
  const parallel =
    'disable_parallel_tool_use' in choice && choice.disable_parallel_tool_use === true
      ? { parallel_tool_calls: false }
      : {};
  switch (choice.type) {
    case 'auto':
      return { tool_choice: 'auto', ...parallel };
    case 'any':
      return { tool_choice: 'required', ...parallel };
    case 'tool':
      return {
        tool_choice: { type: 'function', function: { name: choice.name } },
        ...parallel,
      };
    case 'none':
      return { tool_choice: 'none' };
  }
}

/**
 * Encode one StreamRequest as a Chat Completions request body. Exported for
 * unit tests (pure function, no I/O).
 */
export function encodeOpenAIRequest(
  req: Omit<StreamRequest, 'signal' | 'onRetry'>,
  opts: OpenAIProtocolOptions = {},
): Record<string, unknown> {
  const messages: OpenAIChatMessage[] = [];
  const system = encodeSystem(req.system);
  if (system !== undefined) messages.push({ role: 'system', content: system });
  for (const msg of req.messages) messages.push(...encodeMessage(msg));

  const tools =
    req.tools !== undefined && req.tools.length > 0
      ? req.tools.map((t: APIToolDefinition) => ({
          type: 'function' as const,
          function: {
            name: t.name,
            ...(t.description !== undefined ? { description: t.description } : {}),
            parameters: t.input_schema,
          },
        }))
      : undefined;

  const maxTokensParam = opts.maxTokensParam ?? 'max_tokens';
  return {
    // Gateway-specific extras first: translator-owned keys win on conflict.
    ...(opts.extraBody ?? {}),
    model: req.model,
    messages,
    [maxTokensParam]: req.max_tokens,
    ...(tools !== undefined ? { tools } : {}),
    ...(req.tool_choice !== undefined && tools !== undefined
      ? encodeToolChoice(req.tool_choice)
      : {}),
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(opts.reasoningEffort !== undefined
      ? { reasoning_effort: opts.reasoningEffort }
      : {}),
    ...(req.output_config !== undefined
      ? {
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'structured_output',
              schema: req.output_config.format.schema,
            },
          },
        }
      : {}),
    stream: true,
    stream_options: { include_usage: true },
  };
}

// ---------------------------------------------------------------------------
// Response decoding: chat.completion.chunk SSE -> RawMessageStreamEvent
// ---------------------------------------------------------------------------

type OpenAIChunk = {
  id?: string;
  model?: string;
  choices?: Array<{
    index?: number;
    delta?: {
      role?: string;
      content?: string | null;
      /** DeepSeek-style reasoning stream; some gateways use `reasoning`. */
      reasoning_content?: string | null;
      reasoning?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  } | null;
  error?: unknown;
};

function mapFinishReason(reason: string | null): StopReason {
  switch (reason) {
    case 'length':
      return 'max_tokens';
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'content_filter':
      return 'refusal';
    case 'stop':
    default:
      return 'end_turn';
  }
}

/**
 * Stateful chunk translator: feeds chat.completion.chunk payloads, emits
 * Anthropic stream events. One instance per stream attempt. Exported for
 * unit tests (pure state machine, no I/O).
 *
 * Blocks are keyed ('text' / 'reasoning' / `tool:${index}`) and stay OPEN
 * until finish(): providers such as vLLM interleave deltas of parallel tool
 * calls, so a close-on-switch design would seal a half-received block (empty
 * or truncated input) and route later fragments into a mis-labeled ghost
 * block. Multiple concurrently open blocks are exactly what the Anthropic
 * protocol's per-index events model; the accumulator keys by index and never
 * requires eager stops. (Audit 2026-07-10 P0-1.)
 */
export class OpenAIStreamTranslator {
  private readonly model: string;
  private started = false;
  private nextIndex = 0;
  /** Open blocks: translator key -> Anthropic block index (insertion order). */
  private readonly open = new Map<string, number>();
  private finishReason: string | null = null;
  private usage: NonNullable<OpenAIChunk['usage']> | null = null;
  private done = false;

  constructor(requestModel: string) {
    this.model = requestModel;
  }

  /** True once any choice carried a finish_reason (stream reached a proper
   *  end-of-message marker; used by the transport's truncation heuristic). */
  sawFinishReason(): boolean {
    return this.finishReason !== null;
  }

  /** True once the first chunk arrived (message_start was emitted). */
  hasStarted(): boolean {
    return this.started;
  }

  feed(chunk: OpenAIChunk): RawMessageStreamEvent[] {
    const events: RawMessageStreamEvent[] = [];
    if (!this.started) {
      this.started = true;
      events.push({
        type: 'message_start',
        message: {
          id: chunk.id ?? 'chatcmpl-unknown',
          type: 'message',
          role: 'assistant',
          model: chunk.model ?? this.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      });
    }
    if (chunk.usage !== undefined && chunk.usage !== null) this.usage = chunk.usage;
    const choice = chunk.choices?.[0];
    if (choice === undefined) return events;
    if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
      this.finishReason = choice.finish_reason;
    }
    const delta = choice.delta;
    if (delta === undefined) return events;

    const reasoning = delta.reasoning_content ?? delta.reasoning;
    if (typeof reasoning === 'string' && reasoning.length > 0) {
      const index = this.openBlock(events, 'reasoning', {
        type: 'thinking',
        thinking: '',
        signature: '',
      });
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'thinking_delta', thinking: reasoning },
      });
    }
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      const index = this.openBlock(events, 'text', { type: 'text', text: '' });
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'text_delta', text: delta.content },
      });
    }
    for (const tc of delta.tool_calls ?? []) {
      const key = `tool:${tc.index ?? 0}`;
      const index = this.openBlock(events, key, {
        type: 'tool_use',
        id: tc.id ?? `call_${this.nextIndex}`,
        name: tc.function?.name ?? '',
        input: {},
      });
      const args = tc.function?.arguments;
      if (typeof args === 'string' && args.length > 0) {
        events.push({
          type: 'content_block_delta',
          index,
          delta: { type: 'input_json_delta', partial_json: args },
        });
      }
    }
    return events;
  }

  /** Close all open blocks and emit message_delta + message_stop. Idempotent. */
  finish(): RawMessageStreamEvent[] {
    if (this.done) return [];
    this.done = true;
    if (!this.started) {
      throw new APIConnectionError(
        'Chat Completions stream ended before any chunk arrived',
      );
    }
    const events: RawMessageStreamEvent[] = [];
    for (const index of [...this.open.values()].sort((a, b) => a - b)) {
      events.push({ type: 'content_block_stop', index });
    }
    this.open.clear();
    const cached = this.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    const prompt = this.usage?.prompt_tokens ?? 0;
    events.push({
      type: 'message_delta',
      delta: { stop_reason: mapFinishReason(this.finishReason), stop_sequence: null },
      // OpenAI prompt_tokens INCLUDES cached tokens; Anthropic input_tokens
      // excludes cache reads — split so pricing/usage semantics line up.
      usage: {
        output_tokens: this.usage?.completion_tokens ?? 0,
        input_tokens: Math.max(0, prompt - cached),
        ...(cached > 0 ? { cache_read_input_tokens: cached } : {}),
      } as { output_tokens: number; input_tokens?: number },
    });
    events.push({ type: 'message_stop' });
    return events;
  }

  /** Return the block index for `key`, opening (and emitting
   *  content_block_start for) it on first sight. Blocks never close before
   *  finish() — see the class doc on interleaved deltas. */
  private openBlock(
    events: RawMessageStreamEvent[],
    key: string,
    block:
      | { type: 'text'; text: string }
      | { type: 'thinking'; thinking: string; signature?: string }
      | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> },
  ): number {
    const existing = this.open.get(key);
    if (existing !== undefined) return existing;
    const index = this.nextIndex;
    this.nextIndex += 1;
    this.open.set(key, index);
    events.push({
      type: 'content_block_start',
      index,
      content_block: block,
    });
    return index;
  }
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export class OpenAIChatTransport implements Transport {
  private readonly provider: ProviderConfig;
  private readonly env: Record<string, string | undefined>;
  private readonly debug: (m: string) => void;
  private readonly credential: ResolvedCredential | null;
  private readonly endpoint: string;
  /** provider.fetch injection seam. BPT-EXTENSION — lets the consumer bind
   *  requests to a long-keep-alive undici Agent so turns separated by slow
   *  tool runs reuse the warm TLS connection (docs/PERFORMANCE.md), or route
   *  via proxy/instrumented fetch. Undefined -> the CURRENT global fetch is
   *  resolved at call time (late binding: a later setGlobalDispatcher / test
   *  stub still applies). */
  private readonly fetchFn:
    | ((input: string | URL, init?: RequestInit) => Promise<Response>)
    | undefined;
  private readonly slots: RequestSemaphore | null;

  constructor(cfg: TransportConfig) {
    this.provider = cfg.provider ?? {};
    this.env = cfg.env;
    this.debug = cfg.debug;
    this.credential = resolveOpenAICredential(this.provider, cfg.env);
    this.fetchFn = this.provider.fetch;
    const maxConcurrent = resolveMaxConcurrent(this.provider, cfg.env);
    this.slots = maxConcurrent > 0 ? new RequestSemaphore(maxConcurrent) : null;
    const base = (
      this.provider.baseUrl ??
      nonEmpty(cfg.env.OPENAI_BASE_URL) ??
      DEFAULT_BASE_URL
    ).replace(/\/+$/, '');
    // Azure-style gateways route by query params (e.g. api-version); append
    // any configured extras once at construction (audit 2026-07-10 P1-4).
    const extras = Object.entries(this.provider.openai?.extraQueryParams ?? {});
    const query =
      extras.length > 0
        ? `?${new URLSearchParams(Object.fromEntries(extras)).toString()}`
        : '';
    this.endpoint = `${base}/chat/completions${query}`;
  }

  apiKeySource(): ApiKeySource {
    return this.credential?.source ?? 'none';
  }

  async *stream(req: StreamRequest): AsyncGenerator<RawMessageStreamEvent, void> {
    if (!this.slots) {
      yield* this.streamRequest(req);
      return;
    }
    const release = await this.slots.acquire();
    try {
      yield* this.streamRequest(req);
    } finally {
      release();
    }
  }

  private async *streamRequest(
    req: StreamRequest,
  ): AsyncGenerator<RawMessageStreamEvent, void> {
    if (!this.credential) {
      throw new ConfigurationError(
        'No OpenAI-protocol credential found. Set options.provider.apiKey / ' +
          'options.provider.authToken or the OPENAI_API_KEY environment variable.',
      );
    }
    const { signal: callerSignal, onRetry, ...requestBody } = req;
    if (callerSignal?.aborted) throw new AbortError();

    // Wire-model remapping (audit 2026-07-10 P1-4): one knob that catches
    // every call site — main loop, generators' utility default, verifier,
    // subagent alias resolutions — instead of chasing per-site overrides.
    const opts = this.provider.openai ?? {};
    const mappedModel = opts.modelMap?.[requestBody.model] ?? requestBody.model;
    if (mappedModel !== requestBody.model) {
      this.debug(`openai transport: model ${requestBody.model} -> ${mappedModel} (modelMap)`);
    } else if (requestBody.model.includes('claude')) {
      this.debug(
        `openai transport: WARNING sending Claude model id "${requestBody.model}" to an ` +
          `OpenAI-protocol endpoint (likely 404). Map it via provider.openai.modelMap ` +
          `or set the model explicitly.`,
      );
    }
    const bodyJson = JSON.stringify(
      encodeOpenAIRequest({ ...requestBody, model: mappedModel }, opts),
    );
    const headers = this.buildHeaders(this.credential);
    const timeoutMs = this.provider.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxRetries = resolveMaxRetries(this.provider, this.env);
    // Body-governance rule (resilience P1): same composite rule as the
    // Anthropic arm — request timeout governs connect->headers; the flowing
    // body is governed by the idle watchdog + optional streamMaxDurationMs
    // hard cap, with the request timeout as fallback when both are off.
    const streamMaxMs = resolveStreamMaxMs(this.provider, this.env);

    // Empty-stream retry (断流继续臂): an HTTP 200 whose SSE body carries ZERO
    // chunks before closing CLEANLY is a replay-SAFE non-start — the gateway
    // accepted the request but delivered nothing (an idealab-style throttle
    // shape observed under concurrent fan-out). Unlike a mid-stream drop
    // (chunks already yielded, which must never replay a partially consumed
    // turn), zero chunks means zero consumption, so re-issuing the whole
    // request is safe. Retried HERE, inside the transport, so BOTH the main
    // conversation and subagents (which run on this same transport, out of
    // reach of any host-level retry) self-heal without the caller seeing the
    // empty stream. Bounded by the same maxRetries budget; on exhaustion we
    // surface a retryable-class `empty_stream` APIConnectionError. This mirrors
    // AnthropicTransport's arm — a LOCAL copy because the streaming bodies
    // genuinely differ (translation vs raw passthrough), so streamRequest is
    // NOT a transport twin (see tests/transport-twin-drift.test.ts). A network
    // ERROR mid-stream (parseSSE throws) still routes through the catch below
    // and is NEVER retried, empty or not.
    let emptyStreamRetries = 0;
    for (;;) {
      // ---- request phase: retries allowed ---------------------------------
      const { response, signal, timeoutSignal, detachRequestTimeout, releaseSignals } =
        await this.requestWithRetries(
          bodyJson,
          headers,
          callerSignal,
          timeoutMs,
          maxRetries,
          onRetry,
        );

      // ---- streaming phase: NEVER retried once a chunk is delivered --------
      // OpenAI-protocol servers/gateways report the correlation id as
      // x-request-id (some proxies keep Anthropic's request-id); capture either
      // so APIStatusError carries the same diagnosability as the Anthropic arm.
      const requestId =
        response.headers.get('x-request-id') ??
        response.headers.get('request-id') ??
        undefined;
      if (!response.body) {
        throw new APIConnectionError('Chat Completions response has no body');
      }
      const idleMs = resolveStreamIdleMs(this.provider, this.env);
      const idleController = idleMs > 0 ? new AbortController() : undefined;
      // P1 body governance (mirrors the Anthropic arm): detach the request
      // timeout from the body unless BOTH body governors are off.
      const timeoutDetached = idleController !== undefined || streamMaxMs > 0;
      if (timeoutDetached) detachRequestTimeout();
      const maxController = streamMaxMs > 0 ? new AbortController() : undefined;
      let maxTimer: ReturnType<typeof setTimeout> | undefined;
      if (maxController !== undefined) {
        maxTimer = setTimeout(() => maxController.abort(), streamMaxMs);
        (maxTimer as { unref?: () => void }).unref?.();
      }
      const signalParts = [
        signal,
        ...(idleController ? [idleController.signal] : []),
        ...(maxController ? [maxController.signal] : []),
      ];
      const streamSignal =
        signalParts.length > 1 ? AbortSignal.any(signalParts) : signal;
      // Lazily re-armed watchdog (see the anthropic twin for the rationale):
      // per-event cost is one timestamp write; the single timer re-arms for
      // the remaining gap and still aborts idleMs after the LAST event.
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      let lastEventAt = 0;
      const armIdle = (delay: number): void => {
        idleTimer = setTimeout(() => {
          const remaining = idleMs - (Date.now() - lastEventAt);
          if (remaining <= 0) idleController!.abort();
          else armIdle(remaining);
        }, delay);
        (idleTimer as { unref?: () => void }).unref?.();
      };
      const resetIdle = (): void => {
        lastEventAt = Date.now();
        if (!idleController || idleTimer !== undefined) return;
        armIdle(idleMs);
      };
      const translator = new OpenAIStreamTranslator(req.model);
      let chunkCount = 0;
      let doneSeen = false;
      try {
        resetIdle();
        for await (const frame of parseSSE(response.body, streamSignal)) {
          resetIdle();
          const data = frame.data.trim();
          if (data === '[DONE]') {
            doneSeen = true;
            break;
          }
          let parsed: OpenAIChunk;
          try {
            parsed = JSON.parse(data) as OpenAIChunk;
          } catch (err) {
            throw new APIConnectionError(
              `Malformed Chat Completions SSE payload after ${chunkCount} chunk(s): ` +
                data.slice(0, 120),
              err,
              'sse_malformed_frame',
            );
          }
          if (parsed.error !== undefined && parsed.error !== null) {
            const info = extractOpenAIError(parsed.error);
            throw new APIStatusError(500, info.type, info.message, requestId);
          }
          chunkCount += 1;
          yield* translator.feed(parsed);
        }
      } catch (err) {
        throw mapStreamError(err, {
          callerSignal,
          timeoutSignal,
          timeoutMs,
          timeoutGovernsBody: !timeoutDetached,
          chunkCount,
          idleSignal: idleController?.signal,
          idleMs,
          maxSignal: maxController?.signal,
          streamMaxMs,
        });
      } finally {
        if (idleTimer) clearTimeout(idleTimer);
        if (maxTimer) clearTimeout(maxTimer);
        releaseSignals();
      }

      // The stream ended without throwing. A [DONE] terminator or any
      // finish_reason means the message reached its end-of-message marker:
      // synthesize the terminal message_delta/message_stop and finish.
      if (doneSeen || translator.sawFinishReason()) {
        yield* translator.finish();
        this.debug(`openai transport: stream completed after ${chunkCount} chunk(s)`);
        return;
      }

      // No end-of-message marker. ZERO chunks => an empty stream (replay-safe):
      // retry the whole request within the shared budget, like the Anthropic
      // arm's idealab-throttle self-heal. Any caller abort observed here wins.
      if (chunkCount === 0) {
        if (callerSignal?.aborted) throw new AbortError();
        if (emptyStreamRetries < maxRetries) {
          emptyStreamRetries += 1;
          this.debug(
            `openai transport: empty stream (HTTP 200, zero SSE chunks); ` +
              `retry ${emptyStreamRetries}/${maxRetries}`,
          );
          // Surface it like a network-level retry (no HTTP status) so the loop
          // emits an api_retry observability message, same as a dropped socket.
          onRetry?.({ attempt: emptyStreamRetries, maxRetries, kind: 'empty_stream' });
          await this.backoff(emptyStreamRetries, undefined, callerSignal);
          continue;
        }
        throw new APIConnectionError(
          `Chat Completions returned an empty stream (HTTP 200, zero SSE chunks) ` +
            `after ${emptyStreamRetries + 1} attempt(s)`,
          undefined,
          'empty_stream',
        );
      }

      // Chunks arrived but no [DONE]/finish_reason: a MID-STREAM connection drop
      // (proxy timeout, server restart). Do NOT fabricate an end_turn success
      // from the half-received answer — surface it as a truncated turn so the
      // engine's E3 salvage applies, matching the Anthropic arm. NEVER retried
      // (replaying a partially consumed turn is unsafe). (Audit 2026-07-10 P1-2.)
      const failure = new APIConnectionError(
        `Chat Completions stream ended without [DONE] or finish_reason after ` +
          `${chunkCount} chunk(s); treating as a truncated turn`,
      );
      failure.midStreamTruncation = true;
      throw failure;
    }
  }

  /** Same retry policy as AnthropicTransport: 408/429/5xx + network errors
   *  retry with exponential backoff + jitter, honoring retry-after (seconds);
   *  other 4xx fail immediately; the streaming phase is never retried. */
  private async requestWithRetries(
    bodyJson: string,
    headers: Record<string, string>,
    callerSignal: AbortSignal | undefined,
    timeoutMs: number,
    maxRetries: number,
    onRetry?: (info: RetryInfo) => void,
  ): Promise<{
    response: Response;
    signal: AbortSignal;
    timeoutSignal: AbortSignal;
    /** Stop propagating the whole-request timeout into the accepted response's
     *  body (P1 body governance; called once headers arrive and a body
     *  governor — idle watchdog / hard cap — is active). */
    detachRequestTimeout: () => void;
    /** Drop the caller/timeout abort listeners once the stream is finished so
     *  a long-lived caller signal does not accumulate one listener per turn. */
    releaseSignals: () => void;
  }> {
    let attempt = 0;
    for (;;) {
      if (callerSignal?.aborted) throw new AbortError();
      // Fresh timeout per attempt, propagated into a DEDICATED per-attempt
      // controller so the body phase can later detach the timeout leg without
      // dropping the caller leg (AbortSignal.any is compose-once; a dedicated
      // controller is the only way to unsubscribe one source).
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const attemptController = new AbortController();
      const abortFromCaller = (): void =>
        attemptController.abort(
          (callerSignal as { reason?: unknown } | undefined)?.reason,
        );
      const abortFromTimeout = (): void =>
        attemptController.abort((timeoutSignal as { reason?: unknown }).reason);
      callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
      timeoutSignal.addEventListener('abort', abortFromTimeout, { once: true });
      const detachRequestTimeout = (): void =>
        timeoutSignal.removeEventListener('abort', abortFromTimeout);
      const releaseSignals = (): void => {
        callerSignal?.removeEventListener('abort', abortFromCaller);
        timeoutSignal.removeEventListener('abort', abortFromTimeout);
      };
      const signal = attemptController.signal;

      let response: Response;
      try {
        this.debug(
          `openai transport: POST ${this.endpoint} (attempt ${attempt + 1}/${maxRetries + 1})`,
        );
        response = await (this.fetchFn ?? fetch)(this.endpoint, {
          method: 'POST',
          headers,
          body: bodyJson,
          signal,
        });
      } catch (err) {
        releaseSignals();
        if (callerSignal?.aborted) throw new AbortError();
        // Connection failure or per-attempt timeout: retryable.
        if (attempt < maxRetries) {
          attempt += 1;
          this.debug(
            `openai transport: network error (${errorMessage(err)}); retry ${attempt}/${maxRetries}`,
          );
          onRetry?.({ attempt, maxRetries, kind: 'network' });
          await this.backoff(attempt, undefined, callerSignal);
          continue;
        }
        throw new APIConnectionError(
          `Failed to reach ${this.endpoint}: ${errorMessage(err)}`,
          err,
        );
      }

      if (response.ok) {
        return { response, signal, timeoutSignal, detachRequestTimeout, releaseSignals };
      }
      releaseSignals();

      const requestId = response.headers.get('x-request-id') ?? response.headers.get('request-id') ?? undefined;
      const info = await readOpenAIErrorInfo(response);
      const retryable =
        response.status === 408 || response.status === 429 || response.status >= 500;
      if (retryable && attempt < maxRetries) {
        attempt += 1;
        const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
        this.debug(
          `openai transport: HTTP ${response.status} (${info.type}); retry ${attempt}/${maxRetries}`,
        );
        onRetry?.({
          attempt,
          maxRetries,
          status: response.status,
          errorType: info.type,
          kind: 'http_status',
          ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
        });
        await this.backoff(attempt, retryAfterMs, callerSignal);
        continue;
      }
      throw new APIStatusError(response.status, info.type, info.message, requestId);
    }
  }

  /** Exponential backoff (base 1s, factor 2) with jitter; retry-after wins. */
  private async backoff(
    attempt: number,
    retryAfterMs: number | undefined,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const exponential = BACKOFF_BASE_MS * BACKOFF_FACTOR ** (attempt - 1);
    const jittered = exponential * (0.5 + Math.random() * 0.5);
    const delay = Math.min(retryAfterMs ?? jittered, BACKOFF_MAX_MS);
    this.debug(`openai transport: backing off ${Math.round(delay)}ms`);
    await sleep(delay, signal);
  }

  private buildHeaders(credential: ResolvedCredential): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'user-agent': USER_AGENT,
    };
    for (const [key, value] of Object.entries(this.provider.defaultHeaders ?? {})) {
      headers[key.toLowerCase()] = value;
    }
    // Credential header (audit 2026-07-10 P1-4): default Bearer authorization;
    // a custom header name (e.g. Azure's 'api-key') carries the RAW key.
    const authHeader = (this.provider.openai?.authHeaderName ?? 'authorization').toLowerCase();
    headers[authHeader] =
      authHeader === 'authorization' ? `Bearer ${credential.value}` : credential.value;
    return headers;
  }
}

// ---------------------------------------------------------------------------
// Helpers (module-private)
// ---------------------------------------------------------------------------

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.length > 0 ? value : undefined;
}

/** provider.apiKey / provider.authToken ('user') > OPENAI_API_KEY ('project');
 *  both travel as `Authorization: Bearer` (the OpenAI protocol's only scheme). */
function resolveOpenAICredential(
  provider: ProviderConfig,
  env: Record<string, string | undefined>,
): ResolvedCredential | null {
  const providerKey = nonEmpty(provider.apiKey) ?? nonEmpty(provider.authToken);
  if (providerKey) return { value: providerKey, source: 'user' };
  const envKey = nonEmpty(env.OPENAI_API_KEY);
  if (envKey) return { value: envKey, source: 'project' };
  return null;
}

function extractOpenAIError(error: unknown): { type: string; message: string } {
  if (typeof error === 'object' && error !== null) {
    const type = (error as { type?: unknown }).type;
    const message = (error as { message?: unknown }).message;
    return {
      type: typeof type === 'string' ? type : 'api_error',
      message: typeof message === 'string' ? message : JSON.stringify(error),
    };
  }
  return { type: 'api_error', message: String(error) };
}

/** Read a non-2xx body; normalize the error type to Anthropic vocabulary by
 *  status (engine-side handling switches on those), keep the server message. */
async function readOpenAIErrorInfo(
  response: Response,
): Promise<{ type: string; message: string }> {
  const normalizedType =
    STATUS_ERROR_TYPE[response.status] ??
    (response.status >= 500 ? 'api_error' : 'invalid_request_error');
  let text = '';
  try {
    text = await response.text();
  } catch {
    // Body unavailable; fall through to the fallback.
  }
  if (text) {
    try {
      const parsed = JSON.parse(text) as { error?: unknown };
      if (parsed.error !== undefined && parsed.error !== null) {
        return { type: normalizedType, message: extractOpenAIError(parsed.error).message };
      }
    } catch {
      // Not JSON; use raw text below.
    }
  }
  return {
    type: normalizedType,
    message: text.slice(0, 2_000) || `HTTP ${response.status} ${response.statusText}`,
  };
}

/** Exported for unit tests (retry-after cap coverage). */
export function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, BACKOFF_MAX_MS);
  }
  return undefined;
}

type StreamErrorContext = {
  callerSignal: AbortSignal | undefined;
  timeoutSignal: AbortSignal;
  timeoutMs: number;
  timeoutGovernsBody: boolean;
  chunkCount: number;
  idleSignal?: AbortSignal;
  idleMs?: number;
  maxSignal?: AbortSignal;
  streamMaxMs?: number;
};

function mapStreamError(err: unknown, ctx: StreamErrorContext): Error {
  const { callerSignal, timeoutSignal, timeoutMs, chunkCount } = ctx;
  // Disconnect-taxonomy flags (resilience P0/P1): every terminal stream error
  // carries the pair the engine acts on — `midStreamTruncation` (events were
  // delivered whole; salvage may apply) and `turnReplaySafe` (NOTHING was
  // delivered, so re-issuing the turn cannot double-consume content or tool
  // side effects; the engine may replay within its bounded budget).
  const flag = (failure: APIConnectionError): APIConnectionError => {
    failure.turnReplaySafe = chunkCount === 0;
    return failure;
  };
  if (err instanceof APIStatusError) return err;
  if (callerSignal?.aborted) {
    return err instanceof AbortError ? err : new AbortError();
  }
  // Idle watchdog fired (checked before the whole-request timeout, which it
  // pre-empts): the stream stalled with no server event. Terminal at the
  // transport (the streaming phase is never retried here); a zero-event stall
  // is turn-replay-safe for the engine.
  if (ctx.idleSignal?.aborted) {
    return flag(
      new APIConnectionError(
        `Chat Completions stream idle for ${ctx.idleMs}ms with no server event after ` +
          `${chunkCount} chunk(s); aborted`,
        err,
        'stream_idle_timeout',
      ),
    );
  }
  // Hard cap on total streaming duration fired (streamMaxDurationMs). Unlike
  // the idle watchdog this cuts a FLOWING stream, so blocks delivered whole
  // stay salvageable.
  if (ctx.maxSignal?.aborted) {
    const failure = flag(
      new APIConnectionError(
        `Chat Completions stream exceeded the streamMaxDurationMs hard cap ` +
          `(${ctx.streamMaxMs}ms) after ${chunkCount} chunk(s); aborted`,
        err,
        'stream_max_duration',
      ),
    );
    failure.midStreamTruncation = chunkCount > 0;
    return failure;
  }
  // Whole-request timeout during the body: only reachable in the fallback
  // configuration (idle watchdog disabled, no hard cap). Delivered-whole
  // blocks stay salvageable here too (P1: salvage-on-timeout).
  if (ctx.timeoutGovernsBody && timeoutSignal.aborted) {
    const failure = flag(
      new APIConnectionError(
        `Chat Completions stream timed out after ${timeoutMs}ms`,
        err,
      ),
    );
    failure.midStreamTruncation = chunkCount > 0;
    return failure;
  }
  if (err instanceof APIConnectionError) return err;
  if (isAbortError(err)) {
    return err instanceof AbortError ? err : new AbortError(errorMessage(err));
  }
  const failure = flag(
    new APIConnectionError(
      `Chat Completions stream failed after ${chunkCount} chunk(s): ${errorMessage(err)}`,
      err,
    ),
  );
  // E3: a connection that dropped after delivering events is a TRUNCATED
  // turn - the engine may salvage the completed blocks (official 2.1.201
  // does; conformance run-l4 KD-L4-02/04).
  failure.midStreamTruncation = chunkCount > 0;
  return failure;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortError());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new AbortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
