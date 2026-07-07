/**
 * Corpus-sync guard (Track B): every `faithful` main-loop fragment must still be
 * found in its declared archive source. This turns upstream drift into a test
 * failure instead of a silent divergence — the core promise of the assembly
 * layer over the old hardcoded snapshot.
 *
 * The archive (Public-Info-Pool/Reference/Claude-Code-System-Prompts) lives at
 * the repo root, present in a full checkout (CI) but not in a standalone package
 * extract. When it is absent the guard skips — the SDK stays self-contained.
 *
 * i18n-zh Phase 2 batch A (2026-07-08): the main-loop fragments are now
 * TRANSLATED to Chinese, so `faithful` is false throughout and the English
 * archive can no longer be anchor-matched against Chinese prose. These guards
 * therefore go INERT for the translated fragments (they skip non-faithful and
 * CJK-bearing text); the translation is instead covered by the golden byte-lock
 * (tests/prompt-assembler.test.ts, regenerated from the fragments) and the
 * structural i18n guard (tests/prompt-fragments-i18n-zh.test.ts). The archive
 * machinery is kept so a future re-added English fragment is checked again.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { MAIN_LOOP_INTRO, MAIN_LOOP_BODY } from '../src/engine/prompt-fragments.js';

const here = dirname(fileURLToPath(import.meta.url));
const ARCHIVE = join(
  here,
  '..',
  '..',
  '..',
  'Public-Info-Pool',
  'Reference',
  'Claude-Code-System-Prompts',
  'system-prompts',
);

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const longestLine = (text: string) => text.split('\n').sort((a, b) => b.length - a.length)[0]!;
const stripHeader = (md: string) => md.replace(/^<!--[\s\S]*?-->\n?/, '');
// A CJK-bearing fragment is translated (i18n-zh) — its Chinese prose cannot be
// anchor-matched against the English archive, so the archive guards skip it.
const CJK = /[一-鿿]/;

const ALL = [MAIN_LOOP_INTRO, ...MAIN_LOOP_BODY];

describe('main-loop fragment provenance (corpus-sync guard)', () => {
  const haveArchive = existsSync(ARCHIVE);

  it.runIf(haveArchive)('every faithful fragment is found verbatim in its archive source', () => {
    const drifted: string[] = [];
    for (const f of ALL) {
      if (!f.faithful) continue;
      const file = join(ARCHIVE, `${f.slug}.md`);
      if (!existsSync(file)) {
        drifted.push(`${f.id}: archive file missing (${f.slug}.md)`);
        continue;
      }
      const body = norm(stripHeader(readFileSync(file, 'utf8')));
      const sig = norm(longestLine(f.text)).slice(0, 120);
      if (!body.includes(sig)) {
        drifted.push(`${f.id}: faithful text not found in ${f.slug}.md (drift or bad slug)`);
      }
    }
    expect(drifted, drifted.join('\n')).toEqual([]);
  });

  it.runIf(haveArchive)('adapted fragments citing a real source keep their anchor present', () => {
    const drifted: string[] = [];
    for (const f of ALL) {
      if (f.faithful || f.slug === 'adapted' || f.slug === 'sdk-original') continue;
      if (CJK.test(f.text)) continue; // translated (i18n-zh): archive is English
      const file = join(ARCHIVE, `${f.slug}.md`);
      if (!existsSync(file)) {
        drifted.push(`${f.id}: cited source missing (${f.slug}.md)`);
        continue;
      }
      const body = norm(stripHeader(readFileSync(file, 'utf8')));
      const anchor = norm(longestLine(f.text)).slice(0, 40);
      if (!body.includes(anchor)) {
        drifted.push(`${f.id}: adapted anchor not found in ${f.slug}.md`);
      }
    }
    expect(drifted, drifted.join('\n')).toEqual([]);
  });

  it('declares a coherent provenance for every fragment', () => {
    for (const f of ALL) {
      // faithful implies a concrete archive slug (not the adapted/original sentinels)
      if (f.faithful) {
        expect(f.slug, f.id).not.toBe('adapted');
        expect(f.slug, f.id).not.toBe('sdk-original');
      }
    }
  });
});
