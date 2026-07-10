/**
 * White-box coverage batch 3: Options.onElicitation - the LAST entry on the
 * api-surface-coverage KNOWN_UNTESTED allowlist. Uses the heavier fixture the
 * allowlist called for: a real stdio MCP server
 * (tests/fixtures/mcp-elicit-server.mjs) that ISSUES a server-initiated
 * `elicitation/create` request mid-tool-call; the host's onElicitation answer
 * is threaded back and the tool result embeds it - end-to-end over the full
 * query() chain (spawned subprocess, JSON-RPC on stdio, model via SSE stub).
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  query,
  type ElicitationRequest,
  type Options,
  type SDKMessage,
} from '../src/index.js';
import { makeSSEFetch, type SSEFetchStub } from './helpers/sse-fetch.js';
import { textReplyEvents, toolUseReplyEvents } from './helpers/mock-transport.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'mcp-elicit-server.mjs');

let cwd: string;
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'b3e-'));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(cwd, { recursive: true, force: true });
});

function opts(extra: Partial<Options> = {}): Options {
  return {
    provider: { apiKey: 'test-key', promptCaching: false },
    sessionDir: join(cwd, '.sessions'),
    cwd,
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    model: 'claude-sonnet-4-5',
    mcpServers: { srv: { type: 'stdio', command: process.execPath, args: [FIXTURE] } },
    allowedTools: ['mcp__srv__ask'],
    ...extra,
  };
}

function stub(scripts: ReadonlyArray<readonly object[]>): SSEFetchStub {
  const s = makeSSEFetch(scripts);
  vi.stubGlobal('fetch', s);
  return s;
}

function toolResultTexts(messages: SDKMessage[]): string[] {
  const out: string[] = [];
  for (const m of messages) {
    if (m.type !== 'user') continue;
    const content = (m as { message?: { content?: unknown } }).message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b?.type === 'tool_result') {
        const c = b.content;
        if (typeof c === 'string') out.push(c);
        else if (Array.isArray(c)) out.push(...c.filter((x: { type?: string }) => x?.type === 'text').map((x: { text?: string }) => x.text ?? ''));
      }
    }
  }
  return out;
}

async function drive(options: Options): Promise<SDKMessage[]> {
  stub([
    toolUseReplyEvents('mcp__srv__ask', {}, { id: 'toolu_elicit_1' }),
    textReplyEvents('answered'),
  ]);
  const q = query({ prompt: 'Ask the server tool.', options });
  const messages: SDKMessage[] = [];
  for await (const m of q) messages.push(m);
  return messages;
}

describe('Options.onElicitation (batch 3 - the last allowlist gap)', () => {
  it('threads the server elicitation to the handler and the accepted answer back into the tool result', async () => {
    const seen: ElicitationRequest[] = [];
    const messages = await drive(
      opts({
        onElicitation: async (request, { signal }) => {
          seen.push(request);
          expect(signal).toBeInstanceOf(AbortSignal);
          return { action: 'accept', content: { name: 'Erica' } };
        },
      }),
    );
    // The handler received the PARSED request.
    expect(seen).toHaveLength(1);
    expect(seen[0]!.message).toBe('What is your name?');
    expect(JSON.stringify(seen[0]!.requestedSchema)).toContain('"name"');
    // The fixture embedded our answer into the tool result.
    const texts = toolResultTexts(messages);
    expect(texts.some((t) => t.includes('ELICITED action=accept value=Erica'))).toBe(true);
  }, 15_000);

  it('without a handler the elicitation is auto-declined (documented default)', async () => {
    const messages = await drive(opts());
    const texts = toolResultTexts(messages);
    expect(texts.some((t) => t.includes('ELICITED action=decline value='))).toBe(true);
  }, 15_000);
});
