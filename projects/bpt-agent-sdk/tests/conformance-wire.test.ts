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
import { query, type Query } from '../src/index.js';
import { startEmulator, textReply } from './conformance/emulator.mjs';
// @ts-expect-error - plain-JS conformance module without type declarations
import { fingerprintRequestBody, diffFingerprints } from './conformance/wire-fingerprint.mjs';

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
