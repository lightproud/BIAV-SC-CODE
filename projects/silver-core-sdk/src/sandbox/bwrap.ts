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
 *
 * KNOWN LIMITATION (audit 2026-07-17 Q4): bwrap does not forward the SIGTERM to
 * the wrapped command, and `--die-with-parent` tears the sandbox down with a
 * SIGKILL pdeathsig. So the caller's SIGTERM->SIGKILL grace window (bash.ts
 * KILL_GRACE_MS) is effectively a hard kill for SANDBOXED commands: a command
 * that traps SIGTERM to flush/checkpoint before exiting does NOT get the grace
 * period it would receive unsandboxed. Teardown correctness is unaffected (the
 * tree always dies); only cooperative graceful-shutdown is lost under the
 * sandbox. A true fix needs in-sandbox signal forwarding, which bwrap's argv
 * surface does not expose — documented rather than worked around.
 */

import type { SandboxBackend, SandboxSpawnPlan, SandboxSpawnRequest } from './backend.js';

export class BwrapBackend implements SandboxBackend {
  readonly name = 'bwrap';

  wrap(req: SandboxSpawnRequest): SandboxSpawnPlan {
    const args: string[] = ['--ro-bind', '/', '/', '--unshare-pid'];
    if (!req.allowNetwork) args.push('--unshare-net');
    // Later binds override the read-only root; dedupe to keep argv tidy.
    // `--bind-try` (not `--bind`): a writable path that does not exist on disk
    // (e.g. an additionalDirectories entry the agent intends to create) is
    // skipped rather than aborting the whole spawn — otherwise ONE missing
    // path would brick every sandboxed command.
    for (const p of [...new Set(req.writablePaths)]) {
      if (p.length === 0) continue;
      args.push('--bind-try', p, p);
    }
    // Emit --dev/--proc AFTER the writable binds: bwrap applies mount ops
    // left-to-right and later ops win, so a pathological writable path of `/`
    // (or a /proc/-/dev-parent additionalDirectory) placed here would otherwise
    // re-bind the host /proc and /dev rw over these hardened mounts. Putting the
    // fresh devtmpfs/procfs last guarantees they always take precedence
    // (audit 2026-07-17 Q5).
    args.push('--dev', '/dev', '--proc', '/proc');
    args.push('--die-with-parent', '--chdir', req.cwd, '--', req.shell, '-c', req.command);
    return { command: 'bwrap', args, env: { TMPDIR: req.tmpDir } };
  }
}
