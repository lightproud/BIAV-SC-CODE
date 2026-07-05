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
 * Runs in CI against the merge commit (squash-merge discipline: one merge =
 * one commit on main): compares HEAD to HEAD~1. Tolerant by design - when
 * the diff cannot be computed (shallow clone without a parent, repo root
 * mismatch), it reports and exits 0 rather than red-flagging unrelated CI.
 *
 * Usage: node scripts/check-version-bump.mjs  (cwd: projects/bpt-agent-sdk)
 */

import { execSync } from 'node:child_process';

const PKG_DIR_RE = /^projects\/bpt-agent-sdk\//;

function git(args) {
  return execSync(`git ${args}`, { encoding: 'utf8' }).trim();
}

let changed;
try {
  changed = git('diff --name-only HEAD~1 HEAD').split('\n').filter(Boolean);
} catch {
  console.log('version-bump guard: cannot diff HEAD~1 (shallow/root commit) - skipping.');
  process.exit(0);
}

const runtimeChanged = changed.some(
  (f) => PKG_DIR_RE.test(f) && /^projects\/bpt-agent-sdk\/src\//.test(f),
);

let depsChanged = false;
let versionChanged = false;
if (changed.includes('projects/bpt-agent-sdk/package.json')) {
  const patch = git('diff HEAD~1 HEAD -- projects/bpt-agent-sdk/package.json');
  versionChanged = /^[+-]\s*"version":/m.test(patch);
  depsChanged = /^[+-]\s*"[^"]+":\s*"[^"]+"/m.test(
    patch
      .split('\n')
      .filter((l) => /"(dependencies|devDependencies)"/.test(l) || /^[+-]/.test(l))
      .join('\n'),
  ) && /"dependencies"|"devDependencies"/.test(patch);
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
    '(projects/bpt-agent-sdk/src/ or dependencies) but package.json "version" ' +
    'is unchanged. Consumers pin npm-pack tarballs BY VERSION - same-version ' +
    'different-content builds cannot be pinned, rolled back, or audited. ' +
    'Bump patch for fixes, minor for new capability, and add a CHANGELOG.md line.',
);
process.exit(1);
