/**
 * Fire-point footprint parsing — pure core shared by the Scheduler's
 * cross-restart recovery and the RoutineManager's status reverse-lookup
 * (design round 3, 2026-07-29: one parser, two consumers — a second
 * hand-rolled copy of this logic WILL drift, and every rule below was paid
 * for by an audit finding).
 *
 * A fire session id is `{segment}:{specId}:{fireAt}`. Two segments exist:
 * - `sched`  — Scheduler fire points (scheduleSessionId). These are the
 *   recovery footprint: the Scheduler's lastFired is rebuilt from them.
 * - `manual` — RoutineManager.triggerNow fire points. These are DELIBERATELY
 *   invisible to Scheduler recovery (different segment): a manual fire that
 *   landed in the `sched:` namespace would move the recovered footprint
 *   forward and swallow every missed fire point inside the compensation
 *   window.
 *
 * Parsing rules (each pinned by an audit round on the original in-recover
 * copy): strict numeric suffix only — `Number('')` and `Number('  ')` are 0,
 * so a malformed id would otherwise recover fireAt 0 and trigger a
 * catastrophic epoch catch-up (r2); a fractional part is legal because
 * validateSpec allows fractional `every` (r5); digits beyond the JS Date
 * range would pin the footprint in the far future and silently starve the
 * spec forever, so they are skipped (r4).
 */

/** Segment word of Scheduler fire ids (`sched:{specId}:{fireAt}`). */
export const SCHEDULE_FIRE_SEGMENT = 'sched';
/** Segment word of RoutineManager manual-fire ids (`manual:{specId}:{fireAt}`). */
export const MANUAL_FIRE_SEGMENT = 'manual';

/** Upper bound of a representable fire point (JS Date range, ±8.64e15 ms). */
export const MAX_FIRE_POINT_MS = 8_640_000_000_000_000;

const FIRE_SUFFIX = /^\d+(\.\d+)?$/;

/**
 * The fire point encoded in `sessionId` for `specId` under `segment`, or
 * null when the id is not a well-formed fire id of that spec/segment.
 * Pure string/number work — no I/O, no clock.
 */
export function parseFirePoint(
  sessionId: string,
  specId: string,
  segment: string = SCHEDULE_FIRE_SEGMENT,
): number | null {
  const prefix = `${segment}:${specId}:`;
  if (!sessionId.startsWith(prefix)) return null;
  const suffix = sessionId.slice(prefix.length);
  if (!FIRE_SUFFIX.test(suffix)) return null;
  const fireAt = Number(suffix);
  if (fireAt > MAX_FIRE_POINT_MS) return null;
  return fireAt;
}

/**
 * The NEWEST fire point among `sessionIds` for `specId`, scanning the given
 * segments (default: Scheduler footprint only). null = no footprint.
 *
 * The Scheduler recovers with the default segment set; the RoutineManager
 * asks with both segments for its display-truth lastFireAt while computing
 * nextFireAt from the schedule segment alone — see routine/manager.ts for
 * why the two views deliberately differ.
 */
export function latestFirePoint(
  sessionIds: Iterable<string>,
  specId: string,
  opts: { segments?: readonly string[] } = {},
): number | null {
  const segments = opts.segments ?? [SCHEDULE_FIRE_SEGMENT];
  let latest: number | null = null;
  for (const id of sessionIds) {
    for (const segment of segments) {
      const fireAt = parseFirePoint(id, specId, segment);
      if (fireAt !== null && (latest === null || fireAt > latest)) latest = fireAt;
    }
  }
  return latest;
}
