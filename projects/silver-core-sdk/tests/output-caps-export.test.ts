/**
 * Public-surface acceptance for the 0.95.0 exports (black-pool request
 * 2026-07-28 "从包入口导出 estimateTextTokens 与 MAX_READ_OUTPUT_CHARS").
 *
 * The consumer's stated acceptance: `import { estimateTextTokens } from
 * 'silver-core-sdk'` must return, for the same string, the value the SDK
 * uses internally. The strongest form of that guarantee is REFERENCE
 * identity — the entry point re-exports the very function the engine calls,
 * so the two cannot diverge — asserted here alongside sample values that pin
 * the documented arithmetic (CJK codepoint ~1 token; others ceil(len/4)).
 */

import { describe, it, expect } from 'vitest';
import {
  estimateTextTokens,
  estimateMessagesTokens,
  estimateToolDefsTokens,
  MAX_READ_OUTPUT_CHARS,
  TOOL_OUTPUT_CAPS,
} from '../src/index.js';
import {
  estimateTextTokens as engineEstimateTextTokens,
  estimateMessagesTokens as engineEstimateMessagesTokens,
  estimateToolDefsTokens as engineEstimateToolDefsTokens,
} from '../src/engine/tokens.js';
import { MAX_READ_OUTPUT_CHARS as FSUTIL_CAP } from '../src/tools/fsutil.js';
import { STREAM_CAP_CHARS } from '../src/tools/bash.js';
import { MAX_OUTPUT_CHARS as WEBFETCH_CAP } from '../src/tools/webfetch.js';
import { DEFAULT_HEAD_LIMIT } from '../src/tools/grep.js';

describe('entry-point token estimator exports', () => {
  it('re-exports the exact engine functions (reference identity, not copies)', () => {
    expect(estimateTextTokens).toBe(engineEstimateTextTokens);
    expect(estimateMessagesTokens).toBe(engineEstimateMessagesTokens);
    expect(estimateToolDefsTokens).toBe(engineEstimateToolDefsTokens);
  });

  it('estimateTextTokens keeps the documented arithmetic on samples', () => {
    // Pure CJK: ~1 token per codepoint.
    expect(estimateTextTokens('你好世界')).toBe(4);
    // Pure Latin: ceil(len / 4).
    expect(estimateTextTokens('abcdefgh')).toBe(2);
    expect(estimateTextTokens('abcde')).toBe(2);
    expect(estimateTextTokens('')).toBe(0);
    // Mixed: buckets are charged independently (4 CJK + ceil(8/4)).
    expect(estimateTextTokens('你好世界abcdefgh')).toBe(6);
    // Astral CJK (Ext B, surrogate pair in UTF-16) charges 1, not 4/4.
    expect(estimateTextTokens('\u{20000}')).toBe(1);
  });

  it('estimateMessagesTokens carries the +8 per-message overhead', () => {
    expect(estimateMessagesTokens([{ role: 'user', content: 'abcd' }])).toBe(9);
  });

  it('estimateToolDefsTokens is 0 for no tools', () => {
    expect(estimateToolDefsTokens([])).toBe(0);
  });
});

describe('entry-point output-cap exports', () => {
  it('MAX_READ_OUTPUT_CHARS is the enforcing fsutil constant', () => {
    expect(MAX_READ_OUTPUT_CHARS).toBe(FSUTIL_CAP);
    expect(MAX_READ_OUTPUT_CHARS).toBe(50000);
  });

  it('TOOL_OUTPUT_CAPS mirrors each tool-enforced constant and is frozen', () => {
    expect(TOOL_OUTPUT_CAPS.read).toBe(FSUTIL_CAP);
    expect(TOOL_OUTPUT_CAPS.bash).toBe(STREAM_CAP_CHARS);
    expect(TOOL_OUTPUT_CAPS.webFetch).toBe(WEBFETCH_CAP);
    expect(TOOL_OUTPUT_CAPS.grepHeadLimit).toBe(DEFAULT_HEAD_LIMIT);
    expect(Object.isFrozen(TOOL_OUTPUT_CAPS)).toBe(true);
    // No unexpected keys: the four documented caps are the whole contract.
    expect(Object.keys(TOOL_OUTPUT_CAPS).sort()).toEqual([
      'bash',
      'grepHeadLimit',
      'read',
      'webFetch',
    ]);
  });
});
