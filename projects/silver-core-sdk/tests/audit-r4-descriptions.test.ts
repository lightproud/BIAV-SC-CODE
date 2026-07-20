/**
 * Audit r4 — "descriptions" cluster regressions.
 *
 * These lock the two items in this cluster that were FIXED (the rest were
 * skipped as faithful-reproduction / documented divergences — see
 * docs/COMPAT.md "Tool-description ↔ implementation fidelity"):
 *
 *   - Sd-1: WebSearch advertises "search result blocks, including links as
 *           markdown hyperlinks" but rendered a bare-URL plain-text line.
 *           renderResults now emits a markdown hyperlink per result and blank-
 *           line-delimited blocks, WITHOUT losing the numbered-list surface.
 *   - Y5-3: MultiEdit was hard-removed (0.65.0) but docs/COMPAT.md still claimed
 *           "still ships and works". The row is now REMOVED and the code side is
 *           pinned (no MultiEdit in the default built-in set).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, it, expect } from 'vitest';

import { webSearchTool } from '../src/tools/websearch.js';
import { createBuiltinTools } from '../src/tools/index.js';
import { WEBSEARCH_DESCRIPTION } from '../src/tools/descriptions.js';
import type { ToolContext } from '../src/internal/contracts.js';
import type { WebSearchResult } from '../src/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const COMPAT_MD = join(here, '..', 'docs', 'COMPAT.md');

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    cwd: '/tmp',
    additionalDirectories: [],
    env: {},
    signal: new AbortController().signal,
    debug: () => {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Sd-1 — WebSearch renders markdown hyperlinks (impl fix)
// ---------------------------------------------------------------------------

describe('audit r4 Sd-1 — WebSearch link rendering matches the description', () => {
  const results: WebSearchResult[] = [
    { title: 'First', url: 'https://a.com/1', snippet: 'snip one' },
    { title: 'Second', url: 'https://b.com/2' },
  ];

  it('renders each result link as a markdown hyperlink (no bare-URL line)', async () => {
    const ctx = makeCtx({ webSearch: async () => results });
    const r = await webSearchTool.execute({ query: 'x' }, ctx);
    const text = String(r.content);

    // The advertised "links as markdown hyperlinks" is now honest.
    expect(text).toContain('[https://a.com/1](https://a.com/1)');
    expect(text).toContain('[https://b.com/2](https://b.com/2)');

    // The URL no longer appears as a bare, un-linked line (`   <url>` with no
    // surrounding markdown link syntax).
    expect(text).not.toMatch(/^ {3}https:\/\/a\.com\/1$/m);

    // The numbered "search result blocks" surface is preserved.
    expect(text).toContain('1. First');
    expect(text).toContain('2. Second');
    expect(text).toContain('snip one');

    // Results are separated into blank-line-delimited blocks.
    expect(text).toContain('\n\n');
  });

  it('still reports "No results." for an empty set', async () => {
    const ctx = makeCtx({ webSearch: async () => [] });
    const r = await webSearchTool.execute({ query: 'x' }, ctx);
    expect(String(r.content)).toBe('No results.');
  });

  it('the corpus-locked description still advertises markdown hyperlinks (contract the impl now honors)', () => {
    expect(WEBSEARCH_DESCRIPTION).toContain('links as markdown hyperlinks');
  });
});

// ---------------------------------------------------------------------------
// Y5-3 — MultiEdit removal reflected in code + docs
// ---------------------------------------------------------------------------

describe('audit r4 Y5-3 — MultiEdit is removed, COMPAT.md reflects it', () => {
  it('MultiEdit is not in the default built-in tool set', () => {
    const names = new Set(createBuiltinTools({ env: {} }).keys());
    expect(names.has('MultiEdit')).toBe(false);
  });

  it('COMPAT.md no longer claims MultiEdit "still ships"', () => {
    const compat = readFileSync(COMPAT_MD, 'utf8');
    const multiEditRow = compat
      .split('\n')
      .find((line) => line.startsWith('| MultiEdit '));
    expect(multiEditRow, 'MultiEdit row present in COMPAT.md').toBeTruthy();
    // The stale claim is gone and the row is marked REMOVED.
    expect(multiEditRow).not.toContain('still ships and works');
    expect(multiEditRow).toContain('REMOVED');
  });
});
