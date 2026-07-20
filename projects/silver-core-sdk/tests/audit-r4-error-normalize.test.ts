/**
 * Regression tests for audit r4 fixes in src/error-normalize.ts.
 *
 *   - Y6-2  : the plain-Error branch never inspected `err.cause` or
 *             `AggregateError.errors`, so a `TypeError('fetch failed',
 *             { cause: ECONNREFUSED })` lost its retryable transport detail and
 *             an `AggregateError([429])` was mis-reported as retryable:false.
 *   - R7j-2 : extractProviderErrorObject's `JSON.stringify(nested/top)` could
 *             throw on a circular / BigInt envelope, breaking the "never throws"
 *             contract of this layer.
 *   - R7s-7 : boundMessage's `.slice(0, 2000)` could split a surrogate pair,
 *             leaving a lone surrogate on the error surface.
 */

import { describe, expect, it } from 'vitest';

import { APIConnectionError, APIStatusError } from '../src/errors.js';
import {
  extractProviderErrorObject,
  normalizeProviderError,
} from '../src/error-normalize.js';

// A high surrogate NOT followed by a low one, or a low NOT preceded by a high.
const LONE_HIGH = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/;
const LONE_LOW = /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
function hasLoneSurrogate(s: string): boolean {
  return LONE_HIGH.test(s) || LONE_LOW.test(s);
}

describe('R7s-7 — boundMessage does not split a surrogate pair', () => {
  it('drops the straddling half instead of emitting a lone surrogate', () => {
    // 1999 ASCII then an astral emoji (2 UTF-16 units) so the pair straddles
    // the 2000-unit cut, then filler to force truncation.
    const giant = 'a'.repeat(1999) + '\u{1F600}' + 'b'.repeat(2000);
    // Sanity: a naive slice WOULD leave a lone high surrogate — this is the bug.
    expect(hasLoneSurrogate(giant.slice(0, 2_000))).toBe(true);

    const n = normalizeProviderError({ message: giant, status: 500 });
    expect(hasLoneSurrogate(n.message)).toBe(false);
    // The straddling emoji half was dropped: 1999 'a' + the ellipsis marker.
    expect(n.message).toBe('a'.repeat(1999) + '…');
  });

  it('leaves a short (non-truncated) message with astral chars intact', () => {
    const n = normalizeProviderError({ message: 'boom \u{1F600} done', status: 400 });
    expect(hasLoneSurrogate(n.message)).toBe(false);
    expect(n.message).toContain('\u{1F600}');
  });
});

describe('Y6-2 — nested cause / AggregateError classification', () => {
  it('adopts a retryable transport code buried in err.cause (fetch failed)', () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), {
      code: 'ECONNREFUSED',
    });
    const err = new TypeError('fetch failed', { cause });
    const n = normalizeProviderError(err);
    expect(n.retryable).toBe(true);
    expect(n.phase).toBe('transport');
    expect(n.code).toBe('ECONNREFUSED');
    expect(n.name).toBe('TypeError');
    expect(n.message).toBe('fetch failed');
  });

  it('surfaces a 429 buried in AggregateError.errors as retryable', () => {
    const agg = new AggregateError(
      [new APIStatusError(429, 'rate_limit_error', 'slow down')],
      'All connection attempts failed',
    );
    const n = normalizeProviderError(agg);
    expect(n.status).toBe(429);
    expect(n.retryable).toBe(true);
    expect(n.code).toBe('rate_limit_error');
  });

  it('surfaces a terminal 400 from an aggregate member (status enriched, not retryable)', () => {
    const agg = new AggregateError([new APIStatusError(400, 'invalid_request_error', 'bad')]);
    const n = normalizeProviderError(agg);
    expect(n.status).toBe(400);
    expect(n.retryable).toBe(false);
  });

  it('honors a replay-safe APIConnectionError carried as a cause', () => {
    const conn = new APIConnectionError('socket hang up');
    conn.turnReplaySafe = true;
    const n = normalizeProviderError(new Error('wrapped transport failure', { cause: conn }));
    expect(n.retryable).toBe(true);
    expect(n.phase).toBe('transport');
  });

  it('adopts an HTTP status from a raw gateway object hung on the cause', () => {
    const err = Object.assign(new Error('gateway wrap'), {
      cause: { status: 503, message: 'upstream down' },
    });
    const n = normalizeProviderError(err);
    expect(n.status).toBe(503);
    expect(n.retryable).toBe(true);
  });

  it('does NOT over-mark retryable when the cause carries no signal', () => {
    const n = normalizeProviderError(new Error('wrap', { cause: new Error('inner') }));
    expect(n.retryable).toBe(false);
    expect(n.status).toBeUndefined();
  });

  it('a cyclic cause chain neither throws nor loops', () => {
    const a = new Error('a');
    const b = new Error('b');
    (a as { cause?: unknown }).cause = b;
    (b as { cause?: unknown }).cause = a;
    let n!: ReturnType<typeof normalizeProviderError>;
    expect(() => {
      n = normalizeProviderError(a);
    }).not.toThrow();
    expect(n.retryable).toBe(false);
  });
});

describe('R7j-2 — extractProviderErrorObject upholds the never-throws contract', () => {
  it('does not throw on a circular nested envelope with no message', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const evil = { error: circular };
    let out: ReturnType<typeof extractProviderErrorObject> = null;
    expect(() => {
      out = extractProviderErrorObject(evil);
    }).not.toThrow();
    expect(out).not.toBeNull();
    expect(out!.message).toContain('provider error object');
    expect(out!.message).not.toContain('[object Object]');
  });

  it('does not throw on a BigInt-bearing nested envelope', () => {
    const input = { error: { code: 'x', detail: 10n } };
    let out: ReturnType<typeof extractProviderErrorObject> = null;
    expect(() => {
      out = extractProviderErrorObject(input);
    }).not.toThrow();
    expect(out).not.toBeNull();
    expect(out!.message).not.toContain('[object Object]');
  });
});
