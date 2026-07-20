/**
 * Corpus-sync guard for the tool-description surface (Track B): every archive
 * fragment a faithful description cites must still be represented in that
 * description. Upstream drift (or a dropped clause) fails here instead of
 * diverging silently. Skips when the archive is absent (standalone extract).
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  TOOL_DESCRIPTION_PROVENANCE,
  TOOL_DESCRIPTION_TEXT,
} from '../src/tools/descriptions.js';

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
const stripHeader = (md: string) => md.replace(/^<!--[\s\S]*?-->\n?/, '');

/**
 * Stable anchors for an archive fragment: its sentence-ish runs that carry no
 * template variable (`${...}`) — the parts a faithful (but adapted) description
 * reproduces verbatim. Variable-bearing sentences and short fillers are skipped,
 * since the description resolves/adapts those. A fragment is "represented" when
 * at least one stable anchor still appears — that catches a fragment being
 * dropped or the upstream wording drifting, while tolerating our documented
 * adaptations (tool names, resolved variables, omitted examples).
 */
function stableAnchors(body: string): string[] {
  return body
    .split(/(?<=[.:])\s+/)
    .map((s) => norm(s))
    .filter((s) => s.length >= 40 && !s.includes('${'))
    .map((s) => s.slice(0, 45));
}

describe('tool-description provenance (corpus-sync guard)', () => {
  const haveArchive = existsSync(ARCHIVE);

  it('every provenance-tracked tool has its description text', () => {
    for (const p of TOOL_DESCRIPTION_PROVENANCE) {
      expect(TOOL_DESCRIPTION_TEXT[p.tool], p.tool).toBeTruthy();
      expect(p.slugs.length, p.tool).toBeGreaterThan(0);
    }
  });

  it.runIf(haveArchive)('each faithful description still represents every archive fragment it cites', () => {
    const drifted: string[] = [];
    for (const p of TOOL_DESCRIPTION_PROVENANCE) {
      if (!p.faithful) continue;
      const desc = norm(TOOL_DESCRIPTION_TEXT[p.tool] ?? '');
      for (const slug of p.slugs) {
        const file = join(ARCHIVE, `${slug}.md`);
        if (!existsSync(file)) {
          drifted.push(`${p.tool}: cited archive fragment missing (${slug}.md)`);
          continue;
        }
        const body = norm(stripHeader(readFileSync(file, 'utf8')));
        const anchors = stableAnchors(body);
        // A fragment with no variable-free sentence is entirely template/example;
        // it cannot be anchor-checked, so it is not a drift signal here.
        if (anchors.length > 0 && !anchors.some((a) => desc.includes(a))) {
          drifted.push(`${p.tool}: fragment ${slug} no longer represented (no stable anchor found)`);
        }
      }
    }
    expect(drifted, drifted.join('\n')).toEqual([]);
  });
});
