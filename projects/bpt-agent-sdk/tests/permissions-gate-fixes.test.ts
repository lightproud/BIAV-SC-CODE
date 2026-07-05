/**
 * Regression tests for the PERMISSIONS cluster fixes:
 *   - #22: MCP wildcard rule scoping splits on the FULL server-name boundary.
 *   - #23: disallowedTools is re-checked against hook/canUseTool rewritten input.
 *   - AUDIT P0: plan mode never auto-approves a non-readOnly tool via allowedTools.
 *   - AUDIT: disallowedTools (scoped deny) re-check on rewritten input.
 *
 * These live in a separate file from permissions-hooks.test.ts (owned by the
 * hooks agent) per the workflow's file ownership split.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  buildPermissionSuggestions,
  decomposeBashCommand,
  matchToolName,
  parseRule,
  requiresUserInteraction,
  ruleMatches,
} from '../src/permissions/rules.js';
import { DefaultPermissionGate } from '../src/permissions/gate.js';
import {
  defaultAutoClassifier,
  type AutoDecision,
  type ToolClassifier,
} from '../src/permissions/classifier.js';
import type { PermissionCheckResult } from '../src/internal/contracts.js';
import type { CanUseTool, PermissionResult, PermissionUpdate } from '../src/types.js';

type CheckOpts = Parameters<DefaultPermissionGate['check']>[2];
type GateConfig = ConstructorParameters<typeof DefaultPermissionGate>[0];

function makeGate(cfg: Partial<GateConfig> = {}): DefaultPermissionGate {
  return new DefaultPermissionGate({ debug: () => {}, ...cfg });
}

function checkOpts(overrides: Partial<CheckOpts> = {}): CheckOpts {
  return {
    toolUseID: 'toolu_fix_1',
    signal: new AbortController().signal,
    readOnly: false,
    isFileEdit: false,
    ...overrides,
  };
}

function asAllow(
  res: PermissionCheckResult,
): Extract<PermissionCheckResult, { decision: 'allow' }> {
  if (res.decision !== 'allow') throw new Error(`expected allow, got deny: ${res.message}`);
  return res;
}

function asDeny(
  res: PermissionCheckResult,
): Extract<PermissionCheckResult, { decision: 'deny' }> {
  if (res.decision !== 'deny') throw new Error('expected deny, got allow');
  return res;
}

// ---------------------------------------------------------------------------
// #22 - MCP server-name boundary in matchToolName / ruleMatches
// ---------------------------------------------------------------------------

describe('#22 MCP wildcard matches the server segment exactly', () => {
  it('a rule for server "a" does NOT over-allow tools of server "a__b"', () => {
    // Qualified name of an a__b tool: mcp__a__b__tool (server=a__b, tool=tool).
    expect(matchToolName('mcp__a', 'mcp__a__b__tool')).toBe(false);
    expect(matchToolName('mcp__a__*', 'mcp__a__b__tool')).toBe(false);
  });

  it('a server whose name contains "__" is targetable', () => {
    expect(matchToolName('mcp__a__b', 'mcp__a__b__tool')).toBe(true);
    expect(matchToolName('mcp__a__b__*', 'mcp__a__b__tool')).toBe(true);
  });

  it('still matches the ordinary single-segment server case', () => {
    expect(matchToolName('mcp__a', 'mcp__a__tool')).toBe(true);
    expect(matchToolName('mcp__a__*', 'mcp__a__tool')).toBe(true);
    expect(matchToolName('mcp__srv', 'mcp__srv2__save')).toBe(false);
  });

  it('single underscores in server/tool names are not delimiters', () => {
    expect(matchToolName('mcp__Google_Drive', 'mcp__Google_Drive__copy_file')).toBe(true);
    expect(matchToolName('mcp__Google_Drive__*', 'mcp__Google_Drive__copy_file')).toBe(true);
  });

  it('exact tool rules do not act as a wildcard for a different server', () => {
    expect(matchToolName('mcp__srv__tool', 'mcp__srv__tool2')).toBe(false);
    expect(matchToolName('mcp__srv__tool', 'mcp__srv__tool')).toBe(true);
  });

  it('ruleMatches honors the exact-server scoping end to end', () => {
    // Deny scoped to server "a" must not fire on an a__b tool.
    expect(ruleMatches(parseRule('mcp__a'), 'mcp__a__b__save', {})).toBe(false);
    // But it fires on server a's own tool.
    expect(ruleMatches(parseRule('mcp__a'), 'mcp__a__save', {})).toBe(true);
    // And server a__b is targetable.
    expect(ruleMatches(parseRule('mcp__a__b'), 'mcp__a__b__save', {})).toBe(true);
  });

  it('non-mcp patterns are unaffected', () => {
    expect(matchToolName('Bash', 'Bash')).toBe(true);
    expect(matchToolName('mcp__', 'mcp__a__tool')).toBe(false); // empty server
  });
});

// ---------------------------------------------------------------------------
// Bash command decomposition — a prefix allow rule cannot be smuggled past via
// `allowed && dangerous`, injection, or a chained denied sub-command.
// ---------------------------------------------------------------------------

describe('Bash command decomposition in the permission gate', () => {
  it('decomposeBashCommand splits on chaining operators and flags injection', () => {
    expect(decomposeBashCommand('git status && rm -rf /').segments).toEqual([
      'git status',
      'rm -rf /',
    ]);
    expect(decomposeBashCommand('a | b ; c || d & e').segments).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
    expect(decomposeBashCommand('git log $(rm -rf /)').hasInjection).toBe(true);
    expect(decomposeBashCommand('echo `whoami`').hasInjection).toBe(true);
    expect(decomposeBashCommand('git status').hasInjection).toBe(false);
    expect(decomposeBashCommand('git status').segments).toEqual(['git status']);
  });

  it('an allow rule still allows a chain where EVERY sub-command matches', async () => {
    const gate = makeGate({ mode: 'default', allowedTools: ['Bash(git:*)'] });
    const res = asAllow(
      await gate.check('Bash', { command: 'git status && git log' }, checkOpts()),
    );
    expect(res.decision).toBe('allow');
  });

  it('an allow rule does NOT auto-allow a chained dangerous sub-command', async () => {
    // `Bash(git:*)` would match the whole string "git status && rm -rf /"
    // (starts with "git"); decomposition makes it fall through to a deny
    // because there is no canUseTool handler (default policy).
    const gate = makeGate({ mode: 'default', allowedTools: ['Bash(git:*)'] });
    const res = await gate.check('Bash', { command: 'git status && rm -rf /' }, checkOpts());
    expect(res.decision).toBe('deny');
  });

  it('an allow rule does NOT auto-allow a command carrying injection', async () => {
    const gate = makeGate({ mode: 'default', allowedTools: ['Bash(git:*)'] });
    const res = await gate.check('Bash', { command: 'git log $(rm -rf /)' }, checkOpts());
    expect(res.decision).toBe('deny');
  });

  it('a deny rule fires on a denied sub-command chained after an innocuous one', async () => {
    const gate = makeGate({ mode: 'bypassPermissions', disallowedTools: ['Bash(rm:*)'] });
    // Even bypass mode honors deny rules (step 2 precedes the mode step).
    const res = asDeny(
      await gate.check('Bash', { command: 'ls && rm -rf /tmp/x' }, checkOpts()),
    );
    expect(res.decision).toBe('deny');
  });

  it('a lone allowed command is unaffected (no regression)', async () => {
    const gate = makeGate({ mode: 'default', allowedTools: ['Bash(git:*)'] });
    const res = asAllow(await gate.check('Bash', { command: 'git status' }, checkOpts()));
    expect(res.decision).toBe('allow');
  });
});

// ---------------------------------------------------------------------------
// #23 - disallowedTools re-checked against rewritten input
// ---------------------------------------------------------------------------

describe('#23 disallowedTools re-check on rewritten input', () => {
  it('hook-allow updatedInput that now matches a deny rule is denied', async () => {
    const gate = makeGate({ mode: 'default', disallowedTools: ['Bash(sudo:*)'] });
    const res = asDeny(
      await gate.check(
        'Bash',
        { command: 'systemctl restart app' }, // original: does not match deny
        checkOpts({
          hook: {
            decision: 'allow',
            updatedInput: { command: 'sudo systemctl restart app' }, // rewritten: matches
          },
        }),
      ),
    );
    expect(res.message).toContain('disallowedTools');
    // The denial is recorded with the rewritten (offending) input.
    const denial = gate.denials().at(-1);
    expect(denial?.tool_input).toEqual({ command: 'sudo systemctl restart app' });
  });

  it('hook-allow updatedInput that stays clean is still allowed', async () => {
    const gate = makeGate({ mode: 'default', disallowedTools: ['Bash(sudo:*)'] });
    const res = asAllow(
      await gate.check(
        'Bash',
        { command: 'systemctl restart app' },
        checkOpts({
          hook: { decision: 'allow', updatedInput: { command: 'echo safe' } },
        }),
      ),
    );
    expect(res.updatedInput).toEqual({ command: 'echo safe' });
  });

  it('canUseTool allow updatedInput that now matches a deny rule is denied', async () => {
    const canUse = vi.fn(
      async (): Promise<PermissionResult | null> => ({
        behavior: 'allow',
        updatedInput: { command: 'sudo rm -rf /' },
      }),
    );
    const gate = makeGate({
      mode: 'default',
      disallowedTools: ['Bash(sudo:*)'],
      canUseTool: canUse as CanUseTool,
    });
    const res = asDeny(
      await gate.check('Bash', { command: 'ls' }, checkOpts({ readOnly: false })),
    );
    expect(res.message).toContain('disallowedTools');
    expect(gate.denials().at(-1)?.tool_input).toEqual({ command: 'sudo rm -rf /' });
  });

  it('a denied canUseTool rewrite applies no session permission updates', async () => {
    const canUse = vi.fn(
      async (): Promise<PermissionResult | null> => ({
        behavior: 'allow',
        updatedInput: { command: 'sudo shutdown' },
        updatedPermissions: [
          {
            type: 'addRules',
            behavior: 'allow',
            destination: 'session',
            rules: [{ toolName: 'Bash' }],
          },
        ],
      }),
    );
    const gate = makeGate({
      mode: 'default',
      disallowedTools: ['Bash(sudo:*)'],
      canUseTool: canUse as CanUseTool,
    });
    asDeny(await gate.check('Bash', { command: 'ls' }, checkOpts()));
    // Had applyUpdates run, a subsequent readOnly-independent Bash call would be
    // auto-allowed by the session allow rule. It must still require canUseTool.
    canUse.mockResolvedValueOnce({ behavior: 'deny', message: 'no' });
    asDeny(await gate.check('Bash', { command: 'echo hi' }, checkOpts()));
  });

  it('canUseTool allow with clean input still applies session updates and allows', async () => {
    const canUse = vi.fn(
      async (): Promise<PermissionResult | null> => ({
        behavior: 'allow',
        updatedInput: { command: 'echo replaced' },
      }),
    );
    const gate = makeGate({
      mode: 'default',
      disallowedTools: ['Bash(sudo:*)'],
      canUseTool: canUse as CanUseTool,
    });
    const res = asAllow(await gate.check('Bash', { command: 'ls' }, checkOpts()));
    expect(res.updatedInput).toEqual({ command: 'echo replaced' });
  });
});

// ---------------------------------------------------------------------------
// AUDIT P0 - plan mode never auto-approves a non-readOnly tool via allowedTools
// ---------------------------------------------------------------------------

describe('AUDIT plan-mode allow ordering', () => {
  it('plan mode never auto-approves a non-readOnly tool via allowedTools (denies with no canUseTool)', async () => {
    // v0.2: plan routes writes to canUseTool; the allowedTools match must NOT
    // auto-approve (step 5 is skipped). With no callback, the step-6 fallback
    // denies.
    const gate = makeGate({ mode: 'plan', allowedTools: ['Bash'] });
    const res = asDeny(
      await gate.check('Bash', { command: 'ls' }, checkOpts({ readOnly: false })),
    );
    expect(res.message).toContain('Bash');
  });

  it('plan mode never auto-approves a write/edit tool via allowedTools', async () => {
    const gate = makeGate({ mode: 'plan', allowedTools: ['Write'] });
    const res = asDeny(
      await gate.check(
        'Write',
        { file_path: '/x', content: 'y' },
        checkOpts({ readOnly: false, isFileEdit: true }),
      ),
    );
    expect(res.message).toContain('Write');
  });

  it('plan mode still allows a readOnly tool that matches an allowedTools rule', async () => {
    const gate = makeGate({ mode: 'plan', allowedTools: ['Read'] });
    const res = asAllow(
      await gate.check('Read', { file_path: '/x' }, checkOpts({ readOnly: true })),
    );
    expect(res.updatedInput).toEqual({ file_path: '/x' });
  });

  it('plan mode routes a non-readOnly allowedTools tool to canUseTool (v0.2)', async () => {
    // v0.2: plan-mode non-readOnly is routed to canUseTool (never a hard deny);
    // the allowedTools match does not auto-approve, so the callback decides.
    const canUse = vi.fn(
      async (): Promise<PermissionResult | null> => ({ behavior: 'allow' }),
    );
    const gate = makeGate({
      mode: 'plan',
      allowedTools: ['Bash'],
      canUseTool: canUse as CanUseTool,
    });
    const res = asAllow(
      await gate.check('Bash', { command: 'ls' }, checkOpts({ readOnly: false })),
    );
    expect(res.updatedInput).toEqual({ command: 'ls' });
    expect(canUse).toHaveBeenCalledTimes(1);
  });

  it('non-plan modes are unaffected: allowedTools still auto-approves a write', async () => {
    const gate = makeGate({ mode: 'default', allowedTools: ['Bash'] });
    const res = asAllow(
      await gate.check('Bash', { command: 'ls' }, checkOpts({ readOnly: false })),
    );
    expect(res.updatedInput).toEqual({ command: 'ls' });
  });
});

// ---------------------------------------------------------------------------
// v0.2 - classifier.ts (permissionMode 'auto' heuristic)
// ---------------------------------------------------------------------------

describe('defaultAutoClassifier', () => {
  const cases: Array<{
    label: string;
    name: string;
    meta: { readOnly: boolean; isFileEdit: boolean };
    want: AutoDecision;
  }> = [
    { label: 'read-only tool', name: 'Read', meta: { readOnly: true, isFileEdit: false }, want: 'allow' },
    { label: 'read-only Bash (unusual but honored)', name: 'Bash', meta: { readOnly: true, isFileEdit: false }, want: 'allow' },
    { label: 'Write (isFileEdit)', name: 'Write', meta: { readOnly: false, isFileEdit: true }, want: 'prompt' },
    { label: 'Edit (isFileEdit)', name: 'Edit', meta: { readOnly: false, isFileEdit: true }, want: 'prompt' },
    { label: 'Bash (known-destructive by name)', name: 'Bash', meta: { readOnly: false, isFileEdit: false }, want: 'prompt' },
    // #6: an unknown / MCP mutation of unassessable risk must PROMPT, never
    // auto-allow (previously these asserted 'allow' - the confirmed defect).
    { label: 'unknown non-readonly tool', name: 'mcp__srv__do', meta: { readOnly: false, isFileEdit: false }, want: 'prompt' },
    { label: 'destructive MCP mutation (gmail send)', name: 'mcp__gmail__send', meta: { readOnly: false, isFileEdit: false }, want: 'prompt' },
    { label: 'destructive MCP mutation (github delete_file)', name: 'mcp__github__delete_file', meta: { readOnly: false, isFileEdit: false }, want: 'prompt' },
    { label: 'read-only MCP tool still auto-allows', name: 'mcp__github__get_me', meta: { readOnly: true, isFileEdit: false }, want: 'allow' },
  ];
  for (const c of cases) {
    it(`classifies ${c.label} as ${c.want}`, () => {
      expect(defaultAutoClassifier(c.name, {}, c.meta)).toBe(c.want);
    });
  }
});

describe('DefaultPermissionGate auto mode', () => {
  it('auto: read-only tool auto-allows without canUseTool', async () => {
    const canUse = vi.fn(async (): Promise<PermissionResult | null> => ({ behavior: 'deny', message: 'no' }));
    const gate = makeGate({ mode: 'auto', canUseTool: canUse as CanUseTool });
    asAllow(await gate.check('Read', { file_path: '/x' }, checkOpts({ readOnly: true })));
    expect(canUse).not.toHaveBeenCalled();
  });

  // #6: an unknown non-readonly tool must NOT auto-execute in auto mode; it
  // routes to canUseTool (and denies when no handler is present). This test
  // previously asserted the buggy auto-allow behavior.
  it('auto: an unknown non-readonly tool routes to canUseTool (allows via handler)', async () => {
    const canUse = vi.fn(async (): Promise<PermissionResult | null> => ({ behavior: 'allow' }));
    const gate = makeGate({ mode: 'auto', canUseTool: canUse as CanUseTool });
    asAllow(
      await gate.check('mcp__srv__do', { arg: 1 }, checkOpts({ readOnly: false })),
    );
    expect(canUse).toHaveBeenCalledTimes(1);
  });

  it('auto: an unknown non-readonly MCP mutation denies when no canUseTool handler exists (#6)', async () => {
    const gate = makeGate({ mode: 'auto' });
    const res = asDeny(
      await gate.check('mcp__gmail__send', { to: 'x@y.z' }, checkOpts({ readOnly: false })),
    );
    expect(res.message).toContain('mcp__gmail__send');
    expect(res.message).toContain('canUseTool');
  });

  it('auto: Write / Edit / Bash route to canUseTool', async () => {
    const canUse = vi.fn(async (): Promise<PermissionResult | null> => ({ behavior: 'allow' }));
    const gate = makeGate({ mode: 'auto', canUseTool: canUse as CanUseTool });
    asAllow(await gate.check('Write', { file_path: '/x', content: 'y' }, checkOpts({ readOnly: false, isFileEdit: true })));
    asAllow(await gate.check('Edit', { file_path: '/x' }, checkOpts({ readOnly: false, isFileEdit: true })));
    asAllow(await gate.check('Bash', { command: 'ls' }, checkOpts({ readOnly: false })));
    expect(canUse).toHaveBeenCalledTimes(3);
  });

  it('auto: a classifier that denies records a denial (stage "auto classifier")', async () => {
    const classifier: ToolClassifier = () => 'deny';
    const gate = makeGate({ mode: 'auto', classifier });
    const res = asDeny(await gate.check('Bash', { command: 'ls' }, checkOpts({ readOnly: false })));
    expect(res.message).toContain('auto classifier');
    expect(gate.denials()).toHaveLength(1);
  });

  it('auto: an injected custom classifier overrides the default', async () => {
    // Default would auto-allow an unknown tool; this classifier forces a prompt.
    const canUse = vi.fn(async (): Promise<PermissionResult | null> => ({ behavior: 'allow' }));
    const classifier: ToolClassifier = () => 'prompt';
    const gate = makeGate({ mode: 'auto', classifier, canUseTool: canUse as CanUseTool });
    asAllow(await gate.check('mcp__srv__do', {}, checkOpts({ readOnly: false })));
    expect(canUse).toHaveBeenCalledTimes(1);
  });

  it('auto: a scoped deny rule still beats the classifier', async () => {
    const gate = makeGate({ mode: 'auto', disallowedTools: ['Bash(rm*)'] });
    const res = asDeny(await gate.check('Bash', { command: 'rm -rf /' }, checkOpts({ readOnly: false })));
    expect(res.message).toContain('disallowedTools');
  });
});

// ---------------------------------------------------------------------------
// v0.2 - ask rules (first-class) + requiresUserInteraction
// ---------------------------------------------------------------------------

describe('DefaultPermissionGate ask rules (v0.2)', () => {
  it('a session ask rule routes to canUseTool even under bypassPermissions', async () => {
    const canUse = vi.fn(async (): Promise<PermissionResult | null> => ({ behavior: 'allow' }));
    const gate = makeGate({ mode: 'bypassPermissions', canUseTool: canUse as CanUseTool });
    gate.applyUpdates([
      { type: 'addRules', rules: [{ toolName: 'Bash' }], behavior: 'ask', destination: 'session' },
    ]);
    asAllow(await gate.check('Bash', { command: 'ls' }, checkOpts({ readOnly: false })));
    expect(canUse).toHaveBeenCalledTimes(1);
  });

  it('a scoped session ask rule routes only its matching input', async () => {
    const canUse = vi.fn(async (): Promise<PermissionResult | null> => ({ behavior: 'allow' }));
    const gate = makeGate({ mode: 'bypassPermissions', canUseTool: canUse as CanUseTool });
    gate.applyUpdates([
      { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'git push:*' }], behavior: 'ask', destination: 'session' },
    ]);
    // Non-matching command: bypass auto-allows, no prompt.
    asAllow(await gate.check('Bash', { command: 'ls' }, checkOpts({ readOnly: false })));
    expect(canUse).not.toHaveBeenCalled();
    // Matching command: routed to canUseTool.
    asAllow(await gate.check('Bash', { command: 'git push origin' }, checkOpts({ readOnly: false })));
    expect(canUse).toHaveBeenCalledTimes(1);
  });

  it('requiresUserInteraction (AskUserQuestion) forces canUseTool even in bypass', async () => {
    const canUse = vi.fn(async (): Promise<PermissionResult | null> => ({ behavior: 'allow' }));
    const gate = makeGate({ mode: 'bypassPermissions', canUseTool: canUse as CanUseTool });
    asAllow(await gate.check('AskUserQuestion', { questions: [] }, checkOpts({ readOnly: false })));
    expect(canUse).toHaveBeenCalledTimes(1);
  });

  it('dontAsk denies an ask-rule / requiresUserInteraction route (no prompt)', async () => {
    const canUse = vi.fn(async (): Promise<PermissionResult | null> => ({ behavior: 'allow' }));
    const gate = makeGate({ mode: 'dontAsk', canUseTool: canUse as CanUseTool });
    const res = asDeny(await gate.check('AskUserQuestion', {}, checkOpts({ readOnly: false })));
    expect(res.message).toContain('dontAsk');
    expect(canUse).not.toHaveBeenCalled();
  });

  it('applyUpdates no longer emits the "ask rules are stored but not consulted" warning', async () => {
    const debug = vi.fn();
    const gate = makeGate({ mode: 'default', debug });
    gate.applyUpdates([
      { type: 'addRules', rules: [{ toolName: 'Bash' }], behavior: 'ask', destination: 'session' },
    ]);
    const logged = debug.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).not.toContain('not consulted');
  });
});

// ---------------------------------------------------------------------------
// #5 - AskUserQuestion (requiresUserInteraction) must not be hard-denied in
//      every mode when no canUseTool handler exists; it is answered by
//      ctx.askUser at execute time, so a mode that would otherwise allow it
//      must allow it (and the model can then reach the askUser handler).
// ---------------------------------------------------------------------------

describe('#5 AskUserQuestion permission without a canUseTool handler', () => {
  // AskUserQuestion's real tool flag is readOnly:true; the earlier suite drives
  // it with readOnly:false to isolate the interaction route. Cover both so the
  // fix is not accidentally readOnly-dependent.
  for (const readOnly of [true, false]) {
    it(`bypassPermissions ALLOWS AskUserQuestion (no canUseTool, readOnly=${readOnly})`, async () => {
      const gate = makeGate({ mode: 'bypassPermissions' });
      asAllow(await gate.check('AskUserQuestion', { questions: [] }, checkOpts({ readOnly })));
      expect(gate.denials()).toHaveLength(0);
    });
  }

  it('default mode ALLOWS a readOnly AskUserQuestion (no canUseTool)', async () => {
    const gate = makeGate({ mode: 'default' });
    asAllow(await gate.check('AskUserQuestion', { questions: [] }, checkOpts({ readOnly: true })));
  });

  it('acceptEdits ALLOWS a readOnly AskUserQuestion (no canUseTool)', async () => {
    const gate = makeGate({ mode: 'acceptEdits' });
    asAllow(await gate.check('AskUserQuestion', { questions: [] }, checkOpts({ readOnly: true })));
  });

  it('auto mode ALLOWS a readOnly AskUserQuestion (no canUseTool)', async () => {
    const gate = makeGate({ mode: 'auto' });
    asAllow(await gate.check('AskUserQuestion', { questions: [] }, checkOpts({ readOnly: true })));
  });

  it('WITH a canUseTool handler, AskUserQuestion still routes to it even in bypass', async () => {
    // The interaction route is a veto point when a handler exists; preserved.
    const canUse = vi.fn(async (): Promise<PermissionResult | null> => ({ behavior: 'allow' }));
    const gate = makeGate({ mode: 'bypassPermissions', canUseTool: canUse as CanUseTool });
    asAllow(await gate.check('AskUserQuestion', { questions: [] }, checkOpts({ readOnly: true })));
    expect(canUse).toHaveBeenCalledTimes(1);
  });

  it('dontAsk still denies AskUserQuestion (no canUseTool)', async () => {
    const gate = makeGate({ mode: 'dontAsk' });
    const res = asDeny(await gate.check('AskUserQuestion', { questions: [] }, checkOpts({ readOnly: false })));
    expect(res.message).toContain('dontAsk');
  });

  it('a session ask rule still hard-routes (and denies with no canUseTool) regardless of the interaction fix', async () => {
    const gate = makeGate({ mode: 'bypassPermissions' });
    gate.applyUpdates([
      { type: 'addRules', rules: [{ toolName: 'Bash' }], behavior: 'ask', destination: 'session' },
    ]);
    // No canUseTool: the ask rule route must still deny (not fall through to bypass allow).
    asDeny(await gate.check('Bash', { command: 'ls' }, checkOpts({ readOnly: false })));
  });
});

// ---------------------------------------------------------------------------
// v0.2 - canUseTool full context (suggestions + requestId), skip, defer
// ---------------------------------------------------------------------------

describe('DefaultPermissionGate canUseTool context (v0.2)', () => {
  it('passes suggestions (bare + scoped session allow rule) and a fresh requestId', async () => {
    const seen: Array<{ suggestions?: PermissionUpdate[]; requestId?: string }> = [];
    const canUse: CanUseTool = async (_t, _i, options) => {
      seen.push({ suggestions: options.suggestions, requestId: options.requestId });
      return { behavior: 'allow' };
    };
    const gate = makeGate({ mode: 'default', canUseTool: canUse });
    await gate.check('Bash', { command: 'npm run build' }, checkOpts({ readOnly: false }));
    await gate.check('Bash', { command: 'npm run test' }, checkOpts({ readOnly: false }));

    expect(seen).toHaveLength(2);
    const s = seen[0]?.suggestions ?? [];
    expect(s[0]).toEqual({ type: 'addRules', rules: [{ toolName: 'Bash' }], behavior: 'allow', destination: 'session' });
    expect(s[1]).toEqual({ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm:*' }], behavior: 'allow', destination: 'session' });
    // requestId is a fresh uuid on every call.
    expect(typeof seen[0]?.requestId).toBe('string');
    expect(seen[0]?.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(seen[0]?.requestId).not.toBe(seen[1]?.requestId);
  });

  it('a null canUseTool return is a skip, not recorded as a denial', async () => {
    const canUse: CanUseTool = async () => null;
    const gate = makeGate({ mode: 'default', canUseTool: canUse });
    const res = await gate.check('Bash', { command: 'ls' }, checkOpts({ readOnly: false }));
    expect(res.decision).toBe('skip');
    expect(gate.denials()).toHaveLength(0);
  });

  it('a hook defer yields a defer decision and is not recorded', async () => {
    const gate = makeGate({ mode: 'default' });
    const res = await gate.check(
      'Bash',
      { command: 'ls' },
      checkOpts({ readOnly: false, hook: { decision: 'defer', reason: 'wait for human' } }),
    );
    expect(res.decision).toBe('defer');
    if (res.decision === 'defer') expect(res.message).toContain('wait for human');
    expect(gate.denials()).toHaveLength(0);
  });

  it('a hook defer beats even bypassPermissions and a matching deny is not reached', async () => {
    const gate = makeGate({ mode: 'bypassPermissions' });
    const res = await gate.check(
      'Bash',
      { command: 'ls' },
      checkOpts({ readOnly: false, hook: { decision: 'defer' } }),
    );
    expect(res.decision).toBe('defer');
  });
});

// ---------------------------------------------------------------------------
// v0.2 - rules.ts helpers
// ---------------------------------------------------------------------------

describe('buildPermissionSuggestions', () => {
  it('Bash suggests bare + first-token command-prefix rule', () => {
    expect(buildPermissionSuggestions('Bash', { command: 'npm run build' })).toEqual([
      { type: 'addRules', rules: [{ toolName: 'Bash' }], behavior: 'allow', destination: 'session' },
      { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm:*' }], behavior: 'allow', destination: 'session' },
    ]);
  });

  it('Read suggests bare + the exact file_path', () => {
    expect(buildPermissionSuggestions('Read', { file_path: '/etc/hosts' })).toEqual([
      { type: 'addRules', rules: [{ toolName: 'Read' }], behavior: 'allow', destination: 'session' },
      { type: 'addRules', rules: [{ toolName: 'Read', ruleContent: '/etc/hosts' }], behavior: 'allow', destination: 'session' },
    ]);
  });

  it('an unknown / MCP tool gets only the bare-name suggestion', () => {
    expect(buildPermissionSuggestions('mcp__srv__do', { url: 'https://x' })).toEqual([
      { type: 'addRules', rules: [{ toolName: 'mcp__srv__do' }], behavior: 'allow', destination: 'session' },
    ]);
  });

  it('a known tool with a missing/non-string primary arg gets only the bare suggestion', () => {
    expect(buildPermissionSuggestions('Bash', {})).toEqual([
      { type: 'addRules', rules: [{ toolName: 'Bash' }], behavior: 'allow', destination: 'session' },
    ]);
  });
});

describe('requiresUserInteraction', () => {
  it('is true only for AskUserQuestion', () => {
    expect(requiresUserInteraction('AskUserQuestion')).toBe(true);
    expect(requiresUserInteraction('Bash')).toBe(false);
    expect(requiresUserInteraction('mcp__srv__ask')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// G-SANDBOX: dangerouslyDisableSandbox escape routing (F1 fail-open fix)
// ---------------------------------------------------------------------------

describe('sandbox escape is gated as its own ask (never piggybacks a command approval)', () => {
  const escape = () => checkOpts({ sandboxEscape: true });
  const canUse: CanUseTool = async () => ({ behavior: 'allow', updatedInput: {} });

  it('forces a prompt in default mode even with a matching command allow rule', async () => {
    // The allow rule pre-approved `git status` IN the sandbox; it must NOT
    // silently authorize running it OUTSIDE the sandbox.
    const gate = makeGate({ mode: 'default', allowedTools: ['Bash(git:*)'], canUseTool: canUse });
    const spy = vi.fn(canUse);
    const g2 = makeGate({ mode: 'default', allowedTools: ['Bash(git:*)'], canUseTool: spy });
    const res = await g2.check('Bash', { command: 'git status' }, escape());
    expect(res.decision).toBe('allow'); // via the ask, not the rule
    expect(spy).toHaveBeenCalledTimes(1);
    void gate;
  });

  it('forces a prompt even when a PreToolUse hook allowed the command', async () => {
    const spy = vi.fn(canUse);
    const gate = makeGate({ mode: 'default', canUseTool: spy });
    const res = await gate.check(
      'Bash',
      { command: 'git push' },
      checkOpts({ sandboxEscape: true, hook: { decision: 'allow' } }),
    );
    expect(res.decision).toBe('allow');
    expect(spy).toHaveBeenCalledTimes(1); // routed to the ask, not the hook-allow shortcut
  });

  it('denies the escape in dontAsk mode (fail-closed, no prompt available)', async () => {
    const gate = makeGate({ mode: 'dontAsk' });
    const res = await gate.check('Bash', { command: 'git push' }, escape());
    expect(res.decision).toBe('deny');
  });

  it('denies the escape when no canUseTool handler exists (fail-closed)', async () => {
    const gate = makeGate({ mode: 'default' });
    const res = await gate.check('Bash', { command: 'git push' }, escape());
    expect(res.decision).toBe('deny');
  });

  it('bypassPermissions still allows the escape without a prompt (total-bypass contract)', async () => {
    const spy = vi.fn(canUse);
    const gate = makeGate({ mode: 'bypassPermissions', canUseTool: spy });
    const res = await gate.check('Bash', { command: 'git push' }, escape());
    expect(res.decision).toBe('allow');
    expect(spy).not.toHaveBeenCalled();
  });

  it('a deny rule still denies the escape first', async () => {
    const gate = makeGate({ mode: 'default', disallowedTools: ['Bash(git push:*)'], canUseTool: canUse });
    const res = await gate.check('Bash', { command: 'git push origin' }, escape());
    expect(res.decision).toBe('deny');
  });

  it('a NON-escape Bash call is unaffected (allow rule still auto-allows in-sandbox)', async () => {
    const spy = vi.fn(canUse);
    const gate = makeGate({ mode: 'default', allowedTools: ['Bash(git:*)'], canUseTool: spy });
    const res = await gate.check('Bash', { command: 'git status' }, checkOpts());
    expect(res.decision).toBe('allow');
    expect(spy).not.toHaveBeenCalled(); // allowed by rule, no prompt
  });
});
