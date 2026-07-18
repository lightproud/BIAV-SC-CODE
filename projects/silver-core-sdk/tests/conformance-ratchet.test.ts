/**
 * Conformance M3 - vitest lock for the scoreboard-ratchet checker semantics.
 *
 * Pure unit tests over tests/conformance/ratchet.mjs: synthetic matrix and
 * baseline objects only, no live arms, no emulator, no filesystem. Locks the
 * ratchet contract (green only grows):
 *   - regression triggers: scenario disappearance, any -> red verdict,
 *     KD ids the baseline lacks, new engineFinding flag, gated -> ungated;
 *   - non-triggers: deliberately-red baseline rows staying red (L2 s6/s12),
 *     identical scoreboards, KD ids dropping;
 *   - improvements: new scenarios, newly-green verdicts, dropped KDs,
 *     cleared engine findings - pass with the --update nudge, never fail;
 *   - extraction: all four emitted matrix shapes reduce to the stable
 *     { verdict, kdIds sorted, engineFinding } triple and nothing volatile;
 *   - serialization: sorted keys, byte-stable across input orderings, so
 *     every committed baseline diff is a real scoreboard change.
 */

import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - plain-JS conformance module (no d.ts by design)
import {
  classOf,
  runnerKeyOf,
  extractEntries,
  compareRunner,
  buildRunners,
  serializeBaseline,
  main,
} from './conformance/ratchet.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { afterAll, beforeAll, vi } from 'vitest';

type Entry = { verdict: string; kdIds: string[]; engineFinding: boolean };
type Entries = Record<string, Entry>;

function entry(verdict: string, kdIds: string[] = [], engineFinding = false): Entry {
  return { verdict, kdIds, engineFinding };
}

function kinds(items: Array<{ kind: string }>): string[] {
  return items.map((i) => i.kind).sort();
}

describe('classOf', () => {
  it('maps every runner-emitted verdict to its ratchet class', () => {
    expect(classOf('MATCH')).toBe('green');
    expect(classOf('CONTENT_MATCH')).toBe('green');
    expect(classOf('LOCKED')).toBe('green');
    expect(classOf('FAULT_MATCH')).toBe('green');
    expect(classOf('MATCH_WITH_KNOWN_DIFFS')).toBe('known');
    expect(classOf('CONTENT_KNOWN_DIFF')).toBe('known');
    expect(classOf('FAULT_KNOWN_DIFF')).toBe('known');
    expect(classOf('DIVERGENT')).toBe('red');
    expect(classOf('CONTENT_DIVERGENT')).toBe('red');
    expect(classOf('FAULT_DIVERGENT')).toBe('red');
    expect(classOf('FAILED')).toBe('red');
    expect(classOf('single-arm')).toBe('ungated');
    expect(classOf('OFFICIAL-ARM-UNAVAILABLE')).toBe('ungated');
    expect(classOf('DEMOTED-SINGLE-ARM')).toBe('ungated');
  });

  it('classifies an unknown verdict as red - a novel verdict must not slip the gate', () => {
    expect(classOf('SOMETHING_NEW')).toBe('red');
  });
});

describe('runnerKeyOf', () => {
  it('derives l1/l2/l3 keys and stays extensible to l4', () => {
    expect(runnerKeyOf({ generated_for: 'silver-core-sdk conformance L1 (stream grammar)' })).toBe('l1');
    expect(runnerKeyOf({ generated_for: 'silver-core-sdk conformance L2 (options semantics)' })).toBe('l2');
    expect(runnerKeyOf({ generated_for: 'silver-core-sdk conformance L3 (tool behavior differential)' })).toBe('l3');
    expect(runnerKeyOf({ generated_for: 'silver-core-sdk conformance L4 (fault injection)' })).toBe('l4');
  });

  it('fails loud on an unrecognizable matrix', () => {
    expect(() => runnerKeyOf({ generated_for: 'something else' })).toThrow(/runner key/);
    expect(() => runnerKeyOf({})).toThrow(/runner key/);
  });
});

describe('extractEntries', () => {
  it('reduces L1-shaped rows (compare verdict + knownDiffs) to the triple', () => {
    const entries: Entries = extractEntries({
      scenarios: [
        {
          id: 'text-single-turn',
          bpt: { tokens: ['a'], checks: {}, checkFailures: [] },
          official: { tokens: ['a'], checks: {}, checkFailures: [] },
          compare: { verdict: 'MATCH_WITH_KNOWN_DIFFS', knownDiffs: ['KD-04', 'KD-01'], divergences: [] },
        },
      ],
    });
    expect(entries['text-single-turn']).toEqual({
      verdict: 'MATCH_WITH_KNOWN_DIFFS',
      kdIds: ['KD-01', 'KD-04'],
      engineFinding: false,
    });
  });

  it('drops volatile fields by construction - only the triple survives', () => {
    const entries: Entries = extractEntries({
      scenarios: [
        {
          id: 's1',
          bpt: { postCount: 3, checks: { resultText: 'volatile text' } },
          compare: { verdict: 'MATCH', knownDiffs: [], divergences: [] },
        },
      ],
    });
    expect(Object.keys(entries.s1).sort()).toEqual(['engineFinding', 'kdIds', 'verdict']);
  });

  it('handles L2 shapes: engineFindings list, engineFindingRef, demotions, unavailable arm', () => {
    const entries: Entries = extractEntries({
      scenarios: [
        { id: 's6', compare: { verdict: 'DIVERGENT', knownDiffs: ['KD-01'] } },
        { id: 's12', compare: { verdict: 'DIVERGENT', knownDiffs: [] }, engineFindingRef: 's12' },
        { id: 's13', demoted: 'official arm failed a droppable scenario' },
        { id: 's15', official: { unavailable: 'install failed' } },
        { id: 's16', bpt: {} },
      ],
      engineFindings: [{ scenario: 's6', kind: 'official-check' }],
    });
    expect(entries.s6).toEqual(entry('DIVERGENT', ['KD-01'], true));
    expect(entries.s12.engineFinding).toBe(true);
    expect(entries.s13.verdict).toBe('DEMOTED-SINGLE-ARM');
    expect(entries.s15.verdict).toBe('OFFICIAL-ARM-UNAVAILABLE');
    expect(entries.s16.verdict).toBe('single-arm');
  });

  it('handles L4 shapes: rows under `cases`, KD ids unioned across kdHits and compare.knownDiffs', () => {
    const entries: Entries = extractEntries({
      cases: [
        {
          id: 'l4-http400-non-retryable',
          verdict: 'FAULT_KNOWN_DIFF',
          kdHits: ['KD-L4-01'],
          compare: { knownDiffs: ['KD-04', 'KD-01'] },
        },
        {
          id: 'l4-sse-truncated-text-turn',
          verdict: 'FAULT_KNOWN_DIFF',
          kdHits: ['KD-L4-02'],
          compare: { knownDiffs: ['KD-01'] },
        },
      ],
      engineFindings: [{ scenario: 'l4-sse-truncated-text-turn', kind: 'fault-degradation' }],
    });
    expect(entries['l4-http400-non-retryable']).toEqual(
      entry('FAULT_KNOWN_DIFF', ['KD-01', 'KD-04', 'KD-L4-01']),
    );
    expect(entries['l4-sse-truncated-text-turn'].engineFinding).toBe(true);
  });

  it('handles L3 shapes: row-level verdict + kdHits, singleArmLocks as rows', () => {
    const entries: Entries = extractEntries({
      scenarios: [{ id: 'L3-READ-01', verdict: 'CONTENT_KNOWN_DIFF', kdHits: ['KD-L3-18'] }],
      singleArmLocks: [
        { id: 'L3-SA-READ-CONTAIN', verdict: 'LOCKED', failures: [] },
        { id: 'L3-SA-BASH-HOUSE', verdict: 'FAILED', failures: ['boom'] },
      ],
    });
    expect(entries['L3-READ-01']).toEqual(entry('CONTENT_KNOWN_DIFF', ['KD-L3-18']));
    expect(entries['L3-SA-READ-CONTAIN']).toEqual(entry('LOCKED'));
    expect(entries['L3-SA-BASH-HOUSE'].verdict).toBe('FAILED');
  });
});

describe('compareRunner - regressions (each fails the run)', () => {
  it('scenario disappearance is always a regression', () => {
    const { regressions } = compareRunner({ a: entry('MATCH') }, {});
    expect(kinds(regressions)).toEqual(['scenario-disappeared']);
  });

  it('anything -> DIVERGENT is always a regression', () => {
    const base = { a: entry('MATCH'), b: entry('MATCH_WITH_KNOWN_DIFFS', ['KD-01']) };
    const cur = { a: entry('DIVERGENT'), b: entry('CONTENT_DIVERGENT', ['KD-01']) };
    const { regressions } = compareRunner(base, cur);
    expect(regressions.filter((r: { kind: string }) => r.kind === 'verdict-regressed')).toHaveLength(2);
  });

  it('MATCH -> KNOWN_DIFF regresses via the new-KD rule (baseline lacks the ids)', () => {
    const { regressions } = compareRunner(
      { a: entry('MATCH') },
      { a: entry('MATCH_WITH_KNOWN_DIFFS', ['KD-06']) },
    );
    expect(kinds(regressions)).toEqual(['new-kd-ids']);
  });

  it('KNOWN_DIFF gaining an unlisted KD id is a regression even with the verdict unchanged', () => {
    const { regressions } = compareRunner(
      { a: entry('MATCH_WITH_KNOWN_DIFFS', ['KD-01']) },
      { a: entry('MATCH_WITH_KNOWN_DIFFS', ['KD-01', 'KD-09']) },
    );
    expect(kinds(regressions)).toEqual(['new-kd-ids']);
    expect(regressions[0].detail).toContain('KD-09');
  });

  it('a new engineFinding flag is a regression (suspected OUR-engine gap spreading)', () => {
    const { regressions } = compareRunner(
      { a: entry('DIVERGENT', [], false) },
      { a: entry('DIVERGENT', [], true) },
    );
    expect(kinds(regressions)).toEqual(['new-engine-finding']);
  });

  it('a gated verdict degrading to ungated is a regression (coverage loss, loud fail)', () => {
    const { regressions } = compareRunner(
      { a: entry('MATCH'), b: entry('MATCH_WITH_KNOWN_DIFFS', ['KD-01']) },
      { a: entry('OFFICIAL-ARM-UNAVAILABLE'), b: entry('DEMOTED-SINGLE-ARM', ['KD-01']) },
    );
    expect(regressions.filter((r: { kind: string }) => r.kind === 'coverage-lost')).toHaveLength(2);
  });

  it('LOCKED -> FAILED on a single-arm lock is a regression', () => {
    const { regressions } = compareRunner({ a: entry('LOCKED') }, { a: entry('FAILED') });
    expect(kinds(regressions)).toEqual(['verdict-regressed']);
  });
});

describe('compareRunner - non-regressions', () => {
  it('an identical scoreboard is clean both ways', () => {
    const board = {
      a: entry('MATCH_WITH_KNOWN_DIFFS', ['KD-01', 'KD-02']),
      b: entry('DIVERGENT', ['KD-01'], true),
      c: entry('LOCKED'),
    };
    const { regressions, improvements } = compareRunner(board, structuredClone(board));
    expect(regressions).toEqual([]);
    expect(improvements).toEqual([]);
  });

  it('a deliberately-red baseline row staying red does NOT regress (L2 s6/s12 stay gated-through)', () => {
    const { regressions } = compareRunner(
      { s6: entry('DIVERGENT', ['KD-01'], true) },
      { s6: entry('DIVERGENT', ['KD-01'], true) },
    );
    expect(regressions).toEqual([]);
  });

  it('an ungated baseline row staying ungated does NOT regress', () => {
    const { regressions } = compareRunner(
      { s13: entry('DEMOTED-SINGLE-ARM') },
      { s13: entry('DEMOTED-SINGLE-ARM') },
    );
    expect(regressions).toEqual([]);
  });
});

describe('compareRunner - improvements (pass + --update nudge, never fail)', () => {
  it('a new scenario is an improvement', () => {
    const { regressions, improvements } = compareRunner({}, { a: entry('MATCH') });
    expect(regressions).toEqual([]);
    expect(kinds(improvements)).toEqual(['new-scenario']);
  });

  it('KNOWN_DIFF -> MATCH and DIVERGENT -> MATCH are improvements', () => {
    const { regressions, improvements } = compareRunner(
      { a: entry('MATCH_WITH_KNOWN_DIFFS', ['KD-01']), b: entry('DIVERGENT') },
      { a: entry('MATCH'), b: entry('MATCH') },
    );
    expect(regressions).toEqual([]);
    expect(improvements.filter((i: { kind: string }) => i.kind === 'verdict-improved')).toHaveLength(2);
  });

  it('dropping a KD id is an improvement, not a regression', () => {
    const { regressions, improvements } = compareRunner(
      { a: entry('MATCH_WITH_KNOWN_DIFFS', ['KD-01', 'KD-05']) },
      { a: entry('MATCH_WITH_KNOWN_DIFFS', ['KD-01']) },
    );
    expect(regressions).toEqual([]);
    expect(kinds(improvements)).toEqual(['kd-ids-dropped']);
  });

  it('swapped KD ids regress on the new id and do not double-report the drop', () => {
    const { regressions, improvements } = compareRunner(
      { a: entry('MATCH_WITH_KNOWN_DIFFS', ['KD-01']) },
      { a: entry('MATCH_WITH_KNOWN_DIFFS', ['KD-02']) },
    );
    expect(kinds(regressions)).toEqual(['new-kd-ids']);
    expect(improvements.filter((i: { kind: string }) => i.kind === 'kd-ids-dropped')).toEqual([]);
  });

  it('a cleared engineFinding is an improvement', () => {
    const { regressions, improvements } = compareRunner(
      { a: entry('DIVERGENT', [], true) },
      { a: entry('MATCH_WITH_KNOWN_DIFFS', ['KD-01'], false) },
    );
    // KD-01 is new vs this baseline (DIVERGENT rows carry no allowlisted ids
    // here) - that regression is intentional; the finding clear still counts.
    expect(kinds(regressions)).toEqual(['new-kd-ids']);
    expect(kinds(improvements)).toEqual(['engine-finding-cleared', 'verdict-improved']);
  });
});

describe('buildRunners + serializeBaseline', () => {
  const l1 = {
    generated_for: 'silver-core-sdk conformance L1 (stream grammar)',
    scenarios: [{ id: 'a', compare: { verdict: 'MATCH', knownDiffs: [] } }],
  };
  const l3 = {
    generated_for: 'silver-core-sdk conformance L3 (tool behavior differential)',
    scenarios: [{ id: 'z', verdict: 'CONTENT_MATCH', kdHits: [] }],
    singleArmLocks: [{ id: 'lock1', verdict: 'LOCKED' }],
  };

  it('merges over a previous baseline so partial re-runs keep sibling runners', () => {
    const previous = { l2: { keepme: entry('MATCH') } };
    const runners = buildRunners([l1], previous);
    expect(Object.keys(runners).sort()).toEqual(['l1', 'l2']);
    expect(runners.l2.keepme.verdict).toBe('MATCH');
  });

  it('a re-supplied runner replaces its baseline entries wholesale', () => {
    const previous = { l1: { stale: entry('MATCH') } };
    const runners = buildRunners([l1], previous);
    expect(runners.l1.stale).toBeUndefined();
    expect(runners.l1.a.verdict).toBe('MATCH');
  });

  it('serialization is byte-stable across input orderings (sorted keys, stable diff)', () => {
    const forward = serializeBaseline(buildRunners([l1, l3]));
    const reverse = serializeBaseline(buildRunners([l3, l1]));
    expect(forward).toBe(reverse);
    const parsed = JSON.parse(forward);
    expect(Object.keys(parsed.runners)).toEqual(['l1', 'l3']);
    expect(Object.keys(parsed.runners.l3)).toEqual(['lock1', 'z']);
  });

  it('serialized entries carry exactly the stable triple, kdIds sorted', () => {
    const parsed = JSON.parse(
      serializeBaseline({ l1: { a: entry('MATCH_WITH_KNOWN_DIFFS', ['KD-05', 'KD-01']) } }),
    );
    expect(parsed.runners.l1.a).toEqual({
      verdict: 'MATCH_WITH_KNOWN_DIFFS',
      kdIds: ['KD-01', 'KD-05'],
      engineFinding: false,
    });
  });
});

describe('committed baseline vs live extraction shape', () => {
  it('the committed baseline.json parses and every entry is a valid triple', async () => {
    const { readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = dirname(fileURLToPath(import.meta.url));
    const baseline = JSON.parse(readFileSync(join(here, 'conformance', 'baseline.json'), 'utf8'));
    expect(Object.keys(baseline.runners)).toEqual(['l1', 'l2', 'l3', 'l4']);
    for (const entries of Object.values(baseline.runners) as Entries[]) {
      for (const e of Object.values(entries)) {
        expect(Object.keys(e).sort()).toEqual(['engineFinding', 'kdIds', 'verdict']);
        expect(typeof e.verdict).toBe('string');
        expect([...e.kdIds]).toEqual([...e.kdIds].sort());
        expect(typeof e.engineFinding).toBe('boolean');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// W3-3 (audit r3): main()'s safety nets — zero-scoreboard refusal, missing
// baseline, and the --update / green-pass path — were never exercised. Drive
// main() over synthetic matrix/baseline files in a temp dir so a regression in
// the refusal logic reds a test instead of shipping green.
// ---------------------------------------------------------------------------
describe('main() safety nets', () => {
  let dir: string;
  const logs: string[] = [];
  const spies: Array<{ mockRestore: () => void }> = [];

  beforeAll(() => {
    dir = mkdtempSync(pathJoin(tmpdir(), 'ratchet-main-'));
    for (const m of ['log', 'warn', 'error'] as const) {
      spies.push(
        vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
          logs.push(a.join(' '));
        }),
      );
    }
  });
  afterAll(() => {
    for (const s of spies) s.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  const matrix = (id: string, verdict: string) => ({
    generated_for: 'conformance L1 (2026)',
    scenarios: [{ id, verdict }],
  });
  const writeMatrix = (name: string, body: unknown) => {
    const p = pathJoin(dir, name);
    writeFileSync(p, JSON.stringify(body));
    return p;
  };

  it('refuses a matrix that reduces to ZERO scoreboard entries (exit 1)', () => {
    const empty = writeMatrix('empty.json', { generated_for: 'conformance L1', scenarios: [] });
    const code = main([`--baseline=${pathJoin(dir, 'nope.json')}`, empty]);
    expect(code).toBe(1);
    expect(logs.some((l) => l.includes('ZERO scoreboard entries'))).toBe(true);
  });

  it('refuses when there is no baseline and no --update (exit 1)', () => {
    const mp = writeMatrix('m1.json', matrix('s1', 'MATCH'));
    const code = main([`--baseline=${pathJoin(dir, 'absent.json')}`, mp]);
    expect(code).toBe(1);
    expect(logs.some((l) => l.includes('no baseline at'))).toBe(true);
  });

  it('--update seeds a baseline, then a matching run passes green (exit 0)', () => {
    const mp = writeMatrix('m2.json', matrix('s1', 'MATCH'));
    const bp = pathJoin(dir, 'baseline.json');
    expect(main(['--update', `--baseline=${bp}`, mp])).toBe(0);
    expect(main([`--baseline=${bp}`, mp])).toBe(0);
  });

  it('RED-LOCK WARNING fires when --update baselines a regression', () => {
    const bp = pathJoin(dir, 'baseline-red.json');
    const green = writeMatrix('green.json', matrix('s1', 'MATCH'));
    expect(main(['--update', `--baseline=${bp}`, green])).toBe(0);
    // Re-baseline the SAME scenario now DIVERGENT: an explicit human --update
    // still writes, but must shout the regression it is locking in.
    logs.length = 0;
    const red = writeMatrix('red.json', matrix('s1', 'DIVERGENT'));
    expect(main(['--update', `--baseline=${bp}`, red])).toBe(0);
    expect(logs.some((l) => l.includes('RED-LOCK WARNING'))).toBe(true);
  });
});
