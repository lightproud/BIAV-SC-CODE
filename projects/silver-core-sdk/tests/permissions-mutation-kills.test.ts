/**
 * Mutation-kill tests: permissions module (overnight quality campaign).
 *
 * Every test here exists to kill one or more SURVIVING mutants from the
 * Stryker round on src/permissions/** (79.97% initial score, 82 survived +
 * 36 no-coverage). Grouped by blind-spot cluster:
 *   A. applyUpdates session-rule machinery (removeRules/replaceRules/
 *      sameRule/ruleContent/updatedPermissions/directories - was NO COVERAGE)
 *   B. deny-path messages, abort semantics, hook plumbing
 *   C. rules.ts parsing edges (parseRule / splitMcpName / specifier stems /
 *      decomposeBashCommand / suggestions)
 * Mutants judged EQUIVALENT (unkillable) are listed at the bottom of the file.
 */

import { describe, expect, it, vi } from 'vitest';
import { DefaultPermissionGate } from '../src/permissions/gate.js';
import {
  buildPermissionSuggestions,
  decomposeBashCommand,
  matchToolName,
  parseRule,
  ruleMatches,
} from '../src/permissions/rules.js';
import type { PermissionUpdate } from '../src/types.js';

function checkOpts(readOnly = false, extra: Record<string, unknown> = {}) {
  return {
    toolUseID: 'tu_kill',
    signal: new AbortController().signal,
    readOnly,
    isFileEdit: false,
    ...extra,
  };
}

function makeGate(cfg: Partial<ConstructorParameters<typeof DefaultPermissionGate>[0]> = {}) {
  return new DefaultPermissionGate({ debug: () => {}, ...cfg });
}

const addRules = (
  behavior: 'allow' | 'deny' | 'ask',
  rules: Array<{ toolName: string; ruleContent?: string }>,
): PermissionUpdate => ({ type: 'addRules', rules, behavior, destination: 'session' });
const replaceRules = (
  behavior: 'allow' | 'deny' | 'ask',
  rules: Array<{ toolName: string; ruleContent?: string }>,
): PermissionUpdate => ({ type: 'replaceRules', rules, behavior, destination: 'session' });
const removeRules = (
  behavior: 'allow' | 'deny' | 'ask',
  rules: Array<{ toolName: string; ruleContent?: string }>,
): PermissionUpdate => ({ type: 'removeRules', rules, behavior, destination: 'session' });

// ---------------------------------------------------------------------------
// A. applyUpdates session-rule machinery
// ---------------------------------------------------------------------------

describe('applyUpdates: session rule add/replace/remove (sameRule + toParsedRule)', () => {
  it('removeRules removes exactly the matching rule - same tool with a different specifier stays', async () => {
    const gate = makeGate();
    gate.applyUpdates([
      addRules('deny', [{ toolName: 'Bash', ruleContent: 'git:*' }, { toolName: 'Bash(rm:*)' }]),
    ]);
    // Both deny rules bite.
    expect((await gate.check('Bash', { command: 'git status' }, checkOpts(true))).decision).toBe('deny');
    expect((await gate.check('Bash', { command: 'rm -rf /tmp/x' }, checkOpts(true))).decision).toBe('deny');

    // Remove ONLY the git rule (ruleContent form must equal the Tool(spec) form).
    gate.applyUpdates([removeRules('deny', [{ toolName: 'Bash', ruleContent: 'git:*' }])]);
    expect((await gate.check('Bash', { command: 'git status' }, checkOpts(true))).decision).toBe('allow');
    // sameRule '&&'->'||' would have removed the rm rule too (same toolName).
    expect((await gate.check('Bash', { command: 'rm -rf /tmp/x' }, checkOpts(true))).decision).toBe('deny');
  });

  it('removeRules with a non-matching specifier removes nothing', async () => {
    const gate = makeGate();
    gate.applyUpdates([addRules('deny', [{ toolName: 'Bash', ruleContent: 'git:*' }])]);
    gate.applyUpdates([removeRules('deny', [{ toolName: 'Bash', ruleContent: 'npm:*' }])]);
    expect((await gate.check('Bash', { command: 'git status' }, checkOpts(true))).decision).toBe('deny');
  });

  it('replaceRules swaps the whole behavior bucket and only that bucket', async () => {
    const gate = makeGate();
    gate.applyUpdates([addRules('deny', [{ toolName: 'Bash', ruleContent: 'git:*' }])]);
    gate.applyUpdates([replaceRules('deny', [{ toolName: 'Bash', ruleContent: 'npm:*' }])]);
    expect((await gate.check('Bash', { command: 'git status' }, checkOpts(true))).decision).toBe('allow');
    expect((await gate.check('Bash', { command: 'npm ci' }, checkOpts(true))).decision).toBe('deny');
  });

  it('replaceRules(allow) writes the ALLOW bucket: auto-allows at step 5, and never lands in deny/ask buckets', async () => {
    let asked = 0;
    const gate = makeGate({
      canUseTool: async (_t, input) => {
        asked += 1;
        return { behavior: 'allow', updatedInput: input };
      },
    });
    gate.applyUpdates([replaceRules('allow', [{ toolName: 'Bash', ruleContent: 'git:*' }])]);
    const res = await gate.check('Bash', { command: 'git status' }, checkOpts(false));
    expect(res.decision).toBe('allow');
    expect(asked).toBe(0); // allow-rule auto-allow, not an ask route, not a deny
  });

  it('replaceRules(ask) writes the ASK bucket: routes a read-only call to canUseTool', async () => {
    let asked = 0;
    const gate = makeGate({
      canUseTool: async (_t, input) => {
        asked += 1;
        return { behavior: 'allow', updatedInput: input };
      },
    });
    gate.applyUpdates([replaceRules('ask', [{ toolName: 'Read' }])]);
    const res = await gate.check('Read', { file_path: '/tmp/a' }, checkOpts(true));
    expect(res.decision).toBe('allow');
    expect(asked).toBe(1); // ask rule forces the prompt even though read-only would auto-allow
  });

  it('session deny added with behavior "deny" denies WITHOUT consulting canUseTool (bucket integrity)', async () => {
    let asked = 0;
    const gate = makeGate({
      canUseTool: async (_t, input) => {
        asked += 1;
        return { behavior: 'allow', updatedInput: input };
      },
    });
    gate.applyUpdates([addRules('deny', [{ toolName: 'Bash', ruleContent: 'git:*' }])]);
    const res = await gate.check('Bash', { command: 'git status' }, checkOpts(false));
    expect(res.decision).toBe('deny');
    expect(asked).toBe(0);
  });

  it('canUseTool updatedPermissions are applied: the second call auto-allows without prompting again', async () => {
    let asked = 0;
    const gate = makeGate({
      canUseTool: async (_t, input) => {
        asked += 1;
        return {
          behavior: 'allow',
          updatedInput: input,
          updatedPermissions: [addRules('allow', [{ toolName: 'Bash', ruleContent: 'git:*' }])],
        };
      },
    });
    expect((await gate.check('Bash', { command: 'git status' }, checkOpts(false))).decision).toBe('allow');
    expect(asked).toBe(1);
    expect((await gate.check('Bash', { command: 'git log' }, checkOpts(false))).decision).toBe('allow');
    expect(asked).toBe(1); // remembered via updatedPermissions - not asked again
  });

  it('non-session destinations are ignored with the documented debug note', async () => {
    const debugLines: string[] = [];
    const gate = makeGate({ debug: (m: string) => debugLines.push(m) });
    gate.applyUpdates([
      { ...addRules('deny', [{ toolName: 'Bash' }]), destination: 'userSettings' } as PermissionUpdate,
    ]);
    expect((await gate.check('Bash', { command: 'git status' }, checkOpts(true))).decision).toBe('allow');
    expect(debugLines.join('\n')).toContain('(only "session" is honored in this SDK)');
  });
});

describe('applyUpdates: directories bookkeeping', () => {
  it('addDirectories records once (no duplicates) and is visible via addedDirectories()', () => {
    const gate = makeGate();
    gate.applyUpdates([
      { type: 'addDirectories', directories: ['/tmp/extra'], destination: 'session' },
      { type: 'addDirectories', directories: ['/tmp/extra'], destination: 'session' },
    ]);
    expect(gate.addedDirectories()).toEqual(['/tmp/extra']);
  });

  it('removeDirectories revokes a session grant and records the revocation', () => {
    const gate = makeGate();
    gate.applyUpdates([{ type: 'addDirectories', directories: ['/tmp/extra'], destination: 'session' }]);
    gate.applyUpdates([{ type: 'removeDirectories', directories: ['/tmp/extra'], destination: 'session' }]);
    expect(gate.addedDirectories()).toEqual([]);
    expect(gate.removedDirectories()).toEqual(['/tmp/extra']);
    // Revoking twice records once.
    gate.applyUpdates([{ type: 'removeDirectories', directories: ['/tmp/extra'], destination: 'session' }]);
    expect(gate.removedDirectories()).toEqual(['/tmp/extra']);
  });

  it('re-granting a revoked directory clears the revocation', () => {
    const gate = makeGate();
    gate.applyUpdates([{ type: 'removeDirectories', directories: ['/tmp/extra'], destination: 'session' }]);
    gate.applyUpdates([{ type: 'addDirectories', directories: ['/tmp/extra'], destination: 'session' }]);
    expect(gate.removedDirectories()).toEqual([]);
    expect(gate.addedDirectories()).toEqual(['/tmp/extra']);
  });
});

// ---------------------------------------------------------------------------
// B. deny-path messages, abort semantics, hook plumbing, mode routing
// ---------------------------------------------------------------------------

describe('deny/skip/defer message contracts (stage strings are load-bearing)', () => {
  it('disallowedTools deny carries the exact stage message with no detail suffix', async () => {
    const gate = makeGate({ disallowedTools: ['Bash(git:*)'] });
    const res = await gate.check('Bash', { command: 'git status' }, checkOpts(true));
    expect(res.decision).toBe('deny');
    if (res.decision !== 'deny') throw new Error('unreachable');
    expect(res.message).toBe('Permission denied: tool "Bash" was denied by disallowedTools rule');
    expect('interrupt' in res).toBe(false); // interrupt key only present when explicitly set
  });

  it('dontAsk deny names the mode and the reason', async () => {
    const gate = makeGate({ mode: 'dontAsk', canUseTool: async () => null });
    const res = await gate.check('Write', { file_path: '/tmp/a', content: 'x' }, checkOpts(false));
    expect(res.decision).toBe('deny');
    if (res.decision !== 'deny') throw new Error('unreachable');
    expect(res.message).toContain('dontAsk mode');
    expect(res.message).toContain('no pre-approved rule matched and prompting is disabled');
  });

  it('missing canUseTool denies via default policy with the documented reason', async () => {
    const gate = makeGate({ mode: 'default' });
    const res = await gate.check('Write', { file_path: '/tmp/a', content: 'x' }, checkOpts(false));
    expect(res.decision).toBe('deny');
    if (res.decision !== 'deny') throw new Error('unreachable');
    expect(res.message).toContain('default policy');
    expect(res.message).toContain('no canUseTool handler was provided');
  });

  it('a throwing canUseTool denies with the thrown message', async () => {
    const gate = makeGate({
      canUseTool: async () => {
        throw new Error('boom-42');
      },
    });
    const res = await gate.check('Write', { file_path: '/tmp/a', content: 'x' }, checkOpts(false));
    expect(res.decision).toBe('deny');
    if (res.decision !== 'deny') throw new Error('unreachable');
    expect(res.message).toContain('canUseTool callback');
    expect(res.message).toContain('callback threw: boom-42');
  });

  it('canUseTool null resolves to a skip with the documented message', async () => {
    const gate = makeGate({ canUseTool: async () => null });
    const res = await gate.check('Write', { file_path: '/tmp/a', content: 'x' }, checkOpts(false));
    expect(res.decision).toBe('skip');
    if (res.decision !== 'skip') throw new Error('unreachable');
    expect(res.message).toBe('permission decision was handled by the application (no local record)');
  });

  it('a hook defer message names the tool and carries the hook reason', async () => {
    const gate = makeGate();
    const res = await gate.check(
      'Write',
      { file_path: '/tmp/a', content: 'x' },
      checkOpts(false, { hook: { decision: 'defer', reason: 'later please' } }),
    );
    expect(res.decision).toBe('defer');
    if (res.decision !== 'defer') throw new Error('unreachable');
    expect(res.message).toContain('Tool "Write" was deferred by a PreToolUse hook');
    expect(res.message).toContain(' - later please');
  });

  it('a hook deny records the denial and carries the hook reason in the message', async () => {
    const gate = makeGate();
    const res = await gate.check(
      'Write',
      { file_path: '/tmp/a', content: 'x' },
      checkOpts(false, { hook: { decision: 'deny', reason: 'nope' } }),
    );
    expect(res.decision).toBe('deny');
    if (res.decision !== 'deny') throw new Error('unreachable');
    expect(res.message).toContain('PreToolUse hook');
    expect(res.message).toContain(' - nope');
    expect(gate.denials()).toHaveLength(1);
  });
});

describe('abort semantics at the canUseTool boundary', () => {
  it('an AbortError thrown by canUseTool propagates as AbortError (never converted to deny)', async () => {
    const controller = new AbortController();
    const gate = makeGate({
      canUseTool: async () => {
        controller.abort();
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      },
    });
    await expect(
      gate.check('Write', { file_path: '/tmp/a', content: 'x' }, { ...checkOpts(false), signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('a signal aborted DURING canUseTool aborts the check even when the handler returns allow', async () => {
    const controller = new AbortController();
    const gate = makeGate({
      canUseTool: async (_t, input) => {
        controller.abort();
        return { behavior: 'allow', updatedInput: input };
      },
    });
    await expect(
      gate.check('Write', { file_path: '/tmp/a', content: 'x' }, { ...checkOpts(false), signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('hook plumbing and mode routing', () => {
  it('a hook-allow rewrite INTO a denied input is caught by the effective-input re-check', async () => {
    const gate = makeGate({ disallowedTools: ['Bash(rm:*)'] });
    const res = await gate.check(
      'Bash',
      { command: 'git status' }, // original is clean
      checkOpts(false, {
        hook: { decision: 'allow', updatedInput: { command: 'rm -rf /tmp/x' } },
      }),
    );
    expect(res.decision).toBe('deny');
  });

  it('a hook-allow rewrite to a clean input allows with the REWRITTEN input', async () => {
    const gate = makeGate();
    const res = await gate.check(
      'Bash',
      { command: 'git status' },
      checkOpts(false, {
        hook: { decision: 'allow', updatedInput: { command: 'git log --oneline' } },
      }),
    );
    expect(res.decision).toBe('allow');
    if (res.decision !== 'allow') throw new Error('unreachable');
    expect(res.updatedInput).toEqual({ command: 'git log --oneline' });
  });

  it('plan mode: read-only auto-allows without prompting; a write ROUTES to canUseTool', async () => {
    let asked = 0;
    const gate = makeGate({
      mode: 'plan',
      canUseTool: async (_t, input) => {
        asked += 1;
        return { behavior: 'allow', updatedInput: input };
      },
    });
    expect((await gate.check('Read', { file_path: '/tmp/a' }, checkOpts(true))).decision).toBe('allow');
    expect(asked).toBe(0);
    expect(
      (await gate.check('Write', { file_path: '/tmp/a', content: 'x' }, checkOpts(false))).decision,
    ).toBe('allow');
    expect(asked).toBe(1);
  });

  it("auto mode: a 'prompt' classification routes to canUseTool (not an auto-allow, not a deny)", async () => {
    let asked = 0;
    const gate = makeGate({
      mode: 'auto',
      classifier: () => 'prompt',
      canUseTool: async (_t, input) => {
        asked += 1;
        return { behavior: 'allow', updatedInput: input };
      },
    });
    const res = await gate.check('Write', { file_path: '/tmp/a', content: 'x' }, checkOpts(false));
    expect(res.decision).toBe('allow');
    expect(asked).toBe(1);
  });

  it('a session ask rule matches ANY Bash sub-command of a chain (routes to prompt)', async () => {
    let asked = 0;
    const gate = makeGate({
      canUseTool: async (_t, input) => {
        asked += 1;
        return { behavior: 'deny', message: 'prompted and refused' };
      },
    });
    gate.applyUpdates([addRules('ask', [{ toolName: 'Bash', ruleContent: 'git:*' }])]);
    // read-only would normally auto-allow; the ask rule must catch the chained git segment
    const res = await gate.check('Bash', { command: 'ls -la && git push' }, checkOpts(true));
    expect(res.decision).toBe('deny');
    expect(asked).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// C. rules.ts parsing edges
// ---------------------------------------------------------------------------

describe('parseRule edges', () => {
  it('trims the tool name in Tool (spec) form', () => {
    expect(parseRule('Bash (git:*)')).toStrictEqual({ toolName: 'Bash', specifier: 'git:*' });
  });

  it('a leading-paren string is a bare tool name, not a specifier form', () => {
    expect(parseRule('(x)')).toStrictEqual({ toolName: '(x)' });
  });

  it('a bare tool name parses with NO specifier key', () => {
    expect(parseRule('Bash')).toStrictEqual({ toolName: 'Bash' });
  });
});

describe('MCP tool-name matching (splitMcpName anchoring)', () => {
  it('mcp__* matches only well-formed mcp__server__tool names', () => {
    expect(matchToolName('mcp__*', 'mcp__a__b')).toBe(true);
    expect(matchToolName('mcp__*', 'mcp__a')).toBe(false); // no tool segment
    expect(matchToolName('mcp__*', 'mcp__a__')).toBe(false); // empty tool
    expect(matchToolName('mcp__*', 'mcp____b')).toBe(false); // empty server
    expect(matchToolName('mcp__*', 'notmcp__a__b')).toBe(false);
  });

  it('server scoping anchors the tool as the LAST __ segment', () => {
    expect(matchToolName('mcp__a__b__*', 'mcp__a__b__tool')).toBe(true); // server contains __
    expect(matchToolName('mcp__a__*', 'mcp__a__b__tool')).toBe(false); // no over-allow of server a on a__b
    expect(matchToolName('mcp__a__*', 'mcp__a__tool')).toBe(true);
    expect(matchToolName('mcp__a', 'mcp__a__tool')).toBe(true); // bare server form
    expect(matchToolName('mcp__a', 'mcp__b__tool')).toBe(false);
    expect(matchToolName('mcp__a', 'plaintool')).toBe(false);
  });

  it('a pattern server containing * is never a match', () => {
    expect(matchToolName('mcp__a*__*', 'mcp__ab__tool')).toBe(false);
  });
});

describe('specifier stem matching', () => {
  it("'ab*' does not match the bare value 'a' (colon-stem shortcut only applies to ':' stems)", () => {
    expect(ruleMatches({ toolName: 'Bash', specifier: 'ab*' }, 'Bash', { command: 'a' })).toBe(false);
  });

  it("'git:*' matches 'git' exactly and 'git <args>' but not 'gitx'", () => {
    const rule = { toolName: 'Bash', specifier: 'git:*' };
    expect(ruleMatches(rule, 'Bash', { command: 'git' })).toBe(true);
    expect(ruleMatches(rule, 'Bash', { command: 'git status' })).toBe(true);
    expect(ruleMatches(rule, 'Bash', { command: 'gitx' })).toBe(false);
  });
});

describe('decomposeBashCommand edges', () => {
  it('trims segments and drops empties from trailing separators', () => {
    expect(decomposeBashCommand(' git log && git status ; ').segments).toEqual([
      'git log',
      'git status',
    ]);
  });

  it('a whitespace-only command yields one (empty) segment - never an empty list', () => {
    const { segments } = decomposeBashCommand('   ');
    expect(segments).toEqual(['']);
    // Load-bearing: an EMPTY segment list would make all-mode vacuously true.
    expect(
      ruleMatches({ toolName: 'Bash', specifier: 'git:*' }, 'Bash', { command: '   ' }, 'all'),
    ).toBe(false);
  });

  it('an all-mode allow match still holds with trailing separator noise', () => {
    expect(
      ruleMatches({ toolName: 'Bash', specifier: 'git:*' }, 'Bash', { command: 'git status; ' }, 'all'),
    ).toBe(true);
  });
});

describe('primaryArg / suggestions edges', () => {
  it('a circular input never matches a specifier rule and never throws', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(ruleMatches({ toolName: 'Weird', specifier: 'x' }, 'Weird', circular)).toBe(false);
  });

  it('Bash suggestions offer the firstToken prefix rule, trimming leading whitespace', () => {
    const s = buildPermissionSuggestions('Bash', { command: '  npm run build' });
    expect(s).toHaveLength(2);
    const rule = (s[1] as { rules: Array<{ ruleContent?: string }> }).rules[0]!;
    expect(rule.ruleContent).toBe('npm:*');
  });

  it('an empty primary argument yields only the bare tool-name suggestion', () => {
    expect(buildPermissionSuggestions('Bash', { command: '' })).toHaveLength(1);
    expect(buildPermissionSuggestions('Write', { file_path: '' })).toHaveLength(1);
    expect(buildPermissionSuggestions('mcp__x__y', {})).toHaveLength(1);
  });
});

/*
 * Judged EQUIVALENT (not killable by behavior, documented for the ledger):
 *  - gate.ts:116/117 ArrayDeclaration '[]' -> '["Stryker was here"]': the junk
 *    rule parses to toolName "Stryker was here" which no real tool call can
 *    match; behavior is unchanged.
 *  - gate.ts:150/154/162 OptionalChaining 'hook?.x' -> 'hook.x': every reach
 *    of those expressions has hook defined (hookAllow/hookAsk/hookDeny imply
 *    a hook object; the deny/defer branches guard on it).
 *  - gate.ts:200 StringLiteral segmentMode 'any' -> '': only the 'all' branch
 *    is distinguished; any other value takes the same some() path.
 *  - rules.ts:227 Regex /^\S+/ -> /\S+/: firstToken always operates on a
 *    trimmed string, so anchoring is not observable.
 */
