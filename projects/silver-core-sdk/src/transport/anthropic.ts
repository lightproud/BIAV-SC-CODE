/**
 * Silver Core SDK - direct Anthropic Messages API transport.
 *
 * Drives `POST {base}/v1/messages` with `stream: true` over global fetch
 * (Node >= 18) and yields raw SSE events. Handles credential/base-URL
 * resolution, retries with exponential backoff + jitter, per-request
 * timeouts, and error mapping per docs/ARCHITECTURE.md (module A).
 */

import {
  AbortError,
  APIConnectionError,
  APIStatusError,
  ConfigurationError,
  isAbortError,
} from '../errors.js';
import {
  extractProviderErrorObject,
  looksLikeErrorObject,
} from '../error-normalize.js';
import type {
  APIMessageParam,
  ApiKeySource,
  ContentBlockParam,
  ProviderConfig,
  RawMessageStreamEvent,
} from '../types.js';
import type { RetryInfo, StreamRequest, Transport } from '../internal/contracts.js';
import { parseSSE } from './sse.js';
import {
  firePreconnect,
  getNodeFetch,
  resolveHttpClient,
  resolvePreconnect,
} from './node-http.js';
import { SDK_USER_AGENT } from '../version.js';

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_API_VERSION = '2023-06-01';
const DEFAULT_TIMEOUT_MS = 600_000;
/** Default idle watchdog: abort a stalled stream after this gap with no event.
 *  Official default AND minimum for the env override (CLAUDE_STREAM_IDLE_TIMEOUT_MS
 *  "defaults to 300000 and is clamped to that minimum"); provider option
 *  overrides are NOT clamped (explicit override semantics unchanged). */
export const DEFAULT_STREAM_IDLE_MS = 300_000;
/** Official default retry count (CLAUDE_CODE_MAX_RETRIES "Default 10"). */
export const DEFAULT_MAX_RETRIES = 10;
/** Official cap applied to the CLAUDE_CODE_MAX_RETRIES env override ("capped
 *  at 15"); provider.maxRetries overrides are NOT capped. */
const ENV_MAX_RETRIES_CAP = 15;
const USER_AGENT = SDK_USER_AGENT;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_FACTOR = 2;
const BACKOFF_MAX_MS = 60_000;

/**
 * Plausible HTTP statuses for in-stream error payloads. An SSE `error` event
 * arrives on an HTTP 200 connection, so no real status line exists; we map
 * the API error type to its conventional status (fallback 500).
 */
const ERROR_TYPE_STATUS: Record<string, number> = {
  invalid_request_error: 400,
  authentication_error: 401,
  permission_error: 403,
  not_found_error: 404,
  request_too_large: 413,
  rate_limit_error: 429,
  timeout_error: 408,
  api_error: 500,
  overloaded_error: 529,
};

type ResolvedCredential = {
  header: 'x-api-key' | 'authorization';
  value: string;
  source: ApiKeySource;
};

type TransportConfig = {
  provider?: ProviderConfig;
  env: Record<string, string | undefined>;
  debug: (m: string) => void;
  /** Optional beta flags forwarded via the `anthropic-beta` header. */
  betas?: string[];
};

export class AnthropicTransport implements Transport {
  private readonly provider: ProviderConfig;
  private readonly env: Record<string, string | undefined>;
  private readonly debug: (m: string) => void;
  private readonly betas: string[] | undefined;
  private readonly credential: ResolvedCredential | null;
  private readonly endpoint: string;
  /** The HTTP client behind every request. Resolution: provider.fetch
   *  (injection seam, always wins) > httpClient 'node' (default since
   *  v0.45.0: the built-in keep-alive adapter, see node-http.ts) >
   *  httpClient 'fetch' -> undefined here, so the call site late-binds the
   *  CURRENT global fetch (a later setGlobalDispatcher / test stub still
   *  applies — the exact pre-v0.45 behavior). */
  private readonly fetchFn:
    | ((input: string | URL, init?: RequestInit) => Promise<Response>)
    | undefined;
  /** Concurrency gate; null when maxConcurrentRequests resolves to 0
   *  (unlimited — the default, so existing single-conversation callers see
   *  zero behavior change). */
  private readonly slots: RequestSemaphore | null;

  constructor(cfg: TransportConfig) {
    this.provider = cfg.provider ?? {};
    this.env = cfg.env;
    this.debug = cfg.debug;
    this.betas = cfg.betas;
    this.credential = resolveCredential(this.provider, cfg.env);
    this.fetchFn =
      this.provider.fetch ??
      (resolveHttpClient(this.provider, cfg.env) === 'node' ? getNodeFetch() : undefined);
    const maxConcurrent = resolveMaxConcurrent(this.provider, cfg.env);
    this.slots = maxConcurrent > 0 ? new RequestSemaphore(maxConcurrent) : null;
    const base = (
      this.provider.baseUrl ??
      nonEmpty(cfg.env.ANTHROPIC_BASE_URL) ??
      DEFAULT_BASE_URL
    ).replace(/\/+$/, '');
    this.endpoint = `${base}/v1/messages`;
    // 方案丙: optional first-turn handshake warm-up, overlapped with query
    // init (MCP connect / session resolution). Default off.
    if (resolvePreconnect(this.provider, cfg.env)) {
      firePreconnect(this.fetchFn ?? fetch, this.endpoint, this.debug);
    }
  }

  apiKeySource(): ApiKeySource {
    return this.credential?.source ?? 'none';
  }

  /**
   * Stream one Messages API call, gated by the optional concurrency semaphore.
   * When a cap is set, the permit is held for the WHOLE streaming lifetime
   * (acquire before the request, release when the generator finishes, returns,
   * throws, or is closed early by the consumer) — so a slow consumer keeps its
   * slot exactly as long as its HTTP stream stays open. No cap -> straight
   * passthrough, zero overhead.
   */
  async *stream(req: StreamRequest): AsyncGenerator<RawMessageStreamEvent, void> {
    if (!this.slots) {
      yield* this.streamRequest(req);
      return;
    }
    // Pass the caller signal so a queued acquirer aborts promptly instead of
    // blocking on someone else's in-flight stream (interrupt()/teardown).
    const release = await this.slots.acquire(req.signal);
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
        'No Anthropic credential found. Set options.provider.apiKey / ' +
          'options.provider.authToken or the ANTHROPIC_API_KEY / ' +
          'ANTHROPIC_AUTH_TOKEN environment variable.',
      );
    }
    const { signal: callerSignal, onRetry, ...requestBody } = req;
    if (callerSignal?.aborted) throw new AbortError();

    // Finding L5 — drop any thinking block that carries an EMPTY signature
    // before it reaches the wire. A prior malformed/gateway-rewritten stream
    // can finalize a thinking block without its signature_delta; re-sending
    // that block 400s the Messages API ("invalid thinking signature") and kills
    // every later turn of the conversation. Well-formed streams always sign
    // their thinking, so this is a NO-OP (byte-identical body) on every normal
    // and conformance path — it only activates on the rare unsigned case.
    const sanitizedMessages = stripUnsignedThinking(requestBody.messages);
    const wireBody =
      sanitizedMessages === requestBody.messages
        ? requestBody
        : { ...requestBody, messages: sanitizedMessages };

    // JSON.stringify drops undefined-valued fields, satisfying "omit
    // undefined fields" without manual pruning. onRetry (a function) is
    // destructured out above so it never reaches the body.
    const bodyJson = JSON.stringify({ ...wireBody, stream: true });
    const headers = this.buildHeaders(this.credential);
    const timeoutMs = this.provider.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxRetries = resolveMaxRetries(this.provider, this.env);

    // Body-governance rule (resilience P1, keeper ruling 2026-07-10): the
    // whole-request timeout governs the REQUEST phase (connect -> response
    // headers). The streaming body is governed by the idle watchdog (which the
    // API's periodic pings keep honest) plus the optional hard cap
    // streamMaxDurationMs — so a healthy long turn is never cut down mid-flow
    // by a clock that ignores progress. Fallback: when the idle watchdog is
    // explicitly disabled AND no hard cap is set, the request timeout keeps
    // governing the body too, so no configuration is ever unbounded.
    const streamMaxMs = resolveStreamMaxMs(this.provider, this.env);

    // Empty-stream retry: an HTTP 200 whose SSE body carries ZERO events (not
    // even message_start) before closing is a replay-SAFE non-start — the
    // gateway accepted the request but delivered nothing (an observed idealab
    // throttle shape under concurrent fan-out). Unlike a mid-stream drop (which
    // must never replay a partially consumed turn), zero events means zero
    // consumption, so re-issuing the whole request is safe. We retry it HERE,
    // inside the transport, so BOTH the main conversation and subagents (which
    // run on this same transport, out of reach of any host-level retry) self-
    // heal without the caller ever seeing the empty stream. Bounded by the same
    // maxRetries budget; on exhaustion we surface a retryable-class
    // `empty_stream` APIConnectionError rather than returning a zero-event
    // stream and letting the engine fall through to accumulator.finalize()'s
    // raw `Protocol error: finalize before message_start`.
    let emptyStreamRetries = 0;
    // Finding T2 — ONE retry budget shared by the request-phase retries AND the
    // empty-stream re-issues. Previously each empty-stream re-issue called
    // requestWithRetries afresh with the FULL maxRetries, so a gateway that
    // alternates errors and empty-200s could burn ~maxRetries² POSTs on an
    // already-struggling endpoint. Threading one `{ used }` counter caps the
    // total extra POSTs at maxRetries (so maxRetries+1 attempts overall).
    const retryBudget = { used: 0 };
    for (;;) {
      // ---- request phase: retries allowed ---------------------------------
      const { response, signal, timeoutSignal, detachRequestTimeout, releaseSignals } =
        await this.requestWithRetries(
          bodyJson,
          headers,
          callerSignal,
          timeoutMs,
          maxRetries,
          retryBudget,
          onRetry,
        );

      // ---- streaming phase: NEVER retried once an event is delivered -------
      const requestId = response.headers.get('request-id') ?? undefined;
      if (!response.body) {
        throw new APIConnectionError('Messages API response has no body');
      }
      // Idle watchdog: abort a silently-stalled stream after `idleMs` with no
      // server event — faster and more diagnosable than the whole-request
      // timeout. Anthropic emits periodic `ping` events, so a gap this long
      // means the connection is stuck. `0` disables. Official env analogs
      // (CLAUDE_ENABLE_STREAM_WATCHDOG / CLAUDE_STREAM_IDLE_TIMEOUT_MS) are
      // honored below the provider option. (Design ref: Codex
      // `stream_idle_timeout`; reimplemented, no code copied.) A STALLED stream
      // (connected, then silent) is distinct from an EMPTY one (closed at once,
      // no event): the watchdog handles the former, the eventCount check below
      // handles the latter.
      const idleMs = resolveStreamIdleMs(this.provider, this.env);
      const idleController = idleMs > 0 ? new AbortController() : undefined;
      // P1 body governance: once headers have arrived, stop propagating the
      // whole-request timeout into the stream — UNLESS both body governors
      // (idle watchdog, hard cap) are off, in which case the request timeout
      // stays wired as the fallback bound (never-unbounded invariant).
      const timeoutDetached = idleController !== undefined || streamMaxMs > 0;
      if (timeoutDetached) detachRequestTimeout();
      // Optional hard cap on total streaming duration (streamMaxDurationMs /
      // BPT_STREAM_MAX_DURATION_MS; 0 = disabled). Unlike the idle watchdog it
      // fires even on a flowing stream; when it does, delivered-whole blocks
      // remain salvageable (midStreamTruncation).
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
      // Lazily re-armed: the per-event cost is ONE timestamp write, not a
      // clearTimeout+setTimeout pair — a stream of thousands of small deltas
      // no longer churns a timer per event. The single timer wakes at the
      // earliest possible expiry and either fires (gap since the last event
      // reached idleMs) or re-arms for exactly the remaining gap, so the
      // abort still lands idleMs after the LAST event — same semantics as
      // the per-event reset, at ~1 timer per idle window instead of 1 per
      // event.
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      let lastEventAt = 0;
      const armIdle = (delay: number): void => {
        idleTimer = setTimeout(() => {
          const remaining = idleMs - (Date.now() - lastEventAt);
          if (remaining <= 0) idleController!.abort();
          else armIdle(remaining);
        }, delay);
        // Don't let the watchdog alone keep the process alive.
        (idleTimer as { unref?: () => void }).unref?.();
      };
      const resetIdle = (): void => {
        lastEventAt = Date.now();
        if (!idleController || idleTimer !== undefined) return;
        armIdle(idleMs);
      };
      let eventCount = 0;
      let sawMessageStart = false;
      // Finding M2 — whether a terminal message_delta.stop_reason arrived. If
      // it did, the message content is complete even without the trailing
      // message_stop frame; if it did not and CONTENT was already delivered,
      // the server dropped mid-generation (a truncation, not a completion).
      let sawStopReason = false;
      // Whether any content_block_start arrived: distinguishes a start-only
      // stream (empty, benign — returns normally, the deliberate existing
      // behavior) from one that delivered a PARTIAL answer then dropped.
      let sawContentBlock = false;
      try {
        resetIdle();
        for await (const frame of parseSSE(response.body, streamSignal)) {
          resetIdle();
          let parsed: unknown;
          try {
            parsed = JSON.parse(frame.data);
          } catch (err) {
            // Anthropic-native frames ALWAYS carry an event name. An event-less
            // frame that is not JSON is foreign framing noise from a translating
            // gateway - the canonical case is an OpenAI-style `data: [DONE]`
            // terminator appended after the Anthropic event stream (observed on
            // a corporate gateway's /api/anthropic endpoint, 2026-07-05). The
            // official client never trips on it because it stops consuming at
            // message_stop; skipping here aligns tolerance without loosening
            // anything on real Anthropic frames.
            if (frame.event === undefined) {
              this.debug(
                `transport: skipping event-less non-JSON SSE frame after ${eventCount} event(s): ` +
                  frame.data.slice(0, 120),
              );
              continue;
            }
            throw new APIConnectionError(
              `Malformed SSE payload for event "${frame.event}" after ${eventCount} event(s): ` +
                frame.data.slice(0, 120),
              err,
              'sse_malformed_frame',
            );
          }
          if (frame.event === 'error' || isErrorPayload(parsed)) {
            const info = extractErrorPayload(parsed) ?? {
              type: 'api_error',
              message: frame.data,
            };
            // An in-stream error frame carries no HTTP status (the response was
            // 200). Prefer a `status` the gateway put IN the body (the wrapped
            // { error: { status } } shape), else derive one from the error type.
            throw new APIStatusError(
              info.status ?? statusForErrorType(info.type),
              info.type,
              info.message,
              info.requestId ?? requestId,
              info.code !== undefined ? { providerErrorCode: info.code } : undefined,
            );
          }
          eventCount += 1;
          // Track the message's actual BEGINNING separately from the raw frame
          // count: a `ping` keep-alive counts as a processed frame (diagnostics)
          // but is NOT the message starting. The empty-stream check below keys
          // on this, so a ping-then-close stream (no message_start) is still
          // treated as an empty non-start and retried — instead of skipping the
          // retry and letting the accumulator throw "finalize before message_start".
          if ((parsed as { type?: string }).type === 'message_start') {
            sawMessageStart = true;
          }
          // Finding M2 — a message_delta with a non-null stop_reason marks the
          // content as complete (message_stop merely closes the SSE channel).
          const parsedType = (parsed as { type?: string }).type;
          if (parsedType === 'content_block_start') sawContentBlock = true;
          if (parsedType === 'message_delta') {
            const sr = (parsed as { delta?: { stop_reason?: unknown } }).delta?.stop_reason;
            if (sr !== null && sr !== undefined) sawStopReason = true;
          }
          // T3 (NOT changed — WAI): a ping keep-alive is yielded to the consumer
          // as it arrives, deliberately. Live ping delivery is load-bearing (the
          // idle-watchdog / hard-cap / progress paths and their tests rely on the
          // consumer seeing keep-alives in real time). The theoretical "a
          // discarded empty-retry attempt's pings reach the consumer" leak is
          // harmless (pings carry no content; the accumulator ignores them), so
          // it is not worth buffering pings and degrading live delivery.
          yield parsed as RawMessageStreamEvent;
          // The Messages API streams exactly one message; message_stop is its
          // terminal event. Stop consuming here - official-client lifecycle -
          // so trailing gateway appendices (e.g. `data: [DONE]`) are never
          // parsed at all and the connection is released promptly. parseSSE's
          // finally cancels the underlying reader on early return.
          if ((parsed as { type?: string }).type === 'message_stop') {
            // C (keeper ruling 2026-07-13): a message_stop preceded by NO
            // terminal stop_reason AND no content is a degraded 200 — the API
            // always emits message_delta.stop_reason before message_stop. Do
            // NOT accept it as a complete empty success (the BPT "空 stopReason
            // 轮次" shape) and do NOT retry it (a started stream is not
            // replay-safe). Surface a diagnosable, NON-replay-safe error
            // (no turnReplaySafe / midStreamTruncation flags) so the engine
            // reports error_during_execution instead of a silent empty turn.
            if (sawMessageStart && !sawStopReason && !sawContentBlock) {
              throw new APIConnectionError(
                `Messages API sent message_stop after message_start with no content ` +
                  `and no stop_reason (${eventCount} event(s)); treating as a failed turn`,
                undefined,
                'empty_message',
              );
            }
            this.debug(
              `transport: stream completed at message_stop after ${eventCount} event(s)`,
            );
            return;
          }
        }
      } catch (err) {
        throw mapStreamError(err, {
          callerSignal,
          timeoutSignal,
          timeoutMs,
          timeoutGovernsBody: !timeoutDetached,
          eventCount,
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

      // The stream ended without a terminal message_stop. No message_start =>
      // the body never began (replay-safe): retry the whole request within the
      // shared budget instead of returning an unusable stream. Keys on
      // sawMessageStart, not eventCount, so a stream of ONLY ping keep-alives
      // (no message_start) is still recognized as an empty non-start rather than
      // slipping through to the accumulator's raw "finalize before message_start".
      // Any caller abort observed here wins over the retry.
      if (!sawMessageStart) {
        if (callerSignal?.aborted) throw new AbortError();
        if (retryBudget.used < maxRetries) {
          retryBudget.used += 1;
          emptyStreamRetries += 1;
          this.debug(
            `transport: empty stream (HTTP 200, no message_start); ` +
              `retry ${retryBudget.used}/${maxRetries}`,
          );
          // Surface it like a network-level retry (no HTTP status) so the loop
          // emits an api_retry observability message, same as a dropped socket.
          onRetry?.({ attempt: retryBudget.used, maxRetries, kind: 'empty_stream' });
          await this.backoff(retryBudget.used, undefined, callerSignal);
          continue;
        }
        throw new APIConnectionError(
          `Messages API returned an empty stream (HTTP 200, no message_start) ` +
            `after ${emptyStreamRetries + 1} attempt(s)`,
          undefined,
          'empty_stream',
        );
      }

      // C (keeper ruling 2026-07-13): message_start arrived but the stream
      // closed with NO content AND no terminal stop_reason — the degraded 200
      // that produced the BPT "空 stopReason 轮次" (an empty assistant billed as
      // a null-stop_reason success). Surface a diagnosable, NON-replay-safe
      // error instead; a started stream is not replay-safe, so it is NOT
      // retried (respecting the "no phantom empty-retry" contract). This sits
      // between the no-message_start empty-retry above (sawMessageStart is
      // guaranteed true here) and the mid-stream-truncation salvage below
      // (which needs sawContentBlock).
      if (!sawStopReason && !sawContentBlock) {
        if (callerSignal?.aborted) throw new AbortError();
        throw new APIConnectionError(
          `Messages API stream started (message_start) but delivered no content ` +
            `and no stop_reason (${eventCount} event(s)); treating as a failed turn`,
          undefined,
          'empty_message',
        );
      }

      // A non-empty stream that ended without message_stop (server closed after
      // delivering some events). Finding M2: if PARTIAL CONTENT was delivered
      // and no terminal message_delta.stop_reason arrived, the server dropped
      // MID-GENERATION — surface a truncated turn (midStreamTruncation) so the
      // engine's E3 salvage runs and the fault shows up in the result's
      // `errors`, matching the OpenAI arm, instead of silently accepting a
      // half-received answer as a complete, billed success. A start-only stream
      // (no content_block) or one whose stop_reason DID arrive (only the
      // trailing message_stop frame was lost) is complete enough — finalize
      // normally, preserving the deliberate existing behavior.
      if (sawContentBlock && !sawStopReason) {
        if (callerSignal?.aborted) throw new AbortError();
        const failure = new APIConnectionError(
          `Messages API stream ended without message_stop after ${eventCount} event(s); ` +
            `treating as a truncated turn`,
        );
        failure.midStreamTruncation = true;
        throw failure;
      }
      this.debug(`transport: stream completed after ${eventCount} event(s)`);
      return;
    }
  }

  /**
   * Issue the POST with retry policy: 429/408/5xx (incl. 529) and network
   * errors retry with exponential backoff + jitter, honoring `retry-after`
   * (seconds). Other 4xx fail immediately. Returns the accepted response
   * along with the signals governing its body, after which no retry ever
   * happens (mid-stream failures must not replay a partially consumed turn).
   */
  private async requestWithRetries(
    bodyJson: string,
    headers: Record<string, string>,
    callerSignal: AbortSignal | undefined,
    timeoutMs: number,
    maxRetries: number,
    // Finding T2 — shared retry budget (see streamRequest). Both request-phase
    // retries here and empty-stream re-issues in the caller draw from it, so the
    // total is bounded by maxRetries rather than maxRetries per re-issue.
    retryBudget: { used: number },
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
          `transport: POST ${this.endpoint} (attempt ${retryBudget.used + 1}/${maxRetries + 1})`,
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
        if (retryBudget.used < maxRetries) {
          retryBudget.used += 1;
          this.debug(
            `transport: network error (${errorMessage(err)}); retry ${retryBudget.used}/${maxRetries}`,
          );
          onRetry?.({
            attempt: retryBudget.used,
            maxRetries,
            kind: 'network',
            message: errorMessage(err),
          });
          await this.backoff(retryBudget.used, undefined, callerSignal);
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

      // Request id: prefer the response header, fall back to a request_id the
      // gateway put in the error body.
      const requestId =
        response.headers.get('request-id') ?? undefined;
      // Keep the abort listeners attached while draining the error body: the
      // per-attempt signal is wired into the response stream, so a caller
      // interrupt (or the request timeout) can still cancel a gateway that
      // sent error headers and then stalled the body; the drain itself is
      // additionally capped by ERROR_BODY_TIMEOUT_MS (audit 2026-07-14 H-1).
      const info = await readErrorInfo(response, signal).finally(releaseSignals);
      if (callerSignal?.aborted) throw new AbortError();
      const resolvedRequestId = requestId ?? info.requestId;
      const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
      const retryable =
        response.status === 408 || response.status === 429 || response.status >= 500;
      if (retryable && retryBudget.used < maxRetries) {
        retryBudget.used += 1;
        this.debug(
          `transport: HTTP ${response.status} (${info.type}); retry ${retryBudget.used}/${maxRetries}`,
        );
        onRetry?.({
          attempt: retryBudget.used,
          maxRetries,
          status: response.status,
          errorType: info.type,
          kind: 'http_status',
          message: info.message,
          ...(resolvedRequestId !== undefined ? { requestId: resolvedRequestId } : {}),
          ...(info.code !== undefined ? { code: info.code } : {}),
          ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
        });
        await this.backoff(retryBudget.used, retryAfterMs, callerSignal);
        continue;
      }
      throw new APIStatusError(
        response.status,
        info.type,
        info.message,
        resolvedRequestId,
        {
          ...(info.code !== undefined ? { providerErrorCode: info.code } : {}),
          ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
        },
      );
    }
  }

  /** Exponential backoff (base 1s, factor 2) with jitter; an explicit
   *  retry-after wins and is honored AS GIVEN (already bounded by the parser).
   *  Only the exponential fallback is capped at BACKOFF_MAX_MS — clamping an
   *  explicit "wait 90s" down to 60s just retries early into the same limit. */
  private async backoff(
    attempt: number,
    retryAfterMs: number | undefined,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const exponential = BACKOFF_BASE_MS * BACKOFF_FACTOR ** (attempt - 1);
    // Bounded jitter in [0.5, 1.0] x the exponential delay.
    const jittered = exponential * (0.5 + Math.random() * 0.5);
    const delay = retryAfterMs ?? Math.min(jittered, BACKOFF_MAX_MS);
    this.debug(`transport: backing off ${Math.round(delay)}ms`);
    await sleep(delay, signal);
  }

  private buildHeaders(credential: ResolvedCredential): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'anthropic-version': this.provider.apiVersion ?? DEFAULT_API_VERSION,
      'user-agent': USER_AGENT,
    };
    // defaultHeaders may override the defaults; normalize keys to lowercase
    // so 'Content-Type' and 'content-type' cannot produce duplicate entries.
    for (const [key, value] of Object.entries(this.provider.defaultHeaders ?? {})) {
      headers[key.toLowerCase()] = value;
    }
    if (this.betas && this.betas.length > 0) {
      const existing = headers['anthropic-beta'];
      const flags = this.betas.join(',');
      headers['anthropic-beta'] = existing ? `${existing},${flags}` : flags;
    }
    // The resolved credential is authoritative over defaultHeaders.
    headers[credential.header] = credential.value;
    return headers;
  }
}

// ---------------------------------------------------------------------------
// Helpers (module-private)
// ---------------------------------------------------------------------------

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.length > 0 ? value : undefined;
}

/**
 * Finding L5 — drop assistant `thinking` blocks whose signature is empty before
 * they hit the Anthropic wire (an unsigned thinking block 400s on resend). Pure
 * and reference-preserving: returns the SAME array when no block needs removing,
 * so a well-formed request (every thinking block signed) is byte-identical and
 * the conformance/byte-diff suites are untouched. Only the rare unsigned block —
 * produced by a malformed/gateway-rewritten upstream stream — is stripped.
 */
function stripUnsignedThinking(messages: APIMessageParam[]): APIMessageParam[] {
  const isUnsignedThinking = (b: ContentBlockParam): boolean =>
    b.type === 'thinking' &&
    (typeof (b as { signature?: unknown }).signature !== 'string' ||
      (b as { signature: string }).signature.length === 0);

  let changed = false;
  const out = messages.map((msg) => {
    if (msg.role !== 'assistant' || !Array.isArray(msg.content)) return msg;
    if (!msg.content.some(isUnsignedThinking)) return msg;
    changed = true;
    return { ...msg, content: msg.content.filter((b) => !isUnsignedThinking(b)) };
  });
  return changed ? out : messages;
}

function envInt(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

/**
 * Retry-count resolution: provider.maxRetries (explicit override, uncapped) >
 * CLAUDE_CODE_MAX_RETRIES env (official semantics: capped at 15) > official
 * default 10.
 */
export function resolveMaxRetries(
  provider: ProviderConfig,
  env: Record<string, string | undefined>,
): number {
  if (provider.maxRetries !== undefined) return Math.max(0, provider.maxRetries);
  const fromEnv = envInt(env.CLAUDE_CODE_MAX_RETRIES);
  if (fromEnv !== undefined) return Math.min(fromEnv, ENV_MAX_RETRIES_CAP);
  return DEFAULT_MAX_RETRIES;
}

/**
 * Concurrency-cap resolution: provider.maxConcurrentRequests (explicit
 * override) > BPT_MAX_CONCURRENT_REQUESTS env > 0 (unlimited).
 */
export function resolveMaxConcurrent(
  provider: ProviderConfig,
  env: Record<string, string | undefined>,
): number {
  if (provider.maxConcurrentRequests !== undefined) {
    return Math.max(0, Math.floor(provider.maxConcurrentRequests));
  }
  return envInt(env.BPT_MAX_CONCURRENT_REQUESTS) ?? 0;
}

/**
 * Minimal FIFO counting semaphore. `acquire()` resolves once a permit is free
 * and returns the matching `release`; excess acquirers queue in order. Used to
 * bound concurrent in-flight streams through one transport. A permit handed
 * directly to the next waiter never round-trips through the counter, so no
 * permit is lost under contention.
 */
export class RequestSemaphore {
  private permits: number;
  private readonly waiters: Array<() => void> = [];
  constructor(permits: number) {
    this.permits = permits;
  }
  /**
   * Acquire a permit, resolving with the matching `release`. An optional
   * `signal` makes a QUEUED acquirer abortable: without it, a caller that
   * aborts while waiting for a permit stays blocked until an unrelated in-flight
   * stream frees one, so interrupt()/teardown could hang for the length of
   * someone else's minutes-long stream. On abort the waiter is removed from the
   * queue and the promise rejects with AbortError.
   */
  acquire(signal?: AbortSignal): Promise<() => void> {
    return new Promise<() => void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new AbortError());
        return;
      }
      let released = false;
      const releaseOnce = (): void => {
        if (released) return;
        released = true;
        this.release();
      };
      let onAbort: (() => void) | undefined;
      const grant = (): void => {
        if (onAbort !== undefined && signal !== undefined) {
          signal.removeEventListener('abort', onAbort);
        }
        resolve(releaseOnce);
      };
      if (this.permits > 0) {
        this.permits -= 1;
        grant();
        return;
      }
      this.waiters.push(grant);
      if (signal !== undefined) {
        onAbort = (): void => {
          // Only reject if the permit was NOT already handed to this waiter.
          // release() shifts + calls grant() synchronously, so the two can only
          // race by ORDER, never interleave: if grant() ran it removed this
          // listener (so we never get here); if we run first, the waiter is
          // still queued and we remove it, and a later release() hands its
          // permit to the next waiter instead. If grant already dequeued us
          // (indexOf -1), it will resolve with releaseOnce and the aborting
          // caller releases the permit in its own finally — do not reject.
          const idx = this.waiters.indexOf(grant);
          if (idx >= 0) {
            this.waiters.splice(idx, 1);
            reject(new AbortError());
          }
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }
  private release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.permits += 1;
  }
}

/**
 * Stream idle-watchdog resolution: provider.streamIdleTimeoutMs (explicit
 * override, unclamped; 0 disables) > CLAUDE_ENABLE_STREAM_WATCHDOG=0 (official
 * off switch) > CLAUDE_STREAM_IDLE_TIMEOUT_MS env (official semantics: clamped
 * to the 300000 minimum) > official default 300000.
 */
export function resolveStreamIdleMs(
  provider: ProviderConfig,
  env: Record<string, string | undefined>,
): number {
  if (provider.streamIdleTimeoutMs !== undefined) {
    return Math.max(0, provider.streamIdleTimeoutMs);
  }
  if (env.CLAUDE_ENABLE_STREAM_WATCHDOG === '0') return 0;
  const fromEnv = envInt(env.CLAUDE_STREAM_IDLE_TIMEOUT_MS);
  if (fromEnv !== undefined) return Math.max(fromEnv, DEFAULT_STREAM_IDLE_MS);
  return DEFAULT_STREAM_IDLE_MS;
}

/**
 * Streaming hard-cap resolution: provider.streamMaxDurationMs (explicit
 * override; 0 disables) > BPT_STREAM_MAX_DURATION_MS env > 0 (disabled — the
 * default; the idle watchdog is the primary body governor). BPT-EXTENSION.
 */
export function resolveStreamMaxMs(
  provider: ProviderConfig,
  env: Record<string, string | undefined>,
): number {
  if (provider.streamMaxDurationMs !== undefined) {
    return Math.max(0, provider.streamMaxDurationMs);
  }
  return envInt(env.BPT_STREAM_MAX_DURATION_MS) ?? 0;
}

/**
 * Credential resolution order per spec: provider.apiKey ->
 * env.ANTHROPIC_API_KEY (x-api-key), else provider.authToken ->
 * env.ANTHROPIC_AUTH_TOKEN (Authorization: Bearer). 'user' = provider
 * config, 'project' = environment, 'none' = unresolved.
 */
function resolveCredential(
  provider: ProviderConfig,
  env: Record<string, string | undefined>,
): ResolvedCredential | null {
  const providerKey = nonEmpty(provider.apiKey);
  if (providerKey) return { header: 'x-api-key', value: providerKey, source: 'user' };
  const envKey = nonEmpty(env.ANTHROPIC_API_KEY);
  if (envKey) return { header: 'x-api-key', value: envKey, source: 'project' };
  const providerToken = nonEmpty(provider.authToken);
  if (providerToken) {
    return { header: 'authorization', value: `Bearer ${providerToken}`, source: 'user' };
  }
  const envToken = nonEmpty(env.ANTHROPIC_AUTH_TOKEN);
  if (envToken) {
    return { header: 'authorization', value: `Bearer ${envToken}`, source: 'project' };
  }
  return null;
}

/** True for an SSE frame payload that is actually an ERROR — the native
 *  `{ type: 'error' }` frame OR a gateway that wrapped an upstream failure as a
 *  bare `{ error: {...} }` / `{ message, status }` object with no `type:'error'`
 *  discriminator (the穿透 case this normalization work closes). A real stream
 *  event always carries a known `type`, so `looksLikeErrorObject` cannot swallow
 *  one (it requires either a nested `error` object or a `type`-less body). */
function isErrorPayload(parsed: unknown): boolean {
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    (parsed as { type?: unknown }).type === 'error'
  ) {
    return true;
  }
  return looksLikeErrorObject(parsed);
}

/** Diagnostic fields lifted from an API error payload. `status`/`code`/
 *  `requestId` are present only when the body carried them. */
type ErrorPayloadInfo = {
  type: string;
  message: string;
  status?: number;
  code?: string;
  requestId?: string;
};

/** Extract `{ error: { type, message, code, status, request_id } }` (or the bare
 *  top-level `{ message, status, code, request_id }`) from an API error payload. */
function extractErrorPayload(parsed: unknown): ErrorPayloadInfo | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const top = parsed as Record<string, unknown>;
  const error =
    typeof top.error === 'object' && top.error !== null
      ? (top.error as Record<string, unknown>)
      : undefined;
  // The `type` slug (Anthropic vocabulary) lives on the error envelope when
  // present, else on the top-level object.
  const typeSrc = error?.type ?? top.type;
  const type =
    typeof typeSrc === 'string' && typeSrc !== 'error' ? typeSrc : 'api_error';
  // Delegate message/status/code/request_id extraction to the shared, redacting
  // normalizer helper so both arms agree on the field spellings.
  const obj = extractProviderErrorObject(parsed);
  if (obj === null) {
    // Neither a nested error nor a usable message: keep the old behavior of
    // stringifying the error envelope (bounded by the normalizer elsewhere).
    if (error === undefined) return null;
    return { type, message: JSON.stringify(error) };
  }
  return {
    type,
    message: obj.message,
    ...(obj.status !== undefined ? { status: obj.status } : {}),
    ...(obj.code !== undefined ? { code: obj.code } : {}),
    ...(obj.requestId !== undefined ? { requestId: obj.requestId } : {}),
  };
}

function statusForErrorType(errorType: string): number {
  return ERROR_TYPE_STATUS[errorType] ?? 500;
}

/** Read and classify a non-2xx response body (best effort, never throws). A
 *  non-JSON body (e.g. a plain-text "Internal server error" 500 page) yields a
 *  readable message rather than an opaque object. */
/** Hard cap on draining a non-2xx error body. A gateway that returns error
 *  headers and then stalls the body must not hang the retry loop forever —
 *  the default 'node' http client has no body timeout of its own. On expiry
 *  the body is cancelled best-effort and the status-line fallback is used
 *  (audit 2026-07-14 H-1). */
const ERROR_BODY_TIMEOUT_MS = 10_000;

/** Read a response body as text, bounded by ERROR_BODY_TIMEOUT_MS and the
 *  given abort signal. Rejection means "body unavailable" — callers fall
 *  back to the status line. */
function readBodyTextBounded(
  response: Response,
  signal: AbortSignal | undefined,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const cancelBody = (): void => {
      void response.body?.cancel().catch(() => {});
    };
    const onAbort = (): void => {
      cancelBody();
      settle(() => reject(new AbortError()));
    };
    const timer = setTimeout(() => {
      cancelBody();
      settle(() => reject(new APIConnectionError('error body read timed out')));
    }, ERROR_BODY_TIMEOUT_MS);
    (timer as { unref?: () => void }).unref?.();
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    response.text().then(
      (text) => settle(() => resolve(text)),
      (err) => settle(() => reject(err instanceof Error ? err : new Error(String(err)))),
    );
  });
}

async function readErrorInfo(
  response: Response,
  signal?: AbortSignal,
): Promise<ErrorPayloadInfo> {
  let text = '';
  try {
    text = await readBodyTextBounded(response, signal);
  } catch {
    // Body unavailable (aborted / half-closed / stalled past the drain cap);
    // fall through to the fallback.
  }
  if (text) {
    try {
      const info = extractErrorPayload(JSON.parse(text));
      if (info) return info;
    } catch {
      // Not JSON; use raw text below.
    }
  }
  return {
    type: 'api_error',
    message: text.slice(0, 2_000) || `HTTP ${response.status} ${response.statusText}`,
  };
}

/** Parse a retry-after header given in seconds; anything else is ignored. */
/** A server Retry-After is honored fully up to this ceiling, so a busy gateway's
 *  "wait 90s" is respected instead of clamped to the exponential cap and retried
 *  early. Bounded so a pathological "Retry-After: 99999" cannot hang the agent. */
const RETRY_AFTER_MAX_MS = 120_000;

function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  // delta-seconds form (the common case).
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, RETRY_AFTER_MAX_MS);
  }
  // HTTP-date form (RFC 7231, e.g. "Wed, 21 Oct 2026 07:28:00 GMT") — proxies
  // and CDNs commonly emit it; the wait is the delta from now. Was previously
  // dropped (Number() -> NaN), silently falling back to exponential backoff.
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) {
    const delta = dateMs - Date.now();
    // the date already passed -> retry now
    if (delta <= 0) return 0;
    return Math.min(delta, RETRY_AFTER_MAX_MS);
  }
  return undefined;
}

/**
 * Map a streaming-phase failure to the public error surface. Caller aborts
 * win over everything except deliberate APIStatusError throws; per-request
 * timeouts and transport failures surface as APIConnectionError.
 */
type StreamErrorContext = {
  callerSignal: AbortSignal | undefined;
  timeoutSignal: AbortSignal;
  timeoutMs: number;
  timeoutGovernsBody: boolean;
  eventCount: number;
  idleSignal?: AbortSignal;
  idleMs?: number;
  maxSignal?: AbortSignal;
  streamMaxMs?: number;
};

function mapStreamError(err: unknown, ctx: StreamErrorContext): Error {
  const { callerSignal, timeoutSignal, timeoutMs, eventCount } = ctx;
  // Disconnect-taxonomy flags (resilience P0/P1): every terminal stream error
  // carries the pair the engine acts on — `midStreamTruncation` (events were
  // delivered whole; salvage may apply) and `turnReplaySafe` (NOTHING was
  // delivered, so re-issuing the turn cannot double-consume content or tool
  // side effects; the engine may replay within its bounded budget).
  const flag = (failure: APIConnectionError): APIConnectionError => {
    failure.turnReplaySafe = eventCount === 0;
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
        `Messages API stream idle for ${ctx.idleMs}ms with no server event after ` +
          `${eventCount} event(s); aborted`,
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
        `Messages API stream exceeded the streamMaxDurationMs hard cap ` +
          `(${ctx.streamMaxMs}ms) after ${eventCount} event(s); aborted`,
        err,
        'stream_max_duration',
      ),
    );
    failure.midStreamTruncation = eventCount > 0;
    return failure;
  }
  // Whole-request timeout during the body: only reachable in the fallback
  // configuration (idle watchdog disabled, no hard cap). Delivered-whole
  // blocks stay salvageable here too (P1: salvage-on-timeout).
  if (ctx.timeoutGovernsBody && timeoutSignal.aborted) {
    const failure = flag(
      new APIConnectionError(
        `Messages API stream timed out after ${timeoutMs}ms`,
        err,
      ),
    );
    failure.midStreamTruncation = eventCount > 0;
    return failure;
  }
  if (err instanceof APIConnectionError) return err;
  if (isAbortError(err)) {
    return err instanceof AbortError ? err : new AbortError(errorMessage(err));
  }
  const failure = flag(
    new APIConnectionError(
      `Messages API stream failed after ${eventCount} event(s): ${errorMessage(err)}`,
      err,
    ),
  );
  // E3: a connection that dropped after delivering events is a TRUNCATED
  // turn - the engine may salvage the completed blocks (official 2.1.201
  // does; conformance run-l4 KD-L4-02/04).
  failure.midStreamTruncation = eventCount > 0;
  return failure;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Abortable sleep; rejects with AbortError when the signal fires. */
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
