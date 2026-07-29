/**
 * Audit wave 19 — generator output normalization.
 *
 * The shared "trim wrapping quotes" step matched each end INDEPENDENTLY, so a
 * reply that merely ENDED on a quoted term lost its closing quote and surfaced
 * unbalanced to the user (the away recap and the bare-string title fallback are
 * both user-visible surfaces).
 */

import { describe, expect, it } from 'vitest';

import {
  generateSessionTitle,
  generateTitleAndBranch,
  parseAwaySummary,
} from '../src/generators/index.js';
import { MockTransport, textReplyEvents } from './helpers/mock-transport.js';

describe('parseAwaySummary: only a genuine WRAP is unquoted', () => {
  it('keeps the closing quote of a recap that ends on a quoted term', () => {
    // Pre-fix: 'Renamed the flag to "verbose' — a dangling open quote.
    expect(parseAwaySummary('Renamed the flag to "verbose"')).toBe(
      'Renamed the flag to "verbose"',
    );
  });

  it('keeps both quotes when the recap merely starts and ends on quoted terms', () => {
    // Pre-fix: '"verbose" replaces "loud' (leading quote eaten too).
    expect(parseAwaySummary('"verbose" replaces "loud"')).toBe('"verbose" replaces "loud"');
    expect(parseAwaySummary('Two quoted terms: "a" and "b"')).toBe(
      'Two quoted terms: "a" and "b"',
    );
  });

  it('still unwraps a real wrapping pair (straight and smart)', () => {
    expect(parseAwaySummary('"Fixing the parser."')).toBe('Fixing the parser.');
    expect(parseAwaySummary('‘Fixing the parser.’')).toBe('Fixing the parser.');
    expect(parseAwaySummary('“Fixing the parser.”')).toBe('Fixing the parser.');
    // Nested wrap peels layer by layer.
    expect(parseAwaySummary('\'"Fixing the parser."\'')).toBe('Fixing the parser.');
  });
});

describe('bare-string fallback titles keep their quoted terms', () => {
  it('generateSessionTitle does not eat a trailing content quote', async () => {
    const t = new MockTransport([textReplyEvents('Rename flag to "verbose"')]);
    // Pre-fix: 'Rename flag to "verbose'.
    expect(await generateSessionTitle('x', { transport: t, model: 'haiku' })).toBe(
      'Rename flag to "verbose"',
    );
  });

  it('generateTitleAndBranch shares the same fallback normalization', async () => {
    const t = new MockTransport([textReplyEvents('Rename flag to "verbose"')]);
    const r = await generateTitleAndBranch('x', { transport: t, model: 'haiku' });
    expect(r.title).toBe('Rename flag to "verbose"');
    expect(r.branch).toBe('claude/rename-flag-to-verbose');
  });

  it('a fully wrapped bare-string reply is still unwrapped', async () => {
    const t = new MockTransport([textReplyEvents('"Fix the flaky test"')]);
    expect(await generateSessionTitle('x', { transport: t, model: 'haiku' })).toBe(
      'Fix the flaky test',
    );
  });
});
