/**
 * Mutation-kill tests, permissions round 2 (survivor triage of the 92.87%
 * round). Each test targets a named survivor; the ones we could not
 * distinguish behaviorally are documented as equivalent/parked at the bottom.
 */

import { describe, expect, it } from 'vitest';
import { DefaultPermissionGate } from '../src/permissions/gate.js';
import type { PermissionUpdate } from '../src/types.js';

function checkOpts(readOnly = false, extra: Record<string, unknown> = {}) {
  return {
    toolUseID: 'tu_kill2',
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
const removeRules = (
  behavior: 'allow' | 'deny' | 'ask',
  rules: Array<{ toolName: string; ruleContent?: string }>,
): PermissionUpdate => ({ type: 'removeRules', rules, behavior, destination: 'session' });

describe('sameRule compares BOTH tool name and specifier (gate.ts:82)', () => {
  it('removing Bash(x:*) keeps Read(x:*) - same specifier, different tool', async () => {
    const gate = makeGate();
    gate.applyUpdates([
      addRules('deny', [
        { toolName: 'Bash', ruleContent: 'git:*' },
        { toolName: 'Read', ruleContent: 'git:*' },
      ]),
    ]);
    expect((await gate.check('Read', { file_path: 'git' }, checkOpts(true))).decision).toBe('deny');
    gate.applyUpdates([removeRules('deny', [{ toolName: 'Bash', ruleContent: 'git:*' }])]);
    // specifier-only comparison would have removed the Read rule too
    expect((await gate.check('Read', { file_path: 'git' }, checkOpts(true))).decision).toBe('deny');
    expect((await gate.check('Bash', { command: 'git status' }, checkOpts(true))).decision).toBe('allow');
  });

  it('removeRules with several rules removes each matching rule, none more (some vs every, gate.ts:351)', async () => {
    const gate = makeGate();
    gate.applyUpdates([
      addRules('deny', [
        { toolName: 'Bash', ruleContent: 'git:*' },
        { toolName: 'Bash', ruleContent: 'npm:*' },
        { toolName: 'Bash', ruleContent: 'rm:*' },
      ]),
    ]);
    gate.applyUpdates([
      removeRules('deny', [
        { toolName: 'Bash', ruleContent: 'git:*' },
        { toolName: 'Bash', ruleContent: 'npm:*' },
      ]),
    ]);
    expect((await gate.check('Bash', { command: 'git s' }, checkOpts(true))).decision).toBe('allow');
    expect((await gate.check('Bash', { command: 'npm ci' }, checkOpts(true))).decision).toBe('allow');
    expect((await gate.check('Bash', { command: 'rm x' }, checkOpts(true))).decision).toBe('deny');
  });
});

describe('hook object without a decision must not leak updatedInput (gate.ts:150)', () => {
  it('canUseTool receives the ORIGINAL input when the hook made no decision', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const gate = makeGate({
      canUseTool: async (_t, input) => {
        seen.push(input);
        return { behavior: 'allow', updatedInput: input };
      },
    });
    const res = await gate.check(
      'Bash',
      { command: 'git status' },
      checkOpts(false, { hook: { updatedInput: { command: 'rm -rf /' } } }), // no decision field
    );
    expect(res.decision).toBe('allow');
    expect(seen).toEqual([{ command: 'git status' }]);
  });
});

describe('defer without a reason has NO suffix (gate.ts:162 false-arm literal)', () => {
  it('message is exactly the base sentence', async () => {
    const gate = makeGate();
    const res = await gate.check(
      'Write',
      { file_path: '/tmp/a', content: 'x' },
      checkOpts(false, { hook: { decision: 'defer' } }),
    );
    expect(res.decision).toBe('defer');
    if (res.decision !== 'defer') throw new Error('unreachable');
    expect(res.message).toBe('Tool "Write" was deferred by a PreToolUse hook');
  });
});

describe('plan mode without a handler (gate.ts:217 case guard)', () => {
  it('read-only allows; a write falls to the default-policy deny (no handler)', async () => {
    const gate = makeGate({ mode: 'plan' });
    expect((await gate.check('Read', { file_path: '/tmp/a' }, checkOpts(true))).decision).toBe('allow');
    const res = await gate.check('Write', { file_path: '/tmp/a', content: 'x' }, checkOpts(false));
    expect(res.decision).toBe('deny');
    if (res.decision !== 'deny') throw new Error('unreachable');
    expect(res.message).toContain('no canUseTool handler was provided');
  });
});

describe("auto 'prompt' routes PAST a matching allow rule (gate.ts:228)", () => {
  it('the prompt route wins over the step-5 allow rule', async () => {
    let asked = 0;
    const gate = makeGate({
      mode: 'auto',
      allowedTools: ['Write'],
      classifier: () => 'prompt',
      canUseTool: async (_t, input) => {
        asked += 1;
        return { behavior: 'allow', updatedInput: input };
      },
    });
    const res = await gate.check('Write', { file_path: '/tmp/a', content: 'x' }, checkOpts(false));
    expect(res.decision).toBe('allow');
    expect(asked).toBe(1); // NOT auto-allowed by the allow rule
  });
});

describe('AbortError from canUseTool propagates even when the signal is NOT aborted (gate.ts:284)', () => {
  it('rejects AbortError instead of converting to a deny', async () => {
    const gate = makeGate({
      canUseTool: async () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err; // signal stays un-aborted
      },
    });
    await expect(
      gate.check('Write', { file_path: '/tmp/a', content: 'x' }, checkOpts(false)),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('post-allow deny-recheck names its stage (gate.ts:313)', () => {
  it("a handler rewrite into a denied input denies with the 'canUseTool callback' stage", async () => {
    const gate = makeGate({
      disallowedTools: ['Bash(rm:*)'],
      canUseTool: async () => ({ behavior: 'allow', updatedInput: { command: 'rm -rf /tmp/x' } }),
    });
    const res = await gate.check('Bash', { command: 'echo hi && sleep 0' }, checkOpts(false));
    expect(res.decision).toBe('deny');
    if (res.decision !== 'deny') throw new Error('unreachable');
    expect(res.message).toContain('disallowedTools rule');
  });
});

describe('setMode rides applyUpdates (gate.ts:337 case-guard integrity)', () => {
  it('a setMode update changes the live mode and only that (bypass unlocked)', async () => {
    // RP3: escalating to bypassPermissions via applyUpdates now requires the
    // same interlock the public setPermissionMode() enforces. Unlocked here so
    // the case-guard integrity assertion (mode actually changes) still holds.
    const gate = makeGate({ mode: 'default', allowDangerousBypass: true });
    gate.applyUpdates([{ type: 'setMode', mode: 'bypassPermissions', destination: 'session' }]);
    expect(gate.getMode()).toBe('bypassPermissions');
    // bypass now allows a write outright (no handler present)
    expect(
      (await gate.check('Write', { file_path: '/tmp/a', content: 'x' }, checkOpts(false))).decision,
    ).toBe('allow');
  });

  it('a setMode to a non-bypass mode changes the live mode without any interlock', () => {
    const gate = makeGate({ mode: 'default' });
    gate.applyUpdates([{ type: 'setMode', mode: 'plan', destination: 'session' }]);
    expect(gate.getMode()).toBe('plan');
  });
});

describe('directory revocations survive unrelated grants (gate.ts:363)', () => {
  it('adding directory B does not clear the revocation of directory A', () => {
    const gate = makeGate();
    gate.applyUpdates([{ type: 'removeDirectories', directories: ['/tmp/a'], destination: 'session' }]);
    gate.applyUpdates([{ type: 'addDirectories', directories: ['/tmp/b'], destination: 'session' }]);
    expect(gate.removedDirectories()).toEqual(['/tmp/a']);
    expect(gate.addedDirectories()).toEqual(['/tmp/b']);
  });
});

/*
 * Parked as equivalent after triage (ledger for the blind-spot report):
 *  - gate.ts:116/117 junk-rule ArrayDeclaration (unmatchable rule).
 *  - gate.ts:154/162 OptionalChaining on hook?.reason (hook defined on all
 *    reaching paths).
 *  - gate.ts:173 remaining ConditionalExpression/LogicalOperator variants
 *    (redundant re-check yields identical outcomes when eff === input).
 *  - gate.ts:200/445 segmentMode literal '' (only 'all' is distinguished;
 *    any other value takes the same some() path).
 *  - gate.ts:304 sub-expression variants (undefined stays falsy through &&;
 *    an empty updatedPermissions apply is a no-op).
 *  - rules.ts:54/57/82/90 splitMcpName guard variants unreachable through
 *    matchToolName's public entry (pattern prefix already validated);
 *    rules.ts:125 circular-input catch is covered but the {} block mutant
 *    yields undefined implicitly; rules.ts:213 non-Bash tools never pass a
 *    segmentMode; rules.ts:227 anchored regex on an already-trimmed string;
 *    rules.ts:250 field-undefined lookup collapses to the same undefined.
 */
