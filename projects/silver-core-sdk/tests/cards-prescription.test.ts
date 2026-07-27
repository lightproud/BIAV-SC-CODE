/**
 * Prescription card kind (A1, keeper ruling 2026-07-27) + sessions-domain
 * health scan (audit P1-S1). Two additions from the same review batch:
 *
 * Cards grew a SECOND kind because one propositional mould (结论/依据/过期条件)
 * flattened every "how it was done" — and, under cards mode, every session-end
 * progress card (audit P1-3). Kind is told apart by field set; mixing kinds in
 * one card is rejected BY NAME, because a silent pick would train the model on
 * the wrong template.
 */

import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseMemoryCards, validateCardsContent } from '../src/tools/memory/cards.js';
import { assessSessionStoreHealth } from '../src/sessions/health.js';

const PROPOSITION = '## 命名规范\n结论: 服务名一律 kebab-case\n依据: 2026-07-04 团队约定\n过期条件: 团队约定变更\n';
const PRESCRIPTION =
  '## 部署回滚\n意图: 失败发布五分钟内回滚\n步骤: 1. 停流量 2. helm rollback 3. 冒烟\n结果: 三次实战平均 4 分钟\n适用边界: 仅 staging/prod 集群，db migration 不适用\n';

describe('prescription card kind (A1)', () => {
  it('parses a prescription card with its four fields', () => {
    const r = parseMemoryCards(PRESCRIPTION);
    expect(r).toMatchObject({ ok: true });
    if (r.ok) {
      expect(r.cards[0]).toEqual({
        kind: 'prescription',
        title: '部署回滚',
        intent: '失败发布五分钟内回滚',
        steps: '1. 停流量 2. helm rollback 3. 冒烟',
        outcome: '三次实战平均 4 分钟',
        scope: '仅 staging/prod 集群，db migration 不适用',
      });
    }
  });

  it('propositions still parse, now with the kind discriminant', () => {
    const r = parseMemoryCards(PROPOSITION);
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.cards[0]).toMatchObject({ kind: 'proposition', title: '命名规范' });
  });

  it('one file may hold both kinds side by side', () => {
    const r = parseMemoryCards(PROPOSITION + '\n' + PRESCRIPTION);
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.cards.map((c) => c.kind)).toEqual(['proposition', 'prescription']);
  });

  it('mixing kinds inside ONE card is rejected by name', () => {
    const mixed = '## 混搭\n结论: 某结论\n步骤: 某步骤\n过期条件: 某条件\n适用边界: 某边界\n';
    const r = parseMemoryCards(mixed);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) {
      expect(r.reason).toContain('mixes proposition fields');
      expect(r.reason).toContain('结论');
      expect(r.reason).toContain('步骤');
    }
  });

  it('an incomplete prescription names its own missing fields, not the proposition set', () => {
    const partial = '## 半张\n意图: 某意图\n步骤: 某步骤\n';
    const r = parseMemoryCards(partial);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) {
      expect(r.reason).toContain('结果 / 适用边界');
      expect(r.reason).not.toContain('结论');
    }
  });

  it('the structured error restates BOTH templates for repair', () => {
    const err = validateCardsContent('free prose');
    expect(err).toContain('结论: <conclusion>');
    expect(err).toContain('意图: <what this achieves>');
    expect(err).toContain('progress card');
  });

  it('full-width colons and multi-line continuation work for prescription fields', () => {
    const card =
      '## 全角\n意图：目标\n步骤：第一步\n第二步\n结果：成了\n适用边界：本仓\n';
    const r = parseMemoryCards(card);
    expect(r).toMatchObject({ ok: true });
    if (r.ok && r.cards[0]!.kind === 'prescription') {
      expect(r.cards[0]!.steps).toBe('第一步\n第二步');
    }
  });
});

describe('assessSessionStoreHealth (audit P1-S1)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bpt-sess-health-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const NOW = 1_800_000_000_000;
  const DAY = 86_400_000;

  it('reports absent-dir as unavailable, never a fabricated zero', async () => {
    const r = await assessSessionStoreHealth({ sessionDir: join(dir, 'nope') });
    expect(r.available).toBe(false);
    if (!r.available) expect(r.note).toContain('external sessionStore');
  });

  it('counts sessions, bytes, staleness and orphan checkpoint dirs', async () => {
    await writeFile(join(dir, 'fresh.jsonl'), 'x'.repeat(100));
    await writeFile(join(dir, 'old.jsonl'), 'y'.repeat(50));
    // The clock is injected, so BOTH mtimes must be set relative to NOW —
    // a real-clock mtime would land 30+ virtual days in NOW's past.
    const freshSec = (NOW - 1 * DAY) / 1000;
    await utimes(join(dir, 'fresh.jsonl'), freshSec, freshSec);
    const oldSec = (NOW - 40 * DAY) / 1000;
    await utimes(join(dir, 'old.jsonl'), oldSec, oldSec);
    // checkpoints: one for a live session, one orphan (transcript gone).
    await mkdir(join(dir, 'checkpoints', 'fresh', 'blobs'), { recursive: true });
    await writeFile(join(dir, 'checkpoints', 'fresh', 'blobs', '1.blob'), 'b'.repeat(30));
    await mkdir(join(dir, 'checkpoints', 'ghost'), { recursive: true });
    await writeFile(join(dir, 'checkpoints', 'ghost', 'index.jsonl'), 'z'.repeat(10));

    const r = await assessSessionStoreHealth({ sessionDir: dir, now: () => NOW });
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.sessions).toBe(2);
    expect(r.transcriptBytes).toBe(150);
    expect(r.checkpointBytes).toBe(40);
    expect(r.staleSessions).toBe(1);
    expect(r.staleList).toEqual(['old']);
    expect(r.orphanCheckpointDirs).toEqual(['ghost']);
    // Largest folds checkpoint bytes into the owning session.
    expect(r.largest[0]).toEqual({ sessionId: 'fresh', bytes: 130 });
    expect(r.truncatedScan).toBe(false);
  });

  it('a hit scan bound reads as a lower bound, not the whole tree', async () => {
    for (let i = 0; i < 6; i++) {
      await writeFile(join(dir, `s${i}.jsonl`), 'x');
    }
    const r = await assessSessionStoreHealth({ sessionDir: dir, maxEntries: 3 });
    expect(r.available).toBe(true);
    if (r.available) expect(r.truncatedScan).toBe(true);
  });
});
