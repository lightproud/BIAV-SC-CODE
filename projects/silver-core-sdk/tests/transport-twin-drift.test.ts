/**
 * Transport twin anti-drift guard (audit 2026-07-10 P1-3 / F2).
 *
 * HISTORY: src/transport/openai.ts used to keep a LOCAL copy of the retry /
 * backoff / error-body / stream-error-mapping logic instead of sharing it with
 * the conformance-locked Anthropic transport. That was a documented trade, and
 * this file used to be its price — a token-identity check over ~350 duplicated
 * lines plus a hand-maintained normalization table for the intentional
 * differences. Every fix (the L-2 Retry-After jitter, the H-1 drain cap) had to
 * be applied twice by hand.
 *
 * The duplication is gone: both arms now delegate to src/transport/http-retry.ts,
 * which takes the three genuinely provider-specific things as parameters (debug
 * prefix, request-id header chain, error-body parse). Drift is no longer
 * something to DETECT — it is structurally impossible while the shared module
 * is the only implementation.
 *
 * So this guard now defends the invariant that replaced the old one: neither
 * transport may re-declare a shared helper, and both must import it. Someone
 * pasting a local copy back in (the exact regression this file has always
 * existed to catch) turns it red.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const transportDir = fileURLToPath(new URL('../src/transport/', import.meta.url));
const anthropicSrc = readFileSync(`${transportDir}anthropic.ts`, 'utf8');
const openaiSrc = readFileSync(`${transportDir}openai.ts`, 'utf8');
const sharedSrc = readFileSync(`${transportDir}http-retry.ts`, 'utf8');

const ARMS: Array<{ name: string; src: string }> = [
  { name: 'anthropic.ts', src: anthropicSrc },
  { name: 'openai.ts', src: openaiSrc },
];

/** Everything that lives exactly once, in http-retry.ts. */
const SHARED_FUNCTIONS = [
  'requestWithRetries',
  'backoff',
  'mapStreamError',
  'parseRetryAfterMs',
  'sleep',
  'readBodyTextBounded',
  'nonEmpty',
  'errorMessage',
];

const SHARED_CONSTANTS = [
  'BACKOFF_BASE_MS = 1_000',
  'BACKOFF_FACTOR = 2',
  'BACKOFF_MAX_MS = 60_000',
  // audit 2026-07-14 L-2: bounded jitter on the explicit Retry-After path.
  'RETRY_AFTER_JITTER = 0.25',
  'RETRY_AFTER_MAX_MS = 120_000',
  'DEFAULT_TIMEOUT_MS = 600_000',
  'ERROR_BODY_TIMEOUT_MS = 10_000',
];

describe('transport shared HTTP layer (anthropic.ts / openai.ts / http-retry.ts)', () => {
  it('the shared module owns every twinned function exactly once', () => {
    for (const fn of SHARED_FUNCTIONS) {
      const decls = sharedSrc.match(new RegExp(`^export (async )?function ${fn}\\(`, 'gm'));
      expect(decls, `http-retry.ts must export exactly one ${fn}`).toHaveLength(1);
    }
  });

  it('the shared module owns every retry/backoff constant exactly once', () => {
    for (const name of SHARED_CONSTANTS) {
      expect(sharedSrc, `http-retry.ts missing ${name}`).toContain(`export const ${name}`);
      for (const arm of ARMS) {
        expect(arm.src, `${arm.name} re-declares ${name}`).not.toContain(`const ${name}`);
      }
    }
  });

  for (const arm of ARMS) {
    it(`${arm.name} declares no local copy of a shared helper`, () => {
      for (const fn of SHARED_FUNCTIONS) {
        // A top-level `function foo(` in an arm is a re-introduced copy. The
        // thin `private requestWithRetries(` / `private backoff(` delegates are
        // class members (indented, `private`) and deliberately keep their names.
        expect(arm.src, `${arm.name} re-declares ${fn}`).not.toMatch(
          new RegExp(`^(export )?(async )?function ${fn}\\(`, 'm'),
        );
      }
    });

    it(`${arm.name} imports the shared layer rather than reimplementing it`, () => {
      expect(arm.src).toContain("from './http-retry.js'");
      // The delegates must actually call through — a stubbed-out body that
      // silently diverges is the failure mode this catches.
      expect(arm.src).toMatch(/return requestWithRetries\(\{/);
      expect(arm.src).toMatch(/return backoff\(attempt, retryAfterMs, signal, this\.debug, DEBUG_PREFIX\)/);
    });
  }

  it('each arm keeps only its own provider-specific parameters', () => {
    // Debug prefixes stay distinct (operators tell the two arms apart in logs).
    expect(anthropicSrc).toContain("const DEBUG_PREFIX = 'transport'");
    expect(openaiSrc).toContain("const DEBUG_PREFIX = 'openai transport'");
    // Request-id header chains differ; each arm passes its own.
    expect(anthropicSrc).toContain("h.get('request-id') ?? undefined");
    expect(openaiSrc).toContain("h.get('x-request-id') ?? h.get('request-id') ?? undefined");
    // Error-body parsers stay per-provider (different payload shapes).
    expect(anthropicSrc).toContain('readErrorInfo,');
    expect(openaiSrc).toContain('readErrorInfo: readOpenAIErrorInfo,');
  });

  it('the stream-error message vocabulary stays per-arm', () => {
    // mapStreamError is shared but its nouns are parameters, so the surfaced
    // messages must remain byte-distinguishable per provider.
    expect(anthropicSrc).toContain("apiLabel: 'Messages API'");
    expect(anthropicSrc).toContain("unit: 'event'");
    expect(openaiSrc).toContain("apiLabel: 'Chat Completions'");
    expect(openaiSrc).toContain("unit: 'chunk'");
  });
});
