/**
 * Audit wave 20 — permissions: a shell-spawning builtin nobody could scope.
 *
 * Monitor runs an arbitrary shell script (`readOnly: false`; its own header
 * says "same permission posture as Bash"), but it was absent from
 * PRIMARY_ARG_FIELD and from the Bash-only decomposition branch. The result was
 * a builtin that spawns a shell and for which NO command-scoped rule existed:
 * a deny the host wrote was silently ignored, and the tool ran anyway.
 */

import { describe, it, expect } from 'vitest';

import {
  parseRule,
  ruleMatches,
  buildPermissionSuggestions,
} from '../src/permissions/rules.js';

const RM = { command: 'rm -rf /' };

describe('wave20: Monitor is a command-primary tool', () => {
  it('a command-scoped deny on Monitor actually fires (was: silently never)', () => {
    // Before the fix primaryArg('Monitor', …) returned undefined, so this
    // returned false and `Monitor({command:'rm -rf /'})` sailed past the gate.
    expect(ruleMatches(parseRule('Monitor(rm:*)'), 'Monitor', RM, 'any')).toBe(true);
  });

  it('a command-scoped allow on Monitor actually fires (was: matched nothing)', () => {
    expect(
      ruleMatches(parseRule('Monitor(npm:*)'), 'Monitor', { command: 'npm run build' }, 'all'),
    ).toBe(true);
  });

  it('the deny still respects the word boundary it enforces for Bash', () => {
    // `Monitor(git:*)` must not swallow `git-crypt`, exactly as for Bash.
    expect(
      ruleMatches(parseRule('Monitor(git:*)'), 'Monitor', { command: 'git-crypt export /s' }, 'any'),
    ).toBe(false);
  });

  it('chained commands are decomposed: an allow does not ride the leading token', () => {
    expect(
      ruleMatches(parseRule('Monitor(git:*)'), 'Monitor', { command: 'git log && rm -rf /' }, 'all'),
    ).toBe(false);
  });

  it('chained commands are decomposed: a deny fires on a non-leading sub-command', () => {
    expect(
      ruleMatches(parseRule('Monitor(rm:*)'), 'Monitor', { command: 'echo hi && rm -rf /' }, 'any'),
    ).toBe(true);
  });

  it('deny-side unwrapping applies too (wrapped / obfuscated command word)', () => {
    expect(
      ruleMatches(parseRule('Monitor(rm:*)'), 'Monitor', { command: 'sudo \\rm -rf /' }, 'any'),
    ).toBe(true);
  });

  it('injection constructs block an allow, as they do for Bash', () => {
    expect(
      ruleMatches(parseRule('Monitor(git:*)'), 'Monitor', { command: 'git log $(rm -rf /)' }, 'all'),
    ).toBe(false);
  });

  it('cross-tool scoping is unchanged: a Bash rule still does not cover Monitor', () => {
    expect(ruleMatches(parseRule('Bash(rm:*)'), 'Monitor', RM, 'any')).toBe(false);
    expect(ruleMatches(parseRule('Monitor(rm:*)'), 'Bash', RM, 'any')).toBe(false);
  });

  it('"remember this" suggests the command-prefix form, not the whole script', () => {
    const rules = buildPermissionSuggestions('Monitor', { command: 'npm run watch --loud' });
    const contents = rules.flatMap((u) =>
      u.type === 'addRules' ? u.rules.map((r) => r.ruleContent) : [],
    );
    expect(contents).toContain('npm:*');
    expect(contents).not.toContain('npm run watch --loud');
  });
});
