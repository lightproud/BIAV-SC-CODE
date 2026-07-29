/**
 * Audit wave 21 — strict structured-output extraction dropped ordinary replies.
 *
 * `workflow-engine.ts` `agent({schema})` parses its subagent's TEXT reply with
 * extraction:'strict' and has NO correction-retry channel: an unparsed reply
 * makes `agent()` return null and the script silently loses that item. The
 * fenced-block extractor was one regex with three failure modes, each an
 * ordinary thing a model does.
 */

import { describe, expect, it } from 'vitest';

import { evaluateStructuredOutput } from '../src/internal/structured-output.js';
import type { JSONSchema } from '../src/types.js';

const SCHEMA = {
  type: 'object',
  properties: { a: { type: 'number' } },
  required: ['a'],
} as JSONSchema;

const strict = (text: string) =>
  evaluateStructuredOutput(text, SCHEMA, { extraction: 'strict' });

describe('wave21: strict fenced extraction accepts what models actually emit', () => {
  it('a language tag other than exactly "json" no longer eats the body', () => {
    // The old `(?:json)?` matched EMPTY here, so "5"/"c" was captured as part
    // of the JSON body and the parse failed.
    for (const tag of ['json5', 'jsonc', 'JSON', 'Json']) {
      const out = strict(`\`\`\`${tag}\n{"a":1}\n\`\`\``);
      expect(out.status, tag).toBe('valid');
    }
  });

  it('a reply cut off before its closing fence still yields its JSON', () => {
    // max_tokens landing four characters after complete JSON matched NOTHING
    // at all — not even a candidate to report on.
    const out = strict('```json\n{"a":1}\n');
    expect(out.status).toBe('valid');
    expect(out).toMatchObject({ value: { a: 1 } });
  });

  it('the answer in a SECOND fenced block is found', () => {
    const out = strict('```\nsome log output\n```\n```json\n{"a":1}\n```');
    expect(out.status).toBe('valid');
  });

  it('a near-miss first block does not hide a valid later one', () => {
    const out = strict('```json\n{"b":2}\n```\n```json\n{"a":1}\n```');
    expect(out.status).toBe('valid');
    expect(out).toMatchObject({ value: { a: 1 } });
  });

  // --- negative controls: the strict guarantee is unchanged -----------------

  it('the first block still wins whenever it validates', () => {
    const out = strict('```json\n{"a":1}\n```\n```json\n{"a":999}\n```');
    expect(out).toMatchObject({ value: { a: 1 } });
  });

  it('strict still refuses JSON embedded in bare prose (no fence)', () => {
    // This is the whole point of strict mode — an example object in prose must
    // never be mistaken for the reply.
    expect(strict('Here is an example: {"a":1} — but I could not do it.').status).toBe(
      'invalid',
    );
  });

  it('plain and untagged fences still work, and a bare JSON reply still works', () => {
    expect(strict('```\n{"a":1}\n```').status).toBe('valid');
    expect(strict('{"a":1}').status).toBe('valid');
  });

  it('a reply with no JSON anywhere is still invalid, with a reason', () => {
    const out = strict('I could not complete this task.');
    expect(out.status).toBe('invalid');
    if (out.status === 'invalid') expect(out.summary).toContain('not valid JSON');
  });

  it('lenient mode keeps finding balanced spans in prose', () => {
    expect(evaluateStructuredOutput('the answer is {"a":1} ok', SCHEMA).status).toBe('valid');
  });
});
