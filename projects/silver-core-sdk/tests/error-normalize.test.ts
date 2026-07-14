/**
 * Unit tests for the unified upstream-error normalization layer
 * (src/error-normalize.ts, BPT P1 keeper ruling 2026-07-14).
 *
 * Covers: the gateway TOP-LEVEL `{ error: { message, code, status } }` shape
 * that穿透ed un-classified before this work, the bare `{ message, status }`
 * shape, non-JSON text, APIStatusError / APIConnectionError inputs, the retry
 * table (408/429/5xx retryable; 401/403/404/400 not), request-id spellings,
 * [object Object] non-regression, and redaction of secrets.
 */

import { describe, expect, it } from 'vitest';

import {
  APIConnectionError,
  APIStatusError,
  AbortError,
} from '../src/errors.js';
import {
  extractProviderErrorObject,
  isRetryableHttpStatus,
  looksLikeErrorObject,
  normalizeProviderError,
  normalizeRetry,
  type NormalizedProviderError,
} from '../src/error-normalize.js';

describe('isRetryableHttpStatus (default policy table)', () => {
  it('408 and 429 are retryable', () => {
    expect(isRetryableHttpStatus(408)).toBe(true);
    expect(isRetryableHttpStatus(429)).toBe(true);
  });

  it('every 5xx is retryable (transient provider fault)', () => {
    for (const s of [500, 502, 503, 504, 529]) {
      expect(isRetryableHttpStatus(s)).toBe(true);
    }
  });

  it('terminal 4xx are NOT retryable (missing model / perms / bad key / params)', () => {
    for (const s of [400, 401, 403, 404, 422]) {
      expect(isRetryableHttpStatus(s)).toBe(false);
    }
  });
});

describe('extractProviderErrorObject', () => {
  it('extracts the wrapped { error: { message, code, status } } shape', () => {
    const obj = extractProviderErrorObject({
      error: { message: 'Internal server error', code: null, status: 500 },
    });
    expect(obj).not.toBeNull();
    expect(obj!.message).toBe('Internal server error');
    expect(obj!.status).toBe(500);
    // code was null in the body -> not a usable slug -> undefined
    expect(obj!.code).toBeUndefined();
  });

  it('extracts a string code and body request_id', () => {
    const obj = extractProviderErrorObject({
      error: {
        message: 'overloaded',
        code: 'model_overloaded',
        status: 503,
        request_id: 'req_abc',
      },
    });
    expect(obj!.code).toBe('model_overloaded');
    expect(obj!.status).toBe(503);
    expect(obj!.requestId).toBe('req_abc');
  });

  it('extracts the bare top-level { message, status } shape', () => {
    const obj = extractProviderErrorObject({ message: 'Internal server error', status: 500 });
    expect(obj!.message).toBe('Internal server error');
    expect(obj!.status).toBe(500);
  });

  it('accepts every request-id spelling', () => {
    for (const key of ['request_id', 'requestId', 'x-request-id', 'X-Request-Id']) {
      const obj = extractProviderErrorObject({ message: 'x', status: 500, [key]: 'rid' });
      expect(obj!.requestId).toBe('rid');
    }
  });

  it('returns null for a non-error object (no message, no error envelope)', () => {
    expect(extractProviderErrorObject({ type: 'message_start' })).toBeNull();
    expect(extractProviderErrorObject(null)).toBeNull();
    expect(extractProviderErrorObject('nope')).toBeNull();
  });
});

describe('looksLikeErrorObject (SSE detection helper)', () => {
  it('recognizes the wrapped and bare error shapes', () => {
    expect(looksLikeErrorObject({ error: { message: 'x' } })).toBe(true);
    expect(looksLikeErrorObject({ message: 'x', status: 500 })).toBe(true);
  });

  it('does NOT swallow a real stream event (has a type discriminator)', () => {
    expect(looksLikeErrorObject({ type: 'message_start', message: {} })).toBe(false);
    expect(looksLikeErrorObject({ type: 'content_block_delta' })).toBe(false);
  });
});

describe('normalizeProviderError — gateway object (the穿透 case)', () => {
  it('normalizes { error: { message, code, status: 500 } } to a retryable 500', () => {
    const n = normalizeProviderError(
      { error: { message: 'Internal server error', code: null, status: 500, request_id: 'test-500' } },
      { provider: 'anthropic', model: 'claude-x' },
    );
    expect(n.status).toBe(500);
    expect(n.message).toBe('Internal server error');
    expect(n.retryable).toBe(true);
    expect(n.requestId).toBe('test-500');
    expect(n.provider).toBe('anthropic');
    expect(n.model).toBe('claude-x');
    expect(n.phase).toBe('response');
  });

  it('never serializes an object message to [object Object]', () => {
    const n = normalizeProviderError({ error: { code: 'x', status: 500 } });
    expect(n.message).not.toContain('[object Object]');
    expect(n.message.length).toBeGreaterThan(0);
  });
});

describe('normalizeProviderError — SDK error inputs', () => {
  it('maps an APIStatusError 500 to a retryable response error', () => {
    const err = new APIStatusError(500, 'api_error', 'Internal server error', 'rid-1', {
      providerErrorCode: 'server_error',
    });
    const n = normalizeProviderError(err);
    expect(n.name).toBe('APIStatusError');
    expect(n.status).toBe(500);
    expect(n.retryable).toBe(true);
    expect(n.requestId).toBe('rid-1');
    expect(n.code).toBe('server_error'); // body code wins over errorType
    expect(n.rawType).toBe('api_error');
    expect(n.phase).toBe('response');
  });

  it('maps an APIStatusError 401 to a NON-retryable error', () => {
    const n = normalizeProviderError(new APIStatusError(401, 'authentication_error', 'bad key'));
    expect(n.retryable).toBe(false);
    expect(n.code).toBe('authentication_error');
  });

  it('carries retryAfterMs from an APIStatusError', () => {
    const err = new APIStatusError(429, 'rate_limit_error', 'slow down', undefined, {
      retryAfterMs: 5_000,
    });
    const n = normalizeProviderError(err);
    expect(n.retryable).toBe(true);
    expect(n.retryAfterMs).toBe(5_000);
  });

  it('maps a network APIConnectionError to a retryable transport error', () => {
    const err = new APIConnectionError('socket hang up');
    err.turnReplaySafe = true;
    const n = normalizeProviderError(err);
    expect(n.name).toBe('APIConnectionError');
    expect(n.retryable).toBe(true);
    expect(n.phase).toBe('transport');
  });

  it('a mid-stream truncation is NOT freely retryable (replay-safe rules)', () => {
    const err = new APIConnectionError('dropped', undefined);
    err.midStreamTruncation = true;
    const n = normalizeProviderError(err);
    expect(n.retryable).toBe(false);
    expect(n.phase).toBe('stream');
  });

  it('an empty_message (started stream, no content) is NOT retryable', () => {
    const err = new APIConnectionError('empty message', undefined, 'empty_message');
    const n = normalizeProviderError(err);
    expect(n.retryable).toBe(false);
    expect(n.code).toBe('empty_message');
  });

  it('an AbortError is not an upstream fault and never retryable', () => {
    const n = normalizeProviderError(new AbortError());
    expect(n.name).toBe('AbortError');
    expect(n.retryable).toBe(false);
  });

  it('a plain Error keeps a readable message and is not retryable', () => {
    const n = normalizeProviderError(new Error('boom'));
    expect(n.message).toBe('boom');
    expect(n.retryable).toBe(false);
  });
});

describe('normalizeProviderError — redaction (硬约束)', () => {
  it('scrubs API keys, bearer tokens, and authorization from the message', () => {
    const n = normalizeProviderError({
      error: {
        message:
          'auth failed with Authorization: Bearer sk-ant-secret123456 and x-api-key: sk-abcdef_LEAK99',
        status: 401,
      },
    });
    expect(n.message).not.toContain('sk-ant-secret123456');
    expect(n.message).not.toContain('sk-abcdef_LEAK99');
    expect(n.message).not.toMatch(/Bearer\s+sk-/);
    expect(n.message).toContain('[REDACTED]');
  });

  it('bounds a giant error page so it cannot bloat the surface', () => {
    const big = 'x'.repeat(5_000);
    const n = normalizeProviderError({ message: big, status: 500 });
    expect(n.message.length).toBeLessThanOrEqual(2_001 + 1); // 2000 + ellipsis
  });
});

describe('normalizeRetry (retry-in-progress event)', () => {
  it('builds a retryable normalized error carrying status/code/requestId', () => {
    const n: NormalizedProviderError = normalizeRetry(
      {
        status: 503,
        errorType: 'overloaded_error',
        code: 'server_overloaded',
        message: 'Service Unavailable',
        requestId: 'rid-9',
        retryAfterMs: 2_000,
        kind: 'http_status',
      },
      { provider: 'anthropic', model: 'claude-x' },
    );
    expect(n.retryable).toBe(true);
    expect(n.status).toBe(503);
    expect(n.code).toBe('server_overloaded');
    expect(n.requestId).toBe('rid-9');
    expect(n.retryAfterMs).toBe(2_000);
    expect(n.provider).toBe('anthropic');
    expect(n.model).toBe('claude-x');
  });

  it('falls back to a readable message when the body carried none', () => {
    const n = normalizeRetry({ kind: 'network' });
    expect(n.message.length).toBeGreaterThan(0);
    expect(n.message).not.toContain('[object Object]');
  });
});
