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

/**
 * Classify a bump as major / minor / patch, or report WHY it is not a clean
 * single step (keeper ruling 2026-07-29).
 *
 * The keeper's rule: the LAST digit is the default (fixes), the MIDDLE digit
 * is for feature-level change, and the FIRST digit moves only when the keeper
 * asks. Only part of that is machine-checkable — no guard can tell a fix from
 * a feature, so "default to patch" stays a discipline the author applies. What
 * IS checkable is the shape of the step, and that is what this enforces:
 *
 *   - exactly one component increases,
 *   - by exactly one,
 *   - and every component below it resets to 0.
 *
 * So 1.8.0 -> 1.8.1 / 1.9.0 / 2.0.0 are clean; 1.8.0 -> 1.8.3 (skipped a
 * number), 1.8.0 -> 2.1.0 (two components moved), and 1.8.0 -> 1.9.2 (lower
 * component did not reset) are not. Those shapes are almost always a typo or a
 * hand-edit that missed a file — the family ships lockstep, so a skipped
 * number cannot be silently reclaimed later.
 *
 * Returns {kind, ok, reason}. Pure; exported for tests.
 */
export function classifyBump(before, after) {
  const parse = (v) => {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? '').trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const a = parse(before);
  const b = parse(after);
  if (a === null || b === null) {
    return { kind: null, ok: false, reason: `unparseable version pair (${before} -> ${after})` };
  }
  const names = ['major', 'minor', 'patch'];
  const moved = [0, 1, 2].filter((i) => a[i] !== b[i]);
  if (moved.length === 0) return { kind: null, ok: false, reason: 'version did not change' };
  const first = moved[0];
  if (b[first] !== a[first] + 1) {
    return {
      kind: names[first],
      ok: false,
      reason: `${names[first]} went ${a[first]} -> ${b[first]}; a bump moves it by exactly 1`,
    };
  }
  for (let i = first + 1; i < 3; i += 1) {
    if (b[i] !== 0) {
      return {
        kind: names[first],
        ok: false,
        reason: `${names[first]} bumped but ${names[i]} is ${b[i]}, not reset to 0`,
      };
    }
  }
  return { kind: names[first], ok: true, reason: '' };
}

/**
 * Historical non-single-step pairs already in CHANGELOG.md, frozen as a
 * RATCHET rather than skipped silently: the 0.35-0.37 band is genuinely out of
 * order (0.37.0 sits below 0.36.0, and 0.37.1 exists without 0.37.0 preceding
 * it), the same era lesson #45 came from. They are published and pinned, so
 * they cannot be renumbered — but no NEW pair may join them.
 */
export const KNOWN_SEQUENCE_ANOMALIES = new Set([
  '0.36.0->0.37.1',
  '0.37.0->0.36.0',
  '0.35.0->0.37.0',
]);

/**
 * Every "## X.Y.Z" heading in CHANGELOG.md, newest first.
 */
export function changelogVersions(changelogText) {
  return [...changelogText.matchAll(/^##\s+(\d+\.\d+\.\d+)\b/gm)].map((m) => m[1]);
}

/**
 * The step-shape invariant, checked where it is squash-merge-proof: adjacent
 * CHANGELOG entries must each be a clean single step (keeper ruling
 * 2026-07-29).
 *
 * Checking shape against the DIFF cannot work in this repo — a squash merge of
 * a long branch legitimately moves several releases at once. The ledger is the
 * right place: it lists every version that ever existed, so a hole in it is
 * exactly the defect worth catching. A hand-edit that types 1.8.3 where 1.8.1
 * belonged leaves 1.8.1 and 1.8.2 with no entry, and a number that never
 * shipped cannot be reclaimed later — the family ships lockstep and consumers
 * pin tarballs by version.
 *
 * Returns the offending "older->newer" pairs, minus the frozen historical set.
 */
export function sequenceViolations(changelogText) {
  const vs = changelogVersions(changelogText);
  const out = [];
  for (let i = 0; i < vs.length - 1; i += 1) {
    const older = vs[i + 1];
    const newer = vs[i];
    const key = `${older}->${newer}`;
    if (KNOWN_SEQUENCE_ANOMALIES.has(key)) continue;
    const r = classifyBump(older, newer);
    if (!r.ok) out.push(`${key} (${r.reason})`);
  }
  return out;
}

/** The commit-message trailer that authorizes a first-digit (major) bump or a
 *  non-single-step version move. This is an HONESTY mechanism, not a security
 *  boundary — whoever writes the commit writes the trailer. It exists so the
 *  first digit cannot move as a side effect of routine work: moving it becomes
 *  a deliberate, auditable line in the history that names the keeper's ruling. */
export const VERSION_OVERRIDE_TRAILER = 'Version-Bump-Override:';

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
    const seqBad = sequenceViolations(changelog);
    if (seqBad.length > 0) {
      console.error(
        `version-bump guard FAILED: CHANGELOG.md version sequence has ${seqBad.length} ` +
          `non-single-step pair(s): ${seqBad.join('; ')}. Keeper ruling 2026-07-29 — a bump ` +
          'moves exactly ONE digit by exactly one and resets everything below it. A gap here ' +
          'means a version number that never shipped, and it cannot be reclaimed later: the ' +
          'family ships lockstep and consumers pin tarballs by version.',
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
  // The parent probe alone cannot tell "root/shallow commit" from "git is
  // unusable here" — `git rev-parse` exits non-zero for BOTH, so a run outside
  // a repository (exported tree, missing git binary) took the benign skip and
  // exited 0 with the guard doing nothing. Establish that we are in a repo
  // first; only then is a missing HEAD~1 the documented benign case.
  try {
    git('rev-parse --git-dir');
  } catch (err) {
    console.error(
      `version-bump guard FAILED: git is not usable in this directory: ${err}. ` +
        'This is not a shallow clone — the guard cannot verify anything here, so it must not report green.',
    );
    process.exit(1);
  }
  // A MERGE commit ships no NEW runtime content: every line in it came from a
  // parent that already went through this guard on its own branch. Diffing it
  // against first-parent HEAD~1 misattributes the OTHER parent's already-
  // released code to this commit and demands a bump for it — which is exactly
  // what happened merging main's 1.4.1 (#878) into a branch sitting at 1.8.0:
  // the merge carried in released runtime changes with no version move, and
  // the guard red-flagged a commit that introduced nothing.
  //
  // This does not weaken CI on main. Main is squash-merge only (one merge =
  // one commit, stated at the top of this file), so a merge commit never
  // appears there; this path is reachable from a feature branch and from
  // premerge_gate.py. The standing invariants above — three-way reconciliation
  // and the CHANGELOG sequence — run regardless and are NOT skipped here.
  let parentCount = 0;
  try {
    parentCount = git('rev-list --parents -n 1 HEAD').trim().split(/\s+/).length - 1;
  } catch {
    parentCount = 0;
  }
  if (parentCount > 1) {
    console.log(
      `version-bump guard: HEAD is a merge commit (${parentCount} parents) - its runtime ` +
        'content came from parents already guarded on their own branches; skipping the diff ' +
        'rule. Standing invariants (three-way sync, CHANGELOG sequence) checked and OK.',
    );
    process.exit(0);
  }
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
      // Keeper ruling 2026-07-29: patch by default, minor for feature-level
      // change, major only when the keeper asks. The step SHAPE and the
      // first-digit gate are the machine-checkable half; which of patch/minor
      // a change deserves is the author's call and no guard can make it.
      // NOTE on scope: the STEP SHAPE is deliberately NOT checked here against
      // the diff. This repo squash-merges long branches, so one merge commit
      // legitimately spans several releases (1.4.1 -> 1.8.0 when a branch cut
      // 1.5.0/1.6.0/1.7.0/1.8.0 along the way) — a "single step" rule on the
      // diff would red every such merge. Shape is enforced where it is
      // actually meaningful and squash-proof: on CHANGELOG.md's own version
      // sequence, above.
      const bump = classifyBump(versionBefore, versionAfter);
      let commitMsg = '';
      try {
        commitMsg = git('log -1 --format=%B HEAD');
      } catch {
        commitMsg = '';
      }
      const overridden = commitMsg.includes(VERSION_OVERRIDE_TRAILER);
      if (bump.kind === 'major' && !overridden) {
        console.error(
          `version-bump guard FAILED: ${versionBefore} -> ${versionAfter} moves the FIRST ` +
            'digit. Keeper ruling 2026-07-29: the first digit moves only when the keeper asks ' +
            '— patch is the default, minor is for feature-level change. If the keeper did ask, ' +
            `record it: add a "${VERSION_OVERRIDE_TRAILER} <keeper ruling>" trailer to the ` +
            'commit message so the history says who authorized it.',
        );
        process.exit(1);
      }
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
      'Keeper ruling 2026-07-29: bump the LAST digit by default (fixes), the MIDDLE digit ' +
      'for feature-level change, and the FIRST digit only when the keeper asks. ' +
      'Add a matching CHANGELOG.md line.',
  );
  process.exit(1);
}

// Run the guard only when executed as a script; stay side-effect-free when
// imported (so tests can import latestChangelogVersion without the guard
// reading files / diffing / calling process.exit).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runGuard();
}
