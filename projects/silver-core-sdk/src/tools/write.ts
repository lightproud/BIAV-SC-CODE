/**
 * Built-in Write tool: create or overwrite a UTF-8 text file, creating
 * parent directories as needed.
 *
 * Input field names (file_path / content) are part of the compat surface —
 * hooks and permission rules match on them.
 */

import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import {
  chmod,
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import * as path from 'node:path';
import type {
  BuiltinTool,
  ToolContext,
  ToolResultPayload,
} from '../internal/contracts.js';
import { AbortError, isAbortError } from '../errors.js';
import { looksBinary, resolveAbs } from './fsutil.js';
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

      const abs = resolveAbs(ctx.cwd, filePath);

      // Determine created-vs-overwritten before writing; reject directories.
      let existedBefore = false;
      let priorMode: number | undefined;
      try {
        const st = await stat(abs);
        if (st.isDirectory()) {
          return errorResult(
            `Write failed: "${abs}" is a directory; cannot write file content over it.`,
          );
        }
        // F3/F8 (audit 2026-07-17): writing "over" a FIFO/device/socket either
        // blocks forever (FIFO with no reader) or clobbers a device node; the
        // atomic rename below would silently REPLACE the special file. Refuse.
        if (!st.isFile()) {
          return errorResult(
            `Write failed: "${abs}" is not a regular file (FIFO/device/socket); refusing to write over it.`,
          );
        }
        existedBefore = true;
        priorMode = st.mode & 0o7777;
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

      // F8 (audit 2026-07-17): atomic write via tmp + rename. The old direct
      // O_TRUNC open destroyed the previous content the moment the file was
      // opened, so an abort/crash between open and write-complete left the
      // file EMPTY with no result reported (and, without a checkpoint, no
      // pre-image to recover from). Writing a sibling tmp file and renaming
      // it over the target makes the swap all-or-nothing: readers see either
      // the old content or the new, never a torn half. An existing SYMLINK
      // target is resolved first so the write still lands through the link
      // (rename would otherwise replace the link itself with a regular file).
      // Known tradeoff of rename-based atomicity: a multi-hard-link target
      // gets a fresh inode (the other links keep the old content).
      let target = abs;
      if (existedBefore) {
        try {
          target = await realpath(abs);
        } catch {
          target = abs; // best-effort; fall back to the literal path
        }
      }
      const tmp = path.join(
        path.dirname(target),
        `.${path.basename(target)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`,
      );
      try {
        await writeFile(tmp, content, {
          encoding: 'utf8',
          signal: ctx.signal,
          ...(priorMode !== undefined ? { mode: priorMode } : {}),
        });
        // Y5-2 (audit r4): writeFile's `mode` is masked by the process umask, so
        // under umask 022 a prior mode of 0o664 was recreated as 0o644 — the
        // group/other WRITE bits were stripped on every overwrite (compounded by
        // the atomic rename minting a fresh inode). chmod is NOT umask-masked, so
        // stamp the exact prior bits explicitly before the swap.
        if (priorMode !== undefined) await chmod(tmp, priorMode);
        await rename(tmp, target);
      } catch (e) {
        await unlink(tmp).catch(() => {});
        throw e;
      }

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
