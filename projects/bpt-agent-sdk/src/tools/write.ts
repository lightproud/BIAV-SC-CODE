/**
 * Built-in Write tool: create or overwrite a UTF-8 text file, creating
 * parent directories as needed.
 *
 * Input field names (file_path / content) are part of the compat surface —
 * hooks and permission rules match on them.
 */

import { Buffer } from 'node:buffer';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type {
  BuiltinTool,
  ToolContext,
  ToolResultPayload,
} from '../internal/contracts.js';
import { AbortError, isAbortError } from '../errors.js';
import { looksBinary, resolveWithin } from './fsutil.js';
import { WRITE_DESCRIPTION } from './descriptions.js';

function errorResult(message: string): ToolResultPayload {
  return { content: message, isError: true };
}

export const writeTool: BuiltinTool = {
  name: 'Write',
  description: WRITE_DESCRIPTION,
  readOnly: false,
  isFileEdit: true,
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Path of the file to write (absolute or cwd-relative).',
      },
      content: {
        type: 'string',
        description: 'Full text content to write to the file.',
      },
    },
    required: ['file_path', 'content'],
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
        return errorResult('Write failed: "file_path" must be a non-empty string.');
      }
      const content = input['content'];
      if (typeof content !== 'string') {
        return errorResult('Write failed: "content" must be a string.');
      }

      const resolved = resolveWithin(ctx.cwd, ctx.additionalDirectories, filePath);
      if (!resolved.ok) {
        return errorResult(`Write failed: ${resolved.reason}`);
      }
      const abs = resolved.abs;

      // Determine created-vs-overwritten before writing; reject directories.
      let existedBefore = false;
      try {
        const st = await stat(abs);
        if (st.isDirectory()) {
          return errorResult(
            `Write failed: "${abs}" is a directory; cannot write file content over it.`,
          );
        }
        existedBefore = true;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw e;
        }
      }

      // Read-before-write gate (E4): the official CLI refuses to overwrite an
      // existing file this session has not Read (new files pass; a prior Read
      // unlocks). Semantics + error text pinned live from the official arm
      // (L5 code-03 r1 vs r2; KD-L3-06). The error text is verbatim official.
      if (
        existedBefore &&
        ctx.readFilePaths !== undefined &&
        !ctx.readFilePaths.has(abs)
      ) {
        return errorResult(
          '<tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>',
        );
      }

      // Capture the pre-image BEFORE mutating so Query.rewindFiles() can
      // restore it (create -> null). Best-effort; the recorder never throws.
      //
      // The checkpoint blob pipeline stores/restores pre-images as UTF-8, so a
      // pre-image is only safe to record when it round-trips through UTF-8
      // losslessly. Reading a binary / non-UTF-8 file as UTF-8 would replace
      // invalid byte sequences with U+FFFD and rewind would then restore
      // mojibake instead of the original bytes. In that case we record NOTHING
      // (leaving the deliberately-written content in place on rewind) rather
      // than corrupt the file. A read failure on an existing file is likewise
      // NOT downgraded to preImage=null, since null would make rewind DELETE a
      // file whose pre-image we never captured.
      if (ctx.recordFileChange !== undefined) {
        if (!existedBefore) {
          ctx.recordFileChange(abs, null);
        } else {
          let buf: Buffer | undefined;
          try {
            buf = await readFile(abs);
          } catch {
            buf = undefined; // read failed -> do NOT record (never delete on rewind)
          }
          if (buf !== undefined) {
            const asText = buf.toString('utf8');
            const roundTrips = Buffer.from(asText, 'utf8').equals(buf);
            if (roundTrips && !looksBinary(buf)) {
              ctx.recordFileChange(abs, asText);
            } else {
              // Non-UTF-8 / binary existing file: cannot capture losslessly
              // through the UTF-8 blob pipeline; skip to avoid corrupting it.
              ctx.debug(
                `Write: skipping non-restorable checkpoint for binary/non-UTF-8 file ${abs}`,
              );
            }
          }
        }
      }

      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content, { encoding: 'utf8', signal: ctx.signal });

      const bytes = Buffer.byteLength(content, 'utf8');
      // The session knows the bytes it just wrote: register the path so a
      // follow-up Write (create-then-revise) does not self-block on the gate.
      // OUR chosen semantics - the pinned official evidence covers only the
      // read/unread/new branches (noted in docs/COMPAT.md).
      ctx.readFilePaths?.add(abs);
      ctx.debug(
        `Write: ${existedBefore ? 'overwrote' : 'created'} ${abs} (${bytes} bytes)`,
      );
      return {
        content: existedBefore
          ? `Overwrote existing file "${abs}" (${bytes} bytes written).`
          : `Created new file "${abs}" (${bytes} bytes written).`,
      };
    } catch (e) {
      if (isAbortError(e)) {
        throw new AbortError('Write was aborted');
      }
      return errorResult(`Write failed: ${(e as Error).message}`);
    }
  },
};
