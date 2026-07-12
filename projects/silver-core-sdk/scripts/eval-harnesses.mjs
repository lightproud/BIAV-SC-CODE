/**
 * Phase 2 eval harnesses (SCS-REQ-002 loop 2) — the fault-injection and
 * compaction-pressure drivers that unlock the 8 `driver: "manual"` questions
 * in evals/behavior/questions.json.
 *
 * Governance boundary: evals/ is the maintainer-protected question set
 * (scenario + rubric, MANIFEST-signed). This module deliberately lives in
 * scripts/ and keys runners by question id, so wiring a harness NEVER
 * touches the protected directory — the questions stay byte-identical, the
 * runner supplies the execution the scenario describes.
 *
 * Every fault is injected at the provider.fetch seam (the documented
 * BPT-EXTENSION injection point), riding the REAL Messages API underneath —
 * live model behavior, deterministic faults. Each runner returns a judge
 * evidence object ({ phases, harnessNotes, ... }); scoring stays in
 * run-evals.mjs with the pinned judge.
 *
 * This module also owns the workspace helpers (seedWorkspace / dumpMemory /
 * expandFixture) shared with run-evals.mjs — single source, no circular
 * import (run-evals imports from here).
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/* ------------------------------------------------------------ workspaces */

/** Expand "GENERATE:" fixture markers into deterministic content. */
export function expandFixture(value) {
  if (!value.startsWith('GENERATE:')) return value;
  const spec = value.slice('GENERATE:'.length);
  if (spec.includes('500-line')) {
    return (
      '# Memory index (oversized fixture)\n' +
      Array.from({ length: 499 }, (_, i) => `- fact ${i + 1}: fixture line for cap testing`).join(
        '\n',
      ) +
      '\n'
    );
  }
  if (spec.includes('2000-word')) {
    const filler = Array.from({ length: 2000 }, (_, i) => `word${i + 1}`).join(' ');
    return `${filler}\nCONCLUSION: adopt plan B.\n`;
  }
  throw new Error(`unknown GENERATE fixture: ${spec}`);
}

/** Seed harness files. seedMemory paths are /memories/... under baseDir. */
export function seedWorkspace(harness) {
  const cwd = mkdtempSync(join(tmpdir(), 'evals-ws-'));
  const memBase = join(cwd, '.eval-memory');
  for (const [rel, content] of Object.entries(harness.seedFiles ?? {})) {
    writeFileSync(join(cwd, rel), expandFixture(content));
  }
  for (const [vpath, content] of Object.entries(harness.seedMemory ?? {})) {
    const p = join(memBase, vpath.replace(/^\//, ''));
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, expandFixture(content));
  }
  return { cwd, memBase };
}

function readdirSyncSafe(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Dump the seeded memory tree after a run (evidence for the judge). */
export function dumpMemory(ws) {
  const out = {};
  const walk = (dir, prefix) => {
    for (const entry of readdirSyncSafe(dir)) {
      const p = join(dir, entry.name);
      const v = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(p, v);
      else {
        try {
          out[v] = readFileSync(p, 'utf8').slice(0, 8192);
        } catch {
          out[v] = '<unreadable>';
        }
      }
    }
  };
  walk(join(ws.memBase, 'memories'), '/memories');
  return out;
}

/** Dump named workspace files (side-effect evidence for the judge). */
function dumpFiles(ws, names) {
  const out = {};
  for (const name of names) {
    try {
      out[name] = readFileSync(join(ws.cwd, name), 'utf8').slice(0, 4096);
    } catch {
      out[name] = '<absent>';
    }
  }
  return out;
}

/* -------------------------------------------------------- fault injection */

/**
 * Build a provider.fetch that consults `plan(callIndex)` per transport POST
 * (1-based). Actions: 'pass' | 'fail' (network error before any byte) |
 * { cutAfterEvents: n } (forward the real response, then error the body
 * stream after >= n SSE events have been delivered).
 */
export function makeFaultFetch(plan) {
  let calls = 0;
  const real = globalThis.fetch;
  const injected = [];
  const wrapped = async (input, init) => {
    calls += 1;
    const action = plan(calls) ?? 'pass';
    if (action === 'fail') {
      injected.push({ call: calls, action: 'fail' });
      throw new TypeError('injected fault: connection refused');
    }
    const res = await real(input, init);
    if (typeof action === 'object' && action.cutAfterEvents > 0 && res.body !== null) {
      injected.push({ call: calls, action: `cut-after-${action.cutAfterEvents}-events` });
      return cutResponse(res, action.cutAfterEvents);
    }
    return res;
  };
  wrapped.ledger = injected;
  return wrapped;
}

/** Forward the SSE body until exactly n events flowed, then error the stream.
 *  The cut is byte-precise WITHIN a chunk (SSE events are '\n\n'-separated):
 *  a server that flushes the whole body in one chunk still gets cut mid-body,
 *  before message_stop can complete the turn. */
function cutResponse(res, cutAfterEvents) {
  const reader = res.body.getReader();
  let events = 0;
  const stream = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      // Scan raw bytes for '\n\n' (0x0A 0x0A) event separators.
      for (let i = 0; i + 1 < value.length; i += 1) {
        if (value[i] === 10 && value[i + 1] === 10) {
          events += 1;
          if (events >= cutAfterEvents) {
            controller.enqueue(value.slice(0, i + 2));
            try {
              await reader.cancel();
            } catch {
              /* upstream may already be closed */
            }
            controller.error(new TypeError('injected fault: stream cut mid-body'));
            return;
          }
        }
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return new Response(stream, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

/* ------------------------------------------------------------ drive loop */

/** Run one query and collect { transcript, result } (never throws on an
 *  error result — the error IS the evidence). */
async function drive(sdk, ws, { prompts, options }) {
  const merged = {
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    ...options,
    cwd: ws.cwd,
    sessionDir: join(ws.cwd, '.eval-sessions'),
  };
  if (merged.memory !== undefined && merged.memory !== null) {
    merged.memory = { ...merged.memory, baseDir: ws.memBase };
  }
  async function* input() {
    for (const p of prompts) {
      yield { type: 'user', message: { role: 'user', content: p }, parent_tool_use_id: null };
    }
  }
  const transcript = [];
  let result = null;
  const q = sdk.query({ prompt: prompts.length > 1 ? input() : prompts[0], options: merged });
  for await (const msg of q) {
    transcript.push(msg);
    if (msg.type === 'result') result = msg;
  }
  return { transcript, result };
}

function phaseEvidence(run) {
  return {
    transcript: run.transcript.slice(0, 200),
    result: run.result,
    transportHealth: run.result?.metrics?.transportHealth ?? null,
  };
}

function sessionIdOf(run) {
  for (const m of run.transcript) {
    if (typeof m.session_id === 'string') return m.session_id;
  }
  return null;
}

/** Per-API-request prompt-size series (tok-04): assistant messages carry the
 *  response usage, so each one stands for one Messages API request. */
function requestSeries(transcript) {
  const series = [];
  for (const m of transcript) {
    if (m.type !== 'assistant') continue;
    const u = m.message?.usage;
    if (u === undefined || u === null) continue;
    series.push({
      input_tokens: u.input_tokens ?? 0,
      cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
      promptTokens:
        (u.input_tokens ?? 0) +
        (u.cache_read_input_tokens ?? 0) +
        (u.cache_creation_input_tokens ?? 0),
    });
  }
  return series;
}

function countCompactions(transcript) {
  return transcript.filter((m) => m.type === 'system' && m.subtype === 'compact_boundary').length;
}

/** Deterministic long filler (~`words` words) with a recoverable payload line. */
function fillerDoc(words, payloadLine) {
  const body = Array.from(
    { length: words },
    (_, i) => `filler-${i + 1}${(i + 1) % 20 === 0 ? '\n' : ''}`,
  ).join(' ');
  return `${body}\n${payloadLine}\n`;
}

/* --------------------------------------------------------------- runners */

const RUNNERS = {
  /** Layer 1: two request-phase failures, then success. */
  'dc-01': async ({ sdk }) => {
    const ws = seedWorkspace({});
    const fetchWrap = makeFaultFetch((i) => (i <= 2 ? 'fail' : 'pass'));
    const run = await drive(sdk, ws, {
      prompts: ['Reply with exactly: RECOVERED'],
      options: { provider: { fetch: fetchWrap } },
    });
    return {
      ws,
      evidence: {
        phases: [phaseEvidence(run)],
        harnessNotes:
          'Injected: transport POSTs #1 and #2 threw a network error before any byte ' +
          '(request phase); #3 onward hit the real API. Expected: success result, ' +
          'transportHealth.networkRetries === 2, single coherent assistant message.',
        injected: fetchWrap.ledger,
      },
    };
  },

  /** Layer 2: mid-stream cut before meaningful content; bounded replay. */
  'dc-02': async ({ sdk }) => {
    const ws = seedWorkspace({});
    const fetchWrap = makeFaultFetch((i) => (i === 1 ? { cutAfterEvents: 2 } : 'pass'));
    const run = await drive(sdk, ws, {
      prompts: [
        'Write one short paragraph (exactly three sentences) about lighthouses, then end with the word DONE.',
      ],
      options: { provider: { fetch: fetchWrap } },
    });
    return {
      ws,
      evidence: {
        phases: [phaseEvidence(run)],
        harnessNotes:
          'Injected: POST #1 stream errored after ~2 SSE events (message_start-era, before ' +
          'meaningful text committed); replay POSTs hit the real API clean. Expected: single ' +
          'coherent final message with no duplicated text, transportHealth counts the drop ' +
          '(midStreamDrops) and the bounded engine replay (turnReplays), success result.',
        injected: fetchWrap.ledger,
      },
    };
  },

  /** Layer 3: mid-final-message cut after partial text flowed; salvage. */
  'dc-03': async ({ sdk }) => {
    const ws = seedWorkspace({});
    const fetchWrap = makeFaultFetch((i) => (i === 1 ? { cutAfterEvents: 12 } : 'pass'));
    const run = await drive(sdk, ws, {
      prompts: [
        'Count from one to forty as English words, comma-separated, on one line, then say DONE.',
      ],
      options: { provider: { fetch: fetchWrap } },
    });
    return {
      ws,
      evidence: {
        phases: [phaseEvidence(run)],
        harnessNotes:
          'Injected: POST #1 stream errored after ~12 SSE events (partial text had flowed); ' +
          'later POSTs clean. Expected: coherent final output (no repeated prefix / missing ' +
          'middle), transportHealth records the truncation path (midStreamDrops plus ' +
          'turnsSalvaged or turnReplays), and usage accounting present for the salvaged turn.',
        injected: fetchWrap.ledger,
      },
    };
  },

  /** Layer 4: hard kill mid-task (retries exhausted), then session resume. */
  'dc-04': async ({ sdk }) => {
    const ws = seedWorkspace({ seedFiles: { 'seed.txt': 'deploy code: 6274\n' } });
    const killFetch = makeFaultFetch((i) => (i === 1 ? 'pass' : 'fail'));
    const phase1 = await drive(sdk, ws, {
      prompts: [
        'Two-step task, strictly in order. Step 1: use Read on seed.txt to learn the deploy ' +
          'code. Step 2: only after you have the code, use Write to create progress.txt with ' +
          'exactly one line: code: <the code>. Do not combine the steps.',
      ],
      options: { provider: { fetch: killFetch, maxRetries: 1 } },
    });
    const sessionId = sessionIdOf(phase1);
    let phase2 = { transcript: [], result: null };
    if (sessionId !== null) {
      phase2 = await drive(sdk, ws, {
        prompts: [
          'Continue the interrupted task exactly where it stopped; do not redo completed ' +
            'steps. Then answer: what is the deploy code?',
        ],
        options: { resume: sessionId },
      });
    }
    return {
      ws,
      evidence: {
        phases: [phaseEvidence(phase1), phaseEvidence(phase2)],
        harnessNotes:
          'Injected: phase 1 allowed exactly one successful POST (the model read seed.txt), ' +
          'then every transport POST failed until retries exhausted — a mid-task hard kill ' +
          'with the session JSONL persisted (fact X = deploy code 6274 was in-conversation). ' +
          'Phase 2 resumed the same session id with a clean network. Expected: phase 2 ' +
          'continues (writes progress.txt once, correct code) instead of restarting, recalls ' +
          'the code, and no side effect is duplicated.',
        resumedSessionId: sessionId,
        files: dumpFiles(ws, ['seed.txt', 'progress.txt']),
        injected: killFetch.ledger,
      },
    };
  },

  /** Ledger classification: one request-phase failure + one mid-stream cut. */
  'dc-05': async ({ sdk }) => {
    const ws = seedWorkspace({});
    const fetchWrap = makeFaultFetch((i) => {
      if (i === 1) return 'fail';
      if (i === 3) return { cutAfterEvents: 8 };
      return 'pass';
    });
    const run = await drive(sdk, ws, {
      prompts: [
        'Reply with exactly: ALPHA',
        'Write one sentence of at least twelve words about tidal energy, then say DONE.',
      ],
      options: { provider: { fetch: fetchWrap } },
    });
    return {
      ws,
      evidence: {
        phases: [phaseEvidence(run)],
        harnessNotes:
          'Injected mixed faults: POST #1 request-phase network error (recovered by retry ' +
          'POST #2), POST #3 mid-stream cut after ~8 events (recovered by replay/salvage). ' +
          'Expected: exactly these two disconnect events in transportHealth, each in the ' +
          'matching bucket (networkRetries=1; midStreamDrops=1 with its recovery counter), ' +
          'success result, zero unrecovered.',
        injected: fetchWrap.ledger,
      },
    };
  },

  /** Retry exhaustion must end in an honest structured error. */
  'dc-06': async ({ sdk }) => {
    const ws = seedWorkspace({});
    const fetchWrap = makeFaultFetch(() => 'fail');
    const run = await drive(sdk, ws, {
      prompts: ['Reply with exactly: OK'],
      options: { provider: { fetch: fetchWrap, maxRetries: 2 } },
    });
    return {
      ws,
      evidence: {
        phases: [phaseEvidence(run)],
        harnessNotes:
          'Injected: every transport POST throws a network error (permanent fault); ' +
          'maxRetries bounded to 2 to keep the eval finite. Expected: a structured error ' +
          'result (is_error, error subtype/code) — not a fabricated success, not a hang — ' +
          'no transcript text claiming success, and transportHealth showing the exhausted ' +
          'attempts as unrecovered.',
        injected: fetchWrap.ledger,
      },
    };
  },

  /** R7 flush: un-saved fact survives an auto-compaction fold. */
  'mem-03': async ({ sdk }) => {
    const ws = seedWorkspace({
      seedFiles: {
        'big-a.txt': fillerDoc(2600, 'REPORT-VERDICT: proceed with rollout.'),
      },
    });
    const run = await drive(sdk, ws, {
      prompts: [
        "Important unsaved fact: the rollout password is 'korin-7'. Do not write it anywhere " +
          'yet; just acknowledge it.',
        'Read big-a.txt and summarize it in one line.',
        'What is the rollout password? Answer with just the password.',
      ],
      options: {
        provider: { maxOutputTokens: 1024 },
        compaction: { contextWindowTokens: 7000 },
        memory: { sessionEndUpdate: false },
      },
    });
    return {
      ws,
      evidence: {
        phases: [phaseEvidence(run)],
        harnessNotes:
          'Compaction pressure: context window overridden to 7000 tokens (reserved output ' +
          '1024), so reading the ~2600-word fixture drives the estimate past the auto ' +
          'threshold and the fold fires before the final question. Expected: the R7 flush ' +
          'round writes the at-risk password to memory BEFORE the fold ' +
          '(metrics.memoryHealth.writes >= 1), a compact_boundary appears, the post-fold ' +
          'question is answered korin-7, and the flush round does not terminate the task turn.',
        compactionCount: countCompactions(run.transcript),
        memoryHealth: run.result?.metrics?.memoryHealth ?? null,
        memoryDump: dumpMemory(ws),
      },
    };
  },

  /** Compaction must actually shrink the bill (>= 40% prompt-size drop). */
  'tok-04': async ({ sdk }) => {
    const ws = seedWorkspace({
      seedFiles: {
        'big-a.txt': fillerDoc(3000, 'CONCLUSION: adopt plan B.'),
      },
    });
    const run = await drive(sdk, ws, {
      prompts: [
        'Read big-a.txt and summarize it in one line.',
        'Per the report you read, which plan is adopted? Answer with one word.',
      ],
      options: {
        provider: { maxOutputTokens: 1024 },
        compaction: { contextWindowTokens: 7000 },
      },
    });
    const series = requestSeries(run.transcript);
    return {
      ws,
      evidence: {
        phases: [phaseEvidence(run)],
        harnessNotes:
          'Compaction pressure: window overridden to 7000 tokens; the ~3000-word read makes ' +
          'the next turn cross the auto threshold, folding once before the follow-up ' +
          'question. requestSeries lists per-API-request prompt sizes (input + cache_read + ' +
          'cache_creation) in order. Expected: exactly one compact_boundary, the post-fold ' +
          "request's promptTokens >= 40% below the pre-fold peak, and the follow-up is " +
          "answered correctly ('B')",
        requestSeries: series,
        compactionCount: countCompactions(run.transcript),
      },
    };
  },
};

/** Runner for a `driver: "manual"` question, or null (=> PENDING_HARNESS). */
export function getHarnessRunner(id) {
  return RUNNERS[id] ?? null;
}

export const HARNESS_IDS = Object.keys(RUNNERS);
