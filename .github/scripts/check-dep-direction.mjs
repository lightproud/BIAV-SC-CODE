#!/usr/bin/env node
/**
 * Dependency-direction guard for the BIAV SDK monorepo (SCS-REQ
 * orchestrator-sdk §2, keeper ruling 2026-07-17).
 *
 * The contract is one-way: orchestrator -> agent.
 *
 *  A. The agent SDK (projects/silver-core-sdk) must never import the
 *     orchestrator package, by name or by relative path, anywhere (src,
 *     tests, examples, scripts). It must not even know it exists.
 *  B. The orchestrator SDK (projects/orchestrator-sdk) may import ONLY the
 *     agent package's public surface: the bare specifier '@biav/agent-sdk'.
 *     Deep subpath imports ('@biav/agent-sdk/dist/...'), the retired npm name
 *     ('silver-core-sdk'), and relative paths that escape into the agent
 *     package's sources are privileged channels — hard property §1.2 says any
 *     such need is a hole in the agent-side R1-R5 surface, to be fixed there.
 *  C. The agent package.json must not declare the orchestrator in any
 *     dependency block.
 *
 * Exit 1 with a listing on any violation; exit 0 otherwise.
 * Run from the repo root: node .github/scripts/check-dep-direction.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname, sep } from 'node:path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const AGENT_DIR = join(ROOT, 'projects', 'silver-core-sdk');
const ORCH_DIR = join(ROOT, 'projects', 'orchestrator-sdk');

const SOURCE_EXT = /\.(mts|cts|ts|tsx|mjs|cjs|js)$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.stryker-tmp', 'coverage']);

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const p = join(dir, name);
    const st = statSync(p, { throwIfNoEntry: false });
    if (!st) continue;
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) yield* walk(p);
    } else if (SOURCE_EXT.test(name)) {
      yield p;
    }
  }
}

/** Extract module specifiers from import/export-from/require/dynamic-import. */
function specifiersOf(text) {
  const out = [];
  const patterns = [
    /\bimport\s+[^'"]*?from\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bexport\s+[^'"]*?from\s*['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) out.push(m[1]);
  }
  return out;
}

const violations = [];

function flag(file, spec, why) {
  violations.push(`${relative(ROOT, file)} -> '${spec}': ${why}`);
}

// A. Agent side: must not reference the orchestrator at all.
for (const file of walk(AGENT_DIR)) {
  const text = readFileSync(file, 'utf8');
  for (const spec of specifiersOf(text)) {
    if (spec === '@biav/orchestrator-sdk' || spec.startsWith('@biav/orchestrator-sdk/')) {
      flag(file, spec, 'agent SDK importing the orchestrator (reverse dependency)');
    } else if (spec.startsWith('.')) {
      const target = resolve(dirname(file), spec);
      if ((target + sep).startsWith(ORCH_DIR + sep) || target === ORCH_DIR) {
        flag(file, spec, 'agent SDK reaching into the orchestrator package by path');
      }
    }
  }
}

// B. Orchestrator side: bare '@biav/agent-sdk' only.
for (const file of walk(ORCH_DIR)) {
  const text = readFileSync(file, 'utf8');
  for (const spec of specifiersOf(text)) {
    if (spec.startsWith('@biav/agent-sdk/')) {
      flag(file, spec, "deep import into the agent package (public surface = bare '@biav/agent-sdk' only)");
    } else if (spec === 'silver-core-sdk' || spec.startsWith('silver-core-sdk/')) {
      flag(file, spec, 'retired npm name (renamed @biav/agent-sdk in monorepo phase 0)');
    } else if (spec.startsWith('.')) {
      const target = resolve(dirname(file), spec);
      if ((target + sep).startsWith(AGENT_DIR + sep) || target === AGENT_DIR) {
        flag(file, spec, 'relative path escaping into the agent package (privileged channel)');
      }
    }
  }
}

// C. Agent package.json: no dependency block may name the orchestrator.
const agentPkg = JSON.parse(readFileSync(join(AGENT_DIR, 'package.json'), 'utf8'));
for (const block of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
  if (agentPkg[block] && '@biav/orchestrator-sdk' in agentPkg[block]) {
    violations.push(`projects/silver-core-sdk/package.json ${block}: declares @biav/orchestrator-sdk (reverse dependency)`);
  }
}

if (violations.length > 0) {
  console.error('dep-direction: FAIL — the orchestrator -> agent one-way contract is violated:\n');
  for (const v of violations) console.error('  ' + v);
  console.error(`\n${violations.length} violation(s). See SCS-REQ orchestrator-sdk §2.`);
  process.exit(1);
}
console.log('dep-direction: OK (orchestrator -> agent one-way contract holds)');
