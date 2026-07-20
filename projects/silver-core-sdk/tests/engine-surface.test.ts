/**
 * R6 engine surface declaration (SCS-REQ-REPOS-01 §3 R6).
 *
 * declareEngineSurface() is the load-time compat anchor for hot-updatable
 * capability layers: the engine's own version plus a deterministic
 * content-hash version per advertised built-in tool. A hash moves exactly
 * when the model-visible surface (description or schema) moves.
 */

import { describe, expect, it } from 'vitest';

import { SDK_VERSION } from '../src/version.js';
import { declareEngineSurface } from '../src/tools/index.js';

describe('declareEngineSurface', () => {
  it('reports the single-source engine version and a non-trivial tool list', () => {
    const decl = declareEngineSurface();
    expect(decl.engine).toBe(SDK_VERSION);
    expect(decl.tools.length).toBeGreaterThan(10);
    for (const t of decl.tools) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.version).toMatch(/^[0-9a-f]{12}$/);
    }
  });

  it('is deterministic: two calls declare byte-identical surfaces', () => {
    expect(declareEngineSurface()).toStrictEqual(declareEngineSurface());
  });

  it('tracks the actually-running set: the task-surface env gate flips it', () => {
    const tasks = declareEngineSurface({ env: {} });
    const todo = declareEngineSurface({ env: { CLAUDE_CODE_ENABLE_TASKS: '0' } });
    const names = (d: ReturnType<typeof declareEngineSurface>) =>
      d.tools.map((t) => t.name);
    expect(names(tasks)).toContain('TaskCreate');
    expect(names(tasks)).not.toContain('TodoWrite');
    expect(names(todo)).toContain('TodoWrite');
    expect(names(todo)).not.toContain('TaskCreate');
    // Tools present in BOTH sets keep the SAME version hash — the hash is a
    // content hash of the tool surface, not of the surrounding set.
    const shared = names(tasks).filter((n) => names(todo).includes(n));
    expect(shared.length).toBeGreaterThan(5);
    for (const n of shared) {
      expect(tasks.tools.find((t) => t.name === n)?.version).toBe(
        todo.tools.find((t) => t.name === n)?.version,
      );
    }
  });

  it('a surface change moves the hash: the sandbox-aware Bash form re-versions', () => {
    const plain = declareEngineSurface({ env: {} });
    const sandboxed = declareEngineSurface({
      env: {},
      sandbox: {
        enabled: true,
        allowNetwork: false,
        writablePaths: [],
        allowEscape: true,
        backend: {
          name: 'bwrap',
          wrap: (plan) => plan,
        },
      } as never,
    });
    const bashPlain = plain.tools.find((t) => t.name === 'Bash')?.version;
    const bashSandboxed = sandboxed.tools.find((t) => t.name === 'Bash')?.version;
    expect(bashPlain).toBeDefined();
    expect(bashSandboxed).toBeDefined();
    expect(bashSandboxed).not.toBe(bashPlain);
  });
});
