/**
 * Three-way version reconciliation for the version-bump guard (T11, lesson
 * #45 Fix(4)). The guard used to check only src/version.ts <-> package.json,
 * a two-source mutual check that goes green when BOTH sources are
 * consistently wrong - which is exactly what shipped v0.38.0 self-reporting
 * 0.37.1 (a rebase took the base side on both files; CHANGELOG.md was the
 * only source still correct). Anchoring to CHANGELOG.md's latest "## X.Y.Z"
 * heading as a third source closes that blind spot.
 *
 * These tests exercise the pure parser plus the reconciliation predicate, and
 * assert the invariant holds on the real repo right now.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  latestChangelogVersion,
  compareVersions,
  classifyBump,
  sequenceViolations,
  changelogVersions,
  KNOWN_SEQUENCE_ANOMALIES,
  VERSION_OVERRIDE_TRAILER,
} from '../scripts/check-version-bump.mjs';

const PKG = join(__dirname, '..');

describe('compareVersions (WX4-1/WX4-2 monotonic bump)', () => {
  it('orders versions numerically, not lexically', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('0.71.2', '0.71.1')).toBeGreaterThan(0);
    expect(compareVersions('0.71.1', '0.71.2')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0);
  });

  it('returns 0 for equal versions (a re-indent of the line is a no-op)', () => {
    expect(compareVersions('0.71.2', '0.71.2')).toBe(0);
    expect(compareVersions(' 0.71.2 ', '0.71.2')).toBe(0);
  });

  it('flags a revert (older <= newer) as non-forward: delta <= 0', () => {
    // WX4-1: a bump to an OLDER number must not read as forward progress.
    expect(compareVersions('0.70.0', '0.71.0')).toBeLessThan(0);
    expect(compareVersions('0.71.2', '0.71.2')).toBe(0);
  });

  it('returns null on an unparseable version', () => {
    expect(compareVersions('0.71', '0.71.2')).toBeNull();
    expect(compareVersions('latest', '0.71.2')).toBeNull();
  });
});

describe('latestChangelogVersion (CHANGELOG parse)', () => {
  it('returns the first "## X.Y.Z" heading from the top', () => {
    const changelog = [
      '# Changelog',
      '',
      '## 0.43.0 — 2026-07-10',
      'newest entry',
      '',
      '## 0.42.0 — 2026-07-09',
      'older entry',
    ].join('\n');
    expect(latestChangelogVersion(changelog)).toBe('0.43.0');
  });

  it('ignores version mentions in prose (only "## " headings count)', () => {
    // The real CHANGELOG preamble says "as of 0.41.0" / "since 0.6.2" in
    // prose above the first heading; those must never be read as the latest.
    const changelog = [
      '# Changelog',
      '',
      'Renamed as of 0.41.0; discipline in force since 0.6.2.',
      '',
      '## 0.43.0 — 2026-07-10',
      'body',
    ].join('\n');
    expect(latestChangelogVersion(changelog)).toBe('0.43.0');
  });

  it('returns null when there is no version heading', () => {
    expect(latestChangelogVersion('# Changelog\n\nno entries yet\n')).toBeNull();
  });
});

describe('three-way reconciliation predicate', () => {
  const changelogTop = (v: string) => `# Changelog\n\n## ${v} — 2026-07-10\nbody\n`;

  it('agrees when all three sources match', () => {
    const pkgVersion = '0.43.0';
    const sdkVersion = '0.43.0';
    const clVersion = latestChangelogVersion(changelogTop('0.43.0'));
    expect(sdkVersion).toBe(pkgVersion);
    expect(clVersion).toBe(pkgVersion);
  });

  it('reds the lesson #45 scenario: version.ts/package.json agree but stale', () => {
    // The exact bug: both files consistently wrong at 0.37.1, CHANGELOG at
    // 0.38.0. The two-source check passes; the CHANGELOG anchor catches it.
    const pkgVersion = '0.37.1';
    const sdkVersion = '0.37.1';
    const clVersion = latestChangelogVersion(changelogTop('0.38.0'));
    expect(sdkVersion).toBe(pkgVersion); // two-source mutual check: green
    expect(clVersion).not.toBe(pkgVersion); // three-way anchor: red
  });
});

describe('real-repo invariant (would red if drift shipped)', () => {
  it('CHANGELOG latest == package.json version == src/version.ts SDK_VERSION', () => {
    const pkgVersion = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')).version;
    const sdkVersion = readFileSync(join(PKG, 'src', 'version.ts'), 'utf8').match(
      /SDK_VERSION = '([^']+)'/,
    )?.[1];
    const clVersion = latestChangelogVersion(readFileSync(join(PKG, 'CHANGELOG.md'), 'utf8'));
    expect(sdkVersion).toBe(pkgVersion);
    expect(clVersion).toBe(pkgVersion);
  });
});

/**
 * Keeper ruling 2026-07-29 — which DIGIT a bump moves.
 *
 * "以后版本号默认动最后一个。功能级别动中间数字。首位数字只有我要求才动。"
 * (default to the last digit; feature-level moves the middle one; the first
 * one moves only when the keeper asks.)
 *
 * Only part of that is machine-checkable, and the split matters: no guard can
 * tell a fix from a feature, so "default to patch" stays a discipline the
 * author applies. What a guard CAN hold is the step SHAPE and the first-digit
 * gate — a major bump must be a deliberate, auditable line in the history
 * rather than a side effect of routine work.
 */
describe('bump classification (keeper ruling 2026-07-29)', () => {
  it('names the digit that moved', () => {
    expect(classifyBump('1.8.0', '1.8.1')).toMatchObject({ kind: 'patch', ok: true });
    expect(classifyBump('1.8.0', '1.9.0')).toMatchObject({ kind: 'minor', ok: true });
    expect(classifyBump('1.8.0', '2.0.0')).toMatchObject({ kind: 'major', ok: true });
    // Pre-1.0 is not a special case: 0.x -> 1.0.0 is still a first-digit move.
    expect(classifyBump('0.99.0', '1.0.0')).toMatchObject({ kind: 'major', ok: true });
  });

  it('rejects a skipped number — it cannot be reclaimed later', () => {
    // The family ships lockstep and consumers pin by version, so a version
    // that never existed is a permanent hole in the ledger.
    const r = classifyBump('1.8.0', '1.8.3');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('exactly 1');
  });

  it('rejects a bump whose lower digits did not reset', () => {
    // 1.9.2 straight from 1.8.0 means two edits landed, or one file was
    // hand-edited and another was not — the exact shape the three-way
    // reconciliation exists to catch, seen one step earlier.
    expect(classifyBump('1.8.0', '1.9.2')).toMatchObject({ ok: false, kind: 'minor' });
    expect(classifyBump('1.8.0', '2.1.0')).toMatchObject({ ok: false, kind: 'major' });
  });

  it('rejects a no-op and an unparseable pair rather than passing them through', () => {
    expect(classifyBump('1.8.0', '1.8.0').ok).toBe(false);
    expect(classifyBump('1.8', '1.9').ok).toBe(false);
    expect(classifyBump(undefined, '1.9.0').ok).toBe(false);
  });

  it('publishes the override trailer the guard actually looks for', () => {
    // The guard greps the commit message for this exact string; a test that
    // hardcoded its own copy would let the two drift apart silently.
    expect(VERSION_OVERRIDE_TRAILER).toBe('Version-Bump-Override:');
  });

  it('the repo\'s own current version is reachable by a clean step', () => {
    // Guards against shipping a version shape the guard itself would reject.
    const pkg = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as { version: string };
    const [maj, min, pat] = pkg.version.split('.').map(Number);
    const prior =
      pat > 0 ? `${maj}.${min}.${pat - 1}` : min > 0 ? `${maj}.${min - 1}.0` : `${maj - 1}.0.0`;
    expect(classifyBump(prior, pkg.version).ok).toBe(true);
  });
});

/**
 * Where the step-shape rule is enforced, and why it is NOT the diff.
 *
 * This repo squash-merges long branches, so one merge commit legitimately
 * spans several releases — a branch that cut 1.5.0/1.6.0/1.7.0/1.8.0 lands on
 * a main sitting at 1.4.1 as a single 1.4.1 -> 1.8.0 diff. A "single step"
 * rule applied to the diff would red every such merge, which is how this was
 * caught: main moved to 1.4.1 under a parallel PR while this branch was at
 * 1.8.0. The ledger is the squash-proof place to hold the invariant.
 */
describe('CHANGELOG version sequence (the squash-proof half)', () => {
  it("the repo's own CHANGELOG is clean apart from the frozen historical band", () => {
    const changelog = readFileSync(join(PKG, 'CHANGELOG.md'), 'utf8');
    expect(sequenceViolations(changelog)).toEqual([]);
  });

  it('catches a hole where a version number never shipped', () => {
    // 1.8.1 and 1.8.2 have no entry: a hand-edit typed 1.8.3.
    const forged = '# CL\n\n## 1.8.3 — x\n\n## 1.8.0 — x\n\n## 1.7.0 — x\n';
    const bad = sequenceViolations(forged);
    expect(bad).toHaveLength(1);
    expect(bad[0]).toContain('1.8.0->1.8.3');
  });

  it('accepts a multi-release branch: each entry is its own single step', () => {
    // The exact shape that the diff-based rule would have wrongly rejected.
    const ok = '# CL\n\n## 1.8.0 — x\n\n## 1.7.0 — x\n\n## 1.6.0 — x\n\n## 1.5.0 — x\n\n## 1.4.1 — x\n\n## 1.4.0 — x\n';
    expect(sequenceViolations(ok)).toEqual([]);
  });

  it('freezes the historical anomalies as a ratchet, not a silent skip', () => {
    // Published and pinned, so they cannot be renumbered — but the set is
    // closed: a new violation cannot hide behind them.
    expect(KNOWN_SEQUENCE_ANOMALIES.size).toBe(3);
    const changelog = readFileSync(join(PKG, 'CHANGELOG.md'), 'utf8');
    const vs = changelogVersions(changelog);
    for (const key of KNOWN_SEQUENCE_ANOMALIES) {
      const [older, newer] = key.split('->');
      expect(vs).toContain(older);
      expect(vs).toContain(newer);
    }
  });
});

/**
 * Merge commits (found by premerge_gate.py, 2026-07-29).
 *
 * The guard's diff rule assumes main's squash-merge discipline — one merge,
 * one commit, compare HEAD to HEAD~1. A real merge commit on a feature branch
 * breaks that assumption: diffing against FIRST-parent HEAD~1 attributes the
 * other parent's already-released runtime changes to this commit and demands a
 * bump for code that shipped elsewhere. Merging main's 1.4.1 into a branch at
 * 1.8.0 red-flagged a commit that introduced nothing.
 */
describe('merge-commit handling', () => {
  it('the guard exits clean on the current HEAD whatever its shape', () => {
    // Runs the real guard as a subprocess: an assertion on the pure helpers
    // would not have caught this, since the bug was in the diff plumbing.
    const r = spawnSync(process.execPath, [join(PKG, 'scripts/check-version-bump.mjs')], {
      cwd: PKG,
      encoding: 'utf8',
    });
    expect(r.stderr + r.stdout).not.toContain('FAILED');
    expect(r.status).toBe(0);
  });

  it('states that standing invariants are NOT part of the skip', () => {
    // The skip covers the diff rule only. If it ever swallowed the three-way
    // reconciliation or the sequence check, a merge commit would become a hole
    // big enough to ship a mismatched version through.
    const src = readFileSync(join(PKG, 'scripts/check-version-bump.mjs'), 'utf8');
    const mergeSkip = src.slice(src.indexOf('parentCount > 1'));
    expect(mergeSkip).toContain('Standing invariants');
    // The sequence + three-way checks must be positioned BEFORE the skip.
    expect(src.indexOf('sequenceViolations(changelog)')).toBeLessThan(
      src.indexOf('parentCount > 1'),
    );
  });
});
