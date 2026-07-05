/**
 * POSIX-hazard static guard (2026-07-05, BPT Windows pilot: three production
 * incidents - SSE-gateway aside - were engine-code POSIX assumptions BELOW the
 * tool interface that no prompt could route around: `process.kill(-pid)`
 * process groups, bare `spawn('bash'/'sh')`, hardcoded `/tmp`. This machine
 * guard scans src/ for those exact hazard shapes so the NEXT one reds CI
 * before it ships, instead of surfacing as a fourth pilot report. (It already
 * earned its keep: it surfaced the foreground-Bash killGroup twin of the
 * KillShell bug.)
 *
 * A hazard line is allowed iff it carries a `win-ok:` marker comment naming
 * why it is platform-safe (e.g. the POSIX branch of planProcessKill, whose
 * win32 path is taskkill). No blanket allowlist - each exception is annotated
 * at the site. Comment/JSDoc lines are skipped (they discuss the hazards).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', 'src');

const HAZARDS: { id: string; re: RegExp; why: string }[] = [
  {
    id: 'process-group-kill',
    re: /process\.kill\(\s*-/,
    why: 'negative-pid / process-group signal is POSIX-only (no-op on Windows); use planProcessKill (win32 -> taskkill)',
  },
  {
    id: 'bare-shell-spawn',
    re: /spawn\(\s*['"](bash|sh)['"]/,
    why: "spawning 'bash'/'sh' by name ENOENTs on stock Windows; resolve via resolvePosixShells",
  },
  {
    id: 'hardcoded-tmp',
    re: /['"]\/tmp(\/|['"])/,
    why: 'hardcoded /tmp is POSIX-only; use os.tmpdir()',
  },
];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** A pure comment/JSDoc line (they discuss hazards, never execute them). */
function isCommentLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

describe('POSIX-hazard guard (Windows env-fidelity)', () => {
  const files = tsFiles(SRC);

  it('sanity: the scan covers a real src tree', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('no unmarked POSIX-only hazard in shipped engine code', () => {
    const violations: string[] = [];
    for (const file of files) {
      const rel = file.slice(SRC.length + 1);
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (isCommentLine(line)) return;
        for (const h of HAZARDS) {
          if (h.re.test(line) && !/win-ok:/.test(line)) {
            violations.push(`${rel}:${i + 1} [${h.id}] ${h.why}\n    ${line.trim()}`);
          }
        }
      });
    }
    expect(
      violations,
      `unmarked POSIX-only hazard(s) (fix for Windows, or annotate the site with a "win-ok: <reason>" comment):\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('the guard actually fires on a hazard sample (negative control)', () => {
    const sample = 'process.kill(-pid, sig);';
    expect(HAZARDS.some((h) => h.re.test(sample) && !/win-ok:/.test(sample))).toBe(true);
    // ...and is silenced by the marker.
    const marked = 'process.kill(-pid, sig); // win-ok: posix branch';
    expect(HAZARDS.every((h) => !(h.re.test(marked) && !/win-ok:/.test(marked)))).toBe(true);
  });
});
