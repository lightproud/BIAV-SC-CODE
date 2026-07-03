/**
 * Module E test suite: permissions (rules + DefaultPermissionGate) and hooks
 * (matcherMatches + DefaultHookRunner).
 *
 * Everything here is pure in-memory unit testing - no network, no filesystem,
 * no transport. Timing-sensitive runner tests use real timers with generous
 * bounds (the timeout test pins matcher.timeout = 1s against a 5s sleeper).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { matchToolName, parseRule, ruleMatches } from '../src/permissions/rules.js';
import { DefaultPermissionGate } from '../src/permissions/gate.js';
import { matcherMatches } from '../src/hooks/matcher.js';
import { DefaultHookRunner } from '../src/hooks/runner.js';
import { AbortError } from '../src/errors.js';
import type { PermissionCheckResult } from '../src/internal/contracts.js';
import type {
  CanUseTool,
  HookCallback,
  HookInput,
  HookJSONOutput,
  Options,
  PermissionMode,
  PermissionResult,
  PermissionUpdate,
} from '../src/types.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type CheckOpts = Parameters<DefaultPermissionGate['check']>[2];
type GateConfig = ConstructorParameters<typeof DefaultPermissionGate>[0];

function makeGate(cfg: Partial<GateConfig> = {}): DefaultPermissionGate {
  return new DefaultPermissionGate({ debug: () => {}, ...cfg });
}

function checkOpts(overrides: Partial<CheckOpts> = {}): CheckOpts {
  return {
    toolUseID: 'toolu_e_1',
    signal: new AbortController().signal,
    readOnly: false,
    isFileEdit: false,
    ...overrides,
  };
}

function asAllow(
  res: PermissionCheckResult,
): Extract<PermissionCheckResult, { decision: 'allow' }> {
  if (res.decision !== 'allow') {
    throw new Error(`expected allow, got deny: ${res.message}`);
  }
  return res;
}

function asDeny(
  res: PermissionCheckResult,
): Extract<PermissionCheckResult, { decision: 'deny' }> {
  if (res.decision !== 'deny') {
    throw new Error('expected deny, got allow');
  }
  return res;
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

const PRE_TOOL_INPUT: HookInput = {
  session_id: 'sess-module-e',
  cwd: '/tmp',
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command: 'ls' },
};

function makeRunner(
  hooks: Options['hooks'],
  debug: (m: string) => void = () => {},
): DefaultHookRunner {
  return new DefaultHookRunner({ hooks, debug });
}

function freshSignal(): AbortSignal {
  return new AbortController().signal;
}

function recordingHook(
  name: string,
  calls: string[],
  out?: HookJSONOutput,
): HookCallback {
  return async () => {
    calls.push(name);
    return out;
  };
}

function delayedHook(out: HookJSONOutput, delayMs: number): HookCallback {
  return async (_input, _toolUseID, { signal }) => {
    await sleep(delayMs, signal);
    return out;
  };
}

function decisionOutput(
  decision: 'allow' | 'deny' | 'ask',
  reason?: string,
  extra?: Partial<NonNullable<HookJSONOutput['hookSpecificOutput']>>,
): HookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      ...(reason !== undefined ? { permissionDecisionReason: reason } : {}),
      ...(extra ?? {}),
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// permissions/rules.ts - parseRule
// ---------------------------------------------------------------------------

describe('parseRule', () => {
  it('parses a plain tool name with no specifier', () => {
    expect(parseRule('Bash')).toEqual({ toolName: 'Bash' });
    expect(parseRule('Bash').specifier).toBeUndefined();
  });

  it('parses Tool(spec) form, keeping the specifier verbatim', () => {
    expect(parseRule('Bash(npm run:*)')).toEqual({
      toolName: 'Bash',
      specifier: 'npm run:*',
    });
  });

  it('keeps inner whitespace of the specifier verbatim', () => {
    expect(parseRule('Bash( ls -la )')).toEqual({
      toolName: 'Bash',
      specifier: ' ls -la ',
    });
  });

  it('trims surrounding whitespace of the raw rule', () => {
    expect(parseRule('  Read  ')).toEqual({ toolName: 'Read' });
  });

  it('keeps nested parentheses inside the specifier', () => {
    expect(parseRule('Bash(echo (hi))')).toEqual({
      toolName: 'Bash',
      specifier: 'echo (hi)',
    });
  });

  it('treats strings that do not look like Tool(spec) as bare names', () => {
    expect(parseRule('Bash(unclosed')).toEqual({ toolName: 'Bash(unclosed' });
  });
});

// ---------------------------------------------------------------------------
// permissions/rules.ts - matchToolName
// ---------------------------------------------------------------------------

describe('matchToolName', () => {
  it('matches exact tool names', () => {
    expect(matchToolName('Bash', 'Bash')).toBe(true);
    expect(matchToolName('Bash', 'Read')).toBe(false);
    expect(matchToolName('mcp__srv__tool', 'mcp__srv__tool')).toBe(true);
  });

  it('mcp__server__* matches every tool of that server', () => {
    expect(matchToolName('mcp__srv__*', 'mcp__srv__save')).toBe(true);
    expect(matchToolName('mcp__srv__*', 'mcp__srv__load')).toBe(true);
    expect(matchToolName('mcp__srv__*', 'mcp__other__save')).toBe(false);
  });

  it('bare mcp__server is a server-wide wildcard', () => {
    expect(matchToolName('mcp__srv', 'mcp__srv__save')).toBe(true);
    expect(matchToolName('mcp__srv', 'mcp__srv2__save')).toBe(false);
  });

  it('a fully qualified mcp pattern matches only exactly', () => {
    expect(matchToolName('mcp__srv__tool', 'mcp__srv__tool2')).toBe(false);
  });

  it('wildcard forms apply only to mcp__ patterns', () => {
    expect(matchToolName('srv__*', 'srv__tool')).toBe(false);
    expect(matchToolName('Bash*', 'Bash')).toBe(false);
    expect(matchToolName('Bash*', 'Bash1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// permissions/rules.ts - ruleMatches
// ---------------------------------------------------------------------------

describe('ruleMatches', () => {
  it('bare rule matches the tool by name regardless of input', () => {
    expect(ruleMatches(parseRule('Bash'), 'Bash', {})).toBe(true);
    expect(ruleMatches(parseRule('Bash'), 'Bash', { command: 'anything' })).toBe(true);
    expect(ruleMatches(parseRule('Bash'), 'Read', { command: 'ls' })).toBe(false);
  });

  it('mcp wildcard rules match through ruleMatches too', () => {
    expect(ruleMatches(parseRule('mcp__srv__*'), 'mcp__srv__save', {})).toBe(true);
    expect(ruleMatches(parseRule('mcp__srv'), 'mcp__srv__save', {})).toBe(true);
    expect(ruleMatches(parseRule('mcp__srv'), 'mcp__srvx__save', {})).toBe(false);
  });

  it('specifier compares exactly against Bash command', () => {
    const rule = parseRule('Bash(git status)');
    expect(ruleMatches(rule, 'Bash', { command: 'git status' })).toBe(true);
    expect(ruleMatches(rule, 'Bash', { command: 'git push' })).toBe(false);
    expect(ruleMatches(rule, 'Bash', { command: 'git status --short' })).toBe(false);
  });

  it('specifier maps to file_path for fs tools', () => {
    expect(
      ruleMatches(parseRule('Write(/srv/a.txt)'), 'Write', { file_path: '/srv/a.txt' }),
    ).toBe(true);
    expect(
      ruleMatches(parseRule('Read(/srv/a.txt)'), 'Read', { file_path: '/srv/b.txt' }),
    ).toBe(false);
    expect(
      ruleMatches(parseRule('Edit(/srv/a.txt)'), 'Edit', { file_path: '/srv/a.txt' }),
    ).toBe(true);
  });

  it('specifier maps to pattern for Glob and Grep', () => {
    expect(ruleMatches(parseRule('Glob(**/*.ts)'), 'Glob', { pattern: '**/*.ts' })).toBe(true);
    expect(ruleMatches(parseRule('Grep(TODO)'), 'Grep', { pattern: 'TODO' })).toBe(true);
    expect(ruleMatches(parseRule('Grep(TODO)'), 'Grep', { pattern: 'FIXME' })).toBe(false);
  });

  it('trailing-* specifier is a prefix match', () => {
    const rule = parseRule('Read(/etc/*)');
    expect(ruleMatches(rule, 'Read', { file_path: '/etc/passwd' })).toBe(true);
    expect(ruleMatches(rule, 'Read', { file_path: '/var/log/syslog' })).toBe(false);
  });

  it("handles the 'npm run:*' colon-boundary style", () => {
    const rule = parseRule('Bash(npm run:*)');
    // ':' is a boundary marker, not command text.
    expect(ruleMatches(rule, 'Bash', { command: 'npm run build' })).toBe(true);
    expect(ruleMatches(rule, 'Bash', { command: 'npm run:build' })).toBe(true);
    expect(ruleMatches(rule, 'Bash', { command: 'npm run' })).toBe(true);
    expect(ruleMatches(rule, 'Bash', { command: 'npm test' })).toBe(false);
  });

  it('spec rule never matches when the primary arg is missing', () => {
    expect(ruleMatches(parseRule('Bash(ls*)'), 'Bash', {})).toBe(false);
    expect(ruleMatches(parseRule('Read(/tmp/*)'), 'Read', { offset: 3 })).toBe(false);
  });

  it('spec rule never matches when the primary arg is not a string', () => {
    expect(ruleMatches(parseRule('Bash(42*)'), 'Bash', { command: 42 })).toBe(false);
  });

  it('bare rule still matches when the primary arg is missing', () => {
    expect(ruleMatches(parseRule('Bash'), 'Bash', {})).toBe(true);
  });

  it('unknown tools fall back to the JSON serialization of the input', () => {
    const rule = parseRule('CustomTool({"url":"https://x"})');
    expect(ruleMatches(rule, 'CustomTool', { url: 'https://x' })).toBe(true);
    expect(ruleMatches(rule, 'CustomTool', { url: 'https://y' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// permissions/gate.ts - the nine-step pipeline
// ---------------------------------------------------------------------------

describe('DefaultPermissionGate pipeline', () => {
  it('step 1: hook deny beats everything, even an allowedTools listing and bypassPermissions', async () => {
    const canUse = vi.fn(
      async (): Promise<PermissionResult | null> => ({ behavior: 'allow' }),
    );
    const gate = makeGate({
      mode: 'bypassPermissions',
      allowedTools: ['Bash'],
      canUseTool: canUse as CanUseTool,
    });
    const res = asDeny(
      await gate.check(
        'Bash',
        { command: 'rm -rf /' },
        checkOpts({ hook: { decision: 'deny', reason: 'nope' } }),
      ),
    );
    expect(res.message).toContain('Bash');
    expect(res.message).toContain('hook');
    expect(res.message).toContain('nope');
    expect(canUse).not.toHaveBeenCalled();
    expect(gate.denials()).toHaveLength(1);
  });

  it('step 2: disallowedTools beats hook allow', async () => {
    const gate = makeGate({ mode: 'default', disallowedTools: ['Bash'] });
    const res = asDeny(
      await gate.check(
        'Bash',
        { command: 'ls' },
        checkOpts({ hook: { decision: 'allow' } }),
      ),
    );
    expect(res.message).toContain('Bash');
    expect(res.message).toContain('disallowedTools');
  });

  it('step 2: disallowedTools spec rule denies only matching input', async () => {
    const gate = makeGate({ mode: 'bypassPermissions', disallowedTools: ['Bash(rm*)'] });
    asDeny(await gate.check('Bash', { command: 'rm -rf x' }, checkOpts()));
    asAllow(await gate.check('Bash', { command: 'ls' }, checkOpts()));
  });

  it('step 3: hook allow beats plan mode and hook updatedInput wins', async () => {
    const gate = makeGate({ mode: 'plan' });
    const res = asAllow(
      await gate.check(
        'Bash',
        { command: 'ls' },
        checkOpts({
          readOnly: false,
          hook: { decision: 'allow', updatedInput: { command: 'echo safe' } },
        }),
      ),
    );
    expect(res.updatedInput).toEqual({ command: 'echo safe' });
  });

  it('step 3: hook allow without updatedInput passes the original input through', async () => {
    const gate = makeGate({ mode: 'default' });
    const res = asAllow(
      await gate.check(
        'Bash',
        { command: 'ls' },
        checkOpts({ hook: { decision: 'allow' } }),
      ),
    );
    expect(res.updatedInput).toEqual({ command: 'ls' });
  });

  it('step 4: allowedTools beats plan mode for a non-readOnly tool', async () => {
    const gate = makeGate({ mode: 'plan', allowedTools: ['Bash'] });
    const res = asAllow(
      await gate.check('Bash', { command: 'ls' }, checkOpts({ readOnly: false })),
    );
    expect(res.updatedInput).toEqual({ command: 'ls' });
  });

  it('step 5: bypassPermissions allows tools not listed anywhere', async () => {
    const canUse = vi.fn(
      async (): Promise<PermissionResult | null> => ({ behavior: 'deny', message: 'no' }),
    );
    const gate = makeGate({ mode: 'bypassPermissions', canUseTool: canUse as CanUseTool });
    asAllow(await gate.check('Bash', { command: 'ls' }, checkOpts({ readOnly: false })));
    expect(canUse).not.toHaveBeenCalled();
  });

  it('step 6: plan mode allows readOnly tools', async () => {
    const gate = makeGate({ mode: 'plan' });
    asAllow(await gate.check('Read', { file_path: '/x' }, checkOpts({ readOnly: true })));
  });

  it('step 6: plan mode denies write tools with a message naming tool and stage', async () => {
    const gate = makeGate({ mode: 'plan' });
    const res = asDeny(
      await gate.check(
        'Write',
        { file_path: '/x', content: 'y' },
        checkOpts({ readOnly: false, isFileEdit: true }),
      ),
    );
    expect(res.message).toContain('Write');
    expect(res.message).toContain('plan');
  });

  it('step 7: acceptEdits allows isFileEdit and readOnly tools but not Bash', async () => {
    const gate = makeGate({ mode: 'acceptEdits' });
    asAllow(
      await gate.check(
        'Write',
        { file_path: '/x', content: 'y' },
        checkOpts({ readOnly: false, isFileEdit: true }),
      ),
    );
    asAllow(await gate.check('Read', { file_path: '/x' }, checkOpts({ readOnly: true })));
    const res = asDeny(
      await gate.check('Bash', { command: 'ls' }, checkOpts({ readOnly: false })),
    );
    expect(res.message).toContain('Bash');
  });

  it('step 8: default mode allows readOnly only', async () => {
    const gate = makeGate({ mode: 'default' });
    asAllow(await gate.check('Grep', { pattern: 'x' }, checkOpts({ readOnly: true })));
    asDeny(await gate.check('Bash', { command: 'ls' }, checkOpts({ readOnly: false })));
  });

  it('dontAsk allows readOnly at step 8 like default', async () => {
    const gate = makeGate({ mode: 'dontAsk' });
    asAllow(await gate.check('Read', { file_path: '/x' }, checkOpts({ readOnly: true })));
  });

  it('dontAsk never calls canUseTool and denies at step 9', async () => {
    const canUse = vi.fn(
      async (): Promise<PermissionResult | null> => ({ behavior: 'allow' }),
    );
    const gate = makeGate({ mode: 'dontAsk', canUseTool: canUse as CanUseTool });
    const res = asDeny(
      await gate.check('Bash', { command: 'ls' }, checkOpts({ readOnly: false })),
    );
    expect(canUse).not.toHaveBeenCalled();
    expect(res.message).toContain('Bash');
    expect(res.message).toContain('dontAsk');
  });
});

describe('DefaultPermissionGate step 9 (canUseTool)', () => {
  it('calls canUseTool with toolName, input and options carrying toolUseID + signal', async () => {
    let seen:
      | { toolName: string; input: Record<string, unknown>; options: Record<string, unknown> }
      | undefined;
    const canUse: CanUseTool = async (toolName, input, options) => {
      seen = { toolName, input, options: options as unknown as Record<string, unknown> };
      return { behavior: 'allow' };
    };
    const gate = makeGate({ mode: 'default', canUseTool: canUse });
    const res = asAllow(
      await gate.check(
        'Bash',
        { command: 'make' },
        checkOpts({ readOnly: false, toolUseID: 'toolu_args_1' }),
      ),
    );
    expect(seen).toBeDefined();
    expect(seen?.toolName).toBe('Bash');
    expect(seen?.input).toEqual({ command: 'make' });
    expect(seen?.options['toolUseID']).toBe('toolu_args_1');
    expect(seen?.options['signal']).toBeInstanceOf(AbortSignal);
    // no updatedInput from the callback -> original input flows through
    expect(res.updatedInput).toEqual({ command: 'make' });
  });

  it('honors allow with updatedInput from canUseTool', async () => {
    const canUse: CanUseTool = async () => ({
      behavior: 'allow',
      updatedInput: { command: 'echo replaced' },
    });
    const gate = makeGate({ mode: 'default', canUseTool: canUse });
    const res = asAllow(
      await gate.check('Bash', { command: 'ls' }, checkOpts({ readOnly: false })),
    );
    expect(res.updatedInput).toEqual({ command: 'echo replaced' });
  });

  it('propagates the deny message (and interrupt) from canUseTool', async () => {
    const canUse: CanUseTool = async () => ({
      behavior: 'deny',
      message: 'operator said no',
      interrupt: true,
    });
    const gate = makeGate({ mode: 'default', canUseTool: canUse });
    const res = asDeny(
      await gate.check('Bash', { command: 'ls' }, checkOpts({ readOnly: false })),
    );
    expect(res.message).toContain('operator said no');
    expect(res.message).toContain('Bash');
    expect(res.interrupt).toBe(true);
  });

  it('treats a null return from canUseTool as deny', async () => {
    const canUse: CanUseTool = async () => null;
    const gate = makeGate({ mode: 'default', canUseTool: canUse });
    const res = asDeny(
      await gate.check('Bash', { command: 'ls' }, checkOpts({ readOnly: false })),
    );
    expect(res.message).toContain('Bash');
    expect(gate.denials()).toHaveLength(1);
  });

  it('a throwing canUseTool becomes a deny, not an exception', async () => {
    const canUse: CanUseTool = async () => {
      throw new Error('callback exploded');
    };
    const gate = makeGate({ mode: 'default', canUseTool: canUse });
    const res = asDeny(
      await gate.check('Bash', { command: 'ls' }, checkOpts({ readOnly: false })),
    );
    expect(res.message).toContain('callback exploded');
  });

  it('denies at step 9 when no canUseTool handler is provided', async () => {
    const gate = makeGate({ mode: 'default' });
    const res = asDeny(
      await gate.check('Bash', { command: 'ls' }, checkOpts({ readOnly: false })),
    );
    expect(res.message).toContain('Bash');
  });

  it('check throws AbortError when the signal is already aborted', async () => {
    const gate = makeGate({ mode: 'bypassPermissions' });
    const controller = new AbortController();
    controller.abort();
    await expect(
      gate.check('Bash', { command: 'ls' }, checkOpts({ signal: controller.signal })),
    ).rejects.toBeInstanceOf(AbortError);
  });
});

describe('DefaultPermissionGate hook ask routing', () => {
  const askCases: Array<{
    label: string;
    mode: PermissionMode;
    cfg?: Partial<GateConfig>;
    check: Partial<CheckOpts>;
  }> = [
    {
      label: 'step 4 allowedTools listing',
      mode: 'default',
      cfg: { allowedTools: ['Bash'] },
      check: { readOnly: false, isFileEdit: false },
    },
    {
      label: 'step 5 bypassPermissions',
      mode: 'bypassPermissions',
      check: { readOnly: false, isFileEdit: false },
    },
    {
      label: 'step 6 plan + readOnly',
      mode: 'plan',
      check: { readOnly: true, isFileEdit: false },
    },
    {
      label: 'step 7 acceptEdits + isFileEdit',
      mode: 'acceptEdits',
      check: { readOnly: false, isFileEdit: true },
    },
    {
      label: 'step 8 default + readOnly',
      mode: 'default',
      check: { readOnly: true, isFileEdit: false },
    },
  ];

  for (const c of askCases) {
    it(`hook ask forces canUseTool even when ${c.label} would auto-allow`, async () => {
      const canUse = vi.fn(
        async (): Promise<PermissionResult | null> => ({ behavior: 'allow' }),
      );
      const gate = makeGate({ mode: c.mode, ...(c.cfg ?? {}), canUseTool: canUse as CanUseTool });
      const res = await gate.check(
        'Bash',
        { command: 'ls' },
        checkOpts({ ...c.check, hook: { decision: 'ask', reason: 'because-ask' } }),
      );
      expect(canUse).toHaveBeenCalledTimes(1);
      expect(res.decision).toBe('allow');
    });
  }

  it('hook ask forwards its reason as decisionReason to canUseTool', async () => {
    let seenReason: string | undefined;
    const canUse: CanUseTool = async (_t, _i, options) => {
      seenReason = options.decisionReason;
      return { behavior: 'allow' };
    };
    const gate = makeGate({ mode: 'bypassPermissions', canUseTool: canUse });
    await gate.check(
      'Bash',
      { command: 'ls' },
      checkOpts({ hook: { decision: 'ask', reason: 'because-ask' } }),
    );
    expect(seenReason).toBe('because-ask');
  });

  it('hook ask does NOT override the step-2 disallowedTools deny', async () => {
    const canUse = vi.fn(
      async (): Promise<PermissionResult | null> => ({ behavior: 'allow' }),
    );
    const gate = makeGate({
      mode: 'bypassPermissions',
      disallowedTools: ['Bash'],
      canUseTool: canUse as CanUseTool,
    });
    const res = asDeny(
      await gate.check(
        'Bash',
        { command: 'ls' },
        checkOpts({ hook: { decision: 'ask' } }),
      ),
    );
    expect(res.message).toContain('disallowedTools');
    expect(canUse).not.toHaveBeenCalled();
  });

  it('hook ask does NOT lift the plan-mode deny for write tools', async () => {
    const canUse = vi.fn(
      async (): Promise<PermissionResult | null> => ({ behavior: 'allow' }),
    );
    const gate = makeGate({ mode: 'plan', canUseTool: canUse as CanUseTool });
    const res = asDeny(
      await gate.check(
        'Write',
        { file_path: '/x', content: 'y' },
        checkOpts({ readOnly: false, isFileEdit: true, hook: { decision: 'ask' } }),
      ),
    );
    expect(res.message).toContain('plan');
    expect(canUse).not.toHaveBeenCalled();
  });

  it('hook ask with no canUseTool handler denies', async () => {
    const gate = makeGate({ mode: 'bypassPermissions' });
    asDeny(
      await gate.check('Bash', { command: 'ls' }, checkOpts({ hook: { decision: 'ask' } })),
    );
  });
});

describe('DefaultPermissionGate denials / updates / mode', () => {
  it('records every deny with tool_name, tool_use_id and tool_input', async () => {
    const gate = makeGate({ mode: 'default', disallowedTools: ['Write'] });
    await gate.check(
      'Write',
      { file_path: '/a', content: 'x' },
      checkOpts({ toolUseID: 'toolu_d1', isFileEdit: true }),
    );
    await gate.check(
      'Bash',
      { command: 'make' },
      checkOpts({ toolUseID: 'toolu_d2', readOnly: false }),
    );
    // an allow must NOT be recorded
    await gate.check('Read', { file_path: '/a' }, checkOpts({ readOnly: true }));

    const denials = gate.denials();
    expect(denials).toHaveLength(2);
    expect(denials[0]).toEqual({
      tool_name: 'Write',
      tool_use_id: 'toolu_d1',
      tool_input: { file_path: '/a', content: 'x' },
    });
    expect(denials[1]).toEqual({
      tool_name: 'Bash',
      tool_use_id: 'toolu_d2',
      tool_input: { command: 'make' },
    });
  });

  it('applyUpdates addRules (allow, session) makes a later check allow', async () => {
    const gate = makeGate({ mode: 'default' });
    asDeny(await gate.check('Bash', { command: 'npm run build' }, checkOpts()));

    const update: PermissionUpdate = {
      type: 'addRules',
      rules: [{ toolName: 'Bash', ruleContent: 'npm run:*' }],
      behavior: 'allow',
      destination: 'session',
    };
    gate.applyUpdates([update]);

    asAllow(await gate.check('Bash', { command: 'npm run build' }, checkOpts()));
    // the spec-scoped rule must not allow unrelated commands
    asDeny(await gate.check('Bash', { command: 'rm -rf /' }, checkOpts()));
  });

  it('applyUpdates setMode (session) switches the mode', async () => {
    const gate = makeGate({ mode: 'default' });
    gate.applyUpdates([
      { type: 'setMode', mode: 'bypassPermissions', destination: 'session' },
    ]);
    expect(gate.getMode()).toBe('bypassPermissions');
    asAllow(await gate.check('Bash', { command: 'ls' }, checkOpts()));
  });

  it('setMode/getMode mutate the live mode', async () => {
    const gate = makeGate({ mode: 'default' });
    expect(gate.getMode()).toBe('default');
    asDeny(await gate.check('Bash', { command: 'ls' }, checkOpts()));
    gate.setMode('bypassPermissions');
    expect(gate.getMode()).toBe('bypassPermissions');
    asAllow(await gate.check('Bash', { command: 'ls' }, checkOpts()));
  });

  it('non-session destinations are ignored with a debug warning', async () => {
    const debug = vi.fn();
    const gate = makeGate({ mode: 'default', debug });
    gate.applyUpdates([
      {
        type: 'addRules',
        rules: [{ toolName: 'Bash' }],
        behavior: 'allow',
        destination: 'userSettings',
      },
    ]);
    // rule was NOT applied
    asDeny(await gate.check('Bash', { command: 'ls' }, checkOpts()));
    expect(debug).toHaveBeenCalled();
    const warned = debug.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warned).toContain('userSettings');
    expect(warned.toLowerCase()).toContain('ignor');
  });
});

// ---------------------------------------------------------------------------
// hooks/matcher.ts - matcherMatches
// ---------------------------------------------------------------------------

describe('matcherMatches', () => {
  it('undefined, empty string and * match everything', () => {
    expect(matcherMatches(undefined, 'Bash')).toBe(true);
    expect(matcherMatches('', 'Bash')).toBe(true);
    expect(matcherMatches('*', 'Bash')).toBe(true);
  });

  it('undefined value matches every matcher', () => {
    expect(matcherMatches('Write', undefined)).toBe(true);
    expect(matcherMatches('^mcp__', undefined)).toBe(true);
  });

  it("'Write|Edit' is an exact alternative set", () => {
    expect(matcherMatches('Write|Edit', 'Write')).toBe(true);
    expect(matcherMatches('Write|Edit', 'Edit')).toBe(true);
    expect(matcherMatches('Write|Edit', 'Read')).toBe(false);
    expect(matcherMatches('Write|Edit', 'NotebookEdit')).toBe(false);
  });

  it("'Write, Edit' comma set with trimming", () => {
    expect(matcherMatches('Write, Edit', 'Write')).toBe(true);
    expect(matcherMatches('Write, Edit', 'Edit')).toBe(true);
    expect(matcherMatches('Write, Edit', 'Read')).toBe(false);
  });

  it("'code-reviewer' with a hyphen is exact-set, not a regex range", () => {
    expect(matcherMatches('code-reviewer', 'code-reviewer')).toBe(true);
    expect(matcherMatches('code-reviewer', 'code')).toBe(false);
    expect(matcherMatches('code-reviewer', 'e')).toBe(false);
  });

  it("'^mcp__' is treated as an unanchored-input regex", () => {
    expect(matcherMatches('^mcp__', 'mcp__srv__tool')).toBe(true);
    expect(matcherMatches('^mcp__', 'Bash')).toBe(false);
    expect(matcherMatches('^mcp__', 'xmcp__tool')).toBe(false);
  });

  it("'Edit.*' regex matches NotebookEdit-style names (unanchored)", () => {
    expect(matcherMatches('Edit.*', 'Edit')).toBe(true);
    expect(matcherMatches('Edit.*', 'NotebookEdit')).toBe(true);
    expect(matcherMatches('Edit.*', 'EditFile')).toBe(true);
    expect(matcherMatches('Edit.*', 'Read')).toBe(false);
  });

  it("'mcp__memory' matches only the literal (no server wildcard in hook matchers)", () => {
    expect(matcherMatches('mcp__memory', 'mcp__memory')).toBe(true);
    expect(matcherMatches('mcp__memory', 'mcp__memory__save')).toBe(false);
  });

  it("invalid regex '(' matches nothing and never throws", () => {
    expect(() => matcherMatches('(', 'anything')).not.toThrow();
    expect(matcherMatches('(', 'anything')).toBe(false);
    expect(matcherMatches('[', 'anything')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hooks/runner.ts - DefaultHookRunner
// ---------------------------------------------------------------------------

describe('DefaultHookRunner', () => {
  it('hasHooks reflects registered non-empty matchers', () => {
    const r = makeRunner({
      PreToolUse: [{ matcher: '*', hooks: [async () => undefined] }],
      Stop: [{ matcher: '*', hooks: [] }],
    });
    expect(r.hasHooks('PreToolUse')).toBe(true);
    expect(r.hasHooks('Stop')).toBe(false);
    expect(r.hasHooks('SessionStart')).toBe(false);
  });

  it('runs every hook of every matching matcher and skips non-matching ones', async () => {
    const calls: string[] = [];
    const r = makeRunner({
      PreToolUse: [
        { matcher: 'Bash', hooks: [recordingHook('bash-1', calls), recordingHook('bash-2', calls)] },
        { matcher: '*', hooks: [recordingHook('star', calls)] },
        { matcher: '', hooks: [recordingHook('empty', calls)] },
        { matcher: 'Write', hooks: [recordingHook('write-only', calls)] },
      ],
    });
    await r.run('PreToolUse', PRE_TOOL_INPUT, 'toolu_r1', 'Bash', freshSignal());
    expect([...calls].sort()).toEqual(['bash-1', 'bash-2', 'empty', 'star']);
    expect(calls).not.toContain('write-only');
  });

  it('undefined matchValue runs every registered matcher', async () => {
    const calls: string[] = [];
    const r = makeRunner({
      SessionStart: [{ matcher: 'Write', hooks: [recordingHook('w', calls)] }],
    });
    const input: HookInput = {
      session_id: 's',
      cwd: '/tmp',
      hook_event_name: 'SessionStart',
      source: 'startup',
    };
    await r.run('SessionStart', input, undefined, undefined, freshSignal());
    expect(calls).toEqual(['w']);
  });

  it('no registered hooks yields a neutral aggregate', async () => {
    const r = makeRunner({});
    const agg = await r.run('PreToolUse', PRE_TOOL_INPUT, undefined, 'Bash', freshSignal());
    expect(agg.continue).toBe(true);
    expect(agg.decision).toBeUndefined();
    expect(agg.systemMessages).toEqual([]);
    expect(agg.additionalContext).toEqual([]);
    expect(agg.updatedInput).toBeUndefined();
    expect(agg.updatedToolOutput).toBeUndefined();
  });

  it('aggregates deny > ask > allow across parallel hooks', async () => {
    const r = makeRunner({
      PreToolUse: [
        {
          matcher: '*',
          hooks: [
            async () => decisionOutput('allow', 'fine'),
            async () => decisionOutput('deny', 'not on my watch'),
            async () => decisionOutput('ask', 'maybe'),
          ],
        },
      ],
    });
    const agg = await r.run('PreToolUse', PRE_TOOL_INPUT, 'toolu_r2', 'Bash', freshSignal());
    expect(agg.decision).toBe('deny');
    expect(agg.decisionReason).toBe('not on my watch');
  });

  it('ask beats allow when no deny is present', async () => {
    const r = makeRunner({
      PreToolUse: [
        {
          matcher: '*',
          hooks: [
            async () => decisionOutput('allow', 'fine'),
            async () => decisionOutput('ask', 'confirm this'),
          ],
        },
      ],
    });
    const agg = await r.run('PreToolUse', PRE_TOOL_INPUT, 'toolu_r3', 'Bash', freshSignal());
    expect(agg.decision).toBe('ask');
    expect(agg.decisionReason).toBe('confirm this');
  });

  it("decision 'block' aggregates as deny with its reason", async () => {
    const r = makeRunner({
      PreToolUse: [
        { matcher: '*', hooks: [async (): Promise<HookJSONOutput> => ({ decision: 'block', reason: 'blocked-it' })] },
      ],
    });
    const agg = await r.run('PreToolUse', PRE_TOOL_INPUT, 'toolu_r4', 'Bash', freshSignal());
    expect(agg.decision).toBe('deny');
    expect(agg.decisionReason).toBe('blocked-it');
  });

  it("decision 'approve' is neutral (no aggregated decision)", async () => {
    const r = makeRunner({
      PreToolUse: [
        { matcher: '*', hooks: [async (): Promise<HookJSONOutput> => ({ decision: 'approve', reason: 'ok' })] },
      ],
    });
    const agg = await r.run('PreToolUse', PRE_TOOL_INPUT, 'toolu_r5', 'Bash', freshSignal());
    expect(agg.decision).toBeUndefined();
    expect(agg.continue).toBe(true);
  });

  it('continue:false wins and the first-completed stopReason is kept', async () => {
    const r = makeRunner({
      PreToolUse: [
        {
          matcher: '*',
          hooks: [
            async (): Promise<HookJSONOutput> => ({ continue: false, stopReason: 'early' }),
            delayedHook({ continue: false, stopReason: 'late' }, 60),
            async (): Promise<HookJSONOutput> => ({}),
          ],
        },
      ],
    });
    const agg = await r.run('PreToolUse', PRE_TOOL_INPUT, 'toolu_r6', 'Bash', freshSignal());
    expect(agg.continue).toBe(false);
    expect(agg.stopReason).toBe('early');
  });

  it('collects systemMessages and additionalContext from all hooks', async () => {
    const r = makeRunner({
      PreToolUse: [
        {
          matcher: '*',
          hooks: [
            async (): Promise<HookJSONOutput> => ({ systemMessage: 'one' }),
            async (): Promise<HookJSONOutput> => ({
              systemMessage: 'two',
              hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'ctx-a' },
            }),
          ],
        },
      ],
    });
    const agg = await r.run('PreToolUse', PRE_TOOL_INPUT, 'toolu_r7', 'Bash', freshSignal());
    expect(agg.systemMessages).toHaveLength(2);
    expect(agg.systemMessages).toContain('one');
    expect(agg.systemMessages).toContain('two');
    expect(agg.additionalContext).toEqual(['ctx-a']);
  });

  it('updatedInput comes from the LAST allow output in completion order', async () => {
    const r = makeRunner({
      PreToolUse: [
        {
          matcher: '*',
          hooks: [
            // completes first
            async () => decisionOutput('allow', undefined, { updatedInput: { first: true } }),
            // completes last -> its updatedInput wins
            delayedHook(decisionOutput('allow', undefined, { updatedInput: { second: true } }), 60),
          ],
        },
      ],
    });
    const agg = await r.run('PreToolUse', PRE_TOOL_INPUT, 'toolu_r8', 'Bash', freshSignal());
    expect(agg.decision).toBe('allow');
    expect(agg.updatedInput).toEqual({ second: true });
  });

  it('updatedInput from a non-allow output is ignored', async () => {
    const r = makeRunner({
      PreToolUse: [
        {
          matcher: '*',
          hooks: [async () => decisionOutput('deny', 'no', { updatedInput: { x: 1 } })],
        },
      ],
    });
    const agg = await r.run('PreToolUse', PRE_TOOL_INPUT, 'toolu_r9', 'Bash', freshSignal());
    expect(agg.decision).toBe('deny');
    expect(agg.updatedInput).toBeUndefined();
  });

  it('updatedToolOutput last-wins in completion order', async () => {
    const r = makeRunner({
      PostToolUse: [
        {
          matcher: '*',
          hooks: [
            async (): Promise<HookJSONOutput> => ({
              hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: 'first' },
            }),
            delayedHook(
              { hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: 'second' } },
              60,
            ),
          ],
        },
      ],
    });
    const input: HookInput = {
      session_id: 's',
      cwd: '/tmp',
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: {},
      tool_response: 'raw',
    };
    const agg = await r.run('PostToolUse', input, 'toolu_r10', 'Bash', freshSignal());
    expect(agg.updatedToolOutput).toBe('second');
  });

  it('a throwing callback is ignored while the others still aggregate', async () => {
    const debug = vi.fn();
    const r = makeRunner(
      {
        PreToolUse: [
          {
            matcher: '*',
            hooks: [
              async () => {
                throw new Error('boom');
              },
              async () => decisionOutput('deny', 'still here'),
            ],
          },
        ],
      },
      debug,
    );
    const agg = await r.run('PreToolUse', PRE_TOOL_INPUT, 'toolu_r11', 'Bash', freshSignal());
    expect(agg.decision).toBe('deny');
    expect(agg.decisionReason).toBe('still here');
    const logged = debug.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('boom');
  });

  it('a callback exceeding matcher.timeout is ignored after ~timeout, not after the sleep', async () => {
    const debug = vi.fn();
    const r = makeRunner(
      {
        PreToolUse: [
          {
            matcher: '*',
            timeout: 1, // seconds
            hooks: [
              async (_input, _id, { signal }): Promise<HookJSONOutput> => {
                await sleep(5000, signal); // honors the signal, so no dangling timer
                return { systemMessage: 'too late' };
              },
            ],
          },
        ],
      },
      debug,
    );
    const started = Date.now();
    const agg = await r.run('PreToolUse', PRE_TOOL_INPUT, 'toolu_r12', 'Bash', freshSignal());
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(900);
    expect(elapsed).toBeLessThan(4000); // ~1s timeout, definitely not the 5s sleep
    expect(agg.systemMessages).toEqual([]);
    expect(agg.decision).toBeUndefined();
    expect(debug).toHaveBeenCalled();
  });

  it('async:true outputs are detached and neutral', async () => {
    const debug = vi.fn();
    const r = makeRunner(
      {
        PreToolUse: [
          {
            matcher: '*',
            hooks: [
              async (): Promise<HookJSONOutput> => ({
                async: true,
                systemMessage: 'background says hi',
                hookSpecificOutput: {
                  hookEventName: 'PreToolUse',
                  permissionDecision: 'deny',
                },
              }),
            ],
          },
        ],
      },
      debug,
    );
    const agg = await r.run('PreToolUse', PRE_TOOL_INPUT, 'toolu_r13', 'Bash', freshSignal());
    expect(agg.decision).toBeUndefined();
    expect(agg.systemMessages).toEqual([]);
    expect(agg.continue).toBe(true);
    const logged = debug.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged.toLowerCase()).toContain('detach');
  });

  it('void outputs are neutral', async () => {
    const r = makeRunner({
      PreToolUse: [{ matcher: '*', hooks: [async () => undefined] }],
    });
    const agg = await r.run('PreToolUse', PRE_TOOL_INPUT, 'toolu_r14', 'Bash', freshSignal());
    expect(agg.decision).toBeUndefined();
    expect(agg.continue).toBe(true);
  });

  it('caller signal aborted during the run surfaces as AbortError', async () => {
    const controller = new AbortController();
    const r = makeRunner({
      PreToolUse: [
        {
          matcher: '*',
          hooks: [
            async (_input, _id, { signal }): Promise<HookJSONOutput> => {
              await sleep(5000, signal);
              return {};
            },
          ],
        },
      ],
    });
    const started = Date.now();
    const pending = r.run('PreToolUse', PRE_TOOL_INPUT, 'toolu_r15', 'Bash', controller.signal);
    setTimeout(() => controller.abort(), 30);
    await expect(pending).rejects.toBeInstanceOf(AbortError);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('an already-aborted caller signal rejects immediately with AbortError', async () => {
    const controller = new AbortController();
    controller.abort();
    const r = makeRunner({
      PreToolUse: [{ matcher: '*', hooks: [async () => ({})] }],
    });
    await expect(
      r.run('PreToolUse', PRE_TOOL_INPUT, 'toolu_r16', 'Bash', controller.signal),
    ).rejects.toBeInstanceOf(AbortError);
  });
});
