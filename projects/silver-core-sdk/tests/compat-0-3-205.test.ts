/**
 * Compatibility chase: official @anthropic-ai/claude-agent-sdk 0.3.201 -> 0.3.205.
 *
 * Verifies the surface added between the pinned 0.3.201 baseline and 0.3.205
 * (npm latest 2026-07-08), reconciled against the official sdk.d.ts:
 *  - two NEW top-level SDKMessage variants (active_goal, conversation_reset);
 *  - two NEW observability system-subtypes (background_tasks_changed,
 *    control_request_progress) — union completeness lives in observability.test.ts;
 *  - the control request/response types (get_plan, get_workspace_diff,
 *    interrupt receipt);
 *  - Query.interrupt() now returns the { still_queued } receipt (was void);
 *  - SessionMessage.parent_agent_id (0.3.202) surfaced by getSessionMessages.
 *
 * All new message variants are TYPED for drop-in exhaustiveness; this headless
 * direct-API engine emits none of them (no goal loop / no conversation reset /
 * no control_request protocol / no background-task membership channel), matching
 * the established NEW-IN-DOCS "typed-not-emitted" posture in docs/COMPAT.md.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import {
  query,
  getSessionMessages,
  InMemorySessionStore,
  encodeProjectKey,
} from '../src/index.js';
import type {
  SDKMessage,
  SDKActiveGoalMessage,
  SDKConversationResetMessage,
  SDKBackgroundTasksChangedMessage,
  SDKControlRequestProgressMessage,
  SDKControlGetPlanRequest,
  SDKControlGetWorkspaceDiffRequest,
  SDKControlInterruptResponse,
} from '../src/index.js';
import { makeSSEFetch } from './helpers/sse-fetch.js';
import { textReplyEvents } from './helpers/mock-transport.js';

let sandbox: string;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bpt-0-3-205-'));
});
afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function opts(extra: Record<string, unknown> = {}) {
  return {
    provider: { apiKey: 'test-key', promptCaching: false },
    sessionDir: path.join(sandbox, '.sessions'),
    cwd: sandbox,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, BPT_HTTP_CLIENT: 'fetch' },
    model: 'claude-sonnet-4-5',
    ...extra,
  };
}

describe('0.3.205 new message types (typed for drop-in exhaustiveness)', () => {
  it('the four new variants are assignable to SDKMessage', () => {
    const env = { uuid: 'u', session_id: 's' };
    const active: SDKActiveGoalMessage = {
      type: 'active_goal',
      ...env,
      value: { condition: 'c', iterations: 1, set_at: 0, tokens_at_start: 0 },
    };
    const cleared: SDKActiveGoalMessage = { type: 'active_goal', ...env, value: null };
    const reset: SDKConversationResetMessage = {
      type: 'conversation_reset',
      ...env,
      new_conversation_id: 'conv-2',
    };
    const bg: SDKBackgroundTasksChangedMessage = {
      type: 'system',
      subtype: 'background_tasks_changed',
      ...env,
      tasks: [{ task_id: 'k', task_type: 'local_agent', description: 'n' }],
    };
    const prog: SDKControlRequestProgressMessage = {
      type: 'system',
      subtype: 'control_request_progress',
      ...env,
      request_id: 'r',
      status: 'api_retry',
      attempt: 2,
      max_retries: 3,
    };
    const all: SDKMessage[] = [active, cleared, reset, bg, prog];
    expect(all).toHaveLength(5);
    // REPLACE semantics on background_tasks_changed: the payload is the full set.
    expect(bg.tasks[0].task_id).toBe('k');
    expect(prog.status).toBe('api_retry');
  });

  it('the control request/response types carry the official subtypes/shape', () => {
    const getPlan: SDKControlGetPlanRequest = { subtype: 'get_plan' };
    const getDiff: SDKControlGetWorkspaceDiffRequest = { subtype: 'get_workspace_diff' };
    const receipt: SDKControlInterruptResponse = { still_queued: [] };
    expect(getPlan.subtype).toBe('get_plan');
    expect(getDiff.subtype).toBe('get_workspace_diff');
    expect(receipt.still_queued).toEqual([]);
  });
});

describe('0.3.205 Query.interrupt() returns the { still_queued } receipt', () => {
  it('resolves to an empty receipt (this engine tracks no surviving async messages)', async () => {
    vi.stubGlobal('fetch', makeSSEFetch([textReplyEvents('done')]));
    const q = query({ prompt: 'hi', options: opts() });
    // interrupt() between turns (before iteration) arms the next-turn cancel and
    // returns the receipt synchronously — no uuid-stamped async queue survives.
    const receipt = await q.interrupt();
    expect(receipt).toEqual({ still_queued: [] });
    // The typed receipt is source-compatible with a void-ignoring caller.
    const ignoring: Promise<void> = q.interrupt().then(() => undefined);
    await ignoring;
    q.close();
  });
});

describe('0.3.202 SessionMessage.parent_agent_id (getSessionMessages)', () => {
  it('surfaces a persisted parent_agent_id and reports null when absent', async () => {
    const store = new InMemorySessionStore();
    const key = { projectKey: encodeProjectKey(sandbox), sessionId: 'sess-1' };
    await store.append(key, [
      {
        type: 'user',
        uuid: 'u1',
        session_id: 'sess-1',
        message: { role: 'user', content: 'hi' },
        parent_tool_use_id: 'tool-1',
        parent_agent_id: 'agent-root',
      },
      {
        type: 'assistant',
        uuid: 'a1',
        session_id: 'sess-1',
        message: { role: 'assistant', content: [] },
        parent_tool_use_id: null,
        // no parent_agent_id -> null
      },
    ]);
    const msgs = await getSessionMessages('sess-1', { sessionStore: store, cwd: sandbox });
    expect(msgs).toHaveLength(2);
    expect(msgs[0].parent_agent_id).toBe('agent-root');
    expect(msgs[1].parent_agent_id).toBeNull();
  });
});
