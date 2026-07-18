/**
 * Audit r4 (2026-07-17) — tool-dispatch cluster regression locks
 * (report: Public-Info-Pool/Resource/repo-engineering/
 * silver-core-sdk-bug-audit-r4-20260717.md):
 *
 *  - Rtd-1: an embedded MCP resource with a BINARY blob (no text) is not
 *    flattened to a bare URI — a recognized image mimeType decodes to an
 *    image block; any other binary emits a marked placeholder (uri + mimeType).
 *  - Rtd-2: an empty MCP `{type:'text',text:''}` block is dropped rather than
 *    riding into the next request (the Anthropic API 400s on an empty block).
 *  - Rtd-3: a builtin returning `content:[]` is normalized to '' (an empty
 *    content array 400s the whole turn; the MCP path already collapses it).
 *  - Rtd-4: an abort inside a PreToolUse hook charges the perTool metric once
 *    (matching its S3 record); an abort caught at execute is NOT double-charged.
 *  - Rtd-5: the S3 record logs the input the tool ACTUALLY ran with after a
 *    hook/gate rewrite, not the raw block.input.
 *  - R7s-2: the S3 result_summary truncation never splits a surrogate pair.
 */

import { describe, expect, it } from 'vitest';

import { AbortError } from '../src/errors.js';
import { createToolDispatcher, mapMcpResult } from '../src/engine/tool-dispatch.js';
import type {
  BuiltinTool,
  ToolContext,
  ToolDispatchRecord,
} from '../src/internal/contracts.js';
import type { CallToolResult, ToolUseBlock } from '../src/types.js';

// A module-private sentinel for stubs that must never be reached (never
// `new Error(...)`, per the SDK's error discipline).
class StubError extends Error {}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    cwd: '/tmp',
    additionalDirectories: [],
    env: {},
    signal: new AbortController().signal,
    debug: () => {},
    ...overrides,
  };
}

function toolBlock(name: string, input: Record<string, unknown> = {}): ToolUseBlock {
  return { type: 'tool_use', id: 'tu_1', name, input };
}

type DispatcherStubs = {
  builtin?: BuiltinTool;
  hasHooks?: (event: string) => boolean;
  runHook?: () => Promise<unknown>;
  check?: (
    name: string,
    input: Record<string, unknown>,
    opts: Record<string, unknown>,
  ) => Promise<unknown>;
  recordTool?: (name: string, ms: number, isError: boolean) => void;
  onToolRecord?: (rec: ToolDispatchRecord) => void;
};

function makeDispatcher(stubs: DispatcherStubs) {
  const builtinMap = new Map<string, BuiltinTool>();
  if (stubs.builtin !== undefined) builtinMap.set(stubs.builtin.name, stubs.builtin);
  return createToolDispatcher({
    deps: {
      builtinTools: builtinMap,
      mcp: {
        has: () => false,
        allTools: () => [],
        call: async () => {
          throw new StubError('no MCP in this test');
        },
      } as never,
      hooks: {
        hasHooks: stubs.hasHooks ?? (() => false),
        run:
          stubs.runHook ??
          (async () => {
            throw new StubError('no hooks in this test');
          }),
      } as never,
      permissions: {
        check:
          stubs.check ??
          (async (_name: string, input: Record<string, unknown>) => ({
            decision: 'allow',
            updatedInput: input,
          })),
      } as never,
      toolContext: makeCtx(),
      debug: () => {},
    },
    sessionId: 'test-session',
    baseHookFields: { session_id: 'test-session', cwd: '/tmp' },
    signal: new AbortController().signal,
    recordTool: stubs.recordTool ?? (() => {}),
    onToolRecord: stubs.onToolRecord,
  });
}

// ---------------------------------------------------------------------------
// Rtd-1 / Rtd-2: mapMcpResult (pure)
// ---------------------------------------------------------------------------

describe('Rtd-1: embedded MCP resource blob is not flattened to a bare URI', () => {
  it('decodes a recognized image mimeType blob into an image block', () => {
    const res: CallToolResult = {
      content: [
        {
          type: 'resource',
          resource: { uri: 'file:///pic.png', mimeType: 'image/png', blob: 'QUJD' },
        },
      ],
    };
    expect(mapMcpResult(res)).toEqual({
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } },
      ],
      isError: false,
    });
  });

  it('marks a non-image binary blob with its uri + mimeType and drops the payload', () => {
    const res: CallToolResult = {
      content: [
        {
          type: 'resource',
          resource: { uri: 'file:///doc.pdf', mimeType: 'application/pdf', blob: 'QUJD' },
        },
      ],
    };
    const mapped = mapMcpResult(res);
    expect(mapped.content).toEqual([
      {
        type: 'text',
        text: '[resource file:///doc.pdf (application/pdf): binary contents omitted]',
      },
    ]);
    // The bare-URI regression flattened this to just the uri, losing both the
    // marker and the mimeType; the payload must never leak into the marker.
    expect(JSON.stringify(mapped)).not.toContain('QUJD');
  });

  it('still inlines an embedded text resource unchanged', () => {
    const res: CallToolResult = {
      content: [
        { type: 'resource', resource: { uri: 'file:///a.txt', text: 'hello world' } },
      ],
    };
    expect(mapMcpResult(res)).toEqual({
      content: [{ type: 'text', text: 'hello world' }],
      isError: false,
    });
  });
});

describe('Rtd-2: empty MCP text blocks are dropped', () => {
  it('an all-empty text result collapses to the empty-string content', () => {
    const res: CallToolResult = { content: [{ type: 'text', text: '' }] };
    expect(mapMcpResult(res)).toEqual({ content: '', isError: false });
  });

  it('an empty block is filtered but siblings survive', () => {
    const res: CallToolResult = {
      content: [
        { type: 'text', text: 'keep' },
        { type: 'text', text: '' },
        { type: 'text', text: 'me' },
      ],
    };
    expect(mapMcpResult(res)).toEqual({
      content: [
        { type: 'text', text: 'keep' },
        { type: 'text', text: 'me' },
      ],
      isError: false,
    });
  });

  it('an empty embedded-resource text block is also dropped', () => {
    const res: CallToolResult = {
      content: [{ type: 'resource', resource: { uri: 'file:///x', text: '' } }],
    };
    expect(mapMcpResult(res)).toEqual({ content: '', isError: false });
  });
});

// ---------------------------------------------------------------------------
// Rtd-3: builtin content:[] normalized to ''
// ---------------------------------------------------------------------------

describe('Rtd-3: a builtin empty content array is normalized to empty string', () => {
  it('content:[] becomes content:"" in the tool_result', async () => {
    const builtin: BuiltinTool = {
      name: 'Empty',
      description: 'returns an empty array',
      inputSchema: { type: 'object', properties: {} },
      readOnly: true,
      execute: async () => ({ content: [] }),
    };
    const dispatcher = makeDispatcher({ builtin });
    const outcome = await dispatcher.executeToolUse(toolBlock('Empty'));
    expect(outcome.result.content).toBe('');
    expect(outcome.result.is_error).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Rtd-4: abort metrics parity between hook-abort and execute-abort
// ---------------------------------------------------------------------------

describe('Rtd-4: an aborted dispatch charges the perTool metric exactly once', () => {
  const builtin: BuiltinTool = {
    name: 'T',
    description: 'x',
    inputSchema: { type: 'object', properties: {} },
    readOnly: true,
    execute: async () => ({ content: 'ok' }),
  };

  it('an abort inside a PreToolUse hook records once (was zero)', async () => {
    const recordCalls: Array<{ name: string; isError: boolean }> = [];
    const records: ToolDispatchRecord[] = [];
    const dispatcher = makeDispatcher({
      builtin,
      hasHooks: (event) => event === 'PreToolUse',
      runHook: async () => {
        throw new AbortError('aborted in hook');
      },
      recordTool: (name, _ms, isError) => recordCalls.push({ name, isError }),
      onToolRecord: (rec) => records.push(rec),
    });
    await expect(dispatcher.executeToolUse(toolBlock('T'))).rejects.toBeInstanceOf(AbortError);
    expect(recordCalls).toEqual([{ name: 'T', isError: true }]);
    expect(records).toHaveLength(1);
    expect(records[0]!.resultSummary).toBe('[aborted]');
    expect(records[0]!.status).toBe('error');
  });

  it('an abort caught at execute records once, not twice (no double-charge)', async () => {
    const recordCalls: Array<{ name: string; isError: boolean }> = [];
    const records: ToolDispatchRecord[] = [];
    const aborting: BuiltinTool = {
      name: 'T',
      description: 'x',
      inputSchema: { type: 'object', properties: {} },
      readOnly: true,
      execute: async () => {
        throw new AbortError('aborted in execute');
      },
    };
    const dispatcher = makeDispatcher({
      builtin: aborting,
      recordTool: (name, _ms, isError) => recordCalls.push({ name, isError }),
      onToolRecord: (rec) => records.push(rec),
    });
    await expect(dispatcher.executeToolUse(toolBlock('T'))).rejects.toBeInstanceOf(AbortError);
    expect(recordCalls).toEqual([{ name: 'T', isError: true }]);
    expect(records).toHaveLength(1);
    expect(records[0]!.resultSummary).toBe('[aborted]');
  });
});

// ---------------------------------------------------------------------------
// Rtd-5: S3 record logs the actually-executed (rewritten) input
// ---------------------------------------------------------------------------

describe('Rtd-5: the S3 record carries the rewritten input, not the raw block.input', () => {
  it('a gate updatedInput rewrite is reflected in the telemetry record', async () => {
    const seen: Record<string, unknown>[] = [];
    const records: ToolDispatchRecord[] = [];
    const builtin: BuiltinTool = {
      name: 'Echo',
      description: 'echo',
      inputSchema: { type: 'object', properties: {} },
      readOnly: true,
      execute: async (input) => {
        seen.push(input);
        return { content: 'ok' };
      },
    };
    const dispatcher = makeDispatcher({
      builtin,
      check: async (_name, input) => ({
        decision: 'allow',
        updatedInput: { ...input, rewritten: true },
      }),
      onToolRecord: (rec) => records.push(rec),
    });
    await dispatcher.executeToolUse(toolBlock('Echo', { original: 1 }));
    // The tool ran with the rewrite...
    expect(seen[0]).toEqual({ original: 1, rewritten: true });
    // ...and the audit record shows exactly that, not { original: 1 }.
    expect(records).toHaveLength(1);
    expect(records[0]!.input).toEqual({ original: 1, rewritten: true });
    expect(records[0]!.status).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// R7s-2: surrogate-safe result_summary truncation
// ---------------------------------------------------------------------------

describe('R7s-2: the S3 result_summary truncation never splits a surrogate pair', () => {
  it('an emoji straddling the 500-char cap is not left as a lone surrogate', async () => {
    // 499 'a's then a 2-unit emoji => UTF-16 index 500 lands mid-pair, the
    // exact bare-slice failure mode.
    const content = 'a'.repeat(499) + '\u{1F600}';
    const records: ToolDispatchRecord[] = [];
    const builtin: BuiltinTool = {
      name: 'Big',
      description: 'big output',
      inputSchema: { type: 'object', properties: {} },
      readOnly: true,
      execute: async () => ({ content }),
    };
    const dispatcher = makeDispatcher({
      builtin,
      onToolRecord: (rec) => records.push(rec),
    });
    await dispatcher.executeToolUse(toolBlock('Big'));
    expect(records).toHaveLength(1);
    const summary = records[0]!.resultSummary;
    expect(summary.endsWith('…[truncated]')).toBe(true);
    expect(LONE_SURROGATE.test(summary)).toBe(false);
    expect(summary).not.toContain('�');
  });
});
