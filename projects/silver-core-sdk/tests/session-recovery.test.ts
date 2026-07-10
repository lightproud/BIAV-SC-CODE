/**
 * SM-乙b persistence-hardening + supervised recovery suite (proposal §5.2 +
 * §6, Public-Info-Pool/Resource/proposal/bpt-sdk-session-manager-20260706.md).
 *
 * Covers the three completed pieces:
 *   A. write-ahead checkpoints (query.ts) — pending_turn is written BEFORE the
 *      engine loop and settled by turn_complete only when the turn SUCCEEDS
 *      (test ⑥);
 *   B. redrive-on-resume (query.ts) — a resumed transcript with a dangling
 *      pending_turn re-drives ONLY the interrupted API request segment, never
 *      an already-executed tool (test ⑦);
 *   C. the manager supervision loop (session-manager.ts) — recoverable
 *      failures transparently auto-resume up to maxResumes, terminal ones pass
 *      through, the gate honours store/autoResume/prompt-kind (tests ①-⑤);
 *      standalone query() is unaffected (test ⑧).
 *
 * DESIGN NOTE reflected in the assertions: this engine converts API /
 * connection failures into an is_error `error_during_execution` RESULT message
 * (only AbortError is thrown). So supervision keys off recoverable error
 * RESULTS: a recoverable one is swallowed and re-driven; a terminal one (or the
 * last one once maxResumes is spent) is forwarded — the latter annotated with
 * `resumeAttempts`. Genuine throws (AbortError) still rethrow.
 */

import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBptSession, createSdkMcpServer, query, tool } from '../src/index.js';
import { InMemorySessionStore } from '../src/sessions/store-adapter.js';
import { textReplyEvents, toolUseReplyEvents } from './helpers/mock-transport.js';
import { encodeSSEFrame } from './helpers/sse-fetch.js';
import type {
  Options,
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
  SessionManagerOptions,
} from '../src/types.js';

let sessionDir: string;
let cwd: string;

beforeEach(async () => {
  sessionDir = await mkdtemp(join(tmpdir(), 'bpt-recov-sess-'));
  cwd = await mkdtemp(join(tmpdir(), 'bpt-recov-cwd-'));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await rm(sessionDir, { recursive: true, force: true });
  await rm(cwd, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** One scripted answer per fetch call: 'crash' rejects (→ APIConnectionError),
 *  an event array replies 200 SSE, a {status} replies that HTTP error. The
 *  LAST entry repeats for any further call (so 'crash' alone = crash-forever). */
type FetchAnswer = 'crash' | readonly object[] | { status: number };

function scriptedFetch(answers: FetchAnswer[]): {
  fn: (input: unknown, init?: RequestInit) => Promise<Response>;
  calls: () => number;
} {
  let n = 0;
  const fn = vi.fn(async (_input: unknown, _init?: RequestInit): Promise<Response> => {
    const answer = answers[n] ?? answers[answers.length - 1];
    n += 1;
    if (answer === 'crash') {
      throw new TypeError('simulated network failure');
    }
    if (Array.isArray(answer)) {
      const events = answer;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const e of events) controller.enqueue(encodeSSEFrame(e));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }
    const { status } = answer as { status: number };
    return new Response(
      JSON.stringify({ type: 'error', error: { type: 'terminal', message: 'terminal' } }),
      { status, headers: { 'content-type': 'application/json' } },
    );
  });
  return { fn, calls: () => n };
}

function managerOptions(extra: Partial<SessionManagerOptions> = {}): SessionManagerOptions {
  return {
    // maxRetries:0 so a rejected/4xx fetch surfaces immediately (no backoff).
    provider: { apiKey: 'test-key', promptCaching: false, maxRetries: 0 },
    sessionDir,
    cwd,
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    model: 'claude-sonnet-4-5',
    ...extra,
  };
}

function queryOptions(extra: Partial<Options> = {}): Options {
  return {
    provider: { apiKey: 'test-key', promptCaching: false, maxRetries: 0 },
    sessionDir,
    cwd,
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    model: 'claude-sonnet-4-5',
    ...extra,
  };
}

/** An input stream that closes at once (a resume re-drive replays no input). */
async function* emptyStream(): AsyncGenerator<SDKUserMessage, void> {
  // yields nothing
}

async function collect(q: Query): Promise<SDKMessage[]> {
  const out: SDKMessage[] = [];
  for await (const m of q) out.push(m);
  return out;
}

function lastResult(messages: SDKMessage[]): SDKResultMessage {
  const last = messages[messages.length - 1];
  expect(last?.type).toBe('result');
  return last as SDKResultMessage;
}

function initSessionId(messages: SDKMessage[]): string {
  const init = messages.find(
    (m) => m.type === 'system' && m.subtype === 'init',
  ) as { session_id: string } | undefined;
  expect(init).toBeDefined();
  return init!.session_id;
}

function resumeObservations(messages: SDKMessage[]): Array<Record<string, any>> {
  return messages.filter(
    (m) =>
      m.type === 'system' &&
      (m as any).subtype === 'status' &&
      (m as any).status === 'auto-resume',
  ) as unknown as Array<Record<string, any>>;
}

async function transcript(sid: string): Promise<Array<Record<string, any>>> {
  const raw = await readFile(join(sessionDir, `${sid}.jsonl`), 'utf8');
  return raw
    .trim()
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, any>);
}

// ---------------------------------------------------------------------------
// ① recoverable failure -> transparent auto-resume -> correct success result
// ---------------------------------------------------------------------------

describe('supervised auto-resume', () => {
  it('① recovers a connection failure and completes transparently', async () => {
    const store = new InMemorySessionStore();
    const { fn, calls } = scriptedFetch(['crash', textReplyEvents('recovered')]);
    vi.stubGlobal('fetch', fn);

    const mgr = createBptSession(
      managerOptions({ sessionStore: store, recovery: { autoResume: true, maxResumes: 2 } }),
    );
    const messages = await collect(mgr.query({ prompt: 'hello keeper' }));

    // The consumer's terminal message is a SUCCESS result (from the resume);
    // the swallowed attempt-1 error result never reaches the consumer.
    const last = lastResult(messages);
    expect(last.subtype).toBe('success');
    expect(last.is_error).not.toBe(true);

    // Exactly one auto-resume observation: attempt #1, coded as a connection
    // failure — the inline "resume happened" scene the consumer sees.
    const obs = resumeObservations(messages);
    expect(obs).toHaveLength(1);
    expect(obs[0].details.attempt).toBe(1);
    expect(obs[0].details.code).toBe('api_connection_failed');

    // Two fetch calls: the failure, then the successful redrive.
    expect(calls()).toBe(2);

    // The write-ahead checkpoint left a trace, and the redrive settled it.
    const sid = initSessionId(messages);
    const types = (await transcript(sid)).map((e) => e.type);
    expect(types).toContain('pending_turn');
    expect(types).toContain('turn_complete');

    await mgr.close();
  });

  // -------------------------------------------------------------------------
  // ③ recoverable but never clears -> exhaust maxResumes -> forward + scene
  // -------------------------------------------------------------------------
  it('③ forwards the last error with resumeAttempts once maxResumes is spent', async () => {
    const store = new InMemorySessionStore();
    const { fn, calls } = scriptedFetch(['crash']); // crash forever
    vi.stubGlobal('fetch', fn);

    const mgr = createBptSession(
      managerOptions({ sessionStore: store, recovery: { maxResumes: 2 } }),
    );
    const messages = await collect(mgr.query({ prompt: 'hi' }));

    const last = lastResult(messages);
    expect(last.is_error).toBe(true);
    expect(last.error_code).toBe('api_connection_failed');
    expect((last as any).resumeAttempts).toBe(2);
    // Two auto-resume observations before the give-up.
    expect(resumeObservations(messages)).toHaveLength(2);
    // Initial attempt + 2 resumes = 3 fetch calls.
    expect(calls()).toBe(3);

    await mgr.close();
  });
});

// ---------------------------------------------------------------------------
// ② terminal failures never resume
// ---------------------------------------------------------------------------

describe('terminal failures bypass supervision', () => {
  it('② a 4xx (non-429) API error is forwarded without resuming', async () => {
    const store = new InMemorySessionStore();
    const { fn, calls } = scriptedFetch([{ status: 401 }]);
    vi.stubGlobal('fetch', fn);

    const mgr = createBptSession(managerOptions({ sessionStore: store }));
    const messages = await collect(mgr.query({ prompt: 'hi' }));

    const last = lastResult(messages);
    expect(last.is_error).toBe(true);
    expect(last.api_error_status).toBe(401);
    // No resume was attempted, so no scene annotation and no observation.
    expect((last as any).resumeAttempts).toBeUndefined();
    expect(resumeObservations(messages)).toHaveLength(0);
    expect(calls()).toBe(1);

    await mgr.close();
  });

  it('② an AbortError (user interrupt) rethrows without resuming', async () => {
    const store = new InMemorySessionStore();
    // A stream that opens 200 but never sends/closes: the turn hangs until the
    // caller aborts, producing an AbortError (terminal, never resumed).
    const hangingFn = vi.fn(async (): Promise<Response> => {
      const stream = new ReadableStream<Uint8Array>({ start() { /* never closes */ } });
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    });
    vi.stubGlobal('fetch', hangingFn);

    const ac = new AbortController();
    const mgr = createBptSession(managerOptions({ sessionStore: store }));
    const q = mgr.query({ prompt: 'hi', options: { abortController: ac } });

    const messages: SDKMessage[] = [];
    let error: unknown;
    try {
      for await (const m of q) {
        messages.push(m);
        if (m.type === 'system' && m.subtype === 'init') ac.abort();
      }
    } catch (e) {
      error = e;
    }

    expect((error as Error)?.name).toBe('AbortError');
    expect((error as any).resumeAttempts).toBeUndefined();
    expect(resumeObservations(messages)).toHaveLength(0);

    await mgr.close();
  });
});

// ---------------------------------------------------------------------------
// ④/⑤ the activation gate
// ---------------------------------------------------------------------------

describe('supervision gate', () => {
  it('④ is OFF when no external store is attached (error forwarded as-is)', async () => {
    const { fn, calls } = scriptedFetch(['crash']);
    vi.stubGlobal('fetch', fn);

    // No sessionStore -> supervise=false even though the failure is recoverable.
    const mgr = createBptSession(managerOptions({ recovery: { autoResume: true } }));
    const messages = await collect(mgr.query({ prompt: 'hi' }));

    const last = lastResult(messages);
    expect(last.is_error).toBe(true);
    expect((last as any).resumeAttempts).toBeUndefined();
    expect(resumeObservations(messages)).toHaveLength(0);
    expect(calls()).toBe(1); // no resume attempted

    await mgr.close();
  });

  it('⑤ is OFF when recovery.autoResume is false', async () => {
    const store = new InMemorySessionStore();
    const { fn, calls } = scriptedFetch(['crash']);
    vi.stubGlobal('fetch', fn);

    const mgr = createBptSession(
      managerOptions({ sessionStore: store, recovery: { autoResume: false } }),
    );
    const messages = await collect(mgr.query({ prompt: 'hi' }));

    const last = lastResult(messages);
    expect(last.is_error).toBe(true);
    expect((last as any).resumeAttempts).toBeUndefined();
    expect(resumeObservations(messages)).toHaveLength(0);
    expect(calls()).toBe(1);

    await mgr.close();
  });
});

// ---------------------------------------------------------------------------
// ⑥ checkpoint pairing + timing (query-level, no manager)
// ---------------------------------------------------------------------------

describe('write-ahead checkpoint pairing', () => {
  it('⑥ writes pending_turn before the engine loop and turn_complete after', async () => {
    const { fn } = scriptedFetch([textReplyEvents('done')]);
    vi.stubGlobal('fetch', fn);

    const messages = await collect(query({ prompt: 'hi', options: queryOptions() }));
    const sid = initSessionId(messages);
    const lines = await transcript(sid);
    const types = lines.map((l) => l.type);

    const iUser = types.indexOf('user');
    const iPending = types.indexOf('pending_turn');
    const iAssistant = types.indexOf('assistant');
    const iComplete = types.indexOf('turn_complete');

    // pending_turn brackets the request segment: after the user turn, before
    // the assistant answer; turn_complete lands after the assistant.
    expect(iUser).toBeGreaterThanOrEqual(0);
    expect(iPending).toBeGreaterThan(iUser);
    expect(iAssistant).toBeGreaterThan(iPending);
    expect(iComplete).toBeGreaterThan(iAssistant);

    // The pair references match, and turn_ref points at the echoed user uuid.
    const pending = lines.find((l) => l.type === 'pending_turn')!;
    const complete = lines.find((l) => l.type === 'turn_complete')!;
    expect(complete.pending_uuid).toBe(pending.uuid);

    const userEcho = messages.find((m) => m.type === 'user') as { uuid: string };
    expect(pending.turn_ref).toBe(userEcho.uuid);
  });
});

// ---------------------------------------------------------------------------
// ⑦ redrive does NOT replay an already-executed tool
// ---------------------------------------------------------------------------

describe('redrive-on-resume', () => {
  it('⑦ re-drives the interrupted request without re-running the executed tool', async () => {
    const counter = { n: 0 };
    const ping = tool(
      'ping',
      'count invocations',
      {},
      async () => {
        counter.n += 1;
        return { content: [{ type: 'text', text: 'pong' }] };
      },
    );
    const srv = createSdkMcpServer({ name: 'c', tools: [ping] });
    const mcpServers = { c: srv } as unknown as Options['mcpServers'];

    // Attempt 1: tool_use -> tool executes (count 1) -> follow-up request fails.
    const first = scriptedFetch([
      toolUseReplyEvents('mcp__c__ping', {}, { id: 'toolu_a' }),
      'crash',
    ]);
    vi.stubGlobal('fetch', first.fn);

    const m1 = await collect(
      query({
        prompt: 'use the tool',
        options: queryOptions({ mcpServers, permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true }),
      }),
    );
    // The turn ended in an is_error result (the engine converts the failure).
    expect(lastResult(m1).is_error).toBe(true);
    expect(counter.n).toBe(1); // tool ran exactly once
    expect(first.calls()).toBe(2); // tool_use response + the failed follow-up

    const sid = initSessionId(m1);
    // The interrupted transcript carries the tool_result AND a dangling pending.
    const t1 = await transcript(sid);
    expect(t1.map((l) => l.type)).toContain('pending_turn');
    expect(t1.some((l) => l.type === 'turn_complete')).toBe(false);

    // Attempt 2: resume + redrive. The follow-up request now succeeds; the
    // historical tool_use is context only, so the tool is NOT re-executed.
    vi.unstubAllGlobals();
    const second = scriptedFetch([textReplyEvents('all done')]);
    vi.stubGlobal('fetch', second.fn);

    const m2 = await collect(
      query({
        prompt: emptyStream(),
        options: queryOptions({ mcpServers, permissionMode: 'default', resume: sid }),
      }),
    );

    expect(counter.n).toBe(1); // KEY: no tool replay across the crash
    expect(second.calls()).toBe(1); // one request: the redrive, no tool round-trip
    expect(m2.some((m) => m.type === 'assistant')).toBe(true);
    expect(lastResult(m2).subtype).toBe('success');

    // The redrive settled the previously-dangling pending_turn.
    const t2 = await transcript(sid);
    expect(t2.some((l) => l.type === 'turn_complete')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ⑧ standalone query() is unaffected by the supervision machinery
// ---------------------------------------------------------------------------

describe('standalone query() regression', () => {
  it('⑧ a failure surfaces as an error result (no auto-resume, no annotation)', async () => {
    const { fn, calls } = scriptedFetch(['crash']);
    vi.stubGlobal('fetch', fn);

    const messages = await collect(query({ prompt: 'hi', options: queryOptions() }));

    const last = lastResult(messages);
    expect(last.is_error).toBe(true);
    expect((last as any).resumeAttempts).toBeUndefined();
    expect(resumeObservations(messages)).toHaveLength(0);
    expect(calls()).toBe(1);
  });

  it('⑧ persistSession:false writes no transcript at all', async () => {
    const { fn } = scriptedFetch([textReplyEvents('ok')]);
    vi.stubGlobal('fetch', fn);

    const messages = await collect(
      query({ prompt: 'hi', options: queryOptions({ persistSession: false }) }),
    );
    expect(lastResult(messages).subtype).toBe('success');

    // Nothing persisted -> no session file (thus no checkpoint records either).
    const sid = initSessionId(messages);
    await expect(readFile(join(sessionDir, `${sid}.jsonl`), 'utf8')).rejects.toThrow();
  });
});
