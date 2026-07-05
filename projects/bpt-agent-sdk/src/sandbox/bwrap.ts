/**
 * Bubblewrap (bwrap) sandbox backend — pure argv assembly, no I/O in wrap()
 * (unit-testable offline; availability is probed by resolveSandboxBackend).
 *
 * Restriction derivation (only what the archived guidance / public docs
 * describe — nothing invented):
 *   - broad READ, deny-by-default WRITE outside allowed dirs
 *     (`--ro-bind / /` + one rw `--bind` per allowed path; the archive's
 *     "Access denied to specific paths outside allowed directories" evidence
 *     fragment and the write-allowlist concept in -no-sensitive-paths)
 *   - network isolation via `--unshare-net` when allowNetwork is false
 *     (the -evidence-network-failures fragment; the official domain-whitelist
 *     proxy layer is out of scope for v1, so network is binary on/off)
 *   - $TMPDIR redirected to a sandbox-writable dir (the -tmpdir fragment:
 *     "TMPDIR is automatically set to the correct sandbox-writable directory")
 *   - NO --tmpfs /tmp: the shell state dir (persistent cwd/env replay) and the
 *     sandbox tmpDir both live under /tmp and are rw-bound individually; a
 *     tmpfs overlay would hide them and silently break persistence.
 *
 * Kill semantics: the caller keeps spawning with detached:true and signals the
 * process group; `--die-with-parent` plus the existing SIGTERM->SIGKILL
 * escalation guarantees full-tree teardown even across the pid namespace.
 */

import type { SandboxBackend, SandboxSpawnPlan, SandboxSpawnRequest } from './backend.js';

export class BwrapBackend implements SandboxBackend {
  readonly name = 'bwrap';

  wrap(req: SandboxSpawnRequest): SandboxSpawnPlan {
    const args: string[] = [
      '--ro-bind', '/', '/',
      '--dev', '/dev',
      '--proc', '/proc',
      '--unshare-pid',
    ];
    if (!req.allowNetwork) args.push('--unshare-net');
    // Later binds override the read-only root; dedupe to keep argv tidy.
    for (const p of [...new Set(req.writablePaths)]) {
      if (p.length === 0) continue;
      args.push('--bind', p, p);
    }
    args.push('--die-with-parent', '--chdir', req.cwd, '--', req.shell, '-c', req.command);
    return { command: 'bwrap', args, env: { TMPDIR: req.tmpDir } };
  }
}
