/**
 * Legacy-consumer conformance: a consumer written against the 0.3x line
 * (bpt-agent-sdk 0.30.0–0.39.0, the black-pool BPT pin era) keeps working,
 * unchanged, on the current build.
 *
 * Two layers:
 *  1. SURFACE LOCK — every public export (value and type) and every `Options`
 *     field frozen in tests/fixtures/legacy-0-3x-surface.json (enumerated with
 *     the TypeScript compiler against the historical trees; commits recorded
 *     in the fixture's _meta) must still exist today. The single sanctioned
 *     removal (`Options.harnessPromptVariant`, gone in 0.33.0) is pinned as a
 *     KNOWN removal so the migration doc stays honest: it must stay absent.
 *  2. CONSUMPTION PATTERNS — representative 0.3x-era call shapes (options a
 *     0.3x consumer could have written, canUseTool / hooks signatures, the
 *     result-message fields it read, session resume, the void-ignoring
 *     `await q.interrupt()`) run against the REAL stack with the local
 *     Messages-API emulator (keyless, in the normal `npm test`).
 *
 * If a change reds a case here, it is a drop-in break for a 0.3x-pinned
 * consumer: either restore compatibility or document it as a breaking entry
 * in docs/MIGRATION-0.3x-to-0.68.md (and re-freeze deliberately).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import * as sdk from '../src/index.js';
import { query } from '../src/index.js';
import type { Options, PermissionResult, SDKMessage } from '../src/index.js';
import fixture from './fixtures/legacy-0-3x-surface.json' with { type: 'json' };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, '..', 'src', 'index.ts');

// ---------------------------------------------------------------------------
// 1. Surface lock
// ---------------------------------------------------------------------------

interface Surface {
  values: Set<string>;
  types: Set<string>;
  optionsFields: Set<string>;
}

/** Enumerate the CURRENT public surface the same way the fixture was built. */
function enumerateCurrentSurface(): Surface {
  const program = ts.createProgram([ENTRY], {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
    strict: false,
    skipLibCheck: true,
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(ENTRY);
  if (!sf) throw new Error('entry source file not found: ' + ENTRY);
  const modSym = checker.getSymbolAtLocation(sf);
  if (!modSym) throw new Error('no module symbol for entry');
  const values = new Set<string>();
  const types = new Set<string>();
  for (const sym of checker.getExportsOfModule(modSym)) {
    const resolved =
      sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
    const decl = sym.declarations?.[0];
    const typeOnly =
      decl !== undefined &&
      ts.isExportSpecifier(decl) &&
      (decl.isTypeOnly || decl.parent.parent.isTypeOnly);
    if ((resolved.flags & ts.SymbolFlags.Value) !== 0 && !typeOnly) values.add(sym.name);
    else types.add(sym.name);
  }
  const optionsSym = checker
    .getExportsOfModule(modSym)
    .find((s) => s.name === 'Options');
  if (!optionsSym) throw new Error('Options is not exported');
  const optionsResolved =
    optionsSym.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(optionsSym)
      : optionsSym;
  const optionsFields = new Set(
    checker
      .getDeclaredTypeOfSymbol(optionsResolved)
      .getProperties()
      .map((p) => p.name),
  );
  return { values, types, optionsFields };
}

const KNOWN_REMOVED_OPTIONS_FIELDS = new Set(
  Object.keys(fixture._meta.knownRemovals)
    .filter((k) => k.startsWith('Options.'))
    .map((k) => k.slice('Options.'.length)),
);

describe('legacy 0.3x surface lock (fixture: legacy-0-3x-surface.json)', () => {
  // One compiler program shared across the assertions below (it is the slow part).
  const current = enumerateCurrentSurface();

  // 0.37.1 is the ACTUAL black-pool BPT pin (keeper, 2026-07-12); 0.30.0 and
  // 0.39.0 bracket the whole 0.3x line. See the fixture _meta for the
  // 0.37.1/0.38.0 twin-build caveat (identical surfaces, one entry covers both).
  for (const version of ['0.30.0', '0.37.1', '0.39.0'] as const) {
    const frozen = fixture[version];

    it(`every ${version} VALUE export is still a value export`, () => {
      const missing = frozen.valueExports.filter(
        (name) => !current.values.has(name),
      );
      expect(missing).toEqual([]);
      // And they are real runtime bindings, not just compiler symbols.
      const unbound = frozen.valueExports.filter(
        (name) => (sdk as Record<string, unknown>)[name] === undefined,
      );
      expect(unbound).toEqual([]);
    });

    it(`every ${version} TYPE export is still exported`, () => {
      // A former type-only name may legally be PROMOTED to a value export
      // (value exports also carry their type); it must not vanish.
      const missing = frozen.typeExports.filter(
        (name) => !current.types.has(name) && !current.values.has(name),
      );
      expect(missing).toEqual([]);
    });

    it(`every ${version} Options field still exists (minus pinned known removals)`, () => {
      const missing = frozen.optionsFields.filter(
        (name) =>
          !current.optionsFields.has(name) &&
          !KNOWN_REMOVED_OPTIONS_FIELDS.has(name),
      );
      expect(missing).toEqual([]);
    });
  }

  it('the pinned known removals are really gone (doc honesty guard)', () => {
    for (const field of KNOWN_REMOVED_OPTIONS_FIELDS) {
      expect(current.optionsFields.has(field)).toBe(false);
    }
    // If this ever flips (the field returns), the migration doc's "breaking"
    // entry is stale — update docs/MIGRATION-0.3x-to-0.68.md and the fixture.
  });
});

// ---------------------------------------------------------------------------
// 2. Consumption patterns (real stack, local emulator, keyless)
// ---------------------------------------------------------------------------

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
  sse(res, 'content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  });
  sse(res, 'content_block_delta', {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text },
  });
  sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
  sse(res, 'message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 20 },
  });
  sse(res, 'message_stop', { type: 'message_stop' });
  res.end();
}
function streamToolUse(
  res: http.ServerResponse,
  model: string,
  id: string,
  name: string,
  input: unknown,
): void {
  msgStart(res, model);
  sse(res, 'content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'tool_use', id, name, input: {} },
  });
  const json = JSON.stringify(input);
  sse(res, 'content_block_delta', {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'input_json_delta', partial_json: json.slice(0, 4) },
  });
  sse(res, 'content_block_delta', {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'input_json_delta', partial_json: json.slice(4) },
  });
  sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
  sse(res, 'message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'tool_use', stop_sequence: null },
    usage: { output_tokens: 15 },
  });
  sse(res, 'message_stop', { type: 'message_stop' });
  res.end();
}
function countToolTurns(messages: Array<{ role: string; content: unknown }>): number {
  return messages.filter(
    (m) =>
      m.role === 'user' &&
      Array.isArray(m.content) &&
      (m.content as Array<{ type: string }>).some((b) => b.type === 'tool_result'),
  ).length;
}

type EmulatorHandler = (
  toolTurns: number,
  model: string,
  res: http.ServerResponse,
  reqJson: { model: string; messages: Array<{ role: string; content: unknown }> },
) => void;

let server: http.Server | undefined;
let baseUrl = '';
let sandbox = '';

function startServer(handler: EmulatorHandler): Promise<void> {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c));
    req.on('end', () => {
      const reqJson = JSON.parse(body) as {
        model: string;
        messages: Array<{ role: string; content: unknown }>;
      };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      handler(countToolTurns(reqJson.messages), reqJson.model, res, reqJson);
    });
  });
  return new Promise((resolve) =>
    server!.listen(0, '127.0.0.1', () => {
      const addr = server!.address();
      baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
      resolve();
    }),
  );
}

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-0-3x-'));
});
afterEach(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = undefined;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

/**
 * Options exactly as a 0.3x consumer could have written them — every field
 * below existed on the 0.39.0 `Options` (fixture-frozen). Compile-time proof:
 * this object typechecks against the CURRENT `Options`.
 */
function legacyOptions(extra: Partial<Options> = {}): Options {
  return {
    provider: { apiKey: 'test-key', baseUrl },
    model: 'claude-emulator-1',
    cwd: sandbox,
    sessionDir: path.join(sandbox, '.sessions'),
    settingSources: [],
    sandbox: false,
    maxTurns: 20,
    ...extra,
  };
}

describe('legacy 0.3x consumption patterns on the current build (emulator)', () => {
  it('plain text round-trip: the result fields a 0.3x consumer read are all present', async () => {
    await startServer((_toolTurns, model, res) => streamText(res, model, 'pong'));

    const messages: SDKMessage[] = [];
    for await (const m of query({ prompt: 'ping', options: legacyOptions() })) {
      messages.push(m);
    }

    const init = messages.find(
      (m): m is Extract<SDKMessage, { type: 'system'; subtype: 'init' }> =>
        m.type === 'system' && m.subtype === 'init',
    );
    expect(init).toBeDefined();
    expect(init!.session_id).toBeTruthy();
    expect(init!.tools).toEqual(expect.arrayContaining(['Read', 'Write', 'Bash']));

    const result = messages[messages.length - 1];
    expect(result.type).toBe('result');
    if (result.type !== 'result') throw new Error('unreachable');
    // The exact fields the 0.3x-era consumer destructured:
    expect(result.subtype).toBe('success');
    if (result.subtype !== 'success') throw new Error('unreachable');
    expect(result.result).toBe('pong');
    expect(result.num_turns).toBeGreaterThan(0);
    expect(typeof result.total_cost_usd).toBe('number');
    expect(result.usage).toBeDefined();
    expect(result.session_id).toBe(init!.session_id);
    expect(typeof result.duration_ms).toBe('number');
  });

  it('tool loop with the 0.3x canUseTool + PreToolUse hook signatures', async () => {
    await startServer((toolTurns, model, res) => {
      switch (toolTurns) {
        case 0:
          return streamToolUse(res, model, 'tu_1', 'Write', {
            file_path: 'legacy.txt',
            content: 'written by a 0.3x-shaped consumer\n',
          });
        case 1:
          return streamToolUse(res, model, 'tu_2', 'Read', { file_path: 'legacy.txt' });
        default:
          return streamText(res, model, 'done');
      }
    });

    const gated: string[] = [];
    const hooked: string[] = [];
    const messages: SDKMessage[] = [];
    const q = query({
      prompt: 'write then read',
      options: legacyOptions({
        // 0.3x permission-callback shape, verbatim.
        canUseTool: async (toolName, input): Promise<PermissionResult> => {
          gated.push(toolName);
          return { behavior: 'allow', updatedInput: input };
        },
        // 0.3x hook-registration shape, verbatim.
        hooks: {
          PreToolUse: [
            {
              matcher: 'Write',
              hooks: [
                async (input) => {
                  hooked.push((input as { tool_name: string }).tool_name);
                  return { continue: true };
                },
              ],
            },
          ],
        },
      }),
    });
    for await (const m of q) messages.push(m);

    // The Write really landed on disk and the Read really read it back.
    expect(fs.readFileSync(path.join(sandbox, 'legacy.txt'), 'utf8')).toContain(
      'written by a 0.3x-shaped consumer',
    );
    expect(gated).toContain('Write');
    expect(hooked).toEqual(['Write']);
    const result = messages[messages.length - 1];
    expect(result.type).toBe('result');
    if (result.type === 'result') expect(result.subtype).toBe('success');
  });

  it('session resume, 0.3x shape: options.resume replays the prior conversation', async () => {
    const requestsSeen: Array<Array<{ role: string }>> = [];
    await startServer((_toolTurns, model, res, reqJson) => {
      requestsSeen.push(reqJson.messages.map((m) => ({ role: m.role })));
      streamText(res, model, `reply ${requestsSeen.length}`);
    });

    let sessionId: string | undefined;
    for await (const m of query({ prompt: 'first', options: legacyOptions() })) {
      if (m.type === 'system' && m.subtype === 'init') sessionId = m.session_id;
    }
    expect(sessionId).toBeTruthy();

    const second: SDKMessage[] = [];
    for await (const m of query({
      prompt: 'second',
      options: legacyOptions({ resume: sessionId }),
    })) {
      second.push(m);
    }

    const last = requestsSeen[requestsSeen.length - 1]!;
    // Resumed request carries the prior user+assistant turns before the new one.
    expect(last.length).toBeGreaterThanOrEqual(3);
    const result = second[second.length - 1];
    expect(result.type).toBe('result');
    if (result.type === 'result') {
      expect(result.subtype).toBe('success');
      expect(result.session_id).toBe(sessionId);
    }
  });

  it('await q.interrupt() ignoring the result stays source-compatible (0.40.0 widened the return)', async () => {
    await startServer((_toolTurns, model, res) => streamText(res, model, 'ok'));
    const q = query({ prompt: 'hi', options: legacyOptions() });
    // The 0.3x caller: `await q.interrupt();` with the result discarded.
    const ignoring: Promise<void> = q.interrupt().then(() => undefined);
    await ignoring;
    q.close();
  });
});
