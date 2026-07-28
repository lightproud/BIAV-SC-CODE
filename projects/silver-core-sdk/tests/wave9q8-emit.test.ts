/** PROBE Q8 — temporary. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';

import { query } from '../src/index.js';
import type { Options, Query, SDKMessage } from '../src/types.js';
import { textReplyEvents, toolUseReplyEvents } from './helpers/mock-transport.js';
import { makeSSEFetch } from './helpers/sse-fetch.js';

let sessionDir: string;
let cwd: string;

beforeEach(async () => {
  sessionDir = await mkdtemp(join(tmpdir(), 'q8-sess-'));
  cwd = await mkdtemp(join(tmpdir(), 'q8-cwd-'));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(sessionDir, { recursive: true, force: true });
  await rm(cwd, { recursive: true, force: true });
});

function opts(stub: unknown, extra: Record<string, unknown> = {}): Options {
  vi.stubGlobal('fetch', stub);
  return {
    provider: { apiKey: 'test-key', promptCaching: false },
    sessionDir,
    cwd,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, BPT_HTTP_CLIENT: 'fetch' },
    model: 'claude-sonnet-4-5',
    ...extra,
  } as Options;
}

async function collect(q: Query): Promise<SDKMessage[]> {
  const out: SDKMessage[] = [];
  for await (const m of q) out.push(m);
  return out;
}

function report(tag: string, ms: SDKMessage[]): void {
  console.log(
    tag,
    JSON.stringify(
      ms.map((m) => {
        const s = (m as { subtype?: string }).subtype;
        const t = s !== undefined ? `${m.type}/${s}` : m.type;
        if (m.type === 'user') {
          const c = (m as { message: { content: unknown } }).message.content;
          return `${t}:${JSON.stringify(c).slice(0, 90)}`;
        }
        return t;
      }),
    ),
  );
}

/** An assistant reply carrying ONLY an orphan tool_use, cut at max_tokens. */
function orphanToolUseMaxTokens(): object[] {
  const ev = toolUseReplyEvents('Bash', { command: 'echo x' }, { id: 'toolu_orphan' });
  return ev.map((e) =>
    e.type === 'message_delta'
      ? { ...e, delta: { stop_reason: 'max_tokens', stop_sequence: null } }
      : e,
  );
}

describe('PROBE Q8c — merge into an already-emitted tool_result turn', () => {
  it('O: Stop-hook block reason after an all-empty assistant turn', async () => {
    const stub = makeSSEFetch([
      toolUseReplyEvents('Bash', { command: 'echo hi' }),
      orphanToolUseMaxTokens(),
      textReplyEvents('done'),
    ]);
    let fired = 0;
    const ms = await collect(
      query({
        prompt: 'go',
        options: opts(stub, {
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          hooks: {
            Stop: [
              {
                hooks: [
                  async (): Promise<Record<string, unknown>> => {
                    fired += 1;
                    return fired === 1
                      ? { decision: 'block', reason: 'KEEP-GOING-REASON' }
                      : {};
                  },
                ],
              },
            ],
          },
        }),
      }),
    );
    report('O', ms);
    console.log(
      'O-hasBlockReason',
      ms.some((m) => JSON.stringify(m).includes('KEEP-GOING-REASON')),
    );
  });

  it('P: structured-output correction after an all-empty assistant turn', async () => {
    const stub = makeSSEFetch([
      toolUseReplyEvents('Bash', { command: 'echo hi' }),
      orphanToolUseMaxTokens(),
      textReplyEvents('{"a":1}'),
    ]);
    const ms = await collect(
      query({
        prompt: 'go',
        options: opts(stub, {
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          outputFormat: {
            type: 'json_schema',
            schema: {
              type: 'object',
              properties: { a: { type: 'number' } },
              required: ['a'],
            },
          },
        }),
      }),
    );
    report('P', ms);
    console.log(
      'P-hasCorrection',
      ms.some((m) =>
        JSON.stringify(m).includes('did not satisfy the required output format'),
      ),
    );
  });
});
