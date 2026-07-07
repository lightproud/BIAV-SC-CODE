/**
 * Three-state adversarial verifier — parser fail-closed safety, wiring, and a
 * corpus-sync guard holding the reproduced verdict fragments to their archive.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  SAFE_VERDICT,
  VERIFIER_DEFAULT_MODEL,
  adversarialVerify,
  buildVerifierUserTurn,
  parseVerdict,
} from '../src/verifier/index.js';
import {
  RECALL_BIAS_GUIDANCE,
  RECALL_BIAS_PROVENANCE,
  THREE_STATE_VERDICT_DEFINITIONS,
  VERDICT_DEFINITIONS_PROVENANCE,
  VERIFIER_PROVENANCE,
  VERIFY_KEEP_RULE,
  VERIFY_PHASE_PROVENANCE,
  VERIFY_VERDICT_SYSTEM,
} from '../src/verifier/prompts.js';
import { MockTransport, textReplyEvents } from './helpers/mock-transport.js';

// ---------------------------------------------------------------------------
// parseVerdict — JSON path
// ---------------------------------------------------------------------------

describe('parseVerdict (JSON)', () => {
  it('parses CONFIRMED and keeps it', () => {
    const r = parseVerdict('{"verdict":"CONFIRMED","quote":"x=1","rationale":"bug"}');
    expect(r.verdict).toBe('CONFIRMED');
    expect(r.keep).toBe(true);
    expect(r.quote).toBe('x=1');
  });
  it('parses PLAUSIBLE and preserves confirms', () => {
    const r = parseVerdict('{"verdict":"PLAUSIBLE","rationale":"race","confirms":"a stress test"}');
    expect(r.verdict).toBe('PLAUSIBLE');
    expect(r.keep).toBe(true);
    expect(r.confirms).toBe('a stress test');
  });
  it('parses REFUTED and does not keep', () => {
    const r = parseVerdict('{"verdict":"REFUTED","rationale":"guarded above"}');
    expect(r.verdict).toBe('REFUTED');
    expect(r.keep).toBe(false);
  });
  it('is case-insensitive on the verdict token', () => {
    expect(parseVerdict('{"verdict":"confirmed","rationale":"x"}').verdict).toBe('CONFIRMED');
  });
  it('tolerates a fenced reply', () => {
    expect(parseVerdict('```json\n{"verdict":"REFUTED","rationale":"x"}\n```').verdict).toBe(
      'REFUTED',
    );
  });
  it('drops confirms when the verdict is not PLAUSIBLE', () => {
    const r = parseVerdict('{"verdict":"CONFIRMED","rationale":"x","confirms":"y"}');
    expect(r.confirms).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseVerdict — FAIL CLOSED (the safety core)
// ---------------------------------------------------------------------------

describe('parseVerdict fails CLOSED (garbled/ambiguous -> REFUTED, never kept)', () => {
  it('SAFE_VERDICT is REFUTED', () => {
    expect(SAFE_VERDICT).toBe('REFUTED');
  });
  it('empty reply -> REFUTED', () => {
    const r = parseVerdict('');
    expect(r.verdict).toBe('REFUTED');
    expect(r.keep).toBe(false);
  });
  it('pure prose with no verdict token -> REFUTED', () => {
    expect(parseVerdict('the code looks fine to me').verdict).toBe('REFUTED');
  });
  it('unknown verdict word -> REFUTED', () => {
    expect(parseVerdict('{"verdict":"MAYBE","rationale":"x"}').verdict).toBe('REFUTED');
  });
  it('AMBIGUOUS reply naming two verdicts -> REFUTED (must not pick one)', () => {
    expect(parseVerdict('could be CONFIRMED but might be REFUTED').verdict).toBe('REFUTED');
  });
  it('garbled/truncated JSON -> REFUTED', () => {
    expect(parseVerdict('{"verdict":"CONF').verdict).toBe('REFUTED');
  });
  // The prose-scavenging fail-OPEN vector: a JSON reply is authoritative, so a
  // verdict word buried in the rationale must NEVER forge a kept verdict.
  it('JSON with absent verdict but a verdict word in the rationale -> REFUTED', () => {
    const r = parseVerdict('{"rationale":"the concern is real and CONFIRMED by reading foo.ts"}');
    expect(r.verdict).toBe('REFUTED');
    expect(r.keep).toBe(false);
  });
  it('JSON with invalid verdict but a verdict word in the rationale -> REFUTED', () => {
    const r = parseVerdict('{"verdict":"UNSURE","rationale":"clearly CONFIRMED at line 5"}');
    expect(r.verdict).toBe('REFUTED');
    expect(r.keep).toBe(false);
  });
  it('JSON truncated after a valid token -> REFUTED (not scavenged as CONFIRMED)', () => {
    const r = parseVerdict('{"verdict":"CONFIRMED","quote":"a very long unterminated quote');
    expect(r.verdict).toBe('REFUTED');
    expect(r.keep).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseVerdict — bare-word fallback
// ---------------------------------------------------------------------------

describe('parseVerdict (bare-word fallback)', () => {
  it('a bare CONFIRMED reply -> CONFIRMED', () => {
    expect(parseVerdict('CONFIRMED').verdict).toBe('CONFIRMED');
  });
  it('"Verdict: PLAUSIBLE" -> PLAUSIBLE (exactly one token)', () => {
    expect(parseVerdict('Verdict: PLAUSIBLE').verdict).toBe('PLAUSIBLE');
  });
});

// ---------------------------------------------------------------------------
// buildVerifierUserTurn
// ---------------------------------------------------------------------------

describe('buildVerifierUserTurn', () => {
  it('includes context, summary, location, category; omits absent fields', () => {
    const turn = buildVerifierUserTurn({
      summary: 'null deref',
      failureScenario: 'x is null',
      file: 'a.ts',
      line: 42,
      category: 'correctness',
      context: 'const y = x.z;',
    });
    expect(turn).toContain('<context>');
    expect(turn).toContain('- summary: null deref');
    expect(turn).toContain('- location: a.ts:42');
    expect(turn).toContain('- category: correctness');
  });
  it('omits location when file is absent', () => {
    const turn = buildVerifierUserTurn({ summary: 's' });
    expect(turn).not.toContain('- location:');
    expect(turn).not.toContain('<context>');
  });
});

// ---------------------------------------------------------------------------
// End-to-end over a mock transport
// ---------------------------------------------------------------------------

describe('adversarialVerify over a mock transport', () => {
  it('sends the verdict system prompt at temperature 0 and returns the verdict', async () => {
    const t = new MockTransport([textReplyEvents('{"verdict":"REFUTED","rationale":"guarded"}')]);
    const r = await adversarialVerify({ summary: 's', context: 'code' }, { transport: t });
    expect(r.verdict).toBe('REFUTED');
    expect(r.keep).toBe(false);
    expect(t.requests[0]?.system).toBe(VERIFY_VERDICT_SYSTEM);
    expect(t.requests[0]?.temperature).toBe(0);
  });
  it('defaults to VERIFIER_DEFAULT_MODEL and honors opts.model override', async () => {
    const t1 = new MockTransport([textReplyEvents('{"verdict":"CONFIRMED","rationale":"x"}')]);
    await adversarialVerify({ summary: 's' }, { transport: t1 });
    expect(t1.requests[0]?.model).toBe(VERIFIER_DEFAULT_MODEL);
    const t2 = new MockTransport([textReplyEvents('{"verdict":"CONFIRMED","rationale":"x"}')]);
    await adversarialVerify({ summary: 's' }, { transport: t2, model: 'claude-sonnet-4-5' });
    expect(t2.requests[0]?.model).toBe('claude-sonnet-4-5');
  });
  it('a mid-stream abort REJECTS (no partial-verdict leak)', async () => {
    const controller = new AbortController();
    const partial = textReplyEvents('{"verdict":"CONFIRMED"');
    const abortingTransport = {
      apiKeySource: () => 'user' as const,
      async *stream() {
        yield partial[0]!;
        yield partial[1]!;
        yield partial[2]!;
        controller.abort();
        yield partial[3]!;
      },
    };
    await expect(
      adversarialVerify({ summary: 's' }, { transport: abortingTransport, signal: controller.signal }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Corpus-sync guard — reproduced fragments faithful to the archive
// ---------------------------------------------------------------------------

describe('verifier prompt provenance (corpus-sync guard, Track B parity)', () => {
  const archive = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    'Public-Info-Pool',
    'Reference',
    'Claude-Code-System-Prompts',
    'system-prompts',
  );
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const stripHeader = (md: string) => md.replace(/^<!--[\s\S]*?-->\n?/, '');

  it('the provenance table has 3 entries with non-empty slugs; translated wire fragments are faithful:false', () => {
    expect(Object.keys(VERIFIER_PROVENANCE)).toHaveLength(3);
    for (const p of Object.values(VERIFIER_PROVENANCE)) {
      expect(p.slug.length).toBeGreaterThan(0);
    }
    // i18n-zh Phase 2 batch B: the two ON-THE-WIRE fragments (verdict definitions,
    // recall-bias) are translated to Chinese -> faithful:false. VERIFY_KEEP_RULE is
    // a doc/anchor constant (NOT sent to the model), so it stays English + true.
    expect(VERDICT_DEFINITIONS_PROVENANCE.faithful).toBe(false);
    expect(RECALL_BIAS_PROVENANCE.faithful).toBe(false);
    expect(VERIFY_PHASE_PROVENANCE.faithful).toBe(true);
  });

  const fragments = [
    { text: THREE_STATE_VERDICT_DEFINITIONS, prov: VERDICT_DEFINITIONS_PROVENANCE },
    { text: RECALL_BIAS_GUIDANCE, prov: RECALL_BIAS_PROVENANCE },
  ];
  for (const { text, prov } of fragments) {
    // Translated (faithful:false) fragments can't be anchor-matched against the
    // English archive; the archive check runs only for still-faithful fragments.
    it.runIf(existsSync(archive) && prov.faithful)(`${prov.slug} is faithful to its archived source`, () => {
      const body = norm(stripHeader(readFileSync(join(archive, `${prov.slug}.md`), 'utf8')));
      const drifted = norm(text)
        .split(/(?<=[.:])\s+/)
        .map(norm)
        .filter((s) => s.length >= 40)
        .filter((s) => !body.includes(s.slice(0, 60)));
      expect(drifted, `not found in archive:\n${drifted.join('\n')}`).toEqual([]);
    });
  }

  it.runIf(existsSync(archive))('VERIFY_KEEP_RULE appears verbatim in the skill file', () => {
    const body = readFileSync(join(archive, `${VERIFY_PHASE_PROVENANCE.slug}.md`), 'utf8');
    expect(body).toContain(VERIFY_KEEP_RULE);
  });
});
