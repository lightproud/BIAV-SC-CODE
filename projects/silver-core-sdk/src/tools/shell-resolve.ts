/**
 * POSIX shell resolution for the Bash tool (2026-07-05 BPT Windows pilot
 * incident: the tool spawned `bash` -> `sh` BY NAME, which does not exist on
 * a stock Windows box - `spawn sh ENOENT`, tool entirely unusable on the
 * engine-swap's primary target platform).
 *
 * Resolution order (mirrors the official client's Windows posture, which
 * requires Git for Windows and honors CLAUDE_CODE_GIT_BASH_PATH):
 *   1. env.CLAUDE_CODE_GIT_BASH_PATH - explicit override, any platform,
 *      prepended (falls through to defaults if it fails to spawn);
 *   2. non-Windows: bash, then sh (unchanged historical chain);
 *   3. Windows: Git Bash probed at its standard install locations. The bare
 *      name `bash` is deliberately NOT probed on Windows: System32 bash.exe
 *      launches WSL, whose filesystem view (D:\ -> /mnt/d) and environment
 *      silently diverge from the host - a wrong-shell trap worse than a loud
 *      miss.
 *
 * An empty result means "no POSIX shell available"; callers surface
 * SHELL_NOT_FOUND_GUIDANCE instead of a bare ENOENT.
 */

import { existsSync } from 'node:fs';
import * as path from 'node:path';

/**
 * Explicit backslash join: these are WINDOWS-ONLY paths, and building them
 * with path.join would use the HOST separator (forward slash on the linux CI
 * that unit-tests this module) - the resolver must be host-independent.
 */
const winJoin = (...parts: string[]): string => parts.join('\\');

export const SHELL_NOT_FOUND_GUIDANCE =
  'No POSIX shell found. The Bash tool needs bash (or sh). On Windows, ' +
  'install Git for Windows (Git Bash) or set CLAUDE_CODE_GIT_BASH_PATH to ' +
  'the full path of bash.exe.';

/**
 * Standard Git-for-Windows bash.exe locations, most common first.
 *
 * Install roots are read from the caller's env FIRST, then from `process.env`
 * as a fallback (2026-07-26 Windows probe). Those roots are host installation
 * facts — where Git happens to live on this machine — not session
 * configuration, and a host that hands the SDK a CURATED `options.env`
 * (`{ PATH, HOME, … }`, which is exactly what a hardened Electron host does)
 * otherwise loses `ProgramFiles` and with it the entire Bash tool: the resolver
 * returns nothing and every call dies with "No POSIX shell found". Scrubbing a
 * variable out of the CHILD's environment is a legitimate thing for a host to
 * want; being unable to LOCATE the interpreter because of it is not.
 *
 * The fallback only ever reads the three root vars, never leaks them into the
 * spawned environment (that stays `ctx.env`), and never overrides a root the
 * caller did supply.
 */
function gitBashProbes(env: Record<string, string | undefined>): string[] {
  const root = (name: string): string | undefined => {
    const v = env[name] ?? process.env[name];
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  };
  const roots = ['ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432']
    .map(root)
    .filter((r): r is string => r !== undefined);
  const probes: string[] = [];
  for (const r of roots) {
    probes.push(winJoin(r, 'Git', 'bin', 'bash.exe'));
    probes.push(winJoin(r, 'Git', 'usr', 'bin', 'bash.exe'));
  }
  const localAppData = root('LOCALAPPDATA') ?? root('LocalAppData');
  if (localAppData !== undefined) {
    probes.push(winJoin(localAppData, 'Programs', 'Git', 'bin', 'bash.exe'));
  }
  // De-duplicate: on a 64-bit host ProgramFiles and ProgramW6432 are the SAME
  // directory, so the un-deduped list probed (and, on a miss, spawn-tried)
  // every candidate twice — observed verbatim in the probe's resolver dump.
  return [...new Set(probes)];
}

/**
 * Ordered shell candidates for the current host. `probe` is injectable for
 * unit tests (defaults to fs.existsSync).
 */
export function resolvePosixShells(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform = process.platform,
  probe: (path: string) => boolean = existsSync,
): string[] {
  const out: string[] = [];
  const override = env['CLAUDE_CODE_GIT_BASH_PATH'];
  if (typeof override === 'string' && override.length > 0) {
    // Probe any override that names a PATH-BEARING location before handing it
    // to spawn, so the resolver falls through to the platform defaults
    // (bash/sh, or the Git Bash probes) rather than spawning a doomed path.
    // F7 (audit 2026-07-17): the old check exempted every non-absolute
    // override, but spawn does NO PATH resolution for a name containing a
    // separator (`tools/bash`) — it resolves against the child cwd and fails
    // ENOENT asynchronously, after the launch was already acked. So: a bare
    // name (no separator) is kept as-is (genuinely PATH-resolved by spawn);
    // anything with a separator is resolved to an absolute path (pinning the
    // ambient-cwd interpretation) and must pass the existence probe.
    if (!/[/\\]/.test(override)) {
      out.push(override);
    } else {
      // Host-independent absoluteness: a `D:\...` override must stay verbatim
      // even when this resolver runs on a POSIX host (unit tests, WSL-side
      // tooling) — path.resolve there would mangle it into a relative name.
      const isAbs =
        path.posix.isAbsolute(override) || path.win32.isAbsolute(override);
      const resolved = isAbs ? override : path.resolve(override);
      if (probe(resolved)) out.push(resolved);
    }
  }
  if (platform !== 'win32') {
    out.push('bash', 'sh');
    return out;
  }
  for (const candidate of gitBashProbes(env)) {
    if (probe(candidate)) out.push(candidate);
  }
  return out;
}
