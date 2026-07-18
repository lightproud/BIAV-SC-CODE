/**
 * Inspector + dream unit tests: fixtures on disk, injected fetch for the
 * GitHub-API inspectors, and the REAL agent-SDK memory store for the memory
 * path (that store is itself under test here as a consumed public surface).
 */

import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  inspectCiStatus,
  inspectDocLinks,
  inspectLockstep,
  inspectRatchet,
  renderReport,
} from '../src/inspectors.mjs';
import { openMemory, readIfExists, stripView, writeReport } from '../src/memory.mjs';
import { dream } from '../src/dream.mjs';
import { parseMemoryCards } from 'silver-core-agent-sdk';

const tmp = () => mkdtempSync(join(tmpdir(), 'testbed-insp-'));

const fakeFetch = (routes) => async (url) => {
  for (const [pattern, body] of routes) {
    if (url.includes(pattern)) {
      return { ok: true, status: 200, json: async () => body };
    }
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

describe('inspectCiStatus', () => {
  const targets = { repo: 'o/r', workflows: ['green.yml', 'red.yml', 'gone.yml'] };

  it('separates green, failed and missing workflows', async () => {
    const fetchImpl = fakeFetch([
      ['green.yml', { workflow_runs: [{ conclusion: 'success', html_url: 'u1' }] }],
      ['red.yml', { workflow_runs: [{ conclusion: 'failure', html_url: 'u2' }] }],
    ]);
    const res = await inspectCiStatus(targets, { fetchImpl });
    expect(res.status).toBe('fail');
    expect(res.metrics).toEqual({ watched: 3, green: 1 });
    expect(res.findings.map((f) => f.level).sort()).toEqual(['fail', 'warn']);
  });

  it('reports blocked (not fake green) when rate-limited', async () => {
    const res = await inspectCiStatus(targets, {
      fetchImpl: async () => ({ ok: false, status: 403 }),
    });
    expect(res.status).toBe('blocked');
  });
});

describe('inspectDocLinks', () => {
  it('finds dead internal links, skips externals, fences and anchors', async () => {
    const root = tmp();
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'docs', 'real.md'), '# target\n');
    writeFileSync(
      join(root, 'README.md'),
      [
        '[ok](docs/real.md)',
        '[ok-anchor](docs/real.md#section)',
        '[external](https://example.com/x.md)',
        '[anchor-only](#local)',
        '[dead](docs/missing.md)',
        'prose about `[url](url)` in inline code',
        '```',
        '[in-fence-dead](nope.md)',
        '```',
      ].join('\n'),
    );
    const res = await inspectDocLinks({ roots: ['README.md', 'docs'] }, { repoRoot: root });
    expect(res.status).toBe('fail');
    expect(res.metrics.dead).toBe(1);
    expect(res.findings[0].message).toContain('docs/missing.md');
    expect(res.findings[0].message).toContain('README.md:5');
  });

  it('is ok on a clean tree', async () => {
    const root = tmp();
    writeFileSync(join(root, 'a.md'), '[self](a.md)\n');
    const res = await inspectDocLinks({ roots: ['a.md'] }, { repoRoot: root });
    expect(res.status).toBe('ok');
    expect(res.metrics).toEqual({ files: 1, links: 1, dead: 0 });
  });
});

function pkgFixture(root, dir, name, version, changelogVersion = version) {
  mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, dir, 'package.json'), JSON.stringify({ name, version }));
  writeFileSync(join(root, dir, 'CHANGELOG.md'), `# log\n\n## ${changelogVersion}\n\n- x\n`);
}

describe('inspectLockstep', () => {
  it('is ok when versions and CHANGELOG heads all agree', async () => {
    const root = tmp();
    pkgFixture(root, 'a', 'pkg-a', '1.2.3');
    pkgFixture(root, 'b', 'pkg-b', '1.2.3');
    const res = await inspectLockstep({ packages: ['a', 'b'] }, { repoRoot: root });
    expect(res.status).toBe('ok');
    expect(res.metrics.familyVersion).toBe('1.2.3');
  });

  it('fails on version drift and on a stale CHANGELOG head', async () => {
    const root = tmp();
    pkgFixture(root, 'a', 'pkg-a', '1.2.3', '1.2.2');
    pkgFixture(root, 'b', 'pkg-b', '1.2.4');
    const res = await inspectLockstep({ packages: ['a', 'b'] }, { repoRoot: root });
    expect(res.status).toBe('fail');
    const messages = res.findings.map((f) => f.message).join('\n');
    expect(messages).toContain("CHANGELOG head '1.2.2'");
    expect(messages).toContain('lockstep broken');
  });

  it('checks the version.ts constant when configured', async () => {
    const root = tmp();
    pkgFixture(root, 'a', 'pkg-a', '1.2.3');
    writeFileSync(join(root, 'version.ts'), "export const SDK_VERSION = '9.9.9';\n");
    const res = await inspectLockstep(
      { packages: ['a'], versionTs: 'version.ts' },
      { repoRoot: root },
    );
    expect(res.status).toBe('fail');
    expect(res.findings.at(-1).message).toContain("SDK_VERSION '9.9.9'");
  });
});

describe('inspectRatchet', () => {
  const setupFloors = (root) => {
    writeFileSync(
      join(root, 'ratchet.json'),
      JSON.stringify({ targets: [{ name: 'core', floor: 95 }, { name: 'orphan', floor: 90 }] }),
    );
  };

  it('flags failed ratchet jobs and floors with no measuring job', async () => {
    const root = tmp();
    setupFloors(root);
    const fetchImpl = fakeFetch([
      ['/runs?', {
        workflow_runs: [{
          created_at: new Date().toISOString(),
          html_url: 'run-url',
          jobs_url: 'https://api.github.example/jobs',
        }],
      }],
      ['/jobs', { jobs: [{ name: 'ratchet (core)', conclusion: 'failure', html_url: 'job-url' }] }],
    ]);
    const res = await inspectRatchet(
      {
        repo: 'o/r',
        workflow: 'w.yml',
        ratchets: [{ package: 'p', file: 'ratchet.json', jobPrefix: 'ratchet' }],
      },
      { repoRoot: root, fetchImpl, token: 't' },
    );
    expect(res.status).toBe('fail');
    const messages = res.findings.map((f) => f.message).join('\n');
    expect(messages).toContain("'ratchet (core)' concluded failure");
    expect(messages).toContain("floor 'orphan'");
    expect(messages).toContain('never re-measured');
  });

  it('warns when the latest measurement is stale', async () => {
    const root = tmp();
    writeFileSync(join(root, 'ratchet.json'), JSON.stringify({ targets: [{ name: 'core', floor: 95 }] }));
    const old = new Date(Date.now() - 20 * 86_400_000).toISOString();
    const fetchImpl = fakeFetch([
      ['/runs?', { workflow_runs: [{ created_at: old, html_url: 'u', jobs_url: 'https://x/jobs' }] }],
      ['/jobs', { jobs: [{ name: 'ratchet (core)', conclusion: 'success' }] }],
    ]);
    const res = await inspectRatchet(
      { repo: 'o/r', workflow: 'w.yml', maxAgeDays: 9, ratchets: [{ package: 'p', file: 'ratchet.json', jobPrefix: 'ratchet' }] },
      { repoRoot: root, fetchImpl, token: 't' },
    );
    expect(res.status).toBe('warn');
    expect(res.findings[0].message).toContain('days old');
  });
});

describe('memory area + dream (real agent-SDK memory store)', () => {
  it('merges the day reports into a validated card and refreshes the index', async () => {
    const store = openMemory(tmp());
    const date = '2026-07-18';
    await writeReport(store, 'lockstep', date, renderReport('lockstep', date, {
      status: 'ok', findings: [], metrics: { familyVersion: '0.68.0' },
    }));
    await writeReport(store, 'doc-links', date, renderReport('doc-links', date, {
      status: 'fail',
      findings: [{ level: 'fail', message: 'a.md:1 dead link -> b.md' }],
      metrics: { files: 1, links: 1, dead: 1 },
    }));

    const summary = await dream(store, { date, inspectorIds: ['lockstep', 'doc-links'] });
    expect(summary).toContain('merged 2026-07-18');
    expect(summary).toContain('worst=fail');

    const card = await readIfExists(store, '/memories/cards/2026-07-18.md');
    expect(card).toContain('结论:');
    expect(card).toContain('doc-links 1 条发现');
    const parsed = parseMemoryCards(card);
    expect(parsed.ok).toBe(true);
    expect(parsed.cards[0].title).toBe('值班归并 2026-07-18');

    const index = await readIfExists(store, '/memories/MEMORY.md');
    expect(index).toContain('cards/2026-07-18.md');
  });

  it('falls back to the newest day with reports when today has none', async () => {
    const store = openMemory(tmp());
    await writeReport(store, 'lockstep', '2026-07-16', renderReport('lockstep', '2026-07-16', {
      status: 'ok', findings: [], metrics: {},
    }));
    const summary = await dream(store, { date: '2026-07-18', inspectorIds: ['lockstep'] });
    expect(summary).toContain('merged 2026-07-16');
  });

  it('reports honestly when no reports exist at all', async () => {
    const store = openMemory(tmp());
    const summary = await dream(store, { date: '2026-07-18', inspectorIds: ['lockstep'] });
    expect(summary).toContain('nothing to merge');
  });

  it('stripView undoes the numbered view format', () => {
    expect(stripView('     1\tline one\n     2\t  indented')).toBe('line one\n  indented');
  });
});
