/**
 * Conformance L1 - keyless regression lock for THIS SDK's stream grammar.
 *
 * Drives the same scenarios as tests/conformance/run-l1.mjs through the SDK
 * (src build) against the content-blind emulator, and pins the exact
 * normalized token sequence. If our grammar drifts, this fails in `npm test`
 * without needing the official arm; the two-arm differential runs in the
 * dedicated CI job (conformance-l1) and via run-l1.mjs.
 *
 * Also locks the emulator's own discipline: the content-blind self-audit and
 * the comparator's known-divergence semantics (incl. KD-05 coalescing).
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { query } from '../src/index.js';
import type { Query, SDKMessage } from '../src/types.js';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - plain-JS conformance modules (no d.ts by design)
import { startEmulator, assertContentBlind } from './conformance/emulator.mjs';
// @ts-ignore
import { SCENARIOS } from './conformance/scenarios.mjs';
// @ts-ignore
import { normalizeStream, compareStreams } from './conformance/normalize.mjs';

const DUMMY_KEY = 'sk-ant-api03-' + 'A'.repeat(95);

/** Expected token sequence of OUR arm per scenario (the grammar lock). */
const EXPECTED_TOKENS: Record<string, string[]> = {
  'text-single-turn': ['system/init', 'user/echo', 'assistant', 'result/success'],
  'tool-read-loop': ['system/init', 'user/echo', 'assistant', 'user/tool_result', 'assistant', 'result/success'],
  'two-reads-one-turn': ['system/init', 'user/echo', 'assistant', 'user/tool_result', 'assistant', 'result/success'],
};

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'conf-lock-'));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

async function runOurArm(scenario: (typeof SCENARIOS)[number]): Promise<SDKMessage[]> {
  for (const [name, content] of Object.entries(scenario.fixtureFiles ?? {})) {
    await writeFile(join(cwd, name), content as string);
  }
  await mkdir(join(cwd, '.sessions'), { recursive: true });
  const emulator = await startEmulator(scenario.buildScripts(cwd));
  const messages: SDKMessage[] = [];
  try {
    const q: Query = query({
      prompt: scenario.prompt,
      options: {
        cwd,
        maxTurns: 4,
        sessionDir: join(cwd, '.sessions'),
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          ANTHROPIC_BASE_URL: emulator.url,
          ANTHROPIC_API_KEY: DUMMY_KEY,
        },
      },
    });
    for await (const m of q) messages.push(m);
  } finally {
    await emulator.close();
  }
  return messages;
}

describe('conformance L1 - our stream grammar lock', () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario.id}: token sequence and checks are pinned`, async () => {
      const messages = await runOurArm(scenario);
      const { tokens, checks } = normalizeStream(messages);
      expect(tokens).toEqual(EXPECTED_TOKENS[scenario.id]);
      expect(checks.resultSubtype).toBe(scenario.expect.resultSubtype);
      expect(checks.toolResults).toBe(scenario.expect.toolResults);
      expect(checks.resultText).toContain(scenario.expect.resultText);
    });
  }
});

describe('conformance comparator semantics', () => {
  it('KD-05 coalescing: per-block splits match per-turn batches as a KNOWN diff', () => {
    const official = ['system/init', 'assistant', 'assistant', 'user/tool_result', 'user/tool_result', 'assistant', 'result/success'];
    const ours = ['system/init', 'user/echo', 'assistant', 'user/tool_result', 'assistant', 'result/success'];
    const r = compareStreams(official, ours);
    expect(r.verdict).toBe('MATCH_WITH_KNOWN_DIFFS');
    expect(r.knownDiffs).toContain('KD-05');
    expect(r.knownDiffs).toContain('KD-04');
    expect(r.divergences).toEqual([]);
  });

  it('an unlisted difference stays DIVERGENT (allowlist cannot hide novelty)', () => {
    const official = ['system/init', 'assistant', 'brand_new_variant', 'result/success'];
    const ours = ['system/init', 'assistant', 'result/success'];
    const r = compareStreams(official, ours);
    expect(r.verdict).toBe('DIVERGENT');
    expect(r.divergences.length).toBeGreaterThan(0);
  });

  it('content-blind self-audit rejects body-derived markers', () => {
    expect(() => assertContentBlind('{"tokens":["assistant"]}')).not.toThrow();
    expect(() => assertContentBlind('{"system":"leaked prompt text"}')).toThrow(/self-audit FAILED/);
  });
});
