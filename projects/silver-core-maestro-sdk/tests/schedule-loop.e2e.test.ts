/**
 * Campaign 3 acceptance: the schedule loop example — fixed-point firing,
 * missed-fire compensation ('latest' and 'all'), and cross-restart recovery
 * through a host file-backed ledger — runs end to end with real short timers.
 * The example imports the PACKAGE name, so this test needs the schedule
 * exports wired into src/index.ts (integration step).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS example module, no type declarations by design
import { runScheduleLoop } from '../examples/schedule-loop.mjs';

let sandbox: string;
beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-loop-'));
});
afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

const fireAtOf = (id: string): number => Number(id.split(':')[2]);

describe('schedule loop e2e (real short timers, file-backed ledger)', () => {
  it("catchUp 'latest': fires on time, restart re-fires nothing and compensates the newest missed point", async () => {
    const result = await runScheduleLoop({
      archiveDir: sandbox,
      everyMs: 200,
      pollIntervalMs: 25,
      phase1Fires: 2,
      phase2Fires: 1,
      gapMs: 700,
      catchUp: 'latest',
    });
    expect(result.phase1FiredIds.length).toBeGreaterThanOrEqual(2);
    expect(result.phase2FiredIds.length).toBeGreaterThanOrEqual(1);
    // Fire bookkeeping is in the ledger: ids encode spec + fire point.
    for (const id of [...result.phase1FiredIds, ...result.phase2FiredIds]) {
      expect(id).toMatch(/^sched:heartbeat:\d+$/);
    }
    // Cross-restart recovery: no phase-1 point fires again in phase 2.
    expect(result.phase2FiredIds.filter((id: string) => result.phase1FiredIds.includes(id))).toEqual([]);
    const lastPhase1 = Math.max(...result.phase1FiredIds.map(fireAtOf));
    expect(Math.min(...result.phase2FiredIds.map(fireAtOf))).toBeGreaterThan(lastPhase1);
    // Every fired session went through the driver into done, in ONE ledger file.
    const done = result.allSessions
      .filter((s: { state: string }) => s.state === 'done')
      .map((s: { id: string }) => s.id);
    for (const id of [...result.phase1FiredIds, ...result.phase2FiredIds]) {
      expect(done).toContain(id);
    }
    expect(fs.existsSync(path.join(sandbox, 'state', 'ledger.json'))).toBe(true);
  }, 30_000);

  it("catchUp 'all': every point missed during the gap is compensated, ascending", async () => {
    const result = await runScheduleLoop({
      archiveDir: sandbox,
      everyMs: 200,
      pollIntervalMs: 25,
      phase1Fires: 1,
      phase2Fires: 3, // gap of ~900ms at 200ms cadence owes at least 3 points
      gapMs: 900,
      catchUp: 'all',
    });
    expect(result.phase2FiredIds.length).toBeGreaterThanOrEqual(3);
    const fireAts = result.phase2FiredIds.map(fireAtOf);
    expect([...fireAts].sort((a: number, b: number) => a - b)).toEqual(fireAts);
    // The compensated points are dense: consecutive multiples of everyMs.
    for (let i = 1; i < 3; i += 1) {
      expect(fireAts[i]! - fireAts[i - 1]!).toBe(200);
    }
  }, 30_000);
});
