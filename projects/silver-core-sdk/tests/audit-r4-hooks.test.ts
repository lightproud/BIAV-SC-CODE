/**
 * Audit r4 (2026-07-17) — hooks cluster regression locks
 * (report: Public-Info-Pool/Resource/repo-engineering/
 * silver-core-sdk-bug-audit-r4-20260717.md):
 *
 *  - V1-2 : the natural-language condition context is size-bounded, so a giant
 *    tool_input no longer balloons the evaluator call (and silently skips a
 *    conditioned deny under the fail-open default).
 *  - R7j-1: the same context is circular-safe — a HookInput carrying a circular
 *    tool_response no longer throws OUTSIDE the per-matcher try/catch and crash
 *    the whole hook dispatch.
 *  - Rnum-1: matcher.timeout is clamped to the 32-bit timer ceiling, so a huge
 *    value bounds the callback instead of overflowing to ~1ms and aborting it
 *    almost immediately.
 *  - R7s-9: the hook_response.output preview truncation never splits a
 *    surrogate pair.
 *  - U8-2 : the regex PATTERN length cap is raised (long linear patterns are
 *    accepted) while the hooks VALUE cap stays ~1KB, decoupled.
 *
 * V1-1 (bare `mcp__server` hook matcher exact-match vs server prefix) is NOT
 * fixed here: it is locked to literal-only by tests/permissions-hooks.test.ts
 * ("no server wildcard in hook matchers"), a file this cluster does not own —
 * see the structured skip note.
 */

import { describe, expect, it, vi } from 'vitest';

import { DefaultHookRunner } from '../src/hooks/runner.js';
import { matcherMatches } from '../src/hooks/matcher.js';
import {
  guardRegexPattern,
  hasNestedQuantifier,
  MAX_REGEX_PATTERN_LENGTH,
  MAX_REGEX_VALUE_LENGTH,
} from '../src/internal/regex-guard.js';
import { AbortError } from '../src/errors.js';
import type { HookInput, HookJSONOutput } from '../src/types.js';
import { MockTransport, textReplyEvents } from './helpers/mock-transport.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PRE_INPUT: HookInput = {
  session_id: 'sess-r4-hooks',
  cwd: '/tmp',
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command: 'ls' },
};

/** Any lone surrogate (unpaired high OR low) anywhere in the string. */
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function freshSignal(): AbortSignal {
  return new AbortController().signal;
}

/** Signal-honoring sleep: resolves after ms, rejects promptly on abort. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortError());
      return;
    }
    const timer = setTimeout(() => resolve(), ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new AbortError());
      },
      { once: true },
    );
  });
}

function decisionOutput(decision: 'allow' | 'deny' | 'ask', reason: string): HookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  };
}

// ---------------------------------------------------------------------------
// V1-2: oversized condition input is bounded
// ---------------------------------------------------------------------------

describe('V1-2: oversized hook input is bounded before the condition evaluation', () => {
  it('a giant tool_input does not balloon the evaluator context (bounded, still decides)', async () => {
    const t = new MockTransport([textReplyEvents('{"ok":true,"reason":"met"}')]);
    const cb = vi.fn().mockResolvedValue(undefined);
    const runner = new DefaultHookRunner({
      hooks: { PreToolUse: [{ condition: 'the command is safe', hooks: [cb] }] },
      debug: () => {},
      conditionOptions: { transport: t },
    });
    const huge = 'A'.repeat(500_000);
    const input: HookInput = {
      session_id: 's',
      cwd: '/tmp',
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: huge },
    };
    await runner.run('PreToolUse', input, 'toolu_big', 'Bash', freshSignal());
    // The condition still decided (met), so the callback fired.
    expect(cb).toHaveBeenCalledTimes(1);
    // The 500K input was truncated far below its own size before it reached the
    // evaluator turn (unbounded, this would be ~500K).
    const user = t.requests[0]?.messages[0]?.content;
    expect(typeof user).toBe('string');
    expect((user as string).length).toBeLessThan(100_000);
    expect((user as string).length).toBeGreaterThan(1_000);
  });
});

// ---------------------------------------------------------------------------
// R7j-1: circular condition input does not crash the dispatch
// ---------------------------------------------------------------------------

describe('R7j-1: a circular hook input does not crash the condition gate', () => {
  it('a PostToolUse condition hook with a circular tool_response still dispatches', async () => {
    const t = new MockTransport([textReplyEvents('{"ok":true,"reason":"met"}')]);
    const cb = vi.fn().mockResolvedValue(undefined);
    const runner = new DefaultHookRunner({
      hooks: { PostToolUse: [{ condition: 'a file was written', hooks: [cb] }] },
      debug: () => {},
      conditionOptions: { transport: t },
    });
    const circular: Record<string, unknown> = { detail: 'wrote /a' };
    circular['self'] = circular; // self-reference: bare JSON.stringify would throw
    const input = {
      session_id: 's',
      cwd: '/tmp',
      hook_event_name: 'PostToolUse',
      tool_name: 'Write',
      tool_input: { file_path: '/a' },
      tool_response: circular,
    } as unknown as HookInput;

    // Unfixed, JSON.stringify(input) throws OUTSIDE the try/catch and run()
    // rejects; fixed, it resolves and the callback fires.
    await expect(
      runner.run('PostToolUse', input, 'toolu_circ', 'Write', freshSignal()),
    ).resolves.toBeDefined();
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Rnum-1: matcher.timeout clamps to the 32-bit timer ceiling
// ---------------------------------------------------------------------------

describe('Rnum-1: a huge matcher.timeout is clamped, not overflowed to ~1ms', () => {
  it('a callback under a giant timeout completes instead of being aborted immediately', async () => {
    // 2_200_000 s * 1000 = 2.2e9 ms, over the 2^31-1 ceiling. Unclamped this
    // overflows to ~1ms; the 40ms callback would then be aborted before it can
    // return and its deny would be silently discarded (fail-open).
    const r = new DefaultHookRunner({
      hooks: {
        PreToolUse: [
          {
            matcher: '*',
            timeout: 2_200_000, // seconds
            hooks: [
              async (_i, _t, { signal }): Promise<HookJSONOutput> => {
                await sleep(40, signal);
                return decisionOutput('deny', 'policy');
              },
            ],
          },
        ],
      },
      debug: () => {},
    });
    const agg = await r.run('PreToolUse', PRE_INPUT, 'toolu_rnum', 'Bash', freshSignal());
    expect(agg.decision).toBe('deny');
    expect(agg.decisionReason).toBe('policy');
  });
});

// ---------------------------------------------------------------------------
// R7s-9: hook_response.output preview never emits a lone surrogate
// ---------------------------------------------------------------------------

describe('R7s-9: hook_response output preview truncates surrogate-safe', () => {
  it('a >500-char output with an emoji straddling the preview cap truncates cleanly', async () => {
    // JSON is `{"systemMessage":"` + x-run + emojis + `"}`; the padding places
    // the first emoji's HIGH surrogate at UTF-16 index 499 — exactly where a
    // bare slice(0,500) would keep it as a lone surrogate.
    const prelude = '{"systemMessage":"'.length; // 18
    const pad = 500 - prelude - 1;
    const big = 'x'.repeat(pad) + '\u{1F600}'.repeat(6);

    const responses: string[] = [];
    const r = new DefaultHookRunner({
      hooks: {
        PreToolUse: [
          {
            matcher: '*',
            hooks: [async (): Promise<HookJSONOutput> => ({ systemMessage: big })],
          },
        ],
      },
      debug: () => {},
      onLifecycleEvent: (m) => {
        if (m.subtype === 'hook_response') responses.push(m.output);
      },
    });
    await r.run('PreToolUse', PRE_INPUT, 'toolu_surr', 'Bash', freshSignal());

    expect(responses).toHaveLength(1);
    const out = responses[0]!;
    expect(out.endsWith('...')).toBe(true); // it was truncated
    expect(LONE_SURROGATE.test(out)).toBe(false); // ...but never mid-pair
  });
});

// ---------------------------------------------------------------------------
// U8-2: pattern cap raised, value cap decoupled
// ---------------------------------------------------------------------------

describe('U8-2: regex pattern-length cap raised, hooks value cap decoupled', () => {
  it('the pattern cap is above the old 1024 while the value cap stays ~1KB', () => {
    expect(MAX_REGEX_PATTERN_LENGTH).toBeGreaterThan(1024);
    expect(MAX_REGEX_VALUE_LENGTH).toBe(1024);
  });

  it('guardRegexPattern now accepts a long-but-linear pattern the old cap rejected', () => {
    const longLinear = 'a'.repeat(2000); // linear literal, no nested quantifier
    expect(longLinear.length).toBeGreaterThan(1024);
    expect(hasNestedQuantifier(longLinear)).toBe(false);
    expect(guardRegexPattern(longLinear)).toBeNull();
    // Still capped, just higher — the reason names the (raised) cap.
    expect(guardRegexPattern('a'.repeat(MAX_REGEX_PATTERN_LENGTH + 1))).toContain(
      String(MAX_REGEX_PATTERN_LENGTH),
    );
  });

  it('the hooks VALUE cap is independent of the (raised) pattern cap', () => {
    // A value just over the value cap is a no-match even though the pattern is
    // tiny and the pattern cap is now far larger.
    expect(matcherMatches('x.*', 'x'.repeat(MAX_REGEX_VALUE_LENGTH + 1))).toBe(false);
    expect(matcherMatches('x.*', 'x'.repeat(10))).toBe(true);
  });

  it('a long-but-linear regex matcher over the old 1024 cap now evaluates instead of no-matching', () => {
    const longPattern = 'target' + '(?:)'.repeat(300); // >1024 chars, regex path, linear
    expect(longPattern.length).toBeGreaterThan(1024);
    expect(longPattern.length).toBeLessThan(MAX_REGEX_PATTERN_LENGTH);
    expect(matcherMatches(longPattern, 'target')).toBe(true);
  });
});
