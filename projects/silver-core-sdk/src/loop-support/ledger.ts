/**
 * R4 ledger primitive (SCS-REQ-REPOS-01 §3 R4) — pure dedup-ledger logic for
 * host-built unattended loops.
 *
 * A loop that reports events (alerts, findings, collected items) across many
 * injected turns needs exactly-once semantics that survive context
 * compaction. This module is that memory: record what was reported (key +
 * timestamp + summary), ask whether a key was reported, evict by capacity or
 * age, and serialize/deserialize so the HOST picks the storage medium — the
 * engine persists nothing.
 *
 * Positioning discipline: no clock lives here. `record()` accepts an explicit
 * `at` and `prune()` an explicit `now`; the Date.now() fallbacks are readings
 * taken at call time, never schedules (POSITIONING §1 "no clock").
 *
 * The two adapters close the loop-assembly seams in one line each:
 *   - `toPrelude()`     -> the R1 structured-prelude shape (turn injection);
 *   - `toRetainedRegion()` -> the R3 retained-region shape (survives folds).
 */

import { ConfigurationError } from '../errors.js';

/** One reported event. */
export type LedgerEntry = {
  /** Host-chosen dedup key (non-empty). */
  key: string;
  /** Epoch-ms timestamp of the report. */
  at: number;
  /** Optional short human-readable summary. */
  summary?: string;
};

/** Eviction configuration. Both bounds optional; each must be positive. */
export type LedgerConfig = {
  /** Keep at most this many entries; the oldest (by `at`) are evicted first. */
  maxEntries?: number;
  /** Entries older than `now - maxAgeMs` are evicted on record()/prune(). */
  maxAgeMs?: number;
};

/** R1 structured-prelude shape (see `Options.prelude`). */
export type LedgerPrelude = { title: string; content: string };

/** R3 retained-region shape (see `CompactionOptions.retainedRegions`). */
export type LedgerRegion = { id: string; title?: string; content: string };

const SERIAL_VERSION = 1;
const DEFAULT_REGION_ID = 'reported-events-ledger';
const DEFAULT_TITLE = 'Previously reported events';

/** Dedup ledger for already-reported events. Pure logic, no I/O, no clock. */
export class ReportLedger {
  private readonly byKey = new Map<string, LedgerEntry>();
  private readonly maxEntries: number | undefined;
  private readonly maxAgeMs: number | undefined;

  constructor(config?: LedgerConfig) {
    if (config?.maxEntries !== undefined && !(config.maxEntries > 0)) {
      throw new ConfigurationError('ledger maxEntries must be a positive number');
    }
    if (config?.maxAgeMs !== undefined && !(config.maxAgeMs > 0)) {
      throw new ConfigurationError('ledger maxAgeMs must be a positive number');
    }
    this.maxEntries = config?.maxEntries;
    this.maxAgeMs = config?.maxAgeMs;
  }

  /** Number of live entries. */
  get size(): number {
    return this.byKey.size;
  }

  /** Was this key already reported? */
  has(key: string): boolean {
    return this.byKey.has(key);
  }

  /**
   * Record a reported event. Returns true when the key is NEW; false on a
   * duplicate (the first record wins — dedup semantics, not last-write).
   * Capacity and age eviction run after a successful insert.
   */
  record(key: string, opts?: { at?: number; summary?: string }): boolean {
    if (key.length === 0) {
      throw new ConfigurationError('ledger key must be a non-empty string');
    }
    if (this.byKey.has(key)) return false;
    const at = opts?.at ?? Date.now();
    // A non-finite timestamp (NaN/Infinity) would make digest() throw
    // (Date#toISOString RangeError) inside toPrelude/toRetainedRegion — the
    // latter mid-compaction — and break the serialize/deserialize round-trip
    // (JSON turns NaN into null, which deserialize rejects). Fail loud here,
    // at the write, instead of deep in a fold.
    if (!Number.isFinite(at)) {
      throw new ConfigurationError('ledger entry timestamp (at) must be a finite number');
    }
    const entry: LedgerEntry = { key, at };
    if (opts?.summary !== undefined) entry.summary = opts.summary;
    this.byKey.set(key, entry);
    this.evict(at);
    return true;
  }

  /**
   * Drop entries older than `now - maxAgeMs`; returns how many were dropped.
   * No-op (returns 0) when maxAgeMs is unset.
   */
  prune(now?: number): number {
    if (this.maxAgeMs === undefined) return 0;
    const cutoff = (now ?? Date.now()) - this.maxAgeMs;
    let dropped = 0;
    for (const [key, entry] of this.byKey) {
      if (entry.at < cutoff) {
        this.byKey.delete(key);
        dropped += 1;
      }
    }
    return dropped;
  }

  /** Entries ordered oldest-first (by `at`, then key — deterministic). */
  entries(): LedgerEntry[] {
    return [...this.byKey.values()].sort(
      (a, b) => a.at - b.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    );
  }

  /** JSON envelope carrying config + entries; feed to `deserialize`. */
  serialize(): string {
    const config: LedgerConfig = {};
    if (this.maxEntries !== undefined) config.maxEntries = this.maxEntries;
    if (this.maxAgeMs !== undefined) config.maxAgeMs = this.maxAgeMs;
    return JSON.stringify({ v: SERIAL_VERSION, config, entries: this.entries() });
  }

  /** Revive a ledger from `serialize()` output. Malformed input throws. */
  static deserialize(raw: string): ReportLedger {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ConfigurationError('ledger payload is not valid JSON');
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      (parsed as { v?: unknown }).v !== SERIAL_VERSION ||
      !Array.isArray((parsed as { entries?: unknown }).entries)
    ) {
      throw new ConfigurationError('ledger payload has an unrecognized shape');
    }
    const { config, entries } = parsed as {
      config?: LedgerConfig;
      entries: unknown[];
    };
    const ledger = new ReportLedger(config);
    for (const e of entries) {
      const entry = e as Partial<LedgerEntry> | null;
      if (
        entry === null ||
        typeof entry !== 'object' ||
        typeof entry.key !== 'string' ||
        entry.key.length === 0 ||
        typeof entry.at !== 'number' ||
        !Number.isFinite(entry.at) ||
        (entry.summary !== undefined && typeof entry.summary !== 'string')
      ) {
        throw new ConfigurationError('ledger payload carries a malformed entry');
      }
      // Insert directly instead of via record(): every serialized entry was
      // LIVE at serialize() time, so revival must reproduce it verbatim.
      // record() runs age eviction per insert with the inserted `at` as "now",
      // which is not idempotent under maxAgeMs + non-monotonic timestamps
      // (a later-inserted large-`at` entry would prune earlier live ones the
      // original ledger still held). Age pruning at revival has no meaningful
      // "now" — the host calls prune(now) explicitly when it wants one.
      if (!ledger.byKey.has(entry.key)) {
        const revived: LedgerEntry = { key: entry.key, at: entry.at };
        if (entry.summary !== undefined) revived.summary = entry.summary;
        ledger.byKey.set(entry.key, revived);
      }
    }
    // Hold the capacity invariant for hand-crafted payloads that carry more
    // entries than their own declared maxEntries (a real serialize() never
    // does); oldest-first, same policy as record().
    ledger.evictOverCapacity();
    return ledger;
  }

  /** R1 adapter: the ledger digest as a structured injection prelude. */
  toPrelude(opts?: { title?: string }): LedgerPrelude {
    return { title: opts?.title ?? DEFAULT_TITLE, content: this.digest() };
  }

  /** R3 adapter: the ledger digest as a compaction retained region. */
  toRetainedRegion(opts?: { id?: string; title?: string }): LedgerRegion {
    const region: LedgerRegion = {
      id: opts?.id ?? DEFAULT_REGION_ID,
      content: this.digest(),
    };
    region.title = opts?.title ?? DEFAULT_TITLE;
    return region;
  }

  /** Human/model-readable digest of the ledger, oldest-first, deterministic. */
  private digest(): string {
    const all = this.entries();
    if (all.length === 0) {
      return 'Events reported so far (do not re-report): none.';
    }
    const lines = ['Events reported so far (do not re-report):'];
    for (const e of all) {
      const when = new Date(e.at).toISOString();
      lines.push(`- ${e.key} (${when})` + (e.summary ? ` — ${e.summary}` : ''));
    }
    return lines.join('\n');
  }

  /** Capacity + age eviction, oldest-first. */
  private evict(now: number): void {
    if (this.maxAgeMs !== undefined) this.prune(now);
    this.evictOverCapacity();
  }

  /** Capacity-only eviction, oldest-first (no age pruning). */
  private evictOverCapacity(): void {
    if (this.maxEntries === undefined) return;
    while (this.byKey.size > this.maxEntries) {
      let oldest: LedgerEntry | undefined;
      for (const entry of this.byKey.values()) {
        if (
          oldest === undefined ||
          entry.at < oldest.at ||
          (entry.at === oldest.at && entry.key < oldest.key)
        ) {
          oldest = entry;
        }
      }
      if (oldest === undefined) return;
      this.byKey.delete(oldest.key);
    }
  }
}
