/**
 * Memory-store semantics engine (spec R1 + R3).
 *
 * ONE implementation of the six memory commands' semantics and reference
 * return strings (official memory-tool docs, memory_20250818), layered over a
 * minimal storage-primitive interface (`MemoryFileOps`). Storage backends —
 * the SDK's local filesystem default, or a consumer's intranet directory /
 * database backend — implement the six small primitives and inherit the
 * byte-exact reference formats from this engine, so the golden strings exist
 * in exactly one place and cannot drift per backend.
 *
 * A consumer may instead implement the `MemoryStore` interface directly (the
 * contract-suite tests validate any implementation), but the primitives +
 * engine path is the recommended one: format fidelity for free.
 *
 * Format fidelity notes (docs win over the reference SDK helper where the two
 * differ; each departure is deliberate and tested):
 *  - line numbers: 6 characters, right-aligned, space-padded, tab separator;
 *  - directory listings: up to 2 levels deep, depth-first, sorted per level,
 *    hidden entries and node_modules excluded, human-readable sizes,
 *    directories carry a trailing `/`;
 *  - the >999,999-line view error uses the docs wording ("exceeds maximum
 *    line limit"), not the reference helper's variant;
 *  - insert's missing-file error uses the docs wording (no "Please provide a
 *    valid path." tail), unlike str_replace's, which has it.
 *
 * Error results are THROWN as MemoryToolError whose message is the exact
 * reference string; the memory tool converts a throw into an is_error
 * tool_result with that message as content.
 */

import { Buffer } from 'node:buffer';
import type { MemoryStore } from '../../internal/contracts.js';
import { MemoryToolError } from '../../errors.js';
import { sliceSurrogateSafe } from '../../internal/text.js';
import { MEMORY_ROOT, validateMemoryPath } from './paths.js';
import {
  DEFAULT_CARDS_CONFIG,
  validateCardsContent,
  type MemoryCardsConfig,
} from './cards.js';

/** stat() result for one existing entry. */
export type MemoryEntryStat = { kind: 'file' | 'directory'; sizeBytes: number };

/** One immediate child in a directory listing. */
export type MemoryDirEntry = {
  name: string;
  kind: 'file' | 'directory';
  sizeBytes: number;
};

/**
 * Storage primitives a backend implements (spec R3 injection point, primitive
 * form). All paths are canonical VIRTUAL paths (`/memories[/...]`) — the
 * backend maps them onto real storage (directory, database keys, ...). The
 * engine performs all existence checks and semantic validation BEFORE calling
 * a mutating primitive, so implementations may stay dumb; they must still not
 * trust paths as a matter of defense in depth (spec §8.6).
 */
export interface MemoryFileOps {
  /** Entry stat, or null when the path does not exist. */
  stat(path: string): Promise<MemoryEntryStat | null>;
  /** Immediate children of an EXISTING directory. */
  list(path: string): Promise<MemoryDirEntry[]>;
  /** UTF-8 content of an EXISTING file. */
  read(path: string): Promise<string>;
  /** Create or overwrite a file, creating missing parent directories. */
  write(path: string, content: string): Promise<void>;
  /** Delete an EXISTING file, or an EXISTING directory recursively. */
  delete(path: string): Promise<void>;
  /** Move `oldPath` (exists) to `newPath` (does not exist), creating missing
   *  parent directories of the destination. */
  rename(oldPath: string, newPath: string): Promise<void>;
}

/** Governance limits (spec R8) as resolved numbers. */
export type MemoryLimits = {
  maxFileBytes: number;
  maxFilesPerDirectory: number;
  maxViewChars: number;
};

export const DEFAULT_MEMORY_LIMITS: MemoryLimits = {
  maxFileBytes: 65_536,
  maxFilesPerDirectory: 64,
  maxViewChars: 16_000,
};

/** SDK-defined limit error strings (documented in docs/MEMORY.md; not part of
 *  the official reference set — the official docs leave sizing to the
 *  implementation and only recommend capping). */
export function fileTooLargeError(path: string, maxFileBytes: number): string {
  return `Error: File ${path} would exceed the maximum memory file size (${maxFileBytes} bytes)`;
}
export function directoryFullError(dir: string, maxFiles: number): string {
  // The reference prefix is preserved verbatim; the guidance tail is appended
  // so a model that hits the cap knows how to self-organize instead of retrying
  // create in a loop. The limit is per-directory and blocks ONLY new-file
  // creation — spelling that out here is the point (edits/deletes still work).
  return (
    `Error: Directory ${dir} already contains the maximum number of memory files ` +
    `(${maxFiles}). This limit is per-directory and blocks only new-file creation; ` +
    `str_replace, insert, delete, and rename on existing files still work. To make ` +
    `room: consolidate related files into fewer entries, delete stale files, or ` +
    `create this file under a new subdirectory of ${dir} (each subdirectory has its ` +
    `own separate limit).`
  );
}
export function viewTruncationNotice(maxViewChars: number): string {
  return `[Output truncated at ${maxViewChars} characters. Use the view_range parameter to view the rest of the file.]`;
}

/** Matches a trailing viewTruncationNotice regardless of which layer's char
 *  cap produced it (the two layers can be configured with different caps). */
const TRUNCATION_NOTICE_RE =
  /\[Output truncated at \d+ characters\. Use the view_range parameter to view the rest of the file\.\]$/;

/** Truncate a numbered view body at a whole-line boundary under the char cap,
 *  appending the pagination notice. Shared by the store engine and the tool
 *  layer (which re-applies it for directly-implemented stores). IDEMPOTENT:
 *  engine output that already ends with the notice is returned as-is — the
 *  tool layer re-applies this over header-carrying engine output whose header
 *  pushes it past the cap, and a second cut chopped real lines and stacked a
 *  second, misleading pagination notice (audit 2026-07-17 L25). */
export function truncateViewBody(body: string, maxViewChars: number): string {
  if (body.length <= maxViewChars) return body;
  if (TRUNCATION_NOTICE_RE.test(body)) return body;
  const cut = body.lastIndexOf('\n', maxViewChars);
  // The newline-boundary cut is surrogate-safe (a `\n` is never half a pair);
  // the no-newline fallback slices at an arbitrary char index, so it must not
  // split a surrogate pair into a lone, model-visible surrogate (audit r4
  // R7s-5).
  const kept = cut > 0 ? body.slice(0, cut) : sliceSurrogateSafe(body, maxViewChars);
  return `${kept}\n${viewTruncationNotice(maxViewChars)}`;
}

export type CreateMemoryStoreOptions = {
  /**
   * `create` on an existing file overwrites instead of returning the
   * reference error (the official tool description says create "creates or
   * overwrites"; returning the error is the reference behavior and the
   * default here — spec R1 makes overwrite an explicit opt-in).
   */
  createOverwrite?: boolean;
  /** Governance limits (spec R8); missing fields take DEFAULT_MEMORY_LIMITS. */
  limits?: Partial<MemoryLimits>;
  /** Structured memory-card mode (spec R9): every written file must validate
   *  as cards; invalid content is rejected with a structured retryable error. */
  schema?: 'cards';
  /** Card limits for schema 'cards'; missing fields take DEFAULT_CARDS_CONFIG. */
  cards?: Partial<MemoryCardsConfig>;
};

const MAX_LINES = 999_999;
const LINE_NUMBER_WIDTH = 6;
const SNIPPET_CONTEXT_LINES = 2;

/** Human-readable size, reference-helper algorithm: whole numbers bare
 *  ("4K"), fractions to one decimal ("1.5K"). */
export function formatFileSize(bytes: number): string {
  if (bytes <= 0) return '0B';
  const k = 1024;
  const units = ['B', 'K', 'M', 'G'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  const size = bytes / Math.pow(k, i);
  return (size % 1 === 0 ? size.toString() : size.toFixed(1)) + units[i];
}

function numberLines(lines: string[], startNum: number): string[] {
  return lines.map(
    (line, i) => `${String(i + startNum).padStart(LINE_NUMBER_WIDTH, ' ')}\t${line}`,
  );
}

function pathDoesNotExistView(path: string): MemoryToolError {
  return new MemoryToolError(`The path ${path} does not exist. Please provide a valid path.`);
}

/**
 * Build a `MemoryStore` (the six-command contract in
 * src/internal/contracts.ts) over storage primitives. Reference return
 * strings and command semantics live here; see the module header.
 */
export function createMemoryStore(
  ops: MemoryFileOps,
  options: CreateMemoryStoreOptions = {},
): MemoryStore {
  const overwrite = options.createOverwrite === true;
  const limits: MemoryLimits = { ...DEFAULT_MEMORY_LIMITS, ...options.limits };
  const cardsCfg: MemoryCardsConfig = { ...DEFAULT_CARDS_CONFIG, ...options.cards };
  /** R8 + R9 write gate: size cap, then cards validation, both BEFORE any
   *  primitive write. Throws the SDK-defined error string. */
  const checkWrite = (path: string, content: string): void => {
    if (Buffer.byteLength(content, 'utf8') > limits.maxFileBytes) {
      throw new MemoryToolError(fileTooLargeError(path, limits.maxFileBytes));
    }
    if (options.schema === 'cards') {
      const invalid = validateCardsContent(content, cardsCfg);
      if (invalid !== null) throw new MemoryToolError(invalid);
    }
  };

  /** 2-level depth-first listing walk (level 1 = children of the viewed
   *  directory, level 2 = grandchildren), sorted per level, hidden items and
   *  node_modules excluded. Returns `relative path (dir trailing /)` lines. */
  async function collectListing(
    dirPath: string,
    relative: string,
    depth: number,
    out: Array<{ size: string; rel: string }>,
  ): Promise<void> {
    if (depth > 2) return;
    const entries = [...(await ops.list(dirPath))].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const rel = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.kind === 'directory') {
        out.push({ size: formatFileSize(entry.sizeBytes), rel: `${rel}/` });
        if (depth < 2) {
          await collectListing(`${dirPath}/${entry.name}`, rel, depth + 1, out);
        }
      } else {
        out.push({ size: formatFileSize(entry.sizeBytes), rel });
      }
    }
  }

  async function statOrNull(path: string): Promise<MemoryEntryStat | null> {
    return await ops.stat(path);
  }

  return {
    async view(rawPath, viewRange): Promise<string> {
      const path = validateMemoryPath(rawPath);
      const stat = await statOrNull(path);
      if (stat === null) throw pathDoesNotExistView(path);

      if (stat.kind === 'directory') {
        const items: Array<{ size: string; rel: string }> = [];
        await collectListing(path, '', 1, items);
        const header =
          `Here're the files and directories up to 2 levels deep in ${path}, ` +
          `excluding hidden items and node_modules:`;
        const lines = [
          `${formatFileSize(stat.sizeBytes)}\t${path}`,
          ...items.map((item) => `${item.size}\t${path}/${item.rel}`),
        ];
        return `${header}\n${lines.join('\n')}`;
      }

      const content = await ops.read(path);
      const lines = content.split('\n');
      if (lines.length > MAX_LINES) {
        throw new MemoryToolError(
          `File ${path} exceeds maximum line limit of ${MAX_LINES.toLocaleString('en-US')} lines.`,
        );
      }
      let displayLines = lines;
      let startNum = 1;
      if (viewRange !== undefined) {
        // A negative end other than -1 would silently drop tail lines through
        // JS slice semantics (audit 2026-07-17 H2-5) — validate instead. An
        // end beyond the file is tolerated (slice clamps), matching the R6
        // resident-index read of [1, maxLines + 1].
        const [start, end] = viewRange;
        const invalid =
          viewRange.length !== 2 ||
          !Number.isInteger(start) ||
          !Number.isInteger(end) ||
          start < 1 ||
          start > lines.length ||
          (end !== -1 && end < start);
        if (invalid) {
          throw new MemoryToolError(
            `Error: Invalid \`view_range\` parameter: [${viewRange.join(', ')}]. ` +
              `It should be [start_line, end_line] with start_line within the ` +
              `range of lines of the file: [1, ${lines.length}], and end_line >= ` +
              `start_line, or -1 for the end of the file.`,
          );
        }
        displayLines = lines.slice(start - 1, end === -1 ? lines.length : end);
        startNum = start;
      }
      return (
        `Here's the content of ${path} with line numbers:\n` +
        truncateViewBody(numberLines(displayLines, startNum).join('\n'), limits.maxViewChars)
      );
    },

    async create(rawPath, fileText): Promise<string> {
      const path = validateMemoryPath(rawPath);
      if (path === MEMORY_ROOT) {
        throw new MemoryToolError(`Error: File ${path} already exists`);
      }
      const stat = await statOrNull(path);
      if (stat !== null && (stat.kind === 'directory' || !overwrite)) {
        throw new MemoryToolError(`Error: File ${path} already exists`);
      }
      checkWrite(path, fileText);
      if (stat === null) {
        // R8: per-directory file-count cap, checked only when ADDING a file.
        const parent = path.slice(0, path.lastIndexOf('/')) || MEMORY_ROOT;
        const parentStat = await statOrNull(parent);
        if (parentStat?.kind === 'directory') {
          const files = (await ops.list(parent)).filter((e) => e.kind === 'file');
          if (files.length >= limits.maxFilesPerDirectory) {
            throw new MemoryToolError(
              directoryFullError(parent, limits.maxFilesPerDirectory),
            );
          }
        }
      }
      await ops.write(path, fileText);
      return `File created successfully at: ${path}`;
    },

    async strReplace(rawPath, oldStr, newStr): Promise<string> {
      const path = validateMemoryPath(rawPath);
      const stat = await statOrNull(path);
      if (stat === null || stat.kind !== 'file') {
        // A directory path gets the "file does not exist" error per the docs.
        throw new MemoryToolError(
          `Error: The path ${path} does not exist. Please provide a valid path.`,
        );
      }
      // An empty old_str matches everywhere: single-line files silently
      // prepended new_str while multi-line files errored (audit 2026-07-17
      // H2-4) — reject it consistently before any matching.
      if (oldStr === '') {
        throw new MemoryToolError(
          `No replacement was performed, old_str is empty. Provide the exact ` +
            `text to replace in ${path}.`,
        );
      }
      const content = await ops.read(path);
      // Occurrences are counted over the FULL content, not per line: a
      // per-line scan made every multi-line old_str fail as not-found
      // (audit 2026-07-17 H2-1) and let a same-line duplicate slip past the
      // uniqueness guard (H2-2). Each occurrence reports the line its match
      // STARTS on; non-overlapping scan, like the single replacement itself.
      const matchStarts: number[] = [];
      const matchLines: number[] = [];
      for (
        let idx = content.indexOf(oldStr);
        idx !== -1;
        idx = content.indexOf(oldStr, idx + oldStr.length)
      ) {
        matchStarts.push(idx);
        matchLines.push(content.slice(0, idx).split('\n').length);
      }
      if (matchStarts.length === 0) {
        throw new MemoryToolError(
          `No replacement was performed, old_str \`${oldStr}\` did not appear verbatim in ${path}.`,
        );
      }
      if (matchStarts.length > 1) {
        throw new MemoryToolError(
          `No replacement was performed. Multiple occurrences of old_str \`${oldStr}\` ` +
            `in lines: ${matchLines.join(', ')}. Please ensure it is unique`,
        );
      }
      // Splice by index — String.replace would interpret `$&`-style patterns
      // in new_str as replacement directives and corrupt the write.
      const matchStart = matchStarts[0]!;
      const newContent =
        content.slice(0, matchStart) + (newStr ?? '') + content.slice(matchStart + oldStr.length);
      checkWrite(path, newContent);
      await ops.write(path, newContent);

      const newLines = newContent.split('\n');
      const changedLineIndex = matchLines[0]! - 1;
      // The snippet spans the whole replacement (multi-line new_str) plus the
      // reference ±2 lines of context; single-line new_str reduces to the
      // original reference window.
      const replacementLineSpan = (newStr ?? '').split('\n').length;
      const contextStart = Math.max(0, changedLineIndex - SNIPPET_CONTEXT_LINES);
      const contextEnd = Math.min(
        newLines.length,
        changedLineIndex + replacementLineSpan - 1 + SNIPPET_CONTEXT_LINES + 1,
      );
      const snippet = numberLines(
        newLines.slice(contextStart, contextEnd),
        contextStart + 1,
      );
      return (
        `The memory file has been edited. Here is the snippet showing the change ` +
        `(with line numbers):\n${snippet.join('\n')}`
      );
    },

    async insert(rawPath, insertLine, insertText): Promise<string> {
      const path = validateMemoryPath(rawPath);
      const stat = await statOrNull(path);
      if (stat === null || stat.kind !== 'file') {
        throw new MemoryToolError(`Error: The path ${path} does not exist`);
      }
      const content = await ops.read(path);
      // An empty file is zero lines, not one phantom blank line: ''.split('\n')
      // yields [''], so inserting left a stray blank line beside the inserted
      // text (audit r4 U4-5). Treat empty content as no lines so an insert into
      // an empty file produces exactly the inserted text.
      const lines = content === '' ? [] : content.split('\n');
      if (!Number.isInteger(insertLine) || insertLine < 0 || insertLine > lines.length) {
        throw new MemoryToolError(
          `Error: Invalid \`insert_line\` parameter: ${insertLine}. It should be ` +
            `within the range of lines of the file: [0, ${lines.length}]`,
        );
      }
      lines.splice(insertLine, 0, insertText.replace(/\n$/, ''));
      const inserted = lines.join('\n');
      checkWrite(path, inserted);
      await ops.write(path, inserted);
      return `The file ${path} has been edited.`;
    },

    async delete(rawPath): Promise<string> {
      const path = validateMemoryPath(rawPath);
      if (path === MEMORY_ROOT) {
        throw new MemoryToolError(`Error: Cannot delete the ${MEMORY_ROOT} directory itself`);
      }
      const stat = await statOrNull(path);
      if (stat === null) {
        throw new MemoryToolError(`Error: The path ${path} does not exist`);
      }
      await ops.delete(path);
      return `Successfully deleted ${path}`;
    },

    async rename(rawOldPath, rawNewPath): Promise<string> {
      const oldPath = validateMemoryPath(rawOldPath);
      const newPath = validateMemoryPath(rawNewPath);
      if (oldPath === MEMORY_ROOT) {
        throw new MemoryToolError(`Error: Cannot rename the ${MEMORY_ROOT} directory itself`);
      }
      const oldStat = await statOrNull(oldPath);
      if (oldStat === null) {
        throw new MemoryToolError(`Error: The path ${oldPath} does not exist`);
      }
      // A directory renamed into its own subtree makes fs.rename throw a raw
      // EINVAL; reject with a structured error first (audit r4 U4-6). The
      // trailing slash keeps a sibling with a shared prefix (foo -> foobar)
      // out of the check.
      if (newPath.startsWith(oldPath + '/')) {
        throw new MemoryToolError(
          `Error: Cannot rename ${oldPath} into its own subdirectory ${newPath}`,
        );
      }
      const newStat = await statOrNull(newPath);
      if (newStat !== null || newPath === MEMORY_ROOT) {
        throw new MemoryToolError(`Error: The destination ${newPath} already exists`);
      }
      // R8: a rename that moves a FILE into a DIFFERENT directory adds a new
      // file there — enforce the destination's per-directory file cap, or
      // create-elsewhere-then-rename-in would smuggle files past the cap that
      // `create` blocks (audit r4 U4-3). A directory move adds a directory
      // (not a direct file), and a rename within the same parent grows
      // nothing — neither needs the check.
      if (oldStat.kind === 'file') {
        const oldParent = oldPath.slice(0, oldPath.lastIndexOf('/')) || MEMORY_ROOT;
        const newParent = newPath.slice(0, newPath.lastIndexOf('/')) || MEMORY_ROOT;
        if (newParent !== oldParent) {
          const parentStat = await statOrNull(newParent);
          if (parentStat?.kind === 'directory') {
            const files = (await ops.list(newParent)).filter((e) => e.kind === 'file');
            if (files.length >= limits.maxFilesPerDirectory) {
              throw new MemoryToolError(
                directoryFullError(newParent, limits.maxFilesPerDirectory),
              );
            }
          }
        }
      }
      await ops.rename(oldPath, newPath);
      return `Successfully renamed ${oldPath} to ${newPath}`;
    },
  };
}
