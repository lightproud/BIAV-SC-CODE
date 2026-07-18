/**
 * The testbed's four repository inspectors (施工封面 §2 第二战). Each is a
 * plain async function (targets, ctx) -> InspectionResult — deterministic
 * repo/HTTP checks, no model calls, so the unattended cron needs no API key.
 *
 *   InspectionResult = {
 *     status: 'ok' | 'warn' | 'fail' | 'blocked',
 *     findings: [{ level: 'warn'|'fail'|'info', message }],
 *     metrics?: object          // small numbers worth keeping in the report
 *   }
 *
 * 'blocked' is the honest degraded state (e.g. no token for exact mutation
 * scores): the patrol reports what it could not see instead of faking green.
 * A thrown error means the inspection itself could not run — the driver
 * records it and retries with backoff.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const UA = 'silver-core-testbed/0.0 (+https://github.com/lightproud/brain-in-a-vat)';

async function githubJson(url, { fetchImpl = fetch, token, signal }) {
  const headers = { 'user-agent': UA, accept: 'application/vnd.github+json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetchImpl(url, { headers, signal });
  if (res.status === 403 || res.status === 429) {
    const err = new Error(`GitHub API rate-limited/forbidden (${res.status}) for ${url}`);
    err.rateLimited = true;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`GitHub API HTTP ${res.status} for ${url}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** 1. CI workflow status: latest completed run conclusion per watched workflow. */
export async function inspectCiStatus(targets, ctx) {
  const { repo, workflows } = targets;
  const findings = [];
  let green = 0;
  for (const wf of workflows) {
    let data;
    try {
      data = await githubJson(
        `https://api.github.com/repos/${repo}/actions/workflows/${wf}/runs?per_page=1&status=completed`,
        ctx,
      );
    } catch (err) {
      if (err.rateLimited) {
        return {
          status: 'blocked',
          findings: [{ level: 'info', message: `rate-limited before '${wf}' — partial sweep (${green} green so far)` }],
          metrics: { watched: workflows.length, swept: findings.length + green },
        };
      }
      if (err.status === 404) {
        findings.push({ level: 'warn', message: `workflow '${wf}' not found (renamed or removed?)` });
        continue;
      }
      throw err;
    }
    const run = data.workflow_runs?.[0];
    if (run === undefined) {
      findings.push({ level: 'info', message: `workflow '${wf}' has no completed runs yet` });
    } else if (run.conclusion === 'success') {
      green += 1;
    } else {
      findings.push({
        level: run.conclusion === 'failure' ? 'fail' : 'warn',
        message: `workflow '${wf}' latest completed run: ${run.conclusion} (${run.html_url})`,
      });
    }
  }
  return {
    status: findings.some((f) => f.level === 'fail') ? 'fail' : findings.some((f) => f.level === 'warn') ? 'warn' : 'ok',
    findings,
    metrics: { watched: workflows.length, green },
  };
}

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.stryker-tmp', 'coverage']);

function* mdFiles(root) {
  const st = statSync(root, { throwIfNoEntry: false });
  if (!st) return;
  if (st.isFile()) {
    if (root.endsWith('.md')) yield root;
    return;
  }
  for (const name of readdirSync(root)) {
    if (SKIP_DIRS.has(name)) continue;
    yield* mdFiles(join(root, name));
  }
}

/** 2. Documentation dead links: internal markdown links must resolve. */
export async function inspectDocLinks(targets, ctx) {
  const repoRoot = ctx.repoRoot;
  const findings = [];
  let files = 0;
  let links = 0;
  for (const rootRel of targets.roots) {
    for (const file of mdFiles(resolve(repoRoot, rootRel))) {
      files += 1;
      const lines = readFileSync(file, 'utf8').split('\n');
      let inFence = false;
      lines.forEach((line, i) => {
        if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
        if (inFence) return;
        // Inline code spans are prose about links, not links (`[url](url)`).
        const prose = line.replace(/`[^`]*`/g, '');
        for (const m of prose.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
          const raw = m[1];
          if (/^(https?:|mailto:|#|<)/.test(raw)) continue;
          links += 1;
          const clean = raw.replace(/[#?].*$/, '');
          if (clean === '') continue;
          const target = clean.startsWith('/')
            ? join(repoRoot, clean)
            : resolve(dirname(file), clean);
          if (!existsSync(target)) {
            const fileRel = file.startsWith(repoRoot) ? file.slice(repoRoot.length + 1) : file;
            findings.push({ level: 'fail', message: `${fileRel}:${i + 1} dead link -> ${raw}` });
          }
        }
      });
    }
  }
  const capped = findings.slice(0, 100);
  if (findings.length > capped.length) {
    capped.push({ level: 'info', message: `finding list capped at 100 (${findings.length} total dead links)` });
  }
  return {
    status: findings.some((f) => f.level === 'fail') ? 'fail' : 'ok',
    findings: capped,
    metrics: { files, links, dead: findings.filter((f) => f.level === 'fail').length },
  };
}

const changelogHead = (text) => /^##\s+v?(\d+\.\d+\.\d+)/m.exec(text)?.[1] ?? null;

/** 3. Version lockstep: same family version everywhere it is declared. */
export async function inspectLockstep(targets, ctx) {
  const repoRoot = ctx.repoRoot;
  const findings = [];
  const versions = [];
  for (const pkgDir of targets.packages) {
    const pkg = JSON.parse(readFileSync(resolve(repoRoot, pkgDir, 'package.json'), 'utf8'));
    versions.push({ name: pkg.name, version: pkg.version });
    const cl = changelogHead(readFileSync(resolve(repoRoot, pkgDir, 'CHANGELOG.md'), 'utf8'));
    if (cl !== pkg.version) {
      findings.push({
        level: 'fail',
        message: `${pkg.name}: CHANGELOG head '${cl}' != package.json version '${pkg.version}'`,
      });
    }
  }
  const distinct = [...new Set(versions.map((v) => v.version))];
  if (distinct.length > 1) {
    findings.push({
      level: 'fail',
      message: `lockstep broken: ${versions.map((v) => `${v.name}=${v.version}`).join(' vs ')}`,
    });
  }
  if (targets.versionTs) {
    const src = readFileSync(resolve(repoRoot, targets.versionTs), 'utf8');
    const m = /SDK_VERSION = '([^']+)'/.exec(src);
    if (m?.[1] !== versions[0]?.version) {
      findings.push({
        level: 'fail',
        message: `${targets.versionTs} SDK_VERSION '${m?.[1] ?? 'missing'}' != package version '${versions[0]?.version}'`,
      });
    }
  }
  return {
    status: findings.length > 0 ? 'fail' : 'ok',
    findings,
    metrics: { familyVersion: distinct.length === 1 ? distinct[0] : null },
  };
}

/**
 * 4. Mutation ratchet: committed floors vs the latest weekly measurement.
 * Exact per-target scores live only in CI artifacts (needs a token to
 * download) — without one this inspector falls back to per-job conclusions
 * (a failed ratchet job IS "below floor") and reports 'blocked' honestly for
 * the delta part. It also flags floors that no matrix job measures at all.
 */
export async function inspectRatchet(targets, ctx) {
  const repoRoot = ctx.repoRoot;
  const findings = [];
  const floors = [];
  for (const r of targets.ratchets) {
    const json = JSON.parse(readFileSync(resolve(repoRoot, r.file), 'utf8'));
    for (const t of json.targets ?? []) {
      floors.push({ package: r.package, jobPrefix: r.jobPrefix, name: t.name, floor: t.floor });
    }
  }
  let run;
  try {
    const data = await githubJson(
      `https://api.github.com/repos/${targets.repo}/actions/workflows/${targets.workflow}/runs?per_page=1&status=completed`,
      ctx,
    );
    run = data.workflow_runs?.[0];
  } catch (err) {
    if (!err.rateLimited) throw err;
    return {
      status: 'blocked',
      findings: [{ level: 'info', message: 'rate-limited: latest ratchet run unavailable this sweep' }],
      metrics: { floors: floors.length },
    };
  }
  if (run === undefined) {
    return {
      status: 'warn',
      findings: [{ level: 'warn', message: `no completed runs of ${targets.workflow} yet — floors unverified` }],
      metrics: { floors: floors.length },
    };
  }
  const ageDays = (Date.now() - new Date(run.created_at).getTime()) / 86_400_000;
  if (ageDays > (targets.maxAgeDays ?? 9)) {
    findings.push({
      level: 'warn',
      message: `latest ratchet measurement is ${ageDays.toFixed(1)} days old (${run.html_url})`,
    });
  }
  const { jobs } = await githubJson(`${run.jobs_url}?per_page=100`, ctx);
  for (const f of floors) {
    const job = jobs.find((j) => j.name === `${f.jobPrefix} (${f.name})`);
    if (job === undefined) {
      findings.push({
        level: 'warn',
        message: `floor '${f.name}' (${f.package}, ${f.floor}) has NO matching job in the weekly matrix — this floor is never re-measured`,
      });
    } else if (job.conclusion !== 'success' && job.conclusion !== 'skipped') {
      findings.push({
        level: 'fail',
        message: `ratchet job '${job.name}' concluded ${job.conclusion} — score below floor ${f.floor} (${job.html_url})`,
      });
    }
  }
  if (!ctx.token) {
    findings.push({
      level: 'info',
      message: 'no GitHub token: exact floor-vs-measured deltas unavailable (job conclusions only)',
    });
  }
  const status = findings.some((f) => f.level === 'fail')
    ? 'fail'
    : findings.some((f) => f.level === 'warn')
      ? 'warn'
      : 'ok';
  return { status, findings, metrics: { floors: floors.length, latestRunAgeDays: +ageDays.toFixed(2) } };
}

/** Registry: schedule intents route here (new inspector = new entry + targets). */
export const INSPECTORS = {
  'ci-status': inspectCiStatus,
  'doc-links': inspectDocLinks,
  lockstep: inspectLockstep,
  ratchet: inspectRatchet,
};

/** Render one inspection into the day's report markdown (memory area). */
export function renderReport(inspectorId, date, result) {
  const lines = [
    `# ${inspectorId} ${date}`,
    '',
    `- status: ${result.status}`,
    `- metrics: ${JSON.stringify(result.metrics ?? {})}`,
    '',
  ];
  if (result.findings.length === 0) {
    lines.push('no findings');
  } else {
    for (const f of result.findings) lines.push(`- [${f.level}] ${f.message}`);
  }
  return lines.join('\n') + '\n';
}
