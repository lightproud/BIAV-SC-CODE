/**
 * BPT Agent SDK - direct Anthropic Messages API transport.
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
import type {
  ApiKeySource,
  ProviderConfig,
  RawMessageStreamEvent,
} from '../types.js';
import type { RetryInfo, StreamRequest, Transport } from '../internal/contracts.js';
import { parseSSE } from './sse.js';

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_API_VERSION = '2023-06-01';
const DEFAULT_TIMEOUT_MS = 600_000;
/** Default idle watchdog: abort a stalled stream after this gap with no event. */
const DEFAULT_STREAM_IDLE_MS = 120_000;
const DEFAULT_MAX_RETRIES = 4;
const USER_AGENT = 'bpt-agent-sdk/0.1.0';
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
  private readonly debug: (m: string) => void;
  private readonly betas: string[] | undefined;
  private readonly credential: ResolvedCredential | null;
  private readonly endpoint: string;

  constructor(cfg: TransportConfig) {
    this.provider = cfg.provider ?? {};
    this.debug = cfg.debug;
    this.betas = cfg.betas;
    this.credential = resolveCredential(this.provider, cfg.env);
    const base = (
      this.provider.baseUrl ??
      nonEmpty(cfg.env.ANTHROPIC_BASE_URL) ??
      DEFAULT_BASE_URL
    ).replace(/\/+$/, '');
    this.endpoint = `${base}/v1/messages`;
  }

  apiKeySource(): ApiKeySource {
    return this.credential?.source ?? 'none';
  }

  async *stream(req: StreamRequest): AsyncGenerator<RawMessageStreamEvent, void> {
    if (!this.credential) {
      throw new ConfigurationError(
        'No Anthropic credential found. Set options.provider.apiKey / ' +
          'options.provider.authToken or the ANTHROPIC_API_KEY / ' +
          'ANTHROPIC_AUTH_TOKEN environment variable.',
      );
    }
    const { signal: callerSignal, onRetry, ...requestBody } = req;
    if (callerSignal?.aborted) throw new AbortError();

    // JSON.stringify drops undefined-valued fields, satisfying "omit
    // undefined fields" without manual pruning. onRetry (a function) is
    // destructured out above so it never reaches the body.
    const bodyJson = JSON.stringify({ ...requestBody, stream: true });
    const headers = this.buildHeaders(this.credential);
    const timeoutMs = this.provider.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxRetries = Math.max(0, this.provider.maxRetries ?? DEFAULT_MAX_RETRIES);

    // ---- request phase: retries allowed -----------------------------------
    const { response, signal, timeoutSignal } = await this.requestWithRetries(
      bodyJson,
      headers,
      callerSignal,
      timeoutMs,
      maxRetries,
      onRetry,
    );

    // ---- streaming phase: NEVER retried ------------------------------------
    const requestId = response.headers.get('request-id') ?? undefined;
    if (!response.body) {
      throw new APIConnectionError('Messages API response has no body');
    }
    // Idle watchdog: abort a silently-stalled stream after `idleMs` with no
    // server event — faster and more diagnosable than the whole-request
    // timeout. Anthropic emits periodic `ping` events, so a gap this long means
    // the connection is stuck. `0` disables. (Design ref: Codex
    // `stream_idle_timeout`; reimplemented, no code copied.)
    const idleMs = this.provider.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_MS;
    const idleController = idleMs > 0 ? new AbortController() : undefined;
    const streamSignal = idleController
      ? AbortSignal.any([signal, idleController.signal])
      : signal;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const resetIdle = (): void => {
      if (!idleController) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => idleController.abort(), idleMs);
      // Don't let the watchdog alone keep the process alive.
      (idleTimer as { unref?: () => void }).unref?.();
    };
    let eventCount = 0;
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
          );
        }
        if (frame.event === 'error' || isErrorPayload(parsed)) {
          const info = extractErrorPayload(parsed) ?? {
            type: 'api_error',
            message: frame.data,
          };
          throw new APIStatusError(
            statusForErrorType(info.type),
            info.type,
            info.message,
            requestId,
          );
        }
        eventCount += 1;
        yield parsed as RawMessageStreamEvent;
        // The Messages API streams exactly one message; message_stop is its
        // terminal event. Stop consuming here - official-client lifecycle -
        // so trailing gateway appendices (e.g. `data: [DONE]`) are never
        // parsed at all and the connection is released promptly. parseSSE's
        // finally cancels the underlying reader on early return.
        if ((parsed as { type?: string }).type === 'message_stop') {
          this.debug(
            `transport: stream completed at message_stop after ${eventCount} event(s)`,
          );
          return;
        }
      }
    } catch (err) {
      throw mapStreamError(
        err,
        callerSignal,
        timeoutSignal,
        timeoutMs,
        eventCount,
        idleController?.signal,
        idleMs,
      );
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
    }
    this.debug(`transport: stream completed after ${eventCount} event(s)`);
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
    onRetry?: (info: RetryInfo) => void,
  ): Promise<{ response: Response; signal: AbortSignal; timeoutSignal: AbortSignal }> {
    let attempt = 0;
    for (;;) {
      if (callerSignal?.aborted) throw new AbortError();
      // Fresh timeout per attempt; it also bounds body consumption because
      // fetch ties the response stream to its signal.
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const signal = callerSignal
        ? AbortSignal.any([callerSignal, timeoutSignal])
        : timeoutSignal;

      let response: Response;
      try {
        this.debug(
          `transport: POST ${this.endpoint} (attempt ${attempt + 1}/${maxRetries + 1})`,
        );
        response = await fetch(this.endpoint, {
          method: 'POST',
          headers,
          body: bodyJson,
          signal,
        });
      } catch (err) {
        if (callerSignal?.aborted) throw new AbortError();
        // Connection failure or per-attempt timeout: retryable.
        if (attempt < maxRetries) {
          attempt += 1;
          this.debug(
            `transport: network error (${errorMessage(err)}); retry ${attempt}/${maxRetries}`,
          );
          onRetry?.({ attempt, maxRetries });
          await this.backoff(attempt, undefined, callerSignal);
          continue;
        }
        throw new APIConnectionError(
          `Failed to reach ${this.endpoint}: ${errorMessage(err)}`,
          err,
        );
      }

      if (response.ok) return { response, signal, timeoutSignal };

      const requestId = response.headers.get('request-id') ?? undefined;
      const info = await readErrorInfo(response);
      const retryable =
        response.status === 408 || response.status === 429 || response.status >= 500;
      if (retryable && attempt < maxRetries) {
        attempt += 1;
        const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
        this.debug(
          `transport: HTTP ${response.status} (${info.type}); retry ${attempt}/${maxRetries}`,
        );
        onRetry?.({
          attempt,
          maxRetries,
          status: response.status,
          errorType: info.type,
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
    // Bounded jitter in [0.5, 1.0] x the exponential delay.
    const jittered = exponential * (0.5 + Math.random() * 0.5);
    const delay = Math.min(retryAfterMs ?? jittered, BACKOFF_MAX_MS);
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

function isErrorPayload(parsed: unknown): boolean {
  return (
    typeof parsed === 'object' &&
    parsed !== null &&
    (parsed as { type?: unknown }).type === 'error'
  );
}

/** Extract `{ error: { type, message } }` from an API error payload. */
function extractErrorPayload(
  parsed: unknown,
): { type: string; message: string } | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const error = (parsed as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return null;
  const type = (error as { type?: unknown }).type;
  const message = (error as { message?: unknown }).message;
  return {
    type: typeof type === 'string' ? type : 'api_error',
    message: typeof message === 'string' ? message : JSON.stringify(error),
  };
}

function statusForErrorType(errorType: string): number {
  return ERROR_TYPE_STATUS[errorType] ?? 500;
}

/** Read and classify a non-2xx response body (best effort, never throws). */
async function readErrorInfo(
  response: Response,
): Promise<{ type: string; message: string }> {
  let text = '';
  try {
    text = await response.text();
  } catch {
    // Body unavailable (aborted/half-closed); fall through to the fallback.
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
function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, BACKOFF_MAX_MS);
  }
  return undefined;
}

/**
 * Map a streaming-phase failure to the public error surface. Caller aborts
 * win over everything except deliberate APIStatusError throws; per-request
 * timeouts and transport failures surface as APIConnectionError.
 */
function mapStreamError(
  err: unknown,
  callerSignal: AbortSignal | undefined,
  timeoutSignal: AbortSignal,
  timeoutMs: number,
  eventCount: number,
  idleSignal?: AbortSignal,
  idleMs?: number,
): Error {
  if (err instanceof APIStatusError) return err;
  if (callerSignal?.aborted) {
    return err instanceof AbortError ? err : new AbortError();
  }
  // Idle watchdog fired (checked before the whole-request timeout, which it
  // pre-empts): the stream stalled with no server event. Distinct, diagnosable
  // message; terminal (the streaming phase is never retried).
  if (idleSignal?.aborted && !timeoutSignal.aborted) {
    return new APIConnectionError(
      `Messages API stream idle for ${idleMs}ms with no server event after ` +
        `${eventCount} event(s); aborted`,
      err,
    );
  }
  if (timeoutSignal.aborted) {
    return new APIConnectionError(
      `Messages API stream timed out after ${timeoutMs}ms`,
      err,
    );
  }
  if (err instanceof APIConnectionError) return err;
  if (isAbortError(err)) {
    return err instanceof AbortError ? err : new AbortError(errorMessage(err));
  }
  const failure = new APIConnectionError(
    `Messages API stream failed after ${eventCount} event(s): ${errorMessage(err)}`,
    err,
  );
  // E3: a connection that dropped after delivering events is a TRUNCATED
  // turn - the engine may salvage the completed blocks (official 2.1.201
  // does; conformance run-l4 KD-L4-02/04). Timeout/idle/abort branches above
  // never carry this flag.
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
