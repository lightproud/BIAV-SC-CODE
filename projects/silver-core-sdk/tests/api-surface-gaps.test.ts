/**
 * White-box tests for the public exports the interface-coverage audit
 * (2026-07-05, keeper directive: per-interface white-box testing) found with
 * ZERO mentions anywhere under tests/. Each block tests the export's OWN
 * contract - not a differential observation, not a side effect of some other
 * feature's test. The companion guard (api-surface-coverage.test.ts) keeps
 * the audit permanent: a new export without a test fails CI.
 */

import { describe, expect, it } from 'vitest';
import {
  COMMAND_INJECTION_TOKEN,
  DEFAULT_UTILITY_MODEL,
  NotImplementedError,
  buildSelectorUserTurn,
  parseCommandPrefix,
  renderCatalog,
  resolveUtilityTransport,
  runVerification,
  runUtilityCall,
  VERIFIER_DEFAULT_MODEL,
} from '../src/index.js';
import { AnthropicTransport } from '../src/transport/anthropic.js';
import { MockTransport, textReplyEvents } from './helpers/mock-transport.js';

describe('NotImplementedError', () => {
  it('carries the house message shape with the feature name', () => {
    const e = new NotImplementedError('someFeature');
    expect(e.name).toBe('NotImplementedError');
    expect(e.message).toBe('silver-core-sdk: someFeature is not implemented in this version');
    expect(e).toBeInstanceOf(Error);
  });
  it('appends the hint when provided', () => {
    const e = new NotImplementedError('x', 'Use y instead.');
    expect(e.message).toBe('silver-core-sdk: x is not implemented in this version. Use y instead.');
  });
});

describe('COMMAND_INJECTION_TOKEN', () => {
  it('is the pinned fail-closed sentinel value', () => {
    // The value is a WIRE CONTRACT with the faithful prefix-detection prompt:
    // the model is instructed to answer exactly this string on suspected
    // injection - changing it desynchronizes prompt and parser.
    expect(COMMAND_INJECTION_TOKEN).toBe('command_injection_detected');
  });
  it('parseCommandPrefix maps the sentinel to the injection verdict', () => {
    expect(parseCommandPrefix(COMMAND_INJECTION_TOKEN)).toEqual({ kind: 'injection' });
  });
});

describe('DEFAULT_UTILITY_MODEL', () => {
  it('is the cheap utility tier (haiku), distinct from the verifier default only if overridden', () => {
    expect(DEFAULT_UTILITY_MODEL).toContain('haiku');
    expect(VERIFIER_DEFAULT_MODEL).toContain('haiku');
  });
  it('runUtilityCall resolves it as the wire model when no override is given', async () => {
    const t = new MockTransport([textReplyEvents('ok')]);
    await runUtilityCall('system', 'user', { transport: t }, 128);
    expect(t.requests[0]?.model).toContain('haiku');
  });
});

describe('resolveUtilityTransport', () => {
  it('returns the injected transport by identity (offline-unit-test seam)', () => {
    const t = new MockTransport([]);
    expect(resolveUtilityTransport({ transport: t })).toBe(t);
  });
  it('builds a real AnthropicTransport when none is injected', () => {
    const t = resolveUtilityTransport({ provider: { apiKey: 'k' }, env: {} });
    expect(t).toBeInstanceOf(AnthropicTransport);
  });
});

describe('runVerification', () => {
  it('returns the typed verdict over a mock transport (the adversarialVerify base)', async () => {
    const t = new MockTransport([
      textReplyEvents('{"verdict":"CONFIRMED","quote":"q","rationale":"r"}'),
    ]);
    const r = await runVerification({ summary: 's', context: 'c' }, { transport: t });
    expect(r.verdict).toBe('CONFIRMED');
    expect(r.keep).toBe(true);
  });
  it('fails closed on a garbage reply (REFUTED, keep false)', async () => {
    const t = new MockTransport([textReplyEvents('!!! not a verdict !!!')]);
    const r = await runVerification({ summary: 's' }, { transport: t });
    expect(r.verdict).toBe('REFUTED');
    expect(r.keep).toBe(false);
  });
});

describe('renderCatalog', () => {
  it('renders one feature_id/action/situation block per situation, newline-joined', () => {
    const out = renderCatalog([
      { featureId: 'f1', action: 'do a', situation: 'when x' },
      { featureId: 'f2', action: 'do b', situation: 'when y' },
    ]);
    expect(out).toBe(
      '- feature_id: f1\n  action: do a\n  situation: when x\n' +
        '- feature_id: f2\n  action: do b\n  situation: when y',
    );
  });
  it('renders an empty catalog to an empty string', () => {
    expect(renderCatalog([])).toBe('');
  });
});

describe('buildSelectorUserTurn', () => {
  it('assembles transcript, eligibility sets and metadata into the selector turn', () => {
    const turn = buildSelectorUserTurn({
      transcript: 'T-LINE',
      eligibleIds: ['a', 'b'],
      ineligibleIds: ['c'],
      sessionMetadata: { numStartups: 7 },
    });
    expect(turn).toContain('Transcript:\nT-LINE');
    expect(turn).toContain('<eligible_ids>a, b</eligible_ids>');
    expect(turn).toContain('<ineligible_ids>c</ineligible_ids>');
    expect(turn).toContain('numStartups: 7');
  });
  it('omitted ineligible ids render as an empty set, not a crash', () => {
    const turn = buildSelectorUserTurn({ transcript: 't', eligibleIds: ['a'] });
    expect(turn).toContain('<ineligible_ids></ineligible_ids>');
  });
});
