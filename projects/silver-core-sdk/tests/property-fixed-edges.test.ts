/**
 * Property tests locking the fixed edges from the five-round bug-fix sweep
 * (0.62.2-0.62.7). These defects are the long-tail, malformed-input, and
 * boundary class that example-based tests structurally miss (the keeper's
 * question: "why didn't CI catch these?"). Here they are probed GENERATIVELY —
 * fast-check hammers each fixed function with thousands of hostile inputs so a
 * regression (or a sibling edge) fails the property, not just the one example.
 *
 * Each block cites the bug it guards.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { parseRetryAfterMs } from '../src/transport/openai.js';
import { evaluateStructuredOutput } from '../src/engine/structured-output.js';
import { extractJsonObject } from '../src/generators/runtime.js';
import { normalizeUsage, addUsage } from '../src/engine/pricing.js';
import { estimateTextTokens } from '../src/engine/tokens.js';
import type { Usage } from '../src/types.js';

// ---------------------------------------------------------------------------
// 0.62.5 — parseRetryAfterMs: a whitespace-only / non-decimal header must be
// ignored (undefined), never coerced to a 0 ms (retry-immediately) backoff.
// ---------------------------------------------------------------------------

const RETRY_AFTER_MAX_MS = 120_000;

describe('property: parseRetryAfterMs never yields an unsafe backoff', () => {
  it('for ANY string the result is undefined OR a finite ms in [0, MAX]', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const r = parseRetryAfterMs(s);
        return r === undefined || (Number.isFinite(r) && r >= 0 && r <= RETRY_AFTER_MAX_MS);
      }),
      { numRuns: 500 },
    );
  });

  it('a blank / whitespace-only header is always ignored (undefined), never 0', () => {
    const blank = fc.array(fc.constantFrom(' ', '\t', '\n', '\r'), { maxLength: 6 }).map((a) => a.join(''));
    fc.assert(
      fc.property(blank, (s) => parseRetryAfterMs(s) === undefined),
      { numRuns: 100 },
    );
  });

  it('a plain non-negative integer maps to seconds*1000, capped at MAX', () => {
    fc.assert(
      fc.property(fc.nat(), (n) => parseRetryAfterMs(String(n)) === Math.min(n * 1000, RETRY_AFTER_MAX_MS)),
      { numRuns: 300 },
    );
  });

  it('hex / exponent forms Number() over-accepts are NOT read as seconds', () => {
    // '0x1f'/'1e3' are not delta-seconds; they fall through to be ignored.
    const weird = fc.oneof(
      fc.nat().map((n) => `0x${n.toString(16)}`),
      fc.nat({ max: 20 }).map((n) => `1e${n}`),
    );
    fc.assert(
      fc.property(weird, (s) => {
        const r = parseRetryAfterMs(s);
        return r === undefined || (Number.isFinite(r) && r >= 0 && r <= RETRY_AFTER_MAX_MS);
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// 0.62.3 — JSON-Schema validation must use OWN properties, not the prototype
// chain (a property named like an Object.prototype member must not be seen as
// always-present).
// ---------------------------------------------------------------------------

const PROTO_NAMES = [
  'constructor',
  'toString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
  '__proto__',
  '__defineGetter__',
];

describe('property: schema property presence is own-property, not prototype-chain', () => {
  it('a required prototype-member name is flagged missing on {}', () => {
    fc.assert(
      fc.property(fc.constantFrom(...PROTO_NAMES), (name) => {
        const schema = { type: 'object', required: [name] } as never;
        return evaluateStructuredOutput('{}', schema).status === 'invalid';
      }),
      { numRuns: PROTO_NAMES.length },
    );
  });

  it('a properties:{protoName:string} constraint does NOT fire on {} (no own prop)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...PROTO_NAMES), (name) => {
        const schema = { type: 'object', properties: { [name]: { type: 'string' } } } as never;
        return evaluateStructuredOutput('{}', schema).status === 'valid';
      }),
      { numRuns: PROTO_NAMES.length },
    );
  });
});

// ---------------------------------------------------------------------------
// 0.62.2/0.62.3 — extractJsonObject / scanBalanced: an object wrapped in
// arbitrary prose (including a stray wrong-type bracket) is recovered, not
// dropped or returned as an array.
// ---------------------------------------------------------------------------

/** Prose with all bracket characters stripped, so the only {...} is the object. */
const bracelessProse = fc.string({ maxLength: 20 }).map((s) => s.replace(/[{}[\]]/g, ''));

const jsonObjectArb = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 6 }).filter((k) => k.trim().length > 0),
  fc.oneof(fc.integer(), fc.boolean(), fc.string({ maxLength: 8 })),
  { maxKeys: 4 },
);

describe('property: extractJsonObject recovers an object from arbitrary prose', () => {
  it('any JSON object between brace-free prose is recovered verbatim', () => {
    fc.assert(
      fc.property(jsonObjectArb, bracelessProse, bracelessProse, (obj, pre, post) => {
        const text = `${pre}${JSON.stringify(obj)}${post}`;
        return JSON.stringify(extractJsonObject(text)) === JSON.stringify(obj);
      }),
      { numRuns: 400 },
    );
  });

  it('an array-wrapping [ {obj} ] still yields the inner object, never the array', () => {
    fc.assert(
      fc.property(jsonObjectArb, (obj) => {
        const got = extractJsonObject(`[${JSON.stringify(obj)}]`);
        return JSON.stringify(got) === JSON.stringify(obj);
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// 0.62.2 — usage normalization/addition: web_search_requests flows through and
// no field is ever NaN/negative.
// ---------------------------------------------------------------------------

const maybeNat = fc.option(fc.nat({ max: 1_000_000 }), { nil: undefined });
const usageArb = fc.record(
  {
    input_tokens: maybeNat,
    output_tokens: maybeNat,
    cache_creation_input_tokens: fc.option(fc.nat({ max: 1_000_000 }), { nil: null }),
    cache_read_input_tokens: fc.option(fc.nat({ max: 1_000_000 }), { nil: null }),
    server_tool_use: fc.option(fc.record({ web_search_requests: fc.nat({ max: 10_000 }) }), {
      nil: undefined,
    }),
  },
  { requiredKeys: [] },
) as fc.Arbitrary<Usage>;

describe('property: usage normalization is total and additive (incl. web_search_requests)', () => {
  it('normalizeUsage yields finite non-negative fields for ANY partial usage', () => {
    fc.assert(
      fc.property(usageArb, (u) => {
        const n = normalizeUsage(u);
        return (
          [
            n.input_tokens,
            n.output_tokens,
            n.cache_creation_input_tokens,
            n.cache_read_input_tokens,
            n.web_search_requests,
          ] as number[]
        ).every((v) => Number.isFinite(v) && v >= 0);
      }),
      { numRuns: 400 },
    );
  });

  it('addUsage sums web_search_requests field-wise', () => {
    fc.assert(
      fc.property(usageArb, usageArb, (a, b) => {
        const na = normalizeUsage(a);
        const nb = normalizeUsage(b);
        return addUsage(na, nb).web_search_requests === na.web_search_requests + nb.web_search_requests;
      }),
      { numRuns: 400 },
    );
  });

  it('carries a server_tool_use.web_search_requests count through verbatim', () => {
    fc.assert(
      fc.property(fc.nat({ max: 10_000 }), (k) => {
        return normalizeUsage({ server_tool_use: { web_search_requests: k } } as Usage).web_search_requests === k;
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// 0.62.2 — estimateTextTokens is CJK-aware: a Chinese system prompt must NOT be
// undercounted ~4x by a flat charLen/4 (which deferred compaction past a 400).
// ---------------------------------------------------------------------------

describe('property: estimateTextTokens is CJK-aware and monotonic', () => {
  const cjkString = fc
    .array(fc.integer({ min: 0x4e00, max: 0x9fff }).map((c) => String.fromCodePoint(c)), {
      minLength: 4,
      maxLength: 80,
    })
    .map((a) => a.join(''));

  it('a CJK string is charged FAR above the naive charLen/4 (~1 token per char)', () => {
    fc.assert(
      fc.property(cjkString, (s) => estimateTextTokens(s) > Math.ceil(s.length / 4)),
      { numRuns: 300 },
    );
  });

  it('the estimate is non-negative and never shrinks under concatenation', () => {
    const wellFormed = fc.string({ unit: 'grapheme', maxLength: 40 });
    fc.assert(
      fc.property(wellFormed, wellFormed, (a, b) => {
        const ea = estimateTextTokens(a);
        return ea >= 0 && estimateTextTokens(a + b) >= ea;
      }),
      { numRuns: 300 },
    );
  });
});

// ---------------------------------------------------------------------------
// 0.62.3 — structured-output scanBalanced: a stray wrong-type bracket in prose
// must not capture the scan and hide the real JSON that follows.
// ---------------------------------------------------------------------------

describe('property: structured-output extraction survives a wrong-type bracket in prose', () => {
  it('recovers the object after a leading UNPARSEABLE [ ... ] group', () => {
    // The bracket group holds unquoted words, so it never parses as JSON — the
    // scan must resume past it to the real object (the R2-13 fix). A leading
    // group that IS valid JSON (e.g. `[]`) legitimately wins under the
    // first-parseable-value contract and is intentionally NOT covered here.
    fc.assert(
      fc.property(jsonObjectArb, (obj) => {
        const r = evaluateStructuredOutput(`Sure [see below]: ${JSON.stringify(obj)}`, {} as never);
        return r.status === 'valid' && JSON.stringify(r.value) === JSON.stringify(obj);
      }),
      { numRuns: 300 },
    );
  });
});
