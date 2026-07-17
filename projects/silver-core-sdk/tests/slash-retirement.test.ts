/**
 * Slash retirement terminal-state locks (SCS-REQ-REPOS-01 §4 / §7.3).
 *
 * The engine recognizes NO text convention starting with '/': a pure-text
 * `/loop …`, `/goal …`, `/compact`, or `/anything` prompt passes through to
 * the wire VERBATIM — no expansion, no interception, no special turn. And
 * the source tree carries no recognition residue: the retired identifiers
 * are banned by a grep assertion so the cut cannot silently regrow.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import * as api from '../src/index.js';
import { query } from '../src/query.js';
import type { SDKMessage } from '../src/types.js';
import { textReplyEvents } from './helpers/mock-transport.js';
import { makeSSEFetch } from './helpers/sse-fetch.js';

const srcDir = fileURLToPath(new URL('../src/', import.meta.url));

async function collect(q: AsyncGenerator<SDKMessage, void>): Promise<SDKMessage[]> {
  const out: SDKMessage[] = [];
  for await (const m of q) out.push(m);
  return out;
}

async function firstWireUserText(prompt: string): Promise<string> {
  const fetchStub = makeSSEFetch([textReplyEvents('ok')]);
  const q = query({
    prompt,
    options: {
      provider: { apiKey: 'test-key', fetch: fetchStub, promptCaching: false },
      persistSession: false,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    },
  });
  await collect(q);
  const body = JSON.parse(String(fetchStub.requests[0]?.init?.body)) as {
    messages: Array<{ role: string; content: unknown }>;
  };
  const first = body.messages[0];
  expect(first?.role).toBe('user');
  return typeof first?.content === 'string'
    ? first.content
    : (first?.content as Array<{ type: string; text?: string }>)
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
}

describe('slash text passes through VERBATIM (regression lock)', () => {
  for (const prompt of [
    '/loop 10m collect the fleet metrics',
    '/goal all tests green',
    '/compact focus on the auth work',
    '/compact',
    '/greet world',
  ]) {
    it(`${JSON.stringify(prompt)} reaches the wire as plain text`, async () => {
      expect(await firstWireUserText(prompt)).toBe(prompt);
    });
  }

  it('a /compact prompt is a NORMAL model turn (one request, no boundary)', async () => {
    const fetchStub = makeSSEFetch([textReplyEvents('just text')]);
    const q = query({
      prompt: '/compact',
      options: {
        provider: { apiKey: 'test-key', fetch: fetchStub, promptCaching: false },
        persistSession: false,
        env: { PATH: process.env.PATH, HOME: process.env.HOME },
      },
    });
    const messages = await collect(q);
    expect(fetchStub.requests).toHaveLength(1);
    expect(
      messages.some((m) => m.type === 'system' && m.subtype === 'compact_boundary'),
    ).toBe(false);
    const last = messages[messages.length - 1];
    expect(last?.type).toBe('result');
  });
});

describe('no slash-recognition residue (source + export assertion)', () => {
  const BANNED_IDENTIFIERS = [
    'parseLoopCommand',
    'createPromptLoop',
    'parseGoalCommand',
    'createSessionGoal',
    'expandSlashCommand',
    'loadSlashCommands',
    'slashCommandInfos',
    'detectManualCompact',
    'runManualCompact',
    'LOOP_SLASH_COMMAND',
    'GOAL_SLASH_COMMAND',
    'recognizeCommand',
  ];
  // Literal slash-command spellings the engine must not match against.
  const BANNED_LITERALS = ["'/compact'", '"/compact"', "'/loop'", "'/goal'"];

  function walk(dir: string, out: string[]): void {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (entry.endsWith('.ts')) out.push(p);
    }
  }

  it('src/ carries none of the retired identifiers or command literals', () => {
    const files: string[] = [];
    walk(srcDir, files);
    expect(files.length).toBeGreaterThan(50);
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const banned of [...BANNED_IDENTIFIERS, ...BANNED_LITERALS]) {
        if (text.includes(banned)) offenders.push(`${f}: ${banned}`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('the public export surface carries no retired names', () => {
    for (const name of BANNED_IDENTIFIERS) {
      expect(name in api, `export '${name}' should be gone`).toBe(false);
    }
  });
});
