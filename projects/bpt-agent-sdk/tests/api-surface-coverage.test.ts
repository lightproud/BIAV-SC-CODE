/**
 * Interface-coverage guard (2026-07-05, keeper directive: per-interface
 * white-box testing). Enumerates the PUBLIC surface - runtime exports of
 * src/index.ts, Options fields, Query methods - and asserts every name is
 * word-boundary-mentioned somewhere under tests/ (this file excluded), or
 * sits on the explicit KNOWN_UNTESTED allowlist.
 *
 * Contract (shrink-only ratchet, mirrors the conformance baseline):
 *   - a NEW export/field/method with no test and no allowlist entry -> RED;
 *   - an allowlist entry that HAS gained coverage -> RED (stale entry must
 *     be deleted, so the list only shrinks);
 *   - the allowlist documents WHY each gap is deferred.
 *
 * Honest limits: "mentioned in a test file" is a coverage FLOOR, not proof
 * of semantic depth - it catches wholly-untested interfaces (13 found on
 * 2026-07-05, of which 7 were filled by api-surface-gaps.test.ts), not
 * shallow tests. Depth stays a review concern.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';

const TESTS_DIR = join(__dirname);
const SELF = basename(__filename);

/** Every test-ish source under tests/, this guard excluded. */
function collectTestFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'fixtures' || name === 'node_modules') continue;
      out.push(...collectTestFiles(p));
    } else if (/\.(test\.ts|ts|mjs)$/.test(name) && name !== SELF) {
      out.push(p);
    }
  }
  return out;
}

const corpus = collectTestFiles(TESTS_DIR).map((p) => readFileSync(p, 'utf8'));

function covered(name: string): boolean {
  const re = new RegExp(`\\b${name}\\b`);
  return corpus.some((text) => re.test(text));
}

/**
 * Deferred gaps - each entry names the follow-up batch that owns it.
 * DELETE the entry when its test lands (the guard reds out stale entries).
 */
const KNOWN_UNTESTED: Record<string, string> = {
  // Options fields - white-box batch 2 (engine-level harness required):
  includeEnvironmentContext: 'engine option; needs a mock-transport request-shape probe',
  onElicitation: 'MCP elicitation host callback; needs an in-process server driving elicitation',
  sessionStoreFlush: 'external-session-store flush hook; needs a store spy fixture',
  toolSearch: 'deferred-tool search surface; needs a registry fixture with deferred tools',
  // Query control methods - white-box batch 2 (runtime MCP control):
  reconnectMcpServer: 'runtime MCP control; needs a restartable in-process server fixture',
  toggleMcpServer: 'runtime MCP control; same fixture as reconnectMcpServer',
  setMcpServers: 'runtime MCP reconfiguration; same fixture family',
  streamInput: 'streaming-input push method; needs an open-ended AsyncIterable harness',
};

function parseBlock(source: string, re: RegExp): string {
  const m = source.match(re);
  if (!m) throw new Error(`api-surface-coverage: anchor not found: ${re}`);
  return m[0];
}

const typesSource = readFileSync(join(__dirname, '..', 'src', 'types.ts'), 'utf8');
const optionsFields = [
  ...parseBlock(typesSource, /export (?:interface|type) Options[\s\S]*?\n\}/).matchAll(
    /^\s{2}(\w+)\??:/gm,
  ),
].map((m) => m[1]);
const queryMethods = [
  ...parseBlock(typesSource, /export interface Query[\s\S]*?\n\}/).matchAll(/^\s{2}(\w+)\(/gm),
].map((m) => m[1]);

describe('public interface coverage floor', () => {
  it('sanity: surface enumeration is non-trivial', () => {
    expect(Object.keys(api).length).toBeGreaterThan(50);
    expect(optionsFields.length).toBeGreaterThan(30);
    expect(queryMethods.length).toBeGreaterThan(10);
  });

  it('every runtime export is tested or allowlisted', () => {
    const gaps = Object.keys(api).filter((n) => !covered(n) && !(n in KNOWN_UNTESTED));
    expect(gaps, `untested exports (add tests, or allowlist with a reason): ${gaps.join(', ')}`)
      .toEqual([]);
  });

  it('every Options field is tested or allowlisted', () => {
    const gaps = optionsFields.filter((n) => !covered(n) && !(n in KNOWN_UNTESTED));
    expect(gaps, `untested Options fields: ${gaps.join(', ')}`).toEqual([]);
  });

  it('every Query method is tested or allowlisted', () => {
    const gaps = queryMethods.filter((n) => !covered(n) && !(n in KNOWN_UNTESTED));
    expect(gaps, `untested Query methods: ${gaps.join(', ')}`).toEqual([]);
  });

  it('the allowlist only shrinks: entries that gained coverage must be deleted', () => {
    const stale = Object.keys(KNOWN_UNTESTED).filter((n) => covered(n));
    expect(stale, `stale allowlist entries (now covered - delete them): ${stale.join(', ')}`)
      .toEqual([]);
  });
});
