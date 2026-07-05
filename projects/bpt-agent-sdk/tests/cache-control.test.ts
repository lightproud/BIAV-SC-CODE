/**
 * Regression tests for the prompt-caching request shaper (cache-control.ts)
 * and the project .mcp.json loader (project-config.ts).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyCacheControl } from '../src/engine/cache-control.js';
import { loadProjectMcpServers } from '../src/mcp/project-config.js';
import type { StreamRequest } from '../src/internal/contracts.js';
import type {
  APIMessageParam,
  APIToolDefinition,
  ContentBlockParam,
  TextBlockParam,
} from '../src/types.js';

function baseReq(overrides: Partial<StreamRequest> = {}): StreamRequest {
  return {
    model: 'claude-test-1',
    max_tokens: 1024,
    system: 'You are helpful.',
    messages: [{ role: 'user', content: 'hello' }],
    ...overrides,
  };
}

/** Count every cache_control breakpoint anywhere in the request. */
function countBreakpoints(req: StreamRequest): number {
  let n = 0;
  if (Array.isArray(req.tools)) {
    for (const t of req.tools) if (t.cache_control) n += 1;
  }
  if (Array.isArray(req.system)) {
    for (const b of req.system) if (b.cache_control) n += 1;
  }
  for (const m of req.messages) {
    if (Array.isArray(m.content)) {
      for (const b of m.content) {
        if ((b as { cache_control?: unknown }).cache_control) n += 1;
      }
    }
  }
  return n;
}

describe('applyCacheControl', () => {
  it('returns the input unchanged when disabled (identity)', () => {
    const req = baseReq();
    const out = applyCacheControl(req, { enabled: false });
    expect(out).toBe(req);
  });

  it('converts a string system prompt into a cached text block', () => {
    const out = applyCacheControl(baseReq({ system: 'SYS' }), { enabled: true });
    expect(out.system).toEqual([
      { type: 'text', text: 'SYS', cache_control: { type: 'ephemeral' } },
    ]);
  });

  it('leaves an empty string system prompt untouched', () => {
    const out = applyCacheControl(baseReq({ system: '' }), { enabled: true });
    expect(out.system).toBe('');
  });

  it('caches only the last block of a TextBlockParam[] system, leaving earlier untouched', () => {
    const system: TextBlockParam[] = [
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
    ];
    const out = applyCacheControl(baseReq({ system }), { enabled: true });
    const blocks = out.system as TextBlockParam[];
    expect(blocks[0].cache_control).toBeUndefined();
    expect(blocks[1].cache_control).toEqual({ type: 'ephemeral' });
    // input array untouched
    expect(system[1].cache_control).toBeUndefined();
    expect(out.system).not.toBe(system);
  });

  it("cacheSystemBoundary:'first' caches the STABLE prefix block, not the cwd tail", () => {
    // The engine's [stable, volatile-cwd] split: the breakpoint must land on
    // block 0 so the per-run cwd tail (block 1) stays out of the cached prefix.
    const system: TextBlockParam[] = [
      { type: 'text', text: 'stable tools+guidance prefix' },
      { type: 'text', text: 'Working directory: /tmp/run-xyz' },
    ];
    const out = applyCacheControl(baseReq({ system }), {
      enabled: true,
      cacheSystemBoundary: 'first',
    });
    const blocks = out.system as TextBlockParam[];
    expect(blocks[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(blocks[1].cache_control).toBeUndefined();
  });

  it("cacheSystemBoundary:'dual' caches BOTH base and project blocks, not the cwd tail", () => {
    // The engine's three-block [base, project, cwd] layout: block 0 (shared
    // base harness) and block 1 (per-project tail) each get a breakpoint —
    // two reusable segments — while block 2 (per-run cwd) stays uncached.
    const system: TextBlockParam[] = [
      { type: 'text', text: 'base harness prefix' },
      { type: 'text', text: '\n\n<system-reminder>project instructions</system-reminder>' },
      { type: 'text', text: 'Working directory: /tmp/run-xyz' },
    ];
    const out = applyCacheControl(baseReq({ system }), {
      enabled: true,
      cacheSystemBoundary: 'dual',
    });
    const blocks = out.system as TextBlockParam[];
    expect(blocks[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(blocks[1].cache_control).toEqual({ type: 'ephemeral' });
    expect(blocks[2].cache_control).toBeUndefined();
    // input array untouched
    expect(system[0].cache_control).toBeUndefined();
    expect(system[1].cache_control).toBeUndefined();
    expect(out.system).not.toBe(system);
  });

  it("cacheSystemBoundary:'dual' on a degenerate 2-block array only touches indices 0 and 1", () => {
    // The loop passes 'dual' SOLELY for the 3-block layout; document that on a
    // shorter array it caches whatever indices exist (0 and 1) and never reads
    // past the end. Identity/no-mutation of the input array still holds.
    const system: TextBlockParam[] = [
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
    ];
    const out = applyCacheControl(baseReq({ system }), {
      enabled: true,
      cacheSystemBoundary: 'dual',
    });
    const blocks = out.system as TextBlockParam[];
    expect(blocks).toHaveLength(2);
    expect(blocks[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(blocks[1].cache_control).toEqual({ type: 'ephemeral' });
    expect(system[0].cache_control).toBeUndefined();
    expect(system[1].cache_control).toBeUndefined();
    expect(out.system).not.toBe(system);
  });

  it('full dual request (tools + 3-block dual system + string last message) yields exactly 4 breakpoints, never more', () => {
    const tools: APIToolDefinition[] = [
      { name: 't1', input_schema: { type: 'object' } },
      { name: 't2', input_schema: { type: 'object' } },
    ];
    const system: TextBlockParam[] = [
      { type: 'text', text: 'base harness prefix' },
      { type: 'text', text: '\n\nproject tail' },
      { type: 'text', text: 'Working directory: /tmp/run-xyz' },
    ];
    const out = applyCacheControl(baseReq({ tools, system }), {
      enabled: true,
      cacheSystemBoundary: 'dual',
    });
    // tools(1) + system base+project(2) + last message(1) = 4, at the API cap.
    expect(countBreakpoints(out)).toBe(4);
    expect(countBreakpoints(out)).toBeLessThanOrEqual(4);
  });

  it('caches the last tool and does NOT mutate the passed-in tools array', () => {
    const tools: APIToolDefinition[] = [
      { name: 't1', input_schema: { type: 'object' } },
      { name: 't2', input_schema: { type: 'object' } },
    ];
    const out = applyCacheControl(baseReq({ tools }), { enabled: true });
    const outTools = out.tools as APIToolDefinition[];
    expect(outTools[0].cache_control).toBeUndefined();
    expect(outTools[1].cache_control).toEqual({ type: 'ephemeral' });
    // referential no-mutation check on the passed-in array
    expect(out.tools).not.toBe(tools);
    expect(tools[1].cache_control).toBeUndefined();
  });

  it('skips the tools breakpoint when tools is empty or undefined', () => {
    const outEmpty = applyCacheControl(baseReq({ tools: [] }), { enabled: true });
    expect(outEmpty.tools).toEqual([]);
    const outNone = applyCacheControl(baseReq({ tools: undefined }), { enabled: true });
    expect(outNone.tools).toBeUndefined();
  });

  it('caches a string last-message content as a single cached text block', () => {
    const out = applyCacheControl(baseReq(), { enabled: true });
    const last = out.messages[out.messages.length - 1];
    expect(last.content).toEqual([
      { type: 'text', text: 'hello', cache_control: { type: 'ephemeral' } },
    ]);
  });

  it('caches a text last block of an array message', () => {
    const content: ContentBlockParam[] = [
      { type: 'text', text: 'x' },
      { type: 'text', text: 'y' },
    ];
    const req = baseReq({ messages: [{ role: 'user', content }] });
    const out = applyCacheControl(req, { enabled: true });
    const outContent = (out.messages[0].content as ContentBlockParam[]);
    expect((outContent[1] as TextBlockParam).cache_control).toEqual({ type: 'ephemeral' });
    expect((outContent[0] as TextBlockParam).cache_control).toBeUndefined();
  });

  it('caches a tool_result last block', () => {
    const content: ContentBlockParam[] = [
      { type: 'tool_result', tool_use_id: 'tu1', content: 'ok' },
    ];
    const out = applyCacheControl(baseReq({ messages: [{ role: 'user', content }] }), {
      enabled: true,
    });
    const outContent = out.messages[0].content as ContentBlockParam[];
    expect((outContent[0] as { cache_control?: unknown }).cache_control).toEqual({
      type: 'ephemeral',
    });
  });

  it('caches an image last block', () => {
    const content: ContentBlockParam[] = [
      { type: 'image', source: { type: 'url', url: 'http://x/y.png' } },
    ];
    const out = applyCacheControl(baseReq({ messages: [{ role: 'user', content }] }), {
      enabled: true,
    });
    const outContent = out.messages[0].content as ContentBlockParam[];
    expect((outContent[0] as { cache_control?: unknown }).cache_control).toEqual({
      type: 'ephemeral',
    });
  });

  it('skips the message breakpoint when the last block is thinking/tool_use/redacted_thinking', () => {
    for (const content of [
      [{ type: 'thinking', thinking: 't', signature: 's' }] as ContentBlockParam[],
      [{ type: 'tool_use', id: 'u1', name: 'n', input: {} }] as ContentBlockParam[],
      [{ type: 'redacted_thinking', data: 'd' }] as ContentBlockParam[],
    ]) {
      const req = baseReq({ messages: [{ role: 'assistant', content }] });
      const out = applyCacheControl(req, { enabled: true });
      // last message unchanged (same reference passed through)
      expect(out.messages[0]).toBe(req.messages[0]);
    }
  });

  it('skips the message breakpoint when cacheMessages is false', () => {
    const req = baseReq();
    const out = applyCacheControl(req, { enabled: true, cacheMessages: false });
    expect(out.messages[0]).toBe(req.messages[0]);
    // but system is still cached
    expect(Array.isArray(out.system)).toBe(true);
  });

  it('never mutates the persisted history array (deep-equal before/after)', () => {
    const messages: APIMessageParam[] = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: [{ type: 'text', text: 'reply' }] },
      { role: 'user', content: [{ type: 'text', text: 'again' }] },
    ];
    const snapshot = structuredClone(messages);
    applyCacheControl(baseReq({ messages }), { enabled: true });
    expect(messages).toEqual(snapshot);
    expect(messages).not.toBe(snapshot); // sanity: distinct objects
  });

  it('places at most 3 breakpoints across tools/system/messages', () => {
    const tools: APIToolDefinition[] = [
      { name: 't1', input_schema: { type: 'object' } },
      { name: 't2', input_schema: { type: 'object' } },
    ];
    const system: TextBlockParam[] = [
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
    ];
    const out = applyCacheControl(baseReq({ tools, system }), { enabled: true });
    expect(countBreakpoints(out)).toBe(3);
  });

  it('passes through signal and unrelated fields untouched', () => {
    const controller = new AbortController();
    const out = applyCacheControl(
      baseReq({ signal: controller.signal, temperature: 0.5 }),
      { enabled: true },
    );
    expect(out.signal).toBe(controller.signal);
    expect(out.temperature).toBe(0.5);
    expect(out.model).toBe('claude-test-1');
    expect(out.max_tokens).toBe(1024);
  });
});

describe('loadProjectMcpServers', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bpt-mcp-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const noop = (): void => {};

  it('returns {} when settingSources is undefined', () => {
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { a: { command: 'x' } } }));
    expect(loadProjectMcpServers(dir, undefined, noop)).toEqual({});
  });

  it('returns {} when settingSources does not include project', () => {
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { a: { command: 'x' } } }));
    expect(loadProjectMcpServers(dir, ['user', 'local'], noop)).toEqual({});
  });

  it('parses mcpServers when project is enabled', () => {
    writeFileSync(
      join(dir, '.mcp.json'),
      JSON.stringify({ mcpServers: { alpha: { command: 'node', args: ['s.js'] } } }),
    );
    const out = loadProjectMcpServers(dir, ['project'], noop);
    expect(out).toEqual({ alpha: { command: 'node', args: ['s.js'] } });
  });

  it('returns {} silently when the file is missing', () => {
    const warnings: string[] = [];
    const out = loadProjectMcpServers(dir, ['project'], (m) => warnings.push(m));
    expect(out).toEqual({});
    expect(warnings).toEqual([]);
  });

  it('returns {} and warns on malformed JSON without throwing', () => {
    writeFileSync(join(dir, '.mcp.json'), '{ not valid json ');
    const warnings: string[] = [];
    const out = loadProjectMcpServers(dir, ['project'], (m) => warnings.push(m));
    expect(out).toEqual({});
    expect(warnings.length).toBe(1);
  });

  it('returns {} when mcpServers key is absent', () => {
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ other: 1 }));
    expect(loadProjectMcpServers(dir, ['project'], noop)).toEqual({});
  });

  it('warns and returns {} when mcpServers is not an object', () => {
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: 'nope' }));
    const warnings: string[] = [];
    const out = loadProjectMcpServers(dir, ['project'], (m) => warnings.push(m));
    expect(out).toEqual({});
    expect(warnings.length).toBe(1);
  });

  it('skips malformed server entries with a debug warn but keeps valid ones', () => {
    writeFileSync(
      join(dir, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          good: { command: 'node' },
          bad: 'string',
          alsoBad: [1, 2],
          nullish: null,
        },
      }),
    );
    const warnings: string[] = [];
    const out = loadProjectMcpServers(dir, ['project'], (m) => warnings.push(m));
    expect(Object.keys(out)).toEqual(['good']);
    expect(warnings.length).toBe(3);
  });
});
