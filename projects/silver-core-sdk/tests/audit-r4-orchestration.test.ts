/**
 * Audit r4 (2026-07-17) — dynamic-orchestration cluster regression locks
 * (report: Public-Info-Pool/Resource/repo-engineering/
 * silver-core-sdk-bug-audit-r4-20260717.md):
 *
 *  - Z5-1: meta pure-literal parser accepts all legal JS literal forms
 *    (\u{...} / \xNN escapes, hex/octal/binary ints, numeric separators);
 *    BigInt rejected with an explicit JSON-representability message.
 *  - Z5-2: the lifetime-agent backstop is NOT swallowed to null by
 *    parallel()/pipeline() per-item catches — the run fails.
 *  - Z5-3: task metadata round-trips (TaskGet renders it; owner too).
 *  - Z5-4: WeakRef / FinalizationRegistry are determinism-banned in scripts.
 *  - Z1-1: workflow agent() schema extraction is strict — prose-embedded
 *    JSON spans never validate; direct parse and fenced blocks still do.
 *  - R7j-5: circular / BigInt agent() opts fail with a clean typed error,
 *    never a stack overflow or raw serializer TypeError.
 *  - R7s-3: the 100k result truncation never splits a surrogate pair.
 */

import { describe, expect, it } from 'vitest';

import type {
  SpawnSubagentFn,
  SpawnSubagentParams,
  ToolContext,
  ToolResultPayload,
} from '../src/internal/contracts.js';
import { sliceSurrogateSafe } from '../src/internal/text.js';
import { parseWorkflowMeta } from '../src/tools/workflow-engine.js';
import { createWorkflowTool, workflowTool } from '../src/tools/workflow.js';
import { taskCreateTool, taskGetTool, taskUpdateTool } from '../src/tools/task.js';

// ---------------------------------------------------------------------------
// Helpers (tools-workflow.test.ts conventions)
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    cwd: '/tmp',
    additionalDirectories: [],
    env: {},
    signal: new AbortController().signal,
    debug: () => {},
    ...overrides,
  };
}

function makeSpawn(
  handler?: (p: SpawnSubagentParams) => Promise<string> | string,
): { spawn: SpawnSubagentFn; calls: SpawnSubagentParams[] } {
  const calls: SpawnSubagentParams[] = [];
  const spawn: SpawnSubagentFn = async (p) => {
    calls.push(p);
    const content = handler !== undefined ? await handler(p) : `R:${p.prompt.split('\n')[0]}`;
    return { content, isError: false, agentId: `agent_${calls.length}`, background: false };
  };
  return { spawn, calls };
}

function text(r: ToolResultPayload): string {
  return String(r.content);
}

function resultValue(r: ToolResultPayload): unknown {
  const body = text(r).split('--- result ---\n')[1];
  expect(body, `no result section in: ${text(r)}`).toBeDefined();
  return JSON.parse(body!);
}

function meta(name = 'wf'): string {
  return `export const meta = { name: '${name}', description: 'test workflow' }\n`;
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

// ---------------------------------------------------------------------------
// Z5-1: meta literal coverage
// ---------------------------------------------------------------------------

describe('Z5-1: meta pure-literal parser accepts all legal literal forms', () => {
  it('hex / octal / binary integers and numeric separators parse', () => {
    const r = parseWorkflowMeta(
      `export const meta = { name: 'wf', description: 'd', phases: [{` +
        ` title: 'p', hex: 0x10, oct: 0o755, bin: 0b101, sep: 1_000_000, negHex: -0x10 }] }\n` +
        `return 1`,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const phase = (r.meta.phases as Array<Record<string, unknown>>)[0]!;
    expect(phase['hex']).toBe(16);
    expect(phase['oct']).toBe(0o755);
    expect(phase['bin']).toBe(5);
    expect(phase['sep']).toBe(1_000_000);
    expect(phase['negHex']).toBe(-16);
  });

  it('decimal forms with separators and exponents still parse', () => {
    const r = parseWorkflowMeta(
      `export const meta = { name: 'wf', description: 'd', phases: [{` +
        ` title: 'p', a: 1_0.5, b: 1e1_0, c: .5, d: -2.5e-1 }] }\nreturn 1`,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const phase = (r.meta.phases as Array<Record<string, unknown>>)[0]!;
    expect(phase['a']).toBe(10.5);
    expect(phase['b']).toBe(1e10);
    expect(phase['c']).toBe(0.5);
    expect(phase['d']).toBe(-0.25);
  });

  it('\\u{...} code-point and \\xNN escapes parse; line continuation is empty', () => {
    const r = parseWorkflowMeta(
      `export const meta = { name: 'wf', description: '\\u{1F600}\\x41ok\\\n-joined' }\nreturn 1`,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.meta.description).toBe('\u{1F600}Aok-joined');
  });

  it('malformed \\u{...} and \\x escapes still fail', () => {
    for (const bad of ["'\\u{}'", "'\\u{110000}'", "'\\xZZ'", "'\\u{12'"]) {
      const r = parseWorkflowMeta(
        `export const meta = { name: 'wf', description: ${bad} }\nreturn 1`,
      );
      expect(r.ok, `${bad} should be rejected`).toBe(false);
    }
  });

  it('BigInt literals are rejected with an explicit JSON-representability message', () => {
    const r = parseWorkflowMeta(
      `export const meta = { name: 'wf', description: 'd', phases: [{ title: 'p', n: 1n }] }\nreturn 1`,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('BigInt');
    expect(r.error).toContain('JSON-representable');
  });

  it('trailing numeric separators remain illegal', () => {
    const r = parseWorkflowMeta(
      `export const meta = { name: 'wf', description: 'd', phases: [{ title: 'p', n: 1_ }] }\nreturn 1`,
    );
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Z5-2: the lifetime backstop survives the fan-out per-item catches
// ---------------------------------------------------------------------------

describe('Z5-2: lifetime agent cap is not swallowed by fan-out catches', () => {
  it('parallel(): hitting the cap fails the run instead of returning nulls', async () => {
    const { spawn } = makeSpawn();
    const tool = createWorkflowTool({ limits: { maxTotalAgents: 3 } });
    const script = `${meta()}
const r = await parallel(Array.from({length: 6}, (_, i) => () => agent('t' + i)))
return r`;
    const r = await tool.execute({ script }, makeCtx({ spawnSubagent: spawn }));
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('agent limit reached');
  });

  it('pipeline(): hitting the cap fails the run instead of dropping items', async () => {
    const { spawn } = makeSpawn();
    const tool = createWorkflowTool({ limits: { maxTotalAgents: 3 } });
    const script = `${meta()}
const r = await pipeline([1, 2, 3, 4, 5, 6], (x) => agent('t' + x))
return r`;
    const r = await tool.execute({ script }, makeCtx({ spawnSubagent: spawn }));
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('agent limit reached');
  });

  it('ordinary thunk failures still resolve to null (semantics unchanged)', async () => {
    const { spawn } = makeSpawn();
    const script = `${meta()}
const r = await parallel([() => agent('ok'), () => { throw new TypeError('boom') }])
return [r[0] !== null, r[1]]`;
    const r = await workflowTool.execute({ script }, makeCtx({ spawnSubagent: spawn }));
    expect(r.isError).toBeUndefined();
    expect(resultValue(r)).toEqual([true, null]);
  });
});

// ---------------------------------------------------------------------------
// Z5-3: task metadata round-trip
// ---------------------------------------------------------------------------

describe('Z5-3: task metadata and owner are readable back via TaskGet', () => {
  it('TaskCreate metadata surfaces in TaskGet', async () => {
    const ctx = makeCtx();
    await taskCreateTool.execute(
      { subject: 'Fix bug', description: 'details', metadata: { pr: 713, area: 'workflow' } },
      ctx,
    );
    const r = await taskGetTool.execute({ taskId: '1' }, ctx);
    expect(text(r)).toContain('Metadata: {"pr":713,"area":"workflow"}');
  });

  it('TaskUpdate merges (and null-deletes) metadata visibly; owner surfaces too', async () => {
    const ctx = makeCtx();
    await taskCreateTool.execute(
      { subject: 'Fix bug', description: 'details', metadata: { a: 1, b: 2 } },
      ctx,
    );
    await taskUpdateTool.execute(
      { taskId: '1', owner: 'reviewer', metadata: { b: null, c: 3 } },
      ctx,
    );
    const r = await taskGetTool.execute({ taskId: '1' }, ctx);
    expect(text(r)).toContain('Owner: reviewer');
    expect(text(r)).toContain('Metadata: {"a":1,"c":3}');
  });

  it('a task without metadata renders no Metadata line', async () => {
    const ctx = makeCtx();
    await taskCreateTool.execute({ subject: 'Plain', description: 'details' }, ctx);
    const r = await taskGetTool.execute({ taskId: '1' }, ctx);
    expect(text(r)).not.toContain('Metadata:');
    expect(text(r)).not.toContain('Owner:');
  });
});

// ---------------------------------------------------------------------------
// Z5-4: GC-observation determinism bans
// ---------------------------------------------------------------------------

describe('Z5-4: WeakRef / FinalizationRegistry are banned in scripts', () => {
  it('new WeakRef() throws the determinism error', async () => {
    const script = `${meta()}
try { new WeakRef({}) } catch (e) { return e.message }
return 'not thrown'`;
    const r = await workflowTool.execute({ script }, makeCtx());
    expect(resultValue(r)).toContain('WeakRef is unavailable in workflow scripts');
  });

  it('new FinalizationRegistry() throws the determinism error', async () => {
    const script = `${meta()}
try { new FinalizationRegistry(() => {}) } catch (e) { return e.message }
return 'not thrown'`;
    const r = await workflowTool.execute({ script }, makeCtx());
    expect(resultValue(r)).toContain('FinalizationRegistry is unavailable in workflow scripts');
  });
});

// ---------------------------------------------------------------------------
// Z1-1: strict schema extraction for workflow agent()
// ---------------------------------------------------------------------------

describe('Z1-1: agent() schema extraction is strict', () => {
  const schema = { type: 'object', required: ['x'] };

  it('a prose-embedded JSON span no longer validates (yields null)', async () => {
    const { spawn } = makeSpawn(() => 'Sure! The answer is {"x": 1} as requested.');
    const script =
      `${meta()}const a = await agent('p', {schema: ${JSON.stringify(schema)}})\n` +
      `return a === null`;
    const r = await workflowTool.execute({ script }, makeCtx({ spawnSubagent: spawn }));
    expect(r.isError).toBeUndefined();
    expect(resultValue(r)).toBe(true);
  });

  it('a direct JSON reply still validates', async () => {
    const { spawn } = makeSpawn(() => '{"x": 1}');
    const script =
      `${meta()}const a = await agent('p', {schema: ${JSON.stringify(schema)}})\nreturn a`;
    const r = await workflowTool.execute({ script }, makeCtx({ spawnSubagent: spawn }));
    expect(resultValue(r)).toEqual({ x: 1 });
  });

  it('a fenced JSON reply still validates', async () => {
    const { spawn } = makeSpawn(() => 'Here you go:\n```json\n{"x": 2}\n```\nDone.');
    const script =
      `${meta()}const a = await agent('p', {schema: ${JSON.stringify(schema)}})\nreturn a`;
    const r = await workflowTool.execute({ script }, makeCtx({ spawnSubagent: spawn }));
    expect(resultValue(r)).toEqual({ x: 2 });
  });
});

// ---------------------------------------------------------------------------
// R7j-5: hashing/serialization robustness of agent() opts
// ---------------------------------------------------------------------------

describe('R7j-5: circular / BigInt agent() opts fail cleanly', () => {
  it('a circular schema throws a catchable JSON-serializability error', async () => {
    const { spawn } = makeSpawn();
    const script = `${meta()}
const s = { type: 'object' }
s.self = s
try { await agent('p', { schema: s }) } catch (e) { return e.message }
return 'not thrown'`;
    const r = await workflowTool.execute({ script }, makeCtx({ spawnSubagent: spawn }));
    expect(resultValue(r)).toContain('JSON-serializable');
  });

  it('a BigInt-carrying schema throws the same clean error', async () => {
    const { spawn } = makeSpawn();
    const script = `${meta()}
try { await agent('p', { schema: { type: 'object', big: 1n } }) } catch (e) { return e.message }
return 'not thrown'`;
    const r = await workflowTool.execute({ script }, makeCtx({ spawnSubagent: spawn }));
    expect(resultValue(r)).toContain('JSON-serializable');
  });
});

// ---------------------------------------------------------------------------
// R7s-3: surrogate-safe result truncation
// ---------------------------------------------------------------------------

describe('R7s-3: result truncation never splits a surrogate pair', () => {
  it('sliceSurrogateSafe drops a trailing high surrogate at the cut', () => {
    const s = 'ab\u{1F600}';
    expect(sliceSurrogateSafe(s, 3)).toBe('ab'); // cut lands mid-pair
    expect(sliceSurrogateSafe(s, 4)).toBe(s); // clean cut keeps the pair
    expect(LONE_SURROGATE.test(sliceSurrogateSafe(s, 3))).toBe(false);
  });

  it('a >100k result with an emoji straddling the cap truncates cleanly', async () => {
    // JSON serialization of the returned string is `"` + 99998 x's + the
    // emoji, so UTF-16 index 100000 lands between the first emoji's
    // surrogate halves — exactly the bare-slice failure mode.
    const script = `${meta()}return 'x'.repeat(99998) + '\u{1F600}\u{1F600}'`;
    const r = await workflowTool.execute({ script }, makeCtx());
    expect(r.isError).toBeUndefined();
    const body = text(r);
    expect(body).toContain('result truncated at 100000 characters');
    expect(LONE_SURROGATE.test(body)).toBe(false);
  });
});
