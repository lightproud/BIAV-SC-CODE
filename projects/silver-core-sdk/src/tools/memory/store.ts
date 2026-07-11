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

import type { MemoryStore } from '../../internal/contracts.js';
import { MemoryToolError } from '../../errors.js';
import { MEMORY_ROOT, validateMemoryPath } from './paths.js';

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

export type CreateMemoryStoreOptions = {
  /**
   * `create` on an existing file overwrites instead of returning the
   * reference error (the official tool description says create "creates or
   * overwrites"; returning the error is the reference behavior and the
   * default here — spec R1 makes overwrite an explicit opt-in).
   */
  createOverwrite?: boolean;
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
      if (viewRange !== undefined && viewRange.length === 2) {
        const startLine = Math.max(1, viewRange[0]) - 1;
        const endLine = viewRange[1] === -1 ? lines.length : viewRange[1];
        displayLines = lines.slice(startLine, endLine);
        startNum = startLine + 1;
      }
      return (
        `Here's the content of ${path} with line numbers:\n` +
        numberLines(displayLines, startNum).join('\n')
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
      const content = await ops.read(path);
      const lines = content.split('\n');
      const matchingLines: number[] = [];
      lines.forEach((line, index) => {
        if (line.includes(oldStr)) matchingLines.push(index + 1);
      });
      if (matchingLines.length === 0) {
        throw new MemoryToolError(
          `No replacement was performed, old_str \`${oldStr}\` did not appear verbatim in ${path}.`,
        );
      }
      if (matchingLines.length > 1) {
        throw new MemoryToolError(
          `No replacement was performed. Multiple occurrences of old_str \`${oldStr}\` ` +
            `in lines: ${matchingLines.join(', ')}. Please ensure it is unique`,
        );
      }
      const newContent = content.replace(oldStr, newStr ?? '');
      await ops.write(path, newContent);

      const newLines = newContent.split('\n');
      const changedLineIndex = matchingLines[0]! - 1;
      const contextStart = Math.max(0, changedLineIndex - SNIPPET_CONTEXT_LINES);
      const contextEnd = Math.min(newLines.length, changedLineIndex + SNIPPET_CONTEXT_LINES + 1);
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
      const lines = content.split('\n');
      if (!Number.isInteger(insertLine) || insertLine < 0 || insertLine > lines.length) {
        throw new MemoryToolError(
          `Error: Invalid \`insert_line\` parameter: ${insertLine}. It should be ` +
            `within the range of lines of the file: [0, ${lines.length}]`,
        );
      }
      lines.splice(insertLine, 0, insertText.replace(/\n$/, ''));
      await ops.write(path, lines.join('\n'));
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
      const newStat = await statOrNull(newPath);
      if (newStat !== null || newPath === MEMORY_ROOT) {
        throw new MemoryToolError(`Error: The destination ${newPath} already exists`);
      }
      await ops.rename(oldPath, newPath);
      return `Successfully renamed ${oldPath} to ${newPath}`;
    },
  };
}
