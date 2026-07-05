/**
 * Request-body wire-differential mechanism self-test (decisions.md 2026-07-05
 * 净室观测边界 r3 - clause ② content-blind lifted). Keyless: drives OUR arm
 * against a capturing emulator, proving (1) the emulator now captures request
 * bodies when opted in, and (2) the structural fingerprint + diff behave. The
 * dual-arm real differential lives in run-wire.mjs (needs the official pkg).
 *
 * This is the mechanism proof; it does not need the official arm, so it runs
 * in the normal keyless `npm test`.
 */

import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { query, type Query } from '../src/index.js';
import { startEmulator, textReply } from './conformance/emulator.mjs';
// @ts-expect-error - plain-JS conformance module without type declarations
import { fingerprintRequestBody, diffFingerprints, diffToolSchemas } from './conformance/wire-fingerprint.mjs';
// @ts-expect-error - plain-JS conformance module without type declarations
import { WIRE_SCENARIOS } from './conformance/scenarios-wire.mjs';

const DUMMY_KEY = 'sk-ant-api03-' + 'A'.repeat(95);
let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'conf-wire-'));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

async function driveOurArm(captureBodies: boolean) {
  await mkdir(join(cwd, '.sessions'), { recursive: true });
  const emulator = await startEmulator([{ kind: 'sse', events: textReply('WIRE OK') }], {
    captureBodies,
  });
  try {
    const q: Query = query({
      prompt: 'Say OK.',
      options: {
        cwd,
        maxTurns: 2,
        sessionDir: join(cwd, '.sessions'),
        sandbox: false,
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          ANTHROPIC_BASE_URL: emulator.url,
          ANTHROPIC_API_KEY: DUMMY_KEY,
        },
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of q) void _;
  } finally {
    await emulator.close();
  }
  return emulator.profile;
}

describe('request-body capture (r3)', () => {
  it('defaults to NOT capturing bodies (existing L1-L5 semantics unchanged)', async () => {
    const profile = await driveOurArm(false);
    expect(profile.requestBodies).toEqual([]);
    // The POST still happened - only the body was drained.
    expect(profile.requests.some((r: string) => r === 'POST /v1/messages')).toBe(true);
  });

  it('captures and parses the request body when opted in', async () => {
    const profile = await driveOurArm(true);
    expect(profile.requestBodies.length).toBeGreaterThan(0);
    const body = profile.requestBodies[0];
    expect(body.stream).toBe(true);
    expect(typeof body.model).toBe('string');
    // Our claude_code preset ships a system prompt and the built-in tool set.
    const fp = fingerprintRequestBody(body);
    expect(fp.present).toBe(true);
    expect(fp.systemKind).not.toBe('none');
    expect(fp.toolCount).toBeGreaterThan(0);
    expect(fp.toolNames).toContain('Read');
  });
});

describe('fingerprint + diff', () => {
  it('identical bodies fingerprint-diff to empty', async () => {
    const profile = await driveOurArm(true);
    const fp = fingerprintRequestBody(profile.requestBodies[0]);
    expect(diffFingerprints(fp, fp)).toEqual([]);
  });

  it('surfaces a tool-set difference as a toolNames facet', () => {
    const a = fingerprintRequestBody({ stream: true, tools: [{ name: 'Read' }, { name: 'Bash' }] });
    const b = fingerprintRequestBody({ stream: true, tools: [{ name: 'Read' }] });
    const d = diffFingerprints(a, b);
    const tool = d.find((x: { facet: string }) => x.facet === 'toolNames');
    expect(tool).toBeTruthy();
    expect(tool.onlyA).toEqual(['Bash']);
    expect(tool.onlyB).toEqual([]);
    // toolCount also differs.
    expect(d.some((x: { facet: string }) => x.facet === 'toolCount')).toBe(true);
  });

  it('surfaces system segmentation and cache-breakpoint differences', () => {
    const stringSys = fingerprintRequestBody({ stream: true, system: 'flat prompt' });
    const blockSys = fingerprintRequestBody({
      stream: true,
      system: [
        { type: 'text', text: 'stable', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'volatile' },
      ],
    });
    const d = diffFingerprints(stringSys, blockSys);
    expect(d.some((x: { facet: string }) => x.facet === 'systemKind')).toBe(true);
    expect(d.some((x: { facet: string }) => x.facet === 'systemCacheBreakpoints')).toBe(true);
  });

  it('an unparsed/absent body fingerprints as not-present', () => {
    expect(fingerprintRequestBody({ __unparsed: 'garbage' })).toEqual({ present: false });
    expect(fingerprintRequestBody(undefined)).toEqual({ present: false });
  });
});

// ---------------------------------------------------------------------------
// Reference-target regression (keeper directive: "对着接口全部测试一轮,然后
// 作为参考目标"). The official arm's structural wire fingerprints per scenario
// live in wire-reference.json (refreshed by run-wire.mjs --update-reference
// with the official pkg installed). This block drives OUR arm keyless per
// scenario and asserts the diff-against-reference EXACTLY equals the
// documented alignment gaps - a shrink-only ratchet:
//   - a NEW gap (our wire drifted, or a new reference facet) -> RED;
//   - a gap that CLOSED (engine aligned to the target) but is still listed
//     -> RED (stale entry must be deleted).
// Tool-set size/name gaps are expected-surface (CLI product tools the SDK
// omits) and excluded from the alignment comparison, matching the runner.
// ---------------------------------------------------------------------------

const EXPECTED_SURFACE = new Set(['toolNames', 'toolCount']);

/**
 * Documented wire-alignment gaps vs the official reference target. Each is a
 * concrete engine-alignment candidate handed to the engine team; DELETE the
 * entry when the engine closes it (the ratchet reds a stale entry).
 *   thinking            - official sends {type:'adaptive'}; ours enabled/fixed (KD-L5-03)
 *   toolCacheBreakpoints- official 0 on tools; ours 1 (cache-strategy divergence)
 *   Agent/Bash/Read     - our tool input_schemas lag the official current params
 *                         (Agent: isolation/model + required set; Bash:
 *                         dangerouslyDisableSandbox; Read: pages)
 *   cache-off system*   - promptCaching:false is a bpt-only option the official
 *                         arm ignores, so its reference stays cache-on: the
 *                         system-segmentation delta there is an artifact of the
 *                         asymmetric option, documented not chased.
 */
const WIRE_ALIGNMENT_GAPS: Record<string, { facets: string[]; tools: string[] }> = {
  default: { facets: ['thinking', 'toolCacheBreakpoints'], tools: ['Agent:params+required', 'Bash:params', 'Read:params'] },
  'thinking-off': { facets: ['thinking', 'toolCacheBreakpoints'], tools: ['Agent:params+required', 'Bash:params', 'Read:params'] },
  'thinking-4096': { facets: ['thinking', 'toolCacheBreakpoints'], tools: ['Agent:params+required', 'Bash:params', 'Read:params'] },
  'cache-off': { facets: ['systemBlocks', 'systemCacheBreakpoints', 'systemKind', 'thinking'], tools: ['Agent:params+required', 'Bash:params', 'Read:params'] },
  'mcp-added': { facets: ['thinking', 'toolCacheBreakpoints'], tools: ['Agent:params+required', 'Bash:params', 'Read:params'] },
};

interface WireScenario {
  id: string;
  options?: Record<string, unknown>;
  buildOptions?: (ctx: { sdk: unknown }) => Record<string, unknown>;
}

async function ourFingerprint(scenario: WireScenario) {
  await mkdir(join(cwd, '.sessions'), { recursive: true });
  const emulator = await startEmulator([{ kind: 'sse', events: textReply('WIRE OK') }], {
    captureBodies: true,
  });
  const sdk = await import('../src/index.js');
  const extra = scenario.buildOptions ? scenario.buildOptions({ sdk }) : (scenario.options ?? {});
  try {
    const q: Query = query({
      prompt: 'Say OK.',
      options: {
        cwd,
        maxTurns: 2,
        sessionDir: join(cwd, '.sessions'),
        sandbox: false,
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          ANTHROPIC_BASE_URL: emulator.url,
          ANTHROPIC_API_KEY: DUMMY_KEY,
        },
        ...extra,
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of q) void _;
  } finally {
    await emulator.close();
  }
  return fingerprintRequestBody(emulator.profile.requestBodies[0]);
}

describe('wire reference-target ratchet (our arm vs official reference)', () => {
  const ref = JSON.parse(
    readFileSync(join(__dirname, 'conformance', 'wire-reference.json'), 'utf8'),
  ).scenarios as Record<string, unknown>;

  it('reference file covers every scenario', () => {
    for (const sc of WIRE_SCENARIOS as WireScenario[]) {
      expect(ref[sc.id], `reference missing scenario ${sc.id}`).toBeTruthy();
    }
  });

  for (const scenario of WIRE_SCENARIOS as WireScenario[]) {
    it(`${scenario.id}: alignment gaps vs reference exactly match the documented set`, async () => {
      const ours = await ourFingerprint(scenario);
      const facetGaps = (diffFingerprints(ref[scenario.id], ours) as { facet: string }[])
        .filter((d) => !EXPECTED_SURFACE.has(d.facet))
        .map((d) => d.facet)
        .sort();
      const toolGaps = (diffToolSchemas(ref[scenario.id], ours) as { tool: string; diffs: { facet: string }[] }[])
        .map((s) => `${s.tool}:${s.diffs.map((d) => d.facet).join('+')}`)
        .sort();
      const expected = WIRE_ALIGNMENT_GAPS[scenario.id];
      expect(facetGaps, `facet gaps drifted for ${scenario.id}`).toEqual([...expected.facets].sort());
      expect(toolGaps, `tool-schema gaps drifted for ${scenario.id}`).toEqual([...expected.tools].sort());
    });
  }
});
