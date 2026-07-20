/**
 * Audit r4 regression tests — cluster "planmode-monitor".
 *
 * Covers the fixed items:
 *  - U3-1  ExitPlanMode restores the pre-plan permission mode (recorded by
 *          EnterPlanMode) instead of hard-coding 'default'.
 *  - U3-2  Monitor rejects a malformed non-boolean `persistent` rather than
 *          silently coercing it to false.
 *  - Stim-2 Monitor's non-persistent kill timer is released on query teardown
 *          (abort signal) instead of pinning its closure until it fires.
 *
 * Z4-1 (EnterPlanMode readOnly vs "REQUIRES user approval" description) is NOT
 * covered here — it was SKIPPED (test-locked + deliberate design; see the
 * task report). Monitor watches run real background shells via
 * createShellManager, disposed in afterEach.
 */

import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  ShellManager,
  ToolContext,
  ToolResultPayload,
} from '../src/internal/contracts.js';
import { DefaultPermissionGate } from '../src/permissions/gate.js';
import { createShellManager } from '../src/tools/shells.js';
import { enterPlanModeTool } from '../src/tools/enterplanmode.js';
import { exitPlanModeTool } from '../src/tools/exitplanmode.js';
import { monitorTool } from '../src/tools/monitor.js';

let managers: ShellManager[] = [];
afterEach(() => {
  for (const m of managers) m.dispose();
  managers = [];
});

function makeShells(): ShellManager {
  const m = createShellManager(() => {});
  managers.push(m);
  return m;
}

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    cwd: tmpdir(),
    additionalDirectories: [],
    env: process.env as Record<string, string | undefined>,
    signal: new AbortController().signal,
    debug: () => {},
    ...overrides,
  };
}

function text(r: ToolResultPayload): string {
  return String(r.content);
}

async function until(cond: () => boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 25));
  }
}

// ---------------------------------------------------------------------------
// U3-1: ExitPlanMode restores the pre-plan mode
// ---------------------------------------------------------------------------

describe('audit r4 U3-1: ExitPlanMode restores the pre-plan mode', () => {
  it('restores acceptEdits after an EnterPlanMode round trip (not hard default)', async () => {
    const gate = new DefaultPermissionGate({ debug: () => {}, mode: 'acceptEdits' });
    const ctx = makeCtx();
    ctx.permissionGate = gate;

    const enter = await enterPlanModeTool.execute({}, ctx);
    expect(enter.isError).toBeUndefined();
    expect(gate.getMode()).toBe('plan');

    const exit = await exitPlanModeTool.execute({}, ctx);
    expect(exit.isError).toBeUndefined();
    // The bug hard-coded 'default'; the fix restores the recorded acceptEdits.
    expect(gate.getMode()).toBe('acceptEdits');
    expect(text(exit)).toContain('plan -> acceptEdits');
  });

  it('restores dontAsk after an EnterPlanMode round trip', async () => {
    const gate = new DefaultPermissionGate({ debug: () => {}, mode: 'dontAsk' });
    const ctx = makeCtx();
    ctx.permissionGate = gate;

    await enterPlanModeTool.execute({}, ctx);
    expect(gate.getMode()).toBe('plan');
    const exit = await exitPlanModeTool.execute({}, ctx);
    expect(gate.getMode()).toBe('dontAsk');
    expect(text(exit)).toContain('plan -> dontAsk');
  });

  it('falls back to default when plan mode was NOT entered via EnterPlanMode', async () => {
    const gate = new DefaultPermissionGate({ debug: () => {}, mode: 'plan' });
    const ctx = makeCtx();
    ctx.permissionGate = gate;

    const exit = await exitPlanModeTool.execute({}, ctx);
    expect(exit.isError).toBeUndefined();
    expect(gate.getMode()).toBe('default');
    expect(text(exit)).toContain('plan -> default');
  });

  it('consumes the record once: a second enter/exit does not leak a stale prior mode', async () => {
    const gate = new DefaultPermissionGate({ debug: () => {}, mode: 'acceptEdits' });
    const ctx = makeCtx();
    ctx.permissionGate = gate;

    // First round trip: acceptEdits -> plan -> acceptEdits.
    await enterPlanModeTool.execute({}, ctx);
    await exitPlanModeTool.execute({}, ctx);
    expect(gate.getMode()).toBe('acceptEdits');

    // Host switches to default, then a NEW plan session begins via EnterPlanMode.
    gate.setMode('default');
    await enterPlanModeTool.execute({}, ctx);
    const exit2 = await exitPlanModeTool.execute({}, ctx);
    // Must restore the SECOND session's prior mode (default), not the stale first.
    expect(gate.getMode()).toBe('default');
    expect(text(exit2)).toContain('plan -> default');
  });
});

// ---------------------------------------------------------------------------
// U3-2: Monitor rejects a malformed `persistent`
// ---------------------------------------------------------------------------

describe('audit r4 U3-2: Monitor rejects a malformed persistent flag', () => {
  it('rejects non-boolean persistent instead of silently coercing to false', async () => {
    const shells = makeShells();
    const ctx = makeCtx({ shells });
    for (const bad of ['true', 'false', 1, 0, {}, []]) {
      const r = await monitorTool.execute(
        { command: 'true', description: 'd', persistent: bad },
        ctx,
      );
      expect(r.isError, JSON.stringify(bad)).toBe(true);
      expect(text(r)).toContain('"persistent" must be a boolean');
    }
  });

  it('still accepts a real boolean persistent (true disables the timeout)', async () => {
    const shells = makeShells();
    const ctx = makeCtx({ shells });
    const ok = await monitorTool.execute(
      { command: 'sleep 30', description: 'log tail', timeout_ms: 100, persistent: true },
      ctx,
    );
    expect(ok.isError, text(ok)).toBeUndefined();
    expect(text(ok)).toContain('persistent: true');
    const id = /taskId: (bash_\d+)/.exec(text(ok))![1]!;
    shells.kill(id);
  });

  it('still accepts persistent:false (default timeout applies)', async () => {
    const shells = makeShells();
    const ctx = makeCtx({ shells });
    const ok = await monitorTool.execute(
      { command: 'sleep 30', description: 'watch', timeout_ms: 100, persistent: false },
      ctx,
    );
    expect(ok.isError, text(ok)).toBeUndefined();
    expect(text(ok)).not.toContain('persistent: true');
    const id = /taskId: (bash_\d+)/.exec(text(ok))![1]!;
    shells.kill(id);
  });
});

// ---------------------------------------------------------------------------
// Stim-2: the non-persistent kill timer is released on abort
// ---------------------------------------------------------------------------

describe('audit r4 Stim-2: Monitor kill timer is released on query teardown', () => {
  it('aborting the query clears the pending kill timer (watch NOT killed by it)', async () => {
    const shells = makeShells();
    const controller = new AbortController();
    const ctx = makeCtx({ shells, signal: controller.signal });

    const r = await monitorTool.execute(
      { command: 'sleep 30', description: 'watch', timeout_ms: 200 },
      ctx,
    );
    expect(r.isError, text(r)).toBeUndefined();
    const id = /taskId: (bash_\d+)/.exec(text(r))![1]!;
    expect(shells.get(id)!.status).toBe('running');

    // Abort BEFORE the 200ms kill timer would fire.
    controller.abort();
    // Wait past the timeout window: with the fix the timer was cleared, so the
    // watch is still running (nothing else kills it in this isolated context);
    // without the fix the timer fires at ~200ms and marks the shell 'killed'.
    await new Promise((res) => setTimeout(res, 500));
    expect(shells.get(id)!.status).toBe('running');

    shells.kill(id);
  });

  it('without abort, the kill timer still fires and kills a stuck watch', async () => {
    const shells = makeShells();
    const ctx = makeCtx({ shells });
    const r = await monitorTool.execute(
      { command: 'sleep 30', description: 'stuck', timeout_ms: 150 },
      ctx,
    );
    expect(r.isError, text(r)).toBeUndefined();
    const id = /taskId: (bash_\d+)/.exec(text(r))![1]!;
    expect(shells.get(id)!.status).toBe('running');
    await until(() => shells.get(id)!.status === 'killed');
  });
});
