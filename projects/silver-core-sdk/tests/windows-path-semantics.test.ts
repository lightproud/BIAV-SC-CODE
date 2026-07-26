/**
 * Windows path semantics for path-scoped permission rules — runnable on ANY host.
 *
 * Origin: the 2026-07-26 windows-latest platform probe (the repo's first CI run
 * on a non-Linux runner) plus the keeper's field report that the SDK's tool
 * calls "do dumb things on Windows". Path-scoped rules were broken in BOTH
 * directions there, and the whole 3200-test suite was green on Linux the entire
 * time — no test could see it, because every one of them ran in the POSIX
 * dialect on a POSIX host.
 *
 * `MatchContext.platform` closes that: the dialect is now injectable, so win32
 * behavior is asserted here on Linux CI. These are the regressions that would
 * have caught the defect without owning a Windows machine.
 *
 * What was broken (each has a test below):
 *   W-1 a POSIX-shaped rule matched NOTHING on Windows — `path.resolve` produced
 *       `C:\etc\a`, the rule and glob machinery speak `/`. A deny failing OPEN.
 *   W-2 a Windows-shaped rule (backslashes in the spec) matched nothing either:
 *       the wildcard tail kept `\`, which the glob's `/`-based classes never see.
 *   W-3 the single-`*` class `[^/]*` does not stop at `\`, so an interior `*`
 *       crossed directory boundaries and OVER-matched.
 *   W-4 case was significant, so a deny on `C:/Secret/**` was bypassable by
 *       asking for the same file as `c:\secret\x`.
 *   W-5 with no cwd (the exported `ruleMatches` best-effort branch) win32
 *       `normalize` reshaped the two sides differently — `git:` -> `.\git:`
 *       while `git` stayed `git`; `//etc/` was kept as UNC while `/etc/x` was
 *       not — so spec and value could no longer meet.
 *
 * The POSIX negative controls at the bottom are not decoration: the fix must be
 * win32-SCOPED. On POSIX a backslash is a legal filename character and paths are
 * case-sensitive, so folding either one there would open a fresh hole.
 */

import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import {
  directoryKey,
  parseRule,
  ruleMatches,
  type MatchContext,
} from '../src/permissions/rules.js';
import { toNativePath } from '../src/tools/fsutil.js';
import { resolvePosixShells } from '../src/tools/shell-resolve.js';

const WIN: MatchContext = { cwd: 'C:\\work', platform: 'win32' };
const NIX: MatchContext = { cwd: '/work', platform: 'linux' };

/** Does `rule` match a Read of `file_path` under the given dialect? */
const hits = (rule: string, filePath: string, ctx: MatchContext): boolean =>
  ruleMatches(parseRule(rule), 'Read', { file_path: filePath }, 'any', ctx);

describe('W-1 a POSIX-shaped rule still binds on Windows', () => {
  it('deep ** deny reaches a drive-rooted path', () => {
    expect(hits('Read(//etc/**)', '/etc/a/b/secret', WIN)).toBe(true);
    // Still scoped — an unrelated tree is not swept in.
    expect(hits('Read(//etc/**)', '/var/secret', WIN)).toBe(false);
  });

  it('a boundary prefix matches only at a segment boundary', () => {
    expect(hits('Read(//etc/foo/**)', '/etc/foo/x', WIN)).toBe(true);
    expect(hits('Read(//etc/foo/**)', '/etc/foobar/x', WIN)).toBe(false);
  });
});

describe('W-2 a Windows-shaped rule binds too', () => {
  it('backslash spec matches a backslash value', () => {
    expect(hits('Read(C:\\etc\\**)', 'C:\\etc\\a\\secret', WIN)).toBe(true);
    expect(hits('Read(C:\\etc\\**)', 'C:\\var\\secret', WIN)).toBe(false);
  });

  it('the two spellings of the same rule are interchangeable', () => {
    // A host must not have to guess which separator the SDK wants.
    for (const rule of ['Read(C:\\etc\\**)', 'Read(C:/etc/**)']) {
      for (const value of ['C:\\etc\\a\\secret', 'C:/etc/a/secret']) {
        expect(hits(rule, value, WIN), `${rule} vs ${value}`).toBe(true);
      }
    }
  });
});

describe('W-3 an interior single-* stays inside one segment', () => {
  it('does not cross a Windows separator', () => {
    expect(hits('Read(C:\\logs\\*\\a.txt)', 'C:\\logs\\x\\a.txt', WIN)).toBe(true);
    // The over-match: `[^/]*` never stopped at a backslash, so this used to hit.
    expect(hits('Read(C:\\logs\\*\\a.txt)', 'C:\\logs\\x\\y\\a.txt', WIN)).toBe(false);
  });

  it('** still crosses any depth', () => {
    expect(hits('Read(C:\\logs\\**\\a.txt)', 'C:\\logs\\x\\y\\a.txt', WIN)).toBe(true);
  });
});

describe('W-4 Windows path matching is case-insensitive', () => {
  it('a deny cannot be dodged by re-casing the same file', () => {
    expect(hits('Read(C:/Secret/**)', 'c:\\secret\\x', WIN)).toBe(true);
    expect(hits('Read(c:/secret/**)', 'C:\\SECRET\\X', WIN)).toBe(true);
  });
});

describe('W-5 the no-cwd best-effort branch stays symmetric', () => {
  const winNoCwd: MatchContext = { platform: 'win32' };

  it('a relative `name:*` rule still reaches the bare name', () => {
    // win32 normalize turns the SPEC into `.\git:` but leaves the VALUE `git`.
    expect(hits('Read(git:*)', 'git', winNoCwd)).toBe(true);
  });

  it('a leading // in the rule does not become an unmatchable UNC root', () => {
    expect(hits('Read(//etc/foo/**)', '/etc/foo/x', winNoCwd)).toBe(true);
    expect(hits('Read(//etc/foo/**)', '/etc/foobar/x', winNoCwd)).toBe(false);
  });

  it('UNC-scoped rules are NOT expressible on win32 (documented cost)', () => {
    // `//` in a specifier is the rule syntax's ABSOLUTE spelling, so it is
    // collapsed before win32 can read it as a share name — which is what makes
    // `Read(//etc/**)` bind at all. The price is that a real UNC scope cannot
    // be written. Pinned so the trade-off is a decision, not a surprise:
    // if this ever needs to work, it needs a distinct syntax, not a tweak.
    expect(hits('Read(\\\\server\\share\\**)', '\\\\server\\share\\x', winNoCwd)).toBe(false);
  });
});

describe('POSIX negative controls — the fix must NOT leak off Windows', () => {
  it('paths stay case-SENSITIVE', () => {
    expect(hits('Read(/etc/Secret/**)', '/etc/Secret/x', NIX)).toBe(true);
    // Lowercasing here would let an allow reach a file it was never scoped to.
    expect(hits('Read(/etc/Secret/**)', '/etc/secret/x', NIX)).toBe(false);
  });

  it('a backslash stays an ordinary filename character', () => {
    // `/work/a\b` is ONE file named `a\b`, not `/work/a/b`.
    expect(hits('Read(/work/a\\b)', '/work/a\\b', NIX)).toBe(true);
    expect(hits('Read(/work/a/b)', '/work/a\\b', NIX)).toBe(false);
    // And a `*` must not treat it as a boundary either.
    expect(hits('Read(/work/*)', '/work/a\\b', NIX)).toBe(true);
  });

  it('POSIX behavior is unchanged by the dialect being explicit', () => {
    // Same assertions the pre-existing suites make with no platform supplied.
    expect(hits('Read(//etc/**)', '/etc/a/b/secret', NIX)).toBe(true);
    expect(hits('Read(//etc/**)', '/var/secret', NIX)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Enumerated-path separators (Glob / Grep). Asserted at the helper, because the
// end-to-end behavior only differs on Windows and the suite must stay meaningful
// on Linux CI.
// ---------------------------------------------------------------------------

describe('toNativePath — one separator dialect across the tool surface', () => {
  it('is a no-op on POSIX, where a backslash is a filename character', () => {
    if (process.platform === 'win32') return; // asserted the other way below
    // `/work/a\b` is ONE file named `a\b`; rewriting it would name a file that
    // does not exist.
    expect(toNativePath('/work/a\\b')).toBe('/work/a\\b');
    expect(toNativePath('/work/src/foo.ts')).toBe('/work/src/foo.ts');
  });

  it('converts fast-glob POSIX output to backslashes on Windows', () => {
    if (process.platform !== 'win32') return;
    expect(toNativePath('C:/Users/x/a.txt')).toBe('C:\\Users\\x\\a.txt');
  });

  it('agrees with path.join on this host, which is what the tool tests assert', () => {
    const expected = path.join('src', 'foo.ts');
    expect(toNativePath('src/foo.ts')).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Locating the POSIX shell on Windows. The resolver already takes an injectable
// platform + probe, so all of this is assertable on Linux.
// ---------------------------------------------------------------------------

describe('resolvePosixShells — a curated host env must not lose Bash', () => {
  const withProgramFiles = <T>(value: string | undefined, run: () => T): T => {
    const prev = process.env.ProgramFiles;
    if (value === undefined) delete process.env.ProgramFiles;
    else process.env.ProgramFiles = value;
    try {
      return run();
    } finally {
      if (prev === undefined) delete process.env.ProgramFiles;
      else process.env.ProgramFiles = prev;
    }
  };
  const found = (p: string) => p.endsWith('bash.exe');

  it('falls back to process.env for the install root', () => {
    // A hardened Electron host passes `{ PATH, HOME }` and nothing else. Before
    // the fix that produced an EMPTY candidate list on Windows, so every Bash
    // call died with "No POSIX shell found" — the Bash tool simply gone.
    const shells = withProgramFiles('C:\\Program Files', () =>
      resolvePosixShells({ PATH: 'C:\\x', HOME: 'C:\\u' }, 'win32', found),
    );
    expect(shells).toContain('C:\\Program Files\\Git\\bin\\bash.exe');
  });

  it('a caller-supplied root still wins', () => {
    const shells = withProgramFiles('C:\\Program Files', () =>
      resolvePosixShells({ ProgramFiles: 'D:\\Apps' }, 'win32', found),
    );
    expect(shells[0]).toBe('D:\\Apps\\Git\\bin\\bash.exe');
  });

  it('identical roots are probed once, not twice', () => {
    // ProgramFiles === ProgramW6432 on every 64-bit host; the probe's own
    // resolver dump showed each candidate listed twice.
    const shells = resolvePosixShells(
      { ProgramFiles: 'C:\\Program Files', ProgramW6432: 'C:\\Program Files' },
      'win32',
      found,
    );
    expect(shells).toEqual([...new Set(shells)]);
  });

  it('POSIX is untouched — bare names, no probing', () => {
    expect(resolvePosixShells({}, 'linux', () => false)).toEqual(['bash', 'sh']);
  });
});

// ---------------------------------------------------------------------------
// Directory identity (add/removeDirectories). Same canonical space as rule
// matching — found by inspection during the sweep, not by the probe: no test
// varies the spelling, so on Windows a revocation could miss its grant.
// ---------------------------------------------------------------------------

describe('directoryKey — one directory, one key', () => {
  it('POSIX keeps case and treats a backslash literally', () => {
    expect(directoryKey('/work/Data', 'linux')).not.toBe(directoryKey('/work/data', 'linux'));
    expect(directoryKey('/work/a', 'linux')).toBe(directoryKey('/work/./a', 'linux'));
  });

  it('Windows folds case and separators, so a revoke cannot miss its grant', () => {
    expect(directoryKey('C:\\Work\\Data', 'win32')).toBe(directoryKey('c:/work/data', 'win32'));
    expect(directoryKey('C:\\Work\\Data', 'win32')).not.toBe(directoryKey('C:\\Work\\Other', 'win32'));
  });
});
