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
  UNGOVERNED_TOOL_DESCRIPTIONS,
} from '../src/tools/descriptions.js';
import { createBuiltinTools } from '../src/tools/index.js';

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

  /**
   * A cited slug that names no file is broken provenance regardless of whether
   * the description is faithful or adapted — an adapted description still has
   * to say WHERE it was adapted FROM, and a pointer into thin air says nothing.
   *
   * Split out of the anchor check on 2026-07-27: the anchor check skips adapted
   * entries (their text legitimately diverges), and the existence check used to
   * ride along inside it. So when the 2.1.216 snapshot renamed
   * tool-description-sendmessagetool -> tool-description-sendmessage, the
   * SendMessage entry — adapted — pointed at a deleted file and the suite
   * stayed green. Two of the three dangling slugs that snapshot created were
   * caught the hard way (main went red for six hours); this third one was
   * caught only by a hand audit, because the guard was not looking.
   */
  it.runIf(haveArchive)('every cited archive fragment exists, faithful or adapted', () => {
    const dangling: string[] = [];
    for (const p of TOOL_DESCRIPTION_PROVENANCE) {
      for (const slug of p.slugs) {
        if (!existsSync(join(ARCHIVE, `${slug}.md`))) {
          dangling.push(`${p.tool}: cited archive fragment missing (${slug}.md)`);
        }
      }
    }
    expect(dangling, dangling.join('\n')).toEqual([]);
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

  /**
   * Completeness partition (keeper 2026-07-28 拷问 #2): every SHIPPED tool
   * name is in exactly ONE of the two ledgers — provenance (archive-governed)
   * or UNGOVERNED (self-written, reason on record). ToolSearch shipped for
   * weeks in neither, unmeasured, while being the sole gateway to 2/3 of the
   * tool surface under silverCoreToolOptions(); this guard makes that silence
   * impossible for the next tool.
   */
  it('every shipped tool is in exactly one description ledger', () => {
    const shipped = new Set<string>([
      ...createBuiltinTools().keys(),
      ...createBuiltinTools({ env: { CLAUDE_CODE_ENABLE_TASKS: '0' } }).keys(),
      // Conditionally-registered outside createBuiltinTools (query.ts):
      'Agent',
      'ToolSearch',
      'memory',
      'LoopControl',
    ]);
    const governed = new Set(TOOL_DESCRIPTION_PROVENANCE.map((p) => p.tool));
    const ungoverned = new Set(Object.keys(UNGOVERNED_TOOL_DESCRIPTIONS));

    const unclassified = [...shipped].filter((t) => !governed.has(t) && !ungoverned.has(t));
    expect(unclassified, `shipped tools in NO description ledger: ${unclassified.join(', ')}`)
      .toEqual([]);

    const doubled = [...governed].filter((t) => ungoverned.has(t));
    expect(doubled, `tools in BOTH ledgers: ${doubled.join(', ')}`).toEqual([]);

    // The ledgers may not name phantom tools either (a renamed tool must not
    // leave a stale ledger row claiming governance of nothing).
    const phantoms = [...governed, ...ungoverned].filter((t) => !shipped.has(t));
    expect(phantoms, `ledger rows naming unshipped tools: ${phantoms.join(', ')}`).toEqual([]);
  });
});
