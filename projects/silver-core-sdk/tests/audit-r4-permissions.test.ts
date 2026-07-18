/**
 * Audit r4 (2026-07-17) — PERMISSIONS cluster regression locks
 * (report: Public-Info-Pool/Resource/repo-engineering/
 * silver-core-sdk-bug-audit-r4-20260717.md):
 *
 *  - Y1-2: a symlinked value cannot tunnel a Read/Write/Edit past a deny scoped
 *    to the real directory (gate resolves symlinks, matching the kernel).
 *  - Y1-3: an INTERIOR `**` / `*` in a path specifier globs correctly
 *    (`Read(/etc/**​/secret)` fires on `/etc/foo/secret`), while trailing-`*`
 *    deep-prefix semantics stay unchanged.
 *  - V4-1: a de-obfuscated command word matches a deny/ask specifier
 *    (`\rm` / `"rm"` / `'rm'` are denied by `Bash(rm:*)`); allow stays strict.
 *  - V4-2: a wrapped command is unwrapped for deny/ask (`sudo rm`, `timeout 5
 *    rm`, `eval "rm …"`, `xargs rm`, `env FOO=1 rm`); allow stays strict.
 *  - V4-3: arithmetic expansion `$((…))` is NOT flagged as command injection.
 *  - Rg-1: a `*` specifier on a non-tabled tool (MCP / Task) matches, closing
 *    the deny-position fail-open; a SPECIFIC specifier still does not.
 *  - Rg-2: a canUseTool that returns undefined / a non-object fails CLOSED
 *    (deny), instead of throwing an uncaught TypeError out of the gate.
 *
 * Conventions follow tests/permissions-gate-fixes.test.ts.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  decomposeBashCommand,
  parseRule,
  ruleMatches,
} from '../src/permissions/rules.js';
import { DefaultPermissionGate } from '../src/permissions/gate.js';
import type { CanUseTool } from '../src/types.js';

type CheckOpts = Parameters<DefaultPermissionGate['check']>[2];
type GateConfig = ConstructorParameters<typeof DefaultPermissionGate>[0];

function makeGate(cfg: Partial<GateConfig> = {}): DefaultPermissionGate {
  return new DefaultPermissionGate({ debug: () => {}, ...cfg });
}

function checkOpts(overrides: Partial<CheckOpts> = {}): CheckOpts {
  return {
    toolUseID: 'tu_r4_perm',
    signal: new AbortController().signal,
    readOnly: false,
    isFileEdit: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Y1-2 — symlink deny bypass (needs a real on-disk symlink)
// ---------------------------------------------------------------------------

describe('Y1-2 a symlink cannot tunnel a path-primary tool past a deny', () => {
  let root: string;
  let secretDir: string;
  let linkedFile: string; // <ws>/link/x, where <ws>/link -> secretDir

  beforeAll(() => {
    // realpathSync so macOS /var -> /private/var etc. does not skew the compare.
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'scs-r4-perm-')));
    secretDir = path.join(root, 'secret');
    const wsDir = path.join(root, 'ws');
    fs.mkdirSync(secretDir);
    fs.mkdirSync(wsDir);
    fs.writeFileSync(path.join(secretDir, 'x'), 'top secret');
    fs.symlinkSync(secretDir, path.join(wsDir, 'link'), 'dir');
    linkedFile = path.join(wsDir, 'link', 'x');
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('ruleMatches sees the real target of the symlink for a deny', () => {
    const deny = parseRule(`Read(${secretDir}/*)`);
    // Lexically linkedFile is NOT under secretDir; the kernel's open() follows
    // the link, and so must the deny.
    expect(ruleMatches(deny, 'Read', { file_path: linkedFile }, 'any')).toBe(true);
  });

  it('the gate denies the symlink-tunneled Read end to end (even under bypass)', async () => {
    const gate = makeGate({
      mode: 'bypassPermissions',
      disallowedTools: [`Read(${secretDir}/*)`],
    });
    const res = await gate.check('Read', { file_path: linkedFile }, checkOpts({ readOnly: true }));
    expect(res.decision).toBe('deny');
  });

  it('a path that neither lexically nor really matches stays a miss (no false deny)', () => {
    const deny = parseRule(`Read(${secretDir}/*)`);
    const plain = path.join(root, 'ws', 'plain.txt');
    fs.writeFileSync(plain, 'nothing secret');
    expect(ruleMatches(deny, 'Read', { file_path: plain }, 'any')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Y1-3 — interior ** / * in path specifiers
// ---------------------------------------------------------------------------

describe('Y1-3 interior ** / * globs in path specifiers', () => {
  const deny = parseRule('Read(/etc/**/secret)');

  it('an interior ** matches at any depth, including zero directories', () => {
    expect(ruleMatches(deny, 'Read', { file_path: '/etc/secret' }, 'any')).toBe(true);
    expect(ruleMatches(deny, 'Read', { file_path: '/etc/foo/secret' }, 'any')).toBe(true);
    expect(ruleMatches(deny, 'Read', { file_path: '/etc/a/b/secret' }, 'any')).toBe(true);
  });

  it('a non-matching tail or root does not match', () => {
    expect(ruleMatches(deny, 'Read', { file_path: '/etc/foo/other' }, 'any')).toBe(false);
    expect(ruleMatches(deny, 'Read', { file_path: '/var/foo/secret' }, 'any')).toBe(false);
    // A file literally named `...secret` (no separator) must NOT match `**/secret`.
    expect(ruleMatches(deny, 'Read', { file_path: '/etc/foosecret' }, 'any')).toBe(false);
  });

  it('a single interior * matches ONE segment only', () => {
    const r = parseRule('Read(/etc/*/secret)');
    expect(ruleMatches(r, 'Read', { file_path: '/etc/foo/secret' }, 'any')).toBe(true);
    expect(ruleMatches(r, 'Read', { file_path: '/etc/a/b/secret' }, 'any')).toBe(false);
  });

  it('trailing-* prefix semantics are unchanged (deep prefix, boundary-anchored)', () => {
    const r = parseRule('Read(/etc/*)');
    expect(ruleMatches(r, 'Read', { file_path: '/etc/a/b/c' }, 'any')).toBe(true);
    expect(ruleMatches(r, 'Read', { file_path: '/etcx/a' }, 'any')).toBe(false);
  });

  it('the gate denies an interior-** path end to end', async () => {
    const gate = makeGate({
      mode: 'bypassPermissions',
      disallowedTools: ['Read(/etc/**/secret)'],
    });
    const res = await gate.check('Read', { file_path: '/etc/foo/secret' }, checkOpts({ readOnly: true }));
    expect(res.decision).toBe('deny');
  });
});

// ---------------------------------------------------------------------------
// V4-1 — de-obfuscated command word matches a deny/ask specifier
// ---------------------------------------------------------------------------

describe('V4-1 quoted/escaped command word is denied', () => {
  const deny = parseRule('Bash(rm:*)');

  it('deny fires on \\rm / "rm" / \'rm\' obfuscations', () => {
    expect(ruleMatches(deny, 'Bash', { command: '\\rm -rf /' }, 'any')).toBe(true);
    expect(ruleMatches(deny, 'Bash', { command: '"rm" -rf /' }, 'any')).toBe(true);
    expect(ruleMatches(deny, 'Bash', { command: "'rm' -rf /tmp/x" }, 'any')).toBe(true);
  });

  it('allow position stays STRICT: an obfuscated command does not ride an allow', () => {
    // 'all' (allow) mode must not de-obfuscate, so the call falls through to a prompt.
    expect(ruleMatches(deny, 'Bash', { command: '\\rm -rf /' }, 'all')).toBe(false);
  });

  it('the gate denies the obfuscated command end to end', async () => {
    const gate = makeGate({ mode: 'bypassPermissions', disallowedTools: ['Bash(rm:*)'] });
    const res = await gate.check('Bash', { command: '\\rm -rf /' }, checkOpts());
    expect(res.decision).toBe('deny');
  });
});

// ---------------------------------------------------------------------------
// V4-2 — wrapped command is unwrapped for deny/ask
// ---------------------------------------------------------------------------

describe('V4-2 wrapper commands are unwrapped for deny/ask', () => {
  const deny = parseRule('Bash(rm:*)');

  it('deny fires through sudo / timeout / eval / xargs / env wrappers', () => {
    expect(ruleMatches(deny, 'Bash', { command: 'sudo rm -rf /' }, 'any')).toBe(true);
    expect(ruleMatches(deny, 'Bash', { command: 'timeout 5 rm -rf /tmp/x' }, 'any')).toBe(true);
    expect(ruleMatches(deny, 'Bash', { command: 'eval "rm -rf /"' }, 'any')).toBe(true);
    expect(ruleMatches(deny, 'Bash', { command: 'xargs rm' }, 'any')).toBe(true);
    expect(ruleMatches(deny, 'Bash', { command: 'env FOO=1 rm -rf /tmp/x' }, 'any')).toBe(true);
    expect(ruleMatches(deny, 'Bash', { command: 'nice -n 10 rm -rf /tmp/x' }, 'any')).toBe(true);
  });

  it('does not false-deny a command that merely mentions rm as an argument', () => {
    expect(
      ruleMatches(deny, 'Bash', { command: 'git commit -m "please rm old files"' }, 'any'),
    ).toBe(false);
    expect(ruleMatches(deny, 'Bash', { command: 'cp rm.txt /dst' }, 'any')).toBe(false);
  });

  it('allow position stays STRICT: a wrapped command does not ride an allow (no sudo escalation)', () => {
    expect(ruleMatches(deny, 'Bash', { command: 'sudo rm -rf /' }, 'all')).toBe(false);
  });

  it('the gate denies a chained, wrapped command end to end', async () => {
    const gate = makeGate({ mode: 'bypassPermissions', disallowedTools: ['Bash(rm:*)'] });
    const res = await gate.check('Bash', { command: 'ls && sudo rm -rf /tmp/x' }, checkOpts());
    expect(res.decision).toBe('deny');
  });
});

// ---------------------------------------------------------------------------
// V4-3 — arithmetic expansion is not command injection
// ---------------------------------------------------------------------------

describe('V4-3 arithmetic $((…)) is not treated as injection', () => {
  it('$((…)) is not injection, but $(…) command substitution still is', () => {
    expect(decomposeBashCommand('echo $((1 + 2))').hasInjection).toBe(false);
    expect(decomposeBashCommand('git log $(rm -rf /)').hasInjection).toBe(true);
    expect(decomposeBashCommand('echo `whoami`').hasInjection).toBe(true);
    // A command substitution nested inside arithmetic is still caught.
    expect(decomposeBashCommand('echo $(( $(id) ))').hasInjection).toBe(true);
    expect(decomposeBashCommand('echo hi').hasInjection).toBe(false);
  });

  it('an allow rule now auto-allows arithmetic; real command substitution still prompts', async () => {
    const allowed = makeGate({ mode: 'default', allowedTools: ['Bash(echo:*)'] });
    const ok = await allowed.check('Bash', { command: 'echo $((1 + 2))' }, checkOpts());
    expect(ok.decision).toBe('allow');

    // Command substitution keeps blocking the allow (no canUseTool -> deny).
    const injected = makeGate({ mode: 'default', allowedTools: ['Bash(echo:*)'] });
    const blocked = await injected.check('Bash', { command: 'echo $(whoami)' }, checkOpts());
    expect(blocked.decision).toBe('deny');
  });
});

// ---------------------------------------------------------------------------
// Rg-1 — a `*` specifier on a non-tabled tool matches (deny fail-open closed)
// ---------------------------------------------------------------------------

describe('Rg-1 a `*` specifier denies a non-tabled tool', () => {
  it('ruleMatches: `mcp__github__delete_file(*)` matches the tool', () => {
    const deny = parseRule('mcp__github__delete_file(*)');
    expect(ruleMatches(deny, 'mcp__github__delete_file', { path: 'x' }, 'any')).toBe(true);
    // Task is also non-tabled; `Task(*)` matches too.
    expect(ruleMatches(parseRule('Task(*)'), 'Task', { subagent_type: 'x' }, 'any')).toBe(true);
  });

  it('the gate denies a `*`-scoped MCP delete end to end', async () => {
    const gate = makeGate({
      mode: 'bypassPermissions',
      disallowedTools: ['mcp__github__delete_file(*)'],
    });
    const res = await gate.check('mcp__github__delete_file', { path: 'x' }, checkOpts());
    expect(res.decision).toBe('deny');
  });

  it('a SPECIFIC specifier on a non-tabled tool still does not match (keeper 2026-07-16 boundary)', () => {
    const deny = parseRule('mcp__github__delete_file(secret)');
    expect(ruleMatches(deny, 'mcp__github__delete_file', { path: 'secret' }, 'any')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rg-2 — canUseTool returning undefined / a non-object fails closed
// ---------------------------------------------------------------------------

describe('Rg-2 a canUseTool with no decision fails closed', () => {
  it('undefined return denies (no uncaught TypeError) and records the denial', async () => {
    const canUseTool = (async () => undefined) as unknown as CanUseTool;
    const gate = makeGate({ mode: 'default', canUseTool });
    const res = await gate.check('Write', { file_path: '/tmp/a', content: 'y' }, checkOpts());
    expect(res.decision).toBe('deny');
    if (res.decision === 'deny') {
      expect(res.message).toContain('canUseTool callback');
      expect(res.message).toContain('callback returned no decision');
    }
    expect(gate.denials()).toHaveLength(1);
  });

  it('a non-object return (e.g. a string) also denies', async () => {
    const canUseTool = (async () => 'yes') as unknown as CanUseTool;
    const gate = makeGate({ mode: 'default', canUseTool });
    const res = await gate.check('Write', { file_path: '/tmp/a', content: 'y' }, checkOpts());
    expect(res.decision).toBe('deny');
  });
});
