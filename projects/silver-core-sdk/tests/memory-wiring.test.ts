/**
 * Memory system assembly tests (spec R2 / R5 / R6), driven through the REAL
 * query() path with a scripted fetch:
 *  - mode A (native): the official typed entry rides tools[], no schema for
 *    `memory` is advertised, no SDK-side protocol prompt — and the builtin
 *    still executes the model's memory calls;
 *  - mode B (custom): a full schema for `memory` is advertised, the protocol
 *    fragment (docs-verbatim) + consumer instructions are injected;
 *  - auto-selection by transport protocol, and the native-on-openai
 *    configuration error;
 *  - R2 acceptance: the same consuming code + same scripted commands leave
 *    byte-identical store artifacts in both modes;
 *  - R6: resident index injection (present / truncated / absent / disabled).
 */

import { mkdtemp, readdir, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { query } from '../src/query.js';
import {
  MEMORY_INDEX_PATH,
  MEMORY_SERVER_TOOL,
  MEMORY_TOOL_NAME,
  createLocalMemoryFileOps,
  createMemoryStore,
} from '../src/index.js';
import { ConfigurationError } from '../src/errors.js';
import { encodeOpenAIRequest } from '../src/transport/openai.js';
import { resolveMemoryRuntime } from '../src/tools/memory/index.js';
import { MEMORY_PROTOCOL_FRAGMENT } from '../src/engine/prompt-fragments.js';
import type { Options, SDKMessage, SDKResultMessage } from '../src/types.js';
import { makeSSEFetch, type SSEFetchStub } from './helpers/sse-fetch.js';
import { textReplyEvents, toolUseReplyEvents } from './helpers/mock-transport.js';

let cwd: string;
let sessionDir: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'bpt-memwire-cwd-'));
  sessionDir = await mkdtemp(join(tmpdir(), 'bpt-memwire-sess-'));
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
    // Hermetic: no CLAUDE.md / .mcp.json pickup from the host machine.
    settingSources: [],
    ...extra,
  };
}

async function collect(prompt: string, options: Options): Promise<SDKMessage[]> {
  const out: SDKMessage[] = [];
  for await (const m of query({ prompt, options })) out.push(m);
  return out;
}

function lastResult(messages: SDKMessage[]): SDKResultMessage {
  const last = messages.at(-1);
  expect(last?.type).toBe('result');
  return last as SDKResultMessage;
}

/** Recursive { relPath -> content } dump of a directory tree. */
async function dumpTree(dir: string, prefix = ''): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return out;
  }
  for (const name of names.sort()) {
    const full = join(dir, name);
    const rel = prefix === '' ? name : `${prefix}/${name}`;
    if ((await stat(full)).isDirectory()) {
      Object.assign(out, await dumpTree(full, rel));
    } else {
      out[rel] = await readFile(full, 'utf8');
    }
  }
  return out;
}

const CREATE_CMD = {
  command: 'create',
  path: '/memories/notes.md',
  file_text: 'first line\nsecond line\n',
};

describe('memory public constants + primitive-backend export', () => {
  it('the public constants match the official wire values', () => {
    expect(MEMORY_TOOL_NAME).toBe('memory');
    expect(MEMORY_SERVER_TOOL).toEqual({ type: 'memory_20250818', name: 'memory' });
    expect(MEMORY_INDEX_PATH).toBe('/memories/MEMORY.md');
  });

  it('createLocalMemoryFileOps + createMemoryStore compose into a working store', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bpt-mem-ops-'));
    try {
      const store = createMemoryStore(createLocalMemoryFileOps(join(dir, 'memories')));
      await store.create('/memories/x.txt', 'hello');
      expect(await store.view('/memories/x.txt')).toBe(
        "Here's the content of /memories/x.txt with line numbers:\n     1\thello",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('memory mode A (native, Anthropic transport)', () => {
  it('advertises ONLY the official typed entry, executes the call, injects no protocol prompt', async () => {
    const stub = makeSSEFetch([
      toolUseReplyEvents('memory', CREATE_CMD),
      textReplyEvents('done'),
    ]);
    const messages = await collect('remember this', baseOptions(stub, { memory: { sessionEndUpdate: false } }));
    const result = lastResult(messages);
    expect(result.subtype).toBe('success');

    // Wire shape (R2 mode A): typed entry present, schema entry absent.
    const tools = stub.requests[0]!.body['tools'] as Array<Record<string, unknown>>;
    const typed = tools.filter((t) => t['type'] === 'memory_20250818');
    expect(typed).toEqual([{ type: 'memory_20250818', name: 'memory' }]);
    expect(
      tools.some((t) => t['name'] === 'memory' && t['input_schema'] !== undefined),
    ).toBe(false);

    // No SDK-side protocol prompt in native mode (the API injects it).
    expect(JSON.stringify(stub.requests[0]!.body['system'] ?? '')).not.toContain(
      'MEMORY PROTOCOL',
    );

    // The builtin executed the server-declared tool call: golden tool_result
    // on the wire and the artifact on disk (default store under <cwd>).
    const secondBody = stub.requests[1]!.body;
    const lastUser = (secondBody['messages'] as Array<Record<string, unknown>>).at(-1)!;
    expect(JSON.stringify(lastUser['content'])).toContain(
      'File created successfully at: /memories/notes.md',
    );
    expect(
      await readFile(join(cwd, '.claude', 'memory', 'memories', 'notes.md'), 'utf8'),
    ).toBe('first line\nsecond line\n');

    // No permission prompting was needed (implicit allow; official parity).
    expect(result.permission_denials).toEqual([]);

    // The init message lists the memory tool.
    const init = messages.find((m) => m.type === 'system' && m.subtype === 'init');
    expect((init as { tools: string[] }).tools).toContain('memory');
  });
});

describe('memory mode B (custom tool)', () => {
  it('advertises the six-command schema and injects the docs-verbatim protocol + instructions', async () => {
    const stub = makeSSEFetch([textReplyEvents('ok')]);
    await collect(
      'hi',
      baseOptions(stub, {
        memory: { mode: 'custom', sessionEndUpdate: false, instructions: 'Only record facts about the SDK.' },
      }),
    );
    const body = stub.requests[0]!.body;
    const tools = body['tools'] as Array<Record<string, unknown>>;
    const custom = tools.find((t) => t['name'] === 'memory');
    expect(custom).toBeDefined();
    expect(custom!['input_schema']).toBeDefined();
    expect(custom!['type']).toBeUndefined();
    expect(tools.some((t) => t['type'] === 'memory_20250818')).toBe(false);

    const system = JSON.stringify(body['system']);
    expect(system).toContain('ALWAYS VIEW YOUR MEMORY DIRECTORY BEFORE DOING ANYTHING ELSE.');
    expect(system).toContain('ASSUME INTERRUPTION');
    expect(system).toContain('Only record facts about the SDK.');
    // The injected fragment is the docs-faithful reproduction.
    expect(MEMORY_PROTOCOL_FRAGMENT.faithful).toBe(true);
  });
});

describe('memory mode selection (R2)', () => {
  it('auto-selects native on the Anthropic protocol and custom on openai-chat', () => {
    const anthropicRt = resolveMemoryRuntime({
      memory: {},
      cwd,
      protocol: 'anthropic',
      debug: () => {},
    });
    expect(anthropicRt.mode).toBe('native');
    expect(anthropicRt.serverTools).toEqual([{ type: 'memory_20250818', name: 'memory' }]);

    const openaiRt = resolveMemoryRuntime({
      memory: {},
      cwd,
      protocol: 'openai-chat',
      debug: () => {},
    });
    expect(openaiRt.mode).toBe('custom');
    expect(openaiRt.serverTools).toBeUndefined();
  });

  it('forcing native onto an openai-chat provider is a configuration error', () => {
    expect(() =>
      query({
        prompt: 'x',
        options: {
          cwd,
          sessionDir,
          provider: { protocol: 'openai-chat', apiKey: 'k' },
          memory: { mode: 'native' },
        },
      }),
    ).toThrow(ConfigurationError);
  });

  it('the OpenAI request encoder drops server-declared typed entries honestly', () => {
    const body = encodeOpenAIRequest({
      model: 'gpt-test',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        { name: 'memory', description: 'd', input_schema: { type: 'object' } },
        { type: 'memory_20250818', name: 'memory' },
      ],
    });
    const tools = body['tools'] as Array<{ function: { name: string } }>;
    expect(tools).toHaveLength(1);
    expect(tools[0]!.function.name).toBe('memory');
  });

  it('bare-name disallowedTools removes the memory system outright', async () => {
    const stub = makeSSEFetch([textReplyEvents('ok')]);
    await collect(
      'hi',
      baseOptions(stub, { memory: { sessionEndUpdate: false }, disallowedTools: ['memory'] }),
    );
    const body = stub.requests[0]!.body;
    expect(JSON.stringify(body['tools'])).not.toContain('memory_20250818');
    expect(JSON.stringify(body['system'])).not.toContain('MEMORY PROTOCOL');
  });

  it('enabled:false disables without unsetting the option object', async () => {
    const stub = makeSSEFetch([textReplyEvents('ok')]);
    const messages = await collect(
      'hi',
      baseOptions(stub, { memory: { enabled: false } }),
    );
    expect(JSON.stringify(stub.requests[0]!.body['tools'])).not.toContain('memory_20250818');
    const init = messages.find((m) => m.type === 'system' && m.subtype === 'init');
    expect((init as { tools: string[] }).tools).not.toContain('memory');
  });
});

describe('R2 acceptance: dual-mode consistency (store artifacts diff empty)', () => {
  it('the same scripted command sequence leaves identical artifacts in both modes', async () => {
    const script = () => [
      toolUseReplyEvents('memory', CREATE_CMD, { id: 'toolu_a' }),
      toolUseReplyEvents(
        'memory',
        {
          command: 'str_replace',
          path: '/memories/notes.md',
          old_str: 'second line',
          new_str: 'edited line',
        },
        { id: 'toolu_b' },
      ),
      toolUseReplyEvents(
        'memory',
        { command: 'insert', path: '/memories/notes.md', insert_line: 0, insert_text: 'title' },
        { id: 'toolu_c' },
      ),
      toolUseReplyEvents(
        'memory',
        { command: 'rename', old_path: '/memories/notes.md', new_path: '/memories/final.md' },
        { id: 'toolu_d' },
      ),
      textReplyEvents('done'),
    ];

    const nativeBase = await mkdtemp(join(tmpdir(), 'bpt-mem-native-'));
    const customBase = await mkdtemp(join(tmpdir(), 'bpt-mem-custom-'));
    try {
      const nativeMsgs = await collect(
        'go',
        baseOptions(makeSSEFetch(script()), { memory: { baseDir: nativeBase, sessionEndUpdate: false } }),
      );
      const customMsgs = await collect(
        'go',
        baseOptions(makeSSEFetch(script()), {
          memory: { mode: 'custom', baseDir: customBase, sessionEndUpdate: false },
        }),
      );
      expect(lastResult(nativeMsgs).subtype).toBe('success');
      expect(lastResult(customMsgs).subtype).toBe('success');

      const nativeTree = await dumpTree(nativeBase);
      const customTree = await dumpTree(customBase);
      expect(Object.keys(nativeTree)).toEqual(['memories/final.md']);
      expect(customTree).toEqual(nativeTree);
    } finally {
      await rm(nativeBase, { recursive: true, force: true });
      await rm(customBase, { recursive: true, force: true });
    }
  });
});

describe('R6: resident memory index injection', () => {
  async function seedIndex(content: string): Promise<void> {
    const dir = join(cwd, '.claude', 'memory', 'memories');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'MEMORY.md'), content, 'utf8');
  }

  it('injects the head of /memories/MEMORY.md into the system prompt', async () => {
    await seedIndex('# Project state\n- feature A done\n- feature B next\n');
    const stub = makeSSEFetch([textReplyEvents('ok')]);
    await collect('hi', baseOptions(stub, { memory: { sessionEndUpdate: false } }));
    const system = JSON.stringify(stub.requests[0]!.body['system']);
    expect(system).toContain('# Memory index');
    expect(system).toContain('feature A done');
    expect(system).toContain('feature B next');
    expect(system).not.toContain('truncated');
  });

  it('truncates at maxLines and says so', async () => {
    await seedIndex('l1\nl2\nl3\nl4\nl5\n');
    const stub = makeSSEFetch([textReplyEvents('ok')]);
    await collect(
      'hi',
      baseOptions(stub, { memory: { sessionEndUpdate: false, indexInjection: { maxLines: 2 } } }),
    );
    const system = JSON.stringify(stub.requests[0]!.body['system']);
    expect(system).toContain('l1');
    expect(system).toContain('l2');
    expect(system).not.toContain('l3');
    expect(system).toContain('truncated');
  });

  it('truncates at maxBytes on whole-line boundaries', async () => {
    await seedIndex(`${'a'.repeat(80)}\n${'b'.repeat(80)}\n${'c'.repeat(80)}\n`);
    const stub = makeSSEFetch([textReplyEvents('ok')]);
    await collect(
      'hi',
      baseOptions(stub, { memory: { sessionEndUpdate: false, indexInjection: { maxBytes: 170 } } }),
    );
    const system = JSON.stringify(stub.requests[0]!.body['system']);
    expect(system).toContain('a'.repeat(80));
    expect(system).toContain('b'.repeat(80));
    expect(system).not.toContain('c'.repeat(80));
    expect(system).toContain('truncated');
  });

  it('missing index file means zero injection and zero errors', async () => {
    const stub = makeSSEFetch([textReplyEvents('ok')]);
    const messages = await collect('hi', baseOptions(stub, { memory: { sessionEndUpdate: false } }));
    expect(lastResult(messages).subtype).toBe('success');
    expect(JSON.stringify(stub.requests[0]!.body['system'])).not.toContain('# Memory index');
  });

  it('indexInjection: false disables injection even when the file exists', async () => {
    await seedIndex('# should not appear\n');
    const stub = makeSSEFetch([textReplyEvents('ok')]);
    await collect('hi', baseOptions(stub, { memory: { sessionEndUpdate: false, indexInjection: false } }));
    expect(JSON.stringify(stub.requests[0]!.body['system'])).not.toContain('# Memory index');
  });
});
