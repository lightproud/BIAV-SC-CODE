/**
 * Built-in Read tool: read a UTF-8 text file with cat -n style line numbers.
 *
 * Input field names (file_path / offset / limit) are part of the compat
 * surface — hooks and permission rules match on them.
 */

import { open, stat } from 'node:fs/promises';
import type {
  BuiltinTool,
  ToolContext,
  ToolResultPayload,
} from '../internal/contracts.js';
import type { ReadLimits } from '../types.js';
import { AbortError, isAbortError } from '../errors.js';
import {
  MAX_READ_OUTPUT_CHARS,
  formatCatN,
  looksBinary,
  resolveAbs,
} from './fsutil.js';
import { READ_DESCRIPTION } from './descriptions.js';

const DEFAULT_LINE_LIMIT = 2000;

/**
 * Official cap for a `pages` PDF page-range request (E7-02 parity). Enforced
 * at validation time even though page slicing itself is not shipped (below),
 * so an over-long range fails with the same bound the official tool applies.
 */
const MAX_PDF_PAGES_PER_READ = 20;

/**
 * Hard byte cap. Read buffers the whole file before applying offset/limit, so
 * without this guard a multi-GB text file (which slips past the 8KB binary
 * sniff) materializes entirely in memory and OOMs the process even with the
 * default 2000-line limit. Above the cap we refuse and steer the caller to a
 * bounded tool (Grep) rather than crashing the run.
 */
const MAX_READ_BYTES = 50 * 1024 * 1024;

/**
 * Read `abs` while enforcing `maxBytes` DURING the read, not just before it:
 * the stat-based pre-check races a concurrent writer (TOCTOU — the file can
 * grow past the cap between stat and read, audit 2026-07-17 L22). Chunked fd
 * reads keep peak allocation at cap+64KB worst case and stop the moment the
 * cap is crossed. Returns null when the file exceeds the cap.
 */
async function readFileBounded(
  abs: string,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Buffer | null> {
  const fh = await open(abs, 'r');
  try {
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      if (signal.aborted) throw new AbortError('Read was aborted');
      const chunk = Buffer.allocUnsafe(64 * 1024);
      const { bytesRead } = await fh.read(chunk, 0, chunk.length, -1);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) return null;
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks);
  } finally {
    await fh.close();
  }
}

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

/** File byte size above which a char-capped read with long lines nudges toward
 *  Grep instead of paging (spec §D): a big file whose rows are also long is
 *  usually a "search, don't read" signal. */
const GREP_HINT_FILE_BYTES = 256 * 1024;

/** Build a Read tool bound to the given output limits (spec §E). `readTool`
 *  below is the default-limits instance for direct imports / no-config use. */
export function createReadTool(limits?: ReadLimits): BuiltinTool {
  return {
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
      pages: {
        type: 'string',
        description:
          'Page range for PDF files (e.g. "1-5" or "3"). Only applicable to ' +
          `PDF files; maximum ${MAX_PDF_PAGES_PER_READ} pages per request. ` +
          'This SDK returns PDFs whole and does not slice pages, so a PDF ' +
          'read with pages set returns an explicit error — omit pages to ' +
          'read the full document.',
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

      // `pages` (E7-02, official parity): a PDF page range like "1-5" or "3".
      // Validated to the official contract (1-based, ascending, <= 20 pages)
      // BEFORE any file I/O so malformed input fails fast and identically for
      // every file type. Applicability is checked after the type sniff below.
      const pagesRaw = input['pages'];
      if (pagesRaw !== undefined && typeof pagesRaw !== 'string') {
        return errorResult('Read failed: "pages" must be a string when provided.');
      }
      let pageRange: { start: number; end: number } | undefined;
      if (typeof pagesRaw === 'string') {
        const m = /^(\d+)(?:-(\d+))?$/.exec(pagesRaw.trim());
        if (m === null) {
          return errorResult(
            `Read failed: "pages" must be a page number or range like "3" or "1-5" (got "${pagesRaw}").`,
          );
        }
        const start = Number(m[1]);
        const end = m[2] !== undefined ? Number(m[2]) : start;
        if (start < 1 || end < start) {
          return errorResult(
            `Read failed: "pages" must be a 1-based ascending range (got "${pagesRaw}").`,
          );
        }
        if (end - start + 1 > MAX_PDF_PAGES_PER_READ) {
          return errorResult(
            `Read failed: "pages" spans ${end - start + 1} pages; maximum ${MAX_PDF_PAGES_PER_READ} pages per request.`,
          );
        }
        pageRange = { start, end };
      }

      // Path fence removed (#483 keeper ruling): resolve and reach any location
      // the process can, with the permission gate as the sole access control.
      const abs = resolveAbs(ctx.cwd, filePath);

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

      const bounded = await readFileBounded(abs, MAX_READ_BYTES, ctx.signal);
      if (bounded === null) {
        return errorResult(
          `Read failed: "${abs}" exceeds the ${MAX_READ_BYTES}-byte (${Math.floor(
            MAX_READ_BYTES / (1024 * 1024),
          )}MB) read cap. Reading it whole would exhaust memory. Use the Grep tool to search it, or split the file into smaller pieces.`,
        );
      }
      const buf = bounded;

      const isPdf = buf.length >= 5 && buf.toString('latin1', 0, 5) === '%PDF-';

      // `pages` applicability (behavior-honesty pin, E7-02): the parameter is
      // PDF-only. On any non-PDF target a pages request is refused explicitly
      // rather than silently ignored — the model asked for a page slice it
      // would not be getting.
      if (pageRange !== undefined && !isPdf) {
        return errorResult(
          `Read failed: "pages" only applies to PDF files, and "${abs}" is not a PDF. Retry without "pages".`,
        );
      }

      // Image files are returned as an image content block (base64), sniffed by
      // magic bytes so a mislabeled extension still renders. offset/limit do not
      // apply to images and are ignored.
      const imageMediaType = detectImageMediaType(buf);
      if (imageMediaType !== undefined) {
        ctx.debug(`Read: ${abs} as ${imageMediaType} (${buf.length} bytes)`);
        ctx.readFilePaths?.add(abs);
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
      //
      // `pages` on a PDF (behavior-honesty pin, E7-02): the official tool
      // slices the requested page range out of the document; this SDK ships
      // no PDF page slicer (whole-document reads only), so a pages request is
      // refused with an explicit error instead of silently returning the full
      // document — never pretend an unshipped capability ran (red line).
      if (isPdf) {
        if (pageRange !== undefined) {
          return errorResult(
            `Read failed: page-range reads are not supported by this SDK — "${abs}" would be returned whole. Retry without "pages" to read the full PDF.`,
          );
        }
        ctx.debug(`Read: ${abs} as application/pdf (${buf.length} bytes)`);
        ctx.readFilePaths?.add(abs);
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
        // Not an error: surface as a system-reminder-style note. The session
        // HAS seen the (empty) content, so the read still registers.
        ctx.readFilePaths?.add(abs);
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
      // Read-before-write gate (E4): a successful Read (even a partial
      // offset/limit window - matching the official gate, which unlocks on
      // any successful Read of the file) registers the path.
      ctx.readFilePaths?.add(abs);

      const maxOutputChars = limits?.maxOutputChars ?? MAX_READ_OUTPUT_CHARS;
      const fmt = formatCatN(selected, startLine, {
        maxOutputChars,
        maxLineChars: limits?.maxLineChars,
      });
      // The char cap may bound the output BEFORE the line window does, so the
      // real last line shown is what formatCatN actually emitted (spec §B: the
      // footer must reflect whichever cap took effect — never claim more lines
      // than were returned).
      const shownLines = fmt.linesEmitted;
      const realLastShown = startLine + shownLines - 1;
      let content = fmt.text;
      if (fmt.charCapped) {
        // Total-character cap took effect (may be tighter than the line limit).
        let footer =
          `\n\n(Showing lines ${startLine}-${realLastShown} of ${total}; ` +
          `output truncated at ${maxOutputChars} chars. ` +
          `Use offset=${realLastShown + 1} to continue reading.)`;
        // §D: a big file whose rows are also long — Grep is usually the better
        // tool than paging through it. read.ts holds the byte size + long-line
        // signal that an app-layer hook could only guess at.
        if (fmt.truncatedLines > 0 && buf.length > GREP_HINT_FILE_BYTES) {
          footer +=
            '\n(This file is large and has very long lines; consider the Grep ' +
            'tool to search it instead of reading page by page.)';
        }
        content += footer;
      } else if (realLastShown < total) {
        // Line-count limit (or offset window) bounded the output, chars did not.
        content += `\n\n(Showing lines ${startLine}-${realLastShown} of ${total}. Use offset=${realLastShown + 1} to continue reading.)`;
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
}

/** Default-limits Read tool (50000 total / 2000 per line). */
export const readTool: BuiltinTool = createReadTool();
