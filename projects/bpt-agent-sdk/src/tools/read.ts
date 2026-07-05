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
import { READ_DESCRIPTION } from './descriptions.js';

const DEFAULT_LINE_LIMIT = 2000;

/**
 * Hard byte cap. Read buffers the whole file before applying offset/limit, so
 * without this guard a multi-GB text file (which slips past the 8KB binary
 * sniff) materializes entirely in memory and OOMs the process even with the
 * default 2000-line limit. Above the cap we refuse and steer the caller to a
 * bounded tool (Grep) rather than crashing the run.
 */
const MAX_READ_BYTES = 50 * 1024 * 1024;

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

/**
 * Sniff an image media type from MAGIC BYTES (content, not extension — a
 * mislabeled `.txt` PNG is still an image). Returns undefined for non-images.
 */
function detectImageMediaType(buf: Buffer): string | undefined {
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
  ) {
    return 'image/png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buf.length >= 6 &&
    buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38
  ) {
    return 'image/gif';
  }
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return 'image/webp';
  }
  return undefined;
}

export const readTool: BuiltinTool = {
  name: 'Read',
  description: READ_DESCRIPTION,
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
        if (st.size > MAX_READ_BYTES) {
          return errorResult(
            `Read failed: "${abs}" is ${st.size} bytes, larger than the ${MAX_READ_BYTES}-byte (${Math.floor(
              MAX_READ_BYTES / (1024 * 1024),
            )}MB) read cap. Reading it whole would exhaust memory. Use the Grep tool to search it, or split the file into smaller pieces.`,
          );
        }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
          return errorResult(`Read failed: file does not exist: "${abs}".`);
        }
        throw e;
      }

      const buf = await readFile(abs, { signal: ctx.signal });

      // Image files are returned as an image content block (base64), sniffed by
      // magic bytes so a mislabeled extension still renders. offset/limit do not
      // apply to images and are ignored.
      const imageMediaType = detectImageMediaType(buf);
      if (imageMediaType !== undefined) {
        ctx.debug(`Read: ${abs} as ${imageMediaType} (${buf.length} bytes)`);
        return {
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: imageMediaType,
                data: buf.toString('base64'),
              },
            },
          ],
        };
      }

      // PDF: returned as a base64 document content block. The API's
      // handle-tool-calls docs list `document` among the block types valid
      // inside a tool_result. offset/limit do not apply and are ignored.
      if (buf.length >= 5 && buf.toString('latin1', 0, 5) === '%PDF-') {
        ctx.debug(`Read: ${abs} as application/pdf (${buf.length} bytes)`);
        return {
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: buf.toString('base64'),
              },
            },
          ],
        };
      }

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
