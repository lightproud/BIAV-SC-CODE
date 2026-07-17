/**
 * MemoryStore contract test suite (spec R3 acceptance): a self-contained,
 * framework-free checker any MemoryStore implementation can be run through.
 * The SDK's own vitest run drives it against the built-in stores; a hosting
 * application runs the SAME suite against its injected implementation
 * (`const report = await runMemoryStoreContractSuite(() => makeMyStore())`)
 * — passing it is the definition of contract compliance.
 *
 * Every check receives a FRESH, EMPTY store from the factory, so checks are
 * order-independent and a partially-failing implementation still yields a
 * full report. Assertions are byte-exact on the reference strings from the
 * official memory-tool docs, and structural (size field tolerated) where a
 * value is legitimately backend-dependent (directory entry sizes).
 */

import type { MemoryStore } from '../../internal/contracts.js';

/** Same-file sentinel: a contract-check failure report (never crosses the
 *  suite boundary — runMemoryStoreContractSuite catches it into the report). */
class ContractCheckFailure extends Error {
  override name = 'ContractCheckFailure';
}

export type MemoryStoreContractResult = {
  name: string;
  ok: boolean;
  /** Failure detail when ok is false. */
  error?: string;
};

export type MemoryStoreContractReport = {
  passed: boolean;
  total: number;
  failed: number;
  results: MemoryStoreContractResult[];
};

function assertEq(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new ContractCheckFailure(
      `${label}:\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`,
    );
  }
}

function assertMatch(actual: string, re: RegExp, label: string): void {
  if (!re.test(actual)) {
    throw new ContractCheckFailure(`${label}: ${re} did not match:\n  ${JSON.stringify(actual)}`);
  }
}

async function expectThrow(fn: () => Promise<unknown>, label: string): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return (e as Error).message;
  }
  throw new ContractCheckFailure(`${label}: expected an error, got success`);
}

type Check = { name: string; run: (store: MemoryStore) => Promise<void> };

const CHECKS: Check[] = [
  {
    name: 'create: success string',
    run: async (s) => {
      assertEq(
        await s.create('/memories/notes.txt', 'Hello World\n'),
        'File created successfully at: /memories/notes.txt',
        'create result',
      );
    },
  },
  {
    name: 'create: existing path returns the reference error',
    run: async (s) => {
      await s.create('/memories/notes.txt', 'one\n');
      const msg = await expectThrow(
        () => s.create('/memories/notes.txt', 'two\n'),
        'create-exists',
      );
      assertEq(msg, 'Error: File /memories/notes.txt already exists', 'create-exists message');
    },
  },
  {
    name: 'create: nested path creates parent directories',
    run: async (s) => {
      await s.create('/memories/a/b/deep.txt', 'x');
      assertEq(
        await s.view('/memories/a/b/deep.txt'),
        "Here's the content of /memories/a/b/deep.txt with line numbers:\n     1\tx",
        'nested create view',
      );
    },
  },
  {
    name: 'view: file content with 6-char right-aligned line numbers',
    run: async (s) => {
      await s.create('/memories/notes.txt', 'Hello World\nThis is line two');
      assertEq(
        await s.view('/memories/notes.txt'),
        "Here's the content of /memories/notes.txt with line numbers:\n" +
          '     1\tHello World\n     2\tThis is line two',
        'file view',
      );
    },
  },
  {
    name: 'view: view_range returns the requested lines with true numbering',
    run: async (s) => {
      await s.create('/memories/n.txt', 'l1\nl2\nl3\nl4\nl5');
      assertEq(
        await s.view('/memories/n.txt', [2, 3]),
        "Here's the content of /memories/n.txt with line numbers:\n     2\tl2\n     3\tl3",
        'view_range [2,3]',
      );
      assertEq(
        await s.view('/memories/n.txt', [4, -1]),
        "Here's the content of /memories/n.txt with line numbers:\n     4\tl4\n     5\tl5",
        'view_range [4,-1]',
      );
    },
  },
  {
    // Audit 2026-07-17 H2-5: a negative end other than -1 must be rejected,
    // not leak JS slice negative-index semantics (silently dropping tail
    // lines). An end beyond the file stays tolerated (clamped).
    name: 'view: invalid view_range values are rejected, not slice-wrapped',
    run: async (s) => {
      await s.create('/memories/vr.txt', 'l1\nl2\nl3\nl4\nl5');
      const negative = await expectThrow(
        () => s.view('/memories/vr.txt', [1, -3]),
        'view_range negative end',
      );
      assertEq(
        negative,
        'Error: Invalid `view_range` parameter: [1, -3]. It should be ' +
          '[start_line, end_line] with start_line within the range of lines of ' +
          'the file: [1, 5], and end_line >= start_line, or -1 for the end of the file.',
        'negative view_range message',
      );
      await expectThrow(() => s.view('/memories/vr.txt', [0, 2]), 'view_range start 0');
      await expectThrow(() => s.view('/memories/vr.txt', [3, 2]), 'view_range end < start');
      assertEq(
        await s.view('/memories/vr.txt', [4, 99]),
        "Here's the content of /memories/vr.txt with line numbers:\n     4\tl4\n     5\tl5",
        'view_range end beyond file clamps',
      );
    },
  },
  {
    name: 'view: missing path returns the reference message',
    run: async (s) => {
      const msg = await expectThrow(() => s.view('/memories/absent.txt'), 'view-missing');
      assertEq(
        msg,
        'The path /memories/absent.txt does not exist. Please provide a valid path.',
        'view-missing message',
      );
    },
  },
  {
    name: 'view: directory listing header, root line and tab-separated entries',
    run: async (s) => {
      await s.create('/memories/one.txt', 'a\n');
      await s.create('/memories/two.txt', 'bb\n');
      const out = await s.view('/memories');
      const lines = out.split('\n');
      assertEq(
        lines[0],
        "Here're the files and directories up to 2 levels deep in /memories, " +
          'excluding hidden items and node_modules:',
        'directory header',
      );
      assertMatch(lines[1] ?? '', /^\S+\t\/memories$/, 'root line');
      assertMatch(lines[2] ?? '', /^\S+\t\/memories\/one\.txt$/, 'entry one');
      assertMatch(lines[3] ?? '', /^\S+\t\/memories\/two\.txt$/, 'entry two');
      assertEq(lines.length, 4, 'directory listing line count');
    },
  },
  {
    name: 'view: directory listing is 2 levels deep, directories marked with /',
    run: async (s) => {
      await s.create('/memories/sub/inner.txt', 'x');
      await s.create('/memories/sub/deeper/toodeep.txt', 'y');
      const out = await s.view('/memories');
      assertMatch(out, /\t\/memories\/sub\/$/m, 'level-1 directory with trailing slash');
      assertMatch(out, /\t\/memories\/sub\/inner\.txt$/m, 'level-2 file listed');
      assertMatch(out, /\t\/memories\/sub\/deeper\/$/m, 'level-2 directory listed');
      if (/toodeep\.txt/.test(out)) {
        throw new ContractCheckFailure(`level-3 entry must not be listed:\n${out}`);
      }
    },
  },
  {
    name: 'view: hidden entries and node_modules are excluded',
    run: async (s) => {
      await s.create('/memories/.hidden.txt', 'h');
      await s.create('/memories/node_modules/pkg.txt', 'p');
      await s.create('/memories/shown.txt', 's');
      const out = await s.view('/memories');
      // The HEADER itself says "excluding hidden items and node_modules", so
      // only entry lines (starting at a path) may be checked.
      if (/\/memories\/\.hidden|\/memories\/node_modules/.test(out)) {
        throw new ContractCheckFailure(`hidden/node_modules leaked into listing:\n${out}`);
      }
      assertMatch(out, /\t\/memories\/shown\.txt$/m, 'visible entry still listed');
    },
  },
  {
    name: 'str_replace: success message with numbered snippet',
    run: async (s) => {
      await s.create('/memories/p.txt', 'l1\nl2\nFavorite color: blue\nl4\nl5');
      assertEq(
        await s.strReplace('/memories/p.txt', 'Favorite color: blue', 'Favorite color: green'),
        'The memory file has been edited. Here is the snippet showing the change ' +
          '(with line numbers):\n     1\tl1\n     2\tl2\n     3\tFavorite color: green\n' +
          '     4\tl4\n     5\tl5',
        'str_replace result',
      );
      assertMatch(
        await s.view('/memories/p.txt'),
        /Favorite color: green/,
        'str_replace persisted',
      );
    },
  },
  {
    name: 'str_replace: omitted new_str deletes old_str',
    run: async (s) => {
      await s.create('/memories/d.txt', 'keep DELETEME keep');
      await s.strReplace('/memories/d.txt', ' DELETEME', undefined);
      assertEq(
        await s.view('/memories/d.txt'),
        "Here's the content of /memories/d.txt with line numbers:\n     1\tkeep keep",
        'deletion persisted',
      );
    },
  },
  {
    name: 'str_replace: old_str not found returns the reference message',
    run: async (s) => {
      await s.create('/memories/p.txt', 'nothing here');
      const msg = await expectThrow(
        () => s.strReplace('/memories/p.txt', 'absent', 'x'),
        'str_replace-not-found',
      );
      assertEq(
        msg,
        'No replacement was performed, old_str `absent` did not appear verbatim in /memories/p.txt.',
        'not-found message',
      );
    },
  },
  {
    name: 'str_replace: multiple occurrences list their line numbers',
    run: async (s) => {
      await s.create('/memories/m.txt', 'dup\nother\ndup');
      const msg = await expectThrow(
        () => s.strReplace('/memories/m.txt', 'dup', 'x'),
        'str_replace-multiple',
      );
      assertEq(
        msg,
        'No replacement was performed. Multiple occurrences of old_str `dup` in lines: 1, 3. ' +
          'Please ensure it is unique',
        'multiple message',
      );
    },
  },
  {
    // Audit 2026-07-17 H2-1/H2-6: a per-line matcher can never find a
    // multi-line old_str; the contract requires full-content matching.
    name: 'str_replace: multi-line old_str replaces across lines',
    run: async (s) => {
      await s.create('/memories/ml.txt', 'l1\nAAA\nBBB\nl4');
      assertEq(
        await s.strReplace('/memories/ml.txt', 'AAA\nBBB', 'CCC'),
        'The memory file has been edited. Here is the snippet showing the change ' +
          '(with line numbers):\n     1\tl1\n     2\tCCC\n     3\tl4',
        'multi-line str_replace result',
      );
      assertEq(
        await s.view('/memories/ml.txt'),
        "Here's the content of /memories/ml.txt with line numbers:\n" +
          '     1\tl1\n     2\tCCC\n     3\tl4',
        'multi-line str_replace persisted',
      );
    },
  },
  {
    // Audit 2026-07-17 H2-2/H2-6: uniqueness counts OCCURRENCES, not lines —
    // two occurrences on one line must be rejected, listing the line twice.
    name: 'str_replace: same-line duplicate occurrences are rejected',
    run: async (s) => {
      await s.create('/memories/sd.txt', 'dup dup');
      const msg = await expectThrow(
        () => s.strReplace('/memories/sd.txt', 'dup', 'x'),
        'str_replace-same-line-dup',
      );
      assertEq(
        msg,
        'No replacement was performed. Multiple occurrences of old_str `dup` in lines: 1, 1. ' +
          'Please ensure it is unique',
        'same-line duplicate message',
      );
    },
  },
  {
    // Audit 2026-07-17 H2-4: empty old_str must be rejected consistently, not
    // silently prepend on single-line files.
    name: 'str_replace: empty old_str is rejected',
    run: async (s) => {
      await s.create('/memories/e.txt', 'one line');
      const msg = await expectThrow(
        () => s.strReplace('/memories/e.txt', '', 'x'),
        'str_replace-empty-old',
      );
      assertEq(
        msg,
        'No replacement was performed, old_str is empty. Provide the exact text to ' +
          'replace in /memories/e.txt.',
        'empty old_str message',
      );
      assertEq(
        await s.view('/memories/e.txt'),
        "Here's the content of /memories/e.txt with line numbers:\n     1\tone line",
        'file unchanged after rejected empty old_str',
      );
    },
  },
  {
    name: 'str_replace: missing file returns the reference message',
    run: async (s) => {
      const msg = await expectThrow(
        () => s.strReplace('/memories/none.txt', 'a', 'b'),
        'str_replace-missing',
      );
      assertEq(
        msg,
        'Error: The path /memories/none.txt does not exist. Please provide a valid path.',
        'missing message',
      );
    },
  },
  {
    name: 'insert: success message and insertion at line 0 / middle',
    run: async (s) => {
      await s.create('/memories/t.txt', 'a\nc');
      assertEq(
        await s.insert('/memories/t.txt', 1, 'b'),
        'The file /memories/t.txt has been edited.',
        'insert result',
      );
      assertEq(
        await s.view('/memories/t.txt'),
        "Here's the content of /memories/t.txt with line numbers:\n     1\ta\n     2\tb\n     3\tc",
        'insert middle persisted',
      );
      await s.insert('/memories/t.txt', 0, 'top');
      assertMatch(await s.view('/memories/t.txt'), /     1\ttop\n/, 'insert at 0');
    },
  },
  {
    name: 'insert: out-of-range line returns the reference message',
    run: async (s) => {
      await s.create('/memories/t.txt', 'a\nb');
      const msg = await expectThrow(() => s.insert('/memories/t.txt', 7, 'x'), 'insert-range');
      assertEq(
        msg,
        'Error: Invalid `insert_line` parameter: 7. It should be within the range of lines ' +
          'of the file: [0, 2]',
        'insert-range message',
      );
    },
  },
  {
    name: 'insert: missing file returns the reference message',
    run: async (s) => {
      const msg = await expectThrow(() => s.insert('/memories/no.txt', 0, 'x'), 'insert-missing');
      assertEq(msg, 'Error: The path /memories/no.txt does not exist', 'insert-missing message');
    },
  },
  {
    name: 'delete: success string, file really gone, directories recursive',
    run: async (s) => {
      await s.create('/memories/gone.txt', 'x');
      assertEq(
        await s.delete('/memories/gone.txt'),
        'Successfully deleted /memories/gone.txt',
        'delete result',
      );
      await expectThrow(() => s.view('/memories/gone.txt'), 'deleted file still viewable');
      await s.create('/memories/dir/a.txt', 'x');
      await s.create('/memories/dir/b/c.txt', 'y');
      assertEq(await s.delete('/memories/dir'), 'Successfully deleted /memories/dir', 'rm -r');
      await expectThrow(() => s.view('/memories/dir'), 'deleted dir still viewable');
    },
  },
  {
    name: 'delete: missing path / memory root return the reference errors',
    run: async (s) => {
      const missing = await expectThrow(() => s.delete('/memories/no.txt'), 'delete-missing');
      assertEq(missing, 'Error: The path /memories/no.txt does not exist', 'delete-missing message');
      await expectThrow(() => s.delete('/memories'), 'delete-root must be rejected');
    },
  },
  {
    name: 'rename: success string, source gone, destination readable',
    run: async (s) => {
      await s.create('/memories/draft.txt', 'text');
      assertEq(
        await s.rename('/memories/draft.txt', '/memories/final.txt'),
        'Successfully renamed /memories/draft.txt to /memories/final.txt',
        'rename result',
      );
      await expectThrow(() => s.view('/memories/draft.txt'), 'renamed source still viewable');
      assertMatch(await s.view('/memories/final.txt'), /\ttext$/m, 'destination content');
    },
  },
  {
    name: 'rename: missing source / existing destination / memory root',
    run: async (s) => {
      const missing = await expectThrow(
        () => s.rename('/memories/no.txt', '/memories/x.txt'),
        'rename-missing',
      );
      assertEq(missing, 'Error: The path /memories/no.txt does not exist', 'rename-missing message');
      await s.create('/memories/a.txt', '1');
      await s.create('/memories/b.txt', '2');
      const exists = await expectThrow(
        () => s.rename('/memories/a.txt', '/memories/b.txt'),
        'rename-exists',
      );
      assertEq(
        exists,
        'Error: The destination /memories/b.txt already exists',
        'rename-exists message',
      );
      await expectThrow(() => s.rename('/memories', '/memories/moved'), 'rename-root');
    },
  },
  {
    name: 'unicode content round-trips',
    run: async (s) => {
      await s.create('/memories/cjk.txt', '记忆层\n第二行');
      assertEq(
        await s.view('/memories/cjk.txt'),
        "Here's the content of /memories/cjk.txt with line numbers:\n     1\t记忆层\n     2\t第二行",
        'unicode view',
      );
    },
  },
];

/** Names of all contract checks (stable identifiers for reporting). */
export function memoryStoreContractCheckNames(): string[] {
  return CHECKS.map((c) => c.name);
}

/**
 * Run the full contract suite. `makeStore` must return a FRESH store over an
 * EMPTY memory root on every call.
 */
export async function runMemoryStoreContractSuite(
  makeStore: () => Promise<MemoryStore> | MemoryStore,
): Promise<MemoryStoreContractReport> {
  const results: MemoryStoreContractResult[] = [];
  for (const check of CHECKS) {
    try {
      const store = await makeStore();
      await check.run(store);
      results.push({ name: check.name, ok: true });
    } catch (e) {
      results.push({ name: check.name, ok: false, error: (e as Error).message });
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  return { passed: failed === 0, total: results.length, failed, results };
}
