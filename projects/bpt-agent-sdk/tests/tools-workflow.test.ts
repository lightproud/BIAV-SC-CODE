/**
 * Workflow tool + engine tests (B4c batch): meta pure-literal validation,
 * agent() over a stubbed spawnSubagent (label/model/isolation/agentType
 * passthrough, schema parsing, effort honestly ignored), parallel barrier +
 * exception->null, pipeline no-barrier + stage-skip semantics, phase()/log()
 * transcript, determinism bans (Date.now / Math.random / argless new Date),
 * concurrency-cap queueing, collection and lifetime caps, script syntax /
 * runtime error surfacing, args passthrough, scriptPath / name resolution,
 * resumeFromRunId prefix caching, workflow() nesting, and registry wiring.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type {
  SpawnSubagentFn,
  SpawnSubagentParams,
  ToolContext,
  ToolResultPayload,
} from '../src/internal/contracts.js';
import {
  defaultWorkflowLimits,
  parseWorkflowMeta,
} from '../src/internal/workflow-engine.js';
import { createWorkflowTool, workflowTool } from '../src/tools/workflow.js';
import { createBuiltinTools } from '../src/tools/index.js';

// ---------------------------------------------------------------------------
// Helpers
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

type SpawnStub = {
  spawn: SpawnSubagentFn;
  calls: SpawnSubagentParams[];
};

/** Default stub: replies `R:<first prompt line>` (the original prompt — the
 *  engine appends its return-value framing after a blank line). */
function makeSpawn(
  handler?: (p: SpawnSubagentParams, calls: SpawnSubagentParams[]) => Promise<string> | string,
): SpawnStub {
  const calls: SpawnSubagentParams[] = [];
  const spawn: SpawnSubagentFn = async (p) => {
    calls.push(p);
    const content =
      handler !== undefined ? await handler(p, calls) : `R:${p.prompt.split('\n')[0]}`;
    return { content, isError: false, agentId: `agent_${calls.length}`, background: false };
  };
  return { spawn, calls };
}

function text(r: ToolResultPayload): string {
  return String(r.content);
}

/** Parse the JSON return value out of a successful tool result. */
function resultValue(r: ToolResultPayload): unknown {
  const body = text(r).split('--- result ---\n')[1];
  expect(body, `no result section in: ${text(r)}`).toBeDefined();
  return JSON.parse(body!);
}

function meta(name = 'wf'): string {
  return `export const meta = { name: '${name}', description: 'test workflow' }\n`;
}

async function waitUntil(cond: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('waitUntil timeout');
    await new Promise((r) => setTimeout(r, 5));
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// meta block: pure-literal validation
// ---------------------------------------------------------------------------

describe('Workflow meta validation', () => {
  it('accepts a pure-literal meta with comments, phases and trailing commas', () => {
    const script = `// leading comment
export const meta = {
  name: 'find-flaky-tests',
  description: 'Find flaky tests and propose fixes',   // one-line
  phases: [
    { title: 'Scan', detail: 'grep test logs for retries' },
    { title: 'Fix' },
  ],
}
return 1`;
    const parsed = parseWorkflowMeta(script);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.meta.name).toBe('find-flaky-tests');
      expect(parsed.meta.phases).toHaveLength(2);
      expect(parsed.body).not.toContain('export');
    }
  });

  it('rejects a script that does not begin with export const meta', async () => {
    const r = await workflowTool.execute({ script: 'return 1' }, makeCtx());
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('syntax check');
    expect(text(r)).toContain('export const meta');
    // Never ran: no runId to resume.
    expect(text(r)).not.toContain('runId:');
  });

  it('rejects computed values, spreads and template literals in meta (pure literal)', () => {
    for (const bad of [
      `export const meta = { name: 'x', description: 'd', n: 1 + 1 }`,
      `export const meta = { name: 'x', description: 'd', ...extra }`,
      `export const meta = { name: \`x\`, description: 'd' }`,
      `export const meta = { name: someVar, description: 'd' }`,
      `export const meta = { name: f(), description: 'd' }`,
    ]) {
      const parsed = parseWorkflowMeta(`${bad}\nreturn 1`);
      expect(parsed.ok, bad).toBe(false);
    }
  });

  it('requires meta.name and meta.description as non-empty strings', () => {
    const noDesc = parseWorkflowMeta(`export const meta = { name: 'x' }\nreturn 1`);
    expect(noDesc.ok).toBe(false);
    if (!noDesc.ok) expect(noDesc.error).toContain('description');
    const noName = parseWorkflowMeta(`export const meta = { description: 'd' }\nreturn 1`);
    expect(noName.ok).toBe(false);
    if (!noName.ok) expect(noName.error).toContain('name');
  });
});

// ---------------------------------------------------------------------------
// agent() over the stubbed subagent runtime
// ---------------------------------------------------------------------------

describe('Workflow agent()', () => {
  it('spawns via ctx.spawnSubagent and returns the final text as a string', async () => {
    const { spawn, calls } = makeSpawn();
    const script = `${meta()}const a = await agent('hello world')\nreturn a`;
    const r = await workflowTool.execute({ script }, makeCtx({ spawnSubagent: spawn }));
    expect(r.isError).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.prompt).toContain('hello world');
    // Subagents are told their final text IS the return value.
    expect(calls[0]!.prompt).toContain('return value');
    expect(calls[0]!.subagentType).toBe('general-purpose');
    expect(calls[0]!.runInBackground).toBe(false);
    expect(resultValue(r)).toBe('R:hello world');
  });

  it('passes label/model/isolation/agentType through and ignores effort with a note', async () => {
    const { spawn, calls } = makeSpawn();
    const script =
      `${meta()}return agent('task', {label: 'L', model: 'haiku', ` +
      `isolation: 'worktree', agentType: 'custom-reviewer', effort: 'low'})`;
    const r = await workflowTool.execute({ script }, makeCtx({ spawnSubagent: spawn }));
    expect(r.isError).toBeUndefined();
    expect(calls[0]!.description).toBe('L');
    expect(calls[0]!.model).toBe('haiku');
    expect(calls[0]!.isolation).toBe('worktree');
    expect(calls[0]!.subagentType).toBe('custom-reviewer');
    // effort has no backing capability: honestly ignored + noted.
    expect(text(r)).toContain('opts.effort ("low") is not supported');
  });

  it('with schema: appends the schema instruction and JSON-parses the reply', async () => {
    const { spawn, calls } = makeSpawn(() => '```json\n{"bugs": ["b1"], "count": 1}\n```');
    const script =
      `${meta()}const r = await agent('find bugs', ` +
      `{schema: {type: 'object', required: ['bugs']}})\nreturn r.bugs`;
    const r = await workflowTool.execute({ script }, makeCtx({ spawnSubagent: spawn }));
    expect(r.isError).toBeUndefined();
    expect(calls[0]!.prompt).toContain('Structured output REQUIRED');
    expect(calls[0]!.prompt).toContain('"required":["bugs"]');
    expect(resultValue(r)).toEqual(['b1']);
  });

  it('with schema: an unparsable or non-conforming reply yields null', async () => {
    const { spawn } = makeSpawn((p) =>
      p.prompt.includes('bad-json') ? 'not json at all' : '{"other": 1}',
    );
    const script =
      `${meta()}const a = await agent('bad-json', {schema: {type: 'object', required: ['x']}})\n` +
      `const b = await agent('missing-key', {schema: {type: 'object', required: ['x']}})\n` +
      `return [a, b]`;
    const r = await workflowTool.execute({ script }, makeCtx({ spawnSubagent: spawn }));
    expect(r.isError).toBeUndefined();
    expect(resultValue(r)).toEqual([null, null]);
  });

  it('a dead agent (spawn isError) returns null instead of rejecting', async () => {
    const calls: SpawnSubagentParams[] = [];
    const spawn: SpawnSubagentFn = async (p) => {
      calls.push(p);
      return { content: 'terminal API error', isError: true, agentId: 'a1', background: false };
    };
    const script = `${meta()}const a = await agent('doomed')\nreturn a === null`;
    const r = await workflowTool.execute({ script }, makeCtx({ spawnSubagent: spawn }));
    expect(r.isError).toBeUndefined();
    expect(resultValue(r)).toBe(true);
  });

  it('reports an honest error when no subagent runtime is wired', async () => {
    const script = `${meta()}return agent('x')`;
    const r = await workflowTool.execute({ script }, makeCtx());
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('subagent runtime not available');
  });

  it('a zero-agent script runs without a subagent runtime', async () => {
    const script = `${meta()}log('pure computation')\nreturn [1, 2, 3].map(x => x * 2)`;
    const r = await workflowTool.execute({ script }, makeCtx());
    expect(r.isError).toBeUndefined();
    expect(resultValue(r)).toEqual([2, 4, 6]);
  });
});

// ---------------------------------------------------------------------------
// parallel(): barrier + exception->null
// ---------------------------------------------------------------------------

describe('Workflow parallel()', () => {
  it('a throwing thunk resolves to null without rejecting the call', async () => {
    const { spawn } = makeSpawn();
    const script = `${meta()}
const r = await parallel([
  () => agent('ok'),
  () => { throw new Error('boom') },
  async () => { throw new Error('boom2') },
])
return r`;
    const r = await workflowTool.execute({ script }, makeCtx({ spawnSubagent: spawn }));
    expect(r.isError).toBeUndefined();
    expect(resultValue(r)).toEqual(['R:ok', null, null]);
    expect(text(r)).toContain('item 1 failed -> null');
  });

  it('is a BARRIER: code after await parallel() waits for every thunk', async () => {
    const gate = deferred();
    let slowSettled = false;
    const { spawn } = makeSpawn(async (p) => {
      if (p.prompt.startsWith('slow')) {
        await gate.promise;
        slowSettled = true;
        return 'R:slow';
      }
      return 'R:fast';
    });
    const debugLines: string[] = [];
    const ctx = makeCtx({ spawnSubagent: spawn, debug: (m) => debugLines.push(m) });
    const tool = createWorkflowTool({ limits: { maxConcurrentAgents: 4 } });
    const script = `${meta()}
const r = await parallel([() => agent('fast'), () => agent('slow')])
log('after-barrier')
return r`;
    const pending = tool.execute({ script }, ctx);
    // fast completes, slow still gated: the barrier must hold.
    await waitUntil(() => debugLines.some((l) => l.includes('[agent#0]') && l.includes('done')));
    await sleep(20);
    expect(debugLines.some((l) => l.includes('after-barrier'))).toBe(false);
    gate.resolve();
    const r = await pending;
    expect(slowSettled).toBe(true);
    expect(resultValue(r)).toEqual(['R:fast', 'R:slow']);
    expect(text(r)).toContain('[log] after-barrier');
  });

  it('rejects more items than the collection cap with an explicit error', async () => {
    const tool = createWorkflowTool({ limits: { maxCollectionItems: 5 } });
    const { spawn } = makeSpawn();
    const script = `${meta()}
return parallel(Array.from({length: 6}, (_, i) => () => agent('t' + i)))`;
    const r = await tool.execute({ script }, makeCtx({ spawnSubagent: spawn }));
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('parallel() accepts at most 5 items; got 6');
  });
});

// ---------------------------------------------------------------------------
// pipeline(): no barrier, (prev, originalItem, index), stage-skip on throw
// ---------------------------------------------------------------------------

describe('Workflow pipeline()', () => {
  it('stage callbacks receive (prevResult, originalItem, index)', async () => {
    const { spawn } = makeSpawn();
    const script = `${meta()}
const r = await pipeline(['A', 'B'],
  (item) => agent('stage1:' + item),
  (prev, orig, i) => prev + '|' + orig + '|' + i,
)
return r`;
    const r = await workflowTool.execute({ script }, makeCtx({ spawnSubagent: spawn }));
    expect(r.isError).toBeUndefined();
    expect(resultValue(r)).toEqual(['R:stage1:A|A|0', 'R:stage1:B|B|1']);
  });

  it('has NO barrier between stages: item A reaches stage 2 while item B is in stage 1', async () => {
    const gate = deferred();
    const { spawn } = makeSpawn(async (p) => {
      if (p.prompt.startsWith('stage1:B')) {
        await gate.promise;
        return 'R:B1';
      }
      return 'R:A1';
    });
    const debugLines: string[] = [];
    const ctx = makeCtx({ spawnSubagent: spawn, debug: (m) => debugLines.push(m) });
    const tool = createWorkflowTool({ limits: { maxConcurrentAgents: 4 } });
    const script = `${meta()}
const r = await pipeline(['A', 'B'],
  (item) => agent('stage1:' + item),
  (prev, orig) => { log('stage2:' + orig); return prev + '!' },
)
return r`;
    const pending = tool.execute({ script }, ctx);
    // A's stage 2 runs while B's stage 1 is still gated.
    await waitUntil(() => debugLines.some((l) => l.includes('stage2:A')));
    expect(debugLines.some((l) => l.includes('stage2:B'))).toBe(false);
    gate.resolve();
    const r = await pending;
    expect(resultValue(r)).toEqual(['R:A1!', 'R:B1!']);
  });

  it('a throwing stage drops the item to null and skips its remaining stages', async () => {
    const { spawn } = makeSpawn();
    const script = `${meta()}
const r = await pipeline(['good', 'bad'],
  (item) => { if (item === 'bad') throw new Error('stage1 boom'); return item },
  (prev) => { log('stage2:' + prev); return agent('s2:' + prev) },
)
return r`;
    const r = await workflowTool.execute({ script }, makeCtx({ spawnSubagent: spawn }));
    expect(r.isError).toBeUndefined();
    expect(resultValue(r)).toEqual(['R:s2:good', null]);
    expect(text(r)).toContain('item 1 dropped at stage 0');
    expect(text(r)).not.toContain('stage2:bad');
  });

  it('rejects more items than the collection cap with an explicit error', async () => {
    const tool = createWorkflowTool({ limits: { maxCollectionItems: 5 } });
    const script = `${meta()}
return pipeline(Array.from({length: 6}, (_, i) => i), (x) => x)`;
    const r = await tool.execute({ script }, makeCtx());
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('pipeline() accepts at most 5 items; got 6');
  });
});

// ---------------------------------------------------------------------------
// phase() / log() / args / budget
// ---------------------------------------------------------------------------

describe('Workflow phase/log/args/budget', () => {
  it('phase() and log() land in the progress transcript of the tool result', async () => {
    const script = `${meta()}
phase('Scan')
log('found 3 candidates')
phase('Fix')
return 'done'`;
    const r = await workflowTool.execute({ script }, makeCtx());
    expect(r.isError).toBeUndefined();
    const out = text(r);
    expect(out).toContain('=== phase: Scan ===');
    expect(out).toContain('[log] found 3 candidates');
    expect(out).toContain('=== phase: Fix ===');
    expect(out.indexOf('=== phase: Scan ===')).toBeLessThan(out.indexOf('[log] found 3'));
  });

  it('exposes args verbatim as a real JSON value (not a string)', async () => {
    const script = `${meta()}return args.files.map(f => f + '!').concat([args.n + 1])`;
    const r = await workflowTool.execute(
      { script, args: { files: ['a.ts', 'b.ts'], n: 41 } },
      makeCtx(),
    );
    expect(resultValue(r)).toEqual(['a.ts!', 'b.ts!', 42]);
  });

  it('args is undefined when not provided', async () => {
    const script = `${meta()}return typeof args`;
    const r = await workflowTool.execute({ script }, makeCtx());
    expect(resultValue(r)).toBe('undefined');
  });

  it('budget is the honest null stub: total null, spent 0, remaining Infinity', async () => {
    const script = `${meta()}
return [budget.total, budget.spent(), budget.remaining() === Infinity]`;
    const r = await workflowTool.execute({ script }, makeCtx());
    expect(resultValue(r)).toEqual([null, 0, true]);
  });
});

// ---------------------------------------------------------------------------
// Determinism bans + restricted environment
// ---------------------------------------------------------------------------

describe('Workflow script environment', () => {
  it('Date.now / Math.random / argless new Date / Date() throw; dated Date works', async () => {
    const script = `${meta()}
const errs = []
try { Date.now() } catch (e) { errs.push(e.message) }
try { Math.random() } catch (e) { errs.push(e.message) }
try { new Date() } catch (e) { errs.push(e.message) }
try { Date() } catch (e) { errs.push(e.message) }
return { errs, epoch: new Date(0).getTime() }`;
    const r = await workflowTool.execute({ script }, makeCtx());
    expect(r.isError).toBeUndefined();
    const v = resultValue(r) as { errs: string[]; epoch: number };
    expect(v.errs).toHaveLength(4);
    for (const msg of v.errs) {
      expect(msg).toContain('unavailable in workflow scripts');
      expect(msg).toContain('resume');
    }
    expect(v.epoch).toBe(0);
  });

  it('has no process / require / fs globals (typeof-safe undefined)', async () => {
    const script = `${meta()}return [typeof process, typeof require, typeof globalThis.fs]`;
    const r = await workflowTool.execute({ script }, makeCtx());
    expect(resultValue(r)).toEqual(['undefined', 'undefined', 'undefined']);
  });

  it('surfaces a script runtime error with the progress so far (isError)', async () => {
    const script = `${meta()}
log('before the crash')
throw new Error('midway failure')`;
    const r = await workflowTool.execute({ script }, makeCtx());
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('midway failure');
    expect(text(r)).toContain('[log] before the crash');
    // The run started: a runId is minted so a fixed script can resume.
    expect(text(r)).toContain('runId: wf-run-');
  });

  it('surfaces a body syntax error as a failed syntax check that never ran', async () => {
    const script = `${meta()}const x = ;`;
    const r = await workflowTool.execute({ script }, makeCtx());
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('syntax check');
  });
});

// ---------------------------------------------------------------------------
// Caps: concurrency queueing + lifetime backstop + official defaults
// ---------------------------------------------------------------------------

describe('Workflow caps', () => {
  it('default limits are the official numbers: min(16, cores-2), 1000, 4096', () => {
    const limits = defaultWorkflowLimits();
    expect(limits.maxTotalAgents).toBe(1000);
    expect(limits.maxCollectionItems).toBe(4096);
    expect(limits.maxConcurrentAgents).toBeGreaterThanOrEqual(1);
    expect(limits.maxConcurrentAgents).toBeLessThanOrEqual(16);
  });

  it('queues concurrent agent() calls above the cap (in-flight never exceeds it)', async () => {
    let inflight = 0;
    let maxInflight = 0;
    const { spawn } = makeSpawn(async () => {
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      await sleep(15);
      inflight -= 1;
      return 'R';
    });
    const tool = createWorkflowTool({ limits: { maxConcurrentAgents: 2 } });
    const script = `${meta()}
const r = await parallel(Array.from({length: 6}, (_, i) => () => agent('t' + i)))
return r.length`;
    const r = await tool.execute({ script }, makeCtx({ spawnSubagent: spawn }));
    expect(r.isError).toBeUndefined();
    expect(resultValue(r)).toBe(6); // all 6 complete...
    expect(maxInflight).toBe(2); // ...but only 2 ever run at once
  });

  it('throws once the lifetime agent cap is reached (runaway backstop)', async () => {
    const { spawn, calls } = makeSpawn();
    const tool = createWorkflowTool({ limits: { maxTotalAgents: 3 } });
    const script = `${meta()}
for (let i = 0; i < 5; i++) { await agent('x' + i) }
return 'unreachable'`;
    const r = await tool.execute({ script }, makeCtx({ spawnSubagent: spawn }));
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('agent limit reached');
    expect(calls).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Input surface: script/name/scriptPath/resumeFromRunId
// ---------------------------------------------------------------------------

describe('Workflow input resolution', () => {
  it('requires at least one of script, name, scriptPath', async () => {
    const r = await workflowTool.execute({}, makeCtx());
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('at least one of "script", "name", or "scriptPath"');
  });

  it('runs a script from scriptPath and reports that path back', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-test-'));
    const p = join(dir, 'my.workflow.mjs');
    writeFileSync(p, `${meta('from-disk')}return 'ran from disk'`, 'utf8');
    const r = await workflowTool.execute({ scriptPath: p }, makeCtx());
    expect(r.isError).toBeUndefined();
    expect(resultValue(r)).toBe('ran from disk');
    expect(text(r)).toContain(`scriptPath: ${p}`);
  });

  it('errors on an unreadable scriptPath', async () => {
    const r = await workflowTool.execute(
      { scriptPath: '/nonexistent/nope.mjs' },
      makeCtx(),
    );
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('could not read workflow script');
  });

  it('persists an inline script and reports the persisted path for iteration', async () => {
    const script = `${meta()}return 1`;
    const r = await workflowTool.execute({ script }, makeCtx());
    expect(r.isError).toBeUndefined();
    const m = /scriptPath: (\S+)/.exec(text(r));
    expect(m).not.toBeNull();
    // The persisted file re-runs via scriptPath (the official iteration loop).
    const again = await workflowTool.execute({ scriptPath: m![1]! }, makeCtx());
    expect(resultValue(again)).toBe(1);
  });

  it('resolves a saved workflow by name from .claude/workflows/ under cwd', async () => {
    const base = mkdtempSync(join(tmpdir(), 'wf-named-'));
    const dir = join(base, '.claude', 'workflows');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'myflow.mjs'), `${meta('myflow')}return 'named!'`, 'utf8');
    const r = await workflowTool.execute({ name: 'myflow' }, makeCtx({ cwd: base }));
    expect(r.isError).toBeUndefined();
    expect(resultValue(r)).toBe('named!');
  });

  it('errors honestly on an unknown workflow name (no built-ins ship)', async () => {
    const base = mkdtempSync(join(tmpdir(), 'wf-noname-'));
    const r = await workflowTool.execute({ name: 'ghost' }, makeCtx({ cwd: base }));
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('unknown workflow "ghost"');
    expect(text(r)).toContain('no built-in named workflows');
  });
});

// ---------------------------------------------------------------------------
// Resume: same-session prefix cache
// ---------------------------------------------------------------------------

describe('Workflow resume (resumeFromRunId)', () => {
  const twoAgentScript = `${meta('resumable')}
const a = await agent('one')
const b = await agent('two')
return [a, b]`;

  it('replays an unchanged run 100% from cache (zero new spawns)', async () => {
    const { spawn, calls } = makeSpawn();
    const ctx = makeCtx({ spawnSubagent: spawn });
    const first = await workflowTool.execute({ script: twoAgentScript }, ctx);
    expect(calls).toHaveLength(2);
    const runId = /runId: (wf-run-\d+)/.exec(text(first))![1]!;
    const second = await workflowTool.execute(
      { script: twoAgentScript, resumeFromRunId: runId },
      ctx,
    );
    expect(calls).toHaveLength(2); // nothing ran live
    expect(text(second)).toContain('0 run live, 2 from cache');
    expect(resultValue(second)).toEqual(['R:one', 'R:two']);
  });

  it('runs live from the first changed call (longest unchanged prefix)', async () => {
    const { spawn, calls } = makeSpawn();
    const ctx = makeCtx({ spawnSubagent: spawn });
    const first = await workflowTool.execute({ script: twoAgentScript }, ctx);
    const runId = /runId: (wf-run-\d+)/.exec(text(first))![1]!;
    const edited = `${meta('resumable')}
const a = await agent('one')
const b = await agent('two-EDITED')
return [a, b]`;
    const second = await workflowTool.execute(
      { script: edited, resumeFromRunId: runId },
      ctx,
    );
    expect(calls).toHaveLength(3); // only the edited call ran live
    expect(text(second)).toContain('1 run live, 1 from cache');
    expect(resultValue(second)).toEqual(['R:one', 'R:two-EDITED']);
  });

  it('re-runs a call that previously returned null without breaking the prefix', async () => {
    let failDead = true;
    const calls: SpawnSubagentParams[] = [];
    const spawn: SpawnSubagentFn = async (p) => {
      calls.push(p);
      if (p.prompt.startsWith('dead') && failDead) {
        return { content: 'terminal error', isError: true, agentId: 'x', background: false };
      }
      return {
        content: `R:${p.prompt.split('\n')[0]}`,
        isError: false,
        agentId: 'x',
        background: false,
      };
    };
    const script = `${meta('retry')}
const a = await agent('ok')
const b = await agent('dead')
return [a, b]`;
    const ctx = makeCtx({ spawnSubagent: spawn });
    const first = await workflowTool.execute({ script }, ctx);
    expect(resultValue(first)).toEqual(['R:ok', null]);
    const runId = /runId: (wf-run-\d+)/.exec(text(first))![1]!;
    failDead = false;
    const second = await workflowTool.execute({ script, resumeFromRunId: runId }, ctx);
    expect(resultValue(second)).toEqual(['R:ok', 'R:dead']); // dead re-ran live
    expect(text(second)).toContain('1 run live, 1 from cache'); // ok stayed cached
    expect(calls).toHaveLength(3);
  });

  it('rejects an unknown runId (resume is same-session only)', async () => {
    const r = await workflowTool.execute(
      { script: `${meta()}return 1`, resumeFromRunId: 'wf-run-999' },
      makeCtx(),
    );
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('unknown run ID');
    expect(text(r)).toContain('same session only');
  });
});

// ---------------------------------------------------------------------------
// workflow() nesting
// ---------------------------------------------------------------------------

describe('Workflow workflow() hook', () => {
  function namedSetup(children: Record<string, string>): string {
    const base = mkdtempSync(join(tmpdir(), 'wf-nest-'));
    const dir = join(base, '.claude', 'workflows');
    mkdirSync(dir, { recursive: true });
    for (const [name, body] of Object.entries(children)) {
      writeFileSync(join(dir, `${name}.mjs`), body, 'utf8');
    }
    return base;
  }

  it('runs a named child inline, passing args and returning its value', async () => {
    const base = namedSetup({
      child: `export const meta = { name: 'child', description: 'c' }\nreturn args.x * 2`,
    });
    const script = `${meta('parent')}
const doubled = await workflow('child', {x: 21})
return doubled`;
    const r = await workflowTool.execute({ script }, makeCtx({ cwd: base }));
    expect(r.isError).toBeUndefined();
    expect(resultValue(r)).toBe(42);
    expect(text(r)).toContain('child "child" completed');
  });

  it('limits nesting to one level: workflow() inside a child throws (catchable)', async () => {
    const base = namedSetup({
      child: `export const meta = { name: 'child', description: 'c' }\nreturn workflow('grandchild')`,
      grandchild: `export const meta = { name: 'gc', description: 'g' }\nreturn 1`,
    });
    const script = `${meta('parent')}
try { await workflow('child'); return 'no-throw' }
catch (e) { return 'caught: ' + e.message }`;
    const r = await workflowTool.execute({ script }, makeCtx({ cwd: base }));
    expect(r.isError).toBeUndefined();
    expect(resultValue(r)).toContain('caught:');
    expect(resultValue(r)).toContain('one level');
  });

  it('throws on an unknown child name and on a child syntax error (catchable)', async () => {
    const base = namedSetup({
      broken: `export const meta = { name: 'broken', description: 'b' }\nconst x = ;`,
    });
    const script = `${meta('parent')}
const out = []
try { await workflow('ghost') } catch (e) { out.push('name:' + /unknown workflow/.test(e.message)) }
try { await workflow('broken') } catch (e) { out.push('syntax:' + /syntax/.test(e.message)) }
return out`;
    const r = await workflowTool.execute({ script }, makeCtx({ cwd: base }));
    expect(r.isError).toBeUndefined();
    expect(resultValue(r)).toEqual(['name:true', 'syntax:true']);
  });
});

// ---------------------------------------------------------------------------
// Registry wiring
// ---------------------------------------------------------------------------

describe('Workflow registration', () => {
  it('ships by default in the built-in registry with the official input fields', () => {
    const tools = createBuiltinTools({ env: {} });
    const wf = tools.get('Workflow');
    expect(wf).toBeDefined();
    expect(wf!.readOnly).toBe(false);
    const props = Object.keys(
      (wf!.inputSchema as { properties: Record<string, unknown> }).properties,
    );
    // The five documented fields plus the two display params (title /
    // description) the official CLI carries on the wire (conformance
    // wire-reference.json) — params byte-match the official reference.
    expect(props.sort()).toEqual([
      'args',
      'description',
      'name',
      'resumeFromRunId',
      'script',
      'scriptPath',
      'title',
    ]);
    // Officially "at least one of script/name/scriptPath" — runtime-enforced,
    // so no field is schema-required.
    expect((wf!.inputSchema as { required?: string[] }).required).toEqual([]);
  });

  it('serializes the script return value as JSON in the tool result', async () => {
    const script = `${meta()}return { confirmed: [{file: 'a.ts', real: true}], count: 1 }`;
    const r = await workflowTool.execute({ script }, makeCtx());
    expect(resultValue(r)).toEqual({ confirmed: [{ file: 'a.ts', real: true }], count: 1 });
    expect(text(r)).toContain('Workflow completed: wf');
    expect(text(r)).toContain('summary: test workflow');
  });

  it('title/description inputs (official wire params) override the run labels', async () => {
    const script = `${meta()}return 1`;
    const r = await workflowTool.execute(
      { script, title: 'My Run', description: 'one-line summary' },
      makeCtx(),
    );
    expect(text(r)).toContain('Workflow completed: My Run');
    expect(text(r)).toContain('summary: one-line summary');
  });
});
