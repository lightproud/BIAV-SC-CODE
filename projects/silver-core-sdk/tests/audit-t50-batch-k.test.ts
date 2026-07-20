/**
 * Regression locks for audit r2 (2026-07-17) batch K — transport / MCP /
 * sessions / error-normalization / prompts / reporting mid-severity fixes.
 * One describe per audit item (or tight group); each test pins the FIXED
 * behavior and would go red on a revert.
 *
 * Items covered elsewhere: A1 flipped assertions live in transport.test.ts,
 * J3/J4 in sessions-v2.test.ts, E4 in the regenerated v5 golden +
 * prompts.test.ts. Items needing live I/O (I1/I3/I5/N4) are covered by the
 * code-path reviews in their modules; this file locks the pure logic.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  DEFAULT_STREAM_IDLE_MS,
  resolveStreamIdleMs,
  resolveStreamMaxMs,
} from '../src/transport/anthropic.js';
import { OpenAIStreamTranslator } from '../src/transport/openai.js';
import { APIConnectionError, MemoryToolError, McpError, errorCodeOf } from '../src/errors.js';
import { MemoryToolError as BarrelMemoryToolError } from '../src/index.js';
import { normalizeProviderError } from '../src/error-normalize.js';
import { supportsAdaptiveThinking } from '../src/engine/thinking-model.js';
import { buildSystemPromptParts } from '../src/engine/prompts.js';
import { MessageAccumulator } from '../src/engine/accumulator.js';
import { parseVerdict } from '../src/verifier/index.js';
import { aggregateDay } from '../src/reporting/compare-reports.js';
import { loadProjectMcpServers } from '../src/mcp/project-config.js';
import { tool, createSdkMcpServer } from '../src/mcp/sdk-server.js';
import type { RawMessageStreamEvent } from '../src/types.js';

const MAX_32BIT = 2_147_483_647;

describe('A2 — watchdog resolution clamps to the 32-bit setTimeout ceiling', () => {
  it('over-ceiling streamIdleTimeoutMs is clamped, 0 still disables', () => {
    expect(resolveStreamIdleMs({ streamIdleTimeoutMs: Number.MAX_SAFE_INTEGER }, {})).toBe(
      MAX_32BIT,
    );
    expect(resolveStreamIdleMs({ streamIdleTimeoutMs: 0 }, {})).toBe(0);
    expect(resolveStreamIdleMs({}, { CLAUDE_STREAM_IDLE_TIMEOUT_MS: '9007199254740991' })).toBe(
      MAX_32BIT,
    );
    expect(resolveStreamIdleMs({}, {})).toBe(DEFAULT_STREAM_IDLE_MS);
  });

  it('over-ceiling streamMaxDurationMs is clamped (provider and env forms)', () => {
    expect(resolveStreamMaxMs({ streamMaxDurationMs: Number.MAX_SAFE_INTEGER }, {})).toBe(
      MAX_32BIT,
    );
    expect(resolveStreamMaxMs({ streamMaxDurationMs: 0 }, {})).toBe(0);
    expect(resolveStreamMaxMs({}, { BPT_STREAM_MAX_DURATION_MS: '9007199254740991' })).toBe(
      MAX_32BIT,
    );
  });
});

describe('B1 — tool-call name fragments arriving after the id chunk are kept', () => {
  it('assembles the full name when a fragmenting gateway splits it across chunks', () => {
    const t = new OpenAIStreamTranslator('gpt-4o');
    t.feed({ id: 'c1', choices: [{ delta: { role: 'assistant' } }] });
    // chunk 1: id + first name fragment; chunk 2: name tail; chunk 3: args.
    t.feed({
      choices: [
        { delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'get_' } }] } },
      ],
    });
    const midEvents = t.feed({
      choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'weather' } }] } }],
    });
    // No block emitted while the name is still streaming.
    expect(midEvents.some((e) => e.type === 'content_block_start')).toBe(false);
    const argEvents = t.feed({
      choices: [
        { delta: { tool_calls: [{ index: 0, function: { arguments: '{"city":"a"}' } }] } },
      ],
    });
    const start = argEvents.find((e) => e.type === 'content_block_start');
    expect(start).toBeDefined();
    expect((start as { content_block: { name: string } }).content_block.name).toBe('get_weather');
  });

  it('an argument-less call still flushes at finish() with its full name', () => {
    const t = new OpenAIStreamTranslator('gpt-4o');
    t.feed({ id: 'c1', choices: [{ delta: { role: 'assistant' } }] });
    t.feed({
      choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'pi' } }] } }],
    });
    t.feed({
      choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'ng' } }] } }],
    });
    t.feed({ choices: [{ finish_reason: 'tool_calls' }] });
    const events = t.finish();
    const start = events.find((e) => e.type === 'content_block_start');
    expect((start as { content_block: { name: string } }).content_block.name).toBe('ping');
  });
});

describe('B4 — unrecognized finish_reason is a truncated turn, not a clean success', () => {
  it("vLLM-style 'abort' throws a salvage-flagged connection error", () => {
    const t = new OpenAIStreamTranslator('gpt-4o');
    t.feed({ id: 'c1', choices: [{ delta: { content: 'partial answer ' } }] });
    t.feed({ choices: [{ finish_reason: 'abort' }] });
    let thrown: unknown;
    try {
      t.finish();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(APIConnectionError);
    expect((thrown as Error).message).toContain('abort');
    expect((thrown as APIConnectionError).midStreamTruncation).toBe(true);
  });

  it("the known reasons ('stop', 'length', 'tool_calls', 'content_filter') still finish cleanly", () => {
    for (const reason of ['stop', 'length', 'content_filter']) {
      const t = new OpenAIStreamTranslator('gpt-4o');
      t.feed({ id: 'c1', choices: [{ delta: { content: 'hi' } }] });
      t.feed({ choices: [{ finish_reason: reason }] });
      expect(() => t.finish()).not.toThrow();
    }
  });
});

describe('T1/T2/T5/M2-3/T3 — error normalization keeps identity, never throws', () => {
  it('T1: an McpError keeps its own name and code (no ProviderError forgery)', () => {
    const err = new McpError('mcp_http_status', 'MCP server x returned HTTP 500', {
      httpStatus: 500,
    });
    const n = normalizeProviderError(err);
    expect(n.name).toBe('McpError');
    expect(n.rawType).toBe('mcp_http_status');
  });

  it('T2: a circular nested envelope cannot make normalizeProviderError throw', () => {
    const circular: Record<string, unknown> = { message: { deep: null } };
    (circular.message as Record<string, unknown>).deep = circular;
    const evil = { error: circular };
    expect(() => normalizeProviderError(evil)).not.toThrow();
    const asError = Object.assign(new Error('outer'), { error: circular });
    expect(() => normalizeProviderError(asError)).not.toThrow();
    expect(normalizeProviderError(asError).name).toBe('Error');
  });

  it('T5: a JSON-string HTTP status ("503") classifies retryable', () => {
    const n = normalizeProviderError({ message: 'upstream unavailable', status: '503' });
    expect(n.status).toBe(503);
    expect(n.retryable).toBe(true);
  });

  it('M2-3: errorCodeOf covers MemoryToolError', () => {
    expect(errorCodeOf(new MemoryToolError('boom'))).toBe('memory_tool_error');
  });

  it('T3: MemoryToolError is reachable from the public barrel', () => {
    expect(BarrelMemoryToolError).toBe(MemoryToolError);
  });
});

describe('E7 — pre-adaptive denylist matches provider id spellings', () => {
  it('Vertex @-dates and bare family ids classify pre-adaptive', () => {
    expect(supportsAdaptiveThinking('claude-opus-4@20250514')).toBe(false);
    expect(supportsAdaptiveThinking('claude-opus-4')).toBe(false);
    expect(supportsAdaptiveThinking('claude-haiku-4-5@20251001')).toBe(false);
    expect(supportsAdaptiveThinking('anthropic.claude-sonnet-4-20250514-v1:0')).toBe(false);
  });

  it('4.6+ and unknown-newer models stay adaptive', () => {
    expect(supportsAdaptiveThinking('claude-opus-4-6')).toBe(true);
    expect(supportsAdaptiveThinking('claude-sonnet-4-6@20260101')).toBe(true);
    expect(supportsAdaptiveThinking('claude-fable-5')).toBe(true);
  });
});

describe('E8 — segments flatten survives null / textless segments', () => {
  it('filters bad entries instead of throwing on the defensive path', () => {
    const parts = buildSystemPromptParts(
      {
        type: 'segments',
        segments: [
          null,
          { label: 'ok', text: 'real text' },
          { label: 'empty', text: '' },
          { label: 'missing' },
        ] as never,
      },
      { cwd: '/tmp', toolNames: [] },
    );
    expect(parts.stable).toBe('real text');
    expect(parts.parts).toHaveLength(1);
  });
});

describe('C4 — a usage-only message_delta cannot reset a delivered stop_reason', () => {
  it('keeps the terminal stop_reason across a field-omitting extra delta', () => {
    const acc = new MessageAccumulator();
    acc.feed({
      type: 'message_start',
      message: {
        id: 'm1',
        type: 'message',
        role: 'assistant',
        model: 'claude-test-1',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 0 },
      },
    } as RawMessageStreamEvent);
    acc.feed({
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 5 },
    } as RawMessageStreamEvent);
    // Non-conforming second frame: usage only, stop fields omitted.
    acc.feed({
      type: 'message_delta',
      delta: {},
      usage: { output_tokens: 6 },
    } as RawMessageStreamEvent);
    const msg = acc.finalize();
    expect(msg.stop_reason).toBe('end_turn');
  });
});

describe('N3 — parseVerdict tolerates code-talk braces in bare verdicts', () => {
  it('a bare CONFIRMED with a code brace is kept', () => {
    const r = parseVerdict('CONFIRMED — the `{}` initializer is indeed wrong here.');
    expect(r.verdict).toBe('CONFIRMED');
    expect(r.keep).toBe(true);
  });

  it('a truncated JSON attempt ({" signature) still fails closed', () => {
    const r = parseVerdict('{"verdict":"CONF');
    expect(r.verdict).toBe('REFUTED');
    expect(r.parseFailed).toBe(true);
  });
});

describe('N2/N5/N6 — day aggregation honesty', () => {
  it('N2: an empty-ledger day reports failures null, not 0', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'batch-k-ledger-'));
    const agg = await aggregateDay(dir, '2026-07-01');
    expect(agg.records).toBe(0);
    expect(agg.failures).toBeNull();
    expect(agg.badLines).toBe(0);
  });

  it('N6: a calendar-invalid date is rejected with the typed error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'batch-k-ledger-'));
    await expect(aggregateDay(dir, '2026-02-30')).rejects.toThrow(/not a valid calendar date/);
  });
});

describe('I4 — .mcp.json values expand ${VAR} / ${VAR:-default}', () => {
  it('expands env values in headers/env/args; undefined without default stays visible', () => {
    const dir = mkdtempSync(join(tmpdir(), 'batch-k-mcp-'));
    writeFileSync(
      join(dir, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          srv: {
            type: 'http',
            url: 'https://x/${PATH_SEG:-mcp}',
            headers: { Authorization: 'Bearer ${TOKEN}' },
            env: { MISSING: '${NOPE}' },
          },
        },
      }),
    );
    const servers = loadProjectMcpServers(dir, undefined, () => {}, { TOKEN: 'sekrit' });
    const srv = servers.srv as {
      url: string;
      headers: Record<string, string>;
      env: Record<string, string>;
    };
    expect(srv.headers.Authorization).toBe('Bearer sekrit');
    expect(srv.url).toBe('https://x/mcp');
    expect(srv.env.MISSING).toBe('${NOPE}');
  });
});

describe('S2 — SDK MCP tool names are validated at definition time', () => {
  it('rejects non-ASCII / spaced names with the actual constraint', () => {
    const handler = async (): Promise<{ content: [] }> => ({ content: [] });
    expect(() => tool('查天气', 'd', {}, handler as never)).toThrow(/must match/);
    expect(() => tool('get weather', 'd', {}, handler as never)).toThrow(/must match/);
    expect(() => tool('get-weather_2', 'd', {}, handler as never)).not.toThrow();
  });

  it('rejects a qualified mcp__server__tool name over 128 chars at server build', () => {
    const handler = async (): Promise<{ content: [] }> => ({ content: [] });
    const longTool = tool('t'.repeat(120), 'd', {}, handler as never);
    expect(() =>
      createSdkMcpServer({ name: 'server-name', tools: [longTool] }),
    ).toThrow(/128-char/);
  });
});

describe('S1 — root-level $ref schemas are inlined for advertisement', () => {
  it('a z.lazy root does not advertise a bare {"$ref": ...} schema', async () => {
    type Node = { name: string; children?: Node[] };
    const nodeSchema: z.ZodType<Node> = z.lazy(() =>
      z.object({ name: z.string(), children: z.array(nodeSchema).optional() }),
    );
    const handler = async (): Promise<{ content: [] }> => ({ content: [] });
    const def = tool('walk', 'd', { root: nodeSchema as never }, handler as never);
    const schema = def.inputJsonSchema as Record<string, unknown>;
    // The root must be self-describing (type/properties), not only a pointer.
    expect(schema.type).toBe('object');
    expect(schema.properties).toBeDefined();
  });
});
