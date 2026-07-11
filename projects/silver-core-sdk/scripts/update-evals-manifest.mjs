#!/usr/bin/env node
/**
 * Regenerate evals/MANIFEST.sha256 (SCS-REQ-002 REQ-2.1 tamper evidence).
 *
 * The eval set is maintainer-curated: agents must not modify evals/ (the
 * "don't rewrite the exam" red line). Any legitimate keeper edit is made
 * deliberate by requiring this regeneration step; an edit without it turns
 * tests/evals-governance.test.ts red. Phase 3 additionally wires a CI
 * hard-reject for agent-authored PRs touching evals/.
 *
 * Usage: node scripts/update-evals-manifest.mjs
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const evalsDir = join(root, 'evals');
const manifestPath = join(evalsDir, 'MANIFEST.sha256');

/** Recursively list files under dir, skipping the manifest itself. */
export function listEvalFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...listEvalFiles(p));
    else if (p !== manifestPath) out.push(p);
  }
  return out.sort();
}

export function buildManifest() {
  return (
    listEvalFiles(evalsDir)
      .map((p) => {
        const hash = createHash('sha256').update(readFileSync(p)).digest('hex');
        return `${hash}  ${relative(evalsDir, p).split('\\').join('/')}`;
      })
      .join('\n') + '\n'
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(manifestPath, buildManifest());
  console.log(`evals/MANIFEST.sha256 regenerated (${buildManifest().trim().split('\n').length} files).`);
}
