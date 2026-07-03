/**
 * Built-in Write tool: create or overwrite a UTF-8 text file, creating
 * parent directories as needed.
 *
 * Input field names (file_path / content) are part of the compat surface —
 * hooks and permission rules match on them.
 */

import { Buffer } from 'node:buffer';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type {
  BuiltinTool,
  ToolContext,
  ToolResultPayload,
} from '../internal/contracts.js';
import { AbortError, isAbortError } from '../errors.js';
import { resolveWithin } from './fsutil.js';

function errorResult(message: string): ToolResultPayload {
  return { content: message, isError: true };
}

export const writeTool: BuiltinTool = {
  name: 'Write',
  description:
    'Write a UTF-8 text file to the local filesystem, creating parent ' +
    'directories as needed. Overwrites the file if it already exists. The ' +
    'path may be absolute or relative to the session working directory.',
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

      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content, { encoding: 'utf8', signal: ctx.signal });

      const bytes = Buffer.byteLength(content, 'utf8');
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
