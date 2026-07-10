/**
 * Sandbox backend seam (G-SANDBOX).
 *
 * The Bash tool runs commands inside a sandbox BY DEFAULT when a backend
 * resolves (keeper ruling 2026-07-04: reproduce + default-on). The backend is
 * PLUGGABLE: bubblewrap (bwrap) on Linux is the only real backend v1 ships;
 * tests inject fakes; a host may inject its own (e.g. a future Seatbelt).
 * When NO backend resolves — win32/darwin, or bwrap absent — Bash runs
 * UNSANDBOXED and the sandbox guidance prompts are NOT emitted: the SDK never
 * pretends isolation it does not have (official Claude Code likewise ships no
 * sandbox on Windows).
 *
 * v1 restriction scope is exactly what the archived guidance + public docs
 * describe: write-denial outside allowed directories, network isolation
 * (binary on/off — the official domain-whitelist proxy layer is out of scope),
 * and a sandbox-writable $TMPDIR. No invented read-hiding / seccomp / cgroups.
 */

import { spawnSync } from 'node:child_process';

import type {
  SandboxBackend,
  SandboxContext,
  SandboxOptions,
} from '../types.js';
import { BwrapBackend } from './bwrap.js';

export type {
  SandboxBackend,
  SandboxContext,
  SandboxSpawnRequest,
  SandboxSpawnPlan,
} from '../types.js';

/** Injectable bwrap probe (tests override); true when bwrap is runnable. */
export type BwrapProbe = () => boolean;

const defaultBwrapProbe: BwrapProbe = () => {
  try {
    // FUNCTIONAL probe, not just `--version`: on hardened kernels with
    // unprivileged user namespaces disabled, bwrap is installed and
    // `--version` exits 0 but every real spawn fails at namespace setup. Run a
    // trivial sandbox that exercises the same namespaces wrap() uses; only a
    // 0 exit means real sandboxing works here.
    return (
      spawnSync('bwrap', ['--ro-bind', '/', '/', '--unshare-pid', '--die-with-parent', 'true'], {
        stdio: 'ignore',
      }).status === 0
    );
  } catch {
    return false;
  }
};

/**
 * Resolve the sandbox backend for a query. Returns null (Bash unsandboxed)
 * when explicitly disabled or when no backend is available on this platform.
 * Never throws — degradation is graceful and reported via one debug line.
 */
export function resolveSandboxBackend(
  opt: boolean | SandboxOptions | undefined,
  debug: (msg: string) => void,
  probe: BwrapProbe = defaultBwrapProbe,
  platform: NodeJS.Platform = process.platform,
): SandboxBackend | null {
  if (opt === false) return null;
  if (typeof opt === 'object') {
    if (opt.enabled === false) return null;
    if (opt.backend !== undefined) return opt.backend; // injected (tests / host Seatbelt)
  }
  if (platform === 'linux' && probe()) return new BwrapBackend();
  debug(
    'sandbox: no backend available on this platform; Bash runs UNSANDBOXED ' +
      '(bubblewrap is Linux-only; official Claude Code ships no sandbox on ' +
      'Windows either). Sandbox guidance prompts are not emitted.',
  );
  return null;
}

/**
 * Plan one shell spawn: identity args when unsandboxed or the escape hatch is
 * engaged for this call, else the backend's wrapped argv. Shared by the
 * foreground (bash.ts) and background (shells.ts) spawn sites so both are
 * sandboxed identically.
 */
export function planShellSpawn(
  shell: string,
  command: string,
  ctx: { cwd: string; sandbox?: SandboxContext },
  disableSandbox: boolean,
): { command: string; args: string[]; envOverlay: Record<string, string>; sandboxed: boolean } {
  const sbx = ctx.sandbox;
  if (sbx === undefined || disableSandbox) {
    return { command: shell, args: ['-c', command], envOverlay: {}, sandboxed: false };
  }
  const plan = sbx.backend.wrap({
    shell,
    command,
    cwd: ctx.cwd,
    writablePaths: sbx.writablePaths,
    tmpDir: sbx.tmpDir,
    allowNetwork: sbx.allowNetwork,
  });
  return { command: plan.command, args: plan.args, envOverlay: plan.env ?? {}, sandboxed: true };
}
