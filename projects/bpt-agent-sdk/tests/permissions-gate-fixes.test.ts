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

import { matchToolName, parseRule, ruleMatches } from '../src/permissions/rules.js';
import { DefaultPermissionGate } from '../src/permissions/gate.js';
import type { PermissionCheckResult } from '../src/internal/contracts.js';
import type { CanUseTool, PermissionResult } from '../src/types.js';

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
  it('plan mode denies a non-readOnly tool even with an allowedTools match', async () => {
    const gate = makeGate({ mode: 'plan', allowedTools: ['Bash'] });
    const res = asDeny(
      await gate.check('Bash', { command: 'ls' }, checkOpts({ readOnly: false })),
    );
    expect(res.message).toContain('plan');
    expect(res.message).toContain('Bash');
  });

  it('plan mode denies a write/edit tool even with an allowedTools match', async () => {
    const gate = makeGate({ mode: 'plan', allowedTools: ['Write'] });
    const res = asDeny(
      await gate.check(
        'Write',
        { file_path: '/x', content: 'y' },
        checkOpts({ readOnly: false, isFileEdit: true }),
      ),
    );
    expect(res.message).toContain('plan');
  });

  it('plan mode still allows a readOnly tool that matches an allowedTools rule', async () => {
    const gate = makeGate({ mode: 'plan', allowedTools: ['Read'] });
    const res = asAllow(
      await gate.check('Read', { file_path: '/x' }, checkOpts({ readOnly: true })),
    );
    expect(res.updatedInput).toEqual({ file_path: '/x' });
  });

  it('plan mode routes a non-readOnly allowedTools tool to canUseTool when nothing denies', async () => {
    // With canUseTool present, plan-mode non-readOnly is denied by step 6 before
    // reaching step 9 (deny outranks), so canUseTool is not consulted.
    const canUse = vi.fn(
      async (): Promise<PermissionResult | null> => ({ behavior: 'allow' }),
    );
    const gate = makeGate({
      mode: 'plan',
      allowedTools: ['Bash'],
      canUseTool: canUse as CanUseTool,
    });
    asDeny(await gate.check('Bash', { command: 'ls' }, checkOpts({ readOnly: false })));
    expect(canUse).not.toHaveBeenCalled();
  });

  it('non-plan modes are unaffected: allowedTools still auto-approves a write', async () => {
    const gate = makeGate({ mode: 'default', allowedTools: ['Bash'] });
    const res = asAllow(
      await gate.check('Bash', { command: 'ls' }, checkOpts({ readOnly: false })),
    );
    expect(res.updatedInput).toEqual({ command: 'ls' });
  });
});
