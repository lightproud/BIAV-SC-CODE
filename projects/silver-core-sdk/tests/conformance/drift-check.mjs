/**
 * Drift sentinel (conformance suite M3, B3).
 *
 * WHY: the conformance baseline is dual-pinned (tests/conformance/pins.json)
 * because the official claude-code engine is a moving target. This script
 * answers ONE question on a weekly beat: "has upstream published past our
 * pins?" It is REPORT-ONLY by standing rule (blueprint 选择性追踪): the pins
 * move ONLY by keeper ruling after a manual conformance re-run against the
 * candidate versions. No auto-bump, no commit, no issue - drift is
 * information, not failure.
 *
 * Lookup strategy (CI runners do not reliably honor proxy env for bare
 * fetch): plain fetch to registry.npmjs.org first; if that fails, retry via
 * undici's EnvHttpProxyAgent (only if undici is resolvable); if that fails,
 * fall back to `npm view <pkg> version` which has its own proxy handling.
 *
 * Usage:
 *   node tests/conformance/drift-check.mjs [--out=path.md]
 *     [--github-output] [--emit-proposed-pins=path.json]
 *
 *   --github-output          append drift/candidate facts to $GITHUB_OUTPUT so
 *                            the workflow can decide whether to open a draft PR
 *                            (keys: drift, lookup_failed, agent_sdk_latest,
 *                            claude_code_latest).
 *   --emit-proposed-pins=P   when (and only when) drift is detected, write a
 *                            PROPOSED pins.json to P with the candidate latest
 *                            versions and a PROPOSED-not-ratified comment. It
 *                            still moves nothing on its own — the keeper rules
 *                            after a conformance re-run against the candidates.
 *   --emit-pr-body=P         when (and only when) drift is detected, write the
 *                            markdown body of the auto-drafted alignment PR to P
 *                            (kept in JS to avoid fragile shell heredocs).
 *
 * Exit semantics: 0 when every lookup succeeded (drifted or not - the report
 * carries the verdict); 2 when any lookup failed through all three fallbacks
 * (the sentinel itself is blind, which IS a failure of the check).
 */

import { execSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);

const pins = JSON.parse(readFileSync(join(HERE, 'pins.json'), 'utf8'));

/** Pin-file key -> npm package name, mirroring the dual-pin design (§1). */
const PACKAGES = [
  { key: 'agentSdk', pkg: '@anthropic-ai/claude-agent-sdk' },
  { key: 'claudeCode', pkg: '@anthropic-ai/claude-code' },
];

/**
 * Extract the version from a registry `/latest` document, tolerating both
 * response shapes the registry serves (full doc vs. abbreviated).
 */
function versionFromDoc(doc) {
  const v = doc?.version;
  if (typeof v !== 'string' || v.length === 0) throw new Error('registry document has no version field');
  return v;
}

async function fetchLatestPlain(pkg) {
  const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`);
  if (!res.ok) throw new Error(`registry HTTP ${res.status}`);
  return versionFromDoc(await res.json());
}

async function fetchLatestViaProxyAgent(pkg) {
  // undici is not a repo dependency; resolve it dynamically and let the
  // import failure fall through to the npm-subprocess fallback.
  const { EnvHttpProxyAgent } = await import('undici');
  const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`, {
    dispatcher: new EnvHttpProxyAgent(),
  });
  if (!res.ok) throw new Error(`registry HTTP ${res.status} (via proxy agent)`);
  return versionFromDoc(await res.json());
}

function fetchLatestViaNpm(pkg) {
  const out = execSync(`npm view ${pkg} version`, {
    encoding: 'utf8',
    timeout: 60_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  if (!/^\d+\.\d+\.\d+/.test(out)) throw new Error(`npm view returned unparseable output: ${out.slice(0, 80)}`);
  return out;
}

/** Try the three lookup paths in order; return { version } or { error }. */
async function lookupLatest(pkg) {
  const errors = [];
  for (const [label, fn] of [
    ['plain fetch', () => fetchLatestPlain(pkg)],
    ['fetch+EnvHttpProxyAgent', () => fetchLatestViaProxyAgent(pkg)],
    ['npm view subprocess', () => fetchLatestViaNpm(pkg)],
  ]) {
    try {
      return { version: await fn(), via: label };
    } catch (err) {
      errors.push(`${label}: ${String(err?.message ?? err).slice(0, 160)}`);
    }
  }
  return { error: errors.join(' | ') };
}

const rows = [];
let lookupFailures = 0;
for (const { key, pkg } of PACKAGES) {
  const pinned = pins[key];
  const latest = await lookupLatest(pkg);
  if (latest.error) {
    lookupFailures += 1;
    rows.push({ pkg, pinned, latest: null, drift: null, note: latest.error });
  } else {
    rows.push({ pkg, pinned, latest: latest.version, drift: latest.version !== pinned, note: `via ${latest.via}` });
  }
}

const anyDrift = rows.some((r) => r.drift === true);
const lines = [
  '## Conformance pin drift report',
  '',
  `Generated: ${new Date().toISOString()}`,
  '',
  '| package | pinned | latest | drift |',
  '|---|---|---|---|',
  ...rows.map((r) => `| ${r.pkg} | ${r.pinned} | ${r.latest ?? 'LOOKUP FAILED'} | ${r.drift === null ? 'unknown' : r.drift} |`),
  '',
  lookupFailures > 0
    ? `LOOKUP FAILURE: ${rows.filter((r) => r.drift === null).map((r) => `${r.pkg} (${r.note})`).join('; ')}`
    : anyDrift
      ? 'DRIFT DETECTED - report-only by standing rule (选择性追踪): pins move ONLY by keeper ruling after a manual conformance re-run against the candidate versions. No auto-bump.'
      : 'No drift: pinned versions are the latest published.',
  '',
];
const report = lines.join('\n');

console.log(report);
if (typeof args.out === 'string') {
  writeFileSync(args.out, report);
  console.log(`report written: ${args.out}`);
}

/** Look up the candidate (latest) version for one pin key from the rows. */
function latestFor(key) {
  const pkg = PACKAGES.find((p) => p.key === key)?.pkg;
  return rows.find((r) => r.pkg === pkg)?.latest ?? null;
}

// --github-output: machine-readable facts for the workflow's PR-draft gate.
if (args['github-output'] && typeof process.env.GITHUB_OUTPUT === 'string') {
  const out = [
    `drift=${anyDrift && lookupFailures === 0 ? 'true' : 'false'}`,
    `lookup_failed=${lookupFailures > 0 ? 'true' : 'false'}`,
    `agent_sdk_latest=${latestFor('agentSdk') ?? ''}`,
    `claude_code_latest=${latestFor('claudeCode') ?? ''}`,
  ].join('\n');
  appendFileSync(process.env.GITHUB_OUTPUT, `${out}\n`);
}

// --emit-proposed-pins: write a PROPOSED pins.json (candidate versions) ONLY on
// clean-lookup drift. This is the alignment-PR draft body; it ratifies nothing.
if (
  typeof args['emit-proposed-pins'] === 'string' &&
  anyDrift &&
  lookupFailures === 0
) {
  const agentSdk = latestFor('agentSdk') ?? pins.agentSdk;
  const claudeCode = latestFor('claudeCode') ?? pins.claudeCode;
  const proposed = {
    comment:
      `PROPOSED chase ${pins.agentSdk} -> ${agentSdk} / ${pins.claudeCode} -> ${claudeCode}, ` +
      `auto-drafted by the drift sentinel on ${new Date().toISOString()}. ` +
      `NOT RATIFIED: the standing rule (选择性追踪) is that pins move ONLY by keeper ruling ` +
      `after a conformance re-run against these candidates. Merging this PR is that ruling; ` +
      `do not merge until the conformance suite (L1-L4 + ratchet) has run green against these ` +
      `versions. Prior comment preserved below.\nPRIOR: ${pins.comment}`,
    agentSdk,
    claudeCode,
  };
  writeFileSync(args['emit-proposed-pins'], `${JSON.stringify(proposed, null, 2)}\n`);
  console.log(`proposed pins written: ${args['emit-proposed-pins']}`);
}

// --emit-pr-body: markdown body of the auto-drafted alignment PR (drift only).
if (
  typeof args['emit-pr-body'] === 'string' &&
  anyDrift &&
  lookupFailures === 0
) {
  const agentSdk = latestFor('agentSdk') ?? pins.agentSdk;
  const claudeCode = latestFor('claudeCode') ?? pins.claudeCode;
  const body = [
    '## Auto-drafted alignment proposal (drift sentinel)',
    '',
    'The weekly drift sentinel detected that upstream has published past the',
    'conformance pins:',
    '',
    `- \`@anthropic-ai/claude-agent-sdk\`: **${pins.agentSdk} -> ${agentSdk}**`,
    `- \`@anthropic-ai/claude-code\`: **${pins.claudeCode} -> ${claudeCode}**`,
    '',
    'This **draft** bumps `projects/silver-core-sdk/tests/conformance/pins.json` to',
    'those candidates with a PROPOSED-not-ratified comment. It ratifies nothing.',
    '',
    '### Standing rule (选择性追踪) — unchanged',
    'Pins move ONLY by keeper ruling after a conformance re-run against the',
    'candidates. **Merging this PR is that ruling.**',
    '',
    '### How to rule',
    '1. Trigger the `conformance` job against this branch (push any commit, or',
    '   re-run the `Silver Core SDK` workflow). Because this branch\'s pins.json is',
    '   already the candidates, that job installs the candidate official arm and',
    '   runs L1-L4 + the ratchet against them. (A PR opened by the bot token does',
    '   not auto-start CI; a human push does.)',
    '2. Green ratchet -> candidates introduce no new divergences -> mark ready +',
    '   merge to ratify the chase (also re-run any budgeted L5). Red ratchet ->',
    '   candidates need engine alignment first -> keep this draft, do the work,',
    '   then re-run.',
    '',
    '_Auto-generated weekly; force-refreshed to the latest candidates each run.',
    'Close it to decline the chase._',
    '',
  ].join('\n');
  writeFileSync(args['emit-pr-body'], body);
  console.log(`PR body written: ${args['emit-pr-body']}`);
}

// Exit semantics: drift is information (0); a blind sentinel is a failed
// check (2). Never 1 - that band is reserved for engine regressions in the
// conformance runners.
process.exit(lookupFailures > 0 ? 2 : 0);
