/**
 * Structured-output subsystem (Options.outputFormat = { type:'json_schema', schema }).
 *
 * Pure functions the engine loop calls at the natural-end of a turn to guarantee
 * the agent's final answer is JSON validating against a caller-supplied JSON
 * Schema. This module owns:
 *   - a MINIMAL JSON-Schema validator (the documented common subset);
 *   - LENIENT JSON extraction from the model's final text (direct parse ->
 *     fenced code block -> balanced-brace scan);
 *   - the system-prompt instruction builder (injected once, survives tool turns);
 *   - the retry-correction builder (the corrective user turn on mismatch);
 *   - the option-shape normalizer.
 *
 * No module-level mutable state. Every export is a pure function. Unsupported
 * schema keywords are handled LENIENTLY (treated as no constraint) rather than
 * rejecting, so this validator never fails on a keyword it does not model.
 */

import type { JSONSchema, OutputFormatConfig } from '../types.js';

/** Default bound on structured-output re-prompts (3 total attempts). */
export const DEFAULT_STRUCTURED_OUTPUT_RETRIES = 2;

/** Cap on $ref resolution hops to defend against cyclic schema references. */
const MAX_REF_DEPTH = 32;

/** Outcome of evaluating the model's final text against a required schema. */
export type StructuredOutcome =
  | { status: 'valid'; value: unknown }
  | { status: 'invalid'; correction: string; summary: string };

// ---------------------------------------------------------------------------
// Option normalization
// ---------------------------------------------------------------------------

/**
 * Validate and narrow the caller's raw `outputFormat` option. Returns the
 * config when shaped `{ type:'json_schema', schema:<object> }`, otherwise emits
 * exactly one debug warning and returns undefined (feature simply disabled).
 */
export function normalizeOutputFormat(
  raw: unknown,
  debug: (m: string) => void,
): OutputFormatConfig | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || typeof raw !== 'object') {
    debug('outputFormat ignored: expected an object { type: "json_schema", schema }');
    return undefined;
  }
  const o = raw as Record<string, unknown>;
  if (o.type !== 'json_schema') {
    debug(
      `outputFormat ignored: unsupported type ${JSON.stringify(o.type)} (expected "json_schema")`,
    );
    return undefined;
  }
  if (o.schema === null || typeof o.schema !== 'object' || Array.isArray(o.schema)) {
    debug('outputFormat ignored: schema must be a JSON Schema object');
    return undefined;
  }
  // Preserve `native` ONLY when explicitly true, so the default (local-only)
  // config stays exactly { type, schema } — the wire opt-in is off by default.
  return {
    type: 'json_schema',
    schema: o.schema as JSONSchema,
    ...(o.native === true ? { native: true } : {}),
  };
}

// ---------------------------------------------------------------------------
// System-prompt instruction
// ---------------------------------------------------------------------------

/**
 * Build the persistent system-prompt directive appended by query(). Lives in
 * the system prompt (not a user turn) so it survives message-history compaction
 * and is present on every turn.
 */
export function buildStructuredOutputInstruction(schema: JSONSchema): string {
  return (
    '## Required output format\n' +
    'Your FINAL message must be a single JSON value that validates against the ' +
    'JSON Schema below. Output ONLY that JSON — no prose, no explanation, and no ' +
    'markdown code fences. You may use tools first; the JSON must be your last ' +
    'message.\n\n' +
    'JSON Schema:\n' +
    JSON.stringify(schema, null, 2)
  );
}

// ---------------------------------------------------------------------------
// Top-level evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate the model's final text against the required schema. Extract a JSON
 * candidate leniently, validate it, and either return the validated value or an
 * invalid outcome carrying a summary (for the error message) and a corrective
 * user-turn text (for the retry).
 */
export function evaluateStructuredOutput(text: string, schema: JSONSchema): StructuredOutcome {
  const extracted = extractJsonCandidate(text);
  if (!extracted.ok) {
    const summary = `response was not valid JSON: ${extracted.reason}`;
    const correction =
      'Your previous response did not satisfy the required output format.\n' +
      `The response could not be parsed as JSON: ${extracted.reason}\n` +
      '\nRespond with ONLY a single JSON value conforming to this JSON Schema ' +
      '(no prose, no code fences):\n' +
      JSON.stringify(schema);
    return { status: 'invalid', correction, summary };
  }

  const errors = validateValue(extracted.value, schema, schema, '', 0);
  if (errors.length > 0) {
    const preview = errors
      .slice(0, 5)
      .map((e) => `${e.path === '' ? '(root)' : e.path}: ${e.message}`)
      .join('; ');
    const summary = `${errors.length} schema violation(s): ${preview}`;
    const correction =
      'Your previous response did not satisfy the required output format.\n' +
      'Validation errors:\n' +
      errors.map((e) => `- ${e.path === '' ? '(root)' : e.path}: ${e.message}`).join('\n') +
      '\n\nRespond with ONLY a single JSON value conforming to this JSON Schema ' +
      '(no prose, no code fences):\n' +
      JSON.stringify(schema);
    return { status: 'invalid', correction, summary };
  }

  return { status: 'valid', value: extracted.value };
}

// ---------------------------------------------------------------------------
// JSON extraction (internal)
// ---------------------------------------------------------------------------

type ExtractResult = { ok: true; value: unknown } | { ok: false; reason: string };

/**
 * Lenient extraction: (a) trim; (b) direct JSON.parse; (c) fenced ```json / ```
 * block; (d) first balanced {..}/[..] value (string-aware). On total failure
 * returns the direct-parse error message.
 */
function extractJsonCandidate(text: string): ExtractResult {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, reason: 'empty response' };

  const direct = tryParse(trimmed);
  if (direct.ok) return direct;

  const fenced = extractFenced(trimmed);
  if (fenced !== undefined) {
    const parsed = tryParse(fenced);
    if (parsed.ok) return parsed;
  }

  // Try each balanced span in turn: a stray wrong-type bracket in leading prose
  // (`Sure [see below]: {"answer":42}`) must not let the first opener capture
  // the scan and hide the real JSON that follows. Resume past each opener whose
  // span is unbalanced or fails to parse.
  let from = 0;
  for (;;) {
    const scanned = scanBalanced(trimmed, from);
    if (scanned === undefined) break;
    if (scanned.span !== null) {
      const parsed = tryParse(scanned.span);
      if (parsed.ok) return parsed;
    }
    from = scanned.start + 1;
  }

  return { ok: false, reason: direct.reason };
}

function tryParse(s: string): ExtractResult {
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Inner content of the first fenced code block, or undefined. */
function extractFenced(text: string): string | undefined {
  const m = /```(?:json)?[ \t]*\r?\n?([\s\S]*?)```/i.exec(text);
  if (m && m[1] !== undefined) return m[1].trim();
  return undefined;
}

/**
 * The next balanced JSON object/array substring at or after `from`. Counts only
 * the opening delimiter's own type, ignoring delimiters inside JSON strings and
 * respecting backslash escapes. Returns `{ start, span }` where `start` is the
 * opener position (so the caller can resume the search past it) and `span` is
 * the balanced substring, or null when this opener never closes. Returns
 * undefined when no opener exists at/after `from`.
 */
function scanBalanced(
  text: string,
  from = 0,
): { start: number; span: string | null } | undefined {
  const start = firstOpener(text, from);
  if (start === -1) return undefined;
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return { start, span: text.slice(start, i + 1) };
    }
  }
  return { start, span: null }; // opened at `start` but never balanced
}

function firstOpener(text: string, from = 0): number {
  const ib = text.indexOf('{', from);
  const ia = text.indexOf('[', from);
  if (ib === -1) return ia;
  if (ia === -1) return ib;
  return Math.min(ib, ia);
}

// ---------------------------------------------------------------------------
// Validation (internal)
// ---------------------------------------------------------------------------

type ValidationError = { path: string; message: string };

/**
 * Walk `schema` against `value`, collecting ValidationError[]. Supported
 * keywords (the documented common subset): type, enum, const, required,
 * properties, items (object + tuple form), additionalProperties, $ref
 * (#/$defs/X or #/definitions/X against root), minItems/maxItems,
 * minLength/maxLength, minimum/maximum. Unknown keywords are lenient
 * (no constraint). `refDepth` bounds $ref recursion against cyclic schemas.
 */
function validateValue(
  value: unknown,
  schema: unknown,
  root: unknown,
  path: string,
  refDepth: number,
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
    return errors; // boolean-ish / malformed schema -> no constraint
  }
  const s = schema as Record<string, unknown>;

  // $ref: resolve one hop against the root document; unresolvable -> lenient.
  if (typeof s.$ref === 'string') {
    if (refDepth > MAX_REF_DEPTH) return errors;
    const resolved = resolveRef(s.$ref, root);
    if (resolved === undefined) return errors;
    return validateValue(value, resolved, root, path, refDepth + 1);
  }

  // type (string or string[]); mismatch stops deeper checks to avoid noise.
  if (s.type !== undefined) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    const ok = types.some((t) => typeof t === 'string' && typeMatches(value, t));
    if (!ok) {
      errors.push({
        path,
        message: `expected type ${types.join(' | ')} but got ${jsonType(value)}`,
      });
      return errors;
    }
  }

  // const
  if ('const' in s && !deepEqual(value, s.const)) {
    errors.push({ path, message: `expected constant ${JSON.stringify(s.const)}` });
  }

  // enum
  if (Array.isArray(s.enum) && !s.enum.some((allowed) => deepEqual(value, allowed))) {
    errors.push({ path, message: `value not in enum ${JSON.stringify(s.enum)}` });
  }

  // object constraints
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const props =
      s.properties !== null && typeof s.properties === 'object' && !Array.isArray(s.properties)
        ? (s.properties as Record<string, unknown>)
        : undefined;

    // OWN-property checks only: the `in` operator walks the prototype chain, so
    // a schema property named like an Object.prototype member (constructor,
    // toString, valueOf, hasOwnProperty, __proto__, …) would be seen as always
    // present — a missing `required:['constructor']` goes unflagged, and a
    // `properties:{toString}` validates the inherited function on a valid {}.
    const hasOwn = (k: string): boolean => Object.prototype.hasOwnProperty.call(obj, k);

    if (Array.isArray(s.required)) {
      for (const key of s.required) {
        if (typeof key === 'string' && !hasOwn(key)) {
          errors.push({ path: joinPath(path, key), message: 'required property missing' });
        }
      }
    }

    if (props) {
      for (const key of Object.keys(props)) {
        if (hasOwn(key)) {
          errors.push(...validateValue(obj[key], props[key], root, joinPath(path, key), refDepth));
        }
      }
    }

    if ('additionalProperties' in s) {
      const ap = s.additionalProperties;
      const known = props ? new Set(Object.keys(props)) : new Set<string>();
      for (const key of Object.keys(obj)) {
        if (known.has(key)) continue;
        if (ap === false) {
          errors.push({ path: joinPath(path, key), message: 'additional property not allowed' });
        } else if (ap !== null && typeof ap === 'object') {
          errors.push(...validateValue(obj[key], ap, root, joinPath(path, key), refDepth));
        }
      }
    }
  }

  // array constraints
  if (Array.isArray(value)) {
    if (Array.isArray(s.items)) {
      for (let i = 0; i < s.items.length && i < value.length; i += 1) {
        errors.push(...validateValue(value[i], s.items[i], root, `${path}[${i}]`, refDepth));
      }
    } else if (s.items !== undefined) {
      for (let i = 0; i < value.length; i += 1) {
        errors.push(...validateValue(value[i], s.items, root, `${path}[${i}]`, refDepth));
      }
    }
    if (typeof s.minItems === 'number' && value.length < s.minItems) {
      errors.push({ path, message: `expected at least ${s.minItems} item(s)` });
    }
    if (typeof s.maxItems === 'number' && value.length > s.maxItems) {
      errors.push({ path, message: `expected at most ${s.maxItems} item(s)` });
    }
  }

  // string constraints
  if (typeof value === 'string') {
    if (typeof s.minLength === 'number' && value.length < s.minLength) {
      errors.push({ path, message: `expected length >= ${s.minLength}` });
    }
    if (typeof s.maxLength === 'number' && value.length > s.maxLength) {
      errors.push({ path, message: `expected length <= ${s.maxLength}` });
    }
  }

  // number constraints
  if (typeof value === 'number') {
    if (typeof s.minimum === 'number' && value < s.minimum) {
      errors.push({ path, message: `expected >= ${s.minimum}` });
    }
    if (typeof s.maximum === 'number' && value > s.maximum) {
      errors.push({ path, message: `expected <= ${s.maximum}` });
    }
  }

  return errors;
}

function typeMatches(value: unknown, type: string): boolean {
  switch (type) {
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return true; // unknown type keyword -> lenient
  }
}

function jsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** Resolve a "#/a/b" JSON-pointer ref against the root document; else undefined. */
function resolveRef(ref: string, root: unknown): unknown {
  if (!ref.startsWith('#/')) return undefined;
  const parts = ref.slice(2).split('/').map(decodePointer);
  let cur: unknown = root;
  for (const part of parts) {
    // OWN-property only: a `#/constructor`-style ref must resolve to undefined,
    // not walk into Object.prototype (same prototype-chain hazard as `in`).
    if (
      cur !== null &&
      typeof cur === 'object' &&
      Object.prototype.hasOwnProperty.call(cur, part)
    ) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

function decodePointer(part: string): string {
  return part.replace(/~1/g, '/').replace(/~0/g, '~');
}

/** Structural equality over JSON values (primitives, arrays, plain objects). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao);
    const bk = Object.keys(bo);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => k in bo && deepEqual(ao[k], bo[k]));
  }
  return false;
}

function joinPath(path: string, key: string): string {
  return path === '' ? key : `${path}.${key}`;
}
