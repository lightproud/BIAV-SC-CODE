/**
 * Regression: the replay-backoff timer must HOLD the event loop (v0.51.1).
 *
 * A mid-stream cut fires the engine's bounded turn replay; its backoff sleep
 * runs at the exact moment the dead connection was often the process's last
 * live handle. An unref'd timer there drains the loop and a plain-script
 * consumer dies with Node exit code 13 (unsettled top-level await) — which is
 * invisible from inside vitest, whose runner handles keep every loop alive.
 * So this test spawns a REAL child node process (fixture with an unref'd
 * emulator listener) and asserts it survives to a success result.
 *
 * Needs dist/ (the fixture imports the built SDK); skips when absent —
 * CI always builds before testing.
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = join(root, 'tests', 'fixtures', 'replay-exit-repro.mjs');
const hasDist = existsSync(join(root, 'dist', 'index.js'));

describe.skipIf(!hasDist)('replay backoff process-exit regression (child process)', () => {
  it('a plain-script consumer survives a mid-stream cut through the replay backoff', () => {
    const res = spawnSync('node', [fixture], { encoding: 'utf8', timeout: 60_000 });
    // Exit 13 = the unsettled-top-level-await drain this guards against.
    expect(res.status).toBe(0);
    const out = JSON.parse(res.stdout.trim().split('\n').at(-1) ?? '{}');
    expect(out.is_error).toBe(false);
    expect(out.subtype).toBe('success');
    expect(out.turnReplays).toBeGreaterThanOrEqual(1);
  });
});
