/**
 * Memory path-traversal protection (spec R4 — release-gating security hard
 * constraint): the attack corpus every path parameter must reject, plus the
 * canonicalization contract for legal paths, plus proof that the TOOL layer
 * rejects traversal before an injected store is ever called.
 */

import { describe, expect, it } from 'vitest';

import {
  MEMORY_ROOT,
  MemoryPathError,
  validateMemoryPath,
} from '../src/tools/memory/index.js';
import { createMemoryTool } from '../src/tools/memory/memory-tool.js';
import type { MemoryStore } from '../src/types.js';
import type { ToolContext } from '../src/internal/contracts.js';

// ---------------------------------------------------------------------------
// Attack corpus (>= 15 variants per the spec's acceptance criterion)
// ---------------------------------------------------------------------------

const ATTACKS: Array<[label: string, path: unknown]> = [
  ['absolute path outside the root', '/etc/passwd'],
  ['relative path (no leading slash)', 'memories/notes.txt'],
  ['plain parent traversal', '/memories/../secrets.env'],
  ['bare .. segment', '/memories/..'],
  ['nested traversal escaping the root', '/memories/notes/../../escape.txt'],
  ['traversal hidden behind a legal segment', '/memories/ok/../../../etc/shadow'],
  ['single-dot segment', '/memories/./notes.txt'],
  ['url-encoded ../ (%2e%2e%2f)', '/memories/%2e%2e%2fescape'],
  ['url-encoded dots with real slash', '/memories/%2e%2e/escape'],
  ['uppercase url-encoding (%2E%2E%2F)', '/memories/%2E%2E%2Fescape'],
  ['double url-encoding (%252e%252e%252f)', '/memories/%252e%252e%252fescape'],
  ['backslash traversal', '/memories\\..\\escape'],
  ['mixed-separator traversal', '/memories/notes\\..\\up'],
  ['url-encoded backslash (%5c)', '/memories/%5c..%5cescape'],
  ['prefix smuggling (/memoriesX)', '/memoriesX/file.txt'],
  ['prefix smuggling via suffix dir', '/memories-evil/file.txt'],
  ['wrong-case root (/Memories)', '/Memories/notes.txt'],
  ['NUL byte', '/memories/a\0b'],
  ['url-encoded NUL (%00)', '/memories/a%00b'],
  ['empty string', ''],
  ['non-string (number)', 42],
  ['non-string (null)', null],
  ['encoded traversal before the root', '%2e%2e%2f/memories'],
];

describe('validateMemoryPath: attack corpus (R4)', () => {
  it.each(ATTACKS)('rejects %s', (_label, path) => {
    expect(() => validateMemoryPath(path)).toThrow(MemoryPathError);
  });

  it('the corpus meets the spec floor of 15 variants', () => {
    expect(ATTACKS.length).toBeGreaterThanOrEqual(15);
  });
});

describe('validateMemoryPath: canonicalization of legal paths', () => {
  it('accepts the memory root itself', () => {
    expect(validateMemoryPath('/memories')).toBe(MEMORY_ROOT);
  });

  it('accepts a plain file path unchanged', () => {
    expect(validateMemoryPath('/memories/notes.txt')).toBe('/memories/notes.txt');
  });

  it('collapses duplicate and trailing slashes', () => {
    expect(validateMemoryPath('/memories//a///b/')).toBe('/memories/a/b');
    expect(validateMemoryPath('/memories/')).toBe(MEMORY_ROOT);
  });

  it('accepts nested paths and unicode names', () => {
    expect(validateMemoryPath('/memories/sub/dir/记忆.md')).toBe('/memories/sub/dir/记忆.md');
  });

  it('decodes benign percent-encoding', () => {
    expect(validateMemoryPath('/memories/a%20b.txt')).toBe('/memories/a b.txt');
  });
});

// ---------------------------------------------------------------------------
// Tool layer: traversal never reaches an injected store (SDK does not
// delegate R4 to store implementations)
// ---------------------------------------------------------------------------

function poisonedStore(calls: string[]): MemoryStore {
  const record = (name: string) => {
    calls.push(name);
    return Promise.resolve('SHOULD NEVER SUCCEED');
  };
  return {
    view: () => record('view'),
    create: () => record('create'),
    strReplace: () => record('strReplace'),
    insert: () => record('insert'),
    delete: () => record('delete'),
    rename: () => record('rename'),
  };
}

function bareContext(): ToolContext {
  return {
    cwd: '/',
    additionalDirectories: [],
    env: {},
    signal: new AbortController().signal,
    debug: () => {},
  };
}

describe('memory tool: SDK-layer validation shields the store (R4)', () => {
  const traversal = '/memories/../../etc/passwd';

  it.each([
    ['view', { command: 'view', path: traversal }],
    ['create', { command: 'create', path: traversal, file_text: 'x' }],
    ['str_replace', { command: 'str_replace', path: traversal, old_str: 'a', new_str: 'b' }],
    ['insert', { command: 'insert', path: traversal, insert_line: 0, insert_text: 'x' }],
    ['delete', { command: 'delete', path: traversal }],
    ['rename (old_path)', { command: 'rename', old_path: traversal, new_path: '/memories/ok' }],
    ['rename (new_path)', { command: 'rename', old_path: '/memories/ok', new_path: traversal }],
  ])('%s rejects traversal before the store is called', async (_label, input) => {
    const calls: string[] = [];
    const tool = createMemoryTool(poisonedStore(calls));
    const result = await tool.execute(input as Record<string, unknown>, bareContext());
    expect(result.isError).toBe(true);
    expect(String(result.content)).toContain('escape');
    expect(calls).toEqual([]);
  });

  it('root delete / rename are rejected at the tool layer for custom stores', async () => {
    const calls: string[] = [];
    const tool = createMemoryTool(poisonedStore(calls));
    const del = await tool.execute({ command: 'delete', path: '/memories' }, bareContext());
    expect(del.isError).toBe(true);
    expect(del.content).toBe('Error: Cannot delete the /memories directory itself');
    const ren = await tool.execute(
      { command: 'rename', old_path: '/memories', new_path: '/memories/x' },
      bareContext(),
    );
    expect(ren.isError).toBe(true);
    expect(ren.content).toBe('Error: Cannot rename the /memories directory itself');
    expect(calls).toEqual([]);
  });
});
