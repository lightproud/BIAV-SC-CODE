/**
 * Message-uuid persistence (keeper ruling 2026-07-13): transcript records
 * carry a stable identity written at persist time.
 *
 * Contract pinned here:
 *  1. STREAM = DISK - the uuid on a yielded user/assistant SDKMessage is the
 *     uuid persisted on its transcript record.
 *  2. READ IDEMPOTENCE - two getSessionMessages reads of the same transcript
 *     return identical uuid sequences.
 *  3. IDENTITY SURVIVES STRUCTURAL DAMAGE - uuids come from the records, not
 *     from read-time minting, so dropping the meta line no longer reshuffles
 *     them.
 *  4. LEGACY TOLERANCE - records written before 0.53.0 (no uuid field) still
 *     read fine; a fallback uuid is minted for them (per-read, non-stable -
 *     documented, not asserted stable).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { query, getSessionMessages } from '../src/index.js';
import type { SDKMessage } from '../src/index.js';

let server: http.Server;
let baseUrl = '';
let root = '';
let sessionDir = '';

function sse(res: http.ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function streamText(res: http.ServerResponse, model: string, text: string): void {
  sse(res, 'message_start', {
    type: 'message_start',
    message: {
      id: 'msg_uuid',
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 0 },
    },
  });
  sse(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
  sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
  sse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 4 } });
  sse(res, 'message_stop', { type: 'message_stop' });
  res.end();
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'uuid-persist-'));
  sessionDir = path.join(root, '.sessions');
  await new Promise<void>((resolve) => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        streamText(res, 'claude-emulator-1', 'reply');
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
      resolve();
    });
  });
});
afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  fs.rmSync(root, { recursive: true, force: true });
});

function opts() {
  return {
    provider: { apiKey: 'k', baseUrl },
    model: 'claude-emulator-1',
    cwd: root,
    sessionDir,
    settingSources: [] as [],
    sandbox: false,
    maxTurns: 4,
  };
}

describe('message-uuid persistence (0.53.0)', () => {
  it('stream uuid == persisted uuid, and reads are idempotent', async () => {
    const streamed: Array<{ type: string; uuid: string }> = [];
    let sid = '';
    for await (const m of query({ prompt: 'round one', options: opts() })) {
      if (m.type === 'system' && m.subtype === 'init') sid = m.session_id;
      if (m.type === 'user' || m.type === 'assistant') {
        streamed.push({ type: m.type, uuid: (m as { uuid: string }).uuid });
      }
    }
    expect(streamed.length).toBeGreaterThan(0);

    const read1 = (await getSessionMessages(sid, { sessionDir })) as Array<{
      type?: string;
      uuid?: string;
    }>;
    const read2 = (await getSessionMessages(sid, { sessionDir })) as typeof read1;

    // 2. idempotence
    expect(read1.map((m) => m.uuid)).toEqual(read2.map((m) => m.uuid));
    // 1. every streamed identity is on disk under the same uuid+type
    const diskKeys = new Set(read1.map((m) => `${m.type}:${m.uuid}`));
    for (const s of streamed) {
      expect(diskKeys.has(`${s.type}:${s.uuid}`)).toBe(true);
    }
  });

  it('records on disk carry the uuid field for both roles', async () => {
    let sid = '';
    for await (const m of query({ prompt: 'check disk', options: opts() })) {
      if (m.type === 'system' && m.subtype === 'init') sid = m.session_id;
    }
    const lines = fs
      .readFileSync(path.join(sessionDir, `${sid}.jsonl`), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { type?: string; uuid?: string });
    const messageRecords = lines.filter((r) => r.type === 'user' || r.type === 'assistant');
    expect(messageRecords.length).toBeGreaterThanOrEqual(2);
    for (const r of messageRecords) {
      expect(typeof r.uuid).toBe('string');
      expect((r.uuid as string).length).toBeGreaterThan(0);
    }
  });

  it('identity survives meta-line loss (uuids come from records, not read-time minting)', async () => {
    let sid = '';
    for await (const m of query({ prompt: 'damage test', options: opts() })) {
      if (m.type === 'system' && m.subtype === 'init') sid = m.session_id;
    }
    const file = path.join(sessionDir, `${sid}.jsonl`);
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    // drop the meta line (line 0) - the historical uuid-reshuffle trigger
    fs.writeFileSync(path.join(sessionDir, 'dmg.jsonl'), lines.slice(1).join('\n') + '\n');
    const a = (await getSessionMessages('dmg', { sessionDir })) as Array<{ uuid?: string }>;
    const b = (await getSessionMessages('dmg', { sessionDir })) as Array<{ uuid?: string }>;
    expect(a.map((m) => m.uuid)).toEqual(b.map((m) => m.uuid));
    // and they match the intact read too
    const intact = (await getSessionMessages(sid, { sessionDir })) as Array<{ uuid?: string }>;
    expect(a.map((m) => m.uuid)).toEqual(intact.map((m) => m.uuid));
  });

  it('legacy records without a uuid still read (mint-on-miss fallback)', async () => {
    const sid = 'legacy-1';
    const rec = (type: string, content: unknown) =>
      JSON.stringify({ type, timestamp: new Date().toISOString(), message: { role: type, content } });
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionDir, `${sid}.jsonl`),
      [
        JSON.stringify({ type: 'meta', sessionId: sid, createdAt: Date.now(), cwd: root, firstPrompt: 'legacy' }),
        rec('user', 'hello from 0.52'),
        rec('assistant', [{ type: 'text', text: 'old reply' }]),
      ].join('\n') + '\n',
    );
    const msgs = (await getSessionMessages(sid, { sessionDir })) as Array<{ uuid?: string; type?: string }>;
    expect(msgs.length).toBe(2);
    for (const m of msgs) expect(typeof m.uuid).toBe('string');
  });

  it('a resumed session appends new records with fresh persisted uuids (no collisions)', async () => {
    let sid = '';
    for await (const m of query({ prompt: 'first', options: opts() })) {
      if (m.type === 'system' && m.subtype === 'init') sid = m.session_id;
    }
    const drain = async (p: AsyncIterable<SDKMessage>) => {
      for await (const _ of p) {
        // drain
      }
    };
    await drain(query({ prompt: 'second', options: { ...opts(), resume: sid } }));
    const msgs = (await getSessionMessages(sid, { sessionDir })) as Array<{ uuid?: string }>;
    const uuids = msgs.map((m) => m.uuid);
    expect(new Set(uuids).size).toBe(uuids.length);
  });
});
