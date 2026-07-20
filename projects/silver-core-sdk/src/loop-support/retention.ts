/**
 * R3 compaction retained regions (SCS-REQ-REPOS-01 §3 R3) — the store behind
 * `compaction.retainedRegions` / `Query.setRetainedRegion`.
 *
 * A host may declare structured context regions that MUST survive automatic
 * compaction verbatim (e.g. a dedup ledger whose semantics cannot be trusted
 * to a lossy summary). The engine re-stamps every declared region into the
 * post-fold context on each compaction. The store enforces a hard byte cap:
 * an over-cap declaration THROWS at declaration time — the engine never
 * silently truncates a region.
 */

import { ConfigurationError } from '../errors.js';
import { escapeTagAttr, neutralizeClosingTag } from '../internal/inert-text.js';
import type { RetainedRegion } from '../types.js';

/** Default total byte cap across all retained regions (rendered form). */
export const DEFAULT_RETAINED_REGION_MAX_BYTES = 16_384;

/** The exact text a region contributes to the post-compaction context.
 *
 * L2-8 (audit 2026-07-17): region content routinely derives from EXTERNAL
 * event data (e.g. a ledger digest), and the engine re-stamps this rendering
 * verbatim on every fold. An id/title containing `"` would break out of the
 * attribute, and content containing `</retained-context>` would close the
 * region early and plant forged text outside the retained boundary — so the
 * attributes are entity-escaped and the content's terminator is neutralized.
 * The stored region itself stays verbatim; only this rendering escapes. */
export function renderRetainedRegion(region: RetainedRegion): string {
  const title =
    region.title !== undefined ? ` title="${escapeTagAttr(region.title)}"` : '';
  return (
    `<retained-context id="${escapeTagAttr(region.id)}"${title}>\n` +
    neutralizeClosingTag(region.content, 'retained-context') +
    '\n</retained-context>'
  );
}

/** Holds the declared regions; shared by reference between query and engine. */
export class RetentionStore {
  private readonly byId = new Map<string, RetainedRegion>();
  readonly maxBytes: number;

  constructor(maxBytes?: number, initial?: RetainedRegion[]) {
    if (maxBytes !== undefined && !(maxBytes > 0)) {
      throw new ConfigurationError(
        'compaction.retainedRegionMaxBytes must be a positive number',
      );
    }
    this.maxBytes = maxBytes ?? DEFAULT_RETAINED_REGION_MAX_BYTES;
    for (const region of initial ?? []) this.set(region);
  }

  /**
   * Declare (or replace, by id) a retained region. Over-cap declarations
   * throw — the size error reports actual vs cap so the host can shrink the
   * content or raise the cap; nothing is ever silently truncated.
   */
  set(region: RetainedRegion): void {
    if (region.id.length === 0) {
      throw new ConfigurationError('retained region id must be a non-empty string');
    }
    let prospective = Buffer.byteLength(renderRetainedRegion(region), 'utf8');
    let regionCount = 1;
    for (const [id, existing] of this.byId) {
      if (id === region.id) continue; // replaced — not counted twice
      prospective += Buffer.byteLength(renderRetainedRegion(existing), 'utf8');
      regionCount += 1;
    }
    // The cap guards the JOINED rendered form renderBlocks() actually emits:
    // its '\n\n' joiners add 2 bytes per gap, which a per-region sum misses.
    prospective += 2 * (regionCount - 1);
    if (prospective > this.maxBytes) {
      throw new ConfigurationError(
        `retained regions would total ${prospective} bytes, over the ` +
          `${this.maxBytes}-byte cap; the engine never truncates a retained ` +
          'region — shrink the content or raise compaction.retainedRegionMaxBytes',
      );
    }
    this.byId.set(region.id, { ...region });
  }

  /** Remove a region by id; false when no such region exists. */
  remove(id: string): boolean {
    return this.byId.delete(id);
  }

  /** Declared regions in declaration order. */
  regions(): RetainedRegion[] {
    return [...this.byId.values()].map((r) => ({ ...r }));
  }

  get isEmpty(): boolean {
    return this.byId.size === 0;
  }

  /** All regions rendered for context injection, declaration order. */
  renderBlocks(): string {
    return [...this.byId.values()].map(renderRetainedRegion).join('\n\n');
  }
}
