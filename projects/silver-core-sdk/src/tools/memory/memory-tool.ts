/**
 * The `memory` builtin tool (spec R1/R2): six-command execution loop over an
 * injected MemoryStore.
 *
 * One tool serves both assembly modes:
 *  - mode A ("native", Anthropic transport): the request advertises the
 *    official `{ type: 'memory_20250818', name: 'memory' }` entry
 *    (EngineConfig.serverTools) and the API injects the tool definition +
 *    protocol prompt server-side; this builtin's schema is NOT advertised —
 *    it is only the execution loop for the server-declared tool.
 *  - mode B ("custom", any transport): this builtin is advertised like every
 *    other builtin, with the six-command schema below and the protocol
 *    prompt injected by the SDK (engine/prompt-fragments MEMORY_PROTOCOL).
 *
 * Input validation is zod (discriminated union on `command`); the advertised
 * wire schema is the hand-written JSONSchema equivalent, matching the other
 * builtins' style. Path validation (spec R4) runs HERE, before the store is
 * called, for every path parameter — the SDK never delegates that to a store.
 */

import { Buffer } from 'node:buffer';
import { z } from 'zod';
import type {
  BuiltinTool,
  MemoryStore,
  ToolResultPayload,
} from '../../internal/contracts.js';
import type { JSONSchema, SDKMemoryHealth } from '../../types.js';
import { AbortError, isAbortError } from '../../errors.js';
import { MEMORY_ROOT, validateMemoryPath } from './paths.js';
import {
  DEFAULT_CARDS_CONFIG,
  validateCardsContent,
  type MemoryCardsConfig,
} from './cards.js';
import {
  DEFAULT_MEMORY_LIMITS,
  fileTooLargeError,
  truncateViewBody,
  type MemoryLimits,
} from './store.js';
import {
  filterAncestorListing,
  mountAllowsWrite,
  mountReadAccess,
  outsideMountsError,
  readOnlyMountError,
  type ResolvedMemoryMounts,
} from './mounts.js';

export const MEMORY_TOOL_NAME = 'memory';

const viewCommand = z.object({
  command: z.literal('view'),
  path: z.string(),
  view_range: z.tuple([z.number().int(), z.number().int()]).optional(),
});
const createCommand = z.object({
  command: z.literal('create'),
  path: z.string(),
  file_text: z.string(),
});
const strReplaceCommand = z.object({
  command: z.literal('str_replace'),
  path: z.string(),
  old_str: z.string(),
  new_str: z.string().optional(),
});
const insertCommand = z.object({
  command: z.literal('insert'),
  path: z.string(),
  insert_line: z.number().int(),
  insert_text: z.string(),
});
const deleteCommand = z.object({
  command: z.literal('delete'),
  path: z.string(),
});
const renameCommand = z.object({
  command: z.literal('rename'),
  old_path: z.string(),
  new_path: z.string(),
});

export const memoryCommandSchema = z.discriminatedUnion('command', [
  viewCommand,
  createCommand,
  strReplaceCommand,
  insertCommand,
  deleteCommand,
  renameCommand,
]);

export type MemoryCommand = z.infer<typeof memoryCommandSchema>;

/** Wire schema (mode B advertisement). Field names/shape mirror the official
 *  memory_20250818 command set exactly; the flat-object-with-command-enum
 *  form matches how Anthropic-provided editor tools are described. */
const MEMORY_INPUT_SCHEMA: JSONSchema = {
  type: 'object',
  properties: {
    command: {
      type: 'string',
      enum: ['view', 'create', 'str_replace', 'insert', 'delete', 'rename'],
      description: 'The memory operation to run.',
    },
    path: {
      type: 'string',
      description:
        'Virtual path of the file or directory, always starting with /memories.',
    },
    view_range: {
      type: 'array',
      items: { type: 'integer' },
      description:
        'view only, optional: [start_line, end_line] (1-indexed; end -1 = end of file).',
    },
    file_text: {
      type: 'string',
      description: 'create only: full content of the file to create.',
    },
    old_str: {
      type: 'string',
      description: 'str_replace only: exact text to replace (must be unique in the file).',
    },
    new_str: {
      type: 'string',
      description: 'str_replace only, optional: replacement text (omitted = delete old_str).',
    },
    insert_line: {
      type: 'integer',
      description: 'insert only: line number to insert after (0 = start of file).',
    },
    insert_text: {
      type: 'string',
      description: 'insert only: the text to insert.',
    },
    old_path: {
      type: 'string',
      description: 'rename only: current path.',
    },
    new_path: {
      type: 'string',
      description: 'rename only: new path (must not already exist).',
    },
  },
  required: ['command'],
};

const MEMORY_DESCRIPTION = `Store and retrieve information across conversations in your memory directory (${MEMORY_ROOT}). Commands: view (directory listing, or file content with line numbers; optional view_range), create (create a new file from file_text), str_replace (replace a unique old_str with new_str), insert (insert insert_text after insert_line; 0 = start of file), delete (delete a file, or a directory recursively), rename (move a file or directory to new_path). All paths must start with ${MEMORY_ROOT}. You cannot delete or rename the ${MEMORY_ROOT} directory itself. Keep your memory directory organized: keep its content up-to-date and coherent, rename or delete files that are no longer relevant, and do not create new files unless necessary.`;

function errorResult(message: string): ToolResultPayload {
  return { content: message, isError: true };
}

/** Mutable per-query memory counters (spec R8); the query layer snapshots
 *  this into SDKRunMetrics.memoryHealth. */
export function createMemoryHealth(): SDKMemoryHealth {
  return {
    operations: 0,
    reads: 0,
    writes: 0,
    errors: 0,
    bytesRead: 0,
    bytesWritten: 0,
    indexInjectionTokens: 0,
  };
}

export type CreateMemoryToolOptions = {
  /** R8 counters to record into (shared with the query layer). */
  health?: SDKMemoryHealth;
  /** R8 tool-layer limits (view truncation + create size cap) so they hold
   *  even for a directly-implemented injected MemoryStore; the store engine
   *  enforces the full set. Missing fields take DEFAULT_MEMORY_LIMITS. */
  limits?: Partial<MemoryLimits>;
  /** R9 tool-layer cards validation for `create` (full content available
   *  here); str_replace/insert results are validated in the store engine. */
  schema?: 'cards';
  cards?: Partial<MemoryCardsConfig>;
  /** S1 scope routing: resolved mounts (null / absent = unrestricted). */
  mounts?: ResolvedMemoryMounts;
  /** S2 incognito: reject every write command (view stays available). */
  incognitoReadOnly?: boolean;
};

/** S2: the structured error every memory write command returns in an
 *  incognito session. Model-readable — states the rule, not just "denied". */
export const INCOGNITO_MEMORY_ERROR =
  'Error: This is an incognito session — the memory store is read-only. ' +
  'view remains available, but create, str_replace, insert, delete and ' +
  'rename are disabled: nothing from this session is recorded.';

const DIRECTORY_LISTING_HEADER = "Here're the files and directories";

/**
 * Build the memory builtin over a store. Constructed per query (like the
 * sandbox-aware Bash variant) so the store binding is a closure, not a
 * ToolContext field.
 */
export function createMemoryTool(
  store: MemoryStore,
  toolOptions: CreateMemoryToolOptions = {},
): BuiltinTool {
  const limits: MemoryLimits = { ...DEFAULT_MEMORY_LIMITS, ...toolOptions.limits };
  const cardsCfg: MemoryCardsConfig = { ...DEFAULT_CARDS_CONFIG, ...toolOptions.cards };
  const health = toolOptions.health;
  const mounts: ResolvedMemoryMounts = toolOptions.mounts ?? null;
  const bytesOf = (s: string): number => Buffer.byteLength(s, 'utf8');
  /** S1/S2 write gate: incognito first (session-wide rule), then mount
   *  routing. Returns the structured error message, or null when allowed. */
  const writeDenial = (path: string): string | null => {
    if (toolOptions.incognitoReadOnly === true) return INCOGNITO_MEMORY_ERROR;
    if (mounts === null || mountAllowsWrite(mounts, path)) return null;
    return mountReadAccess(mounts, path) === null
      ? outsideMountsError(mounts, path)
      : readOnlyMountError(mounts, path);
  };
  return {
    name: MEMORY_TOOL_NAME,
    description: MEMORY_DESCRIPTION,
    // Memory operations mutate the memory directory; they are auto-allowed by
    // the query layer via an implicit allowedTools entry (official parity:
    // the server-declared tool never permission-prompts), not by a readOnly
    // fiction. Plan mode therefore still denies memory WRITES honestly.
    readOnly: false,
    isFileEdit: true,
    inputSchema: MEMORY_INPUT_SCHEMA,
    async execute(input, ctx): Promise<ToolResultPayload> {
      // R8 accounting: every invocation counts; reads/writes/bytes recorded on
      // the command branches below, errors in the shared wrapper.
      if (health !== undefined) health.operations += 1;
      const done = (res: ToolResultPayload): ToolResultPayload => {
        if (health !== undefined && res.isError === true) health.errors += 1;
        return res;
      };
      try {
        if (ctx.signal.aborted) throw new AbortError();
        const parsed = memoryCommandSchema.safeParse(input);
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          const where = issue !== undefined && issue.path.length > 0
            ? ` (${issue.path.join('.')})`
            : '';
          return done(errorResult(
            `Error: Invalid memory command${where}: ${issue?.message ?? 'malformed input'}`,
          ));
        }
        const cmd = parsed.data;
        // R4: SDK-layer validation of EVERY path parameter before the store
        // sees it. validateMemoryPath throws MemoryPathError with the exact
        // message to surface.
        switch (cmd.command) {
          case 'view': {
            const path = validateMemoryPath(cmd.path);
            // S1 read gate: 'full' inside a mount; 'ancestor' keeps the
            // navigation path viewable but filters the listing to
            // mount-visible entries; null is rejected outright.
            const access = mountReadAccess(mounts, path);
            if (access === null) {
              return done(errorResult(outsideMountsError(mounts!, path)));
            }
            let viewed = await store.view(path, cmd.view_range);
            if (access === 'ancestor') {
              if (!viewed.startsWith(DIRECTORY_LISTING_HEADER)) {
                // An ancestor of a mount that views as FILE content can only
                // mean a misconfigured mount nested under a file; never leak
                // the content.
                return done(errorResult(outsideMountsError(mounts!, path)));
              }
              viewed = filterAncestorListing(mounts!, path, viewed);
            }
            // Tool-layer truncation (idempotent over the engine's own) so the
            // R8 view cap holds for directly-implemented stores too.
            const body = truncateViewBody(viewed, limits.maxViewChars);
            if (health !== undefined) {
              health.reads += 1;
              health.bytesRead += bytesOf(body);
            }
            return done({ content: body });
          }
          case 'create': {
            const path = validateMemoryPath(cmd.path);
            const denied = writeDenial(path);
            if (denied !== null) return done(errorResult(denied));
            // Tool-layer R8 size cap + R9 cards validation on the full
            // content (the store engine re-checks; this covers direct stores).
            if (bytesOf(cmd.file_text) > limits.maxFileBytes) {
              return done(errorResult(fileTooLargeError(path, limits.maxFileBytes)));
            }
            if (toolOptions.schema === 'cards') {
              const invalid = validateCardsContent(cmd.file_text, cardsCfg);
              if (invalid !== null) return done(errorResult(invalid));
            }
            if (health !== undefined) {
              health.writes += 1;
              health.bytesWritten += bytesOf(cmd.file_text);
            }
            return done({ content: await store.create(path, cmd.file_text) });
          }
          case 'str_replace': {
            const path = validateMemoryPath(cmd.path);
            const denied = writeDenial(path);
            if (denied !== null) return done(errorResult(denied));
            if (health !== undefined) {
              health.writes += 1;
              health.bytesWritten += bytesOf(cmd.new_str ?? '');
            }
            return done({ content: await store.strReplace(path, cmd.old_str, cmd.new_str) });
          }
          case 'insert': {
            const path = validateMemoryPath(cmd.path);
            const denied = writeDenial(path);
            if (denied !== null) return done(errorResult(denied));
            if (health !== undefined) {
              health.writes += 1;
              health.bytesWritten += bytesOf(cmd.insert_text);
            }
            return done({
              content: await store.insert(path, cmd.insert_line, cmd.insert_text),
            });
          }
          case 'delete': {
            const path = validateMemoryPath(cmd.path);
            // Root protection at the TOOL layer too, so an injected custom
            // store cannot be talked into removing its own root.
            if (path === MEMORY_ROOT) {
              return done(errorResult(
                `Error: Cannot delete the ${MEMORY_ROOT} directory itself`,
              ));
            }
            const denied = writeDenial(path);
            if (denied !== null) return done(errorResult(denied));
            if (health !== undefined) health.writes += 1;
            return done({ content: await store.delete(path) });
          }
          case 'rename': {
            const oldPath = validateMemoryPath(cmd.old_path);
            const newPath = validateMemoryPath(cmd.new_path);
            if (oldPath === MEMORY_ROOT) {
              return done(errorResult(
                `Error: Cannot rename the ${MEMORY_ROOT} directory itself`,
              ));
            }
            // S1: a rename is a write at BOTH ends (removal + creation).
            const denied = writeDenial(oldPath) ?? writeDenial(newPath);
            if (denied !== null) return done(errorResult(denied));
            if (health !== undefined) health.writes += 1;
            return done({ content: await store.rename(oldPath, newPath) });
          }
        }
      } catch (e) {
        if (isAbortError(e)) {
          throw new AbortError('memory was aborted');
        }
        return done(errorResult((e as Error).message));
      }
    },
  };
}
