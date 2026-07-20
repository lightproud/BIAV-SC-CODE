/**
 * Mutation-kill tests: permissions rules, batch 3 (T63 optional investment,
 * keeper ruling "可选投资" 2026-07-20). The weekly ratchet red permissions at
 * 85.96% (floor was 92.87, re-baselined to 85.5 under ruling A); rules.ts is
 * the drag at 80.89%. Its survivors are dominated by the command-unwrap
 * SECURITY core — COMMAND_WRAPPERS, wrapper-arg peeling, group stripping, env
 * prefixing — which is genuinely killable (unlike transport-openai's over-fit
 * residue) AND security-relevant: each kill pins the guarantee that a
 * deny/ask rule scoped to the real command still fires through an
 * obfuscated / wrapped / grouped form (audit r4 V4-1/V4-2, r3 W10-1). Plus
 * MCP-name matching and path/glob resolution. Behaviour assertions on the
 * exported surface (ruleMatches / matchToolName / decomposeBashCommand).
 */

import { describe, expect, it } from 'vitest';
import {
  matchToolName,
  parseRule,
  ruleMatches,
  decomposeBashCommand,
} from '../src/permissions/rules.js';

// Deny/ask position ('any') is where the unwrap runs; 'all' (allow) stays strict.
const denyRm = parseRule('Bash(rm:*)');
const bashDeny = (command: string) => ruleMatches(denyRm, 'Bash', { command }, 'any');
const bashAllow = (command: string) => ruleMatches(denyRm, 'Bash', { command }, 'all');

// ---------------------------------------------------------------------------
// COMMAND_WRAPPERS — a deny scoped to the inner command sees through each
// wrapper (kills the 17 command-name StringLiterals + the peel logic).
// ---------------------------------------------------------------------------

describe('command-wrapper passthrough (deny sees the real command)', () => {
  const plainWrappers = [
    'sudo', 'doas', 'exec', 'command', 'builtin', 'nohup',
    'setsid', 'stdbuf', 'xargs', 'bash', 'sh', 'time',
  ];
  for (const w of plainWrappers) {
    it(`'${w} rm -rf /' is denied by Bash(rm:*)`, () => {
      expect(bashDeny(`${w} rm -rf /`)).toBe(true);
    });
  }

  it("'env FOO=1 rm -rf /' (wrapper + its VAR=val arg) is denied", () => {
    expect(bashDeny('env FOO=1 rm -rf /')).toBe(true);
  });
  it("'timeout 5 rm -rf /' (wrapper + duration arg) is denied", () => {
    expect(bashDeny('timeout 5 rm -rf /')).toBe(true);
  });
  it("'timeout 1.5s rm -rf /' (fractional duration) is denied", () => {
    expect(bashDeny('timeout 1.5s rm -rf /')).toBe(true);
  });
  it("'nice -n 10 rm -rf /' (wrapper + flag + num) is denied", () => {
    expect(bashDeny('nice -n 10 rm -rf /')).toBe(true);
  });
  it("'ionice -c2 rm -rf /' (wrapper + flag) is denied", () => {
    expect(bashDeny('ionice -c2 rm -rf /')).toBe(true);
  });
  it("'eval \"rm -rf /\"' (quoted wrapper target) is denied", () => {
    expect(bashDeny('eval "rm -rf /"')).toBe(true);
  });
  it("chained wrappers 'sudo timeout 5 rm -rf /' peel to the real command", () => {
    expect(bashDeny('sudo timeout 5 rm -rf /')).toBe(true);
  });

  it('a NON-wrapper first token is the real command (not peeled past)', () => {
    // `notrm` is not a wrapper and not `rm`; deny(rm:*) must NOT match.
    expect(bashDeny('notrm -rf /')).toBe(false);
  });

  it('the ALLOW position stays strict: a wrapped command does NOT ride an allow', () => {
    // 'all' mode must NOT unwrap, so `sudo rm` fails to match `rm:*` and falls
    // through to prompting instead of auto-allowing.
    expect(bashAllow('sudo rm -rf /')).toBe(false);
    expect(bashAllow('rm -rf /')).toBe(true); // bare form still matches allow
  });
});

// ---------------------------------------------------------------------------
// De-obfuscation + group wrappers (V4-1 / W10-1)
// ---------------------------------------------------------------------------

describe('de-obfuscation + group stripping', () => {
  it('backslash / quote obfuscation is denied (\\rm, "rm", \'rm\')', () => {
    expect(bashDeny('\\rm -rf /')).toBe(true);
    expect(bashDeny('"rm" -rf /')).toBe(true);
    expect(bashDeny("'rm' -rf /tmp/x")).toBe(true);
  });
  it('a subshell group (rm -rf /) is denied', () => {
    expect(bashDeny('(rm -rf /)')).toBe(true);
  });
  it('a brace group { rm -rf /; } is denied', () => {
    expect(bashDeny('{ rm -rf /; }')).toBe(true);
  });
  it('nested groups ((rm -rf /)) collapse in one pass and are denied', () => {
    expect(bashDeny('((rm -rf /))')).toBe(true);
  });
  it('a wrapped command inside a group (sudo rm -rf /) is denied', () => {
    expect(bashDeny('(sudo rm -rf /)')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// env-assignment prefix stripping (M2-2)
// ---------------------------------------------------------------------------

describe('env-assignment prefix', () => {
  it("a leading VAR=val prefix is stripped for deny ('FOO=1 rm -rf /')", () => {
    expect(bashDeny('FOO=1 rm -rf /')).toBe(true);
  });
  it("a quoted-value assignment (BAR=\"x y\" rm ...) is stripped", () => {
    expect(bashDeny('BAR="x y" rm -rf /')).toBe(true);
  });
  it('the ALLOW position does NOT strip an env prefix (must fall through)', () => {
    // GIT_SSH_COMMAND=evil git ... must not ride a git allow — but here the
    // point is the deny/allow asymmetry: allow stays strict on the env prefix.
    const allowRm = parseRule('Bash(rm:*)');
    expect(ruleMatches(allowRm, 'Bash', { command: 'FOO=1 rm -rf /' }, 'all')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// decomposeBashCommand — segmentation (chains are separate segments)
// ---------------------------------------------------------------------------

describe('decomposeBashCommand segmentation', () => {
  it('splits a && / ; / | chain into separate segments so a deny matches ANY', () => {
    // ls is fine, rm is denied — the deny must fire on the rm segment.
    expect(bashDeny('ls && rm -rf /')).toBe(true);
    expect(bashDeny('echo hi ; rm -rf /tmp/x')).toBe(true);
    expect(bashDeny('cat f | rm -rf /')).toBe(true);
  });
  it('a command with no denied segment is not denied', () => {
    expect(bashDeny('ls -la && echo done')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchToolName — MCP server/tool matching
// ---------------------------------------------------------------------------

describe('matchToolName — MCP patterns', () => {
  it('an exact mcp tool name matches itself', () => {
    expect(matchToolName('mcp__github__create_issue', 'mcp__github__create_issue')).toBe(true);
  });
  it('a bare non-mcp rule matches a plain tool by exact name', () => {
    expect(matchToolName('Bash', 'Bash')).toBe(true);
    expect(matchToolName('Bash', 'Read')).toBe(false);
  });
  it('a server-wildcard mcp__server__* pattern matches any tool on that server', () => {
    expect(matchToolName('mcp__github', 'mcp__github__create_issue')).toBe(true);
    expect(matchToolName('mcp__github', 'mcp__gitlab__create_issue')).toBe(false);
  });
  it('an mcp pattern never matches a non-mcp tool', () => {
    expect(matchToolName('mcp__github', 'Bash')).toBe(false);
  });
  it('a non-mcp pattern never matches an mcp tool', () => {
    expect(matchToolName('Bash', 'mcp__github__x')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// path glob specifiers (Read/Edit deny by path)
// ---------------------------------------------------------------------------

describe('path glob deny specifiers', () => {
  const denySecret = parseRule('Read(//etc/**)');
  const readDeny = (file_path: string) => ruleMatches(denySecret, 'Read', { file_path }, 'any');
  it('a trailing ** matches any depth under the prefix', () => {
    expect(readDeny('/etc/secret')).toBe(true);
    expect(readDeny('/etc/a/b/secret')).toBe(true);
  });
  it('a path outside the prefix does not match', () => {
    expect(readDeny('/var/secret')).toBe(false);
  });
});
