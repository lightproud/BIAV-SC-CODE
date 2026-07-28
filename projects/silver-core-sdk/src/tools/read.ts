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
  looksBinaryForDisplay,
  resolveAbs,
} from './fsutil.js';
import { READ_DESCRIPTION } from './descriptions.js';
import type { ReadOutput as ReadStructuredOutput } from '../types/tool-outputs.js';

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
 * Refuse a WHOLE-FILE read past this size and steer the caller to a bounded
 * read or to Grep — official Claude Code's `maxSizeBytes`, 262144 (256KB),
 * verified in the 2.1.220 binary (`QLi=262144`, `FileTooLargeError`; the
 * official value is additionally overridable by the `tengu_amber_wren` remote
 * feature gate, which this SDK has no equivalent of).
 *
 * Distinct from MAX_READ_BYTES above, which is an OOM guard at 50MB — 200x
 * looser, and therefore never the thing that stops a 30MB log from being pulled
 * into memory and then thrown away by the character cap. The two coexist on
 * purpose: this one is a STEERING limit ("that is not what Read is for"), that
 * one is a SURVIVAL limit ("this would kill the process").
 *
 * Bounded reads are exempt, which is the escape hatch the official text itself
 * names: the error says "Use offset and limit parameters to read specific
 * portions of the file", and the official tool description says "use offset and
 * limit for larger files". HONEST LIMIT on the reproduction: the official throw
 * site is gated on an internal `truncateOnByteLimit` flag whose exact wiring
 * per call path was not established here, so "offset or limit ⇒ allowed" is
 * reproduced from the stated contract rather than from the observed branch.
 */
const MAX_READ_FILE_BYTES = 262144;

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
function detectImageMediaType(
  buf: Buffer,
): 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | undefined {
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
export function createReadTool(rawLimits?: ReadLimits): BuiltinTool {
  // A NON-FINITE tunable (Number() over an unset env var yields NaN) does not
  // merely mis-size the cap — it DISABLES it: every `length > NaN` /
  // `running + addition > NaN` comparison in formatCatN is false, so the whole
  // window is emitted uncapped, untruncated and with no footer — the exact
  // context flood the total-char cap exists to bound. Drop such entries so the
  // `?? DEFAULT` fallbacks at both use sites apply (finite values, including
  // the deliberate 0 / MAX_SAFE_INTEGER ones, pass through unchanged).
  const limits: ReadLimits | undefined =
    rawLimits === undefined
      ? undefined
      : {
          ...(Number.isFinite(rawLimits.maxOutputChars)
            ? { maxOutputChars: rawLimits.maxOutputChars }
            : {}),
          ...(Number.isFinite(rawLimits.maxLineChars)
            ? { maxLineChars: rawLimits.maxLineChars }
            : {}),
        };
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
        // F3 (audit 2026-07-17): the directory check alone lets special files
        // through — reading a FIFO with no writer blocks FOREVER (and abort
        // cannot settle the pending fs read; only SIGKILL frees the process),
        // and a size-0 char device like /dev/zero slips past the byte-cap
        // pre-check into an unbounded read. Only regular files are readable.
        if (!st.isFile()) {
          return errorResult(
            `Read failed: "${abs}" is not a regular file (FIFO/device/socket); reading it could block indefinitely.`,
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
        // One string, referenced twice (JS strings are immutable and shared by
        // reference), so carrying the bytes in the structured result costs
        // nothing beyond the content block that already holds them.
        const base64 = buf.toString('base64');
        return {
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: imageMediaType,
                data: base64,
              },
            },
          ],
          // The `image` arm of the exported ReadOutput union was declared and
          // never emitted, so a consumer could not tell an image read from a
          // tool that produced nothing. `dimensions` stays ABSENT: it needs an
          // image decoder this SDK does not ship, and zeroed width/height would
          // read as "a 0x0 image" rather than "not measured".
          structuredOutput: {
            type: 'image',
            file: {
              base64,
              type: imageMediaType,
              originalSize: buf.length,
            },
          } satisfies ReadStructuredOutput,
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
        const base64 = buf.toString('base64'); // shared with the block below
        return {
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: base64,
              },
            },
          ],
          // The `pdf` arm, likewise declared and never emitted. Every field it
          // requires is a fact already in hand here.
          structuredOutput: {
            type: 'pdf',
            file: { filePath: abs, base64, originalSize: buf.length },
          } satisfies ReadStructuredOutput,
        };
      }

      // Z3-2 (audit r4): Read is non-destructive, so it uses the leading-window
      // sniff — a lone NUL deep in a large text log must NOT make the whole file
      // unreadable (the full-buffer looksBinary is reserved for the write-back
      // tools, where a stray NUL really would corrupt bytes on save).
      if (looksBinaryForDisplay(buf)) {
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

      // Whole-file read of an oversized TEXT file: refuse and steer, as official
      // Claude Code does at the same 256KB. Checked ONLY when neither offset nor
      // limit was given — a bounded read is the escape hatch the refusal text
      // itself names, so gating on the caller's intent (not on the file's size
      // alone) is what makes the advice actionable. Applied HERE, after the
      // image/PDF returns, not up in the stat block: offset/limit are text-only
      // knobs, so this steering refusal (whose advice is "use offset and limit")
      // must never reject an image or PDF — those routinely exceed 256KB and
      // have no page-slice/offset escape at all (audit wave5: a 300KB screenshot
      // was refused with text-pagination advice it could not act on).
      if (
        offsetRaw === undefined &&
        limitRaw === undefined &&
        buf.length > MAX_READ_FILE_BYTES
      ) {
        return errorResult(
          `Read failed: file content (${buf.length} bytes) exceeds maximum allowed size ` +
            `(${MAX_READ_FILE_BYTES} bytes). Use offset and limit parameters to read ` +
            `specific portions of the file, or search for specific content with Grep ` +
            `instead of reading the whole file.`,
        );
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
        //
        // The footer carries all THREE parts of the official banner, not just
        // the first (2026-07-27, keeper delivery note + keeper ruling on the
        // measured evidence). Reported symptom: one Read of a ~1500-line file
        // was followed by SIX consecutive auto-paged Reads that walked the file
        // to its end and pushed 300K+ chars into the context, with no sign of
        // the model deciding for itself when to stop.
        //
        // The diagnosis that a stated `offset=1301` is what caused it does NOT
        // survive checking: official Claude Code 2.1.220 states one too — its
        // auto-pagination banner reads "…Call Read with offset=${I+1}
        // limit=${I} for the next page, or Grep to find a specific section. Do
        // NOT answer from this page alone if the answer may be further in the
        // file." (extracted from the official npm linux-x64 artifact). What
        // this SDK was missing was the OTHER TWO parts: a cheaper alternative,
        // and the caution against answering off one page. A footer whose only
        // content is "here is the next page" leaves the model exactly one move.
        let footer =
          `\n\n(Showing lines ${startLine}-${realLastShown} of ${total}; ` +
          `output truncated at ${maxOutputChars} chars. ` +
          `Call Read with offset=${realLastShown + 1} for the next page, or use ` +
          `Grep to find a specific section. Do NOT answer from this page alone ` +
          `if the answer may be further in the file.)`;
        // §D: a big file — Grep is usually the better tool than paging through
        // it. The long-line precondition was dropped in the same pass: ordinary
        // source (TS/Lua/Python) rarely has rows past the 2000-char per-line
        // cap, so `truncatedLines > 0` was almost never true and the hint
        // effectively never fired — leaving paging as the only route the model
        // was ever shown. Size alone earns the hint; row width is beside the
        // point.
        if (buf.length > GREP_HINT_FILE_BYTES) {
          footer +=
            '\n(This file is large; consider the Grep tool to search it ' +
            'instead of reading page by page.)';
        }
        content += footer;
        return {
          content,
          structuredOutput: {
            type: 'text',
            file: {
              filePath: abs,
              content: fmt.text,
              numLines: shownLines,
              startLine,
              totalLines: total,
              truncatedByCharCap: true,
            },
          } satisfies ReadStructuredOutput,
        };
      } else if (realLastShown < total) {
        // Line-count limit (or offset window) bounded the output, chars did not.
        // Same wording as the char-cap branch above: the trigger differs, the
        // incentive it creates does not.
        content +=
          `\n\n(Showing lines ${startLine}-${realLastShown} of ${total}. ` +
          `Call Read with offset=${realLastShown + 1} for the next page, or use ` +
          `Grep to find a specific section. Do NOT answer from this page alone ` +
          `if the answer may be further in the file.)`;
      }
      return {
        content,
        structuredOutput: {
          type: 'text',
          file: {
            filePath: abs,
            content: fmt.text,
            numLines: shownLines,
            startLine,
            totalLines: total,
          },
        } satisfies ReadStructuredOutput,
      };
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
