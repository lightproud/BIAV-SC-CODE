/**
 * Unit lock for the model→thinking-form boundary (root-cause fix for the v0.7
 * real-L5 100%-fail on haiku-4.5, run 28753349435). Both thinking on-forms 400
 * on the wrong generation, so this mapping is load-bearing; a wrong entry
 * re-breaks a whole model tier.
 */

import { describe, expect, it } from 'vitest';

import { supportsAdaptiveThinking } from '../src/engine/thinking-model.js';

describe('supportsAdaptiveThinking', () => {
  it('4.6-generation-and-later models accept adaptive', () => {
    for (const m of [
      'claude-opus-4-6',
      'claude-opus-4-7',
      'claude-opus-4-8',
      'claude-sonnet-5',
      'claude-sonnet-4-6',
      'claude-fable-5',
      'claude-mythos-5',
    ]) {
      expect(supportsAdaptiveThinking(m), m).toBe(true);
    }
  });

  it('pre-4.6 models do NOT accept adaptive (they take enabled+budget)', () => {
    for (const m of [
      'claude-haiku-4-5',
      'claude-haiku-4-5-20251001', // the conformance-pinned dated id
      'claude-3-5-haiku-20241022',
      'claude-sonnet-4-5',
      'claude-sonnet-4-5-20250929',
      'claude-sonnet-4-0',
      'claude-sonnet-4-20250514', // dated Sonnet 4.0
      'claude-3-7-sonnet-20250219',
      'claude-opus-4-5',
      'claude-opus-4-1',
      'claude-opus-4-0',
      'claude-opus-4-20250514', // dated Opus 4.0
      'claude-3-opus-20240229',
      'claude-2.1',
    ]) {
      expect(supportsAdaptiveThinking(m), m).toBe(false);
    }
  });

  it('unknown / future model ids default to adaptive (new models are adaptive-only)', () => {
    // The boundary is a denylist of known pre-adaptive families; anything else
    // (a future model, or a synthetic conformance id) defaults to adaptive.
    for (const m of ['claude-opus-5', 'claude-haiku-5', 'claude-conformance-l2', 'some-future-model']) {
      expect(supportsAdaptiveThinking(m), m).toBe(true);
    }
  });
});
