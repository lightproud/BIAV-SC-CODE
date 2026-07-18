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
      // Y5-1 (audit r4): the F1 loop guard set followSymbolicLinks:false, but
      // with onlyFiles:true fast-glob ALSO drops symlinks that point to a
      // regular file (a non-followed symlink's dirent is a symlink, not a file),
      // so `config.yml -> config.dev.yml` vanished from results silently.
      // Enumerate with onlyFiles:false so those symlink entries survive the
      // filter, then keep only what RESOLVES to a regular file below. The loop
      // guard is unchanged: fast-glob still descends only entries whose dirent
      // isDirectory(), which a non-followed symlinked directory never is.
      onlyFiles: false,
      ignore: IGNORE_PATTERNS,
      stats: true,
      suppressErrors: true,
      // F1 (audit 2026-07-17): fast-glob follows directory symlinks by
      // default with NO cycle guard — a self-referential link returns the
      // same file dozens of times, and two sibling loop links blow up
      // enumeration to 2^depth (measured: >20s, and the AbortSignal is only
      // checked after the await, so the hang is uninterruptible). ripgrep
      // does not follow symlinks by default either; match that.
      followSymbolicLinks: false,
    });
    if (ctx.signal.aborted) throw new AbortError();

    // Keep regular files directly; for a symlink entry (never followed by
    // fast-glob above, so it cannot introduce a loop) resolve the target and
    // keep it only when it points to a regular file. A symlink's own lstat
    // mtime is meaningless for "newest first", so use the target's (Y5-1).
    const files: { path: string; mtimeMs: number }[] = [];
    for (const e of entries) {
      if (e.dirent.isFile()) {
        files.push({ path: e.path, mtimeMs: e.stats?.mtimeMs ?? 0 });
      } else if (e.dirent.isSymbolicLink()) {
        try {
          const target = await fs.stat(e.path);
          if (target.isFile()) {
            files.push({ path: e.path, mtimeMs: target.mtimeMs });
          }
        } catch {
          // Dangling / unreadable symlink: skip it.
        }
      }
    }
    if (ctx.signal.aborted) throw new AbortError();

    if (files.length === 0) {
      return { content: 'No files found' };
    }

    // Newest first, with a deterministic path tiebreak (V6-2, audit r4): mtime
    // alone left same-mtime files in fast-glob's filesystem-dependent
    // enumeration order, so the MAX_RESULTS cap dropped a DIFFERENT subset from
    // one run to the next. Breaking ties by path makes the capped listing
    // stable across runs.
    const sorted = files.sort((a, b) => {
      const d = b.mtimeMs - a.mtimeMs;
      if (d !== 0) return d;
      return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    });

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
