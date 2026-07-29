/**
 * Input-shape diagnostics (keeper ruling 2026-07-29, the BPT Edit case).
 *
 * A PreToolUse hook returned a path-only `updatedInput` for Edit; updatedInput
 * REPLACES the input (official semantics, not a merge), so `old_string` /
 * `new_string` silently vanished and every Edit failed with a bare
 * `"old_string" must be a string.` while Read (path-only schema) kept working
 * — indistinguishable, from the transcript, from a flaky tool. Two diagnostics
 * close that gap, NEITHER changing behavior:
 *
 *   1. Edit/Write type-check errors name the ACTUAL received shape (offending
 *      field's kind + input key list) via fsutil.describeInputShape.
 *   2. The permission gate names the rewriting party in the debug log when a
 *      hook / canUseTool updatedInput drops a schema-required key the model
 *      actually sent (gate.check opts.requiredInputKeys, fed by tool-dispatch
 *      from built-in schemas only).
 */

import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { editTool } from '../src/tools/edit.js';
import { writeTool } from '../src/tools/write.js';
import { describeInputShape } from '../src/tools/fsutil.js';
import { DefaultPermissionGate } from '../src/permissions/gate.js';
import type { PermissionCheckResult } from '../src/internal/contracts.js';
import { toolContextIn as makeCtx } from './helpers/tool-context.js';

type CheckOpts = Parameters<DefaultPermissionGate['check']>[2];

function checkOpts(overrides: Partial<CheckOpts> = {}): CheckOpts {
  return {
    toolUseID: 'toolu_shape_1',
    signal: new AbortController().signal,
    readOnly: false,
    isFileEdit: true,
    ...overrides,
  };
}

function asAllow(
  res: PermissionCheckResult,
): Extract<PermissionCheckResult, { decision: 'allow' }> {
  if (res.decision !== 'allow') {
    throw new Error(`expected allow, got ${res.decision}`);
  }
  return res;
}

// ---------------------------------------------------------------------------
// describeInputShape
// ---------------------------------------------------------------------------

describe('describeInputShape', () => {
  it('distinguishes absent / undefined / null / empty string / array / object / primitive', () => {
    expect(describeInputShape({ a: 1 }, 'missing')).toContain('"missing" was absent');
    expect(describeInputShape({ x: undefined }, 'x')).toContain('"x" was undefined');
    expect(describeInputShape({ x: null }, 'x')).toContain('"x" was null');
    expect(describeInputShape({ x: '' }, 'x')).toContain('"x" was an empty string');
    expect(describeInputShape({ x: [1] }, 'x')).toContain('"x" was an array');
    expect(describeInputShape({ x: { y: 1 } }, 'x')).toContain('"x" was an object');
    expect(describeInputShape({ x: 42 }, 'x')).toContain('"x" was of type number');
  });

  it('lists the received keys and elides beyond 10', () => {
    expect(describeInputShape({ file_path: '/a' }, 'old_string')).toContain(
      'received input keys: ["file_path"]',
    );
    const wide: Record<string, unknown> = {};
    for (let i = 0; i < 13; i++) wide[`k${i}`] = i;
    const desc = describeInputShape(wide, 'k0');
    expect(desc).toContain('+3 more');
  });

  it('names keys only, never values (values may hold secrets)', () => {
    const desc = describeInputShape(
      { file_path: '/tmp/x', token: 'hunter2-secret' },
      'old_string',
    );
    expect(desc).not.toContain('hunter2-secret');
    expect(desc).not.toContain('/tmp/x');
  });
});

// ---------------------------------------------------------------------------
// Edit / Write error shape
// ---------------------------------------------------------------------------

describe('Edit/Write type-check errors carry the received shape', () => {
  let sandbox: string;

  beforeEach(async () => {
    sandbox = await mkdtemp(path.join(os.tmpdir(), 'scs-shape-'));
  });

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it('Edit with a path-only input (the BPT case) names the absent field and the key list', async () => {
    const res = await editTool.execute(
      { file_path: path.join(sandbox, 'f.txt') },
      makeCtx(sandbox),
    );
    expect(res.isError).toBe(true);
    // Prefix preserved: hosts matching on the historic message still match.
    expect(res.content).toContain('Edit failed: "old_string" must be a string');
    expect(res.content).toContain('"old_string" was absent');
    expect(res.content).toContain('received input keys: ["file_path"]');
  });

  it('Edit names a wrong-typed old_string (array) instead of just "not a string"', async () => {
    const res = await editTool.execute(
      {
        file_path: path.join(sandbox, 'f.txt'),
        old_string: ['a', 'b'],
        new_string: 'x',
      },
      makeCtx(sandbox),
    );
    expect(res.isError).toBe(true);
    expect(res.content).toContain('"old_string" was an array');
  });

  it('Write with a path-only input names the absent content field', async () => {
    const res = await writeTool.execute(
      { file_path: path.join(sandbox, 'f.txt') },
      makeCtx(sandbox),
    );
    expect(res.isError).toBe(true);
    expect(res.content).toContain('Write failed: "content" must be a string');
    expect(res.content).toContain('"content" was absent');
  });
});

// ---------------------------------------------------------------------------
// Gate dropped-required-key diagnostic
// ---------------------------------------------------------------------------

describe('gate names the party whose updatedInput dropped a required key', () => {
  const EDIT_REQUIRED = ['file_path', 'old_string', 'new_string'] as const;
  const fullInput = {
    file_path: 'D:/x/f.txt',
    old_string: 'before',
    new_string: 'after',
  };

  it('PreToolUse hook replacement that loses old_string/new_string is named in debug', async () => {
    const logs: string[] = [];
    const gate = new DefaultPermissionGate({ debug: (m) => logs.push(m) });
    const res = await gate.check(
      'Edit',
      fullInput,
      checkOpts({
        requiredInputKeys: EDIT_REQUIRED,
        hook: {
          decision: 'allow',
          updatedInput: { file_path: 'D:/x/f.txt' }, // path-only: the BPT bug
        },
      }),
    );
    // Behavior unchanged: the rewrite still wins wholesale.
    expect(asAllow(res).updatedInput).toEqual({ file_path: 'D:/x/f.txt' });
    const warning = logs.find((m) => m.includes('dropped required input key(s)'));
    expect(warning).toBeDefined();
    expect(warning).toContain('PreToolUse hook');
    expect(warning).toContain('"old_string"');
    expect(warning).toContain('"new_string"');
    expect(warning).toContain('REPLACES');
  });

  it('canUseTool replacement that loses a required key is named in debug', async () => {
    const logs: string[] = [];
    const gate = new DefaultPermissionGate({
      debug: (m) => logs.push(m),
      canUseTool: async () => ({
        behavior: 'allow',
        updatedInput: { file_path: 'D:/x/f.txt' },
      }),
    });
    const res = await gate.check(
      'Edit',
      fullInput,
      checkOpts({ requiredInputKeys: EDIT_REQUIRED }),
    );
    expect(asAllow(res).updatedInput).toEqual({ file_path: 'D:/x/f.txt' });
    const warning = logs.find((m) => m.includes('dropped required input key(s)'));
    expect(warning).toBeDefined();
    expect(warning).toContain('canUseTool callback');
    expect(warning).toContain('"old_string"');
  });

  it('a rewrite that preserves every required key stays silent', async () => {
    const logs: string[] = [];
    const gate = new DefaultPermissionGate({ debug: (m) => logs.push(m) });
    const res = await gate.check(
      'Edit',
      fullInput,
      checkOpts({
        requiredInputKeys: EDIT_REQUIRED,
        hook: {
          decision: 'allow',
          updatedInput: { ...fullInput, file_path: 'D:/x/normalized.txt' },
        },
      }),
    );
    expect(asAllow(res).updatedInput['file_path']).toBe('D:/x/normalized.txt');
    expect(logs.find((m) => m.includes('dropped required input key(s)'))).toBeUndefined();
  });

  it('a key the model never sent is not blamed on the rewriter', async () => {
    const logs: string[] = [];
    const gate = new DefaultPermissionGate({ debug: (m) => logs.push(m) });
    const res = await gate.check(
      'Edit',
      { file_path: 'D:/x/f.txt' }, // model itself omitted old_string/new_string
      checkOpts({
        requiredInputKeys: EDIT_REQUIRED,
        hook: { decision: 'allow', updatedInput: { file_path: 'D:/y/f.txt' } },
      }),
    );
    expect(asAllow(res).updatedInput).toEqual({ file_path: 'D:/y/f.txt' });
    expect(logs.find((m) => m.includes('dropped required input key(s)'))).toBeUndefined();
  });

  it('without requiredInputKeys (MCP tools) the diagnostic is skipped entirely', async () => {
    const logs: string[] = [];
    const gate = new DefaultPermissionGate({ debug: (m) => logs.push(m) });
    const res = await gate.check(
      'mcp__srv__edit',
      fullInput,
      checkOpts({
        hook: { decision: 'allow', updatedInput: { file_path: 'D:/x/f.txt' } },
      }),
    );
    expect(asAllow(res).updatedInput).toEqual({ file_path: 'D:/x/f.txt' });
    expect(logs.find((m) => m.includes('dropped required input key(s)'))).toBeUndefined();
  });
});
