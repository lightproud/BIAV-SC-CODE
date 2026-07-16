/**
 * audit 2026-07-14 M-2: shared ReDoS guard for model-supplied regexes.
 *
 * The nested-quantifier heuristic + pattern length cap moved from
 * hooks/matcher.ts into src/internal/regex-guard.ts and now also gates the
 * Grep pattern compilation and the BashOutput per-line `filter` — both run a
 * model-supplied pattern synchronously over bulk text (up to 10MB per file /
 * 500K chars of shell output), where catastrophic backtracking freezes the
 * event loop beyond the reach of any timeout or AbortSignal. A rejected
 * pattern surfaces as a descriptive tool ERROR result the model can rephrase,
 * never an uncaught throw. The hooks matcher's own behavior is unchanged
 * (regression suite in permissions-hooks.test.ts stays green).
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  guardRegexPattern,
  hasNestedQuantifier,
  MAX_REGEX_PATTERN_LENGTH,
} from '../src/internal/regex-guard.js';
import { grepTool } from '../src/tools/grep.js';
import { createShellManager, bashOutputTool } from '../src/tools/shells.js';
import { matcherMatches } from '../src/hooks/matcher.js';
import type { ShellManager, ToolContext } from '../src/internal/contracts.js';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let sandboxes: string[] = [];
let manager: ShellManager | undefined;

afterEach(async () => {
  manager?.dispose();
  manager = undefined;
  await Promise.all(sandboxes.map((d) => rm(d, { recursive: true, force: true })));
  sandboxes = [];
});

async function makeCorpus(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'regex-guard-'));
  sandboxes.push(dir);
  await writeFile(
    path.join(dir, 'a.ts'),
    'function greet(name) {\n  console.log.error("log fatal Error");\n}\nplain line\n',
  );
  return dir;
}

function makeCtx(cwd: string, withShells = false): ToolContext {
  if (withShells && manager === undefined) manager = createShellManager(() => {});
  return {
    cwd,
    additionalDirectories: [],
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    signal: new AbortController().signal,
    debug: () => {},
    ...(withShells ? { shells: manager } : {}),
  };
}

function contentOf(res: { content: unknown }): string {
  return typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
}

async function until(cond: () => boolean, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 10));
  }
}

// ---------------------------------------------------------------------------
// The shared guard itself
// ---------------------------------------------------------------------------

describe('internal/regex-guard: shared heuristic + length cap', () => {
  it.each([['(a+)+$'], ['(a*)+'], ['(a+)*'], ['((a+))+'], ['(a(b+))+'], ['(.*x)+'], ['(a+){2,}']])(
    'flags the catastrophic-backtracking signature %s',
    (pattern) => {
      expect(hasNestedQuantifier(pattern)).toBe(true);
      expect(guardRegexPattern(pattern)).toContain('nested quantifier');
    },
  );

  it.each([
    ['\\bfunction\\s+\\w+\\('], // escaped paren + linear repeats
    ['log.*Error'],
    ['(foo|bar)+'], // quantified group WITHOUT inner repeat is linear
    ['^mcp__'],
    ['Edit.*'],
    ['[a+]+'], // quantifier chars inside a class are literals
  ])('passes the safe real-world pattern %s', (pattern) => {
    expect(hasNestedQuantifier(pattern)).toBe(false);
    expect(guardRegexPattern(pattern)).toBeNull();
  });

  it('caps over-long patterns with a reason naming the cap', () => {
    const reason = guardRegexPattern('a'.repeat(MAX_REGEX_PATTERN_LENGTH + 1));
    expect(reason).toContain(String(MAX_REGEX_PATTERN_LENGTH));
    expect(guardRegexPattern('a'.repeat(MAX_REGEX_PATTERN_LENGTH))).toBeNull();
  });

  it('hooks matcher regression: guarded pattern still matches nothing, safe ones still work', () => {
    expect(matcherMatches('(a+)+$', 'a'.repeat(40) + 'b')).toBe(false);
    expect(matcherMatches('^mcp__', 'mcp__srv__tool')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Grep pattern compilation
// ---------------------------------------------------------------------------

describe('Grep rejects ReDoS-risky patterns as a tool error (audit 2026-07-14 M-2)', () => {
  it("rejects '(a+)+$' with a clear, rephrasable message and never throws", async () => {
    const dir = await makeCorpus();
    const r = await grepTool.execute({ pattern: '(a+)+$', path: dir }, makeCtx(dir));
    expect(r.isError).toBe(true);
    expect(contentOf(r)).toContain('unsafe regular expression rejected');
    expect(contentOf(r)).toContain('nested quantifier');
  });

  it('rejects the same pattern in multiline mode (guard sits before every compile)', async () => {
    const dir = await makeCorpus();
    const r = await grepTool.execute(
      { pattern: '(a+)+$', path: dir, multiline: true, output_mode: 'content' },
      makeCtx(dir),
    );
    expect(r.isError).toBe(true);
    expect(contentOf(r)).toContain('unsafe regular expression rejected');
  });

  it("moderately complex real patterns still work: '\\bfunction\\s+\\w+\\('", async () => {
    const dir = await makeCorpus();
    const r = await grepTool.execute(
      { pattern: '\\bfunction\\s+\\w+\\(', path: dir, output_mode: 'content' },
      makeCtx(dir),
    );
    expect(r.isError).toBeUndefined();
    expect(contentOf(r)).toContain('function greet(');
  });

  it("'log.*Error' still works", async () => {
    const dir = await makeCorpus();
    const r = await grepTool.execute(
      { pattern: 'log.*Error', path: dir, output_mode: 'content' },
      makeCtx(dir),
    );
    expect(r.isError).toBeUndefined();
    expect(contentOf(r)).toContain('log fatal Error');
  });

  it('a syntactically invalid pattern keeps its dedicated error message', async () => {
    const dir = await makeCorpus();
    const r = await grepTool.execute({ pattern: '(unclosed', path: dir }, makeCtx(dir));
    expect(r.isError).toBe(true);
    expect(contentOf(r)).toContain('invalid regular expression');
  });
});

// ---------------------------------------------------------------------------
// BashOutput filter
// ---------------------------------------------------------------------------

describe('BashOutput filter guard (audit 2026-07-14 M-2)', () => {
  it("rejects a '(a+)+$' filter with a clear error and does NOT advance the cursors", async () => {
    const dir = await makeCorpus();
    const ctx = makeCtx(dir, true);
    const launched = manager!.spawnBackground('bash', 'echo keep-me', ctx) as { id: string };
    const id = launched.id;
    await until(() => manager!.get(id)!.status !== 'running');

    const rejected = await bashOutputTool.execute({ bash_id: id, filter: '(a+)+$' }, ctx);
    expect(rejected.isError).toBe(true);
    expect(contentOf(rejected)).toContain('unsafe "filter" regular expression rejected');
    expect(contentOf(rejected)).toContain('nested quantifier');

    // The rejection happened BEFORE the read cursors advanced: a retry
    // without the bad filter still sees the output.
    const retry = await bashOutputTool.execute({ bash_id: id }, ctx);
    expect(contentOf(retry)).toContain('keep-me');
  });

  it('a normal filter still applies per line', async () => {
    const dir = await makeCorpus();
    const ctx = makeCtx(dir, true);
    const launched = manager!.spawnBackground(
      'bash',
      'echo keep-alpha; echo drop-beta',
      ctx,
    ) as { id: string };
    const id = launched.id;
    await until(() => manager!.get(id)!.status !== 'running');

    const read = await bashOutputTool.execute({ bash_id: id, filter: '^keep' }, ctx);
    expect(read.isError).toBeUndefined();
    expect(contentOf(read)).toContain('keep-alpha');
    expect(contentOf(read)).not.toContain('drop-beta');
  });
});
