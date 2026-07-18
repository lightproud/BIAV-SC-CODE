/**
 * Declarative workflow-graph loading (hot-layer gate): a definition file is
 * host-editable content, so every malformed input DEGRADES TO SKIP — the
 * loader never throws, and an ok result always carries an already-validated,
 * runnable graph.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
  loadWorkflowGraphFile,
  parseWorkflowGraphSource,
} from '../src/index.js';

const GRAPH = {
  id: 'digest',
  nodes: [
    { id: 'collect', intent: 'collect items' },
    { id: 'merge', intent: 'merge results', deps: ['collect'] },
  ],
};

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempFile(name: string, content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'wf-load-'));
  tempDirs.push(dir);
  const p = join(dir, name);
  await writeFile(p, content, 'utf8');
  return p;
}

describe('parseWorkflowGraphSource', () => {
  it('json source parses and validates; format sniffed from the leading brace', () => {
    const res = parseWorkflowGraphSource(JSON.stringify(GRAPH));
    expect(res).toMatchObject({ ok: true, format: 'json' });
    if (res.ok) expect(res.graph.nodes.map((n) => n.id)).toEqual(['collect', 'merge']);
  });

  it('md source: the FIRST ```json fence carries the graph; prose is free-form', () => {
    const md = [
      '# digest workflow',
      '',
      'Runs the nightly digest.',
      '',
      '```json',
      JSON.stringify(GRAPH, null, 2),
      '```',
      '',
      '```json',
      '{"id":"decoy","nodes":[]}',
      '```',
    ].join('\n');
    const res = parseWorkflowGraphSource(md);
    expect(res).toMatchObject({ ok: true, format: 'md' });
    if (res.ok) expect(res.graph.id).toBe('digest');
  });

  it('degrades to skip, never throws: empty / no fence / bad JSON / non-object / invalid graph', () => {
    // Exact-message pins (mutation kills): the guard messages are contract.
    expect(parseWorkflowGraphSource('')).toEqual({
      ok: false,
      error: 'empty graph definition source',
    });
    expect(parseWorkflowGraphSource('   \n\t')).toEqual({
      ok: false,
      error: 'empty graph definition source',
    });
    // Non-string input must degrade, not throw (the never-throws contract).
    expect(parseWorkflowGraphSource(42 as unknown as string)).toEqual({
      ok: false,
      error: 'empty graph definition source',
    });
    expect(parseWorkflowGraphSource('# just prose\n')).toEqual({
      ok: false,
      error: 'md graph definition has no ```json fenced block',
    });
    expect(parseWorkflowGraphSource('{not json')).toMatchObject({
      ok: false,
      error: expect.stringContaining('not valid JSON'),
    });
    // An EMPTY fence parses '' — the JSON error message is the raw engine one.
    expect(parseWorkflowGraphSource('```json\n```')).toMatchObject({
      ok: false,
      error: expect.stringContaining('Unexpected end of JSON input'),
    });
    for (const src of ['[1,2]', 'null', '"str"']) {
      expect(parseWorkflowGraphSource(src, 'json')).toEqual({
        ok: false,
        error: 'graph definition must be a JSON object',
      });
    }
    const cyclic = {
      id: 'bad',
      nodes: [
        { id: 'a', intent: 'x', deps: ['b'] },
        { id: 'b', intent: 'x', deps: ['a'] },
      ],
    };
    const res = parseWorkflowGraphSource(JSON.stringify(cyclic));
    // A GraphError surfaces ITS message verbatim (no re-wrapping prefix).
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/^invalid workflow graph: dependency cycle/);
      expect(res.error).not.toContain('graph validation failed');
    }
    // A non-GraphError from validation (a null node crashes the validator)
    // degrades through the generic wrapper instead of escaping.
    const nullNode = parseWorkflowGraphSource('{"id":"g","nodes":[null]}');
    expect(nullNode.ok).toBe(false);
    if (!nullNode.ok) expect(nullNode.error).toMatch(/^graph validation failed: /);
  });

  it('format sniffing: leading whitespace before { is json; fence tolerates trailing spaces', () => {
    const res = parseWorkflowGraphSource(`  \n  ${JSON.stringify(GRAPH)}`);
    expect(res).toMatchObject({ ok: true, format: 'json' });
    // '```json ' with a trailing space still opens the fence.
    const md = '# g\n\n```json \n' + JSON.stringify(GRAPH) + '\n```\n';
    expect(parseWorkflowGraphSource(md)).toMatchObject({ ok: true, format: 'md' });
  });
});

describe('loadWorkflowGraphFile', () => {
  it('loads .json and .md files by extension', async () => {
    const jsonPath = await tempFile('graph.json', JSON.stringify(GRAPH));
    expect(await loadWorkflowGraphFile(jsonPath)).toMatchObject({ ok: true, format: 'json' });
    const mdPath = await tempFile(
      'graph.md',
      `# g\n\n\`\`\`json\n${JSON.stringify(GRAPH)}\n\`\`\`\n`,
    );
    expect(await loadWorkflowGraphFile(mdPath)).toMatchObject({ ok: true, format: 'md' });
  });

  it('a missing file degrades to skip like a malformed one (never throws)', async () => {
    const res = await loadWorkflowGraphFile('/nonexistent/definitely-missing.json');
    expect(res).toMatchObject({ ok: false, error: expect.stringContaining('cannot read') });
  });

  it('extension FORCES the format — it is not a sniffing hint', async () => {
    // A .json file with md content must fail as strict json...
    const mdInJson = await tempFile(
      'wrong.json',
      `# g\n\n\`\`\`json\n${JSON.stringify(GRAPH)}\n\`\`\`\n`,
    );
    expect(await loadWorkflowGraphFile(mdInJson)).toMatchObject({
      ok: false,
      error: expect.stringContaining('not valid JSON'),
    });
    // ...and a .md file with bare json (no fence) must fail as md.
    const jsonInMd = await tempFile('wrong.md', JSON.stringify(GRAPH));
    expect(await loadWorkflowGraphFile(jsonInMd)).toEqual({
      ok: false,
      error: 'md graph definition has no ```json fenced block',
    });
    // An unknown extension falls back to sniffing.
    const sniffed = await tempFile('graph.txt', JSON.stringify(GRAPH));
    expect(await loadWorkflowGraphFile(sniffed)).toMatchObject({ ok: true, format: 'json' });
  });
});
