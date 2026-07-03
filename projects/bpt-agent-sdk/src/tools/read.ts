/**
 * Built-in Read tool: read a UTF-8 text file with cat -n style line numbers.
 *
 * Input field names (file_path / offset / limit) are part of the compat
 * surface — hooks and permission rules match on them.
 */

import { readFile, stat } from 'node:fs/promises';
import type {
  BuiltinTool,
  ToolContext,
  ToolResultPayload,
} from '../internal/contracts.js';
import { AbortError, isAbortError } from '../errors.js';
import { formatCatN, looksBinary, resolveWithin } from './fsutil.js';

const DEFAULT_LINE_LIMIT = 2000;

function errorResult(message: string): ToolResultPayload {
  return { content: message, isError: true };
}

/** Split file text into display lines (trailing newline not counted; CR stripped). */
function toDisplayLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') {
    lines.pop(); // do not number a phantom line after a trailing newline
  }
  return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

export const readTool: BuiltinTool = {
  name: 'Read',
  description:
    'Read a file from the local filesystem as UTF-8 text. Returns the ' +
    'content in cat -n style (right-aligned line number, tab, line text), ' +
    'starting at line 1. Reads up to 2000 lines by default; use offset ' +
    '(1-based start line) and limit (max lines) to page through larger ' +
    'files. Lines longer than 2000 characters are truncated. The path may ' +
    'be absolute or relative to the session working directory.',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Path of the file to read (absolute or cwd-relative).',
      },
      offset: {
        type: 'number',
        description:
          '1-based line number to start reading from. Only needed for large files.',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of lines to return (default 2000).',
      },
    },
    required: ['file_path'],
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
        return errorResult('Read failed: "file_path" must be a non-empty string.');
      }
      const offsetRaw = input['offset'];
      if (
        offsetRaw !== undefined &&
        (typeof offsetRaw !== 'number' || !Number.isFinite(offsetRaw))
      ) {
        return errorResult('Read failed: "offset" must be a number when provided.');
      }
      const limitRaw = input['limit'];
      if (
        limitRaw !== undefined &&
        (typeof limitRaw !== 'number' || !Number.isFinite(limitRaw))
      ) {
        return errorResult('Read failed: "limit" must be a number when provided.');
      }
      const limit =
        limitRaw === undefined ? DEFAULT_LINE_LIMIT : Math.floor(limitRaw);
      if (limit < 1) {
        return errorResult('Read failed: "limit" must be a positive integer.');
      }
      // offset is a 1-based line number; 0/negative values clamp to line 1.
      const startLine = Math.max(1, Math.floor((offsetRaw as number | undefined) ?? 1));

      const resolved = resolveWithin(ctx.cwd, ctx.additionalDirectories, filePath);
      if (!resolved.ok) {
        return errorResult(`Read failed: ${resolved.reason}`);
      }
      const abs = resolved.abs;

      try {
        const st = await stat(abs);
        if (st.isDirectory()) {
          return errorResult(
            `Read failed: "${abs}" is a directory, not a file. Use the Glob tool to list its contents.`,
          );
        }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
          return errorResult(`Read failed: file does not exist: "${abs}".`);
        }
        throw e;
      }

      const buf = await readFile(abs, { signal: ctx.signal });
      if (looksBinary(buf)) {
        return errorResult(
          `Read failed: "${abs}" appears to be a binary file and cannot be displayed as text.`,
        );
      }
      if (buf.length === 0) {
        // Not an error: surface as a system-reminder-style note.
        return {
          content: `<system-reminder>The file "${abs}" exists but is empty (0 bytes).</system-reminder>`,
        };
      }

      const lines = toDisplayLines(buf.toString('utf8'));
      const total = lines.length;
      if (startLine > total) {
        return errorResult(
          `Read failed: offset ${startLine} is past the end of the file (${total} line${total === 1 ? '' : 's'} total).`,
        );
      }
      const selected = lines.slice(startLine - 1, startLine - 1 + limit);
      const lastShown = startLine + selected.length - 1;
      ctx.debug(`Read: ${abs} lines ${startLine}-${lastShown} of ${total}`);

      let content = formatCatN(selected, startLine);
      if (lastShown < total) {
        content += `\n\n(Showing lines ${startLine}-${lastShown} of ${total}. Use offset=${lastShown + 1} to continue reading.)`;
      }
      return { content };
    } catch (e) {
      if (isAbortError(e)) {
        throw new AbortError('Read was aborted');
      }
      return errorResult(`Read failed: ${(e as Error).message}`);
    }
  },
};
