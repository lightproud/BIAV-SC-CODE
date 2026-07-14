/**
 * Transport twin anti-drift guard (audit 2026-07-10 P1-3 / F2).
 *
 * src/transport/openai.ts deliberately keeps a LOCAL copy of the retry /
 * backoff / idle-watchdog / stream-error-mapping logic instead of refactoring
 * the conformance-locked Anthropic transport into a shared module. That is a
 * documented trade (keep the Anthropic bytes untouched), and this test is the
 * price: the twinned functions must stay token-identical after a declared
 * normalization table (protocol nouns, error-info reader, request-id header
 * chain). Any NEW divergence — a fix applied to one twin only — turns this
 * red instead of drifting silently. If you diverge on purpose, extend the
 * normalization table here IN THE SAME COMMIT and say why.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const transportDir = fileURLToPath(new URL('../src/transport/', import.meta.url));
const anthropicSrc = readFileSync(`${transportDir}anthropic.ts`, 'utf8');
const openaiSrc = readFileSync(`${transportDir}openai.ts`, 'utf8');

/** Extract a brace-balanced definition starting at `marker` (signature). */
function extractBlock(source: string, marker: string): string {
  const start = source.indexOf(marker);
  expect(start, `marker not found: ${marker}`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf('{', start);
  expect(open, `no opening brace after: ${marker}`).toBeGreaterThan(start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces for: ${marker}`);
}

/** Strip full-line comments + JSDoc blocks, collapse all whitespace. */
function normalize(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Rewrite the OpenAI twin's declared, intentional differences into the
 *  Anthropic vocabulary. Order matters (longest first). */
function openaiToAnthropic(code: string): string {
  return code
    .replaceAll(
      "response.headers.get('x-request-id') ?? response.headers.get('request-id') ?? undefined",
      "response.headers.get('request-id') ?? undefined",
    )
    .replaceAll('readOpenAIErrorInfo', 'readErrorInfo')
    .replaceAll('openai transport:', 'transport:')
    .replaceAll('Chat Completions', 'Messages API')
    .replaceAll('chunkCount', 'eventCount')
    .replaceAll('chunk(s)', 'event(s)')
    .replaceAll('export function', 'function');
}

const TWINS: Array<{ name: string; anthropic: string; openai: string }> = [
  {
    name: 'requestWithRetries',
    anthropic: 'private async requestWithRetries(',
    openai: 'private async requestWithRetries(',
  },
  { name: 'backoff', anthropic: 'private async backoff(', openai: 'private async backoff(' },
  {
    name: 'stream() semaphore wrapper',
    anthropic: 'async *stream(req: StreamRequest)',
    openai: 'async *stream(req: StreamRequest)',
  },
  {
    name: 'mapStreamError',
    anthropic: 'function mapStreamError(',
    openai: 'function mapStreamError(',
  },
  {
    name: 'parseRetryAfterMs',
    anthropic: 'function parseRetryAfterMs(',
    openai: 'function parseRetryAfterMs(',
  },
  { name: 'sleep', anthropic: 'function sleep(', openai: 'function sleep(' },
  {
    name: 'readBodyTextBounded',
    anthropic: 'function readBodyTextBounded(',
    openai: 'function readBodyTextBounded(',
  },
  { name: 'nonEmpty', anthropic: 'function nonEmpty(', openai: 'function nonEmpty(' },
  {
    name: 'errorMessage',
    anthropic: 'function errorMessage(',
    openai: 'function errorMessage(',
  },
];

describe('transport twin anti-drift (anthropic.ts vs openai.ts)', () => {
  for (const twin of TWINS) {
    it(`${twin.name} stays token-identical under the declared normalization`, () => {
      const a = normalize(extractBlock(anthropicSrc, twin.anthropic));
      const o = normalize(openaiToAnthropic(extractBlock(openaiSrc, twin.openai)));
      expect(o).toBe(a);
    });
  }

  it('the twins share the same retry/backoff constants', () => {
    for (const name of [
      'BACKOFF_BASE_MS = 1_000',
      'BACKOFF_FACTOR = 2',
      'BACKOFF_MAX_MS = 60_000',
      // audit 2026-07-14 L-2: bounded jitter on the explicit Retry-After path.
      'RETRY_AFTER_JITTER = 0.25',
      'RETRY_AFTER_MAX_MS = 120_000',
      'DEFAULT_TIMEOUT_MS = 600_000',
      'ERROR_BODY_TIMEOUT_MS = 10_000',
    ]) {
      expect(anthropicSrc, `anthropic missing ${name}`).toContain(name);
      expect(openaiSrc, `openai missing ${name}`).toContain(name);
    }
  });
});
