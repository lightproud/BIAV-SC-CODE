/**
 * Audit wave 20 — session directory grants/revocations were a total no-op.
 *
 * The gate tracks `addDirectories` / `removeDirectories` carefully (revocation
 * subtraction, canonical Windows keys, re-grant clearing) and query.ts computed
 * `gate.effectiveAdditionalDirectories(...)` fresh on every turn — into
 * `ToolContext.additionalDirectories`, a field with ZERO readers since the fs
 * tools' containment fence was removed (fsutil.ts, 2026-07-05 path-model
 * ruling). The one consumer that still gives the directories meaning — the
 * sandbox writable set — was built ONCE at query construction from
 * `options.additionalDirectories`, never consulting the gate.
 *
 * So a host that revoked a directory mid-session kept it rw-bound inside the
 * sandbox (fail-open), and one that granted a directory still hit EROFS on
 * every write to it. The existing lock for this (b2b-alignment.test.ts, titled
 * "removeDirectories is honored at runtime") never leaves the gate object, so
 * it stayed green throughout — the 16th guard in this campaign that could not
 * report red.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { query } from '../src/query.js';
import type {
  Options,
  PermissionResult,
  SandboxBackend,
  SandboxSpawnRequest,
  SDKUserMessage,
} from '../src/types.js';
import { MockTransport, textReplyEvents, toolUseReplyEvents } from './helpers/mock-transport.js';

const TURN_USAGE = { model: 'claude-sonnet-4-5', usage: { input_tokens: 10 } };

let cwd: string;
let extraDir: string;
let laterDir: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'bpt-w20-cwd-'));
  extraDir = await mkdtemp(join(tmpdir(), 'bpt-w20-extra-'));
  laterDir = await mkdtemp(join(tmpdir(), 'bpt-w20-later-'));
});

afterEach(async () => {
  for (const d of [cwd, extraDir, laterDir]) {
    await rm(d, { recursive: true, force: true });
  }
});

function userMsg(content: string): SDKUserMessage {
  return { type: 'user', session_id: '', message: { role: 'user', content }, parent_tool_use_id: null };
}

/** Records the writable roots handed to each sandboxed spawn; runs the command
 *  unwrapped so the test does not depend on bwrap being present. */
function recordingBackend(seen: string[][]): SandboxBackend {
  return {
    name: 'recording',
    wrap(req: SandboxSpawnRequest) {
      seen.push([...req.writablePaths]);
      return { command: req.shell, args: ['-c', req.command] };
    },
  };
}

/** Two turns, one Bash call each; `updates` is applied by canUseTool on turn 1. */
async function runTwoTurns(
  options: Partial<Options>,
  firstAllow: PermissionResult,
): Promise<string[][]> {
  const seen: string[][] = [];
  const transport = new MockTransport([
    toolUseReplyEvents('Bash', { command: 'echo one' }, { id: 'toolu_1' }),
    textReplyEvents('done one', TURN_USAGE),
    toolUseReplyEvents('Bash', { command: 'echo two' }, { id: 'toolu_2' }),
    textReplyEvents('done two', TURN_USAGE),
  ]);
  let call = 0;
  let release: () => void = () => {};
  async function* prompts(): AsyncGenerator<SDKUserMessage> {
    yield userMsg('turn one');
    yield userMsg('turn two');
    await new Promise<void>((r) => {
      release = r;
    });
  }
  const q = query({
    prompt: prompts(),
    options: {
      provider: { apiKey: 'test-key', promptCaching: false },
      model: 'claude-sonnet-4-5',
      settingSources: [],
      cwd,
      sandbox: { backend: recordingBackend(seen) },
      canUseTool: async () => (call++ === 0 ? firstAllow : { behavior: 'allow' as const }),
      ...options,
    },
    _internal: { transport },
  });
  for await (const m of q) {
    if (m.type === 'result' && seen.length >= 2) break;
  }
  release();
  return seen;
}

describe('wave20: session directory updates reach the sandbox', () => {
  it('removeDirectories actually revokes the writable root (was: still rw-bound)', async () => {
    const seen = await runTwoTurns(
      { additionalDirectories: [extraDir] },
      {
        behavior: 'allow',
        updatedPermissions: [
          { type: 'removeDirectories', directories: [extraDir], destination: 'session' },
        ],
      },
    );
    expect(seen.length).toBeGreaterThanOrEqual(2);
    // Turn 1 ran before the revocation: the directory is writable.
    expect(seen[0]).toContain(extraDir);
    // Turn 2 runs after it. Before the fix this still contained extraDir — the
    // host revoked the grant and the sandbox kept honoring it.
    expect(seen[1]).not.toContain(extraDir);
    // The rest of the writable set is untouched by the refresh.
    expect(seen[1]).toContain(cwd);
  });

  it('addDirectories actually grants a writable root (was: EROFS on every write)', async () => {
    const seen = await runTwoTurns(
      {},
      {
        behavior: 'allow',
        updatedPermissions: [
          { type: 'addDirectories', directories: [laterDir], destination: 'session' },
        ],
      },
    );
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen[0]).not.toContain(laterDir);
    expect(seen[1]).toContain(laterDir);
  });

  it('a non-session destination is still ignored (unchanged policy)', async () => {
    const seen = await runTwoTurns(
      { additionalDirectories: [extraDir] },
      {
        behavior: 'allow',
        updatedPermissions: [
          { type: 'removeDirectories', directories: [extraDir], destination: 'userSettings' },
        ],
      },
    );
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen[1]).toContain(extraDir);
  });
});
