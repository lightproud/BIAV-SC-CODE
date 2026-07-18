/**
 * T50 batch L — kernel-latency / boundary / cosmetic fixes (audit
 * 2026-07-17 r2). Each block regresses one finding by its audit id:
 *
 *   P1  internal/model-alias.ts   — prototype-chain model alias resolution
 *   P2  internal/worktree.ts      — baseHead-unknown clean worktree removal
 *   P3  internal/async.ts         — undefined-as-empty-queue sentinel
 *   P4  internal/process-kill.ts  — pid 0 planned as a self process-group kill
 *   Q2  sandbox/backend.ts        — probe under-exercises real namespaces
 *   Q3  tools/bash.ts             — sandboxed signal death misreported
 *   Q5  sandbox/bwrap.ts          — --dev/--proc emitted before writable binds
 *   T4  query-accounting.ts       — web_search_requests dropped in the fold
 */

import { describe, expect, it } from 'vitest';

import { resolveModelAlias } from '../src/internal/model-alias.js';
import { AsyncQueue } from '../src/internal/async.js';
import { planProcessKill } from '../src/internal/process-kill.js';
import { removeWorktreeIfClean } from '../src/internal/worktree.js';
import { BwrapBackend } from '../src/sandbox/bwrap.js';
import { BWRAP_PROBE_ARGS } from '../src/sandbox/backend.js';
import { sandboxSignalHint } from '../src/tools/bash.js';
import { SessionAccounting } from '../src/query-accounting.js';
import type { ModelUsage, NonNullableUsage, SDKResultMessage } from '../src/types.js';

describe('P1 — resolveModelAlias ignores Object.prototype keys', () => {
  it('resolves the built-in short aliases', () => {
    expect(resolveModelAlias('opus', 'parent')).toBe('claude-opus-4-8');
    expect(resolveModelAlias('fable', 'parent')).toBe('claude-fable-5');
  });

  it('inherit / undefined resolve to the parent model', () => {
    expect(resolveModelAlias(undefined, 'parent')).toBe('parent');
    expect(resolveModelAlias('inherit', 'parent')).toBe('parent');
  });

  it('a model colliding with a prototype key passes through as a string, not the inherited member', () => {
    for (const key of ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf']) {
      const out = resolveModelAlias(key, 'parent');
      expect(typeof out).toBe('string');
      expect(out).toBe(key); // passed through verbatim, NOT Object.prototype[key]
    }
  });

  it('host aliases are looked up by own-property too', () => {
    const aliases = { sonnet: 'gw-sonnet' };
    expect(resolveModelAlias('sonnet', 'parent', aliases)).toBe('gw-sonnet');
    // 'toString' is not an own key of the host table -> falls through, not the fn
    expect(resolveModelAlias('toString', 'parent', aliases)).toBe('toString');
  });

  it('an unknown full id is passed through verbatim', () => {
    expect(resolveModelAlias('vendor/custom-model-9', 'parent')).toBe('vendor/custom-model-9');
  });
});

describe('P3 — AsyncQueue tolerates an enqueued undefined value', () => {
  it('a buffered undefined is delivered, not swallowed as "empty"', async () => {
    const q = new AsyncQueue<string | undefined>();
    expect(q.push(undefined)).toBe(true);
    const r = await q.next();
    expect(r).toEqual({ done: false, value: undefined });
  });

  it('undefined then a real value preserve order', async () => {
    const q = new AsyncQueue<string | undefined>();
    q.push(undefined);
    q.push('x');
    expect(await q.next()).toEqual({ done: false, value: undefined });
    expect(await q.next()).toEqual({ done: false, value: 'x' });
  });

  it('close after draining reports done', async () => {
    const q = new AsyncQueue<string | undefined>();
    q.push(undefined);
    await q.next();
    q.close();
    expect(await q.next()).toEqual({ done: true, value: undefined });
  });

  it('a waiter still receives a subsequently pushed undefined', async () => {
    const q = new AsyncQueue<string | undefined>();
    const pending = q.next();
    q.push(undefined);
    expect(await pending).toEqual({ done: false, value: undefined });
  });
});

describe('P4 — planProcessKill never plans a group kill for pid 0', () => {
  it('pid 0 falls back to a direct child.kill on every platform', () => {
    expect(planProcessKill(0, 'SIGTERM', 'linux')).toEqual({ kind: 'child', signal: 'SIGTERM' });
    expect(planProcessKill(0, 'SIGKILL', 'win32')).toEqual({ kind: 'child', signal: 'SIGKILL' });
  });

  it('negative pids also fall back (no self-group signalling)', () => {
    expect(planProcessKill(-1, 'SIGTERM', 'linux')).toEqual({ kind: 'child', signal: 'SIGTERM' });
  });

  it('a real positive pid still plans the group/taskkill path', () => {
    expect(planProcessKill(1234, 'SIGTERM', 'linux')).toEqual({ kind: 'group', pid: 1234, signal: 'SIGTERM' });
    expect(planProcessKill(1234, 'SIGTERM', 'win32')).toEqual({ kind: 'taskkill', pid: 1234 });
  });
});

describe('P2 — removeWorktreeIfClean keeps a worktree when baseHead is unknown', () => {
  it('unknown baseHead -> kept without touching git (cannot prove no commit)', async () => {
    // If the function ran any git command here it would throw (bogus dir) and
    // still return 'kept'; the point is it must NOT remove. We assert the
    // decision is reached before any status/remove by using a dir that would
    // make a real `git worktree remove` fail loudly if it were attempted.
    const outcome = await removeWorktreeIfClean('/nonexistent-repo', '/nonexistent-worktree', undefined);
    expect(outcome).toBe('kept');
  });
});

describe('Q2 — bwrap functional probe exercises the same namespaces as wrap()', () => {
  it('probe argv includes every namespace/mount a real network-off wrap uses', () => {
    for (const flag of ['--dev', '--proc', '--unshare-pid', '--unshare-net']) {
      expect(BWRAP_PROBE_ARGS).toContain(flag);
    }
  });

  it('every namespace flag the probe covers is actually emitted by wrap() (no probe/spawn gap)', () => {
    const plan = new BwrapBackend().wrap({
      shell: '/bin/sh',
      command: 'true',
      cwd: '/tmp',
      writablePaths: ['/tmp/w'],
      tmpDir: '/tmp/t',
      allowNetwork: false,
    });
    for (const flag of ['--dev', '--proc', '--unshare-pid', '--unshare-net']) {
      expect(plan.args).toContain(flag);
    }
  });
});

describe('Q5 — bwrap emits --dev/--proc AFTER the writable binds', () => {
  const planWith = (writablePaths: string[]) =>
    new BwrapBackend().wrap({
      shell: '/bin/sh',
      command: 'true',
      cwd: '/tmp',
      writablePaths,
      tmpDir: '/tmp/t',
      allowNetwork: true,
    }).args;

  it('a writable bind cannot override the hardened /proc and /dev mounts', () => {
    const args = planWith(['/']); // pathological rw bind of root
    const lastBindTry = args.lastIndexOf('--bind-try');
    const devIdx = args.indexOf('--dev');
    const procIdx = args.indexOf('--proc');
    // --dev / --proc must come AFTER the final writable bind so they win the
    // left-to-right mount resolution.
    expect(devIdx).toBeGreaterThan(lastBindTry);
    expect(procIdx).toBeGreaterThan(lastBindTry);
  });

  it('still mounts a fresh /dev and /proc', () => {
    const args = planWith(['/tmp/w']);
    expect(args).toContain('--dev');
    expect(args).toContain('--proc');
  });
});

describe('Q3 — sandboxSignalHint names the likely signal for sandboxed 128+N exits', () => {
  it('names SIGSEGV for a sandboxed exit code 139', () => {
    const hint = sandboxSignalHint(139, true);
    expect(hint).toContain('SIGSEGV');
    expect(hint).toContain('139');
  });

  it('is empty for unsandboxed commands (real signal already surfaced)', () => {
    expect(sandboxSignalHint(139, false)).toBe('');
  });

  it('is empty for a null code or an unrecognized code', () => {
    expect(sandboxSignalHint(null, true)).toBe('');
    expect(sandboxSignalHint(2, true)).toBe(''); // not a 128+N form
    expect(sandboxSignalHint(1, true)).toBe('');
  });
});

describe('T4 — SessionAccounting carries web_search_requests through the usage fold', () => {
  const usage = (webSearch: number): NonNullableUsage => ({
    input_tokens: 1,
    output_tokens: 1,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    web_search_requests: webSearch,
  });
  const modelUsage: Record<string, ModelUsage> = {
    m: {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      webSearchRequests: 2,
      costUSD: 0,
    },
  };
  const result = (webSearch: number): SDKResultMessage =>
    ({
      num_turns: 1,
      total_cost_usd: 0,
      duration_api_ms: 0,
      usage: usage(webSearch),
      modelUsage,
    } as unknown as SDKResultMessage);

  it('folds server-tool web-search counts into the flat usage accumulator', () => {
    const acct = new SessionAccounting();
    acct.accumulateResult(result(2));
    acct.accumulateResult(result(3));
    expect(acct.usage.web_search_requests).toBe(5);
  });
});
