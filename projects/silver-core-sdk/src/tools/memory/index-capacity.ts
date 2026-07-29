/**
 * Resident-index capacity: ONE measurement shared by the read side (R6
 * injection truncation) and the write side (the back-pressure warning).
 *
 * The failure this closes (keeper diagnosis 2026-07-27, BPT field report):
 * R6 truncates the index silently on every load, so a model that keeps
 * appending to /memories/MEMORY.md never learns that the tail it wrote is
 * already invisible to every future session — it just keeps paying tool
 * round-trips to `view` its way through the tree because the head it does get
 * carries prose instead of pointers. Read-side truncation with no write-side
 * signal is a one-way mirror; this module is the other side of it.
 *
 * Both sides MUST judge by the same rule, hence one module: a warning that
 * fires on a different threshold than the injection truncates at would be
 * worse than no warning at all.
 */

import { Buffer } from 'node:buffer';

/** The read-side caps a write is judged against (spec R6 defaults 200 / 25600). */
export type IndexCaps = { maxLines: number; maxBytes: number };

/** The store's char-cap pagination notice is view CHROME, not index content. */
const PAGINATION_NOTICE_RE = /^\[Output truncated at \d+ characters\./;

/**
 * Recover raw file lines from a `view` result. The contract-fixed format is
 * `header\n{6-char number}\t{line}`*, optionally followed by the store's
 * pagination notice — without stripping both, the injected index carries the
 * gutter and the notice verbatim (audit 2026-07-17 L27).
 *
 * `sawNotice` reports that the store itself truncated the read (a separate
 * cap from the caller's line/byte caps).
 */
export function recoverIndexLines(viewed: string): { lines: string[]; sawNotice: boolean } {
  const numbered = viewed.split('\n').slice(1);
  let sawNotice = false;
  if (
    numbered.length > 0 &&
    PAGINATION_NOTICE_RE.test(numbered[numbered.length - 1] as string)
  ) {
    numbered.pop();
    sawNotice = true;
  }
  return { lines: numbered.map((l) => l.replace(/^\s*\d+\t/, '')), sawNotice };
}

export type IndexCapacity = {
  /** Lines recovered from the read (bounded by whatever range was requested). */
  lineCount: number;
  /** UTF-8 bytes of those lines joined by newlines. */
  byteCount: number;
  /** The read would lose content at injection time. */
  over: boolean;
  /** Not over yet, but within APPROACH_RATIO of either cap — the official
   *  two-state warning's early tier (keeper 2026-07-28 拷问 #9: warn BEFORE
   *  the tail goes invisible, not only after). */
  approaching: boolean;
  /** Which cap it breached first ('lines' wins when both do; 'view' means the
   *  store's own char cap cut the read before the line/byte caps could even be
   *  measured — the strongest possible over-signal, since the injection reads
   *  through the same view). */
  breached: 'lines' | 'bytes' | 'view' | null;
};

/** Fraction of a cap at which the approaching tier fires. */
export const APPROACH_RATIO = 0.8;

/**
 * Judge recovered index lines against the caps.
 *
 * Callers read one line PAST maxLines precisely so overflow is detectable
 * without a second round-trip; that extra line is what makes `lineCount >
 * maxLines` meaningful here.
 */
export function assessIndexCapacity(lines: string[], caps: IndexCaps): IndexCapacity {
  const byteCount = lines.reduce(
    (sum, line, i) => sum + Buffer.byteLength(line, 'utf8') + (i > 0 ? 1 : 0),
    0,
  );
  const overLines = lines.length > caps.maxLines;
  const overBytes = byteCount > caps.maxBytes;
  const over = overLines || overBytes;
  return {
    lineCount: lines.length,
    byteCount,
    over,
    approaching:
      !over &&
      (lines.length >= caps.maxLines * APPROACH_RATIO ||
        byteCount >= caps.maxBytes * APPROACH_RATIO),
    breached: overLines ? 'lines' : overBytes ? 'bytes' : null,
  };
}

/**
 * The ONE viewed-index judgment both sides must share: recover the lines AND
 * fold the store's own view-cap truncation (`sawNotice`) into the verdict.
 *
 * Judging `recoverIndexLines(viewed).lines` alone re-opens the one-way mirror
 * this module exists to close: the store's char cap (default maxViewChars
 * 16000) is SMALLER than the default index byte cap (25600), so a dense ASCII
 * index gets cut by the view first — the write side then counts ~111 recovered
 * lines, finds them under the 200-line cap, and never warns, while the read
 * side (same view) injects the same truncated head. A truncated view IS the
 * over-limit condition, whatever the line/byte math says of the surviving head
 * (2026-07-28 alignment audit, keeper-ruled fix).
 */
export function assessViewedIndex(
  viewed: string,
  caps: IndexCaps,
): { lines: string[]; capacity: IndexCapacity } {
  const { lines, sawNotice } = recoverIndexLines(viewed);
  const capacity = assessIndexCapacity(lines, caps);
  if (sawNotice && !capacity.over) {
    return { lines, capacity: { ...capacity, over: true, approaching: false, breached: 'view' } };
  }
  if (sawNotice && capacity.breached === null) {
    return { lines, capacity: { ...capacity, breached: 'view' } };
  }
  return { lines, capacity };
}

/**
 * The warning appended to a successful index write, in the official TWO-STATE
 * shape (keeper 2026-07-28 拷问 #9): `over` states the consequence (the tail
 * is ALREADY invisible, not "may become"), because a warning the model reads
 * as advisory changes nothing; `approaching` fires early with the same fix so
 * the over state is ideally never reached. Both states name the TARGET size
 * ("to under <targetDesc>") — a warning without a target invites one-line
 * token trims that leave the index over the cap.
 */
export function indexCapacityWarning(
  path: string,
  capacity: IndexCapacity,
  caps: IndexCaps,
): string {
  const targetDesc = `${caps.maxLines} lines / ${caps.maxBytes} bytes`;
  const fix =
    `to under ${targetDesc} now: keep one line per entry ` +
    `("- [<title>](<file path>) — one-line hook"), move any detail into the topic ` +
    `file it points at, and merge or drop stale entries.`;
  if (!capacity.over) {
    return (
      `\n\nNOTICE: ${path} is at ${capacity.lineCount} lines / ` +
      `${capacity.byteCount} bytes, approaching its ${targetDesc} read limit. ` +
      `Compact it ${fix}`
    );
  }
  const measured =
    capacity.breached === 'view'
      ? `so large that the store's own view limit truncated the read before ` +
        `the ${caps.maxLines}-line / ${caps.maxBytes}-byte index caps could ` +
        `even be measured`
      : capacity.breached === 'lines'
        ? `over ${caps.maxLines} lines`
        : `${capacity.byteCount} bytes, over the ${caps.maxBytes}-byte limit`;
  return (
    `\n\nWARNING: ${path} is now ${measured}. Only the head is loaded into ` +
    `context at session start — everything past the limit is silently dropped, ` +
    `so entries at the end are ALREADY invisible to future sessions. The index ` +
    `is an index, not a memory — rewrite it ${fix}`
  );
}
