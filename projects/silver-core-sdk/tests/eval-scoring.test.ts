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
  classifyJudgeError,
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

describe('classifyJudgeError (self-improve #7)', () => {
  const billingBody = JSON.stringify({
    type: 'error',
    error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the API.' },
  });

  it('a billing 400 is terminal and legible in a 90-char cell (the 2026-07-12 confirm round)', () => {
    const cls = classifyJudgeError(400, billingBody);
    expect(cls.kind).toBe('billing');
    expect(cls.retryable).toBe(false);
    // The note front-loads kind + API message so `Error: <note>`.slice(0,90)
    // still shows the cause, not the JSON envelope prefix.
    expect(cls.note).toBe('judge HTTP 400 [billing]: Your credit balance is too low to access the API.');
    expect(`Error: ${cls.note}`.slice(0, 90)).toContain('credit balance');
  });

  it('auth/permission/other-400 are terminal (no doomed retry)', () => {
    expect(classifyJudgeError(401, '{}')).toMatchObject({ kind: 'auth', retryable: false });
    expect(classifyJudgeError(403, '{}')).toMatchObject({ kind: 'permission', retryable: false });
    expect(
      classifyJudgeError(
        400,
        JSON.stringify({ error: { type: 'invalid_request_error', message: 'max_tokens: bad' } }),
      ),
    ).toMatchObject({ kind: 'invalid_request', retryable: false });
  });

  it('rate-limit and server errors stay transient (retry may help)', () => {
    expect(classifyJudgeError(429, '{}')).toMatchObject({ kind: 'rate_limit', retryable: true });
    expect(classifyJudgeError(408, '{}')).toMatchObject({ kind: 'rate_limit', retryable: true });
    expect(classifyJudgeError(500, '{}')).toMatchObject({ kind: 'server', retryable: true });
    expect(classifyJudgeError(529, '{}')).toMatchObject({ kind: 'server', retryable: true });
  });

  it('a non-JSON body (gateway HTML) keeps its raw head as the message', () => {
    const cls = classifyJudgeError(502, '<html>Bad Gateway</html>');
    expect(cls.kind).toBe('server');
    expect(cls.retryable).toBe(true);
    expect(cls.note).toContain('Bad Gateway');
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
