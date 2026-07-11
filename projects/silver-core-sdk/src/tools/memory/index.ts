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
import type { MemoryOptions, MemoryStore } from '../../types.js';
import type { BuiltinTool } from '../../internal/contracts.js';
import { ConfigurationError } from '../../errors.js';
import { createLocalFilesystemMemoryStore } from './local-store.js';
import { createMemoryTool, MEMORY_TOOL_NAME } from './memory-tool.js';

export { MEMORY_ROOT, MemoryPathError, validateMemoryPath } from './paths.js';
export {
  createMemoryStore,
  formatFileSize,
  type CreateMemoryStoreOptions,
  type MemoryDirEntry,
  type MemoryEntryStat,
  type MemoryFileOps,
} from './store.js';
export {
  createLocalFilesystemMemoryStore,
  createLocalMemoryFileOps,
} from './local-store.js';
export { createMemoryTool, memoryCommandSchema, MEMORY_TOOL_NAME } from './memory-tool.js';
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
  debug: (msg: string) => void;
}): MemoryRuntime {
  const { memory, cwd, protocol, debug } = args;

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
      { createOverwrite: memory.createOverwrite === true },
    );

  const indexCfg = memory.indexInjection;
  const maxLines =
    indexCfg === false ? 0 : (indexCfg?.maxLines ?? INDEX_DEFAULT_MAX_LINES);
  const maxBytes =
    indexCfg === false ? 0 : (indexCfg?.maxBytes ?? INDEX_DEFAULT_MAX_BYTES);

  return {
    store,
    mode,
    tool: createMemoryTool(store),
    ...(mode === 'native' ? { serverTools: [{ ...MEMORY_SERVER_TOOL }] } : {}),
    ...(memory.instructions !== undefined ? { instructions: memory.instructions } : {}),

    async buildIndexInjection(): Promise<{ label: string; text: string } | null> {
      if (indexCfg === false || maxLines <= 0 || maxBytes <= 0) return null;
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
      let lines = numbered.map((l) => l.replace(/^\s*\d+\t/, ''));
      let truncated = false;
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
