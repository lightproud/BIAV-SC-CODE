/**
 * G-SANDBOX — pluggable backend, spawn wiring, evidence, description gating,
 * and (behind bwrap) real isolation. Offline tests use a passthrough fake
 * backend; the real-bwrap block runs only where bubblewrap is available.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { BwrapBackend } from '../src/sandbox/bwrap.js';
import {
  planShellSpawn,
  resolveSandboxBackend,
} from '../src/sandbox/backend.js';
import { detectSandboxEvidence, sandboxFailureHint } from '../src/sandbox/evidence.js';
import { createBashTool } from '../src/tools/bash.js';
import { createBuiltinTools } from '../src/tools/index.js';
import { createShellManager } from '../src/tools/shells.js';
import {
  BASH_DESCRIPTION,
  BASH_SANDBOX_FRAGMENTS,
  buildBashSandboxNote,
} from '../src/tools/descriptions.js';
import type { SandboxBackend, SandboxContext, ToolContext } from '../src/types.js';
import type { ToolResultPayload } from '../src/internal/contracts.js';

// A passthrough fake: runs the real shell (so execute() works) but records
// every wrap() call and marks the env so the wrap is observable.
function makeFake(): SandboxBackend & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    name: 'fake',
    calls,
    wrap(req) {
      calls.push(req);
      return { command: req.shell, args: ['-c', req.command], env: { TMPDIR: req.tmpDir, BPT_SBX: '1' } };
    },
  };
}

function fakeCtx(overrides: Partial<SandboxContext> = {}): SandboxContext {
  return {
    backend: makeFake(),
    tmpDir: '/tmp/fake-sbx',
    writablePaths: ['/work'],
    allowNetwork: false,
    allowEscape: true,
    ...overrides,
  };
}

function makeCtx(cwd: string, overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    cwd,
    additionalDirectories: [],
    env: { ...process.env },
    signal: new AbortController().signal,
    debug: () => {},
    ...overrides,
  };
}

function content(p: ToolResultPayload): string {
  return typeof p.content === 'string' ? p.content : JSON.stringify(p.content);
}

// ---------------------------------------------------------------------------
// T1 — resolver
// ---------------------------------------------------------------------------

describe('resolveSandboxBackend', () => {
  const yes = () => true;
  const no = () => false;
  it('sandbox:false -> null', () => {
    expect(resolveSandboxBackend(false, () => {}, yes, 'linux')).toBeNull();
  });
  it('{enabled:false} -> null', () => {
    expect(resolveSandboxBackend({ enabled: false }, () => {}, yes, 'linux')).toBeNull();
  });
  it('an injected backend wins verbatim', () => {
    const fake = makeFake();
    expect(resolveSandboxBackend({ backend: fake }, () => {}, no, 'win32')).toBe(fake);
  });
  it('linux + bwrap present -> BwrapBackend', () => {
    expect(resolveSandboxBackend(undefined, () => {}, yes, 'linux')?.name).toBe('bwrap');
  });
  it('linux + no bwrap -> null (honest degrade)', () => {
    let msg = '';
    expect(resolveSandboxBackend(undefined, (m) => (msg = m), no, 'linux')).toBeNull();
    expect(msg).toContain('UNSANDBOXED');
  });
  it('non-linux -> null even if the probe would pass', () => {
    expect(resolveSandboxBackend(undefined, () => {}, yes, 'win32')).toBeNull();
    expect(resolveSandboxBackend(undefined, () => {}, yes, 'darwin')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T2 — bwrap argv (pure)
// ---------------------------------------------------------------------------

describe('BwrapBackend.wrap (argv)', () => {
  const base = { shell: 'bash', command: 'echo hi', cwd: '/work', tmpDir: '/tmp/x', writablePaths: ['/work', '/data'] };
  it('assembles the ro-root + rw-binds + chdir + terminal shell', () => {
    const plan = new BwrapBackend().wrap({ ...base, allowNetwork: false });
    expect(plan.command).toBe('bwrap');
    expect(plan.args.slice(0, 8)).toEqual(['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--unshare-pid']);
    expect(plan.args).toContain('--unshare-net');
    // --bind-try (not --bind): a missing writable path is skipped, never bricks.
    expect(plan.args.join(' ')).toContain('--bind-try /work /work');
    expect(plan.args.join(' ')).toContain('--bind-try /data /data');
    expect(plan.args.slice(-6)).toEqual(['--chdir', '/work', '--', 'bash', '-c', 'echo hi']);
    expect(plan.args).toContain('--die-with-parent');
    expect(plan.env).toEqual({ TMPDIR: '/tmp/x' });
  });
  it('omits --unshare-net when network is allowed', () => {
    const plan = new BwrapBackend().wrap({ ...base, allowNetwork: true });
    expect(plan.args).not.toContain('--unshare-net');
  });
  it('dedupes repeated writable paths', () => {
    const plan = new BwrapBackend().wrap({ ...base, writablePaths: ['/work', '/work'], allowNetwork: false });
    expect(plan.args.join(' ').match(/--bind-try \/work \/work/g)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// T3/T4 — foreground wrap-through + default-on / disable
// ---------------------------------------------------------------------------

describe('planShellSpawn', () => {
  it('wraps through the backend when a sandbox is active', () => {
    const sbx = fakeCtx();
    const p = planShellSpawn('bash', 'echo hi', { cwd: '/work', sandbox: sbx }, false);
    expect(p.sandboxed).toBe(true);
    expect(p.envOverlay).toEqual({ TMPDIR: '/tmp/fake-sbx', BPT_SBX: '1' });
    expect((sbx.backend as ReturnType<typeof makeFake>).calls).toHaveLength(1);
  });
  it('does NOT wrap when disableSandbox is engaged', () => {
    const sbx = fakeCtx();
    const p = planShellSpawn('bash', 'echo hi', { cwd: '/work', sandbox: sbx }, true);
    expect(p.sandboxed).toBe(false);
    expect(p.command).toBe('bash');
    expect((sbx.backend as ReturnType<typeof makeFake>).calls).toHaveLength(0);
  });
  it('does NOT wrap when no sandbox is on the context', () => {
    const p = planShellSpawn('bash', 'echo hi', { cwd: '/work' }, false);
    expect(p.sandboxed).toBe(false);
  });
});

describe('Bash foreground execute over a fake backend', () => {
  it('runs wrapped: the sandbox env marker is visible', async () => {
    const sbx = fakeCtx();
    const tool = createBashTool(sbx);
    const res = await tool.execute({ command: 'echo "$BPT_SBX"' }, makeCtx('/tmp', { sandbox: sbx }));
    expect(content(res).trim()).toBe('1');
    expect((sbx.backend as ReturnType<typeof makeFake>).calls).toHaveLength(1);
  });
  it('mandatory mode refuses dangerouslyDisableSandbox (policy)', async () => {
    const sbx = fakeCtx({ allowEscape: false });
    const res = await createBashTool(sbx).execute(
      { command: 'echo hi', dangerouslyDisableSandbox: true },
      makeCtx('/tmp', { sandbox: sbx }),
    );
    expect(res.isError).toBe(true);
    expect(content(res)).toContain('disabled by policy');
    // the fake was never invoked AND the command did not run unsandboxed
    expect((sbx.backend as ReturnType<typeof makeFake>).calls).toHaveLength(0);
  });
  it('honors the escape when allowed: runs unsandboxed (fake not called)', async () => {
    const sbx = fakeCtx();
    const res = await createBashTool(sbx).execute(
      { command: 'echo hi', dangerouslyDisableSandbox: true },
      makeCtx('/tmp', { sandbox: sbx }),
    );
    expect(content(res).trim()).toBe('hi');
    expect((sbx.backend as ReturnType<typeof makeFake>).calls).toHaveLength(0);
  });
  it('no sandbox on the context: the escape flag is a no-op, not an error (E7-02)', async () => {
    const res = await createBashTool().execute(
      { command: 'echo hi', dangerouslyDisableSandbox: true },
      makeCtx('/tmp'),
    );
    expect(res.isError).not.toBe(true);
    expect(content(res).trim()).toBe('hi');
  });
});

// ---------------------------------------------------------------------------
// T6 — persistent state survives inside the sandbox (state dir writable)
// ---------------------------------------------------------------------------

describe('persistent cwd/env inside the sandbox', () => {
  it('cd + export from one call are visible in the next', async () => {
    const shells = createShellManager(() => {});
    const dir = mkdtempSync(join(tmpdir(), 'bpt-sbx-test-'));
    const sbx = fakeCtx({ writablePaths: [dir, shells.stateDir] });
    const ctx = makeCtx(dir, { shells, sandbox: sbx });
    try {
      await createBashTool(sbx).execute({ command: 'cd / && export FOO=silver42' }, ctx);
      const res = await createBashTool(sbx).execute({ command: 'pwd; echo "$FOO"' }, ctx);
      const out = content(res);
      expect(out).toContain('silver42');
    } finally {
      shells.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// T7 — evidence detection + hint
// ---------------------------------------------------------------------------

describe('detectSandboxEvidence', () => {
  it('matches fs signatures', () => {
    expect(detectSandboxEvidence(1, 'mkdir: Permission denied', false)).toBe('permission denied');
    expect(detectSandboxEvidence(1, 'touch: Read-only file system', false)).toBe('read-only file system');
  });
  it('matches network signatures only when network is isolated', () => {
    expect(detectSandboxEvidence(1, 'curl: (6) Could not resolve host', false)).toBe('could not resolve host');
    expect(detectSandboxEvidence(1, 'curl: (6) Could not resolve host', true)).toBeNull();
  });
  it('exit 0 is never evidence', () => {
    expect(detectSandboxEvidence(0, 'Permission denied', false)).toBeNull();
  });
  it('a non-signature failure is not evidence', () => {
    expect(detectSandboxEvidence(1, 'command not found', false)).toBeNull();
  });
});

describe('Bash surfaces the evidence hint on a sandboxed failure', () => {
  it('appends [sandbox] hint when a sandboxed command fails with a signature', async () => {
    const sbx = fakeCtx();
    const res = await createBashTool(sbx).execute(
      { command: 'echo "Permission denied" 1>&2; exit 1' },
      makeCtx('/tmp', { sandbox: sbx }),
    );
    expect(res.isError).toBe(true);
    expect(content(res)).toContain('[sandbox]');
    expect(content(res)).toContain('dangerouslyDisableSandbox: true');
  });
  it('does NOT append a hint on an unsandboxed failure', async () => {
    const res = await createBashTool().execute(
      { command: 'echo "Permission denied" 1>&2; exit 1' },
      makeCtx('/tmp'),
    );
    expect(content(res)).not.toContain('[sandbox]');
  });
  it('mandatory-mode hint points at settings, not the disabled param', () => {
    expect(sandboxFailureHint('permission denied', false)).toContain('disabled by policy');
    expect(sandboxFailureHint('permission denied', false)).not.toContain('retry with `dangerouslyDisableSandbox: true`');
  });
});

// ---------------------------------------------------------------------------
// T10 — description / schema gating (red line)
// ---------------------------------------------------------------------------

describe('Bash description + schema gating', () => {
  // E7-02: the escape param is ALWAYS in the schema (official parity); the
  // red-line gating now applies to the DESCRIPTION only. Runtime semantics per
  // state are covered by the execute() tests above/below.
  it('unsandboxed tool: description byte-identical + mentions no sandbox; schema keeps the (no-op) escape param', () => {
    const tool = createBashTool();
    expect(tool.description).toBe(BASH_DESCRIPTION);
    expect(tool.description.toLowerCase()).not.toContain('sandbox');
    expect(tool.inputSchema.properties).toHaveProperty('dangerouslyDisableSandbox');
  });
  it('createBuiltinTools() default Bash is byte-identical', () => {
    expect(createBuiltinTools().get('Bash')!.description).toBe(BASH_DESCRIPTION);
  });
  it('active sandbox: description carries the note + schema has the escape param', () => {
    const tool = createBashTool(fakeCtx());
    expect(tool.description).toContain(BASH_DESCRIPTION);
    // sandbox note is Chinese (i18n-zh batch 5); header + default-to-sandbox line
    expect(tool.description).toContain('# 沙箱');
    expect(tool.description).toContain('默认在沙箱内运行命令');
    expect(tool.inputSchema.properties).toHaveProperty('dangerouslyDisableSandbox');
  });
  it('mandatory mode: no retry fragment in the description; param stays in the schema (policy-refused at run time)', () => {
    const tool = createBashTool(fakeCtx({ allowEscape: false }));
    expect(tool.description).toContain('已按策略禁用');
    expect(tool.description).not.toContain('重试（不必询问');
    expect(tool.inputSchema.properties).toHaveProperty('dangerouslyDisableSandbox');
  });
  it('the four base params + the escape param form the full schema (official set)', () => {
    const props = createBashTool().inputSchema.properties ?? {};
    expect(Object.keys(props).sort()).toEqual([
      'command',
      'dangerouslyDisableSandbox',
      'description',
      'run_in_background',
      'timeout',
    ]);
  });
  it('network-open sandbox omits the network-failure evidence bullet (red line)', () => {
    const note = buildBashSandboxNote('default', true);
    // note is Chinese (i18n-zh batch 5); the network-restriction lines are gated
    expect(note).not.toContain('连接到非白名单主机的网络失败');
    expect(note).not.toContain('网络访问已禁用');
    expect(buildBashSandboxNote('default', false)).toContain('连接到非白名单主机的网络失败');
  });
});

// ---------------------------------------------------------------------------
// T9 — corpus-sync guard
// ---------------------------------------------------------------------------

describe('sandbox fragment provenance (corpus-sync guard)', () => {
  const archive = join(
    dirname(fileURLToPath(import.meta.url)),
    '..', '..', '..',
    'Public-Info-Pool', 'Reference', 'Claude-Code-System-Prompts', 'system-prompts',
  );
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const stripHeader = (md: string) => md.replace(/^<!--[\s\S]*?-->\n?/, '');

  it('coherence: every faithful fragment cites a concrete slug', () => {
    for (const f of BASH_SANDBOX_FRAGMENTS) {
      if (f.faithful) expect(f.slug.length, f.id).toBeGreaterThan(0);
    }
  });

  it.runIf(existsSync(archive))('every faithful fragment is verbatim in its archive file', () => {
    const drifted: string[] = [];
    for (const f of BASH_SANDBOX_FRAGMENTS) {
      if (!f.faithful) continue;
      const body = norm(stripHeader(readFileSync(join(archive, `${f.slug}.md`), 'utf8')));
      if (!body.includes(norm(f.text))) drifted.push(f.id);
    }
    expect(drifted, `drifted fragments: ${drifted.join(', ')}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T11 — real bwrap isolation (only where bubblewrap exists)
// ---------------------------------------------------------------------------

const hasBwrap = process.platform === 'linux' && (() => {
  try {
    return spawnSync('bwrap', ['--version'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
})();

describe('real bwrap isolation', () => {
  it.runIf(hasBwrap)('writes inside cwd succeed; writes outside fail with evidence', async () => {
    const work = mkdtempSync(join(tmpdir(), 'bpt-sbx-work-'));
    const outside = mkdtempSync(join(tmpdir(), 'bpt-sbx-out-'));
    const sbxTmp = mkdtempSync(join(tmpdir(), 'bpt-sbx-tmp-'));
    const sbx: SandboxContext = {
      backend: new BwrapBackend(),
      tmpDir: sbxTmp,
      writablePaths: [work, sbxTmp],
      allowNetwork: false,
      allowEscape: true,
    };
    const ctx = makeCtx(work, { sandbox: sbx });
    try {
      const okIn = await createBashTool(sbx).execute({ command: `touch "${work}/inside.txt" && echo ok` }, ctx);
      expect(content(okIn)).toContain('ok');
      expect(existsSync(join(work, 'inside.txt'))).toBe(true);

      const denied = await createBashTool(sbx).execute({ command: `touch "${outside}/nope.txt"` }, ctx);
      expect(denied.isError).toBe(true);
      expect(content(denied)).toContain('[sandbox]');
      expect(existsSync(join(outside, 'nope.txt'))).toBe(false);

      const tmp = await createBashTool(sbx).execute({ command: 'echo "$TMPDIR"' }, ctx);
      expect(content(tmp).trim()).toBe(sbxTmp);
    } finally {
      rmSync(work, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
      rmSync(sbxTmp, { recursive: true, force: true });
    }
  });

  it.runIf(hasBwrap)('network is unreachable when isolated', async () => {
    const work = mkdtempSync(join(tmpdir(), 'bpt-sbx-net-'));
    const sbx: SandboxContext = {
      backend: new BwrapBackend(),
      tmpDir: work,
      writablePaths: [work],
      allowNetwork: false,
      allowEscape: true,
    };
    try {
      const res = await createBashTool(sbx).execute(
        { command: 'getent hosts example.com || echo NETFAIL' },
        makeCtx(work, { sandbox: sbx }),
      );
      expect(content(res)).toContain('NETFAIL');
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});
