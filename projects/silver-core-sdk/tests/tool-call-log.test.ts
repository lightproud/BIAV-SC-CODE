/**
 * Structured tool-call log tests (governance spec S3) + claim-verification
 * helper tests (spec S4), through the REAL query() path with a scripted fetch.
 *
 * S3 acceptance:
 *  - the session JSONL carries one `tool_call` record per dispatched tool_use
 *    block — name, truncated input JSON, timestamp, sequence, status,
 *    duration, result summary — machine-distinguishable by `type`;
 *  - records stay alignable with the message lines (tool_use_id joins the
 *    record to the untruncated tool_use block);
 *  - failures record status 'error' (including unknown tools);
 *  - persistSession:false and incognito sessions write NO records.
 *
 * S4 acceptance:
 *  - "the output claims a memory write, the log has none" produces a finding;
 *  - a backed claim produces none.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { query } from '../src/query.js';
import {
  DEFAULT_TOOL_CLAIM_DETECTORS,
  MEMORY_WRITE_CLAIM_DETECTOR,
  auditSessionToolClaims,
  auditToolClaims,
  getSessionToolCalls,
  isMemoryWriteRecord,
} from '../src/index.js';
import type { Options, SDKMessage, SDKResultMessage } from '../src/types.js';
import { makeSSEFetch, type SSEFetchStub } from './helpers/sse-fetch.js';
import { textReplyEvents, toolUseReplyEvents } from './helpers/mock-transport.js';

let cwd: string;
let sessionDir: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'bpt-toollog-cwd-'));
  sessionDir = await mkdtemp(join(tmpdir(), 'bpt-toollog-sess-'));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(cwd, { recursive: true, force: true });
  await rm(sessionDir, { recursive: true, force: true });
});

function baseOptions(stub: SSEFetchStub, extra: Partial<Options> = {}): Options {
  return {
    provider: { apiKey: 'test-key', promptCaching: false, fetch: stub },
    cwd,
    sessionDir,
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    model: 'claude-sonnet-4-5',
    settingSources: [],
    ...extra,
  };
}

async function collect(prompt: string, options: Options): Promise<SDKMessage[]> {
  const out: SDKMessage[] = [];
  for await (const m of query({ prompt, options })) out.push(m);
  return out;
}

function sessionIdOf(messages: SDKMessage[]): string {
  const result = messages.at(-1) as SDKResultMessage;
  expect(result.type).toBe('result');
  return result.session_id;
}

const MEMORY_CREATE = {
  command: 'create',
  path: '/memories/notes.md',
  file_text: 'a fact worth keeping',
};

describe('S3 structured tool-call records', () => {
  it('persists one typed record per dispatched call, aligned with the messages', async () => {
    const stub = makeSSEFetch([
      toolUseReplyEvents('memory', MEMORY_CREATE, { id: 'toolu_mem_1' }),
      textReplyEvents('recorded'),
    ]);
    const messages = await collect(
      'remember this',
      baseOptions(stub, { memory: { sessionEndUpdate: false } }),
    );
    const sessionId = sessionIdOf(messages);

    const records = await getSessionToolCalls(sessionId, { sessionDir });
    expect(records).toHaveLength(1);
    const rec = records[0]!;
    expect(rec.type).toBe('tool_call');
    expect(rec.tool_name).toBe('memory');
    expect(rec.tool_use_id).toBe('toolu_mem_1');
    expect(rec.seq).toBe(1);
    expect(rec.status).toBe('ok');
    expect(rec.duration_ms).toBeGreaterThanOrEqual(0);
    expect(rec.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(rec.tool_input).toContain('"command":"create"');
    expect(rec.result_summary).toContain('File created successfully');
    expect(rec.session_id).toBe(sessionId);

    // Raw JSONL: `type` distinguishes tool calls from message lines, and the
    // tool_use_id joins the record to the persisted assistant tool_use block.
    const raw = await readFile(join(sessionDir, `${sessionId}.jsonl`), 'utf8');
    const lines = raw
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const toolLines = lines.filter((l) => l.type === 'tool_call');
    expect(toolLines).toHaveLength(1);
    const assistantWithToolUse = lines.find(
      (l) => l.type === 'assistant' && JSON.stringify(l).includes('toolu_mem_1'),
    );
    expect(assistantWithToolUse).toBeDefined();
  });

  it("records status 'error' with the failure detail (unknown tool)", async () => {
    const stub = makeSSEFetch([
      toolUseReplyEvents('NoSuchTool', { anything: true }, { id: 'toolu_missing' }),
      textReplyEvents('hm'),
    ]);
    const messages = await collect('call something odd', baseOptions(stub));
    const records = await getSessionToolCalls(sessionIdOf(messages), { sessionDir });
    expect(records).toHaveLength(1);
    expect(records[0]!.status).toBe('error');
    expect(records[0]!.result_summary).toContain('No such tool');
  });

  it('truncates an oversized input JSON but keeps the join key', async () => {
    const stub = makeSSEFetch([
      toolUseReplyEvents(
        'memory',
        {
          command: 'create',
          path: '/memories/big.md',
          file_text: 'x'.repeat(10_000),
        },
        { id: 'toolu_big' },
      ),
      textReplyEvents('done'),
    ]);
    const messages = await collect(
      'write a big file',
      baseOptions(stub, { memory: { sessionEndUpdate: false } }),
    );
    const records = await getSessionToolCalls(sessionIdOf(messages), { sessionDir });
    expect(records).toHaveLength(1);
    expect(records[0]!.tool_input.length).toBeLessThan(3000);
    expect(records[0]!.tool_input).toContain('…[truncated]');
    expect(records[0]!.tool_use_id).toBe('toolu_big');
  });

  it('writes no records under persistSession:false', async () => {
    const stub = makeSSEFetch([
      toolUseReplyEvents('memory', MEMORY_CREATE),
      textReplyEvents('done'),
    ]);
    const messages = await collect(
      'remember this',
      baseOptions(stub, {
        persistSession: false,
        memory: { sessionEndUpdate: false },
      }),
    );
    const records = await getSessionToolCalls(sessionIdOf(messages), { sessionDir });
    expect(records).toEqual([]);
  });
});

describe('S4 tool-claim verification', () => {
  it('flags a claimed-but-unbacked memory write from the persisted session', async () => {
    const stub = makeSSEFetch([
      textReplyEvents("Done — I've saved that to memory for next time."),
    ]);
    const messages = await collect('remember this please', baseOptions(stub));
    const findings = await auditSessionToolClaims(sessionIdOf(messages), { sessionDir });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.detectorId).toBe('memory-write-claim');
    expect(findings[0]!.snippet).toContain('saved that to memory');
  });

  it('does not flag when the log carries a backing successful write', async () => {
    const stub = makeSSEFetch([
      toolUseReplyEvents('memory', MEMORY_CREATE),
      textReplyEvents("I've saved that to memory."),
    ]);
    const messages = await collect(
      'remember this please',
      baseOptions(stub, { memory: { sessionEndUpdate: false } }),
    );
    const findings = await auditSessionToolClaims(sessionIdOf(messages), { sessionDir });
    expect(findings).toEqual([]);
  });

  it('pure-function form: zh claims, failed writes do not count as backing', () => {
    const zhFindings = auditToolClaims({
      assistantTexts: ['分析完毕，已写入记忆。'],
      toolCalls: [
        {
          tool_name: 'memory',
          status: 'error',
          tool_input: '{"command":"create","path":"/memories/x.md"}',
        },
      ],
    });
    expect(zhFindings).toHaveLength(1);

    const backed = auditToolClaims({
      assistantTexts: ['分析完毕，已写入记忆。'],
      toolCalls: [
        {
          tool_name: 'memory',
          status: 'ok',
          tool_input: '{"command":"str_replace","path":"/memories/x.md"}',
        },
      ],
    });
    expect(backed).toEqual([]);

    // A read does not back a write claim.
    const readOnly = auditToolClaims({
      assistantTexts: ['saved it to memory'],
      toolCalls: [
        { tool_name: 'memory', status: 'ok', tool_input: '{"command":"view"}' },
      ],
    });
    expect(readOnly).toHaveLength(1);
  });

  it('exposes the detector building blocks for consumer-defined detectors', () => {
    expect(DEFAULT_TOOL_CLAIM_DETECTORS).toContain(MEMORY_WRITE_CLAIM_DETECTOR);
    expect(MEMORY_WRITE_CLAIM_DETECTOR.id).toBe('memory-write-claim');
    expect(
      isMemoryWriteRecord({
        tool_name: 'memory',
        status: 'ok',
        tool_input: '{"command":"delete","path":"/memories/x.md"}',
      }),
    ).toBe(true);
    expect(
      isMemoryWriteRecord({
        tool_name: 'memory',
        status: 'ok',
        tool_input: '{"command":"view","path":"/memories"}',
      }),
    ).toBe(false);
  });
});
