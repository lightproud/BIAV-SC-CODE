/**
 * T50 batch L — the three WONTFIX candidates, resolved per keeper ruling
 * (2026-07-17, "按你建议推进"):
 *
 *   Q1  SandboxOptions.envScrub — opt-in env allowlist for sandboxed spawns
 *   B3  provider.openai.strictStructuredOutput — opt-in json_schema strict:true
 *   G4  SendMessage summary — forwarded to the background delivery notification
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SANDBOX_ENV_ALLOWLIST,
  resolveEnvAllowlist,
  resolveSpawnEnv,
} from '../src/sandbox/backend.js';
import { encodeOpenAIRequest } from '../src/transport/openai.js';
import type { SandboxContext, StreamRequest } from '../src/types.js';

// ---------------------------------------------------------------------------
// Q1 — env scrub
// ---------------------------------------------------------------------------

describe('Q1 — SandboxOptions.envScrub', () => {
  const sbx = (envAllowlist?: readonly string[]): SandboxContext => ({
    backend: { name: 'fake', wrap: () => ({ command: 'x', args: [] }) },
    tmpDir: '/tmp/sbx',
    writablePaths: [],
    allowNetwork: false,
    allowEscape: true,
    envAllowlist,
  });

  it('resolveEnvAllowlist: undefined/false → no scrub; true → built-in list; object → its allow', () => {
    expect(resolveEnvAllowlist(undefined)).toBeUndefined();
    expect(resolveEnvAllowlist(false)).toBeUndefined();
    expect(resolveEnvAllowlist(true)).toBe(DEFAULT_SANDBOX_ENV_ALLOWLIST);
    expect(resolveEnvAllowlist({ allow: ['PATH', 'FOO'] })).toEqual(['PATH', 'FOO']);
    // an object with no `allow` falls back to the built-in essentials
    expect(resolveEnvAllowlist({})).toBe(DEFAULT_SANDBOX_ENV_ALLOWLIST);
  });

  const base = { PATH: '/bin', HOME: '/home/u', ANTHROPIC_API_KEY: 'sk-secret', AWS_SECRET: 'x' };

  it('default (no allowlist): the full env passes through — parity', () => {
    const env = resolveSpawnEnv(base, { TMPDIR: '/tmp/sbx' }, sbx(undefined), false);
    expect(env.ANTHROPIC_API_KEY).toBe('sk-secret');
    expect(env.TMPDIR).toBe('/tmp/sbx');
  });

  it('with an allowlist: only allowed keys survive; secrets are dropped; overlay always applied', () => {
    const env = resolveSpawnEnv(base, { TMPDIR: '/tmp/sbx' }, sbx(['PATH', 'HOME']), false);
    expect(env.PATH).toBe('/bin');
    expect(env.HOME).toBe('/home/u');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.AWS_SECRET).toBeUndefined();
    expect(env.TMPDIR).toBe('/tmp/sbx'); // $TMPDIR overlay survives the scrub
  });

  it('an UNSANDBOXED / escaped command always inherits the full env (no containment claim)', () => {
    // disableSandbox = true -> scrub is skipped even with an allowlist set
    const env = resolveSpawnEnv(base, { TMPDIR: '/tmp/sbx' }, sbx(['PATH']), true);
    expect(env.ANTHROPIC_API_KEY).toBe('sk-secret');
    // and no sandbox at all -> full env
    const env2 = resolveSpawnEnv(base, {}, undefined, false);
    expect(env2.ANTHROPIC_API_KEY).toBe('sk-secret');
  });
});

// ---------------------------------------------------------------------------
// B3 — strict structured output (opt-in)
// ---------------------------------------------------------------------------

describe('B3 — provider.openai.strictStructuredOutput', () => {
  const reqWithSchema = {
    model: 'gpt-4o',
    max_tokens: 100,
    messages: [{ role: 'user', content: 'hi' }],
    output_config: { format: { type: 'json_schema', schema: { type: 'object' } } },
  } as unknown as Omit<StreamRequest, 'signal' | 'onRetry'>;

  const jsonSchema = (body: Record<string, unknown>): Record<string, unknown> =>
    (body.response_format as { json_schema: Record<string, unknown> }).json_schema;

  it('default (flag off): json_schema carries NO strict field (best-effort, gateway-safe)', () => {
    const body = encodeOpenAIRequest(reqWithSchema, {});
    expect('strict' in jsonSchema(body)).toBe(false);
  });

  it('opt-in (flag on): json_schema carries strict:true', () => {
    const body = encodeOpenAIRequest(reqWithSchema, { strictStructuredOutput: true });
    expect(jsonSchema(body).strict).toBe(true);
  });

  it('the schema itself is still forwarded verbatim under strict', () => {
    const body = encodeOpenAIRequest(reqWithSchema, { strictStructuredOutput: true });
    expect(jsonSchema(body).schema).toEqual({ type: 'object' });
    expect(jsonSchema(body).name).toBe('structured_output');
  });
});
