/**
 * Custom slash commands (v0.38): loader, frontmatter subset, expansion rules,
 * and the query() wiring (init slash_commands / supportedCommands / in-loop
 * expansion). Mirrors the official `.claude/commands` custom-command surface;
 * the deliberately-unsupported subset (!bash, @file, allowed-tools/model
 * frontmatter) is documented in docs/COMPAT.md, not tested here.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BUILTIN_SLASH_COMMANDS,
  expandSlashCommand,
  loadSlashCommands,
  parseFrontmatter,
  pureTextOf,
  slashCommandInfos,
  type LoadedSlashCommand,
} from '../src/engine/slash-commands.js';
import { query } from '../src/index.js';
import type {
  Options,
  SDKMessage,
  SDKSystemMessage,
  SDKUserMessage,
  SlashCommand,
} from '../src/types.js';
import { makeSSEFetch, type SSEFetchStub } from './helpers/sse-fetch.js';
import { textReplyEvents } from './helpers/mock-transport.js';

let cwd: string;
let userDir: string;
let sessionDir: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'bpt-slashcmd-cwd-'));
  userDir = await mkdtemp(join(tmpdir(), 'bpt-slashcmd-user-'));
  sessionDir = await mkdtemp(join(tmpdir(), 'bpt-slashcmd-sess-'));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(cwd, { recursive: true, force: true });
  await rm(userDir, { recursive: true, force: true });
  await rm(sessionDir, { recursive: true, force: true });
});

async function putCommand(
  root: string,
  rel: string,
  content: string,
): Promise<void> {
  const path = join(root, '.claude', 'commands', rel);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content, 'utf8');
}

/** userDir here is the OVERRIDE dir itself (no .claude/commands prefix). */
async function putUserCommand(rel: string, content: string): Promise<void> {
  const path = join(userDir, rel);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content, 'utf8');
}

const cmd = (over: Partial<LoadedSlashCommand> = {}): LoadedSlashCommand => ({
  name: 'greet',
  description: 'greet someone',
  argumentHint: '[name]',
  source: 'project',
  content: 'Say hello to $ARGUMENTS politely.',
  ...over,
});

describe('loadSlashCommands', () => {
  it('loads project commands with frontmatter metadata', async () => {
    await putCommand(
      cwd,
      'greet.md',
      '---\ndescription: Greet a person\nargument-hint: "[who]"\n---\nSay hello to $ARGUMENTS.',
    );
    const loaded = loadSlashCommands(cwd, ['project'], userDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({
      name: 'greet',
      description: 'Greet a person',
      argumentHint: '[who]',
      source: 'project',
      content: 'Say hello to $ARGUMENTS.',
    });
  });

  it('namespaces subdirectory commands with ":"', async () => {
    await putCommand(cwd, join('frontend', 'component.md'), 'Build a component.');
    const loaded = loadSlashCommands(cwd, ['project'], userDir);
    expect(loaded.map((c) => c.name)).toEqual(['frontend:component']);
  });

  it('honors settingSources: [] loads nothing, user-only skips project', async () => {
    await putCommand(cwd, 'proj.md', 'project body');
    await putUserCommand('usr.md', 'user body');
    expect(loadSlashCommands(cwd, [], userDir)).toEqual([]);
    expect(
      loadSlashCommands(cwd, ['user'], userDir).map((c) => c.name),
    ).toEqual(['usr']);
    // Omitted settingSources -> load-all default (bump-pin ruling).
    expect(
      loadSlashCommands(cwd, undefined, userDir).map((c) => c.name).sort(),
    ).toEqual(['proj', 'usr']);
  });

  it('project wins over user on a name collision', async () => {
    await putCommand(cwd, 'greet.md', 'project greeting');
    await putUserCommand('greet.md', 'user greeting');
    const loaded = loadSlashCommands(cwd, undefined, userDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.source).toBe('project');
    expect(loaded[0]?.content).toBe('project greeting');
  });

  it('reserves built-in names: a compact.md is dropped', async () => {
    await putCommand(cwd, 'compact.md', 'my own compact');
    expect(loadSlashCommands(cwd, ['project'], userDir)).toEqual([]);
  });

  it('skips non-md files, empty bodies, and invalid name segments', async () => {
    await putCommand(cwd, 'notes.txt', 'not a command');
    await putCommand(cwd, 'empty.md', '   \n  ');
    await putCommand(cwd, 'bad name.md', 'body');
    await putCommand(cwd, 'ok.md', 'body');
    const loaded = loadSlashCommands(cwd, ['project'], userDir);
    expect(loaded.map((c) => c.name)).toEqual(['ok']);
  });

  it('degrades to no commands when the directory is absent', () => {
    expect(loadSlashCommands(cwd, ['project'], userDir)).toEqual([]);
  });

  it('falls back to the first body line as description', async () => {
    await putCommand(cwd, 'fix.md', '# Fix the bug\n\nDo the thing.');
    const loaded = loadSlashCommands(cwd, ['project'], userDir);
    expect(loaded[0]?.description).toBe('Fix the bug');
  });
});

describe('parseFrontmatter', () => {
  it('parses flat key: value pairs and strips the fence', () => {
    const { meta, body } = parseFrontmatter(
      "---\ndescription: 'quoted'\nargument-hint: [x]\nmodel: opus\n---\nBody here",
    );
    expect(meta).toEqual({
      description: 'quoted',
      'argument-hint': '[x]',
      model: 'opus',
    });
    expect(body).toBe('Body here');
  });

  it('returns raw text untouched without a leading fence or with an unclosed one', () => {
    expect(parseFrontmatter('plain body').body).toBe('plain body');
    expect(parseFrontmatter('---\nkey: v\nno close').body).toBe(
      '---\nkey: v\nno close',
    );
  });
});

describe('expandSlashCommand', () => {
  it('substitutes $ARGUMENTS with the full argument string', () => {
    const out = expandSlashCommand('/greet Alice Bob', [cmd()]);
    expect(out).toEqual({
      name: 'greet',
      expanded: 'Say hello to Alice Bob politely.',
    });
  });

  it('substitutes $1..$9 positionals; missing positionals become empty', () => {
    const out = expandSlashCommand('/greet Alice', [
      cmd({ content: 'First: $1, second: $2.' }),
    ]);
    expect(out?.expanded).toBe('First: Alice, second: .');
  });

  it('appends arguments when the body has no placeholder', () => {
    const out = expandSlashCommand('/greet Alice', [
      cmd({ content: 'Say hello.' }),
    ]);
    expect(out?.expanded).toBe('Say hello.\n\nAlice');
  });

  it('passes through unknown names, non-slash text, and built-ins', () => {
    expect(expandSlashCommand('/nope args', [cmd()])).toBeNull();
    expect(expandSlashCommand('hello /greet', [cmd()])).toBeNull();
    expect(expandSlashCommand('/compact keep the tail', [cmd()])).toBeNull();
    expect(
      expandSlashCommand('/compact keep', [cmd({ name: 'compact' })]),
    ).toBeNull();
  });

  it('resolves namespaced invocations', () => {
    const out = expandSlashCommand('/frontend:component NavBar', [
      cmd({ name: 'frontend:component', content: 'Build $1.' }),
    ]);
    expect(out?.expanded).toBe('Build NavBar.');
  });
});

describe('pureTextOf', () => {
  it('accepts strings and all-text blocks, rejects mixed content', () => {
    expect(pureTextOf({ role: 'user', content: '/x' })).toBe('/x');
    expect(
      pureTextOf({
        role: 'user',
        content: [
          { type: 'text', text: '/a' },
          { type: 'text', text: 'b' },
        ],
      }),
    ).toBe('/a\nb');
    expect(
      pureTextOf({
        role: 'user',
        content: [
          { type: 'text', text: '/x' },
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: 'AA==' },
          },
        ],
      }),
    ).toBeNull();
  });
});

describe('slashCommandInfos', () => {
  it('lists built-ins first, then custom commands in the official shape', () => {
    const infos = slashCommandInfos([cmd()]);
    expect(infos[0]?.name).toBe('compact');
    expect(infos[1]).toEqual({
      name: 'greet',
      description: 'greet someone',
      argumentHint: '[name]',
    });
    expect(BUILTIN_SLASH_COMMANDS.map((b) => b.name)).toEqual(['compact']);
  });
});

// ---------------------------------------------------------------------------
// query() wiring
// ---------------------------------------------------------------------------

function baseOptions(extra: Partial<Options> = {}): Options {
  return {
    provider: { apiKey: 'test-key', promptCaching: false },
    sessionDir,
    cwd,
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    model: 'claude-sonnet-4-5',
    settingSources: ['project'],
    ...extra,
  };
}

function stubFetch(stub: SSEFetchStub): SSEFetchStub {
  vi.stubGlobal('fetch', stub);
  return stub;
}

async function collect(q: AsyncIterable<SDKMessage>): Promise<SDKMessage[]> {
  const out: SDKMessage[] = [];
  for await (const m of q) out.push(m);
  return out;
}

describe('query() slash-command wiring', () => {
  it('reports commands in init.slash_commands and supportedCommands()', async () => {
    await putCommand(
      cwd,
      'greet.md',
      '---\ndescription: Greet a person\nargument-hint: "[who]"\n---\nSay hello to $ARGUMENTS.',
    );
    stubFetch(makeSSEFetch([textReplyEvents('done')]));
    const q = query({ prompt: 'hi', options: baseOptions() });
    const supportedPromise = q.supportedCommands();
    const messages = await collect(q);
    const init = messages[0] as SDKSystemMessage;
    expect(init.subtype).toBe('init');
    expect(init.slash_commands).toEqual(['compact', 'greet']);
    const supported: SlashCommand[] = await supportedPromise;
    expect(supported).toEqual([
      expect.objectContaining({ name: 'compact' }),
      { name: 'greet', description: 'Greet a person', argumentHint: '[who]' },
    ]);
  });

  it('expands a /name prompt: model and history see the substituted body', async () => {
    await putCommand(cwd, 'greet.md', 'Say hello to $ARGUMENTS politely.');
    const fetchStub = stubFetch(makeSSEFetch([textReplyEvents('done')]));
    const q = query({ prompt: '/greet Alice', options: baseOptions() });
    const messages = await collect(q);

    const echoed = messages.find((m): m is SDKUserMessage => m.type === 'user');
    expect(echoed?.message.content).toBe('Say hello to Alice politely.');

    const req = fetchStub.requests[0];
    expect(req).toBeDefined();
    const body = JSON.parse(String(req?.init?.body ?? '{}')) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    const flat = JSON.stringify(body.messages);
    expect(flat).toContain('Say hello to Alice politely.');
    expect(flat).not.toContain('/greet');
  });

  it('passes unknown slash names through unchanged', async () => {
    await putCommand(cwd, 'greet.md', 'Say hello to $ARGUMENTS politely.');
    stubFetch(makeSSEFetch([textReplyEvents('done')]));
    const q = query({ prompt: '/unknown thing', options: baseOptions() });
    const messages = await collect(q);
    const echoed = messages.find((m): m is SDKUserMessage => m.type === 'user');
    expect(echoed?.message.content).toBe('/unknown thing');
  });

  it('with no commands on disk, init reports only built-ins', async () => {
    stubFetch(makeSSEFetch([textReplyEvents('done')]));
    const q = query({ prompt: 'hi', options: baseOptions() });
    const messages = await collect(q);
    const init = messages[0] as SDKSystemMessage;
    expect(init.slash_commands).toEqual(['compact']);
  });
});
