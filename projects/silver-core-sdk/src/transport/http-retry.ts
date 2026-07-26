/**
 * Silver Core SDK - HTTP request/retry layer shared by the Anthropic Messages
 * and OpenAI Chat Completions transports (module A).
 *
 * Both arms drive a streaming POST against a provider gateway, and the
 * *transport-shaped* half of that job — retry policy, backoff arithmetic,
 * per-attempt abort composition, bounded error-body drain, Retry-After
 * parsing, stream-failure classification — is provider-INDEPENDENT. Only
 * three things ever differed between the two copies: the debug prefix, which
 * header carries the request id, and how the error body is parsed. Those are
 * parameters here; everything else lives once.
 *
 * Before this module the two files carried byte-identical copies of
 * `sleep` / `errorMessage` / `nonEmpty` / `readBodyTextBounded` and
 * near-identical copies of `parseRetryAfterMs` / `backoff` /
 * `requestWithRetries` / `mapStreamError` (~350 lines), which is how a fix to
 * one arm (the L-2 Retry-After jitter, the H-1 drain cap) had to be applied
 * twice by hand to stay honest.
 */

import { AbortError, APIConnectionError, APIStatusError, isAbortError } from '../errors.js';
import type { RetryInfo } from '../internal/contracts.js';
import { SDK_USER_AGENT } from '../version.js';

export const DEFAULT_TIMEOUT_MS = 600_000;
/** setTimeout's signed-32-bit ceiling — the "effectively disabled" stand-in
 *  for timeoutMs:0 (AbortSignal.timeout has no "never" value). */
export const MAX_TIMEOUT_MS = 2_147_483_647;
export const USER_AGENT = SDK_USER_AGENT;
export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_FACTOR = 2;
export const BACKOFF_MAX_MS = 60_000;
/** Bounded jitter applied ON TOP of an explicit Retry-After delay (audit
 *  2026-07-14 L-2): the delay is multiplied by [1.0, 1.0 + this factor], so a
 *  concurrent fan-out (subagent fleets) does not retry at the same instant.
 *  Never retries EARLIER than the server asked; the jittered total stays
 *  capped at RETRY_AFTER_MAX_MS (the same ceiling the parser applies). */
export const RETRY_AFTER_JITTER = 0.25;
/** A server Retry-After is honored fully up to this ceiling, so a busy
 *  gateway's "wait 90s" is respected instead of clamped to the exponential cap
 *  and retried early. Bounded so a pathological "Retry-After: 99999" cannot
 *  hang the agent. */
export const RETRY_AFTER_MAX_MS = 120_000;
/** Hard cap on draining a non-2xx response body before giving up on it and
 *  falling back to the status line (audit 2026-07-14 H-1). */
export const ERROR_BODY_TIMEOUT_MS = 10_000;

export function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.length > 0 ? value : undefined;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Abortable sleep; rejects with AbortError when the signal fires. */
export function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
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

/** Read a response body as text, bounded by ERROR_BODY_TIMEOUT_MS and the
 *  given abort signal. Rejection means "body unavailable" — callers fall
 *  back to the status line. */
export function readBodyTextBounded(
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

/** Parse a Retry-After header. Both forms of RFC 7231 are honored: plain
 *  delta-seconds and an HTTP-date (proxies and CDNs commonly emit the latter;
 *  it was previously dropped, silently falling back to exponential backoff). */
export function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  // delta-seconds form (the common case). Only a plain decimal qualifies:
  // Number('') is 0 (not NaN), so a whitespace-only header would otherwise
  // return 0 (retry immediately) instead of being ignored; Number() also
  // over-accepts '0x1f'/'1e3'. A numeric-shape gate keeps those out.
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1_000, RETRY_AFTER_MAX_MS);
    }
  }
  // HTTP-date form (RFC 7231, e.g. "Wed, 21 Oct 2026 07:28:00 GMT").
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) {
    const delta = dateMs - Date.now();
    // the date already passed -> retry now
    if (delta <= 0) return 0;
    return Math.min(delta, RETRY_AFTER_MAX_MS);
  }
  return undefined;
}

/** Exponential backoff (base 1s, factor 2) with jitter. An explicit
 *  retry-after is honored as the FLOOR (never retried earlier) but jittered
 *  UP by RETRY_AFTER_JITTER so a concurrent fan-out does not all wake at the
 *  same instant, then re-capped at RETRY_AFTER_MAX_MS. Only the exponential
 *  fallback is capped at BACKOFF_MAX_MS — clamping an explicit "wait 90s"
 *  down to 60s just retries early into the same limit. */
export async function backoff(
  attempt: number,
  retryAfterMs: number | undefined,
  signal: AbortSignal | undefined,
  debug: (m: string) => void,
  debugPrefix: string,
): Promise<void> {
  const exponential = BACKOFF_BASE_MS * BACKOFF_FACTOR ** (attempt - 1);
  // Bounded jitter in [0.5, 1.0] x the exponential delay.
  const jittered = exponential * (0.5 + Math.random() * 0.5);
  // audit 2026-07-14 L-2: jitter the explicit Retry-After path too. Without
  // it a fan-out of subagents that all receive the same "Retry-After: 30"
  // wake in the SAME instant (thundering herd). Spread UP only — never
  // EARLIER than the server asked — then re-cap at the parser's ceiling so a
  // jittered value can never exceed RETRY_AFTER_MAX_MS.
  const delay =
    retryAfterMs !== undefined
      ? Math.min(retryAfterMs * (1 + Math.random() * RETRY_AFTER_JITTER), RETRY_AFTER_MAX_MS)
      : Math.min(jittered, BACKOFF_MAX_MS);
  debug(`${debugPrefix}: backing off ${Math.round(delay)}ms`);
  await sleep(delay, signal);
}

/** The provider-neutral shape both arms' error-body readers produce. */
export type TransportErrorInfo = {
  type: string;
  message: string;
  status?: number;
  code?: string;
  requestId?: string;
};

export type AcceptedResponse = {
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
};

export type RetryableRequest = {
  endpoint: string;
  bodyJson: string;
  headers: Record<string, string>;
  callerSignal: AbortSignal | undefined;
  timeoutMs: number;
  maxRetries: number;
  /** Finding T2 — shared retry budget: request-phase retries here and
   *  empty-stream re-issues in the caller both draw from it, so the total is
   *  bounded by maxRetries rather than maxRetries per re-issue. */
  retryBudget: { used: number };
  onRetry?: (info: RetryInfo) => void;
  /** undefined means "late-bind the CURRENT global fetch" (so a later
   *  setGlobalDispatcher / test stub still applies). */
  fetchFn: ((input: string | URL, init?: RequestInit) => Promise<Response>) | undefined;
  debug: (m: string) => void;
  /** Prefix on every debug line, e.g. 'transport' or 'openai transport'. */
  debugPrefix: string;
  /** Pull the provider's request id out of the response headers. */
  requestIdFrom: (headers: Headers) => string | undefined;
  /** Provider-specific error-body parse (already bounded internally). */
  readErrorInfo: (response: Response, signal?: AbortSignal) => Promise<TransportErrorInfo>;
};

/**
 * Issue the POST with retry policy: 429/408/5xx (incl. 529) and network
 * errors retry with exponential backoff + jitter, honoring `retry-after`
 * (seconds). Other 4xx fail immediately. Returns the accepted response
 * along with the signals governing its body, after which no retry ever
 * happens (mid-stream failures must not replay a partially consumed turn).
 */
export async function requestWithRetries(req: RetryableRequest): Promise<AcceptedResponse> {
  const {
    endpoint,
    bodyJson,
    headers,
    callerSignal,
    timeoutMs,
    maxRetries,
    retryBudget,
    onRetry,
    fetchFn,
    debug,
    debugPrefix,
    requestIdFrom,
    readErrorInfo,
  } = req;
  for (;;) {
    if (callerSignal?.aborted) throw new AbortError();
    // Fresh timeout per attempt, propagated into a DEDICATED per-attempt
    // controller so the body phase can later detach the timeout leg without
    // dropping the caller leg (AbortSignal.any is compose-once; a dedicated
    // controller is the only way to unsubscribe one source).
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const attemptController = new AbortController();
    const abortFromCaller = (): void =>
      attemptController.abort((callerSignal as { reason?: unknown } | undefined)?.reason);
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
      debug(`${debugPrefix}: POST ${endpoint} (attempt ${retryBudget.used + 1}/${maxRetries + 1})`);
      response = await (fetchFn ?? fetch)(endpoint, {
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
        debug(
          `${debugPrefix}: network error (${errorMessage(err)}); retry ${retryBudget.used}/${maxRetries}`,
        );
        onRetry?.({
          attempt: retryBudget.used,
          maxRetries,
          kind: 'network',
          message: errorMessage(err),
        });
        await backoff(retryBudget.used, undefined, callerSignal, debug, debugPrefix);
        continue;
      }
      throw new APIConnectionError(`Failed to reach ${endpoint}: ${errorMessage(err)}`, err);
    }

    if (response.ok) {
      return { response, signal, timeoutSignal, detachRequestTimeout, releaseSignals };
    }

    // Request id: prefer the response header, fall back to a request_id the
    // gateway put in the error body.
    const requestId = requestIdFrom(response.headers);
    // Keep the abort listeners attached while draining the error body: the
    // per-attempt signal is wired into the response stream, so a caller
    // interrupt (or the request timeout) can still cancel a gateway that
    // sent error headers and then stalled the body; the drain itself is
    // additionally capped by ERROR_BODY_TIMEOUT_MS (audit 2026-07-14 H-1).
    const info = await readErrorInfo(response, signal).finally(releaseSignals);
    if (callerSignal?.aborted) throw new AbortError();
    const resolvedRequestId = requestId ?? info.requestId;
    const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
    // A 429 whose machine code says the QUOTA is exhausted (OpenAI and
    // OpenAI-compat gateways surface `insufficient_quota`) is permanent for
    // this key — no amount of backoff revives a spent billing account, so
    // burning the full retry budget on it only delays the actionable error.
    // Keys on the documented machine code, not fuzzy message matching (an
    // ordinary 429 stays retryable); native Anthropic errors never carry this
    // code, so this is a no-op for them.
    const permanentQuota =
      response.status === 429 &&
      (info.code === 'insufficient_quota' || info.type === 'insufficient_quota');
    const retryable =
      !permanentQuota &&
      (response.status === 408 || response.status === 429 || response.status >= 500);
    if (retryable && retryBudget.used < maxRetries) {
      retryBudget.used += 1;
      debug(
        `${debugPrefix}: HTTP ${response.status} (${info.type}); retry ${retryBudget.used}/${maxRetries}`,
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
      await backoff(retryBudget.used, retryAfterMs, callerSignal, debug, debugPrefix);
      continue;
    }
    throw new APIStatusError(response.status, info.type, info.message, resolvedRequestId, {
      ...(info.code !== undefined ? { providerErrorCode: info.code } : {}),
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    });
  }
}

/**
 * Map a streaming-phase failure to the public error surface. Caller aborts
 * win over everything except deliberate APIStatusError throws; per-request
 * timeouts and transport failures surface as APIConnectionError.
 *
 * `apiLabel` / `unit` / `count` are the only provider-varying parts — the
 * Anthropic arm reports "Messages API ... N event(s)", the OpenAI arm
 * "Chat Completions ... N chunk(s)".
 */
export type StreamErrorContext = {
  callerSignal: AbortSignal | undefined;
  timeoutSignal: AbortSignal;
  timeoutMs: number;
  timeoutGovernsBody: boolean;
  /** Frames received so far (events for Anthropic, chunks for OpenAI). */
  count: number;
  sawMessageStart: boolean;
  idleSignal?: AbortSignal;
  idleMs?: number;
  maxSignal?: AbortSignal;
  streamMaxMs?: number;
  /** Human-facing API name in messages, e.g. 'Messages API'. */
  apiLabel: string;
  /** Singular noun for one received frame, e.g. 'event' or 'chunk'. */
  unit: string;
};

export function mapStreamError(err: unknown, ctx: StreamErrorContext): Error {
  const { callerSignal, timeoutSignal, timeoutMs, count, sawMessageStart, apiLabel, unit } = ctx;
  // Disconnect-taxonomy flags (resilience P0/P1): every terminal stream error
  // carries the pair the engine acts on — `midStreamTruncation` (events were
  // delivered whole; salvage may apply) and `turnReplaySafe` (NOTHING was
  // delivered, so re-issuing the turn cannot double-consume content or tool
  // side effects; the engine may replay within its bounded budget).
  // Both key on sawMessageStart, not the raw frame count: a `ping` keep-alive is a
  // processed frame but carries no message content, so a ping-only stream that
  // then dies is byte-for-byte the same silence as a zero-event one — it must
  // classify identically (replay-safe, nothing to salvage) instead of getting
  // the opposite disposition because a keep-alive happened to arrive first.
  const flag = (failure: APIConnectionError): APIConnectionError => {
    failure.turnReplaySafe = !sawMessageStart;
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
        `${apiLabel} stream idle for ${ctx.idleMs}ms with no server event after ` +
          `${count} ${unit}(s); aborted`,
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
        `${apiLabel} stream exceeded the streamMaxDurationMs hard cap ` +
          `(${ctx.streamMaxMs}ms) after ${count} ${unit}(s); aborted`,
        err,
        'stream_max_duration',
      ),
    );
    failure.midStreamTruncation = sawMessageStart;
    return failure;
  }
  // Whole-request timeout during the body: only reachable in the fallback
  // configuration (idle watchdog disabled, no hard cap). Delivered-whole
  // blocks stay salvageable here too (P1: salvage-on-timeout).
  if (ctx.timeoutGovernsBody && timeoutSignal.aborted) {
    const failure = flag(
      new APIConnectionError(
        `${apiLabel} stream timed out after ${timeoutMs}ms`,
        err,
      ),
    );
    failure.midStreamTruncation = sawMessageStart;
    return failure;
  }
  if (err instanceof APIConnectionError) return err;
  if (isAbortError(err)) {
    return err instanceof AbortError ? err : new AbortError(errorMessage(err));
  }
  const failure = flag(
    new APIConnectionError(
      `${apiLabel} stream failed after ${count} ${unit}(s): ${errorMessage(err)}`,
      err,
    ),
  );
  // E3: a connection that dropped after delivering events is a TRUNCATED
  // turn - the engine may salvage the completed blocks (official 2.1.201
  // does; conformance run-l4 KD-L4-02/04).
  failure.midStreamTruncation = sawMessageStart;
  return failure;
}

