/**
 * Tool-claim verification helper (BPT-EXTENSION, memory governance spec S4).
 *
 * Reference implementation of the "claimed vs actually called" check: given a
 * session's assistant texts and its structured tool-call records (spec S3),
 * flag assistant turns that CLAIM a tool action with no matching record —
 * e.g. "I've saved that to memory" with no successful memory write dispatched.
 *
 * Deliberately heuristic: detectors are regex-based, so false positives are
 * expected and acceptable (findings go to human review); missing a real
 * unbacked claim is the failure mode to minimize. The default detector set
 * covers memory-write claims (zh + en); consumers add their own detectors for
 * other tools.
 *
 * Records come from dispatch-time telemetry (never from parsing the model's
 * own prose), so a claim can only be "backed" by a call that actually went
 * through the SDK's tool pipeline.
 */

import type { SDKToolCallRecord, SessionMessage } from '../types.js';
import { getSessionMessages, getSessionToolCalls } from './session-functions.js';
import type { SessionMutationOptions } from './session-functions.js';

/** The record fields a detector may match against (a subset of the full
 *  SDKToolCallRecord, so hand-built records in tests/pipelines stay easy). */
export type ToolClaimRecordView = Pick<
  SDKToolCallRecord,
  'tool_name' | 'tool_input' | 'status'
>;

export type ToolClaimDetector = {
  /** Stable identifier surfaced on findings (e.g. 'memory-write-claim'). */
  id: string;
  /** Matches CLAIM language in an assistant text. */
  claimPattern: RegExp;
  /** True when a record BACKS the claim (typically: right tool, right
   *  command shape, status ok). */
  backedBy: (record: ToolClaimRecordView) => boolean;
  description?: string;
};

export type ToolClaimFinding = {
  detectorId: string;
  /** Index of the assistant text within the audited sequence. */
  messageIndex: number;
  /** uuid of the assistant message, when available. */
  messageUuid?: string;
  /** The matched claim snippet (trimmed to its line). */
  snippet: string;
  reason: string;
};

const MEMORY_WRITE_COMMANDS = /"command"\s*:\s*"(create|str_replace|insert|delete|rename)"/;

/** True when a record is a SUCCESSFUL memory write. */
export function isMemoryWriteRecord(record: ToolClaimRecordView): boolean {
  return (
    record.tool_name === 'memory' &&
    record.status === 'ok' &&
    MEMORY_WRITE_COMMANDS.test(record.tool_input)
  );
}

/**
 * Default detector: memory-write claims (zh + en). Matches the common shapes
 * of "I recorded / saved / noted that (to memory)"; backed only by a
 * successful memory write command in the records.
 */
export const MEMORY_WRITE_CLAIM_DETECTOR: ToolClaimDetector = {
  id: 'memory-write-claim',
  claimPattern: new RegExp(
    [
      // zh: 已记录 / 记下来了 / 已写入记忆 / 已保存到记忆 / 已更新记忆 / 记到记忆里
      '已记录|记下来了|已经记下|记住了|(已|已经)?(写入|存入|保存到|记录到|更新了?)[^。\\n]{0,6}记忆',
      '记忆(文件|库|卡)?(已|已经)(更新|写入|保存)',
      // en: saved/recorded/noted/updated ... memory (subject optional — the
      // low-miss posture beats precision here, spec S4)
      '\\b(saved|recorded|noted|wrote|written|stored|updated)\\b[^.\\n]{0,40}\\bmemor(y|ies)\\b',
      "\\bmemor(y|ies)\\b [^.\\n]{0,20}\\b(updated|saved|recorded)\\b",
      "(I have|I've|I) (made a note|noted (this|that|it) down)",
    ].join('|'),
    'i',
  ),
  backedBy: isMemoryWriteRecord,
  description:
    'Assistant claims a memory write; backed only by a successful memory ' +
    'write command (create/str_replace/insert/delete/rename) in the records.',
};

export const DEFAULT_TOOL_CLAIM_DETECTORS: ToolClaimDetector[] = [
  MEMORY_WRITE_CLAIM_DETECTOR,
];

export type AuditToolClaimsArgs = {
  /** Assistant texts in sequence: raw strings, or {uuid, text} pairs. */
  assistantTexts: Array<string | { uuid?: string; text: string }>;
  /** The session's structured tool-call records (spec S3). */
  toolCalls: ToolClaimRecordView[];
  /** Detectors to run; defaults to DEFAULT_TOOL_CLAIM_DETECTORS. */
  detectors?: ToolClaimDetector[];
};

/**
 * Flag assistant texts whose tool claims have NO backing record anywhere in
 * the session. Session-scoped on purpose (not per-turn alignment): a claim
 * that summarizes an earlier turn's real call must not be flagged, so
 * precision is traded for the low-miss posture the spec asks for.
 */
export function auditToolClaims(args: AuditToolClaimsArgs): ToolClaimFinding[] {
  const detectors = args.detectors ?? DEFAULT_TOOL_CLAIM_DETECTORS;
  const findings: ToolClaimFinding[] = [];
  for (const detector of detectors) {
    const backed = args.toolCalls.some((r) => detector.backedBy(r));
    if (backed) continue;
    for (const [i, entry] of args.assistantTexts.entries()) {
      const text = typeof entry === 'string' ? entry : entry.text;
      const match = detector.claimPattern.exec(text);
      if (match === null) continue;
      const lineStart = text.lastIndexOf('\n', match.index) + 1;
      const lineEndRaw = text.indexOf('\n', match.index);
      const lineEnd = lineEndRaw === -1 ? text.length : lineEndRaw;
      findings.push({
        detectorId: detector.id,
        messageIndex: i,
        ...(typeof entry !== 'string' && entry.uuid !== undefined
          ? { messageUuid: entry.uuid }
          : {}),
        snippet: text.slice(lineStart, lineEnd).trim(),
        reason:
          `Assistant text matches '${detector.id}' but the session's ` +
          `structured tool-call records contain no backing call`,
      });
    }
  }
  return findings;
}

/** Concatenated text blocks of a persisted assistant message. */
function assistantTextOf(m: SessionMessage): string | null {
  if (m.type !== 'assistant') return null;
  const content = (m.message as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const b of content) {
    const block = b as { type?: unknown; text?: unknown };
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
  }
  return parts.length > 0 ? parts.join('\n') : null;
}

/**
 * Convenience wrapper: load a persisted session's assistant texts + tool-call
 * records and run auditToolClaims over them — the "flag suspicious turns when
 * the agent loop ends" entry point.
 */
export async function auditSessionToolClaims(
  sessionId: string,
  options: SessionMutationOptions & { detectors?: ToolClaimDetector[] } = {},
): Promise<ToolClaimFinding[]> {
  const { detectors, ...sessionOptions } = options;
  const [messages, toolCalls] = await Promise.all([
    getSessionMessages(sessionId, sessionOptions),
    getSessionToolCalls(sessionId, sessionOptions),
  ]);
  const assistantTexts: Array<{ uuid?: string; text: string }> = [];
  for (const m of messages) {
    const text = assistantTextOf(m);
    if (text !== null) assistantTexts.push({ uuid: m.uuid, text });
  }
  return auditToolClaims({
    assistantTexts,
    toolCalls,
    ...(detectors !== undefined ? { detectors } : {}),
  });
}
