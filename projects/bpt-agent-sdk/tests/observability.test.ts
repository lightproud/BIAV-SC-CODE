/**
 * v0.3 task #16 — observability message stream.
 *
 * Two guards:
 *  1. Behavioral: a gate deny surfaces an SDKPermissionDeniedMessage in the
 *     stream (before the terminal result), matching the denial ledger.
 *  2. Structural: an exhaustive switch over SDKObservabilityMessage that only
 *     compiles when every variant is present in the union (a `never` default),
 *     exercised at runtime over one sample of each variant.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { query } from '../src/index.js';
import type {
  SDKMessage,
  SDKObservabilityMessage,
  SDKPermissionDeniedMessage,
  SDKResultMessage,
} from '../src/index.js';
import { makeSSEFetch } from './helpers/sse-fetch.js';
import { textReplyEvents, toolUseReplyEvents } from './helpers/mock-transport.js';

let sandbox: string;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bpt-observ-'));
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

function opts(extra: Record<string, unknown> = {}) {
  return {
    provider: { apiKey: 'test-key', promptCaching: false },
    sessionDir: path.join(sandbox, '.sessions'),
    cwd: sandbox,
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    model: 'claude-sonnet-4-5',
    ...extra,
  };
}

describe('v0.3 permission_denied emission', () => {
  it('emits SDKPermissionDeniedMessage when the gate denies a tool', async () => {
    vi.stubGlobal(
      'fetch',
      makeSSEFetch([
        toolUseReplyEvents('Bash', { command: 'echo hi' }),
        textReplyEvents('done'),
      ]),
    );
    const messages = await collect(
      query({
        prompt: 'run it',
        options: opts({
          permissionMode: 'default',
          // Falls through to canUseTool for a non-readonly tool in default mode;
          // a deny here is recorded in the ledger and drives permission_denied.
          canUseTool: async () => ({ behavior: 'deny' as const, message: 'nope' }),
        }),
      }),
    );

    const denied = messages.filter(
      (m): m is SDKPermissionDeniedMessage => m.type === 'permission_denied',
    );
    expect(denied).toHaveLength(1);
    expect(denied[0]!.tool_name).toBe('Bash');
    expect(denied[0]!.tool_use_id).toBeTruthy();
    expect(denied[0]!.reason).toBeTruthy();
    expect(denied[0]!.session_id).toBeTruthy();

    // It precedes the terminal result in the stream.
    const idxDenied = messages.findIndex((m) => m.type === 'permission_denied');
    const idxResult = messages.findIndex((m) => m.type === 'result');
    expect(idxDenied).toBeGreaterThanOrEqual(0);
    expect(idxResult).toBeGreaterThan(idxDenied);

    // The same denial is reflected in the result's permission_denials ledger.
    const result = messages[messages.length - 1] as SDKResultMessage;
    expect(result.type).toBe('result');
    expect(result.permission_denials.some((d) => d.tool_name === 'Bash')).toBe(true);
  });

  it('does not emit permission_denied when the tool is allowed', async () => {
    vi.stubGlobal(
      'fetch',
      makeSSEFetch([
        toolUseReplyEvents('Bash', { command: 'echo hi' }),
        textReplyEvents('done'),
      ]),
    );
    const messages = await collect(
      query({
        prompt: 'run it',
        options: opts({
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
        }),
      }),
    );
    expect(messages.some((m) => m.type === 'permission_denied')).toBe(false);
  });
});

/**
 * Exhaustive discriminator over the observability arm. The `never` assignment
 * in the default branch fails to COMPILE if any SDKObservabilityMessage variant
 * is missing here — so this function doubles as a union-completeness guard.
 */
function variantName(m: SDKObservabilityMessage): string {
  switch (m.type) {
    case 'permission_denied':
      return 'permission_denied';
    case 'tool_progress':
      return 'tool_progress';
    case 'tool_use_summary':
      return 'tool_use_summary';
    case 'task_started':
      return 'task_started';
    case 'task_progress':
      return 'task_progress';
    case 'task_updated':
      return 'task_updated';
    case 'task_notification':
      return 'task_notification';
    case 'hook_started':
      return 'hook_started';
    case 'hook_progress':
      return 'hook_progress';
    case 'hook_response':
      return 'hook_response';
    case 'files_persisted':
      return 'files_persisted';
    case 'local_command_output':
      return 'local_command_output';
    case 'commands_changed':
      return 'commands_changed';
    case 'rate_limit_event':
      return 'rate_limit_event';
    case 'api_retry':
      return 'api_retry';
    case 'auth_status':
      return 'auth_status';
    case 'elicitation_complete':
      return 'elicitation_complete';
    case 'informational':
      return 'informational';
    case 'notification':
      return 'notification';
    case 'prompt_suggestion':
      return 'prompt_suggestion';
    case 'memory_recall':
      return 'memory_recall';
    case 'worker_shutting_down':
      return 'worker_shutting_down';
    case 'plugin_install':
      return 'plugin_install';
    case 'session_state_changed':
      return 'session_state_changed';
    case 'system':
      return `system/${m.subtype}`;
    default: {
      const never: never = m;
      return never;
    }
  }
}

describe('v0.3 observability union completeness', () => {
  it('routes every variant through the exhaustive discriminator', () => {
    const env = { uuid: 'u', session_id: 's' };
    const samples: SDKObservabilityMessage[] = [
      { type: 'permission_denied', ...env, tool_name: 'Bash', tool_use_id: 't', reason: 'no' },
      { type: 'tool_progress', ...env, tool_use_id: 't', progress: 50 },
      { type: 'tool_use_summary', ...env, tool_name: 'Bash', tool_use_id: 't', input_summary: 'i', result_summary: 'r' },
      { type: 'task_started', ...env, task_id: 'k', task_name: 'n' },
      { type: 'task_progress', ...env, task_id: 'k', progress: 10 },
      { type: 'task_updated', ...env, task_id: 'k', status: 'completed' },
      { type: 'task_notification', ...env, task_id: 'k', event: 'completed' },
      { type: 'hook_started', ...env, hook_id: 'h', hook_event: 'PreToolUse' },
      { type: 'hook_progress', ...env, hook_id: 'h', hook_event: 'PreToolUse' },
      { type: 'hook_response', ...env, hook_id: 'h', hook_event: 'PreToolUse' },
      { type: 'files_persisted', ...env, files: [{ path: 'a', operation: 'created' }] },
      { type: 'local_command_output', ...env, command: '/x', output: 'o' },
      { type: 'commands_changed', ...env, available_commands: [] },
      { type: 'rate_limit_event', ...env, retry_after_ms: 100, limit_type: 'api' },
      { type: 'api_retry', ...env, attempt: 1, max_retries: 3 },
      { type: 'auth_status', ...env, status: 'authenticated' },
      { type: 'elicitation_complete', ...env, elicitation_id: 'e', result: 'accepted' },
      { type: 'informational', ...env, level: 'info', message: 'm' },
      { type: 'notification', ...env, level: 'info', title: 't', message: 'm' },
      { type: 'prompt_suggestion', ...env, suggestion: 's' },
      { type: 'memory_recall', ...env, context: 'c', source: 'user' },
      { type: 'worker_shutting_down', ...env, graceful: true },
      { type: 'plugin_install', ...env, plugin_name: 'p', status: 'installed' },
      { type: 'session_state_changed', ...env, state: 'active' },
      { type: 'system', subtype: 'status', ...env, status: 'pending' },
    ];
    const names = samples.map(variantName);
    // 24 top-level variants + 1 system/status.
    expect(names).toHaveLength(25);
    expect(new Set(names).size).toBe(25);
    expect(names).toContain('permission_denied');
    expect(names).toContain('system/status');
  });
});

/** A 200 SSE Response carrying the given raw stream events (then closed). */
function sseResponse(events: readonly object[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) {
        const name = (e as { type?: string }).type ?? 'message';
        controller.enqueue(
          new TextEncoder().encode(`event: ${name}\ndata: ${JSON.stringify(e)}\n\n`),
        );
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

/** An error Response (retry-after: 0 so the transport backs off ~instantly). */
function errorResponse(status: number, errorType: string): Response {
  return new Response(
    JSON.stringify({ type: 'error', error: { type: errorType, message: 'x' } }),
    { status, headers: { 'content-type': 'application/json', 'retry-after': '0' } },
  );
}

describe('v0.3 retry transport->stream bridge (task bucket-1)', () => {
  it('emits rate_limit_event on a 429 retry, then completes', async () => {
    let call = 0;
    vi.stubGlobal('fetch', async () => {
      call += 1;
      return call === 1
        ? errorResponse(429, 'rate_limit_error')
        : sseResponse(textReplyEvents('ok'));
    });
    const messages = await collect(query({ prompt: 'hi', options: opts() }));

    const rle = messages.filter((m) => m.type === 'rate_limit_event');
    expect(rle.length).toBeGreaterThanOrEqual(1);
    expect((rle[0] as { limit_type: string }).limit_type).toBe('api');
    // The retry event precedes the assistant message + terminal result.
    const idxRle = messages.findIndex((m) => m.type === 'rate_limit_event');
    const idxAsst = messages.findIndex((m) => m.type === 'assistant');
    expect(idxRle).toBeLessThan(idxAsst);
    expect(messages[messages.length - 1]!.type).toBe('result');
  });

  it('emits api_retry (with status) on a 500 retry', async () => {
    let call = 0;
    vi.stubGlobal('fetch', async () => {
      call += 1;
      return call === 1
        ? errorResponse(500, 'api_error')
        : sseResponse(textReplyEvents('ok'));
    });
    const messages = await collect(query({ prompt: 'hi', options: opts() }));

    const ar = messages.filter((m) => m.type === 'api_retry');
    expect(ar.length).toBeGreaterThanOrEqual(1);
    expect((ar[0] as { status?: number }).status).toBe(500);
    expect(messages[messages.length - 1]!.type).toBe('result');
  });

  it('emits nothing extra when the first request succeeds', async () => {
    vi.stubGlobal('fetch', async () => sseResponse(textReplyEvents('ok')));
    const messages = await collect(query({ prompt: 'hi', options: opts() }));
    expect(messages.some((m) => m.type === 'rate_limit_event' || m.type === 'api_retry')).toBe(
      false,
    );
  });
});
