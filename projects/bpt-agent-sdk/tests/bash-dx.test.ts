/**
 * Bash DX — Windows-cmd habit correction (BPT pilot incident 2026-07-06).
 *
 * Two layers under test (src/tools/bash.ts + src/tools/descriptions.ts):
 *   1. Error layer (all platforms): exit 127 + a cmd.exe-only FIRST command
 *      word appends a one-line POSIX correction to the error text. `dir` and
 *      `type` are deliberately NOT in the word list (`dir` is GNU coreutils,
 *      `type` is a bash builtin).
 *   2. Description layer (win32-gated): BASH_WIN32_NOTE is appended to the
 *      Bash description ONLY when the platform is win32 — same conditional
 *      assembly as the sandbox note; non-win32 descriptions are
 *      byte-identical (the conformance wire runs on Linux CI).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  bashTool,
  createBashTool,
  windowsCmdHint,
  withPersistentState,
} from '../src/tools/bash.js';
import { BASH_DESCRIPTION, BASH_WIN32_NOTE } from '../src/tools/descriptions.js';
import type { SandboxContext } from '../src/types.js';
import type {
  ToolContext,
  ToolResultPayload,
} from '../src/internal/contracts.js';

const HINT_MARKER = 'this shell is POSIX bash, not Windows cmd';

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'bpt-bash-dx-'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function makeCtx(cwd: string): ToolContext {
  return {
    cwd,
    additionalDirectories: [],
    env: { ...process.env },
    signal: new AbortController().signal,
    debug: () => {},
  };
}

/** Assert the payload content is a plain string and return it. */
function text(res: ToolResultPayload): string {
  expect(typeof res.content).toBe('string');
  return res.content as string;
}

async function makeDir(name: string): Promise<string> {
  const dir = path.join(root, name);
  await mkdir(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Error layer: exit-127 cmd-word correction
// ---------------------------------------------------------------------------

describe('Bash cmd-habit correction on exit 127', () => {
  it('appends the POSIX correction when a cmd-only word exits 127', async () => {
    const dir = await makeDir('cmd-copy');
    const res = await bashTool.execute({ command: 'copy a b' }, makeCtx(dir));
    expect(res.isError).toBe(true);
    const out = text(res);
    expect(out).toContain('exit code 127');
    expect(out).toContain(HINT_MARKER);
    expect(out).toContain('use cp/mv/rm/grep instead of copy/move/del/findstr');
  });

  it('does not append the correction on a non-127 failure', async () => {
    const dir = await makeDir('cmd-non127');
    const res = await bashTool.execute({ command: 'false' }, makeCtx(dir));
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('exit code 1');
    expect(text(res)).not.toContain(HINT_MARKER);
  });

  it('does not append the correction on 127 when the first word is not a cmd word', async () => {
    const dir = await makeDir('cmd-typo');
    const res = await bashTool.execute({ command: 'lls -la' }, makeCtx(dir));
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('exit code 127');
    expect(text(res)).not.toContain(HINT_MARKER);
  });

  it('leaves dir (GNU coreutils) untouched — deliberately NOT in the word list', async () => {
    const dir = await makeDir('cmd-dir');
    const res = await bashTool.execute({ command: 'dir .' }, makeCtx(dir));
    expect(res.isError).toBeFalsy();
    expect(text(res)).not.toContain(HINT_MARKER);
  });

  it('leaves type (bash builtin) untouched — deliberately NOT in the word list', async () => {
    const dir = await makeDir('cmd-type');
    const res = await bashTool.execute({ command: 'type echo' }, makeCtx(dir));
    expect(res.isError).toBeFalsy();
    expect(text(res)).toContain('echo');
    expect(text(res)).not.toContain(HINT_MARKER);
  });

  it('fires when the cmd word heads a && chain (127 propagates from the front)', async () => {
    const dir = await makeDir('cmd-chain');
    const res = await bashTool.execute(
      { command: 'copy a b && echo never' },
      makeCtx(dir),
    );
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('exit code 127');
    expect(text(res)).toContain(HINT_MARKER);
  });

  it('skips leading env assignments when extracting the first word', async () => {
    const dir = await makeDir('cmd-env');
    const res = await bashTool.execute(
      { command: 'FOO=1 findstr pattern file.txt' },
      makeCtx(dir),
    );
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('exit code 127');
    expect(text(res)).toContain(HINT_MARKER);
  });

  it('only inspects the very first word — a cmd word later in the line does not trigger it', () => {
    // Documented limitation (kept simple by design): the extractor looks at
    // the trimmed string's first segment only.
    expect(windowsCmdHint('echo hi; copy a b', 127)).toBe('');
  });

  describe('windowsCmdHint word list (unit)', () => {
    const cmdWords = [
      'copy',
      'move',
      'del',
      'erase',
      'xcopy',
      'robocopy',
      'findstr',
      'cls',
      'md',
      'rd',
      'ren',
    ];
    for (const word of cmdWords) {
      it(`hints on 127 for "${word}"`, () => {
        expect(windowsCmdHint(`${word} a b`, 127)).toContain(HINT_MARKER);
      });
    }
    it('matches case-insensitively (cmd habits often arrive uppercased)', () => {
      expect(windowsCmdHint('COPY a b', 127)).toContain(HINT_MARKER);
    });
    it('never hints for dir/type, on any exit code', () => {
      expect(windowsCmdHint('dir /w', 127)).toBe('');
      expect(windowsCmdHint('type file.txt', 127)).toBe('');
    });
    it('never hints on exit codes other than 127', () => {
      expect(windowsCmdHint('copy a b', 1)).toBe('');
      expect(windowsCmdHint('copy a b', 0)).toBe('');
      expect(windowsCmdHint('copy a b', null)).toBe('');
    });
  });
});

// ---------------------------------------------------------------------------
// Description layer: win32-gated platform note
// ---------------------------------------------------------------------------

describe('Bash description win32 platform note (gated assembly)', () => {
  const fakeSandbox: SandboxContext = {
    backend: { name: 'fake', wrap: (req) => ({ command: req.shell, args: ['-c', req.command] }) },
    tmpDir: '/tmp/fake',
    writablePaths: [],
    allowNetwork: false,
    allowEscape: true,
  };

  it('non-win32 platforms get the byte-identical base description', () => {
    expect(createBashTool(undefined, 'linux').description).toBe(BASH_DESCRIPTION);
    expect(createBashTool(undefined, 'darwin').description).toBe(BASH_DESCRIPTION);
    // The note text never leaks into the base description constant.
    expect(BASH_DESCRIPTION).not.toContain('Git Bash');
    expect(BASH_DESCRIPTION).not.toContain(BASH_WIN32_NOTE);
  });

  it('win32 appends BASH_WIN32_NOTE after the base description', () => {
    const desc = createBashTool(undefined, 'win32').description;
    expect(desc).toBe(BASH_DESCRIPTION + '\n\n' + BASH_WIN32_NOTE);
    expect(desc).toContain('POSIX bash (Git Bash)');
    expect(desc).toContain('forward slashes');
  });

  it('win32 + sandbox carries both the platform note and the sandbox note', () => {
    const desc = createBashTool(fakeSandbox, 'win32').description;
    expect(desc.startsWith(BASH_DESCRIPTION + '\n\n' + BASH_WIN32_NOTE)).toBe(true);
    expect(desc).toContain('# Sandbox');
  });

  it('sandbox without win32 stays exactly as before (no platform note)', () => {
    const desc = createBashTool(fakeSandbox, 'linux').description;
    expect(desc).not.toContain(BASH_WIN32_NOTE);
    expect(desc).toContain('# Sandbox');
  });
});

// BPT Windows incident 2026-07-08: mkdtemp returns a backslash path on Windows
// (C:\Users\…\bpt-shell-X); embedded verbatim into the wrapper, the backslashes
// corrupt the double-quoted "$__bpt_state/cwd" expansion, and every foreground
// Bash call fails with `cat: '"/cwd"': No such file` + exit 127. The fix
// forward-slashes the state dir for the SCRIPT form only.
describe('withPersistentState state-dir separator normalization (Windows)', () => {
  it('forward-slashes a Windows backslash state dir in the wrapper assignment', () => {
    const winDir = 'C:\\Users\\ASTERIA\\AppData\\Local\\Temp\\bpt-shell-PJ7Z1V';
    const script = withPersistentState('node -e "1"', winDir);
    // The assignment carries the normalized forward-slash path...
    expect(script).toContain(
      "__bpt_state='C:/Users/ASTERIA/AppData/Local/Temp/bpt-shell-PJ7Z1V'",
    );
    // ...and no backslash survives anywhere in the generated script (the state
    // path was the only source of them here).
    expect(script).not.toContain('\\');
  });

  it('leaves a POSIX forward-slash state dir untouched (no-op)', () => {
    const posixDir = '/tmp/bpt-shell-abc123';
    const script = withPersistentState('echo hi', posixDir);
    expect(script).toContain(`__bpt_state='${posixDir}'`);
  });

  it('preserves the replay/capture prologue and appends the command last', () => {
    const script = withPersistentState('node -e "1"', 'C:\\T\\bpt-shell-1');
    const lines = script.split('\n');
    // Assignment first, command last, EXIT trap wiring intact.
    expect(lines[0]).toBe("__bpt_state='C:/T/bpt-shell-1'");
    expect(lines[lines.length - 1]).toBe('node -e "1"');
    expect(script).toContain('trap __bpt_persist EXIT');
    // The double-quoted state references remain the variable form, not inlined.
    expect(script).toContain('"$__bpt_state/cwd"');
    expect(script).toContain('"$__bpt_state/env"');
  });
});
