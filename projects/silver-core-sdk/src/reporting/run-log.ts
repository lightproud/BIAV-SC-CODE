/**
 * Run-signal ledger (self-improvement spec SCS-REQ-002 loop 1 / REQ-1.1).
 *
 * Opt-in via Options.runLog: every result message the consumer sees is
 * mirrored as ONE JSONL line in `{dir}/runlog-{YYYY-MM-DD}.jsonl` (UTC day
 * files). This is the signal source generateRuntimeReport() aggregates —
 * facts only, no conversation content: termination subtype, turn/duration
 * counters, token usage, cost, cache ratio, the transport-health disconnect
 * ledger, per-tool call/error counters, and model ids.
 *
 * Incognito boundary (spec §6.4): an incognito session still contributes
 * transport-health and token statistics (no content), but its record carries
 * no session id, no scenario tag and no error text, and is excluded from the
 * report's failed-sessions section.
 *
 * Writes are fire-and-forget appends — a ledger fault must never break the
 * run (it is observability, not the task).
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  RunLogOptions,
  SDKMessage,
  SDKResultMessage,
  SDKTransportHealth,
} from '../types.js';

export type { RunLogOptions };

/** One ledger line. Field names are the wire contract consumed by
 *  generateRuntimeReport() and by BPT-side log producers (spec §6.1). */
export type RunLogRecord = {
  /** Record schema version (bump on breaking shape changes). */
  v: 1;
  ts: string;
  /** Absent on incognito records. */
  session_id?: string;
  /** Consumer-supplied workload tag, e.g. 'coding' / 'non-coding'. Absent on
   *  incognito records. */
  scenario?: string;
  subtype: string;
  is_error: boolean;
  num_turns: number;
  duration_ms: number;
  duration_api_ms: number;
  total_cost_usd: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
  cache_hit_ratio?: number;
  transport_health?: SDKTransportHealth;
  per_tool?: Array<{ name: string; calls: number; errors: number }>;
  models?: string[];
  incognito?: true;
  /** First line of the error, when the result is an error. Absent on
   *  incognito records. */
  error?: string;
};

export type RunLogSink = {
  /** Observe one consumer-facing message; mirrors result messages. */
  observe(msg: SDKMessage): void;
};

/** UTC day file name for a timestamp. */
export function runLogFileName(ts: Date): string {
  return `runlog-${ts.toISOString().slice(0, 10)}.jsonl`;
}

export function buildRunLogRecord(
  msg: SDKResultMessage,
  opts: { scenario?: string; incognito: boolean; now?: Date },
): RunLogRecord {
  const m = msg as SDKResultMessage & { errorMessage?: string };
  const usage = m.usage;
  const record: RunLogRecord = {
    v: 1,
    ts: (opts.now ?? new Date()).toISOString(),
    subtype: m.subtype,
    is_error: m.is_error === true,
    num_turns: m.num_turns,
    duration_ms: m.duration_ms,
    duration_api_ms: m.duration_api_ms,
    total_cost_usd: m.total_cost_usd,
    usage: {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens,
      cache_creation_input_tokens: usage.cache_creation_input_tokens,
    },
  };
  const metrics = m.metrics;
  if (metrics?.cacheHitRatio !== undefined) record.cache_hit_ratio = metrics.cacheHitRatio;
  if (metrics?.transportHealth !== undefined) record.transport_health = metrics.transportHealth;
  if (metrics?.perTool !== undefined && metrics.perTool.length > 0) {
    record.per_tool = metrics.perTool.map((t) => ({
      name: t.name,
      calls: t.calls,
      errors: t.errors,
    }));
  }
  if (metrics?.modelUsage !== undefined) {
    const models = Object.keys(metrics.modelUsage);
    if (models.length > 0) record.models = models;
  }
  if (opts.incognito) {
    // §6.4: transport/token stats stay; identity, tags and content-adjacent
    // fields go.
    record.incognito = true;
  } else {
    record.session_id = m.session_id;
    if (opts.scenario !== undefined) record.scenario = opts.scenario;
    if (m.is_error === true && typeof m.errorMessage === 'string') {
      record.error = m.errorMessage.split('\n')[0]!.slice(0, 300);
    }
  }
  return record;
}

export function createRunLogSink(args: {
  runLog: RunLogOptions;
  incognito: boolean;
  debug: (msg: string) => void;
}): RunLogSink {
  const { runLog, incognito, debug } = args;
  let dirReady: Promise<void> | null = null;
  const ensureDir = (): Promise<void> => {
    dirReady ??= mkdir(runLog.dir, { recursive: true }).then(() => undefined);
    return dirReady;
  };
  return {
    observe(msg: SDKMessage): void {
      if (msg.type !== 'result') return;
      const record = buildRunLogRecord(msg, {
        incognito,
        ...(runLog.scenario !== undefined ? { scenario: runLog.scenario } : {}),
      });
      const line = `${JSON.stringify(record)}\n`;
      void ensureDir()
        .then(() => appendFile(join(runLog.dir, runLogFileName(new Date())), line, 'utf8'))
        .catch((err) => debug(`runLog: append failed (ignored): ${String(err)}`));
    },
  };
}
