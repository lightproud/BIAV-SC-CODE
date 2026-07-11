/**
 * Eval-set governance guards (SCS-REQ-002 REQ-2.1):
 *  - tamper evidence: evals/ content must match evals/MANIFEST.sha256 — any
 *    edit without a deliberate manifest regeneration turns this red (the
 *    "agents must not rewrite the exam" red line; Phase 3 adds CI
 *    hard-reject for agent PRs touching evals/);
 *  - structural integrity: exactly 20 questions, declared dimension counts
 *    match, every question carries the fields the runner and the judge
 *    depend on, and the judge prompt keeps its substitution slots.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// eslint-disable-next-line -- plain .mjs helper, no types needed
// @ts-expect-error untyped .mjs helper
import { buildManifest } from '../scripts/update-evals-manifest.mjs';

const evalsDir = join(__dirname, '..', 'evals');

describe('evals/ tamper evidence (REQ-2.1)', () => {
  it('MANIFEST.sha256 matches the current evals/ content', () => {
    const recorded = readFileSync(join(evalsDir, 'MANIFEST.sha256'), 'utf8');
    expect(buildManifest()).toBe(recorded);
  });
});

describe('evals/behavior/questions.json structure', () => {
  const doc = JSON.parse(readFileSync(join(evalsDir, 'behavior', 'questions.json'), 'utf8')) as {
    dimensions: Record<string, number>;
    questions: Array<Record<string, unknown>>;
  };

  it('has exactly 20 questions and the declared per-dimension counts', () => {
    expect(doc.questions).toHaveLength(20);
    const counts: Record<string, number> = {};
    for (const q of doc.questions) {
      counts[q['dimension'] as string] = (counts[q['dimension'] as string] ?? 0) + 1;
    }
    expect(counts).toEqual(doc.dimensions);
  });

  it('covers the three ruled dimensions and the hybrid sourcing mix (12-14 distilled)', () => {
    expect(Object.keys(doc.dimensions).sort()).toEqual([
      'disconnect_recovery',
      'memory_recall',
      'token_efficiency',
    ]);
    const distilled = doc.questions.filter((q) => q['source'] === 'distilled').length;
    expect(distilled).toBeGreaterThanOrEqual(12);
    expect(distilled).toBeLessThanOrEqual(14);
    expect(doc.questions.length - distilled).toBeGreaterThanOrEqual(6);
  });

  it('every question carries the runner/judge contract fields, unique ids, and a legal driver', () => {
    const ids = new Set<string>();
    for (const q of doc.questions) {
      const id = q['id'] as string;
      expect(ids.has(id)).toBe(false);
      ids.add(id);
      expect(['distilled', 'constructed']).toContain(q['source']);
      expect(['draft', 'final']).toContain(q['status']);
      expect(typeof q['scenario']).toBe('string');
      expect(Array.isArray(q['rubric'])).toBe(true);
      expect((q['rubric'] as unknown[]).length).toBeGreaterThanOrEqual(2);
      const harness = q['harness'] as { driver: string; pending?: string };
      expect(['prompt-session', 'manual']).toContain(harness.driver);
      // A manual question must say WHY it is pending — no silent caps.
      if (harness.driver === 'manual') expect(typeof harness.pending).toBe('string');
    }
  });
});

describe('evals/judge-prompt.md (fixed judge contract)', () => {
  const prompt = readFileSync(join(evalsDir, 'judge-prompt.md'), 'utf8');

  it('keeps both substitution slots and the pinned judge model', () => {
    expect(prompt).toContain('{{QUESTION_JSON}}');
    expect(prompt).toContain('{{EVIDENCE_JSON}}');
    expect(prompt).toContain('claude-sonnet-5');
  });

  it('anchors the 1-5 scale and the lower-when-uncertain rule', () => {
    for (const anchor of ['**5**', '**4**', '**3**', '**2**', '**1**']) {
      expect(prompt).toContain(anchor);
    }
    expect(prompt).toContain('LOWER');
  });
});
