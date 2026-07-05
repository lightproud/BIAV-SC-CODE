/**
 * Conformance L2 - single-arm semantic locks for request-visible options.
 *
 * These options were demoted from the L2 dual-arm scenario list because their
 * effect is only visible in the REQUEST body/headers, and the content-blind
 * discipline (memory/decisions.md 2026-07-05 "净室观测边界" r2) forbids reading
 * official-arm request bodies. For OUR OWN engine that restriction does not
 * apply - so each row gets a request-capturing vitest lock here instead of a
 * scenario slot. If our request mapping drifts (betas header, system prompt
 * assembly, thinking params, model resolution, fallback retry, session
 * persistence), this file fails in `npm test` with no official arm needed.
 *
 * Request capture uses the sse-fetch stub (tests/helpers/sse-fetch.ts): it
 * records every outgoing request's URL, headers, and parsed JSON body - the
 * exact surface the content-blind emulator must never look at.
 *
 * Single-arm rows covered (mapping-agent spec, M2/B2): betas, systemPrompt
 * (string / preset+append / segments), settingSources, thinking /
 * maxThinkingTokens, env -> transport, model resolution order, fallbackModel,
 * persistSession / sessionId. strictMcpConfig is skipped as sanctioned
 * ("triviality is skippable"): the option is typed but consulted nowhere -
 * only options.mcpServers plus the settingSources-gated .mcp.json loader feed
 * the registry, so there is no strict/lax fork to lock yet (COMPAT row
 * reconciliation flagged upstream).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { query } from '../src/index.js';
import type { SDKMessage, SDKSystemMessage } from '../src/index.js';
import { encodeSSEFrame, makeSSEFetch } from './helpers/sse-fetch.js';
import { textReplyEvents } from './helpers/mock-transport.js';

const DUMMY_KEY = 'sk-ant-api03-' + 'A'.repeat(95);

let sandbox: string;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'conf-l2-'));
});

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(sandbox, { recursive: true, force: true });
});

async function collect(q: AsyncGenerator<SDKMessage, void>): Promise<SDKMessage[]> {
  const out: SDKMessage[] = [];
  for await (const m of q) out.push(m);
  return out;
}

function initOf(messages: SDKMessage[]): SDKSystemMessage {
  const init = messages.find(
    (m): m is SDKSystemMessage => m.type === 'system' && m.subtype === 'init',
  );
  expect(init).toBeDefined();
  return init as SDKSystemMessage;
}

/** Baseline options: keyed, sandboxed sessions, no real network. */
function opts(extra: Record<string, unknown> = {}) {
  return {
    provider: { apiKey: 'test-key' },
    sessionDir: path.join(sandbox, '.sessions'),
    cwd: sandbox,
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    model: 'claude-conformance-l2',
    ...extra,
  };
}

/** Flatten a request body's system field (string or block array) to text. */
function systemText(body: Record<string, any>): string {
  const s = body.system;
  if (typeof s === 'string') return s;
  if (Array.isArray(s)) return s.map((b: { text?: string }) => b.text ?? '').join('\n');
  return '';
}

/**
 * Minimal recording fetch for status-code scripting the sse-fetch stub does
 * not cover: responds per `statuses` (a number -> that HTTP error; 'ok' ->
 * one scripted text reply), recording each parsed JSON body. Used by the
 * fallbackModel locks, where the FIRST response must be a 429.
 */
function makeStatusFetch(statuses: Array<number | 'ok'>, replyText: string) {
  const requests: Array<{ body: Record<string, any> }> = [];
  let calls = 0;
  const impl = async (_input: unknown, init?: RequestInit): Promise<Response> => {
    requests.push({ body: JSON.parse(String(init?.body)) as Record<string, any> });
    const step = statuses[calls++];
    if (typeof step === 'number') {
      return new Response(
        JSON.stringify({
          type: 'error',
          error: { type: 'rate_limit_error', message: 'conf-l2 emulated failure' },
        }),
        // retry-after 0 keeps transport-level backoff instant and deterministic.
        { status: step, headers: { 'content-type': 'application/json', 'retry-after': '0' } },
      );
    }
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const ev of textReplyEvents(replyText)) controller.enqueue(encodeSSEFrame(ev));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  };
  return Object.assign(vi.fn(impl), { requests });
}

describe('L2 lock: betas header forwarding', () => {
  it('options.betas lands joined in the anthropic-beta header; absent without', async () => {
    const fetchStub = makeSSEFetch([textReplyEvents('ok'), textReplyEvents('ok')]);
    vi.stubGlobal('fetch', fetchStub);

    await collect(
      query({
        prompt: 'hi',
        options: opts({ betas: ['conf-beta-a-2026-01-01', 'conf-beta-b-2026-02-02'] }),
      }),
    );
    expect(fetchStub.requests[0]!.headers['anthropic-beta']).toBe(
      'conf-beta-a-2026-01-01,conf-beta-b-2026-02-02',
    );

    await collect(query({ prompt: 'hi', options: opts() }));
    expect(fetchStub.requests[1]!.headers['anthropic-beta']).toBeUndefined();
  });

  it('options.betas merges after a provider defaultHeaders anthropic-beta value', async () => {
    const fetchStub = makeSSEFetch([textReplyEvents('ok')]);
    vi.stubGlobal('fetch', fetchStub);

    await collect(
      query({
        prompt: 'hi',
        options: opts({
          provider: {
            apiKey: 'test-key',
            defaultHeaders: { 'anthropic-beta': 'base-flag-2026' },
          },
          betas: ['extra-flag-2026'],
        }),
      }),
    );
    expect(fetchStub.requests[0]!.headers['anthropic-beta']).toBe(
      'base-flag-2026,extra-flag-2026',
    );
  });
});

describe('L2 lock: systemPrompt request mapping', () => {
  it('string form is sent verbatim as the entire system - no volatile cwd tail (caching off)', async () => {
    const fetchStub = makeSSEFetch([textReplyEvents('ok')]);
    vi.stubGlobal('fetch', fetchStub);
    const callerPrompt = 'CONF-L2 caller-owned system prompt. Entirely stable.';

    await collect(
      query({
        prompt: 'hi',
        options: opts({
          systemPrompt: callerPrompt,
          provider: { apiKey: 'test-key', promptCaching: false },
        }),
      }),
    );
    const body = fetchStub.requests[0]!.body;
    // Caching off -> flat string, byte-equal to the caller's text.
    expect(body.system).toBe(callerPrompt);
    // A string systemPrompt has NO volatile tail: the cwd never rides along.
    expect(JSON.stringify(body.system)).not.toContain(sandbox);
  });

  it('string form with caching on becomes exactly one cached block, still no cwd tail', async () => {
    const fetchStub = makeSSEFetch([textReplyEvents('ok')]);
    vi.stubGlobal('fetch', fetchStub);
    const callerPrompt = 'CONF-L2 cached caller prompt.';

    await collect(
      query({ prompt: 'hi', options: opts({ systemPrompt: callerPrompt }) }),
    );
    const body = fetchStub.requests[0]!.body;
    expect(body.system).toEqual([
      { type: 'text', text: callerPrompt, cache_control: { type: 'ephemeral' } },
    ]);
  });

  it('claude_code preset + append: [stable(cached, append at tail), volatile(uncached, cwd)] split', async () => {
    const fetchStub = makeSSEFetch([textReplyEvents('ok')]);
    vi.stubGlobal('fetch', fetchStub);

    await collect(
      query({
        prompt: 'hi',
        options: opts({
          systemPrompt: {
            type: 'preset',
            preset: 'claude_code',
            append: 'CONF-L2-APPEND-MARKER',
          },
        }),
      }),
    );
    const body = fetchStub.requests[0]!.body;
    expect(Array.isArray(body.system)).toBe(true);
    expect(body.system).toHaveLength(2);
    const [stable, volatile_] = body.system as Array<Record<string, any>>;
    // Cache breakpoint sits on the STABLE prefix ('first' boundary), so the
    // per-run cwd tail cannot invalidate the cross-query cached prefix.
    expect(stable!.cache_control).toEqual({ type: 'ephemeral' });
    expect(stable!.text).toContain('CONF-L2-APPEND-MARKER');
    expect(stable!.text.endsWith('CONF-L2-APPEND-MARKER')).toBe(true);
    expect(volatile_!.cache_control).toBeUndefined();
    expect(volatile_!.text).toContain(`Working directory: ${sandbox}`);
    // The volatile facts must NOT leak into the stable (cached) segment.
    expect(stable!.text).not.toContain(`Working directory: ${sandbox}`);
  });

  it('segments form: blocks forwarded verbatim, per-segment cache_control, cap of 3 cached segments', async () => {
    const fetchStub = makeSSEFetch([textReplyEvents('ok')]);
    vi.stubGlobal('fetch', fetchStub);

    await collect(
      query({
        prompt: 'hi',
        options: opts({
          systemPrompt: {
            type: 'segments',
            segments: [
              { text: 'SEG-A shared org layer', cache: true },
              { text: 'SEG-B project layer', cache: true },
              { text: 'SEG-C team layer', cache: true },
              // 4th cache request exceeds the 3-breakpoint budget (COMPAT cap:
              // 4 API breakpoints total, 1 reserved for tool schemas).
              { text: 'SEG-D over-budget layer', cache: true },
            ],
          },
        }),
      }),
    );
    const body = fetchStub.requests[0]!.body;
    expect(body.system).toEqual([
      { type: 'text', text: 'SEG-A shared org layer', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'SEG-B project layer', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'SEG-C team layer', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'SEG-D over-budget layer' },
    ]);
  });
});

describe('L2 lock: settingSources CLAUDE.md injection', () => {
  it("['project'] injects cwd CLAUDE.md into the stable system-reminder; unset does not", async () => {
    fs.writeFileSync(
      path.join(sandbox, 'CLAUDE.md'),
      'CONF-L2-CLAUDEMD-MARKER: follow the conformance house rules.\n',
    );
    const fetchStub = makeSSEFetch([textReplyEvents('ok'), textReplyEvents('ok')]);
    vi.stubGlobal('fetch', fetchStub);
    const preset = { type: 'preset', preset: 'claude_code' } as const;

    await collect(
      query({
        prompt: 'hi',
        options: opts({ systemPrompt: preset, settingSources: ['project'] }),
      }),
    );
    const withSource = systemText(fetchStub.requests[0]!.body);
    expect(withSource).toContain('CONF-L2-CLAUDEMD-MARKER');
    expect(withSource).toContain('<system-reminder>');
    // Project instructions are stable-per-project: they live in the CACHED
    // stable block, not the volatile tail.
    const stableBlock = (fetchStub.requests[0]!.body.system as Array<Record<string, any>>)[0]!;
    expect(stableBlock.text).toContain('CONF-L2-CLAUDEMD-MARKER');

    await collect(query({ prompt: 'hi', options: opts({ systemPrompt: preset }) }));
    expect(systemText(fetchStub.requests[1]!.body)).not.toContain('CONF-L2-CLAUDEMD-MARKER');
  });
});

describe('L2 lock: thinking / maxThinkingTokens mapping', () => {
  it("thinking {type:'enabled', budgetTokens} maps to API thinking.budget_tokens", async () => {
    const fetchStub = makeSSEFetch([textReplyEvents('ok')]);
    vi.stubGlobal('fetch', fetchStub);

    await collect(
      query({
        prompt: 'hi',
        options: opts({ thinking: { type: 'enabled', budgetTokens: 1234 } }),
      }),
    );
    expect(fetchStub.requests[0]!.body.thinking).toEqual({
      type: 'enabled',
      budget_tokens: 1234,
    });
  });

  it('thinking budget is clamped below max_tokens (API requires budget_tokens < max_tokens)', async () => {
    const fetchStub = makeSSEFetch([textReplyEvents('ok')]);
    vi.stubGlobal('fetch', fetchStub);

    await collect(
      query({
        prompt: 'hi',
        // Default max_tokens is 8192; a 50000 budget would 400 the real API.
        options: opts({ thinking: { type: 'enabled', budgetTokens: 50_000 } }),
      }),
    );
    const body = fetchStub.requests[0]!.body;
    expect(body.max_tokens).toBe(8192);
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 8191 });
  });

  it('maxThinkingTokens alone sends NO thinking param; it is only the budget fallback when enabled', async () => {
    const fetchStub = makeSSEFetch([textReplyEvents('ok'), textReplyEvents('ok')]);
    vi.stubGlobal('fetch', fetchStub);

    // COMPAT PARTIAL note (options table): "maxThinkingTokens alone is only a
    // budget fallback and sends no thinking param on its own".
    await collect(
      query({ prompt: 'hi', options: opts({ maxThinkingTokens: 2048 }) }),
    );
    expect(fetchStub.requests[0]!.body).not.toHaveProperty('thinking');

    await collect(
      query({
        prompt: 'hi',
        options: opts({ maxThinkingTokens: 2048, thinking: { type: 'enabled' } }),
      }),
    );
    expect(fetchStub.requests[1]!.body.thinking).toEqual({
      type: 'enabled',
      budget_tokens: 2048,
    });
  });
});

describe('L2 lock: env passthrough to the transport', () => {
  it('options.env supplies base URL and credential (not process.env), apiKeySource reads project', async () => {
    const fetchStub = makeSSEFetch([textReplyEvents('ok')]);
    vi.stubGlobal('fetch', fetchStub);

    const messages = await collect(
      query({
        prompt: 'hi',
        options: {
          cwd: sandbox,
          sessionDir: path.join(sandbox, '.sessions'),
          model: 'claude-conformance-l2',
          // No provider config at all: everything must come from options.env.
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            ANTHROPIC_BASE_URL: 'http://conf-l2-env-routed.invalid',
            ANTHROPIC_API_KEY: DUMMY_KEY,
          },
        },
      }),
    );
    const req = fetchStub.requests[0]!;
    expect(req.url).toBe('http://conf-l2-env-routed.invalid/v1/messages');
    expect(req.headers['x-api-key']).toBe(DUMMY_KEY);
    // Env-sourced credential is reported as 'project' in the init message.
    expect(initOf(messages).apiKeySource).toBe('project');
  });
});

describe('L2 lock: model resolution order', () => {
  it('options.model > env.ANTHROPIC_MODEL > built-in default', async () => {
    const fetchStub = makeSSEFetch([
      textReplyEvents('ok'),
      textReplyEvents('ok'),
      textReplyEvents('ok'),
    ]);
    vi.stubGlobal('fetch', fetchStub);
    const envWithModel = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      ANTHROPIC_MODEL: 'model-from-env',
    };

    await collect(
      query({
        prompt: 'hi',
        options: opts({ model: 'model-explicit', env: envWithModel }),
      }),
    );
    expect(fetchStub.requests[0]!.body.model).toBe('model-explicit');

    await collect(
      query({ prompt: 'hi', options: opts({ model: undefined, env: envWithModel }) }),
    );
    expect(fetchStub.requests[1]!.body.model).toBe('model-from-env');

    await collect(query({ prompt: 'hi', options: opts({ model: undefined }) }));
    expect(fetchStub.requests[2]!.body.model).toBe('claude-sonnet-4-5');
  });
});

describe('L2 lock: fallbackModel retry semantics', () => {
  it('after a non-retryable-exhausted 429, the turn retries once with body.model = fallbackModel', async () => {
    // maxRetries 0 makes the transport surface the 429 immediately, so the
    // ENGINE's one-shot fallback retry is what issues request #2.
    const fetchStub = makeStatusFetch([429, 'ok'], 'fallback ok');
    vi.stubGlobal('fetch', fetchStub);

    const messages = await collect(
      query({
        prompt: 'hi',
        options: opts({
          model: 'model-primary',
          fallbackModel: 'model-fallback',
          provider: { apiKey: 'test-key', maxRetries: 0 },
        }),
      }),
    );
    expect(fetchStub.requests).toHaveLength(2);
    expect(fetchStub.requests[0]!.body.model).toBe('model-primary');
    expect(fetchStub.requests[1]!.body.model).toBe('model-fallback');
    const result = messages[messages.length - 1] as { type: string; subtype: string };
    expect(result.type).toBe('result');
    expect(result.subtype).toBe('success');
  });

  it('without fallbackModel, the transport-level 429 retry keeps the ORIGINAL model', async () => {
    const fetchStub = makeStatusFetch([429, 'ok'], 'native retry ok');
    vi.stubGlobal('fetch', fetchStub);

    const messages = await collect(
      query({
        prompt: 'hi',
        options: opts({
          model: 'model-primary',
          provider: { apiKey: 'test-key', maxRetries: 1 },
        }),
      }),
    );
    expect(fetchStub.requests).toHaveLength(2);
    expect(fetchStub.requests[1]!.body.model).toBe('model-primary');
    // An ACTUAL 429 retry surfaces as rate_limit_event on this SDK (KD-02:
    // the official arm broadcasts rate-limit status even on success).
    expect(messages.some((m) => m.type === 'rate_limit_event')).toBe(true);
    const result = messages[messages.length - 1] as { type: string; subtype: string };
    expect(result.subtype).toBe('success');
  });
});

describe('L2 lock: session identity and persistence', () => {
  it('init.session_id echoes options.sessionId and the transcript JSONL lands under sessionDir', async () => {
    const fetchStub = makeSSEFetch([textReplyEvents('ok')]);
    vi.stubGlobal('fetch', fetchStub);
    const sessionId = 'conf-l2-session-0001';
    const sessionDir = path.join(sandbox, '.sessions');

    const messages = await collect(
      query({ prompt: 'hi', options: opts({ sessionId }) }),
    );
    expect(initOf(messages).session_id).toBe(sessionId);

    const transcript = path.join(sessionDir, `${sessionId}.jsonl`);
    expect(fs.existsSync(transcript)).toBe(true);
    const lines = fs.readFileSync(transcript, 'utf8').trim().split('\n');
    const meta = JSON.parse(lines[0]!) as { type: string; sessionId: string };
    expect(meta.type).toBe('meta');
    expect(meta.sessionId).toBe(sessionId);
  });

  it('persistSession:false labels the session but writes NO transcript file', async () => {
    const fetchStub = makeSSEFetch([textReplyEvents('ok')]);
    vi.stubGlobal('fetch', fetchStub);
    const sessionId = 'conf-l2-session-ephemeral';
    const sessionDir = path.join(sandbox, '.sessions');

    const messages = await collect(
      query({ prompt: 'hi', options: opts({ sessionId, persistSession: false }) }),
    );
    // The id still labels the run publicly (init + result share it) ...
    expect(initOf(messages).session_id).toBe(sessionId);
    // ... but nothing is persisted for it.
    expect(fs.existsSync(path.join(sessionDir, `${sessionId}.jsonl`))).toBe(false);
  });
});
