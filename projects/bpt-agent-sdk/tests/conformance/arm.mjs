/**
 * Shared arm driver: run one scenario through EITHER engine against a fresh
 * content-blind emulator instance, and return the normalized stream.
 *
 * armKind 'bpt'      -> this SDK's built dist (npm run build first)
 * armKind 'official' -> @anthropic-ai/claude-agent-sdk, installed transiently
 *                       (`npm i --no-save` per tests/conformance/pins.json);
 *                       its spawned claude-code engine follows
 *                       ANTHROPIC_BASE_URL to the emulator (spike-proven).
 *
 * Both arms receive identical prompt/cwd/env. Observation stays inside the
 * standing clean-room boundary: the public SDKMessage stream plus filesystem
 * side effects in the scenario's own throwaway cwd - request bodies are never
 * read (the emulator enforces that; nothing here weakens it).
 *
 * L3 extensions (all OPTIONAL and additive - L1 scenarios run unchanged):
 *   fixtureFiles values may be `{ content, mtime }` (utimes pin for
 *     deterministic mtime ordering) or `{ dir: true }` (empty directory),
 *     and fixture names may contain subdirectories.
 *   scenario.needsOutsideDir      - create a second mkdtemp OUTSIDE the cwd
 *     (containment-policy cases); fixtures via scenario.outsideFixtureFiles.
 *   scenario.buildScripts(cwd, ctx) - ctx = { outsideDir, state } where state
 *     is a per-run scratch object returned in the result. Script entries may
 *     be FUNCTIONS `(observedMessages) => script`, materialized lazily at
 *     request time so a later turn can splice stream-harvested data (e.g. a
 *     background shell id read from a PUBLIC tool_result) into its input.
 *     Discipline: a dynamic entry must not depend on the message emitted by
 *     the turn IMMEDIATELY before it (stdout delivery can race the next HTTP
 *     request); scenarios insert a settle-barrier turn in between.
 *   scenario.options / scenario.buildOptions(cwd, ctx) - extra Options merged
 *     into the query (e.g. allowedTools so both arms auto-approve write tools;
 *     preferred over bypassPermissions, which claude-code refuses when running
 *     as root without IS_SANDBOX=1 - a real CI risk).
 *   scenario.maxTurns             - longer scripted chains (default stays 4).
 *   scenario.captureFiles         - relative paths whose bytes are captured
 *     from the cwd AFTER the run (before cleanup) for hard side-effect
 *     assertions; missing file -> null.
 *   scenario.afterQuery(q, { cwd, ctx, messages }) - post-stream hook on the
 *     live Query (e.g. rewindFiles lock); its return value lands in the
 *     result. Only invoked when the stream completed without throwing.
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { startEmulator } from './emulator.mjs';
import { normalizeStream } from './normalize.mjs';

const DUMMY_KEY = 'sk-ant-api03-' + 'A'.repeat(95);

async function loadQuery(armKind) {
  if (armKind === 'bpt') {
    const mod = await import('../../dist/index.js');
    return mod.query;
  }
  const mod = await import('@anthropic-ai/claude-agent-sdk');
  return mod.query;
}

/**
 * Write fixture entries into baseDir. A value is a plain string (L1 shape),
 * `{ dir: true }` for an empty directory, or `{ content, mtime }` where mtime
 * is an ISO timestamp pinned via utimes. Pins are applied AFTER every write
 * so a later sibling write cannot disturb an already-pinned ordering.
 */
function writeFixtures(baseDir, fixtures) {
  const mtimePins = [];
  for (const [name, spec] of Object.entries(fixtures ?? {})) {
    const target = join(baseDir, name);
    if (spec !== null && typeof spec === 'object' && spec.dir === true) {
      mkdirSync(target, { recursive: true });
      continue;
    }
    const content = typeof spec === 'string' ? spec : spec.content;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
    if (typeof spec === 'object' && typeof spec.mtime === 'string') {
      mtimePins.push([target, new Date(spec.mtime)]);
    }
  }
  for (const [target, when] of mtimePins) {
    utimesSync(target, when, when);
  }
}

/** Text of a tool_result block (string content or joined text sub-blocks). */
function textOfToolResult(block) {
  const c = block?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .filter((b) => b?.type === 'text')
      .map((b) => b.text ?? '')
      .join('\n');
  }
  return '';
}

/**
 * Extract every tool_result block from the PUBLIC stream, in emission order.
 * This is the L3 observable: engine-produced tool output, never request-body
 * content. KD-05 batching (one user message with many blocks vs many user
 * messages) is transparent here because blocks are flattened in order.
 */
export function extractToolResults(messages) {
  const out = [];
  for (const m of messages) {
    if (m?.type !== 'user') continue;
    const content = Array.isArray(m.message?.content) ? m.message.content : [];
    for (const b of content) {
      if (b?.type === 'tool_result') {
        out.push({
          toolUseId: b.tool_use_id ?? null,
          isError: b.is_error === true,
          text: textOfToolResult(b),
        });
      }
    }
  }
  return out;
}

/**
 * Wrap the script list so function entries materialize at request time with
 * the messages observed SO FAR. Only numeric index access is intercepted -
 * the emulator reads scripts[i] synchronously, so materialization must be
 * synchronous too (hence the settle-barrier discipline documented above).
 */
function materializeScripts(entries, observedMessages) {
  return new Proxy(entries, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);
      if (typeof v === 'function' && /^\d+$/.test(String(prop))) {
        return v(observedMessages);
      }
      return v;
    },
  });
}

/** realpath that degrades to the input (path may already be gone). */
function safeRealpath(p) {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

export async function runScenario(armKind, scenario, { timeoutMs = 120_000 } = {}) {
  const query = await loadQuery(armKind);
  const cwd = mkdtempSync(join(tmpdir(), `conf-${armKind}-`));
  const realCwd = safeRealpath(cwd);
  writeFixtures(cwd, scenario.fixtureFiles);

  let outsideDir;
  let realOutsideDir;
  if (scenario.needsOutsideDir === true) {
    outsideDir = mkdtempSync(join(tmpdir(), 'conf-outside-'));
    realOutsideDir = safeRealpath(outsideDir);
    writeFixtures(outsideDir, scenario.outsideFixtureFiles);
  }

  const ctx = { outsideDir, state: {} };
  // Scenario fixture paths are built against the run cwd by the caller.
  const rawScripts = scenario.buildScripts
    ? scenario.buildScripts(cwd, ctx)
    : scenario.scripts;

  const messages = [];
  const emulator = await startEmulator(materializeScripts(rawScripts, messages));

  const env = {
    ...process.env,
    ANTHROPIC_BASE_URL: emulator.url,
    ANTHROPIC_API_KEY: DUMMY_KEY,
    ANTHROPIC_AUTH_TOKEN: '',
    ANTHROPIC_MODEL: '',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1',
  };

  const extraOptions = scenario.buildOptions
    ? scenario.buildOptions(cwd, ctx)
    : (scenario.options ?? {});

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let error;
  let afterQueryResult;
  const files = {};
  try {
    const q = query({
      prompt: scenario.prompt,
      options: {
        abortController: ac,
        cwd,
        maxTurns: scenario.maxTurns ?? 4,
        env,
        // Session persistence is engine-internal state, not stream grammar;
        // keep this SDK's store inside the throwaway cwd.
        ...(armKind === 'bpt' ? { sessionDir: join(cwd, '.sessions') } : {}),
        ...extraOptions,
      },
    });
    for await (const m of q) messages.push(m);
    if (typeof scenario.afterQuery === 'function') {
      afterQueryResult = await scenario.afterQuery(q, { cwd, ctx, messages });
    }
  } catch (err) {
    error = String(err?.message ?? err).slice(0, 300);
  } finally {
    clearTimeout(timer);
    await emulator.close();
    // Hard side-effect capture happens BEFORE cleanup, error or not - a
    // half-run's file state is still evidence.
    for (const rel of scenario.captureFiles ?? []) {
      try {
        files[rel] = readFileSync(join(cwd, rel), 'utf8');
      } catch {
        files[rel] = null;
      }
    }
    rmSync(cwd, { recursive: true, force: true });
    if (outsideDir !== undefined) {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  }

  const normalized = normalizeStream(messages);
  return {
    arm: armKind,
    scenario: scenario.id,
    error,
    ...normalized,
    toolResults: extractToolResults(messages),
    files,
    state: ctx.state,
    afterQuery: afterQueryResult,
    pathInfo: { cwd, realCwd, outsideDir, realOutsideDir },
    emulatorProfile: {
      requests: emulator.profile.requests,
      otherEndpoints: emulator.profile.otherEndpoints,
      unscriptedCalls: emulator.profile.unscriptedCalls,
    },
  };
}
