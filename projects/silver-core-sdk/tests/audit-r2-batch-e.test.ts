/**
 * Second-pass audit (2026-07-17) — Batch E: permission & path-security hardening.
 * One cohesive suite for the six defects that share the root cause "the
 * permission matcher inspects raw model strings instead of the resolved
 * reality":
 *
 *   RP1  path traversal (`..`) bypasses a path-scoped allow/deny.
 *   RP2  a `**` deny pattern matches nothing (deny fail-open).
 *   RP3  a canUseTool `setMode:'bypassPermissions'` escalates the whole session
 *        without the allowDangerouslySkipPermissions interlock.
 *   M2-2 a leading `VAR=val` env prefix bypasses a Bash deny.
 *   M2-4 buildPermissionSuggestions turns `VAR=x npm ...` into `Bash(VAR=x:*)`.
 *   I2   a `mcp__server__*` deny fails open when the TOOL segment contains `__`.
 *
 * Detailed defect ledger: Public-Info-Pool/Resource/repo-engineering/
 * silver-core-sdk-bug-audit-r2-20260717.md (RP1/RP2/RP3/M2-2/M2-4/I2).
 */

import { describe, expect, it, vi } from 'vitest';

import {
  buildPermissionSuggestions,
  matchToolName,
  parseRule,
  ruleMatches,
} from '../src/permissions/rules.js';
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
    toolUseID: 'toolu_e',
    signal: new AbortController().signal,
    readOnly: false,
    isFileEdit: false,
    ...overrides,
  };
}
function decision(res: PermissionCheckResult): string {
  return res.decision;
}

// ---------------------------------------------------------------------------
// RP1 — path traversal must not bypass a path-scoped allow OR deny.
// ---------------------------------------------------------------------------

describe('RP1 path traversal against path-scoped rules', () => {
  const cwd = '/workspace';

  it('ruleMatches: `..` no longer escapes an allow scope', () => {
    const rule = parseRule('Read(/workspace/*)');
    // Inside the scope: matches.
    expect(ruleMatches(rule, 'Read', { file_path: '/workspace/src/a.ts' }, undefined, { cwd })).toBe(true);
    // Traversal that resolves OUTSIDE the scope: must NOT match.
    expect(
      ruleMatches(rule, 'Read', { file_path: '/workspace/../../etc/shadow' }, undefined, { cwd }),
    ).toBe(false);
  });

  it('ruleMatches: `..` no longer tunnels a value INTO a deny scope... and IS caught now', () => {
    const rule = parseRule('Read(/etc/*)');
    // A path that resolves into /etc via `..` must be caught by the deny.
    expect(
      ruleMatches(rule, 'Read', { file_path: '/tmp/../etc/passwd' }, undefined, { cwd }),
    ).toBe(true);
    // A path that does NOT resolve into /etc is not caught.
    expect(ruleMatches(rule, 'Read', { file_path: '/tmp/x' }, undefined, { cwd })).toBe(false);
  });

  it('gate: an allow scoped to /workspace does not auto-allow a traversal escape', async () => {
    // Use Write (non-readOnly) so the step-5 allow RULE — not the mode's
    // read-only auto-allow — is what grants; that is the surface RP1 attacks.
    const gate = makeGate({ mode: 'default', cwd, allowedTools: ['Write(/workspace/*)'] });
    // In-scope write auto-allows via the rule.
    expect(
      decision(await gate.check('Write', { file_path: '/workspace/a', content: 'x' }, checkOpts({ isFileEdit: true }))),
    ).toBe('allow');
    // Escape does not match the rule and falls through to the default-policy deny.
    expect(
      decision(
        await gate.check(
          'Write',
          { file_path: '/workspace/../../etc/shadow', content: 'x' },
          checkOpts({ isFileEdit: true }),
        ),
      ),
    ).toBe('deny');
  });

  it('gate: a deny scoped to /etc catches a `..` tunnel even under bypassPermissions', async () => {
    const gate = makeGate({
      mode: 'bypassPermissions',
      cwd,
      allowDangerousBypass: true,
      disallowedTools: ['Read(/etc/*)'],
    });
    expect(
      decision(await gate.check('Read', { file_path: '/tmp/../etc/passwd' }, checkOpts({ readOnly: true }))),
    ).toBe('deny');
  });

  it('exact path spec is also `..`-normalized', () => {
    const rule = parseRule('Read(/etc/hosts)');
    expect(ruleMatches(rule, 'Read', { file_path: '/etc/../etc/hosts' }, undefined, { cwd })).toBe(true);
    expect(ruleMatches(rule, 'Read', { file_path: '/etc/hostsx' }, undefined, { cwd })).toBe(false);
  });

  it('the /workspace/* prefix stays segment-anchored (no /workspace-secret leak)', () => {
    const rule = parseRule('Read(/workspace/*)');
    expect(ruleMatches(rule, 'Read', { file_path: '/workspace-secret/a' }, undefined, { cwd })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RP2 — a `**` deny pattern must actually match (no deny fail-open).
// ---------------------------------------------------------------------------

describe('RP2 `**` path patterns match instead of failing open', () => {
  const cwd = '/workspace';

  it('ruleMatches: /etc/** matches everything under /etc', () => {
    const rule = parseRule('Read(/etc/**)');
    expect(ruleMatches(rule, 'Read', { file_path: '/etc/passwd' }, undefined, { cwd })).toBe(true);
    expect(ruleMatches(rule, 'Read', { file_path: '/etc/ssh/sshd_config' }, undefined, { cwd })).toBe(true);
    expect(ruleMatches(rule, 'Read', { file_path: '/var/log/x' }, undefined, { cwd })).toBe(false);
  });

  it('gate: a /etc/** deny fires (previously the pattern matched nothing)', async () => {
    const gate = makeGate({ mode: 'default', cwd, disallowedTools: ['Read(/etc/**)'] });
    expect(
      decision(await gate.check('Read', { file_path: '/etc/passwd' }, checkOpts({ readOnly: true }))),
    ).toBe('deny');
  });
});

// ---------------------------------------------------------------------------
// RP3 — canUseTool setMode:'bypassPermissions' must honor the interlock.
// ---------------------------------------------------------------------------

describe('RP3 setMode bypass interlock via canUseTool updatedPermissions', () => {
  const escalating: CanUseTool = async () => ({
    behavior: 'allow',
    updatedPermissions: [{ type: 'setMode', mode: 'bypassPermissions', destination: 'session' }],
  });

  it('is REFUSED when allowDangerouslySkipPermissions was not set', async () => {
    const gate = makeGate({ mode: 'default', canUseTool: escalating });
    // First call: canUseTool allows this one call and tries to escalate the mode.
    expect(decision(await gate.check('Bash', { command: 'ls' }, checkOpts()))).toBe('allow');
    // The escalation must NOT have taken: the mode is still default, so the next
    // non-readonly write is not auto-allowed by a bypass mode. With a denying
    // handler on the second call, it denies (mode never became bypass).
    expect(gate.getMode()).toBe('default');
    const denying = makeGate({ mode: 'default' });
    // (sanity) a fresh default gate with no handler denies a write.
    expect(decision(await denying.check('Write', { file_path: '/x', content: 'y' }, checkOpts()))).toBe('deny');
  });

  it('is HONORED when bypass was unlocked', async () => {
    const gate = makeGate({ mode: 'default', allowDangerousBypass: true, canUseTool: escalating });
    expect(decision(await gate.check('Bash', { command: 'ls' }, checkOpts()))).toBe('allow');
    expect(gate.getMode()).toBe('bypassPermissions');
  });

  it('a direct applyUpdates setMode->bypass is refused without the unlock', () => {
    const debug = vi.fn();
    const gate = new DefaultPermissionGate({ mode: 'default', debug });
    gate.applyUpdates([{ type: 'setMode', mode: 'bypassPermissions', destination: 'session' }]);
    expect(gate.getMode()).toBe('default');
    expect(debug.mock.calls.map((c) => String(c[0])).join('\n')).toContain('interlock');
  });

  it('a non-bypass setMode still applies without any unlock', () => {
    const gate = makeGate({ mode: 'default' });
    gate.applyUpdates([{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }]);
    expect(gate.getMode()).toBe('acceptEdits');
  });
});

// ---------------------------------------------------------------------------
// M2-2 — leading env assignment must not bypass a Bash deny.
// ---------------------------------------------------------------------------

describe('M2-2 leading env assignment does not bypass a Bash deny', () => {
  it('ruleMatches (deny/ask, `any`): Bash(rm:*) catches `FOO=1 rm -rf /`', () => {
    const rule = parseRule('Bash(rm:*)');
    expect(ruleMatches(rule, 'Bash', { command: 'FOO=1 rm -rf /' }, 'any')).toBe(true);
    expect(ruleMatches(rule, 'Bash', { command: 'A=1 B=2 rm x' }, 'any')).toBe(true);
    // quoted assignment value
    expect(ruleMatches(rule, 'Bash', { command: 'X="a b" rm x' }, 'any')).toBe(true);
    // a bare assignment with no command is not a match
    expect(ruleMatches(rule, 'Bash', { command: 'FOO=1' }, 'any')).toBe(false);
  });

  it('gate: the deny fires on an env-prefixed command', async () => {
    const gate = makeGate({ mode: 'bypassPermissions', allowDangerousBypass: true, disallowedTools: ['Bash(rm:*)'] });
    expect(decision(await gate.check('Bash', { command: 'FOO=1 rm -rf /tmp/x' }, checkOpts()))).toBe('deny');
  });

  it('allow position stays fail-closed: an env prefix does NOT ride a Bash allow', async () => {
    // GIT_SSH_COMMAND=evil must not be waved through by an allow scoped to git.
    const gate = makeGate({ mode: 'default', allowedTools: ['Bash(git:*)'] });
    // Plain git status auto-allows.
    expect(decision(await gate.check('Bash', { command: 'git status' }, checkOpts()))).toBe('allow');
    // Env-prefixed git falls through to the default-policy deny (no handler).
    expect(
      decision(await gate.check('Bash', { command: 'GIT_SSH_COMMAND=evil git fetch' }, checkOpts())),
    ).toBe('deny');
  });
});

// ---------------------------------------------------------------------------
// M2-4 — suggestions key off the command, not a leading env assignment.
// ---------------------------------------------------------------------------

describe('M2-4 buildPermissionSuggestions skips leading env assignments', () => {
  it('`VAR=x npm run build` suggests Bash(npm:*), not Bash(VAR=x:*)', () => {
    const s = buildPermissionSuggestions('Bash', { command: 'VAR=x npm run build' });
    expect(s).toEqual([
      { type: 'addRules', rules: [{ toolName: 'Bash' }], behavior: 'allow', destination: 'session' },
      { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm:*' }], behavior: 'allow', destination: 'session' },
    ]);
  });

  it('a plain command is unaffected (no env prefix)', () => {
    const s = buildPermissionSuggestions('Bash', { command: 'npm run test' });
    expect(s[1]).toEqual({
      type: 'addRules',
      rules: [{ toolName: 'Bash', ruleContent: 'npm:*' }],
      behavior: 'allow',
      destination: 'session',
    });
  });
});

// ---------------------------------------------------------------------------
// I2 — `mcp__server__*` deny must not fail open when the tool segment has `__`.
// ---------------------------------------------------------------------------

describe('I2 server-scoped MCP rule resolves the server exactly with a registry', () => {
  it('with knownServers, mcp__a__* catches a tool of server "a" whose name contains __', () => {
    const servers = new Set(['a']);
    // Tool of server "a", tool name "get__thing" -> qualified mcp__a__get__thing.
    expect(matchToolName('mcp__a__*', 'mcp__a__get__thing', servers)).toBe(true);
    expect(matchToolName('mcp__a', 'mcp__a__get__thing', servers)).toBe(true);
  });

  it('longest-registered-prefix disambiguates a vs a__b', () => {
    const servers = new Set(['a', 'a__b']);
    // mcp__a__b__tool belongs to the more specific registered server a__b.
    expect(matchToolName('mcp__a__b__*', 'mcp__a__b__tool', servers)).toBe(true);
    expect(matchToolName('mcp__a__*', 'mcp__a__b__tool', servers)).toBe(false);
    // A genuine tool of "a" with a __ tool name still matches a's scope.
    expect(matchToolName('mcp__a__*', 'mcp__a__x__y', servers)).toBe(true);
  });

  it('ruleMatches end-to-end honors the registry via MatchContext.knownServers', () => {
    const knownServers = new Set(['a']);
    expect(
      ruleMatches(parseRule('mcp__a'), 'mcp__a__get__thing', {}, undefined, { knownServers }),
    ).toBe(true);
  });

  it('without a registry, the legacy exact-server (last-__) behavior is unchanged', () => {
    // No knownServers: mcp__a__b__tool parses as server a__b, so mcp__a__* does
    // NOT match it (the pre-existing #22 contract).
    expect(matchToolName('mcp__a__*', 'mcp__a__b__tool')).toBe(false);
    expect(matchToolName('mcp__a__b__*', 'mcp__a__b__tool')).toBe(true);
    expect(matchToolName('mcp__a', 'mcp__a__tool')).toBe(true);
  });
});
