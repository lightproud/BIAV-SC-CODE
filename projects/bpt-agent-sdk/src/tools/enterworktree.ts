/**
 * EnterWorktree built-in tool (B4b batch).
 *
 * Official input (0.3.201 docs snapshot): `{ name?: string; path?: string }`,
 * mutually exclusive — "Creates and enters a temporary git worktree for
 * isolated work. Pass `path` to switch into an existing worktree of the
 * current repository instead of creating one."
 * Official output shape: `{ worktreePath, worktreeBranch?, message }`
 * (rendered as text lines here, like every builtin).
 *
 * Behavior in THIS SDK (git plumbing shared via src/internal/worktree.ts):
 *  - create (`name` or nothing): a new worktree at
 *    `<repoRoot>/.claude/worktrees/<name>` on a new branch `<name>`, branched
 *    from the current local HEAD (official `worktree.baseRef` setting is not
 *    shipped; HEAD is the documented base). A random name is generated when
 *    none is given. Creating while already in a worktree session is rejected
 *    (official requirement); enter the other worktree via `path` instead.
 *  - switch (`path`): the path must be a registered worktree of the current
 *    repository (`git worktree list`); anything else is rejected.
 *
 * "Enters" = the session working directory switches to the worktree:
 *  - `ctx.cwd` is mutated IN PLACE — the engine loop passes one shared
 *    ToolContext to every tool call (loop.ts executes builtins with
 *    `deps.toolContext`), so all subsequent tool calls this turn resolve
 *    against the worktree;
 *  - the Bash persistent-state cwd snapshot (`<stateDir>/cwd`, replayed by
 *    every foreground Bash call — see shells.ts / bash.ts
 *    withPersistentState) is rewritten, so Bash follows across turns too.
 *  KNOWN LIMIT (wiring point, out of this batch's file scope): query.ts
 *  rebuilds the ToolContext each turn from its query-level `cwd` variable
 *  (~line 1281), so non-Bash tools revert to the original cwd on the NEXT
 *  user turn until the host threads a session-mutable cwd there.
 *
 * The worktree session (original cwd + active worktree) is tracked per query
 * in a WeakMap keyed on the formal per-query `ctx.sessionKey` (audit
 * 2026-07-10 F6), falling back to the shared `readFilePaths` Set and then the
 * ToolContext itself for bare tool use.
 */

import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';

import type {
  BuiltinTool,
  ToolContext,
  ToolResultPayload,
} from '../internal/contracts.js';
import { AbortError } from '../errors.js';
import {
  addNamedWorktree,
  listWorktrees,
  repoToplevel,
  worktreeBranch,
} from '../internal/worktree.js';
import { ENTERWORKTREE_DESCRIPTION } from './descriptions.js';

/** Worktree-session state for one query. */
export type WorktreeSession = {
  /** cwd before the first EnterWorktree of the session. */
  originalCwd: string;
  /** The worktree the session is currently in. */
  dir: string;
  branch?: string;
  /** True when this session created the worktree (vs entered an existing one). */
  createdByThisSession: boolean;
};

const SESSIONS = new WeakMap<object, WorktreeSession>();

function sessionKey(ctx: ToolContext): object {
  // Formal per-query key first (audit 2026-07-10 F6); the readFilePaths
  // fallback keeps bare tool use (unit tests without a query) working.
  return ctx.sessionKey ?? ctx.readFilePaths ?? ctx;
}

/** Test/inspection hook: the current worktree session for a context, if any. */
export function peekWorktreeSession(ctx: ToolContext): WorktreeSession | undefined {
  return SESSIONS.get(sessionKey(ctx));
}

/** Valid `name`: path-safe single segment (no separators, no dot-dot). */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function errorResult(message: string): ToolResultPayload {
  return { content: `EnterWorktree failed: ${message}`, isError: true };
}

/**
 * Switch the session working directory: mutate the shared ToolContext in
 * place and rewrite the Bash persistent-state cwd snapshot (best-effort) so
 * foreground Bash calls replay into the worktree. See the module header for
 * the cross-turn wiring limit.
 */
function switchSessionCwd(ctx: ToolContext, dir: string): void {
  ctx.cwd = dir;
  if (ctx.shells !== undefined && ctx.shells.stateDir !== '') {
    try {
      writeFileSync(join(ctx.shells.stateDir, 'cwd'), dir);
    } catch {
      /* best-effort: Bash then keeps its previous persistent cwd */
    }
  }
}

function renderOutput(
  worktreePath: string,
  branch: string | undefined,
  message: string,
): ToolResultPayload {
  const lines = [`worktreePath: ${worktreePath}`];
  if (branch !== undefined) lines.push(`worktreeBranch: ${branch}`);
  lines.push(message);
  return { content: lines.join('\n') };
}

export const enterWorktreeTool: BuiltinTool = {
  name: 'EnterWorktree',
  description: ENTERWORKTREE_DESCRIPTION,
  readOnly: false, // creates directories/branches and redirects the session cwd
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description:
          'A name for a new worktree. If neither name nor path is provided, ' +
          'a random name is generated.',
      },
      path: {
        type: 'string',
        description:
          'Path to an existing worktree of the current repository to enter ' +
          'instead of creating a new one. Mutually exclusive with name.',
      },
    },
  },
  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResultPayload> {
    if (ctx.signal.aborted) throw new AbortError();

    const rawName = input['name'];
    const rawPath = input['path'];
    if (rawName !== undefined && rawPath !== undefined) {
      return errorResult('"name" and "path" are mutually exclusive.');
    }
    if (rawName !== undefined && (typeof rawName !== 'string' || rawName.length === 0)) {
      return errorResult('"name" must be a non-empty string.');
    }
    if (rawPath !== undefined && (typeof rawPath !== 'string' || rawPath.length === 0)) {
      return errorResult('"path" must be a non-empty string.');
    }

    const key = sessionKey(ctx);
    const existing = SESSIONS.get(key);

    // ---- switch into an existing worktree (`path`) --------------------------
    if (typeof rawPath === 'string') {
      const target = resolve(ctx.cwd, rawPath);
      const listed = await listWorktrees(ctx.cwd);
      if ('error' in listed) {
        return errorResult(`not inside a git repository (${listed.error.trim()}).`);
      }
      // The main checkout (first entry) is not an enterable "worktree".
      const [mainCheckout, ...others] = listed.paths;
      if (target === mainCheckout) {
        return errorResult(
          'the given path is the main repository checkout, not a worktree.',
        );
      }
      if (!others.includes(target)) {
        return errorResult(
          `"${target}" is not a registered worktree of the current repository ` +
            '(it must appear in `git worktree list`).',
        );
      }
      const branch = await worktreeBranch(target);
      const previousCwd = ctx.cwd;
      switchSessionCwd(ctx, target);
      SESSIONS.set(key, {
        originalCwd: existing?.originalCwd ?? previousCwd,
        dir: target,
        branch,
        createdByThisSession: false,
      });
      ctx.debug(`EnterWorktree: switched into existing worktree ${target}`);
      return renderOutput(
        target,
        branch,
        `Entered existing worktree. The session working directory is now ${target}.`,
      );
    }

    // ---- create a new worktree (`name` or generated) ------------------------
    if (existing !== undefined) {
      return errorResult(
        `already in a worktree session (${existing.dir}); creating a new ` +
          'worktree from inside one is not allowed. Pass "path" to switch ' +
          'into another existing worktree instead.',
      );
    }
    const name =
      typeof rawName === 'string' ? rawName : `wt-${randomBytes(4).toString('hex')}`;
    if (!NAME_RE.test(name)) {
      return errorResult(
        `invalid worktree name "${name}" (use letters, digits, ".", "_", "-"; no path separators).`,
      );
    }
    const top = await repoToplevel(ctx.cwd);
    if ('error' in top) {
      return errorResult(`not inside a git repository (${top.error.trim()}).`);
    }
    const created = await addNamedWorktree(top.dir, name);
    if ('error' in created) {
      return errorResult(`could not create the worktree: ${created.error.trim()}`);
    }
    const previousCwd = ctx.cwd;
    switchSessionCwd(ctx, created.dir);
    SESSIONS.set(key, {
      originalCwd: previousCwd,
      dir: created.dir,
      branch: created.branch,
      createdByThisSession: true,
    });
    ctx.debug(`EnterWorktree: created + entered worktree ${created.dir}`);
    return renderOutput(
      created.dir,
      created.branch,
      `Created and entered worktree "${name}" (branch ${created.branch}, ` +
        `branched from the current HEAD). The session working directory is now ${created.dir}.`,
    );
  },
};
