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
import { isAbsolute } from 'node:path';

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

/** Standard Git-for-Windows bash.exe locations, most common first. */
function gitBashProbes(env: Record<string, string | undefined>): string[] {
  const roots = [
    env['ProgramFiles'],
    env['ProgramFiles(x86)'],
    env['ProgramW6432'],
  ].filter((r): r is string => typeof r === 'string' && r.length > 0);
  const probes: string[] = [];
  for (const root of roots) {
    probes.push(winJoin(root, 'Git', 'bin', 'bash.exe'));
    probes.push(winJoin(root, 'Git', 'usr', 'bin', 'bash.exe'));
  }
  const localAppData = env['LOCALAPPDATA'] ?? env['LocalAppData'];
  if (typeof localAppData === 'string' && localAppData.length > 0) {
    probes.push(winJoin(localAppData, 'Programs', 'Git', 'bin', 'bash.exe'));
  }
  return probes;
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
    // Skip an ABSOLUTE override that does not exist, so the resolver falls
    // through to the platform defaults (bash/sh, or the Git Bash probes) rather
    // than handing a doomed path to spawn. This matters most for the BACKGROUND
    // shell path, which cannot fall back on its own — spawn's ENOENT is async
    // and fires after spawnBackground has already returned a shell id, so a
    // misconfigured override there is reported "launched" yet never runs. A
    // bare-name override (no separator) is kept as-is (PATH-resolved by spawn).
    if (!isAbsolute(override) || probe(override)) out.push(override);
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
