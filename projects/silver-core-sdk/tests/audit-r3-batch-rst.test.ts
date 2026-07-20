/**
 * Audit r3 batches R + S + T (T51) — deep-read source-code regression locks
 * (report: Public-Info-Pool/Resource/repo-engineering/
 * silver-core-sdk-bug-audit-r3-20260717.md).
 *
 * These lock the observable behaviour of the deep-read fixes; the internal
 * bookkeeping fixes (usage merge, transport backoff, settle disposal) whose
 * effects are not reachable through a public surface are exercised by their
 * own module suites and by the type-checker.
 *
 *  - WV4-3/WV4-9: valueMatchesSchema is exported and validates structurally.
 *  - WV4-5: supportsAdaptiveThinking treats an explicit minor as a right-bounded
 *           token (opus-4-5 is pre-adaptive; opus-4-50 is NOT that model).
 *  - WV4-3 (elicitation): an accept whose content violates requestedSchema is
 *           downgraded to decline (never forwards invalid typed input).
 *  - WV2-4 (keeper ruling T60, option ③): a caller temperature != 1 is dropped
 *           ONLY on a declared reasoning endpoint (caps.thinking === true);
 *           unknown / thinking:false gateways pass it through untouched.
 */

import { describe, it, expect } from 'vitest';
import { valueMatchesSchema } from '../src/internal/structured-output.js';
import { supportsAdaptiveThinking } from '../src/engine/thinking-model.js';
import { resolveElicitation } from '../src/mcp/elicitation.js';
import { encodeOpenAIRequest } from '../src/transport/openai.js';

// ---------------------------------------------------------------------------
// WV4-3 / WV4-9 — valueMatchesSchema public surface
// ---------------------------------------------------------------------------

describe('WV4-3/WV4-9: valueMatchesSchema validates structurally', () => {
  it('accepts a value that satisfies a typed object schema', () => {
    const schema = {
      type: 'object',
      properties: { n: { type: 'number' } },
      required: ['n'],
    } as const;
    expect(valueMatchesSchema({ n: 3 }, schema)).toBe(true);
  });

  it('rejects a value that violates the declared type', () => {
    const schema = {
      type: 'object',
      properties: { n: { type: 'number' } },
      required: ['n'],
    } as const;
    expect(valueMatchesSchema({ n: 'not-a-number' }, schema)).toBe(false);
  });

  it('is lenient on a malformed / boolean-ish schema (no constraint)', () => {
    expect(valueMatchesSchema({ anything: true }, true as unknown as never)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// WV4-5 — pre-adaptive minor version is right-bounded
// ---------------------------------------------------------------------------

describe('WV4-5: explicit minor needs a right boundary', () => {
  it('classifies opus-4-5 as pre-adaptive (no adaptive thinking)', () => {
    expect(supportsAdaptiveThinking('claude-opus-4-5')).toBe(false);
  });

  it('does NOT let opus-4-5 swallow opus-4-50', () => {
    // A hypothetical opus-4-50 is a different model; the pre-adaptive lock must
    // not fire on it via a left-anchored prefix match.
    expect(supportsAdaptiveThinking('claude-opus-4-50')).toBe(true);
  });

  it('still classifies a bare opus-4 as pre-adaptive', () => {
    expect(supportsAdaptiveThinking('claude-opus-4')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// WV4-3 (elicitation) — accept with schema-violating content fails closed
// ---------------------------------------------------------------------------

describe('WV4-3: elicitation validates accepted content against requestedSchema', () => {
  const schema = {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
  };

  it('forwards an accept whose content matches the schema', async () => {
    const res = await resolveElicitation(
      { message: 'name?', requestedSchema: schema },
      async () => ({ action: 'accept', content: { name: 'erica' } }),
      new AbortController().signal,
    );
    expect(res.action).toBe('accept');
  });

  it('downgrades an accept whose content violates the schema to decline', async () => {
    const res = await resolveElicitation(
      { message: 'name?', requestedSchema: schema },
      async () => ({ action: 'accept', content: { name: 42 } }),
      new AbortController().signal,
    );
    expect(res.action).toBe('decline');
  });

  it('declines when the abort signal fires before the handler resolves', async () => {
    const ctrl = new AbortController();
    const pending = resolveElicitation(
      { message: 'name?', requestedSchema: schema },
      () =>
        new Promise(() => {
          // Handler that never resolves and ignores the signal — only the
          // abort race can settle the elicitation.
        }),
      ctrl.signal,
    );
    // Fire the abort after the handler is in-flight; the race resolves via the
    // abort branch rather than hanging on the never-fulfilled handler.
    ctrl.abort();
    expect((await pending).action).toBe('decline');
  });
});

// ---------------------------------------------------------------------------
// WV2-4 (keeper ruling T60, option ③) — caps-gated temperature suppression
// ---------------------------------------------------------------------------

describe('WV2-4: temperature != 1 dropped ONLY on a declared reasoning endpoint', () => {
  const req = (temperature?: number) => ({
    model: 'o3',
    max_tokens: 100,
    messages: [{ role: 'user' as const, content: 'x' }],
    ...(temperature !== undefined ? { temperature } : {}),
  });

  it('drops a stray temperature when caps.thinking === true and reasoning is active', () => {
    const body = encodeOpenAIRequest(req(0.7), { reasoningEffort: 'high' }, undefined, {
      thinking: true,
    });
    expect('temperature' in body).toBe(false);
    expect(body.reasoning_effort).toBe('high');
  });

  it('keeps temperature exactly 1 even on a declared reasoning endpoint', () => {
    const body = encodeOpenAIRequest(req(1), { reasoningEffort: 'high' }, undefined, {
      thinking: true,
    });
    expect(body.temperature).toBe(1);
  });

  it('passes temperature through on an UNKNOWN gateway (caps undefined)', () => {
    // The vLLM/Qwen-style case: no capability declaration — never rewrite intent.
    const body = encodeOpenAIRequest(req(0), { reasoningEffort: 'high' });
    expect(body.temperature).toBe(0);
  });

  it('passes temperature through when the endpoint declares thinking: false', () => {
    const body = encodeOpenAIRequest(req(0), { reasoningEffort: 'high' }, undefined, {
      thinking: false,
    });
    expect(body.temperature).toBe(0);
  });

  it('passes temperature through on a declared reasoning endpoint when reasoning is NOT active', () => {
    const body = encodeOpenAIRequest(req(0.5), {}, undefined, { thinking: true });
    expect(body.temperature).toBe(0.5);
  });
});
