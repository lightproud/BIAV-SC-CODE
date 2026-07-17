/**
 * Context-tips subsystem — fail-safe parsers, eligibility/hallucination guards,
 * wiring, and a corpus-sync guard holding the reproduced prompts + catalog
 * situations to their archive.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  CONTEXT_TIP_CATALOG,
  evaluateTipReception,
  parseContextTip,
  parseTipReception,
  selectContextTip,
} from '../src/tips/index.js';
import {
  CONTEXT_TIP_SELECTOR_PROVENANCE,
  CONTEXT_TIP_SELECTOR_SYSTEM,
  TIP_PROVENANCE,
  TIP_RECEPTION_PROVENANCE,
  TIP_RECEPTION_SYSTEM,
} from '../src/tips/prompts.js';
import { SITUATION_PERSISTENT_MEMORY } from '../src/tips/catalog.js';
import { MockTransport, textReplyEvents } from './helpers/mock-transport.js';

// The retired manual-polling archive entry is replaced by a host-extension
// style situation (the catalog is host-extensible at call time) so the
// selector MECHANISM stays fully exercised without the engine advertising a
// capability it no longer has (slash retirement, SCS-REQ-REPOS-01 §4).
const WATCH_SITUATION = {
  featureId: 'watch-mode',
  action: 'enable watch mode',
  situation: 'User keeps re-checking the same status manually.',
};
const CATALOG = [...CONTEXT_TIP_CATALOG, WATCH_SITUATION];
const ELIGIBLE = ['watch-mode', 'persistent-memory'];

// ---------------------------------------------------------------------------
// parseContextTip — fails SAFE to no-tip
// ---------------------------------------------------------------------------

describe('parseContextTip (fails SAFE to no-tip)', () => {
  it('accepts a well-formed eligible tip', () => {
    const r = parseContextTip(
      '{"has_tip":true,"tip":"You are polling — watch mode can do it for you.","feature_id":"watch-mode","action":"enable watch mode"}',
      ELIGIBLE,
      CATALOG,
    );
    expect(r).toEqual({
      hasTip: true,
      tip: 'You are polling — watch mode can do it for you.',
      featureId: 'watch-mode',
      action: 'enable watch mode',
    });
  });
  it('has_tip false -> no tip', () => {
    expect(parseContextTip('{"has_tip":false}', ELIGIBLE, CATALOG)).toEqual({ hasTip: false });
  });
  it('garbled/empty reply -> no tip', () => {
    expect(parseContextTip('', ELIGIBLE, CATALOG)).toEqual({ hasTip: false });
    expect(parseContextTip('the user is fine', ELIGIBLE, CATALOG)).toEqual({ hasTip: false });
  });
  it('drops an INELIGIBLE feature_id (not in eligible set) -> no tip', () => {
    const r = parseContextTip(
      '{"has_tip":true,"tip":"x","feature_id":"persistent-memory","action":"#"}',
      ['watch-mode'], // persistent-memory NOT eligible this call
      CATALOG,
    );
    expect(r).toEqual({ hasTip: false });
  });
  it('drops a HALLUCINATED feature_id (not in catalog) -> no tip', () => {
    const r = parseContextTip(
      '{"has_tip":true,"tip":"x","feature_id":"invented-feature","action":"/xyz"}',
      ['invented-feature'],
      CATALOG,
    );
    expect(r).toEqual({ hasTip: false });
  });
  it('drops a tip with empty text -> no tip', () => {
    const r = parseContextTip(
      '{"has_tip":true,"tip":"","feature_id":"watch-mode","action":"enable watch mode"}',
      ELIGIBLE,
      CATALOG,
    );
    expect(r).toEqual({ hasTip: false });
  });
  it('coerces a non-boolean has_tip (string/number) to no-tip', () => {
    expect(
      parseContextTip('{"has_tip":"true","tip":"x","feature_id":"watch-mode","action":"y"}', ELIGIBLE, CATALOG),
    ).toEqual({ hasTip: false });
    expect(
      parseContextTip('{"has_tip":1,"tip":"x","feature_id":"watch-mode","action":"y"}', ELIGIBLE, CATALOG),
    ).toEqual({ hasTip: false });
  });
  it("returns the catalog's authoritative action, not the model's free-text action", () => {
    const r = parseContextTip(
      '{"has_tip":true,"tip":"try it","feature_id":"watch-mode","action":"rm -rf / #model junk"}',
      ELIGIBLE,
      CATALOG,
    );
    // watch-mode's catalog action wins — the model's action is ignored.
    expect(r).toEqual({ hasTip: true, tip: 'try it', featureId: 'watch-mode', action: 'enable watch mode' });
  });
});

// ---------------------------------------------------------------------------
// parseTipReception — fails SAFE
// ---------------------------------------------------------------------------

describe('parseTipReception (fails SAFE)', () => {
  it('parses a full verdict', () => {
    expect(parseTipReception('{"acted_on":true,"reception":"positive"}')).toEqual({
      actedOn: true,
      reception: 'positive',
    });
  });
  it('garbled reply -> acted_on false, reception unknown', () => {
    expect(parseTipReception('no idea')).toEqual({ actedOn: false, reception: 'unknown' });
  });
  it('unrecognized reception -> unknown (fail-safe, audit 2026-07-17 L66)', () => {
    expect(parseTipReception('{"acted_on":false,"reception":"meh"}').reception).toBe('unknown');
  });
  it('is case-insensitive on reception', () => {
    expect(parseTipReception('{"acted_on":false,"reception":"NEGATIVE"}').reception).toBe('negative');
  });
  it('coerces a non-boolean acted_on to false', () => {
    expect(parseTipReception('{"acted_on":"true","reception":"neutral"}').actedOn).toBe(false);
    expect(parseTipReception('{"acted_on":1,"reception":"neutral"}').actedOn).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// End-to-end over a mock transport
// ---------------------------------------------------------------------------

describe('context-tips over a mock transport', () => {
  it('selectContextTip renders the catalog into the system prompt and returns the decision', async () => {
    const t = new MockTransport([
      textReplyEvents('{"has_tip":true,"tip":"You keep polling — watch mode does it for you.","feature_id":"watch-mode","action":"enable watch mode"}'),
    ]);
    const r = await selectContextTip(
      {
        transcript: 'is the deploy done? check CI again. any update?',
        eligibleIds: ELIGIBLE,
        sessionMetadata: { numStartups: 8 },
        catalog: CATALOG, // host extension at call time (see WATCH_SITUATION)
      },
      { transport: t },
    );
    expect(r.hasTip).toBe(true);
    const system = t.requests[0]?.system as string;
    // The catalog situation text is rendered into the <situations> block.
    expect(system).toContain('watch-mode');
    expect(system).toContain('re-checking the same status manually');
    expect(t.requests[0]?.temperature).toBe(0);
  });
  it('inserts a catalog situation containing $ sequences LITERALLY (no replace-macro)', async () => {
    const t = new MockTransport([textReplyEvents('{"has_tip":false}')]);
    const catalog = [
      { featureId: 'billing', action: '/bill', situation: 'User mentions costs $$$ and a $& token literally.' },
    ];
    await selectContextTip(
      { transcript: 'x', eligibleIds: ['billing'], catalog },
      { transport: t },
    );
    const system = t.requests[0]?.system as string;
    expect(system).toContain('costs $$$ and a $& token literally.');
  });
  it('evaluateTipReception returns a structured verdict', async () => {
    const t = new MockTransport([textReplyEvents('{"acted_on":true,"reception":"positive"}')]);
    const r = await evaluateTipReception(
      { tip: 'try watch mode', action: 'enable watch mode', transcriptAfter: 'User: nice, watch mode worked!' },
      { transport: t },
    );
    expect(r).toEqual({ actedOn: true, reception: 'positive' });
  });
});

// ---------------------------------------------------------------------------
// Corpus-sync guard
// ---------------------------------------------------------------------------

describe('context-tip prompt provenance (corpus-sync guard, Track B parity)', () => {
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
  const faithful = (text: string, slug: string) => {
    const body = norm(stripHeader(readFileSync(join(archive, `${slug}.md`), 'utf8')));
    return norm(text)
      .split(/(?<=[.:])\s+/)
      .map(norm)
      .filter((s) => s.length >= 40 && !s.includes('{'))
      .filter((s) => !body.includes(s.slice(0, 60)));
  };

  it('the provenance table has 2 faithful entries', () => {
    expect(Object.keys(TIP_PROVENANCE)).toHaveLength(2);
    for (const p of Object.values(TIP_PROVENANCE)) expect(p.faithful).toBe(true);
  });
  it.runIf(existsSync(archive))('selector is faithful to its archive', () => {
    expect(faithful(CONTEXT_TIP_SELECTOR_SYSTEM, CONTEXT_TIP_SELECTOR_PROVENANCE.slug)).toEqual([]);
  });
  it.runIf(existsSync(archive))('reception evaluator is faithful to its archive', () => {
    expect(faithful(TIP_RECEPTION_SYSTEM, TIP_RECEPTION_PROVENANCE.slug)).toEqual([]);
  });
  it.runIf(existsSync(archive))('catalog situations are faithful to their archive', () => {
    expect(faithful(SITUATION_PERSISTENT_MEMORY, 'data-context-tip-situation-persistent-memory')).toEqual([]);
  });
});
