/**
 * self-improve #2 — judge-verdict validity and mean-poisoning defense
 * (scripts/eval-scoring.mjs). Reproduces the branch LIVE round failure of
 * 2026-07-12 (run 29187930045): two judge verdicts came back without a
 * `score`, were recorded as SCORED, and nulled their whole dimension mean —
 * firing -4.86 / -4.0 FALSE regressions at the REQ-2.2 gate.
 */
import { describe, expect, it } from 'vitest';

// eslint-disable-next-line import/no-relative-packages -- eval-side tooling under test
import {
  computeDimensionMeans,
  diagnoseJudgeMessage,
  isValidVerdict,
  parseJudgeMessage,
  trimEvidence,
} from '../scripts/eval-scoring.mjs';

describe('isValidVerdict', () => {
  it('accepts integer scores 1..5 only', () => {
    for (const score of [1, 2, 3, 4, 5]) {
      expect(isValidVerdict({ score, verdict: 'x', rubric_findings: [] })).toBe(true);
    }
    for (const score of [0, 6, 3.5, '4', null, undefined, NaN]) {
      expect(isValidVerdict({ score })).toBe(false);
    }
    expect(isValidVerdict(null)).toBe(false);
    expect(isValidVerdict({})).toBe(false);
  });
});

describe('parseJudgeMessage', () => {
  it('parses a structured verdict and carries judge usage', () => {
    const body = {
      content: [{ type: 'text', text: '{"score":4,"verdict":"ok","rubric_findings":[]}' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    };
    const graded = parseJudgeMessage(body);
    expect(graded.score).toBe(4);
    expect(graded.judgeUsage.output_tokens).toBe(5);
    expect(isValidVerdict(graded)).toBe(true);
  });

  it('an empty/scoreless reply parses but is NOT a valid verdict', () => {
    const empty = parseJudgeMessage({ content: [], usage: {} });
    expect(isValidVerdict(empty)).toBe(false);
    const scoreless = parseJudgeMessage({
      content: [{ type: 'text', text: '{"verdict":"hmm","rubric_findings":[]}' }],
      usage: {},
    });
    expect(isValidVerdict(scoreless)).toBe(false);
  });

  it('a truncated JSON reply throws (callers map it to ERROR)', () => {
    expect(() =>
      parseJudgeMessage({ content: [{ type: 'text', text: '{"score":4,"verd' }], usage: {} }),
    ).toThrow();
  });
});

describe('diagnoseJudgeMessage (深挖一单 probe)', () => {
  it('captures the max_tokens-truncation shape (no text block emitted)', () => {
    // The hypothesised mem-03/dc-05 failure: output budget consumed before a
    // text block, so parseJudgeMessage falls back to {} (score undefined).
    const diag = diagnoseJudgeMessage({
      stop_reason: 'max_tokens',
      content: [],
      usage: { output_tokens: 4096 },
    });
    expect(diag).toMatchObject({
      stop_reason: 'max_tokens',
      block_types: [],
      has_text_block: false,
      text_len: 0,
      output_tokens: 4096,
    });
  });

  it('captures a present-but-scoreless text block (head + length)', () => {
    const diag = diagnoseJudgeMessage({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"verdict":"unsure"}' }],
      usage: { output_tokens: 12 },
    });
    expect(diag.has_text_block).toBe(true);
    expect(diag.text_len).toBe('{"verdict":"unsure"}'.length);
    expect(diag.text_head).toContain('unsure');
    expect(diag.block_types).toEqual(['text']);
  });
});

describe('trimEvidence (self-improve #6)', () => {
  it('cuts oversized strings anywhere in the tree with an explicit marker', () => {
    const big = 'x'.repeat(5000);
    const out = trimEvidence({
      phases: [{ transcript: [{ message: { content: [{ type: 'text', text: big }] } }] }],
      harnessNotes: 'short note',
      metrics: { turnReplays: 1 },
    });
    const text = out.phases[0].transcript[0].message.content[0].text;
    expect(text.length).toBeLessThan(3100);
    expect(text).toContain('…[trimmed 2000 chars]');
    expect(out.harnessNotes).toBe('short note');
    expect(out.metrics.turnReplays).toBe(1);
  });

  it('leaves structure, numbers, booleans and nulls untouched', () => {
    const evidence = { a: [1, true, null, 'ok'], b: { c: 'fine' } };
    expect(trimEvidence(evidence)).toEqual(evidence);
  });
});

describe('computeDimensionMeans', () => {
  it('one invalid score never nulls a dimension (the 2026-07-12 poisoning)', () => {
    const results = [
      { outcome: 'SCORED', dimension: 'memory_recall', score: 5 },
      { outcome: 'SCORED', dimension: 'memory_recall', score: 4 },
      // The poisoned record: SCORED but no score — must be excluded.
      { outcome: 'SCORED', dimension: 'memory_recall', score: undefined },
      { outcome: 'ERROR', dimension: 'memory_recall' },
      { outcome: 'SCORED', dimension: 'token_efficiency', score: 3 },
    ];
    expect(computeDimensionMeans(results)).toEqual({
      memory_recall: 4.5,
      token_efficiency: 3,
    });
  });

  it('a dimension with no valid scores is absent, not null', () => {
    const means = computeDimensionMeans([
      { outcome: 'SCORED', dimension: 'disconnect_recovery', score: undefined },
      { outcome: 'PENDING_HARNESS', dimension: 'disconnect_recovery' },
    ]);
    expect(means).toEqual({});
    expect('disconnect_recovery' in means).toBe(false);
  });
});
