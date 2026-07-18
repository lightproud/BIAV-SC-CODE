#!/usr/bin/env node
/**
 * Version-bump guard (2026-07-05, BPT consumer request: three different
 * builds shipped as identical "0.6.0" tarballs - same name, different goods;
 * no pinning, no rollback, no audit trail on the consumer side).
 *
 * Rule enforced: a commit that changes SHIPPED RUNTIME content (src/** of
 * this package, or package.json dependencies) must also change
 * package.json's version. Docs/tests/CI-only changes need no bump.
 *
 * Three-way version reconciliation (standing invariants, checked on every
 * run regardless of the diff): package.json "version", src/version.ts
 * SDK_VERSION, and the latest "## X.Y.Z" heading in CHANGELOG.md must all
 * agree. The two-source (version.ts <-> package.json) mutual check alone
 * cannot catch a "consistently wrong" pair - lesson #45: v0.38.0 shipped
 * self-reporting SDK_VERSION 0.37.1 because a rebase took the base side on
 * BOTH files while CHANGELOG.md correctly said 0.38.0; the two files agreed
 * with each other on the stale number and the guard went green. Anchoring to
 * CHANGELOG's latest entry as the third source closes that blind spot and, as
 * a bonus, enforces the "add one CHANGELOG line per bump" half of the
 * discipline that was previously unchecked.
 *
 * Runs in CI against the merge commit (squash-merge discipline: one merge =
 * one commit on main): compares HEAD to HEAD~1. Tolerant by design for the
 * diff portion - when the diff cannot be computed (shallow clone without a
 * parent, repo root mismatch), it reports and exits 0 rather than
 * red-flagging unrelated CI. The three-way reconciliation is NOT tolerant:
 * package.json / src/version.ts / CHANGELOG.md are present in every checkout
 * regardless of fetch-depth, so a mismatch there is always a real defect.
 *
 * Usage: node scripts/check-version-bump.mjs  (cwd: projects/silver-core-sdk)
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const PKG_DIR_RE = /^projects\/silver-core-sdk\//;

/**
 * The latest released version declared in CHANGELOG.md: the first "## X.Y.Z"
 * heading scanning from the top. The rename preamble mentions versions in
 * prose ("as of 0.41.0", "since 0.6.2") but those are never "## " headings,
 * so they cannot be mistaken for the latest entry. Returns null when the text
 * has no version heading at all.
 *
 * Exported (and the executable body is gated behind the main-module check
 * below) so tests can exercise the parse without running the guard.
 */
export function latestChangelogVersion(changelogText) {
  const m = changelogText.match(/^##\s+(\d+\.\d+\.\d+)\b/m);
  return m ? m[1] : null;
}

/**
 * Compare two `X.Y.Z` version strings numerically (WX4-1/WX4-2, audit r3).
 * Returns >0 when a is newer, <0 when older, 0 when equal; null when either
 * side is unparseable. Numeric per-component compare (not string compare) so
 * 0.10.0 correctly sorts after 0.9.0, and a pure-whitespace reformat of the
 * version LINE is a no-op because only the parsed value is considered.
 */
export function compareVersions(a, b) {
  const parse = (v) => {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? '').trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const pa = parse(a);
  const pb = parse(b);
  if (pa === null || pb === null) return null;
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

function git(args) {
  return execSync(`git ${args}`, { encoding: 'utf8' }).trim();
}

function runGuard() {
  // --- three-way version reconciliation (standing invariants) -------------
  // Source of truth is package.json "version"; version.ts and CHANGELOG.md
  // must both agree with it. Any disagreement reds immediately, independent
  // of the diff logic that follows.
  let pkgVersion;
  try {
    pkgVersion = JSON.parse(readFileSync('package.json', 'utf8')).version;
    const versionTs = readFileSync('src/version.ts', 'utf8');
    const m = versionTs.match(/SDK_VERSION = '([^']+)'/);
    if (m === null || m[1] !== pkgVersion) {
      console.error(
        `version-bump guard FAILED: src/version.ts SDK_VERSION (${m?.[1] ?? 'missing'}) ` +
          `!= package.json version (${pkgVersion}). Keep them identical in the same commit.`,
      );
      process.exit(1);
    }
  } catch (err) {
    console.error(`version-bump guard FAILED: cannot verify src/version.ts sync: ${err}`);
    process.exit(1);
  }

  // CHANGELOG.md latest entry is the third source (lesson #45 Fix(4)): it
  // caught nothing before, yet it is the one file a mistaken rebase left
  // CORRECT while both version.ts and package.json went stale together.
  try {
    const changelog = readFileSync('CHANGELOG.md', 'utf8');
    const clVersion = latestChangelogVersion(changelog);
    if (clVersion === null) {
      console.error(
        'version-bump guard FAILED: no "## X.Y.Z" version entry found in CHANGELOG.md. ' +
          'Every release adds a "## <version>" heading; without one the ledger cannot be reconciled.',
      );
      process.exit(1);
    }
    if (clVersion !== pkgVersion) {
      console.error(
        `version-bump guard FAILED: CHANGELOG.md latest entry (${clVersion}) ` +
          `!= package.json version (${pkgVersion}). Every version bump adds a matching ` +
          `"## <version>" CHANGELOG entry; a mismatch means the shipped runtime version and ` +
          `the consumer-facing ledger disagree (lesson #45: v0.38.0 shipped self-reporting ` +
          `0.37.1 straight past the two-source mutual check - the CHANGELOG was the only ` +
          `source still correct).`,
      );
      process.exit(1);
    }
  } catch (err) {
    console.error(`version-bump guard FAILED: cannot verify CHANGELOG.md sync: ${err}`);
    process.exit(1);
  }

  // --- diff-based "runtime change needs a bump" logic ---------------------
  // WX4-3 (audit r3): only a MISSING parent (shallow clone / root commit) is a
  // benign skip. A real git failure (corrupt object, not-a-repo) must NOT be
  // swallowed as exit 0 — that silently disables the guard. Probe for the
  // parent first; if it exists but the diff still throws, that is a real error.
  let hasParent = false;
  try {
    git('rev-parse --verify --quiet HEAD~1');
    hasParent = true;
  } catch {
    hasParent = false;
  }
  if (!hasParent) {
    console.log('version-bump guard: no HEAD~1 parent (shallow/root commit) - skipping diff.');
    process.exit(0);
  }
  let changed;
  try {
    changed = git('diff --name-only HEAD~1 HEAD').split('\n').filter(Boolean);
  } catch (err) {
    console.error(
      `version-bump guard FAILED: HEAD~1 exists but the diff could not be computed: ${err}. ` +
        'This is a real git error, not a shallow clone — not skipping.',
    );
    process.exit(1);
  }

  const runtimeChanged = changed.some(
    (f) => PKG_DIR_RE.test(f) && /^projects\/silver-core-sdk\/src\//.test(f),
  );

  // Parse the package.json "version" at a revision (WX4-2: compare parsed
  // VALUES, never a patch-line regex that a re-indent would false-trigger).
  const versionOf = (rev) => {
    try {
      return JSON.parse(git(`show ${rev}:projects/silver-core-sdk/package.json`)).version ?? null;
    } catch {
      return null;
    }
  };

  let depsChanged = false;
  let versionChanged = false;
  if (changed.includes('projects/silver-core-sdk/package.json')) {
    const versionBefore = versionOf('HEAD~1');
    const versionAfter = versionOf('HEAD');
    versionChanged =
      versionBefore !== null && versionAfter !== null && versionBefore !== versionAfter;
    // WX4-1 (audit r3): a bump must move the version FORWARD. A revert to an
    // older number (all three sources consistently stale) otherwise satisfies
    // the "version line differs" check and ships forked content under a reused
    // tag. Require a strict semver increase.
    if (versionChanged) {
      const delta = compareVersions(versionAfter, versionBefore);
      if (delta !== null && delta <= 0) {
        console.error(
          `version-bump guard FAILED: package.json version went from ${versionBefore} to ` +
            `${versionAfter} — a bump must INCREASE the version, never revert/reuse. Consumers ` +
            'pin tarballs by version; a non-monotonic version reuses a tag for different goods.',
        );
        process.exit(1);
      }
    }
    // Consumer-affecting deps are the runtime "dependencies" ONLY: devDependencies
    // ship in no tarball and are never installed by a consumer, so a devDep-only
    // change (e.g. bumping vitest/typescript) must NOT force a version bump.
    // Compare the PARSED `dependencies` object across the two revisions instead
    // of pattern-matching a flat patch — where "dependencies" is also a
    // substring of "devDependencies" and the two blocks' +/- lines are
    // indistinguishable, so a devDep-only change false-failed the guard.
    const runtimeDepsOf = (rev) => {
      try {
        const json = JSON.parse(git(`show ${rev}:projects/silver-core-sdk/package.json`));
        return JSON.stringify(json.dependencies ?? {});
      } catch {
        return null; // revision/file unavailable (shallow clone): unknown
      }
    };
    const depsBefore = runtimeDepsOf('HEAD~1');
    const depsAfter = runtimeDepsOf('HEAD');
    depsChanged = depsBefore !== null && depsAfter !== null && depsBefore !== depsAfter;
  }

  if (!runtimeChanged && !depsChanged) {
    console.log('version-bump guard: no shipped-runtime change in this commit - OK.');
    process.exit(0);
  }
  if (versionChanged) {
    console.log('version-bump guard: runtime changed AND version bumped - OK.');
    process.exit(0);
  }
  console.error(
    'version-bump guard FAILED: this commit changes shipped runtime content ' +
      '(projects/silver-core-sdk/src/ or dependencies) but package.json "version" ' +
      'is unchanged. Consumers pin npm-pack tarballs BY VERSION - same-version ' +
      'different-content builds cannot be pinned, rolled back, or audited. ' +
      'Bump patch for fixes, minor for new capability, and add a CHANGELOG.md line.',
  );
  process.exit(1);
}

// Run the guard only when executed as a script; stay side-effect-free when
// imported (so tests can import latestChangelogVersion without the guard
// reading files / diffing / calling process.exit).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runGuard();
}
