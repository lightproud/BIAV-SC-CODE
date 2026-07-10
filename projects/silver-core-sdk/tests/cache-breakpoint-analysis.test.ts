/**
 * E7-03 offline quantitative analysis + KD premise lock: the tool-block
 * cache_control breakpoint (official sends 0 on tools; we send 1).
 *
 * Keyless. Drives OUR arm against the capturing emulator (the same harness
 * as conformance-wire.test.ts), takes the REAL request bodies, and replays
 * them through a prompt-cache simulator under two strategies:
 *   A = as shipped (breakpoint on the last tool block),
 *   B = official-aligned (tool breakpoint stripped; everything else equal).
 *
 * Simulator semantics (per the public prompt-caching contract, also quoted
 * in src/engine/cache-control.ts): a prefix is WRITTEN to cache only at a
 * request's breakpoint positions; a later request READS the longest cached
 * prefix that byte-matches at one of ITS breakpoint positions.
 *
 * Measured conclusion (2026-07-05, real captured bodies, bytes of cacheable
 * prefix hit):
 *   1. same-session multi-turn:            A == B (the system/message
 *      breakpoints already cover the tools prefix - a longer hit wins);
 *   2. new session, same project/cwd:      A == B (system breakpoint covers
 *      tools + stable system);
 *   3. new session, different cwd:         A == B (stable-block breakpoint
 *      still covers tools);
 *   4. same tools, DIFFERENT system:       A > B by exactly the serialized
 *      tools payload - only the tool breakpoint can salvage the tools prefix
 *      when the system diverges (custom systemPrompt consumers, and the
 *      shape subagent presets take: shared tool defs, different prompt).
 *
 * So dropping the breakpoint never gains cache hits and strictly loses them
 * in scenario 4 => E7-03 is registered as a deliberate KD (kept divergence)
 * in src/engine/cache-control.ts, and `WIRE_ALIGNMENT_GAPS` keeps its
 * `toolCacheBreakpoints` entries. These tests lock the premise: if the
 * numbers ever stop holding (e.g. request shaping changes), the KD must be
 * re-examined.
 */

import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { query, type Query } from '../src/index.js';
// @ts-expect-error - plain-JS conformance module without type declarations
import { startEmulator, textReply, toolUseReply } from './conformance/emulator.mjs';

const DUMMY_KEY = 'sk-ant-api03-' + 'A'.repeat(95);

let cwds: string[] = [];
async function freshCwd(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cache-bp-'));
  cwds.push(dir);
  return dir;
}
beforeEach(() => {
  cwds = [];
});
afterEach(async () => {
  await Promise.all(cwds.map((d) => rm(d, { recursive: true, force: true })));
});

// ---------------------------------------------------------------------------
// Capture: run our arm, return raw request bodies
// ---------------------------------------------------------------------------

type Body = Record<string, unknown>;

async function capture(
  cwd: string,
  opts: { multiTurn?: boolean; systemPrompt?: unknown } = {},
): Promise<Body[]> {
  await mkdir(join(cwd, '.sessions'), { recursive: true });
  await writeFile(join(cwd, 'wire.txt'), 'cache breakpoint fixture\n');
  const scripts = opts.multiTurn
    ? [
        {
          kind: 'sse',
          events: toolUseReply([{ name: 'Read', input: { file_path: `${cwd}/wire.txt` } }]),
        },
        { kind: 'sse', events: textReply('DONE') },
      ]
    : [{ kind: 'sse', events: textReply('OK') }];
  const emulator = await startEmulator(scripts, { captureBodies: true });
  try {
    const q: Query = query({
      prompt: opts.multiTurn ? 'Read wire.txt then say done.' : 'Say OK.',
      options: {
        cwd,
        maxTurns: 3,
        sessionDir: join(cwd, '.sessions'),
        sandbox: false,
        systemPrompt: opts.systemPrompt ?? { type: 'preset', preset: 'claude_code' },
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          ANTHROPIC_BASE_URL: emulator.url as string,
          ANTHROPIC_API_KEY: DUMMY_KEY,
        },
      } as never,
    });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of q) void _;
  } finally {
    await emulator.close();
  }
  return emulator.profile.requestBodies as Body[];
}

// ---------------------------------------------------------------------------
// Simulator: request body -> ordered segments with breakpoint flags
// ---------------------------------------------------------------------------

type Seg = { text: string; bp: boolean };

function blockSeg(raw: unknown, extra = ''): Seg {
  const { cache_control, ...rest } = raw as Record<string, unknown>;
  return { text: extra + JSON.stringify(rest), bp: cache_control !== undefined };
}

/** Flatten one request into the prefix stream the cache matches on. */
function segmentsOf(body: Body): { segs: Seg[]; toolCount: number } {
  const segs: Seg[] = [];
  const tools = Array.isArray(body.tools) ? body.tools : [];
  for (const t of tools) segs.push(blockSeg(t));
  const system = body.system;
  if (typeof system === 'string') {
    segs.push({ text: system, bp: false });
  } else if (Array.isArray(system)) {
    for (const b of system) segs.push(blockSeg(b));
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  for (const m of messages as Array<Record<string, unknown>>) {
    if (typeof m.content === 'string') {
      segs.push({ text: JSON.stringify({ role: m.role, content: m.content }), bp: false });
    } else if (Array.isArray(m.content)) {
      m.content.forEach((b: unknown, i: number) =>
        segs.push(blockSeg(b, i === 0 ? `role:${String(m.role)};` : '')),
      );
    }
  }
  return { segs, toolCount: tools.length };
}

/** Strategy B: same request, tool-block breakpoints stripped. */
function stripToolBreakpoints({ segs, toolCount }: { segs: Seg[]; toolCount: number }): Seg[] {
  return segs.map((s, i) => (i < toolCount ? { ...s, bp: false } : s));
}

/**
 * Replay a sequence of requests against an empty cache; returns total bytes
 * read from cache (the cache-hit payoff) across the sequence.
 */
function simulate(requests: Seg[][]): { readBytes: number; writeBytes: number } {
  const cache = new Set<string>();
  let readBytes = 0;
  let writeBytes = 0;
  for (const segs of requests) {
    // Cumulative prefixes at this request's breakpoint positions.
    const prefixes: string[] = [];
    let acc = '';
    for (const seg of segs) {
      acc += seg.text;
      if (seg.bp) prefixes.push(acc);
    }
    let hit = 0;
    for (const p of prefixes) if (cache.has(p)) hit = Math.max(hit, p.length);
    readBytes += hit;
    const last = prefixes.length > 0 ? prefixes[prefixes.length - 1].length : 0;
    if (last > hit) writeBytes += last - hit;
    for (const p of prefixes) cache.add(p);
  }
  return { readBytes, writeBytes };
}

function compare(bodies: Body[][]): {
  a: { readBytes: number; writeBytes: number };
  b: { readBytes: number; writeBytes: number };
  toolsPayloadBytes: number;
} {
  const flat = bodies.flat();
  const a = simulate(flat.map((b) => segmentsOf(b).segs));
  const b = simulate(flat.map((body) => stripToolBreakpoints(segmentsOf(body))));
  const first = segmentsOf(flat[0]);
  const toolsPayloadBytes = first.segs
    .slice(0, first.toolCount)
    .reduce((n, s) => n + s.text.length, 0);
  return { a, b, toolsPayloadBytes };
}

// ---------------------------------------------------------------------------
// The four scenario traces
// ---------------------------------------------------------------------------

describe('E7-03: tool-block cache breakpoint - offline strategy comparison', () => {
  it('sanity: our arm sends exactly one tool breakpoint and <= 4 total', async () => {
    const bodies = await capture(await freshCwd());
    const { segs, toolCount } = segmentsOf(bodies[0]);
    const toolBps = segs.slice(0, toolCount).filter((s) => s.bp).length;
    expect(toolCount).toBeGreaterThan(3);
    expect(toolBps).toBe(1);
    expect(segs.filter((s) => s.bp).length).toBeLessThanOrEqual(4);
  });

  it('same-session multi-turn: stripping the tool breakpoint changes nothing', async () => {
    const bodies = await capture(await freshCwd(), { multiTurn: true });
    expect(bodies.length).toBeGreaterThanOrEqual(2);
    const { a, b } = compare([bodies]);
    expect(a.readBytes).toBe(b.readBytes);
    expect(a.readBytes).toBeGreaterThan(0); // turn 2 reuses turn 1's prefix
  });

  it('new session, same cwd: changes nothing', async () => {
    const cwd = await freshCwd();
    const run1 = await capture(cwd);
    const run2 = await capture(cwd);
    const { a, b } = compare([run1, run2]);
    expect(a.readBytes).toBe(b.readBytes);
    expect(a.readBytes).toBeGreaterThan(0); // run 2 reuses run 1's stable prefix
  });

  it('new session, different cwd: changes nothing (stable-block breakpoint covers tools)', async () => {
    const run1 = await capture(await freshCwd());
    const run2 = await capture(await freshCwd());
    const { a, b } = compare([run1, run2]);
    expect(a.readBytes).toBe(b.readBytes);
    expect(a.readBytes).toBeGreaterThan(0);
  });

  it('same tools, different system: ONLY the tool breakpoint salvages the tools prefix', async () => {
    const cwd = await freshCwd();
    const preset = await capture(cwd);
    const custom = await capture(cwd, {
      systemPrompt: 'You are a terse pirate. Answer in one word.',
    });
    const { a, b, toolsPayloadBytes } = compare([preset, custom]);
    // Strategy A reads the serialized tools payload on the divergent request;
    // strategy B reads nothing there.
    expect(a.readBytes - b.readBytes).toBe(toolsPayloadBytes);
    expect(toolsPayloadBytes).toBeGreaterThan(10_000); // the payoff is not marginal
    // eslint-disable-next-line no-console
    console.info(
      `[E7-03] cross-system trace: read A=${a.readBytes}B vs B=${b.readBytes}B ` +
        `(tools payload ${toolsPayloadBytes}B); write A=${a.writeBytes}B vs B=${b.writeBytes}B`,
    );
  });
});
