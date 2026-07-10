/**
 * Public built-in tool metadata enumeration (black-pool ContextRing request
 * 2026-07-06). enumerateBuiltinToolMetadata is a zero-side-effect, read-only
 * projection of createBuiltinTools() — `{ name, description, inputJsonSchema }`
 * per tool, field-shaped like the SDK MCP tool metadata so a host can size the
 * built-in tool block through the same estimation path it uses for MCP tools.
 *
 * These tests pin: full coverage (every default tool), the exact metadata shape
 * (no `execute`/policy flags leak), field parity with createBuiltinTools'
 * inputSchema, the env task-surface gate, the sandbox Bash swap, and purity
 * (no filesystem / network / mutation).
 */

import { describe, expect, it } from 'vitest';

import {
  createBuiltinTools,
  enumerateBuiltinToolMetadata,
  type BuiltinToolMetadata,
} from '../src/tools/index.js';
import type { SandboxContext } from '../src/types.js';

/** Minimal valid sandbox context. `backend.wrap` is never invoked here —
 *  metadata enumeration only reads allowEscape/allowNetwork at construction. */
const STUB_SANDBOX: SandboxContext = {
  backend: {
    name: 'stub',
    wrap: () => {
      throw new Error('wrap must not be called during metadata enumeration');
    },
  },
  tmpDir: '/tmp/bpt-meta-test',
  writablePaths: [],
  allowNetwork: false,
  allowEscape: true,
};

describe('enumerateBuiltinToolMetadata', () => {
  it('enumerates every default built-in tool, 1:1 with createBuiltinTools', () => {
    const meta = enumerateBuiltinToolMetadata();
    const tools = createBuiltinTools();
    expect(meta).toHaveLength(tools.size);
    expect(meta.map((m) => m.name).sort()).toEqual([...tools.keys()].sort());
    // sanity floor: the default surface is well over a dozen tools
    expect(meta.length).toBeGreaterThanOrEqual(18);
  });

  it('returns exactly { name, description, inputJsonSchema } — no execute / policy flags leak', () => {
    for (const m of enumerateBuiltinToolMetadata()) {
      expect(Object.keys(m).sort()).toEqual(['description', 'inputJsonSchema', 'name']);
      expect(typeof m.name).toBe('string');
      expect(m.name.length).toBeGreaterThan(0);
      expect(typeof m.description).toBe('string');
      expect(m.description.length).toBeGreaterThan(0);
      expect(m.inputJsonSchema).toBeTypeOf('object');
      expect(m.inputJsonSchema).not.toBeNull();
      // no execution/policy surface bleeds through
      expect((m as Record<string, unknown>).execute).toBeUndefined();
      expect((m as Record<string, unknown>).readOnly).toBeUndefined();
      expect((m as Record<string, unknown>).inputSchema).toBeUndefined();
    }
  });

  it('inputJsonSchema is the same object as createBuiltinTools tool.inputSchema (renamed, not reshaped)', () => {
    const tools = createBuiltinTools();
    for (const m of enumerateBuiltinToolMetadata()) {
      const tool = tools.get(m.name)!;
      expect(m.description).toBe(tool.description);
      expect(m.inputJsonSchema).toBe(tool.inputSchema);
    }
  });

  it('shape matches the SDK MCP tool metadata field names (inputJsonSchema, not inputSchema)', () => {
    const [first] = enumerateBuiltinToolMetadata();
    // the whole reason for the rename: one host code path for both tool kinds
    expect(first).toHaveProperty('inputJsonSchema');
    expect(first).not.toHaveProperty('inputSchema');
  });

  describe('env task-surface gate', () => {
    it('default env -> the Task quartet, no TodoWrite', () => {
      const names = enumerateBuiltinToolMetadata({ env: {} }).map((m) => m.name);
      expect(names).toContain('TaskCreate');
      expect(names).toContain('TaskGet');
      expect(names).toContain('TaskUpdate');
      expect(names).toContain('TaskList');
      expect(names).not.toContain('TodoWrite');
    });

    it('CLAUDE_CODE_ENABLE_TASKS=0 -> TodoWrite, no Task quartet', () => {
      const names = enumerateBuiltinToolMetadata({
        env: { CLAUDE_CODE_ENABLE_TASKS: '0' },
      }).map((m) => m.name);
      expect(names).toContain('TodoWrite');
      expect(names).not.toContain('TaskCreate');
    });
  });

  it('sandbox swaps the Bash description for the sandbox-aware form', () => {
    const plain = enumerateBuiltinToolMetadata({ env: {} }).find((m) => m.name === 'Bash')!;
    const sandboxed = enumerateBuiltinToolMetadata({
      env: {},
      sandbox: STUB_SANDBOX,
    }).find((m) => m.name === 'Bash')!;
    // both exist; the sandbox form differs in its advertised description
    expect(plain.description).not.toBe(sandboxed.description);
  });

  it('is pure: repeated calls are structurally identical and mutate nothing shared', () => {
    const a = enumerateBuiltinToolMetadata({ env: {} });
    const b = enumerateBuiltinToolMetadata({ env: {} });
    expect(a.map((m) => m.name)).toEqual(b.map((m) => m.name));
    // mutating one result's array does not affect a fresh call
    a.pop();
    const c = enumerateBuiltinToolMetadata({ env: {} });
    expect(c.length).toBe(b.length);
  });

  it('is assignable to the exported BuiltinToolMetadata[] type', () => {
    const meta: BuiltinToolMetadata[] = enumerateBuiltinToolMetadata();
    expect(Array.isArray(meta)).toBe(true);
  });
});
