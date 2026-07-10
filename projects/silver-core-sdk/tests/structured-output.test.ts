/**
 * Regression tests for the structured-output subsystem (pure functions).
 * No transport, no network — every export is exercised directly.
 */

import { describe, it, expect, vi } from 'vitest';
import type { JSONSchema } from '../src/types.js';
import {
  DEFAULT_STRUCTURED_OUTPUT_RETRIES,
  buildStructuredOutputInstruction,
  evaluateStructuredOutput,
  normalizeOutputFormat,
} from '../src/engine/structured-output.js';

// Helper: assert an outcome is valid and return its value.
function expectValid(outcome: ReturnType<typeof evaluateStructuredOutput>): unknown {
  if (outcome.status !== 'valid') {
    throw new Error(`expected valid, got invalid: ${outcome.summary}`);
  }
  return outcome.value;
}

describe('constants', () => {
  it('default retry bound is 2', () => {
    expect(DEFAULT_STRUCTURED_OUTPUT_RETRIES).toBe(2);
  });
});

describe('JSON extraction (via evaluateStructuredOutput)', () => {
  const anySchema: JSONSchema = {}; // no constraint -> extraction-only behavior

  it('parses a bare object', () => {
    expect(expectValid(evaluateStructuredOutput('{"a":1}', anySchema))).toEqual({ a: 1 });
  });

  it('parses a bare array', () => {
    expect(expectValid(evaluateStructuredOutput('[1,2,3]', anySchema))).toEqual([1, 2, 3]);
  });

  it('parses a ```json fenced block', () => {
    const text = 'Here you go:\n```json\n{"ok":true}\n```';
    expect(expectValid(evaluateStructuredOutput(text, anySchema))).toEqual({ ok: true });
  });

  it('parses a plain ``` fenced block', () => {
    const text = '```\n{"n":42}\n```';
    expect(expectValid(evaluateStructuredOutput(text, anySchema))).toEqual({ n: 42 });
  });

  it('extracts JSON surrounded by prose', () => {
    const text = 'The answer is {"score": 9} — hope that helps!';
    expect(expectValid(evaluateStructuredOutput(text, anySchema))).toEqual({ score: 9 });
  });

  it('respects braces inside string values', () => {
    const text = 'result: {"expr":"a{b}c","done":true} trailing';
    expect(expectValid(evaluateStructuredOutput(text, anySchema))).toEqual({
      expr: 'a{b}c',
      done: true,
    });
  });

  it('respects escaped quotes inside strings', () => {
    const text = '{"q":"she said \\"hi\\"","k":1}';
    expect(expectValid(evaluateStructuredOutput(text, anySchema))).toEqual({
      q: 'she said "hi"',
      k: 1,
    });
  });

  it('fails on empty string', () => {
    const outcome = evaluateStructuredOutput('', anySchema);
    expect(outcome.status).toBe('invalid');
    if (outcome.status === 'invalid') {
      expect(outcome.summary).toContain('not valid JSON');
    }
  });

  it('fails on non-JSON prose', () => {
    const outcome = evaluateStructuredOutput('I could not comply.', anySchema);
    expect(outcome.status).toBe('invalid');
  });

  it('takes the first balanced value when multiple appear', () => {
    const text = 'first {"a":1} then {"b":2}';
    expect(expectValid(evaluateStructuredOutput(text, anySchema))).toEqual({ a: 1 });
  });
});

describe('validation — type keyword', () => {
  it('matches every primitive type', () => {
    expect(evaluateStructuredOutput('"hi"', { type: 'string' }).status).toBe('valid');
    expect(evaluateStructuredOutput('3.5', { type: 'number' }).status).toBe('valid');
    expect(evaluateStructuredOutput('true', { type: 'boolean' }).status).toBe('valid');
    expect(evaluateStructuredOutput('null', { type: 'null' }).status).toBe('valid');
    expect(evaluateStructuredOutput('[1]', { type: 'array' }).status).toBe('valid');
    expect(evaluateStructuredOutput('{"a":1}', { type: 'object' }).status).toBe('valid');
  });

  it('integer vs number', () => {
    expect(evaluateStructuredOutput('4', { type: 'integer' }).status).toBe('valid');
    expect(evaluateStructuredOutput('4.5', { type: 'integer' }).status).toBe('invalid');
    expect(evaluateStructuredOutput('4.5', { type: 'number' }).status).toBe('valid');
  });

  it('reports a type mismatch', () => {
    const outcome = evaluateStructuredOutput('"nope"', { type: 'number' });
    expect(outcome.status).toBe('invalid');
    if (outcome.status === 'invalid') {
      expect(outcome.summary).toContain('expected type number');
    }
  });

  it('accepts a union type', () => {
    const schema = { type: ['string', 'null'] } as unknown as JSONSchema;
    expect(evaluateStructuredOutput('"x"', schema).status).toBe('valid');
    expect(evaluateStructuredOutput('null', schema).status).toBe('valid');
    expect(evaluateStructuredOutput('3', schema).status).toBe('invalid');
  });
});

describe('validation — required / properties / nesting', () => {
  const schema: JSONSchema = {
    type: 'object',
    required: ['name', 'age'],
    properties: {
      name: { type: 'string' },
      age: { type: 'integer' },
      address: {
        type: 'object',
        required: ['city'],
        properties: { city: { type: 'string' } },
      },
    },
  };

  it('accepts a conforming nested object', () => {
    const json = '{"name":"a","age":3,"address":{"city":"NYC"}}';
    expect(evaluateStructuredOutput(json, schema).status).toBe('valid');
  });

  it('flags a missing required property with a path', () => {
    const outcome = evaluateStructuredOutput('{"name":"a"}', schema);
    expect(outcome.status).toBe('invalid');
    if (outcome.status === 'invalid') {
      expect(outcome.summary).toContain('age');
      expect(outcome.summary).toContain('required');
    }
  });

  it('recurses into nested objects with dotted paths', () => {
    const outcome = evaluateStructuredOutput('{"name":"a","age":3,"address":{}}', schema);
    expect(outcome.status).toBe('invalid');
    if (outcome.status === 'invalid') {
      expect(outcome.summary).toContain('address.city');
    }
  });
});

describe('validation — enum / const', () => {
  it('enum hit and miss', () => {
    const schema = { enum: ['a', 'b', 'c'] } as unknown as JSONSchema;
    expect(evaluateStructuredOutput('"b"', schema).status).toBe('valid');
    expect(evaluateStructuredOutput('"z"', schema).status).toBe('invalid');
  });

  it('const hit and miss', () => {
    const schema = { const: 42 } as unknown as JSONSchema;
    expect(evaluateStructuredOutput('42', schema).status).toBe('valid');
    expect(evaluateStructuredOutput('43', schema).status).toBe('invalid');
  });

  it('enum works against object values (deepEqual)', () => {
    const schema = { enum: [{ x: 1 }, { x: 2 }] } as unknown as JSONSchema;
    expect(evaluateStructuredOutput('{"x":2}', schema).status).toBe('valid');
    expect(evaluateStructuredOutput('{"x":3}', schema).status).toBe('invalid');
  });
});

describe('validation — items (array/tuple)', () => {
  it('object-form items: all valid', () => {
    const schema = { type: 'array', items: { type: 'number' } } as unknown as JSONSchema;
    expect(evaluateStructuredOutput('[1,2,3]', schema).status).toBe('valid');
  });

  it('object-form items: one invalid element carries an index path', () => {
    const schema = { type: 'array', items: { type: 'number' } } as unknown as JSONSchema;
    const outcome = evaluateStructuredOutput('[1,"x",3]', schema);
    expect(outcome.status).toBe('invalid');
    if (outcome.status === 'invalid') {
      expect(outcome.summary).toContain('[1]');
    }
  });

  it('tuple-form items validate positionally', () => {
    const schema = {
      type: 'array',
      items: [{ type: 'string' }, { type: 'number' }],
    } as unknown as JSONSchema;
    expect(evaluateStructuredOutput('["a",1]', schema).status).toBe('valid');
    expect(evaluateStructuredOutput('["a","b"]', schema).status).toBe('invalid');
  });
});

describe('validation — additionalProperties', () => {
  it('additionalProperties:false flags an unknown key', () => {
    const schema = {
      type: 'object',
      properties: { a: { type: 'number' } },
      additionalProperties: false,
    } as unknown as JSONSchema;
    const outcome = evaluateStructuredOutput('{"a":1,"b":2}', schema);
    expect(outcome.status).toBe('invalid');
    if (outcome.status === 'invalid') {
      expect(outcome.summary).toContain('b');
    }
  });

  it('additionalProperties as a schema recurses over extras', () => {
    const schema = {
      type: 'object',
      properties: { a: { type: 'number' } },
      additionalProperties: { type: 'string' },
    } as unknown as JSONSchema;
    expect(evaluateStructuredOutput('{"a":1,"extra":"ok"}', schema).status).toBe('valid');
    expect(evaluateStructuredOutput('{"a":1,"extra":9}', schema).status).toBe('invalid');
  });
});

describe('validation — $ref', () => {
  it('resolves #/$defs/X and validates', () => {
    const schema = {
      type: 'object',
      properties: { pt: { $ref: '#/$defs/point' } },
      $defs: {
        point: {
          type: 'object',
          required: ['x'],
          properties: { x: { type: 'number' } },
        },
      },
    } as unknown as JSONSchema;
    expect(evaluateStructuredOutput('{"pt":{"x":1}}', schema).status).toBe('valid');
    const bad = evaluateStructuredOutput('{"pt":{}}', schema);
    expect(bad.status).toBe('invalid');
    if (bad.status === 'invalid') expect(bad.summary).toContain('pt.x');
  });

  it('resolves #/definitions/X', () => {
    const schema = {
      $ref: '#/definitions/root',
      definitions: { root: { type: 'string' } },
    } as unknown as JSONSchema;
    expect(evaluateStructuredOutput('"hi"', schema).status).toBe('valid');
    expect(evaluateStructuredOutput('5', schema).status).toBe('invalid');
  });

  it('unresolvable $ref is lenient (no constraint)', () => {
    const schema = { $ref: '#/$defs/missing' } as unknown as JSONSchema;
    expect(evaluateStructuredOutput('{"anything":true}', schema).status).toBe('valid');
  });

  it('cyclic $ref does not hang and stays lenient', () => {
    const schema = {
      $ref: '#/$defs/node',
      $defs: { node: { $ref: '#/$defs/node' } },
    } as unknown as JSONSchema;
    expect(evaluateStructuredOutput('{"x":1}', schema).status).toBe('valid');
  });
});

describe('validation — boundary keywords', () => {
  it('minItems / maxItems', () => {
    const schema = { type: 'array', minItems: 2, maxItems: 3 } as unknown as JSONSchema;
    expect(evaluateStructuredOutput('[1]', schema).status).toBe('invalid');
    expect(evaluateStructuredOutput('[1,2]', schema).status).toBe('valid');
    expect(evaluateStructuredOutput('[1,2,3,4]', schema).status).toBe('invalid');
  });

  it('minLength / maxLength', () => {
    const schema = { type: 'string', minLength: 2, maxLength: 4 } as unknown as JSONSchema;
    expect(evaluateStructuredOutput('"a"', schema).status).toBe('invalid');
    expect(evaluateStructuredOutput('"abc"', schema).status).toBe('valid');
    expect(evaluateStructuredOutput('"abcde"', schema).status).toBe('invalid');
  });

  it('minimum / maximum', () => {
    const schema = { type: 'number', minimum: 0, maximum: 10 } as unknown as JSONSchema;
    expect(evaluateStructuredOutput('-1', schema).status).toBe('invalid');
    expect(evaluateStructuredOutput('5', schema).status).toBe('valid');
    expect(evaluateStructuredOutput('11', schema).status).toBe('invalid');
  });
});

describe('validation — lenient on unsupported keywords', () => {
  it('anyOf is treated as no constraint', () => {
    const schema = {
      anyOf: [{ type: 'string' }, { type: 'number' }],
    } as unknown as JSONSchema;
    // Would fail a full validator (boolean not in anyOf), passes leniently here.
    expect(evaluateStructuredOutput('true', schema).status).toBe('valid');
  });

  it('format / pattern are ignored', () => {
    const schema = {
      type: 'string',
      format: 'email',
      pattern: '^x',
    } as unknown as JSONSchema;
    expect(evaluateStructuredOutput('"not-an-email"', schema).status).toBe('valid');
  });
});

describe('evaluateStructuredOutput — outcome shape', () => {
  it('valid returns the parsed value', () => {
    const outcome = evaluateStructuredOutput('{"a":1}', { type: 'object' });
    expect(outcome).toEqual({ status: 'valid', value: { a: 1 } });
  });

  it('parse-fail builds a summary and a correction that embeds the schema', () => {
    const schema: JSONSchema = { type: 'object', properties: { a: { type: 'number' } } };
    const outcome = evaluateStructuredOutput('totally not json', schema);
    expect(outcome.status).toBe('invalid');
    if (outcome.status === 'invalid') {
      expect(outcome.summary).toContain('not valid JSON');
      expect(outcome.correction).toContain('did not satisfy');
      expect(outcome.correction).toContain(JSON.stringify(schema));
    }
  });

  it('schema-violation correction lists error paths and embeds the schema', () => {
    const schema: JSONSchema = {
      type: 'object',
      required: ['a'],
      properties: { a: { type: 'number' } },
    };
    const outcome = evaluateStructuredOutput('{"b":1}', schema);
    expect(outcome.status).toBe('invalid');
    if (outcome.status === 'invalid') {
      expect(outcome.summary).toContain('schema violation');
      expect(outcome.correction).toContain('Validation errors:');
      expect(outcome.correction).toContain('- a:');
      expect(outcome.correction).toContain(JSON.stringify(schema));
    }
  });
});

describe('normalizeOutputFormat', () => {
  it('accepts a well-formed config', () => {
    const debug = vi.fn();
    const schema: JSONSchema = { type: 'object' };
    const result = normalizeOutputFormat({ type: 'json_schema', schema }, debug);
    expect(result).toEqual({ type: 'json_schema', schema });
    expect(debug).not.toHaveBeenCalled();
  });

  it('undefined -> undefined, no warning', () => {
    const debug = vi.fn();
    expect(normalizeOutputFormat(undefined, debug)).toBeUndefined();
    expect(debug).not.toHaveBeenCalled();
  });

  it('non-object -> undefined + one warning', () => {
    const debug = vi.fn();
    expect(normalizeOutputFormat('nope', debug)).toBeUndefined();
    expect(debug).toHaveBeenCalledTimes(1);
  });

  it('wrong type -> undefined + one warning', () => {
    const debug = vi.fn();
    expect(normalizeOutputFormat({ type: 'xml', schema: {} }, debug)).toBeUndefined();
    expect(debug).toHaveBeenCalledTimes(1);
  });

  it('non-object schema -> undefined + one warning', () => {
    const debug = vi.fn();
    expect(normalizeOutputFormat({ type: 'json_schema', schema: 'x' }, debug)).toBeUndefined();
    expect(debug).toHaveBeenCalledTimes(1);
  });

  it('array schema is rejected', () => {
    const debug = vi.fn();
    expect(normalizeOutputFormat({ type: 'json_schema', schema: [] }, debug)).toBeUndefined();
    expect(debug).toHaveBeenCalledTimes(1);
  });

  it('preserves native:true for the wire opt-in (C9)', () => {
    const debug = vi.fn();
    const schema: JSONSchema = { type: 'object' };
    const result = normalizeOutputFormat({ type: 'json_schema', schema, native: true }, debug);
    expect(result).toEqual({ type: 'json_schema', schema, native: true });
    expect(debug).not.toHaveBeenCalled();
  });

  it('does not add native for a local-only config (native false/absent) (C9)', () => {
    const debug = vi.fn();
    const schema: JSONSchema = { type: 'object' };
    // absent -> no native key at all (stays exactly { type, schema })
    expect(normalizeOutputFormat({ type: 'json_schema', schema }, debug)).toEqual({
      type: 'json_schema',
      schema,
    });
    // explicit false -> also omitted (only true opts into the wire)
    expect(
      normalizeOutputFormat({ type: 'json_schema', schema, native: false }, debug),
    ).toEqual({ type: 'json_schema', schema });
  });
});

describe('buildStructuredOutputInstruction', () => {
  it('contains the schema JSON and the ONLY-JSON directive', () => {
    const schema: JSONSchema = { type: 'object', properties: { a: { type: 'number' } } };
    const instruction = buildStructuredOutputInstruction(schema);
    expect(instruction).toContain('Required output format');
    expect(instruction).toContain('ONLY');
    expect(instruction).toContain('JSON Schema:');
    expect(instruction).toContain(JSON.stringify(schema, null, 2));
  });
});
