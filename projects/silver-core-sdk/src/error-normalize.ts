/**
 * Silver Core SDK — unified upstream-error normalization (BPT P1, keeper ruling
 * 2026-07-14).
 *
 * PROBLEM this closes: a gateway that wraps an upstream failure as a TOP-LEVEL
 *   { error: { message, code, status } }
 * (no `type: 'error'` discriminator, no SSE `event: error` name) slipped past
 * the Anthropic arm's `type === 'error'` error detector — it was neither
 * recognized as an error NOR a valid stream event, so the raw object穿透ed to
 * the host, bypassing BPT's retry / error chain. The host saw a bare 500 with
 * no way to tell provider, retryability, or request id.
 *
 * This module is the ONE place that turns ANY upstream failure shape — an
 * `APIStatusError`, an `APIConnectionError`, a gateway error object, a plain
 * `Error`, or an opaque value — into a STABLE `NormalizedProviderError` the
 * host can consume without parsing English or duck-typing raw objects.
 *
 * REDACTION (硬约束): the normalized error carries only a de-identified
 * diagnostic summary — never an API key, Authorization header, request body,
 * image bytes, or a full response dump. `message` is the upstream error text
 * (bounded + scrubbed); the raw error object is NOT attached.
 */

import {
  APIConnectionError,
  APIStatusError,
  AbortError,
  errorCodeOf,
} from './errors.js';
import { sliceSurrogateSafe } from './internal/text.js';

/**
 * The stable, host-consumable shape every upstream failure normalizes to.
 * Additive surface: fields are only ever appended, never renamed/removed.
 */
export interface NormalizedProviderError {
  /** Error class / family name (e.g. 'APIStatusError', 'APIConnectionError'). */
  name: string;
  /** Human-readable text. NEVER `[object Object]` — objects are summarized. */
  message: string;
  /** HTTP status extracted from the response or the error object, when known. */
  status?: number;
  /** Machine-readable provider error code (e.g. 'rate_limit_error'), when known. */
  code?: string;
  /** Provider / protocol label ('anthropic' | 'openai' | ...), when known. */
  provider?: string;
  /** Model in play when the failure occurred, when known. */
  model?: string;
  /** Upstream request id (body `request_id`/`requestId` or `x-request-id` header). */
  requestId?: string;
  /** Whether re-issuing is safe per the default retry policy (see isRetryableHttpStatus). */
  retryable: boolean;
  /** Server-requested wait before retrying (Retry-After), when present. */
  retryAfterMs?: number;
  /** Where in the request lifecycle the failure surfaced. */
  phase?: 'request' | 'stream' | 'response' | 'transport';
  /** The SDK-internal error code / raw type slug, for diagnostics. */
  rawType?: string;
}

/** Optional context the caller (engine) can supply to enrich the summary. */
export interface NormalizeContext {
  provider?: string;
  model?: string;
  /** Extra request-id source (e.g. a response header) when the error omits one. */
  requestId?: string;
  phase?: NormalizedProviderError['phase'];
}

/**
 * Default HTTP retryability policy (keeper table 2026-07-14):
 *   - 408 (request timeout) and 429 (rate limit) → retryable
 *   - any 5xx (500/502/503/504/…) → retryable (treated as a TRANSIENT provider
 *     fault; the engine's replay-safe rules still gate whether an ALREADY-started
 *     turn may be replayed — this only says "the status class is retryable")
 *   - every other 4xx (400/401/403/404/422/…) → NOT retryable
 * Deliberately status-based: it never string-matches "quota"/"allocation" to
 * force a non-retry, so a rate-limit (429) stays retryable and is not mistaken
 * for a terminal key/permission failure.
 */
export function isRetryableHttpStatus(status: number): boolean {
  if (status === 408 || status === 429) return true;
  return status >= 500 && status < 600;
}

/** Redact common secret shapes from a diagnostic string (defensive). Upstream
 *  error messages should not carry credentials, but a gateway that echoes a
 *  request header could; scrub before the text leaves this layer. */
function redact(text: string): string {
  return text
    // Bearer / Basic auth tokens.
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._\-+/=]+/gi, '$1 [REDACTED]')
    // Provider API-key shapes (sk-..., sk-ant-..., and generic long key tails).
    .replace(/\bsk-[A-Za-z0-9_\-]{6,}/g, 'sk-[REDACTED]')
    // x-api-key: <value> style leaks.
    .replace(/(x-api-key|api[_-]?key|authorization)(["']?\s*[:=]\s*["']?)[^\s"',}]+/gi,
      '$1$2[REDACTED]');
}

/** Bound a message so a giant HTML/JSON error page cannot bloat the surface. */
function boundMessage(text: string): string {
  const trimmed = text.trim();
  const scrubbed = redact(trimmed);
  // audit r4 R7s-7: surrogate-safe cut so truncating mid astral codepoint
  // (emoji / CJK Ext-B) in a giant error page cannot leave a lone surrogate on
  // the surface (which would serialize to U+FFFD on every replay).
  return scrubbed.length > 2_000 ? `${sliceSurrogateSafe(scrubbed, 2_000)}…` : scrubbed;
}

/** Pull a numeric HTTP status out of an arbitrary error-ish object. Some
 *  gateways serialize the status as a JSON STRING ("503"); a pure 3-digit
 *  string is unambiguous, so accept it too (T5) — otherwise a retryable 5xx
 *  classified as non-retryable purely for arriving quoted. */
function pickStatus(obj: Record<string, unknown>): number | undefined {
  const candidates = [obj.status, obj.statusCode, obj.status_code, obj.code];
  for (const c of candidates) {
    const n =
      typeof c === 'number'
        ? c
        : typeof c === 'string' && /^\d{3}$/.test(c.trim())
          ? Number(c.trim())
          : undefined;
    if (n !== undefined && Number.isFinite(n) && n >= 100 && n < 600) return n;
  }
  return undefined;
}

/** Pull a machine code slug out of an arbitrary error-ish object. A numeric
 *  `code` (some gateways put the HTTP status there) is NOT a slug. */
function pickCode(obj: Record<string, unknown>): string | undefined {
  const raw = obj.code ?? obj.type ?? obj.error_code;
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

/** JSON.stringify that upholds this layer's "never throws" contract: a circular
 *  envelope, a BigInt field, or a throwing getter would otherwise raise (audit
 *  r4 R7j-2 — reachable via a live-throwing object). Falls back to a
 *  de-identified shape summary. */
function safeStringify(obj: Record<string, unknown>): string {
  try {
    const s = JSON.stringify(obj);
    return typeof s === 'string' ? s : summarizeObject(obj);
  } catch {
    return summarizeObject(obj);
  }
}

/** Request-id under any of the accepted spellings, top-level or nested. */
function pickRequestId(obj: Record<string, unknown>): string | undefined {
  const keys = ['request_id', 'requestId', 'x-request-id', 'X-Request-Id'];
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

/**
 * Extract the salient fields from a gateway/provider ERROR OBJECT — either the
 * wrapped `{ error: { message, code, status, request_id } }` form or the bare
 * top-level `{ message, status, code, request_id }` form. Returns null when the
 * value is not a recognizable error object.
 */
export function extractProviderErrorObject(value: unknown): {
  message: string;
  status?: number;
  code?: string;
  requestId?: string;
} | null {
  if (typeof value !== 'object' || value === null) return null;
  const top = value as Record<string, unknown>;
  // Prefer the nested `error` envelope when present.
  const nested =
    typeof top.error === 'object' && top.error !== null
      ? (top.error as Record<string, unknown>)
      : undefined;

  // Some gateways put a bare STRING in `error` ({ error: 'rate limited',
  // status: 503 }) — treat it as the message so the sibling status/code are
  // not lost to the generic fallback (which would report retryable:false).
  const errString =
    typeof top.error === 'string' && top.error.length > 0 ? top.error : undefined;

  const messageSrc = nested?.message ?? top.message ?? errString;
  // A bare object with neither a message nor an error envelope is not one of the
  // error shapes we own — let the caller fall back to its own handling.
  if (nested === undefined && typeof messageSrc !== 'string') return null;

  const message =
    typeof messageSrc === 'string'
      ? messageSrc
      : nested !== undefined
        ? // Nested error object with a non-string message: stringify the error
          // envelope (bounded + secret-scrubbed by boundMessage below), matching
          // the historical extractErrorPayload behavior. safeStringify keeps the
          // "never throws" contract for a circular/BigInt envelope (audit r4 R7j-2).
          safeStringify(nested)
        : safeStringify(top);

  const status = (nested && pickStatus(nested)) ?? pickStatus(top);
  const code = (nested && pickCode(nested)) ?? pickCode(top);
  const requestId = (nested && pickRequestId(nested)) ?? pickRequestId(top);

  const out: {
    message: string;
    status?: number;
    code?: string;
    requestId?: string;
  } = { message: boundMessage(message) };
  if (status !== undefined) out.status = status;
  if (code !== undefined) out.code = code;
  if (requestId !== undefined) out.requestId = requestId;
  return out;
}

/** A compact, de-identified one-liner for an object that has no usable message
 *  — reports only its shape (top-level keys), never its values. */
function summarizeObject(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).slice(0, 12).join(', ');
  return `provider error object {${keys}}`;
}

/** True when `value` is a raw error object shape (used at detection sites to
 *  recognize a gateway error that carries no `type: 'error'` discriminator and
 *  no SSE `event: error` name). */
export function looksLikeErrorObject(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  // Nested { error: {...} } envelope.
  if (typeof obj.error === 'object' && obj.error !== null) return true;
  // String-error form { error: 'rate limited', status: 503 } — same guard as
  // below: a real stream event always carries a `type` discriminator, and we
  // additionally require a status so plain content objects are never swallowed.
  if (
    obj.type === undefined &&
    typeof obj.error === 'string' &&
    obj.error.length > 0 &&
    typeof pickStatus(obj) === 'number'
  ) {
    return true;
  }
  // Bare { message, status } with no stream-event `type` (real stream events
  // ALWAYS carry a known `type` discriminator, so this cannot swallow one).
  return (
    obj.type === undefined &&
    typeof obj.message === 'string' &&
    typeof pickStatus(obj) === 'number'
  );
}

/** Retryability for an APIConnectionError, honoring the existing replay-safe
 *  contract (a turn that already started streaming is NOT freely replayable). */
function connectionRetryable(err: APIConnectionError): boolean {
  if (err.turnReplaySafe === true) return true;
  if (err.midStreamTruncation === true) return false;
  switch (err.code) {
    case 'api_connection_failed':
    case 'stream_idle_timeout':
    case 'empty_stream':
      return true;
    // A started stream that produced nothing usable, a corrupt frame, or a
    // hard-cap cut is NOT safe to blind-retry here.
    case 'sse_malformed_frame':
    case 'empty_message':
    case 'stream_max_duration':
      return false;
    default:
      return true;
  }
}

function connectionPhase(err: APIConnectionError): NormalizedProviderError['phase'] {
  // A truncation / mid-stream drop happened DURING streaming regardless of the
  // class-default code; only a pre-stream connect failure is 'transport'.
  if (err.midStreamTruncation === true) return 'stream';
  return err.code === 'api_connection_failed' ? 'transport' : 'stream';
}

/** Transient transport-level Node / undici error codes. A fetch that failed at
 *  the socket layer consumed no response body, so re-issuing the whole request
 *  is safe — the same replay-safe class as a pre-stream APIConnectionError. */
const RETRYABLE_NETWORK_CODES = new Set<string>([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

/** A retryability/status signal recovered from a nested (cause / aggregated)
 *  sub-error by signalFromNested. */
interface NestedErrorSignal {
  status?: number;
  code?: string;
  requestId?: string;
  retryable: boolean;
  phase?: NormalizedProviderError['phase'];
}

/**
 * audit r4 Y6-2: the plain-Error branch classified only the TOP-LEVEL error, so
 * the real fault a runtime hides underneath was lost — undici wraps it as
 * `err.cause` (`TypeError('fetch failed', { cause: <ECONNREFUSED> })`) and
 * `AggregateError` buckets several into `err.errors` (`AggregateError([<429>])`).
 * The wrapper carries no status and no network code of its own, so the turn was
 * mis-reported as terminal (retryable:false) when the buried cause was in fact a
 * retryable transport failure or a 429/5xx. Walk the cause + aggregate graph
 * (breadth-first, cycle-guarded via `seen`, depth-bounded) for the first
 * sub-error that carries a real signal. Never throws (mirrors the module
 * contract); extraction is guarded and only `.cause`/`.errors` are traversed.
 */
function signalFromNested(root: unknown): NestedErrorSignal | null {
  const seen = new Set<unknown>();
  const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  while (stack.length > 0) {
    const item = stack.shift();
    if (item === undefined) break;
    const { value, depth } = item;
    if (value === null || value === undefined || seen.has(value) || depth > 8) continue;
    seen.add(value);

    // A typed status / connection sub-error is authoritative.
    if (value instanceof APIStatusError) {
      return {
        status: value.status,
        code: value.providerErrorCode ?? value.errorType,
        requestId: value.requestId,
        retryable: isRetryableHttpStatus(value.status),
        phase: 'response',
      };
    }
    if (value instanceof APIConnectionError) {
      return {
        code: value.code,
        retryable: connectionRetryable(value),
        phase: connectionPhase(value),
      };
    }

    // A raw gateway error object a runtime hung on the cause, carrying a status.
    let obj: ReturnType<typeof extractProviderErrorObject> = null;
    try {
      obj = extractProviderErrorObject(value);
    } catch {
      obj = null;
    }
    if (obj?.status !== undefined) {
      return {
        status: obj.status,
        code: obj.code,
        requestId: obj.requestId,
        retryable: isRetryableHttpStatus(obj.status),
        phase: 'response',
      };
    }

    // A transient Node/undici transport error (the ECONNREFUSED case).
    if (typeof value === 'object') {
      const nodeCode = (value as { code?: unknown }).code;
      if (typeof nodeCode === 'string' && RETRYABLE_NETWORK_CODES.has(nodeCode)) {
        return { code: nodeCode, retryable: true, phase: 'transport' };
      }
      const agg = (value as { errors?: unknown }).errors;
      if (Array.isArray(agg)) {
        for (const e of agg) stack.push({ value: e, depth: depth + 1 });
      }
      const cause = (value as { cause?: unknown }).cause;
      if (cause !== undefined) stack.push({ value: cause, depth: depth + 1 });
    }
  }
  return null;
}

/**
 * Normalize ANY thrown upstream failure into a `NormalizedProviderError`.
 * Never throws; always returns a fully-formed object with a readable message.
 */
export function normalizeProviderError(
  err: unknown,
  ctx: NormalizeContext = {},
): NormalizedProviderError {
  const base = (over: Partial<NormalizedProviderError>): NormalizedProviderError => {
    const out: NormalizedProviderError = {
      name: over.name ?? 'ProviderError',
      message: over.message ?? 'Unknown provider error',
      retryable: over.retryable ?? false,
    };
    const status = over.status ?? undefined;
    const code = over.code ?? undefined;
    const requestId = over.requestId ?? ctx.requestId;
    const provider = over.provider ?? ctx.provider;
    const model = over.model ?? ctx.model;
    const retryAfterMs = over.retryAfterMs;
    const phase = over.phase ?? ctx.phase;
    const rawType = over.rawType;
    if (status !== undefined) out.status = status;
    if (code !== undefined) out.code = code;
    if (provider !== undefined) out.provider = provider;
    if (model !== undefined) out.model = model;
    if (requestId !== undefined) out.requestId = requestId;
    if (retryAfterMs !== undefined) out.retryAfterMs = retryAfterMs;
    if (phase !== undefined) out.phase = phase;
    if (rawType !== undefined) out.rawType = rawType;
    return out;
  };

  // 1) Non-2xx / in-stream provider status error — the richest source.
  if (err instanceof APIStatusError) {
    return base({
      name: err.name,
      message: boundMessage(err.message),
      status: err.status,
      // Prefer the body's own code slug (E6c providerErrorCode) over the
      // Anthropic-vocabulary errorType the transport normalized to.
      code: err.providerErrorCode ?? err.errorType,
      requestId: err.requestId,
      retryable: isRetryableHttpStatus(err.status),
      retryAfterMs: err.retryAfterMs,
      phase: 'response',
      rawType: err.errorType,
    });
  }

  // 2) Transport / stream connection failure.
  if (err instanceof APIConnectionError) {
    return base({
      name: err.name,
      message: boundMessage(err.message),
      code: err.code,
      retryable: connectionRetryable(err),
      phase: connectionPhase(err),
      rawType: err.code,
    });
  }

  // 3) Abort — a caller cancellation, not an upstream fault; never retryable.
  if (err instanceof AbortError || (err instanceof Error && err.name === 'AbortError')) {
    return base({
      name: 'AbortError',
      message: boundMessage(err instanceof Error ? err.message : 'The operation was aborted'),
      retryable: false,
      phase: 'request',
      rawType: 'aborted',
    });
  }

  // 4) An Error that reached us un-classified. Its OWN name / errorCodeOf are
  // the truth (T1: extractProviderErrorObject used to run first, and since any
  // Error has a string .message it swallowed EVERY Error — name was forced to
  // 'ProviderError' and rawType to 'provider_error_object', so e.g. McpError
  // lost its identity and the plain-Error branch was dead code). Provider-
  // shaped extras (status / code / requestId, possibly from a nested envelope
  // a gateway hung on the Error) are still harvested — guarded, because the
  // extraction stringifies nested envelopes and a circular one would throw,
  // violating the "never throws" contract (T2).
  if (err instanceof Error) {
    let obj: ReturnType<typeof extractProviderErrorObject> = null;
    try {
      obj = extractProviderErrorObject(err);
    } catch {
      obj = null;
    }
    const sdkCode = errorCodeOf(err);
    let status = obj?.status;
    let code = obj?.code ?? sdkCode;
    let requestId = obj?.requestId;
    let retryable = status !== undefined ? isRetryableHttpStatus(status) : false;
    let phase: NormalizedProviderError['phase'] | undefined =
      status !== undefined ? 'response' : undefined;
    // audit r4 Y6-2: when the wrapper itself yielded no status/retryable signal,
    // adopt the most informative buried cause / AggregateError member so a
    // `fetch failed`(cause:ECONNREFUSED) stays retryable and an
    // AggregateError([429]) is not mis-reported as terminal.
    if (status === undefined && !retryable) {
      const nested = signalFromNested(err);
      if (nested !== null) {
        status = nested.status ?? status;
        code = code ?? nested.code;
        requestId = requestId ?? nested.requestId;
        retryable = nested.retryable;
        phase = phase ?? nested.phase;
      }
    }
    return base({
      name: err.name || 'Error',
      message: boundMessage(err.message || String(err)),
      status,
      code,
      requestId,
      retryable,
      ...(phase !== undefined ? { phase } : {}),
      rawType: sdkCode,
    });
  }

  // 5) A raw gateway error object that reached us un-classified (the穿透
  // case). Guarded for the same T2 reason as the Error branch above.
  let obj: ReturnType<typeof extractProviderErrorObject> = null;
  try {
    obj = extractProviderErrorObject(err);
  } catch {
    obj = null;
  }
  if (obj !== null) {
    const status = obj.status;
    return base({
      name: 'ProviderError',
      message: obj.message,
      status,
      code: obj.code,
      requestId: obj.requestId,
      retryable: status !== undefined ? isRetryableHttpStatus(status) : false,
      phase: 'response',
      rawType: 'provider_error_object',
    });
  }

  // 6) Anything else (string / number / null) — summarized, never bare-cast.
  return base({
    name: 'ProviderError',
    message: boundMessage(typeof err === 'string' ? err : summarizeObject(Object(err))),
    retryable: false,
  });
}

/** Source fields carried on a retry observation, mirrored from the transport's
 *  `RetryInfo` so a retry event can carry a full `NormalizedProviderError`. */
export interface RetryLike {
  status?: number;
  code?: string;
  message?: string;
  requestId?: string;
  retryAfterMs?: number;
  kind?: 'network' | 'http_status' | 'empty_stream';
}

/**
 * Build a `NormalizedProviderError` for a RETRY that is about to happen (the
 * transport signaled it via onRetry, before the next attempt). The retry itself
 * proves the failure was retryable, so `retryable` is true here regardless of
 * status class.
 */
export function normalizeRetry(
  info: RetryLike,
  ctx: NormalizeContext = {},
): NormalizedProviderError {
  const name =
    info.kind === 'network'
      ? 'APIConnectionError'
      : info.kind === 'empty_stream'
        ? 'APIConnectionError'
        : 'APIStatusError';
  const out: NormalizedProviderError = {
    name,
    message:
      info.message !== undefined && info.message.length > 0
        ? boundMessage(info.message)
        : info.status !== undefined
          ? `HTTP ${info.status} (retrying)`
          : info.kind === 'empty_stream'
            ? 'Empty stream (retrying)'
            : 'Connection failure (retrying)',
    retryable: true,
    phase: info.kind === 'http_status' ? 'response' : 'transport',
  };
  if (info.status !== undefined) out.status = info.status;
  if (info.code !== undefined) out.code = info.code;
  if (info.retryAfterMs !== undefined) out.retryAfterMs = info.retryAfterMs;
  const requestId = info.requestId ?? ctx.requestId;
  if (requestId !== undefined) out.requestId = requestId;
  if (ctx.provider !== undefined) out.provider = ctx.provider;
  if (ctx.model !== undefined) out.model = ctx.model;
  return out;
}
