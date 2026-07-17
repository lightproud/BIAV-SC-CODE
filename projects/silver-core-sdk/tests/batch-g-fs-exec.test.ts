/**
 * Batch G regression suite (audit r2 2026-07-17): fs/exec hangs & corruption.
 *
 *  - F1 Glob/Grep symlink-loop guard (followSymbolicLinks off, ripgrep parity)
 *  - F2 CRLF-file multi-line Edit/MultiEdit adaptation
 *  - F3 special-file (FIFO/device) gates on Read/Edit/MultiEdit/Write
 *  - F4 BashOutput filter never tests a mid-line chunk fragment
 *  - F5 background shells replay the persistent cwd/env state
 *  - F6 Grep multiline detection and -o extraction scan the SAME text
 *  - F7 separator-bearing CLAUDE_CODE_GIT_BASH_PATH overrides are probed
 *  - F8 Write is atomic (tmp+rename), preserves mode, writes through symlinks
 *  - C3 a post-check input rewrite cannot smuggle dangerouslyDisableSandbox
 */

import { spawnSync } from 'node:child_process';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { globTool } from '../src/tools/glob.js';
import { grepTool } from '../src/tools/grep.js';
import { readTool } from '../src/tools/read.js';
import { editTool } from '../src/tools/edit.js';
import { multiEditTool } from '../src/tools/multiedit.js';
import { writeTool } from '../src/tools/write.js';
import {
  bashTool,
  withPersistentState,
  withStateReplay,
} from '../src/tools/bash.js';
import { bashOutputTool, createShellManager } from '../src/tools/shells.js';
import { resolvePosixShells } from '../src/tools/shell-resolve.js';
import { createToolDispatcher } from '../src/engine/tool-dispatch.js';
import type {
  BackgroundShell,
  BuiltinTool,
  ShellManager,
  ToolContext,
} from '../src/internal/contracts.js';
import type { SandboxContext } from '../src/types.js';

const posixIt = it.skipIf(process.platform === 'win32');

let sandboxes: string[] = [];

async function makeSandbox(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'batch-g-test-'));
  sandboxes.push(dir);
  return dir;
}

function makeCtx(cwd: string, extra: Partial<ToolContext> = {}): ToolContext {
  return {
    cwd,
    additionalDirectories: [],
    env: {},
    signal: new AbortController().signal,
    debug: () => {},
    ...extra,
  };
}

/** A ctx whose read-before-write gate is armed and already unlocks `abs`. */
function gatedCtx(cwd: string, abs: string, extra: Partial<ToolContext> = {}): ToolContext {
  return makeCtx(cwd, { readFilePaths: new Set([abs]), ...extra });
}

let sandbox: string;

beforeEach(async () => {
  sandboxes = [];
  sandbox = await makeSandbox();
});

afterEach(async () => {
  await Promise.all(sandboxes.map((d) => rm(d, { recursive: true, force: true })));
  sandboxes = [];
});

// ---------------------------------------------------------------------------
// F1: symlink loops must not hang or duplicate enumeration
// ---------------------------------------------------------------------------

describe('F1: Glob/Grep symlink-loop guard', () => {
  posixIt('Glob returns a file exactly once despite a self-referential dir symlink', async () => {
    await writeFile(path.join(sandbox, 'a.txt'), 'hello\n', 'utf8');
    await symlink('.', path.join(sandbox, 'loop'));

    const res = await globTool.execute({ pattern: '**/*.txt' }, makeCtx(sandbox));
    expect(res.isError).toBeFalsy();
    const lines = String(res.content).split('\n');
    expect(lines.filter((l) => l.endsWith('a.txt'))).toHaveLength(1);
  });

  posixIt('Glob/Grep terminate promptly on two sibling loop symlinks (2^depth blowup before)', async () => {
    // x/to_y -> ../y and y/to_x -> ../x: with symlink-following this pair
    // multiplies paths exponentially; the fix must finish within the test
    // timeout and find the file exactly once.
    await mkdir(path.join(sandbox, 'x'));
    await mkdir(path.join(sandbox, 'y'));
    await writeFile(path.join(sandbox, 'x', 'f.txt'), 'needle-F1\n', 'utf8');
    await symlink(path.join('..', 'y'), path.join(sandbox, 'x', 'to_y'));
    await symlink(path.join('..', 'x'), path.join(sandbox, 'y', 'to_x'));

    const g = await globTool.execute({ pattern: '**/*.txt' }, makeCtx(sandbox));
    expect(String(g.content).split('\n').filter((l) => l.endsWith('f.txt'))).toHaveLength(1);

    const r = await grepTool.execute(
      { pattern: 'needle-F1', output_mode: 'files_with_matches' },
      makeCtx(sandbox),
    );
    expect(String(r.content).split('\n').filter((l) => l.endsWith('f.txt'))).toHaveLength(1);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// F2: CRLF files must be editable with Read-shaped (LF) old_strings
// ---------------------------------------------------------------------------

describe('F2: CRLF multi-line edit adaptation', () => {
  it('Edit matches an LF-authored multi-line old_string against a CRLF file', async () => {
    const file = path.join(sandbox, 'crlf.txt');
    await writeFile(file, 'alpha\r\nbeta\r\ngamma\r\n', 'utf8');

    const res = await editTool.execute(
      { file_path: file, old_string: 'alpha\nbeta', new_string: 'ALPHA\nBETA' },
      gatedCtx(sandbox, file),
    );
    expect(res.isError).toBeFalsy();
    // The replacement is written in the FILE's line-ending style.
    expect(await readFile(file, 'utf8')).toBe('ALPHA\r\nBETA\r\ngamma\r\n');
  });

  it('Edit replace_all adapts every occurrence on a CRLF file', async () => {
    const file = path.join(sandbox, 'crlf-all.txt');
    await writeFile(file, 'a\r\nb\r\nz\r\na\r\nb\r\n', 'utf8');

    const res = await editTool.execute(
      { file_path: file, old_string: 'a\nb', new_string: 'c\nd', replace_all: true },
      gatedCtx(sandbox, file),
    );
    expect(res.isError).toBeFalsy();
    expect(await readFile(file, 'utf8')).toBe('c\r\nd\r\nz\r\nc\r\nd\r\n');
  });

  it('a raw CRLF-authored old_string still matches directly (no double conversion)', async () => {
    const file = path.join(sandbox, 'crlf-raw.txt');
    await writeFile(file, 'one\r\ntwo\r\n', 'utf8');

    const res = await editTool.execute(
      { file_path: file, old_string: 'one\r\ntwo', new_string: 'ONE\r\nTWO' },
      gatedCtx(sandbox, file),
    );
    expect(res.isError).toBeFalsy();
    expect(await readFile(file, 'utf8')).toBe('ONE\r\nTWO\r\n');
  });

  it('MultiEdit applies an LF-authored chain against a CRLF file', async () => {
    const file = path.join(sandbox, 'crlf-multi.txt');
    await writeFile(file, 'alpha\r\nbeta\r\ngamma\r\n', 'utf8');

    const res = await multiEditTool.execute(
      {
        file_path: file,
        edits: [
          { old_string: 'alpha\nbeta', new_string: 'ALPHA\nbeta' },
          { old_string: 'beta\ngamma', new_string: 'BETA\nGAMMA' },
        ],
      },
      gatedCtx(sandbox, file),
    );
    expect(res.isError).toBeFalsy();
    expect(await readFile(file, 'utf8')).toBe('ALPHA\r\nBETA\r\nGAMMA\r\n');
  });

  it('LF files are untouched by the adaptation (exact match still required)', async () => {
    const file = path.join(sandbox, 'lf.txt');
    await writeFile(file, 'alpha\nbeta\n', 'utf8');

    const miss = await editTool.execute(
      { file_path: file, old_string: 'alpha\r\nbeta', new_string: 'x' },
      gatedCtx(sandbox, file),
    );
    expect(miss.isError).toBe(true); // a CRLF needle on an LF file is a real miss
  });
});

// ---------------------------------------------------------------------------
// F3: special files must be refused, not read/edited/overwritten
// ---------------------------------------------------------------------------

describe('F3: non-regular-file gates', () => {
  posixIt('Read refuses a FIFO instead of blocking forever', async () => {
    const fifo = path.join(sandbox, 'pipe');
    expect(spawnSync('mkfifo', [fifo]).status).toBe(0);

    const res = await readTool.execute({ file_path: fifo }, makeCtx(sandbox));
    expect(res.isError).toBe(true);
    expect(String(res.content)).toContain('not a regular file');
  });

  posixIt('Read refuses a character device (size-0 cap bypass)', async () => {
    const res = await readTool.execute({ file_path: '/dev/null' }, makeCtx(sandbox));
    expect(res.isError).toBe(true);
    expect(String(res.content)).toContain('not a regular file');
  });

  posixIt('Edit / MultiEdit / Write refuse a FIFO', async () => {
    const fifo = path.join(sandbox, 'pipe2');
    expect(spawnSync('mkfifo', [fifo]).status).toBe(0);
    const ctx = gatedCtx(sandbox, fifo);

    const e = await editTool.execute(
      { file_path: fifo, old_string: 'a', new_string: 'b' },
      ctx,
    );
    expect(e.isError).toBe(true);
    expect(String(e.content)).toContain('not a regular file');

    const m = await multiEditTool.execute(
      { file_path: fifo, edits: [{ old_string: 'a', new_string: 'b' }] },
      ctx,
    );
    expect(m.isError).toBe(true);
    expect(String(m.content)).toContain('not a regular file');

    const w = await writeTool.execute({ file_path: fifo, content: 'x' }, ctx);
    expect(w.isError).toBe(true);
    expect(String(w.content)).toContain('not a regular file');
  });
});

// ---------------------------------------------------------------------------
// F4: BashOutput filter vs chunk-boundary line fragments
// ---------------------------------------------------------------------------

function fakeShellRec(over: Partial<BackgroundShell> = {}): BackgroundShell {
  return {
    id: 'bash_1',
    command: 'test',
    pid: 1,
    stdout: '',
    stdoutTruncated: false,
    stderr: '',
    stderrTruncated: false,
    cursorOut: 0,
    cursorErr: 0,
    status: 'running',
    killRequested: false,
    exitCode: null,
    exitSignal: null,
    kill: () => {},
    ...over,
  };
}

function fakeShellManager(rec: BackgroundShell): ShellManager {
  return {
    stateDir: '',
    spawnBackground: async () => ({ error: 'unused' }),
    get: (id) => (id === rec.id ? rec : undefined),
    kill: () => false,
    dispose: () => {},
  };
}

describe('F4: BashOutput filter holds back partial trailing lines', () => {
  it('a line split across polls is re-tested whole, never dropped', async () => {
    const rec = fakeShellRec({ stdout: 'ERR' }); // mid-line chunk boundary
    const ctx = makeCtx('/', { shells: fakeShellManager(rec) });

    const first = await bashOutputTool.execute(
      { bash_id: 'bash_1', filter: '^ERROR' },
      ctx,
    );
    expect(String(first.content)).toContain('(no new output)');
    expect(rec.cursorOut).toBe(0); // fragment NOT consumed

    rec.stdout += 'OR: boom\nnext'; // line completes (+ a new partial tail)
    const second = await bashOutputTool.execute(
      { bash_id: 'bash_1', filter: '^ERROR' },
      ctx,
    );
    expect(String(second.content)).toContain('ERROR: boom');
    expect(rec.cursorOut).toBe('ERROR: boom\n'.length); // tail 'next' held
  });

  it('a terminal shell consumes the unterminated final line', async () => {
    const rec = fakeShellRec({
      stdout: 'ERROR: last',
      status: 'completed',
      exitCode: 0,
    });
    const ctx = makeCtx('/', { shells: fakeShellManager(rec) });

    const res = await bashOutputTool.execute(
      { bash_id: 'bash_1', filter: '^ERROR' },
      ctx,
    );
    expect(String(res.content)).toContain('ERROR: last');
    expect(rec.cursorOut).toBe(rec.stdout.length);
  });

  it('unfiltered reads still consume everything immediately', async () => {
    const rec = fakeShellRec({ stdout: 'partial' });
    const ctx = makeCtx('/', { shells: fakeShellManager(rec) });

    const res = await bashOutputTool.execute({ bash_id: 'bash_1' }, ctx);
    expect(String(res.content)).toContain('partial');
    expect(rec.cursorOut).toBe(rec.stdout.length);
  });
});

// ---------------------------------------------------------------------------
// F5: background shells see the persistent cwd/env state (replay-only)
// ---------------------------------------------------------------------------

describe('F5: background persistent-state replay', () => {
  it('withStateReplay replays cwd/env but never captures back', () => {
    const wrapped = withStateReplay('echo hi', '/tmp/state');
    expect(wrapped).toContain('cd -- "$(cat "$__bpt_state/cwd")"');
    expect(wrapped).toContain('. "$__bpt_state/env"');
    expect(wrapped).not.toContain('trap'); // no EXIT-trap capture-back
    expect(wrapped).not.toContain('__bpt_persist');
    // The foreground wrapper still captures.
    expect(withPersistentState('echo hi', '/tmp/state')).toContain('trap __bpt_persist EXIT');
  });

  posixIt('a background command observes a prior foreground cd/export', async () => {
    const shells = createShellManager(() => {});
    try {
      await mkdir(path.join(sandbox, 'sub'));
      const ctx = makeCtx(sandbox, { shells, env: process.env as Record<string, string> });

      const fg = await bashTool.execute(
        { command: 'cd sub && export BATCHG_MARK=hello-f5' },
        ctx,
      );
      expect(fg.isError).toBeFalsy();

      const bg = await bashTool.execute(
        { command: 'echo "$BATCHG_MARK @ $(pwd)"', run_in_background: true },
        ctx,
      );
      expect(bg.isError).toBeFalsy();
      const id = /id: (bash_\d+)/.exec(String(bg.content))?.[1];
      expect(id).toBeDefined();

      // Poll until the background shell exits (bounded).
      const rec = shells.get(id!);
      expect(rec).toBeDefined();
      for (let i = 0; i < 100 && rec!.status === 'running'; i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(rec!.status).toBe('completed');
      expect(rec!.stdout).toContain('hello-f5');
      expect(rec!.stdout).toContain(`${path.join(sandbox, 'sub')}`);
    } finally {
      shells.dispose();
    }
  }, 15_000);
});

// ---------------------------------------------------------------------------
// F6: Grep multiline detection/extraction consistency on CRLF files
// ---------------------------------------------------------------------------

describe('F6: Grep multiline CRLF consistency', () => {
  it('an LF-separator pattern matches a CRLF file in multiline mode', async () => {
    const file = path.join(sandbox, 'ml.txt');
    await writeFile(file, 'foo\r\nbar\r\ntail\r\n', 'utf8');

    const content = await grepTool.execute(
      { pattern: 'foo\\nbar', path: file, multiline: true, output_mode: 'content' },
      makeCtx(sandbox),
    );
    expect(content.isError).toBeFalsy();
    expect(String(content.content)).toContain('foo');
    expect(String(content.content)).toContain('bar');
  });

  it('-o extraction agrees with detection (no silent zero-match file)', async () => {
    const file = path.join(sandbox, 'ml-o.txt');
    await writeFile(file, 'foo\r\nbar\r\n', 'utf8');

    const res = await grepTool.execute(
      {
        pattern: 'foo\\nbar',
        path: file,
        multiline: true,
        output_mode: 'content',
        '-o': true,
      },
      makeCtx(sandbox),
    );
    expect(res.isError).toBeFalsy();
    expect(String(res.content)).not.toBe('No matches found');
    expect(String(res.content)).toContain('foo\nbar');
  });

  it('a raw \\r\\n pattern no longer matches (normalized view is authoritative)', async () => {
    const file = path.join(sandbox, 'ml-raw.txt');
    await writeFile(file, 'foo\r\nbar\r\n', 'utf8');

    const res = await grepTool.execute(
      { pattern: 'foo\\r\\nbar', path: file, multiline: true, output_mode: 'content' },
      makeCtx(sandbox),
    );
    expect(String(res.content)).toBe('No matches found');
  });
});

// ---------------------------------------------------------------------------
// F7: separator-bearing overrides are probed (and pinned absolute)
// ---------------------------------------------------------------------------

describe('F7: CLAUDE_CODE_GIT_BASH_PATH relative-path probing', () => {
  it('a relative override WITH a separator is probed, resolved absolute on hit', () => {
    const resolved = path.resolve('tools/mybash');
    expect(
      resolvePosixShells(
        { CLAUDE_CODE_GIT_BASH_PATH: 'tools/mybash' },
        'linux',
        (p) => p === resolved,
      ),
    ).toEqual([resolved, 'bash', 'sh']);
  });

  it('a relative override WITH a separator that does not exist is dropped', () => {
    expect(
      resolvePosixShells(
        { CLAUDE_CODE_GIT_BASH_PATH: 'tools/mybash' },
        'linux',
        () => false,
      ),
    ).toEqual(['bash', 'sh']);
  });

  it('a bare-name override is still passed through for PATH resolution', () => {
    expect(
      resolvePosixShells({ CLAUDE_CODE_GIT_BASH_PATH: 'mybash' }, 'linux', () => false),
    ).toEqual(['mybash', 'bash', 'sh']);
  });
});

// ---------------------------------------------------------------------------
// F8: atomic Write
// ---------------------------------------------------------------------------

describe('F8: Write atomicity', () => {
  it('overwrites leave no tmp residue and preserve the file mode', async () => {
    const file = path.join(sandbox, 'atomic.txt');
    await writeFile(file, 'old', 'utf8');
    await chmod(file, 0o750);

    const res = await writeTool.execute(
      { file_path: file, content: 'new content' },
      gatedCtx(sandbox, file),
    );
    expect(res.isError).toBeFalsy();
    expect(await readFile(file, 'utf8')).toBe('new content');
    if (process.platform !== 'win32') {
      expect(((await stat(file)).mode & 0o777).toString(8)).toBe('750');
    }
    const leftovers = (await readdir(sandbox)).filter((n) => n.includes('.tmp'));
    expect(leftovers).toEqual([]);
  });

  posixIt('writing through a symlink updates the target, keeps the link a link', async () => {
    const real = path.join(sandbox, 'real.txt');
    const link = path.join(sandbox, 'link.txt');
    await writeFile(real, 'original', 'utf8');
    await symlink(real, link);

    const res = await writeTool.execute(
      { file_path: link, content: 'via link' },
      gatedCtx(sandbox, link),
    );
    expect(res.isError).toBeFalsy();
    expect(await readFile(real, 'utf8')).toBe('via link');
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
  });

  it('creating a new file still works (and registers as created)', async () => {
    const file = path.join(sandbox, 'fresh.txt');
    const res = await writeTool.execute(
      { file_path: file, content: 'hello' },
      makeCtx(sandbox),
    );
    expect(res.isError).toBeFalsy();
    expect(String(res.content)).toContain('Created new file');
    expect(await readFile(file, 'utf8')).toBe('hello');
  });
});

// ---------------------------------------------------------------------------
// C3: sandbox-escape flag smuggled by a post-check input rewrite
// ---------------------------------------------------------------------------

describe('C3: sandboxEscape decided from the FINAL input', () => {
  function makeDispatcher(opts: {
    updatedInput?: (input: Record<string, unknown>) => Record<string, unknown>;
    onCheck?: (sandboxEscape: boolean | undefined) => void;
  }) {
    const seen: Record<string, unknown>[] = [];
    const echoBash: BuiltinTool = {
      name: 'Bash',
      description: 'echo input',
      inputSchema: { type: 'object', properties: {} },
      readOnly: false,
      execute: async (input) => {
        seen.push(input);
        return { content: 'ok' };
      },
    };
    const sandboxCtx = {
      backend: 'bwrap',
      tmpDir: '/tmp',
      writablePaths: [],
      allowNetwork: true,
      allowEscape: true,
    } as unknown as SandboxContext;
    const debugMessages: string[] = [];
    const dispatcher = createToolDispatcher({
      deps: {
        builtinTools: new Map([['Bash', echoBash]]),
        mcp: {
          has: () => false,
          allTools: () => [],
          call: async () => {
            throw new Error('no MCP in this test');
          },
        } as never,
        hooks: {
          hasHooks: () => false,
          run: async () => {
            throw new Error('no hooks in this test');
          },
        } as never,
        permissions: {
          check: async (
            _name: string,
            input: Record<string, unknown>,
            checkOpts: { sandboxEscape?: boolean },
          ) => {
            opts.onCheck?.(checkOpts.sandboxEscape);
            return {
              decision: 'allow',
              updatedInput: opts.updatedInput ? opts.updatedInput(input) : input,
            };
          },
        } as never,
        toolContext: makeCtx('/', { sandbox: sandboxCtx }),
        debug: (m: string) => debugMessages.push(m),
      },
      sessionId: 'test-session',
      baseHookFields: { session_id: 'test-session', cwd: '/' },
      signal: new AbortController().signal,
      recordTool: () => {},
    });
    return { dispatcher, seen, debugMessages };
  }

  it('a rewrite that ADDS dangerouslyDisableSandbox after the check is stripped', async () => {
    const { dispatcher, seen, debugMessages } = makeDispatcher({
      updatedInput: (input) => ({ ...input, dangerouslyDisableSandbox: true }),
    });
    const outcome = await dispatcher.executeToolUse({
      type: 'tool_use',
      id: 'tu_1',
      name: 'Bash',
      input: { command: 'true' },
    });
    expect(outcome.result.is_error).toBeFalsy();
    expect(seen).toHaveLength(1);
    expect(seen[0]!['dangerouslyDisableSandbox']).toBeUndefined();
    expect(debugMessages.some((m) => m.includes('dropped dangerouslyDisableSandbox'))).toBe(true);
  });

  it('an up-front escape request still flows through as its own ask', async () => {
    let checkedEscape: boolean | undefined;
    const { dispatcher, seen } = makeDispatcher({
      onCheck: (v) => {
        checkedEscape = v;
      },
    });
    const outcome = await dispatcher.executeToolUse({
      type: 'tool_use',
      id: 'tu_2',
      name: 'Bash',
      input: { command: 'true', dangerouslyDisableSandbox: true },
    });
    expect(outcome.result.is_error).toBeFalsy();
    expect(checkedEscape).toBe(true); // the gate saw the escape ask
    expect(seen[0]!['dangerouslyDisableSandbox']).toBe(true); // and it survives
  });
});
