import { describe, it } from 'vitest';
import { runWorkflow, parseWorkflowMeta } from '../src/tools/workflow-engine.js';
import type { SpawnSubagentFn } from '../src/internal/contracts.js';

const spawn: SpawnSubagentFn = async (p) => ({
  content: `R:${p.prompt.split('\n')[0]}`,
  isError: false,
  agentId: 'a',
  background: false,
});

function run(script: string, extra: Record<string, unknown> = {}) {
  return runWorkflow({
    script,
    spawnSubagent: spawn,
    signal: new AbortController().signal,
    debug: () => {},
    resolveWorkflow: (n: string) =>
      n === 'child'
        ? `export const meta = { name: 'c', description: 'd' }\nreturn undefined`
        : (() => { throw new Error('unknown workflow: ' + n); })(),
    ...extra,
  });
}

const M = `export const meta = { name: 'p', description: 'd' }\n`;

describe('probe2', () => {
  it('meta parser edge cases', () => {
    const cases: Array<[string, string]> = [
      ['hex', `export const meta = { name: 'n', description: 'd', x: 0xFF }`],
      ['ucode', `export const meta = { name: 'n', description: '\\u{1F600}' }`],
      ['bigint', `export const meta = { name: 'n', description: 'd', x: 10n }`],
      ['sep', `export const meta = { name: 'n', description: 'd', x: 1_000 }`],
      ['inf', `export const meta = { name: 'n', description: 'd', x: 1e999 }`],
      ['dupkey', `export const meta = { name: 'a', name: 'b', description: 'd' }`],
      ['neg', `export const meta = { name: 'n', description: 'd', x: -.5 }`],
      ['octal', `export const meta = { name: 'n', description: 'd', x: 0o17 }`],
      ['unterm', `export const meta = { name: 'n', description: 'd`],
      ['trail-junk', `export const meta = { name: 'n', description: 'd' } garbage(`],
    ];
    for (const [id, s] of cases) {
      const r = parseWorkflowMeta(s);
      console.log(`meta ${id}:`, r.ok ? `OK ${JSON.stringify(r.meta)}` : `ERR ${r.error}`);
    }
  });

  it('workflow child returning undefined', async () => {
    const r = await run(M + `const v = await workflow('child'); return {childWasUndefined: v === undefined}`);
    console.log('child-undef:', JSON.stringify(r).slice(0, 250));
  });

  it('concurrency: in-flight never exceeds cap under slow agents', async () => {
    let inFlight = 0;
    let peak = 0;
    const slowSpawn: SpawnSubagentFn = async (p) => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return { content: 'x', isError: false, agentId: 'a', background: false };
    };
    const r = await runWorkflow({
      script: M + `return await parallel(Array.from({length: 12}, (_,i) => () => agent('p'+i)))`,
      spawnSubagent: slowSpawn,
      signal: new AbortController().signal,
      debug: () => {},
      limits: { maxConcurrentAgents: 3 },
    });
    console.log('concurrency peak:', peak, 'ok:', (r as any).ok, 'live:', (r as any).agentsLive);
  });

  it('resume: 3 mixed entries occurrence matching', async () => {
    // run 1: two calls same prompt -> two completed journal entries same hash
    const r1 = await run(M + `const a = await agent('same'); const b = await agent('same'); return [a,b]`);
    const j = (r1 as any).journal;
    console.log('run1 journal hashes:', j.map((e: any) => e.hash.slice(0, 12) + ':' + e.completed));
    // run 2: resume, same script -> both cached
    const r2 = await run(M + `const a = await agent('same'); const b = await agent('same'); return [a,b]`, { resumeJournal: j });
    console.log('run2 cached:', (r2 as any).agentsCached, 'live:', (r2 as any).agentsLive);
  });

  it('abort mid-pipeline stage', async () => {
    const ac = new AbortController();
    const slowSpawn: SpawnSubagentFn = async (p) => {
      ac.abort();
      return { content: 'x', isError: false, agentId: 'a', background: false };
    };
    const r = await runWorkflow({
      script: M + `return await pipeline([1,2,3], () => agent('go'), (prev)=> 'stage2:'+prev)`,
      spawnSubagent: slowSpawn,
      signal: ac.signal,
      debug: () => {},
    }).catch((e) => ({ threw: String(e && (e as any).name) }));
    console.log('abort-pipeline:', JSON.stringify(r).slice(0, 250));
  });
});
