/**
 * Built-in Edit tool: exact-string replacement in a UTF-8 text file.
 *
 * Input field names (file_path / old_string / new_string / replace_all) are
 * part of the compat surface — hooks and permission rules match on them.
 */

import { readFile, stat, writeFile } from 'node:fs/promises';
import type {
  BuiltinTool,
  ToolContext,
  ToolResultPayload,
} from '../internal/contracts.js';
import { AbortError, isAbortError } from '../errors.js';
import {
  adaptEditToLineEndings,
  formatCatN,
  isLossyUtf8,
  looksBinary,
  resolveAbs,
} from './fsutil.js';
import { EDIT_DESCRIPTION } from './descriptions.js';

/** Context lines shown around the first edit site in the success snippet. */
const SNIPPET_CONTEXT_LINES = 2;

function errorResult(message: string): ToolResultPayload {
  return { content: message, isError: true };
}

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

/** cat -n snippet of the updated content around the first edit site. */
function buildSnippet(updated: string, firstEditIndex: number, newString: string): string {
  const lines = updated.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  const display = lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  // 1-based line number where the replacement begins.
  const editLine = updated.slice(0, firstEditIndex).split('\n').length;
  const editSpan = newString.split('\n').length;
  const from = Math.max(1, editLine - SNIPPET_CONTEXT_LINES);
  const to = Math.min(display.length, editLine + editSpan - 1 + SNIPPET_CONTEXT_LINES);
  // Edit shows a bounded diff-context snippet, not a paginated read: disable
  // the total-output cap so a large edit context is never truncated (the small
  // snippet never approaches it anyway); the per-line marker still applies.
  return formatCatN(display.slice(from - 1, to), from, {
    maxOutputChars: Number.MAX_SAFE_INTEGER,
  }).text;
}

export const editTool: BuiltinTool = {
  name: 'Edit',
  description: EDIT_DESCRIPTION,
  readOnly: false,
  isFileEdit: true,
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Path of the file to edit (absolute or cwd-relative).',
      },
      old_string: {
        type: 'string',
        description:
          'Exact text to replace. Must be unique in the file unless replace_all is true.',
      },
      new_string: {
        type: 'string',
        description: 'Replacement text. Must differ from old_string.',
      },
      replace_all: {
        type: 'boolean',
        description: 'Replace every occurrence of old_string (default false).',
        default: false,
      },
    },
    required: ['file_path', 'old_string', 'new_string'],
  },
  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResultPayload> {
    try {
      if (ctx.signal.aborted) {
        throw new AbortError();
      }

      const filePath = input['file_path'];
      if (typeof filePath !== 'string' || filePath.length === 0) {
        return errorResult('Edit failed: "file_path" must be a non-empty string.');
      }
      const oldString = input['old_string'];
      if (typeof oldString !== 'string') {
        return errorResult('Edit failed: "old_string" must be a string.');
      }
      const newString = input['new_string'];
      if (typeof newString !== 'string') {
        return errorResult('Edit failed: "new_string" must be a string.');
      }
      const replaceAllRaw = input['replace_all'];
      if (replaceAllRaw !== undefined && typeof replaceAllRaw !== 'boolean') {
        return errorResult('Edit failed: "replace_all" must be a boolean when provided.');
      }
      const replaceAll = replaceAllRaw === true;

      if (oldString.length === 0) {
        return errorResult('Edit failed: "old_string" must not be empty.');
      }
      if (oldString === newString) {
        return errorResult(
          'Edit failed: "old_string" and "new_string" are identical; nothing to change.',
        );
      }

      const abs = resolveAbs(ctx.cwd, filePath);

      try {
        const st = await stat(abs);
        if (st.isDirectory()) {
          return errorResult(`Edit failed: "${abs}" is a directory, not a file.`);
        }
        // F3 (audit 2026-07-17): a FIFO / device / socket passes the directory
        // check but readFile on it blocks forever (FIFO with no writer) and
        // abort cannot settle it. Only regular files are editable.
        if (!st.isFile()) {
          return errorResult(
            `Edit failed: "${abs}" is not a regular file (FIFO/device/socket); editing it is not supported.`,
          );
        }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
          return errorResult(`Edit failed: file does not exist: "${abs}".`);
        }
        throw e;
      }

      // Read-before-write gate (P2 parity): the official Edit tool refuses to
      // edit a file this session has not Read first, exactly as Write does
      // (write.ts). The file necessarily exists here (ENOENT rejected above);
      // a prior Read — or a prior successful Edit/Write, which register the
      // path below — unlocks it. Error text is verbatim official.
      if (ctx.readFilePaths !== undefined && !ctx.readFilePaths.has(abs)) {
        return errorResult(
          '<tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>',
        );
      }

      const buf = await readFile(abs, { signal: ctx.signal });
      if (looksBinary(buf)) {
        return errorResult(
          `Edit failed: "${abs}" appears to be a binary file and cannot be edited as text.`,
        );
      }
      // H1 (audit T49): a non-UTF-8 text file (GBK / Shift-JIS / Latin-1)
      // passes the NUL sniff but decodes lossily — toString('utf8') turns every
      // invalid sequence into U+FFFD, and the write below would bake those
      // replacement bytes into the WHOLE file, not just the edit site. Refuse.
      if (isLossyUtf8(buf)) {
        return errorResult(
          `Edit failed: "${abs}" is not valid UTF-8 text. Editing it would ` +
            `corrupt its non-UTF-8 bytes; convert the file to UTF-8 first ` +
            `(e.g. iconv) or edit it with a byte-safe tool.`,
        );
      }
      const text = buf.toString('utf8');

      // F2 (audit 2026-07-17): Read strips `\r` per line, so a multi-line
      // old_string copied from a Read of a CRLF file can never match the raw
      // content — adapt both strings to the file's `\r\n` style when the
      // direct match misses (fsutil.adaptEditToLineEndings).
      const adapted = adaptEditToLineEndings(text, oldString, newString);
      const effOld = adapted.oldString;
      const effNew = adapted.newString;

      const count = countOccurrences(text, effOld);
      if (count === 0) {
        return errorResult(
          `Edit failed: old_string was not found in "${abs}". It must match the file contents exactly, including whitespace and indentation.`,
        );
      }
      if (count > 1 && !replaceAll) {
        return errorResult(
          `Edit failed: found ${count} occurrences of old_string in "${abs}". The match must be unique — add more surrounding context to old_string, or set replace_all: true to replace every occurrence.`,
        );
      }

      // String-based splicing on purpose: String.prototype.replace would
      // interpret $-patterns in the replacement text.
      const firstIdx = text.indexOf(effOld);
      const updated = replaceAll
        ? text.split(effOld).join(effNew)
        : text.slice(0, firstIdx) +
          effNew +
          text.slice(firstIdx + effOld.length);

      // Capture the pre-image BEFORE mutating so Query.rewindFiles() can
      // restore it. `text` is the original content already read for the edit.
      // Same lossless-roundtrip guard as Write (write.ts): the checkpoint blob
      // pipeline is UTF-8, so a non-roundtripping (non-UTF-8) pre-image would
      // make rewind restore U+FFFD mojibake — record nothing instead.
      if (ctx.recordFileChange !== undefined) {
        if (Buffer.from(text, 'utf8').equals(buf)) {
          ctx.recordFileChange(abs, text);
        } else {
          ctx.debug(
            `Edit: skipping non-restorable checkpoint for non-UTF-8 file ${abs}`,
          );
        }
      }

      await writeFile(abs, updated, { encoding: 'utf8', signal: ctx.signal });

      const replaced = replaceAll ? count : 1;
      // Read-before-write gate (E4): Edit read the full file to apply the
      // replacement, so the session has seen its content - register the path
      // so a follow-up Write is not blocked.
      ctx.readFilePaths?.add(abs);
      ctx.debug(`Edit: ${abs} replaced ${replaced} occurrence(s)`);
      const snippet = buildSnippet(updated, firstIdx, effNew);
      return {
        content:
          `Replaced ${replaced} occurrence${replaced === 1 ? '' : 's'} of old_string in "${abs}".\n` +
          `Snippet around the first edit site:\n${snippet}`,
      };
    } catch (e) {
      if (isAbortError(e)) {
        throw new AbortError('Edit was aborted');
      }
      return errorResult(`Edit failed: ${(e as Error).message}`);
    }
  },
};
