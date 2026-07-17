/**
 * Regression locks for the T49 batch-D low-severity fixes (audit 2026-07-17,
 * silver-core-sdk-bug-audit-20260717.md). One test per behavior-visible fix
 * that is reachable through an exported surface; fixes whose only observable
 * is internal wiring are covered by the existing suites they run under.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { estimateMessagesTokens } from '../src/engine/tokens.js';
import { outputCeilingFor } from '../src/engine/context-window.js';
import { looksBinary } from '../src/tools/fsutil.js';
import { truncateViewBody, viewTruncationNotice } from '../src/tools/memory/store.js';
import { validateMemoryPath, MemoryPathError } from '../src/tools/memory/paths.js';
import { parseVerdict } from '../src/verifier/index.js';
import { parseContextTip, parseTipReception } from '../src/tips/index.js';
import { auditToolClaims } from '../src/sessions/tool-claims.js';
import { extractJsonObject } from '../src/generators/runtime.js';
import { parseAwaySummary, parseCommandPrefix } from '../src/generators/index.js';
import { readWindow } from '../src/reporting/runtime-report.js';
import { multiEditTool } from '../src/tools/multiedit.js';
import { grepTool } from '../src/tools/grep.js';
import type { ToolContext } from '../src/internal/contracts.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'batch-d-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function makeCtx(cwd: string): ToolContext {
  return {
    cwd,
    env: {},
    signal: new AbortController().signal,
    debug: () => undefined,
    readFilePaths: new Set<string>(),
  } as unknown as ToolContext;
}

describe('L5: message token cache invalidates on in-place text growth', () => {
  it('re-estimates when a block text is rewritten with the same block count', () => {
    const msg = {
      role: 'user' as const,
      content: [{ type: 'text' as const, text: 'hi' }],
    };
    const small = estimateMessagesTokens([msg]);
    (msg.content[0] as { text: string }).text = 'x'.repeat(4000);
    const big = estimateMessagesTokens([msg]);
    expect(big).toBeGreaterThan(small + 500);
  });
});

describe('L9: per-model output ceiling table', () => {
  it('knows lower legacy ceilings and returns undefined for unknown ids', () => {
    expect(outputCeilingFor('claude-3-haiku-20240307')).toBe(4_096);
    expect(outputCeilingFor('claude-opus-4-8')).toBe(32_000);
    expect(outputCeilingFor('claude-sonnet-4-5')).toBe(64_000);
    expect(outputCeilingFor('some-gateway-model')).toBeUndefined();
  });
});

describe('L20: binary sniff covers the whole buffer', () => {
  it('flags a NUL byte past the first 8KB', () => {
    const buf = Buffer.concat([Buffer.alloc(10_000, 0x61), Buffer.from([0])]);
    expect(looksBinary(buf)).toBe(true);
    expect(looksBinary(Buffer.alloc(10_000, 0x61))).toBe(false);
  });
});

describe('L25: truncateViewBody is idempotent over already-truncated output', () => {
  it('does not re-cut a body that already carries the notice', () => {
    const body = `1\tline\n${viewTruncationNotice(10)}`;
    // body.length exceeds the cap, but the trailing notice marks it as
    // already-truncated engine output.
    expect(truncateViewBody(body, 10)).toBe(body);
  });
});

describe('L28: memory paths refuse control characters', () => {
  it('rejects TAB / newline in a segment', () => {
    expect(() => validateMemoryPath('/memories/a\tb.md')).toThrow(MemoryPathError);
    expect(() => validateMemoryPath('/memories/a\nb.md')).toThrow(MemoryPathError);
    expect(validateMemoryPath('/memories/ok.md')).toBe('/memories/ok.md');
  });
});

describe('L46: verifier marks fail-closed verdicts from garbled replies', () => {
  it('sets parseFailed on an unparseable JSON-attempt reply', () => {
    const r = parseVerdict('{"verdict": "CONFIR');
    expect(r.verdict).toBe('REFUTED');
    expect(r.parseFailed).toBe(true);
  });
  it('a real REFUTED verdict carries no parseFailed', () => {
    const r = parseVerdict('{"verdict":"REFUTED","rationale":"not a bug"}');
    expect(r.verdict).toBe('REFUTED');
    expect(r.parseFailed).toBeUndefined();
  });
});

describe('L47/L66: tips id casing + reception fail-safe', () => {
  it('matches a re-cased feature_id and returns the canonical id', () => {
    const catalog = [
      { featureId: 'Manual-Polling', situation: 's', tip: 't', action: 'a' },
    ] as never;
    const d = parseContextTip(
      '{"has_tip":true,"tip":"try it","feature_id":"manual-polling"}',
      ['Manual-Polling'],
      catalog,
    );
    expect(d.hasTip).toBe(true);
    expect(d).toMatchObject({ featureId: 'Manual-Polling', action: 'a' });
  });
  it('unrecognized reception maps to unknown, not neutral', () => {
    expect(parseTipReception('{"acted_on":false,"reception":"meh"}').reception).toBe(
      'unknown',
    );
  });
});

describe('L52: auditToolClaims reports every unbacked claim in one text', () => {
  it('flags two claim lines in a single assistant message', () => {
    const text = 'I ran the tests and they pass.\nsome filler\nI ran the tests again.';
    const findings = auditToolClaims({
      assistantTexts: [text],
      toolCalls: [],
      detectors: [
        {
          id: 'ran-tests',
          claimPattern: /I ran the tests/,
          backedBy: () => false,
        },
      ],
    });
    expect(findings).toHaveLength(2);
  });
});

describe('L67: extractJsonObject refuses a nested fragment of a truncated object', () => {
  it('returns null when the top-level object never closes', () => {
    expect(extractJsonObject('note {"a": {"b": 1}')).toBeNull();
  });
  it('still recovers a later object after a CLOSED unparseable group', () => {
    expect(extractJsonObject('use {placeholder} then {"x":1}')).toEqual({ x: 1 });
  });
});

describe('L70: parseAwaySummary keeps literal * and unpaired backticks', () => {
  it('preserves a glob star', () => {
    expect(parseAwaySummary('ran tests on *.ts files')).toBe('ran tests on *.ts files');
  });
  it('still unwraps paired markers', () => {
    expect(parseAwaySummary('did **bold** and `code`')).toBe('did bold and code');
  });
});

describe('L71: decorated injection sentinel fails closed', () => {
  it('a sentinel with trailing decoration is injection', () => {
    expect(parseCommandPrefix('command_injection_detected (chained curl)')).toEqual({
      kind: 'injection',
    });
  });
  it('a genuine prefix containing the word stays a prefix', () => {
    expect(parseCommandPrefix('echo command_injection_detected')).toEqual({
      kind: 'prefix',
      prefix: 'echo command_injection_detected',
    });
  });
});

describe('L43: runtime-report counts unparseable timestamps as bad lines', () => {
  it('a NaN-date record lands in badLines, not silently skipped', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'batch-d-runlog-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const day = new Date().toISOString().slice(0, 10);
    writeFileSync(
      join(dir, `runlog-${day}.jsonl`),
      `${JSON.stringify({ ts: '2026-13-99T00:00:00Z', session_id: 's', is_error: false, num_turns: 1, duration_ms: 1, total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } })}\n`,
    );
    const win = await readWindow(
      dir,
      new Date(Date.now() - 86_400_000),
      new Date(Date.now() + 86_400_000),
    );
    expect(win.records).toHaveLength(0);
    expect(win.badLines).toBe(1);
  });
});

describe('L19: MultiEdit net-zero chain is a no-op success', () => {
  it('A->B then B->A succeeds without writing', async () => {
    const dir = await tempDir();
    const file = join(dir, 'f.txt');
    await writeFile(file, 'hello A world', 'utf8');
    const ctx = makeCtx(dir);
    (ctx.readFilePaths as Set<string>).add(file);
    const res = await multiEditTool.execute(
      {
        file_path: file,
        edits: [
          { old_string: 'A', new_string: 'B' },
          { old_string: 'B', new_string: 'A' },
        ],
      },
      ctx,
    );
    expect(res.isError).not.toBe(true);
    expect(String(res.content)).toContain('net zero');
  });
});

describe('L17: grep offset past all results names the real match count', () => {
  it('does not claim "No matches found" when matches exist', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'a.txt'), 'NEEDLE\n', 'utf8');
    const res = await grepTool.execute(
      { pattern: 'NEEDLE', path: dir, output_mode: 'content', offset: 50 },
      makeCtx(dir),
    );
    const content = String(res.content);
    expect(content).not.toBe('No matches found');
    expect(content).toContain('Matches exist');
  });
});
