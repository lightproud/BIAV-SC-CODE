/**
 * Glob built-in tool (module D).
 *
 * File pattern matching via fast-glob. Results are absolute paths sorted by
 * modification time (newest first), capped at 100 with a truncation note.
 */

import fg from 'fast-glob';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { AbortError } from '../errors.js';
import { GLOB_DESCRIPTION } from './descriptions.js';
import type {
  BuiltinTool,
  ToolContext,
  ToolResultPayload,
} from '../internal/contracts.js';

const MAX_RESULTS = 100;
const IGNORE_PATTERNS = ['**/node_modules/**', '**/.git/**'];

export const globTool: BuiltinTool = {
  name: 'Glob',
  description: GLOB_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'The glob pattern to match files against.',
      },
      path: {
        type: 'string',
        description:
          'The directory to search in (absolute or relative to the working ' +
          'directory). Defaults to the working directory.',
      },
    },
    required: ['pattern'],
  },
  readOnly: true,

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResultPayload> {
    const pattern = input['pattern'];
    if (typeof pattern !== 'string' || pattern.length === 0) {
      return {
        content: "Glob: 'pattern' must be a non-empty string.",
        isError: true,
      };
    }
    if (ctx.signal.aborted) throw new AbortError();

    const rawPath = input['path'];
    const baseDir = path.resolve(
      ctx.cwd,
      typeof rawPath === 'string' && rawPath.length > 0 ? rawPath : '.',
    );

    try {
      const st = await fs.stat(baseDir);
      if (!st.isDirectory()) {
        return {
          content: `Glob: path is not a directory: ${baseDir}`,
          isError: true,
        };
      }
    } catch {
      return {
        content: `Glob: directory does not exist: ${baseDir}`,
        isError: true,
      };
    }

    const entries = await fg(pattern, {
      cwd: baseDir,
      absolute: true,
      dot: false,
      onlyFiles: true,
      ignore: IGNORE_PATTERNS,
      stats: true,
      suppressErrors: true,
    });
    if (ctx.signal.aborted) throw new AbortError();

    if (entries.length === 0) {
      return { content: 'No files found' };
    }

    // Newest first; missing stats (shouldn't happen with stats:true) sink last.
    const sorted = entries
      .slice()
      .sort((a, b) => (b.stats?.mtimeMs ?? 0) - (a.stats?.mtimeMs ?? 0));

    const capped = sorted.slice(0, MAX_RESULTS);
    const lines = capped.map((e) => e.path);
    if (sorted.length > MAX_RESULTS) {
      lines.push(
        `(Results truncated: showing first ${MAX_RESULTS} of ${sorted.length} matches)`,
      );
    }
    return { content: lines.join('\n') };
  },
};
