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
 * standing clean-room boundary: the public SDKMessage stream only.
 */

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

export async function runScenario(armKind, scenario, { timeoutMs = 120_000 } = {}) {
  const query = await loadQuery(armKind);
  const cwd = mkdtempSync(join(tmpdir(), `conf-${armKind}-`));
  for (const [name, content] of Object.entries(scenario.fixtureFiles ?? {})) {
    writeFileSync(join(cwd, name), content);
  }
  // Scenario fixture paths are built against the run cwd by the caller.
  const scripts = scenario.buildScripts ? scenario.buildScripts(cwd) : scenario.scripts;
  const emulator = await startEmulator(scripts);

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

  const messages = [];
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let error;
  try {
    const q = query({
      prompt: scenario.prompt,
      options: {
        abortController: ac,
        cwd,
        maxTurns: 4,
        env,
        // Session persistence is engine-internal state, not stream grammar;
        // keep this SDK's store inside the throwaway cwd.
        ...(armKind === 'bpt' ? { sessionDir: join(cwd, '.sessions') } : {}),
      },
    });
    for await (const m of q) messages.push(m);
  } catch (err) {
    error = String(err?.message ?? err).slice(0, 300);
  } finally {
    clearTimeout(timer);
    await emulator.close();
    rmSync(cwd, { recursive: true, force: true });
  }

  const normalized = normalizeStream(messages);
  return {
    arm: armKind,
    scenario: scenario.id,
    error,
    ...normalized,
    emulatorProfile: {
      requests: emulator.profile.requests,
      otherEndpoints: emulator.profile.otherEndpoints,
      unscriptedCalls: emulator.profile.unscriptedCalls,
    },
  };
}
