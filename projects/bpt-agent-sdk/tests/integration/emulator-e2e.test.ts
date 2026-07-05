/**
 * Integration test: the REAL SDK stack (real global fetch -> real HTTP ->
 * real SSE parsing -> real agent loop -> real builtin tools with real
 * filesystem side effects -> real in-process MCP tool -> real session
 * persistence) driven against a LOCAL Anthropic Messages API emulator.
 *
 * Only the model's "thinking" is scripted; every other layer runs for real.
 * This is keyless and deterministic, so it runs in the normal `npm test`.
 * The real-model counterpart lives in tests/integration/live-real-api.mjs
 * and only runs when ANTHROPIC_API_KEY is present (CI workflow_dispatch).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';
import { query, tool, createSdkMcpServer } from '../../src/index.js';
import type { SDKMessage } from '../../src/index.js';

// --- SSE emit helpers (real Anthropic wire format) -------------------------
function sse(res: http.ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function msgStart(res: http.ServerResponse, model: string): void {
  sse(res, 'message_start', {
    type: 'message_start',
    message: {
      id: 'msg_' + Math.round(performance.now()),
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 0 },
    },
  });
}
function streamText(res: http.ServerResponse, model: string, text: string): void {
  msgStart(res, model);
  sse(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
  sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
  sse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } });
  sse(res, 'message_stop', { type: 'message_stop' });
  res.end();
}
function streamToolUse(res: http.ServerResponse, model: string, id: string, name: string, input: unknown): void {
  msgStart(res, model);
  sse(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id, name, input: {} } });
  const json = JSON.stringify(input);
  // split across two deltas to exercise input_json_delta accumulation
  sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: json.slice(0, 4) } });
  sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: json.slice(4) } });
  sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
  sse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 15 } });
  sse(res, 'message_stop', { type: 'message_stop' });
  res.end();
}
function countToolTurns(messages: Array<{ role: string; content: unknown }>): number {
  return messages.filter(
    (m) => m.role === 'user' && Array.isArray(m.content) && (m.content as Array<{ type: string }>).some((b) => b.type === 'tool_result'),
  ).length;
}

let server: http.Server;
let baseUrl: string;
let sandbox: string;

function startServer(handler: (toolTurns: number, model: string, res: http.ServerResponse) => void): Promise<void> {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const reqJson = JSON.parse(body) as { model: string; messages: Array<{ role: string; content: unknown }> };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      handler(countToolTurns(reqJson.messages), reqJson.model, res);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    resolve();
  }));
}

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bpt-e2e-'));
});
afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe('emulator end-to-end (real stack, scripted model)', () => {
  it('runs a multi-tool agent loop with real fs + MCP side effects', async () => {
    await startServer((toolTurns, model, res) => {
      switch (toolTurns) {
        case 0: return streamToolUse(res, model, 'tu_1', 'Write', { file_path: 'notes.txt', content: 'hello from bpt-agent-sdk\n' });
        case 1: return streamToolUse(res, model, 'tu_2', 'Read', { file_path: 'notes.txt' });
        case 2: return streamToolUse(res, model, 'tu_3', 'Bash', { command: 'wc -c notes.txt' });
        case 3: return streamToolUse(res, model, 'tu_4', 'mcp__demo__shout', { text: 'it works' });
        default: return streamText(res, model, 'Done: wrote, read, counted, shouted.');
      }
    });

    const demo = createSdkMcpServer({
      name: 'demo',
      version: '1.0.0',
      tools: [
        tool('shout', 'Uppercase and exclaim', { text: z.string() }, async (args: { text: string }) => ({
          content: [{ type: 'text', text: args.text.toUpperCase() + '!!!' }],
        })),
      ],
    });

    const sessionDir = path.join(sandbox, '.sessions');
    const messages: SDKMessage[] = [];
    let sessionId: string | undefined;
    const q = query({
      prompt: 'Create notes.txt, read it, count bytes, then shout.',
      options: {
        provider: { apiKey: 'test-key', baseUrl },
        cwd: sandbox,
        sessionDir,
        // Pin the bash sandbox OFF: the Bash command here writes/reads in cwd,
        // and the assertions on tool bytes must not depend on host bwrap.
        sandbox: false,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        mcpServers: { demo },
        allowedTools: ['mcp__demo__*'],
        model: 'claude-emulator-1',
        maxTurns: 20,
      },
    });
    for await (const m of q) {
      messages.push(m);
      if (m.type === 'system' && m.subtype === 'init') sessionId = m.session_id;
    }

    // init: builtin tools + the MCP tool are advertised and the server connected
    const init = messages.find((m): m is Extract<SDKMessage, { type: 'system'; subtype: 'init' }> => m.type === 'system' && m.subtype === 'init');
    expect(init).toBeDefined();
    expect(init!.tools).toEqual(expect.arrayContaining(['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'mcp__demo__shout']));
    expect(init!.mcp_servers).toContainEqual({ name: 'demo', status: 'connected' });

    // the four tools were actually invoked in order
    const toolNames = messages
      .filter((m): m is Extract<SDKMessage, { type: 'assistant' }> => m.type === 'assistant')
      .flatMap((m) => m.message.content.filter((b): b is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } => b.type === 'tool_use'))
      .map((b) => b.name);
    expect(toolNames).toEqual(['Write', 'Read', 'Bash', 'mcp__demo__shout']);

    // tool_result user messages are surfaced on the stream (finding #27)
    const toolResults = messages
      .filter((m): m is Extract<SDKMessage, { type: 'user' }> => m.type === 'user')
      .flatMap((m) => (Array.isArray(m.message.content) ? m.message.content : []))
      .filter((b): b is { type: 'tool_result'; content: unknown; is_error?: boolean } => (b as { type: string }).type === 'tool_result');
    expect(toolResults.length).toBe(4);
    const shoutResult = toolResults[3];
    const shoutText = typeof shoutResult!.content === 'string' ? shoutResult!.content : (shoutResult!.content as Array<{ text: string }>)[0]?.text;
    expect(shoutText).toContain('IT WORKS!!!');

    // final result is a success with the model's text
    const result = messages.find((m): m is Extract<SDKMessage, { type: 'result' }> => m.type === 'result');
    expect(result).toBeDefined();
    expect(result!.subtype).toBe('success');
    if (result!.subtype === 'success') expect(result!.result).toContain('Done');

    // REAL side effects: the file exists on disk with the written content
    const notes = path.join(sandbox, 'notes.txt');
    expect(fs.existsSync(notes)).toBe(true);
    expect(fs.readFileSync(notes, 'utf8')).toBe('hello from bpt-agent-sdk\n');

    // session transcript persisted
    const transcript = path.join(sessionDir, `${sessionId}.jsonl`);
    expect(fs.existsSync(transcript)).toBe(true);
    expect(fs.readFileSync(transcript, 'utf8').trim().split('\n').length).toBeGreaterThan(1);
  });

  it('P0: a Bash command that backgrounds a child returns near the timeout, not after the child exits', async () => {
    await startServer((toolTurns, model, res) => {
      if (toolTurns === 0) {
        return streamToolUse(res, model, 'tu_bg', 'Bash', { command: 'echo started; sleep 6 &', timeout: 1500 });
      }
      return streamText(res, model, 'bash returned');
    });

    const started = performance.now();
    let bashMs = Infinity;
    const q = query({
      prompt: 'run it',
      options: {
        provider: { apiKey: 'test-key', baseUrl },
        cwd: sandbox,
        persistSession: false,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        model: 'claude-emulator-1',
      },
    });
    for await (const m of q) {
      if (m.type === 'user' && Array.isArray(m.message.content)) {
        for (const b of m.message.content) {
          if ((b as { type: string }).type === 'tool_result') bashMs = performance.now() - started;
        }
      }
    }
    // Old code hung until the 6s background child (or forever for a daemon).
    // The fix settles on the shell's own exit -> well under 3s.
    expect(bashMs).toBeLessThan(3000);
  });
});
