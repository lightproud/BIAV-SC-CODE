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

/**
 * Argv the functional probe spawns. It exercises the SAME namespaces/mounts a
 * real BwrapBackend.wrap() emits (--dev/--proc and the net namespace used for
 * network-off commands): probing a narrower feature set would pass here yet
 * abort at spawn time on a kernel that allows pid namespaces but not net/dev —
 * a probe/spawn mismatch (audit 2026-07-17 Q2). Exported so a regression test
 * can assert the parity against wrap()'s output.
 */
export const BWRAP_PROBE_ARGS: readonly string[] = [
  '--ro-bind', '/', '/',
  '--dev', '/dev',
  '--proc', '/proc',
  '--unshare-pid',
  '--unshare-net',
  '--die-with-parent',
  'true',
];

const defaultBwrapProbe: BwrapProbe = () => {
  try {
    // FUNCTIONAL probe, not just `--version`: on hardened kernels with
    // unprivileged user namespaces disabled, bwrap is installed and
    // `--version` exits 0 but every real spawn fails at namespace setup. Only a
    // 0 exit from a probe that matches wrap()'s namespace set means real
    // sandboxing works here (see BWRAP_PROBE_ARGS).
    return spawnSync('bwrap', [...BWRAP_PROBE_ARGS], { stdio: 'ignore' }).status === 0;
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
 * Non-secret environment essentials kept when `SandboxOptions.envScrub: true`.
 * Enough for a typical shell command to run (find the shell, resolve $HOME,
 * honor locale/timezone) while dropping every host secret. A host that needs a
 * different set uses the `{ allow: [...] }` form instead (audit r2 Q1).
 */
export const DEFAULT_SANDBOX_ENV_ALLOWLIST: readonly string[] = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LANGUAGE',
  'TERM',
  'TZ',
  'PWD',
];

/**
 * Resolve `SandboxOptions.envScrub` to the concrete allowlist stored on
 * SandboxContext (undefined = inherit the full env, the default). Exported for
 * the query-layer sandbox-context assembly and its regression test.
 */
export function resolveEnvAllowlist(
  envScrub: boolean | { allow?: readonly string[] } | undefined,
): readonly string[] | undefined {
  if (envScrub === undefined || envScrub === false) return undefined;
  if (envScrub === true) return DEFAULT_SANDBOX_ENV_ALLOWLIST;
  return envScrub.allow ?? DEFAULT_SANDBOX_ENV_ALLOWLIST;
}

/**
 * Build the environment a shell spawn actually runs with. When the command is
 * sandboxed AND an env allowlist is configured, the inherited base env is
 * filtered to the allowlist before the sandbox overlay ($TMPDIR) is applied;
 * otherwise the full base env passes through (default parity). An unsandboxed
 * or escaped command always inherits the full base env — it makes no
 * containment claim (audit r2 2026-07-17 Q1).
 */
export function resolveSpawnEnv(
  baseEnv: NodeJS.ProcessEnv,
  overlay: Record<string, string>,
  sandbox: SandboxContext | undefined,
  disableSandbox: boolean,
): NodeJS.ProcessEnv {
  const sandboxed = sandbox !== undefined && !disableSandbox;
  const allow = sandboxed ? sandbox.envAllowlist : undefined;
  if (allow === undefined) return { ...baseEnv, ...overlay };
  const allowSet = new Set(allow);
  const filtered: NodeJS.ProcessEnv = {};
  for (const key of Object.keys(baseEnv)) {
    if (allowSet.has(key)) filtered[key] = baseEnv[key];
  }
  return { ...filtered, ...overlay };
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
