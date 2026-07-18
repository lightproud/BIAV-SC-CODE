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
 * WV4-9 (audit r3): a caller-supplied circular schema makes `JSON.stringify`
 * throw `TypeError: Converting circular structure to JSON` — and these run
 * while assembling the system prompt in query(), so the whole query crashes at
 * construction before any turn. Degrade to a placeholder instead of throwing;
 * the schema is still enforced by the validator, only the human-readable echo
 * is lost.
 */
/** WV4-9 (audit r3): every schema-embedding call site went through a bare
 *  `JSON.stringify(schema)` that throws on a circular/self-referential schema,
 *  taking the whole instruction/correction build down with it. Guard it once
 *  here; `pretty` preserves the two distinct on-wire formats (the persistent
 *  instruction is pretty-printed, the retry corrections are compact). */
function safeStringifySchema(schema: JSONSchema, pretty = false): string {
  try {
    return pretty ? JSON.stringify(schema, null, 2) : JSON.stringify(schema);
  } catch {
    return '[schema could not be serialized (circular reference)]';
  }
}

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
    safeStringifySchema(schema, true)
  );
}

// ---------------------------------------------------------------------------
// Top-level evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate the model's final text against the required schema. Extraction is
 * SCHEMA-AWARE (H5, audit T49): every lenient JSON candidate (direct parse,
 * fenced block, each balanced span in order) is validated in turn and the
 * FIRST schema-valid one wins. The previous behavior validated only the first
 * PARSEABLE span, so a leading "legal but wrong" JSON value in prose (e.g.
 * `{"note":"x"}` before the real `{"answer":42}`) failed the turn and burned
 * the bounded retries even though a valid answer was present. When no
 * candidate validates, the invalid outcome reports the first candidate's
 * violations (the best anchor for the corrective re-prompt), or the
 * not-JSON reason when nothing parsed at all.
 *
 * `extraction` (audit r4 Z1-1): the engine's structured-output turn has a
 * bounded correction-retry loop, so 'lenient' (the default) maximizes the
 * chance of salvaging an answer. Callers with NO retry channel (workflow
 * agent(), where an accepted-but-wrong span silently poisons the script's
 * data) pass 'strict': only a direct parse of the whole reply or a fenced
 * block is considered — prose is never scanned for embedded JSON spans.
 */
export function evaluateStructuredOutput(
  text: string,
  schema: JSONSchema,
  opts?: { extraction?: 'lenient' | 'strict' },
): StructuredOutcome {
  let firstErrors: ValidationError[] | undefined;
  let sawCandidate = false;
  let notJsonReason = 'empty response';
  for (const candidate of jsonCandidates(text, opts?.extraction ?? 'lenient')) {
    if (!candidate.ok) {
      notJsonReason = candidate.reason;
      continue;
    }
    sawCandidate = true;
    const errors = validateValue(candidate.value, schema, schema, '', 0);
    if (errors.length === 0) {
      return { status: 'valid', value: candidate.value };
    }
    firstErrors ??= errors;
  }

  if (!sawCandidate || firstErrors === undefined) {
    const summary = `response was not valid JSON: ${notJsonReason}`;
    const correction =
      'Your previous response did not satisfy the required output format.\n' +
      `The response could not be parsed as JSON: ${notJsonReason}\n` +
      '\nRespond with ONLY a single JSON value conforming to this JSON Schema ' +
      '(no prose, no code fences):\n' +
      safeStringifySchema(schema);
    return { status: 'invalid', correction, summary };
  }

  const preview = firstErrors
    .slice(0, 5)
    .map((e) => `${e.path === '' ? '(root)' : e.path}: ${e.message}`)
    .join('; ');
  const summary = `${firstErrors.length} schema violation(s): ${preview}`;
  const correction =
    'Your previous response did not satisfy the required output format.\n' +
    'Validation errors:\n' +
    firstErrors.map((e) => `- ${e.path === '' ? '(root)' : e.path}: ${e.message}`).join('\n') +
    '\n\nRespond with ONLY a single JSON value conforming to this JSON Schema ' +
    '(no prose, no code fences):\n' +
    safeStringifySchema(schema);
  return { status: 'invalid', correction, summary };
}

// ---------------------------------------------------------------------------
// JSON extraction (internal)
// ---------------------------------------------------------------------------

type ExtractResult = { ok: true; value: unknown } | { ok: false; reason: string };

/**
 * Lenient extraction, yielding EVERY parseable candidate in precedence order:
 * (a) trim + direct JSON.parse; (b) fenced ```json / ``` block; (c) each
 * balanced {..}/[..] span in appearance order (string-aware; a stray
 * wrong-type bracket in leading prose must not hide the real JSON after it).
 * A single not-ok item (the direct-parse failure reason) is yielded first when
 * the whole text is not JSON, so the caller can report why. The caller
 * validates candidates against the schema and takes the first VALID one (H5) —
 * this generator stays schema-agnostic.
 *
 * 'strict' mode (audit r4 Z1-1) stops after (a) and (b): balanced-span
 * scanning over prose is skipped, so an embedded example object can never be
 * mistaken for the reply.
 */
function* jsonCandidates(
  text: string,
  extraction: 'lenient' | 'strict',
): Generator<ExtractResult> {
  const trimmed = text.trim();
  if (trimmed === '') {
    yield { ok: false, reason: 'empty response' };
    return;
  }

  const direct = tryParse(trimmed);
  if (direct.ok) {
    yield direct;
    return; // the whole text IS the value; there is no other candidate
  }
  yield { ok: false, reason: direct.reason };

  const fenced = extractFenced(trimmed);
  if (fenced !== undefined) {
    const parsed = tryParse(fenced);
    if (parsed.ok) yield parsed;
  }

  if (extraction === 'strict') return;

  let from = 0;
  for (;;) {
    const scanned = scanBalanced(trimmed, from);
    if (scanned === undefined) break;
    if (scanned.span !== null) {
      const parsed = tryParse(scanned.span);
      if (parsed.ok) yield parsed;
      // WV4-1 (audit r3): advance PAST the produced span, not one char into it.
      // Resuming at start+1 descended into the object just yielded, so every
      // nested `{…}` fragment was re-yielded as a candidate — a prose-wrapped
      // nested fragment could then win over the real outer answer (H5 residual).
      from = scanned.start + scanned.span.length;
    } else {
      from = scanned.start + 1;
    }
  }
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
/** Public thin wrapper: true when `value` satisfies `schema` (the documented
 *  common subset). Used by the MCP elicitation gate (WV4-3) to reject
 *  accepted content that violates the request's requestedSchema. */
export function valueMatchesSchema(value: unknown, schema: JSONSchema): boolean {
  return validateValue(value, schema, schema, '', 0).length === 0;
}

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

  // string constraints. JSON Schema defines string length in Unicode CODE
  // POINTS, but String#length counts UTF-16 code units, so an astral character
  // (emoji, rare CJK) double-counts and a valid string fails minLength/maxLength
  // (audit r4 U6-2). Count code points via the string iterator; compute only
  // when a length constraint is present (spread is O(n)).
  if (typeof value === 'string' && (typeof s.minLength === 'number' || typeof s.maxLength === 'number')) {
    const codePoints = [...value].length;
    if (typeof s.minLength === 'number' && codePoints < s.minLength) {
      errors.push({ path, message: `expected length >= ${s.minLength}` });
    }
    if (typeof s.maxLength === 'number' && codePoints > s.maxLength) {
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
