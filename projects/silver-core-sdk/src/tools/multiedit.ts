/**
 * Built-in MultiEdit tool: apply several exact-string replacements to ONE
 * UTF-8 text file as a single atomic step.
 *
 * The edits are applied SEQUENTIALLY on one in-memory snapshot — edit N sees
 * edit N-1's result, so an intra-file dependent chain (rename a symbol, then
 * edit a line that now contains the new name) is expressible in one call — and
 * the file is written exactly once, only if EVERY edit succeeds. Any failure (a
 * not-found or non-unique old_string) aborts the whole operation, writes
 * nothing, and names the failing edit by index. A single pre-image (the
 * original text, captured before any edit) is recorded for Query.rewindFiles(),
 * so a rewind restores the file to its true prior state, never a half-applied
 * one.
 *
 * This collapses the Read → Edit → Edit → … tool loop into Read → MultiEdit for
 * same-file changes. Cross-file edits, and edits whose text depends on an
 * intervening tool RESULT, still use separate Edit calls (this tool never
 * spans files and applies its whole list against one snapshot).
 *
 * Field names (file_path / edits[].old_string / new_string / replace_all) are
 * part of the compat surface — hooks and permission rules match on them.
 */

import { readFile, stat, writeFile } from 'node:fs/promises';
import type {
  BuiltinTool,
  ToolContext,
  ToolResultPayload,
} from '../internal/contracts.js';
import { AbortError, isAbortError } from '../errors.js';
import { looksBinary, resolveAbs } from './fsutil.js';
import { MULTIEDIT_DESCRIPTION } from './descriptions.js';

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

/** One validated edit (types + non-empty/differ checks already passed). */
type ParsedEdit = {
  oldString: string;
  newString: string;
  replaceAll: boolean;
};

/**
 * Structural validation of the `edits` array, done UP FRONT (before any
 * mutation) so a malformed edit fails atomically like a match failure does.
 * Returns the parsed edits, or an error message string.
 */
function parseEdits(raw: unknown): ParsedEdit[] | string {
  if (!Array.isArray(raw)) {
    return 'MultiEdit failed: "edits" must be an array.';
  }
  if (raw.length === 0) {
    return 'MultiEdit failed: "edits" must contain at least one edit.';
  }
  const parsed: ParsedEdit[] = [];
  for (let i = 0; i < raw.length; i++) {
    const label = `edit #${i + 1}`;
    const e = raw[i];
    if (typeof e !== 'object' || e === null) {
      return `MultiEdit failed: ${label} must be an object.`;
    }
    const rec = e as Record<string, unknown>;
    const oldString = rec['old_string'];
    if (typeof oldString !== 'string') {
      return `MultiEdit failed: ${label} "old_string" must be a string.`;
    }
    const newString = rec['new_string'];
    if (typeof newString !== 'string') {
      return `MultiEdit failed: ${label} "new_string" must be a string.`;
    }
    const replaceAllRaw = rec['replace_all'];
    if (replaceAllRaw !== undefined && typeof replaceAllRaw !== 'boolean') {
      return `MultiEdit failed: ${label} "replace_all" must be a boolean when provided.`;
    }
    if (oldString.length === 0) {
      return `MultiEdit failed: ${label} "old_string" must not be empty.`;
    }
    if (oldString === newString) {
      return `MultiEdit failed: ${label} "old_string" and "new_string" are identical; nothing to change.`;
    }
    parsed.push({ oldString, newString, replaceAll: replaceAllRaw === true });
  }
  return parsed;
}

/** Substitute `edit` into `text` (match already validated by the caller). */
function substitute(text: string, edit: ParsedEdit): { text: string; replaced: number } {
  if (edit.replaceAll) {
    // String splitting on purpose: String.prototype.replace would interpret
    // $-patterns in the replacement text.
    const count = countOccurrences(text, edit.oldString);
    return { text: text.split(edit.oldString).join(edit.newString), replaced: count };
  }
  const idx = text.indexOf(edit.oldString);
  return {
    text: text.slice(0, idx) + edit.newString + text.slice(idx + edit.oldString.length),
    replaced: 1,
  };
}

/**
 * A not-found old_string has two very different causes with two different
 * remedies, and the tool can tell them apart because it holds the original
 * text: either the text never existed in the file (stale memory / whitespace
 * mismatch — re-Read), or it DID exist and a preceding edit in this same call
 * rewrote it (overlapping edits — merge them). For the second case, replay the
 * already-validated preceding edits to name the one that consumed the match.
 */
function diagnoseNotFound(
  original: string,
  edits: ParsedEdit[],
  failedIndex: number,
  label: string,
): string {
  const needle = edits[failedIndex]!.oldString;
  if (!original.includes(needle)) {
    return `MultiEdit failed at ${label}: old_string was not found — it does not appear in the original file either. Re-Read the file and copy the text exactly, including whitespace and indentation. No changes were written.`;
  }
  let text = original;
  let culprit = 0;
  for (let j = 0; j < failedIndex; j++) {
    text = substitute(text, edits[j]!).text;
    if (!text.includes(needle)) {
      culprit = j + 1;
      break;
    }
  }
  return `MultiEdit failed at ${label}: old_string matches the ORIGINAL file, but edit #${culprit} in this call already rewrote that text, so it no longer exists when ${label} applies. Edits whose regions overlap must be MERGED into a single edit (or the later old_string authored against the post-edit text). No changes were written.`;
}

export const multiEditTool: BuiltinTool = {
  name: 'MultiEdit',
  description: MULTIEDIT_DESCRIPTION,
  readOnly: false,
  isFileEdit: true,
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Path of the file to edit (absolute or cwd-relative). All edits apply to this one file.',
      },
      edits: {
        type: 'array',
        description:
          'Ordered edits applied sequentially on one snapshot; each edit sees the result of the previous one. All must succeed or the file is left untouched.',
        items: {
          type: 'object',
          properties: {
            old_string: {
              type: 'string',
              description:
                'Exact text to replace. Must be unique in the file (as it stands after the preceding edits) unless replace_all is true.',
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
          required: ['old_string', 'new_string'],
        },
      },
    },
    required: ['file_path', 'edits'],
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
        return errorResult('MultiEdit failed: "file_path" must be a non-empty string.');
      }

      const edits = parseEdits(input['edits']);
      if (typeof edits === 'string') {
        return errorResult(edits);
      }

      const abs = resolveAbs(ctx.cwd, filePath);

      try {
        const st = await stat(abs);
        if (st.isDirectory()) {
          return errorResult(`MultiEdit failed: "${abs}" is a directory, not a file.`);
        }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
          return errorResult(`MultiEdit failed: file does not exist: "${abs}".`);
        }
        throw e;
      }

      // Read-before-write gate (parity with Edit/Write): refuse to edit a file
      // this session has not Read first. A prior Read — or a prior successful
      // Edit/Write/MultiEdit, which register the path below — unlocks it.
      if (ctx.readFilePaths !== undefined && !ctx.readFilePaths.has(abs)) {
        return errorResult(
          '<tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>',
        );
      }

      const buf = await readFile(abs, { signal: ctx.signal });
      if (looksBinary(buf)) {
        return errorResult(
          `MultiEdit failed: "${abs}" appears to be a binary file and cannot be edited as text.`,
        );
      }
      const original = buf.toString('utf8');

      // Apply every edit on ONE evolving snapshot. A failure returns before any
      // write, so the on-disk file is never left half-edited (atomic).
      let text = original;
      const perEdit: number[] = [];
      for (let i = 0; i < edits.length; i++) {
        const edit = edits[i]!;
        const label = `edit #${i + 1}`;
        const count = countOccurrences(text, edit.oldString);
        if (count === 0) {
          return errorResult(diagnoseNotFound(original, edits, i, label));
        }
        if (count > 1 && !edit.replaceAll) {
          return errorResult(
            `MultiEdit failed at ${label}: found ${count} occurrences of old_string. The match must be unique — add more surrounding context, or set replace_all: true. No changes were written.`,
          );
        }
        const outcome = substitute(text, edit);
        text = outcome.text;
        perEdit.push(outcome.replaced);
      }

      if (text === original) {
        // Every edit was a structural no-op relative to the file — cannot
        // happen given the per-edit old!==new guard, but keep the invariant
        // explicit rather than writing an identical file.
        return errorResult('MultiEdit failed: the edits produced no change to the file.');
      }

      // Capture the pre-image (ORIGINAL, pre-any-edit) exactly once so
      // Query.rewindFiles() restores the true prior state, not a partial one.
      ctx.recordFileChange?.(abs, original);

      await writeFile(abs, text, { encoding: 'utf8', signal: ctx.signal });

      // The session has now seen (and rewritten) the file — register the path
      // so a follow-up Write/Edit is not blocked by the read-before-write gate.
      ctx.readFilePaths?.add(abs);
      ctx.debug(`MultiEdit: ${abs} applied ${edits.length} edit(s)`);

      const summary = perEdit
        .map((n, i) => `  ${i + 1}. replaced ${n} occurrence${n === 1 ? '' : 's'}`)
        .join('\n');
      return {
        content: `Applied ${edits.length} edit${edits.length === 1 ? '' : 's'} to "${abs}":\n${summary}`,
      };
    } catch (e) {
      if (isAbortError(e)) {
        throw new AbortError('MultiEdit was aborted');
      }
      return errorResult(`MultiEdit failed: ${(e as Error).message}`);
    }
  },
};
