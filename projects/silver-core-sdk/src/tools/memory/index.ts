/**
 * Memory system assembly (spec R2/R6 runtime): resolves Options.memory into
 * the pieces the query layer wires up — the store, the assembly mode, the
 * builtin tool, the native-mode server-tool entry, and the resident memory
 * index (R6). Protocol-prompt composition stays in the query layer (the
 * fragment lives in engine/prompt-fragments; `src/tools/` does not import
 * `src/engine/`).
 */

import { Buffer } from 'node:buffer';
import * as path from 'node:path';
import type { MemoryOptions, MemoryStore, SDKMemoryHealth } from '../../types.js';
import type { BuiltinTool } from '../../internal/contracts.js';
import { ConfigurationError } from '../../errors.js';
import { createLocalFilesystemMemoryStore } from './local-store.js';
import { createMemoryHealth, createMemoryTool, MEMORY_TOOL_NAME } from './memory-tool.js';
import { mountReadAccess, resolveMemoryMounts } from './mounts.js';

export { MEMORY_ROOT, MemoryPathError, validateMemoryPath } from './paths.js';
export {
  describeMounts,
  filterAncestorListing,
  mountAllowsWrite,
  mountReadAccess,
  outsideMountsError,
  readOnlyMountError,
  resolveMemoryMounts,
  subtreeContainsReadOnlyMount,
  subtreeReadOnlyMountError,
  type MountReadAccess,
  type ResolvedMemoryMount,
  type ResolvedMemoryMounts,
} from './mounts.js';
export {
  createMemoryStore,
  formatFileSize,
  DEFAULT_MEMORY_LIMITS,
  truncateViewBody,
  type CreateMemoryStoreOptions,
  type MemoryDirEntry,
  type MemoryEntryStat,
  type MemoryFileOps,
  type MemoryLimits,
} from './store.js';
export {
  parseMemoryCards,
  validateCardsContent,
  DEFAULT_CARDS_CONFIG,
  type MemoryCard,
  type MemoryCardsConfig,
} from './cards.js';
export {
  createLocalFilesystemMemoryStore,
  createLocalMemoryFileOps,
} from './local-store.js';
export {
  createMemoryHealth,
  createMemoryTool,
  memoryCommandSchema,
  INCOGNITO_MEMORY_ERROR,
  MEMORY_TOOL_NAME,
  type CreateMemoryToolOptions,
} from './memory-tool.js';
export {
  memoryStoreContractCheckNames,
  runMemoryStoreContractSuite,
  type MemoryStoreContractReport,
  type MemoryStoreContractResult,
} from './contract-suite.js';

/** The official server-declared entry for native mode (docs: the entry is the
 *  entire configuration). */
export const MEMORY_SERVER_TOOL = { type: 'memory_20250818', name: MEMORY_TOOL_NAME } as const;

/** Virtual path of the resident index file (spec R6). */
export const MEMORY_INDEX_PATH = '/memories/MEMORY.md';

const INDEX_DEFAULT_MAX_LINES = 200;
const INDEX_DEFAULT_MAX_BYTES = 25_600; // 25 KB

/** Truncate a string to at most `maxBytes` UTF-8 bytes at a character boundary
 *  (never splitting a multi-byte sequence). Used only for the degenerate
 *  resident-index case where a single line exceeds the byte cap (audit r4
 *  U4-8). */
function truncateToUtf8Bytes(line: string, maxBytes: number): string {
  const buf = Buffer.from(line, 'utf8');
  if (buf.length <= maxBytes) return line;
  let end = maxBytes;
  // Back off while the cut lands on a UTF-8 continuation byte (0b10xxxxxx).
  while (end > 0 && (buf[end]! & 0xc0) === 0x80) end -= 1;
  return buf.toString('utf8', 0, end);
}

export type MemoryRuntime = {
  store: MemoryStore;
  /** Resolved assembly mode (spec R2): see MemoryOptions.mode. */
  mode: 'native' | 'custom';
  /** The `memory` builtin (execution loop in both modes; advertised only in
   *  custom mode). */
  tool: BuiltinTool;
  /** Native mode: the typed entry for EngineConfig.serverTools. */
  serverTools?: Array<{ type: string; name: string }>;
  /** Consumer guidance to append after the protocol fragment (custom mode). */
  instructions?: string;
  /** R8 per-query counters; the query layer snapshots this into
   *  SDKRunMetrics.memoryHealth and stamps indexInjectionTokens. */
  health: SDKMemoryHealth;
  /** R7: inject a memory-write opportunity before auto-compaction folds. */
  flushOnCompaction: boolean;
  /** R7: run the session-end progress-card round on normal termination. */
  sessionEndUpdate: boolean;
  /**
   * Pitfall recording protocol (SCS-REQ-002 Phase 0 / REQ-3.2): null =
   * disabled (default, or forced by incognito — a write protocol on a
   * read-only session would contradict S2); otherwise `extra` carries the
   * consumer guidance to append after the fragment ('' for none). The
   * fragment text itself lives in engine/prompt-fragments (this module does
   * not import src/engine/).
   */
  pitfalls: { extra: string } | null;
  /**
   * Resident memory index (spec R6): the head of /memories/MEMORY.md as a
   * ready-to-inject system-prompt part, or null for zero injection (file
   * missing, index disabled, or the store failed — never throws).
   */
  buildIndexInjection(): Promise<{ label: string; text: string } | null>;
};

/**
 * Resolve Options.memory (already checked truthy + enabled by the caller)
 * into the runtime pieces. Throws ConfigurationError on contradictory configuration
 * (native mode forced onto a non-Anthropic protocol).
 */
export function resolveMemoryRuntime(args: {
  memory: MemoryOptions;
  cwd: string;
  /** ProviderConfig.protocol ('anthropic' default when undefined). */
  protocol: 'anthropic' | 'openai-chat';
  /** S2: incognito session — memory degrades to read-only and both R7 write
   *  rounds are disabled, regardless of the memory options. */
  incognito?: boolean;
  debug: (msg: string) => void;
}): MemoryRuntime {
  const { memory, cwd, protocol, debug } = args;
  const incognito = args.incognito === true;
  // S1: validate + canonicalize the mount declarations up front (a bad mount
  // is a consumer configuration error, thrown from query()).
  const mounts = resolveMemoryMounts(memory.mounts);

  const mode = memory.mode ?? (protocol === 'openai-chat' ? 'custom' : 'native');
  if (mode === 'native' && protocol === 'openai-chat') {
    throw new ConfigurationError(
      "options.memory.mode 'native' requires the Anthropic protocol " +
        "(memory_20250818 is a Messages API server-declared tool); use mode " +
        "'custom' on provider.protocol 'openai-chat'",
    );
  }

  const store =
    memory.store ??
    createLocalFilesystemMemoryStore(
      memory.baseDir ?? path.join(cwd, '.claude', 'memory'),
      {
        createOverwrite: memory.createOverwrite === true,
        // R8/R9 in the store engine (full enforcement). An injected store
        // skips these; the tool layer below still covers view truncation,
        // the create size cap and create-content cards validation.
        ...(memory.limits !== undefined ? { limits: memory.limits } : {}),
        ...(memory.schema !== undefined ? { schema: memory.schema } : {}),
        ...(memory.cards !== undefined ? { cards: memory.cards } : {}),
      },
    );

  const indexCfg = memory.indexInjection;
  const maxLines =
    indexCfg === false ? 0 : (indexCfg?.maxLines ?? INDEX_DEFAULT_MAX_LINES);
  const maxBytes =
    indexCfg === false ? 0 : (indexCfg?.maxBytes ?? INDEX_DEFAULT_MAX_BYTES);

  const health = createMemoryHealth();

  return {
    store,
    mode,
    tool: createMemoryTool(store, {
      health,
      ...(memory.limits !== undefined ? { limits: memory.limits } : {}),
      ...(memory.schema !== undefined ? { schema: memory.schema } : {}),
      ...(memory.cards !== undefined ? { cards: memory.cards } : {}),
      ...(mounts !== null ? { mounts } : {}),
      ...(incognito ? { incognitoReadOnly: true } : {}),
    }),
    ...(mode === 'native' ? { serverTools: [{ ...MEMORY_SERVER_TOOL }] } : {}),
    ...(memory.instructions !== undefined ? { instructions: memory.instructions } : {}),
    health,
    // S2: both R7 rounds are WRITE rounds; an incognito session never runs them.
    flushOnCompaction: !incognito && memory.flushOnCompaction !== false,
    sessionEndUpdate: !incognito && memory.sessionEndUpdate !== false,
    // Phase 0 (REQ-3.2): opt-in, and — like the R7 write rounds — never on an
    // incognito session.
    pitfalls:
      incognito || memory.pitfalls === undefined || memory.pitfalls === false
        ? null
        : {
            extra:
              typeof memory.pitfalls === 'object' && memory.pitfalls.instructions !== undefined
                ? memory.pitfalls.instructions
                : '',
          },

    async buildIndexInjection(): Promise<{ label: string; text: string } | null> {
      if (indexCfg === false || maxLines <= 0 || maxBytes <= 0) return null;
      // S1: never inject content the session's mounts do not grant read
      // access to — the resident index is a READ of /memories/MEMORY.md.
      if (mountReadAccess(mounts, MEMORY_INDEX_PATH) !== 'full') {
        debug('memory: resident index skipped (not readable under the configured mounts)');
        return null;
      }
      let viewed: string;
      try {
        // Ask for one line beyond the cap so line-truncation is detectable
        // without a second round-trip.
        viewed = await store.view(MEMORY_INDEX_PATH, [1, maxLines + 1]);
      } catch {
        // Missing index file (or a store fault) is NOT an error: zero
        // injection, zero noise (spec R6 acceptance).
        return null;
      }
      // The contract-fixed view format is `header\n{6-char number}\t{line}`*;
      // strip the header and the line-number gutter to recover raw content.
      const numbered = viewed.split('\n').slice(1);
      let truncated = false;
      // The store's own char-cap pagination notice is view CHROME, not memory
      // content: without this strip it leaked into the injected index block
      // verbatim (audit 2026-07-17 L27).
      if (
        numbered.length > 0 &&
        /^\[Output truncated at \d+ characters\./.test(numbered[numbered.length - 1] as string)
      ) {
        numbered.pop();
        truncated = true;
      }
      let lines = numbered.map((l) => l.replace(/^\s*\d+\t/, ''));
      if (lines.length > maxLines) {
        lines = lines.slice(0, maxLines);
        truncated = true;
      }
      // Byte cap (UTF-8), cut at the last whole line under the cap.
      const kept: string[] = [];
      let bytes = 0;
      for (const line of lines) {
        const cost = Buffer.byteLength(line, 'utf8') + (kept.length > 0 ? 1 : 0);
        if (bytes + cost > maxBytes) {
          truncated = true;
          // A first line that ALONE exceeds the byte cap would otherwise drop
          // the whole index silently (kept stays empty -> content '' -> null);
          // inject a byte-truncated head instead so the index is never lost
          // without signal (audit r4 U4-8).
          if (kept.length === 0) {
            const head = truncateToUtf8Bytes(line, maxBytes);
            if (head.length > 0) {
              kept.push(head);
              bytes += Buffer.byteLength(head, 'utf8');
            }
          }
          break;
        }
        kept.push(line);
        bytes += cost;
      }
      const content = kept.join('\n');
      if (content.trim().length === 0) return null;
      const intro = truncated
        ? `The beginning of your memory index file ${MEMORY_INDEX_PATH} is auto-loaded ` +
          `below (truncated; use the \`view\` command of your \`memory\` tool for the rest).`
        : `Your memory index file ${MEMORY_INDEX_PATH} is auto-loaded below.`;
      debug(
        `memory: resident index injected (${kept.length} lines, ${bytes} bytes` +
          `${truncated ? ', truncated' : ''})`,
      );
      return {
        label: 'memory-index',
        text: `# Memory index\n\n${intro}\n\n${content}`,
      };
    },
  };
}
