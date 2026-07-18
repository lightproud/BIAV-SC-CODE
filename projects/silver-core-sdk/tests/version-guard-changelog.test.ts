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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { latestChangelogVersion, compareVersions } from '../scripts/check-version-bump.mjs';

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
