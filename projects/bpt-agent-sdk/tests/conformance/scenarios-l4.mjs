/**
 * L4 fault-injection differential scenarios (conformance suite M3, B1).
 *
 * Nine deterministic fault cases (the 8 designed cases plus the harsher-cut
 * follow-up mandated by l4-sse-truncated-tool-turn's first run) replayed
 * identically through both arms against the content-blind emulator. Every decider is an arm-neutral
 * clean-room observable: emulatorProfile POST count, unscriptedCalls,
 * normalized terminal subtype/result text, toolResults count, captured file
 * bytes, and the runner error string - NEVER request bodies (all fault
 * branches in emulator.mjs sit after req.resume(); nothing here weakens it).
 *
 * Retry-after is pinned to 1s on every retryable fault so the official
 * arm's exponential backoff stays bounded; per-case timeoutMs is sized for
 * official's worst observed backoff. Timeouts are loud-fail settle barriers
 * (and, in l4-hang-then-client-abort, the injected fault itself) - never
 * wall-clock assertions.
 *
 * Case shape:
 *   buildScripts(cwd)  - shared model-side fault script per throwaway cwd
 *   sentinels          - scripted marker strings whose stream presence is an
 *                        arm-neutral facet (cross-compared, KD-triaged)
 *   invariants(run)    - arm-NEUTRAL hard checks applied to BOTH arms; a
 *                        failure on the BPT arm is our regression (exit 1),
 *                        a failure on the official arm is a differential
 *                        finding (reported, never a suite failure)
 *   bptOnly(run)       - BPT-arm-only locks on OUR profiled transport
 *                        behavior (never applied to the official arm)
 *   engineFindingIf(bptFacets, offFacets) - directional triage: returns a
 *                        note when OUR arm degrades worse than official
 *                        (suspected our-engine gap -> engineFindings, red,
 *                        never behind a KD); null means encoding-level split
 *                        territory (KD-L4 table in run-l4.mjs)
 */

import { join } from 'node:path';
import { textReply, toolUseReply } from './emulator.mjs';

/** Sentinel present anywhere on the PUBLIC stream (assistant text, result
 *  text, or tool_result text) - the arm-neutral "was this turn seen" probe. */
export function streamHas(run, sentinel) {
  if (run.checks.resultText?.includes(sentinel)) return true;
  if (run.assistantTexts.some((t) => t.includes(sentinel))) return true;
  return run.toolResults.some((tr) => tr.text.includes(sentinel));
}

export const SCENARIOS_L4 = [
  {
    id: 'l4-429-retry-after-recover',
    fault: 'single HTTP 429 (retry-after: 1), then a normal SSE turn',
    prompt: 'Say OK.',
    timeoutMs: 90_000, // official honored retry-after in spike S3; jitter headroom
    buildScripts: () => [
      { kind: 'http429', retryAfter: '1' },
      { kind: 'sse', events: textReply('RECOVERED AFTER 429') },
    ],
    sentinels: ['RECOVERED AFTER 429'],
    invariants: (run) => {
      const f = [];
      if (run.postCount !== 2) f.push(`postCount ${run.postCount} != 2 (one 429 + one recovery)`);
      if (run.unscriptedCalls !== 0) f.push(`unscriptedCalls ${run.unscriptedCalls} != 0`);
      if (run.checks.resultSubtype !== 'success') f.push(`resultSubtype ${run.checks.resultSubtype} != success`);
      if (!run.checks.resultText?.includes('RECOVERED AFTER 429')) f.push('resultText missing "RECOVERED AFTER 429"');
      return f;
    },
    notes:
      'Retry-notification stream messages are recorded per arm (informational, never gated): ' +
      'spike S3 profiled official system/api_retry; ours emits rate_limit_event per 429 retry ' +
      '(loop.ts observability contract). Stable extra tokens land as scoped KNOWN_DIVERGENCES entries.',
  },
  {
    id: 'l4-429-storm-two-vs-budget',
    fault: 'two consecutive 429s (retry-after: 1 each) before recovery - probes retry budget depth',
    prompt: 'Say OK.',
    // Honest risk: official's SECOND backoff step may ignore retry-after and
    // go long (tens of seconds). Tuned generous; never asserted on elapsed.
    timeoutMs: 180_000,
    buildScripts: () => [
      { kind: 'http429', retryAfter: '1' },
      { kind: 'http429', retryAfter: '1' },
      { kind: 'sse', events: textReply('STORM SURVIVED') },
    ],
    sentinels: ['STORM SURVIVED'],
    invariants: (run) => {
      const f = [];
      if (run.postCount !== 3) f.push(`postCount ${run.postCount} != 3 (both budgets must cover >= 2 retries)`);
      if (run.unscriptedCalls !== 0) f.push(`unscriptedCalls ${run.unscriptedCalls} != 0`);
      if (run.checks.resultSubtype !== 'success') f.push(`resultSubtype ${run.checks.resultSubtype} != success`);
      if (!run.checks.resultText?.includes('STORM SURVIVED')) f.push('resultText missing "STORM SURVIVED"');
      return f;
    },
    notes:
      'Ours: DEFAULT_MAX_RETRIES 4 (transport/anthropic.ts) trivially covers 2. If the official ' +
      'arm gives up (postCount < 3 + non-success) or its 2nd backoff exceeds timeout, that is a ' +
      'new KD about ITS budget, not a failure of ours.',
  },
  {
    id: 'l4-http500-once-recover',
    fault: 'HTTP 500 api_error once (retry-after: 1), then recovery turn',
    prompt: 'Say OK.',
    timeoutMs: 90_000,
    buildScripts: () => [
      { kind: 'http500' },
      { kind: 'sse', events: textReply('AFTER 500 OK') },
    ],
    sentinels: ['AFTER 500 OK'],
    invariants: (run) => {
      const f = [];
      if (run.postCount !== 2) f.push(`postCount ${run.postCount} != 2 (5xx must be retryable)`);
      if (run.unscriptedCalls !== 0) f.push(`unscriptedCalls ${run.unscriptedCalls} != 0`);
      if (run.checks.resultSubtype !== 'success') f.push(`resultSubtype ${run.checks.resultSubtype} != success`);
      if (!run.checks.resultText?.includes('AFTER 500 OK')) f.push('resultText missing "AFTER 500 OK"');
      return f;
    },
    notes:
      'Confirms 5xx retryability on both arms (ours: status >= 500 branch in requestWithRetries). ' +
      'Watch the retry-notification asymmetry: spike S3 only profiled 429; ours emits api_retry ' +
      '(not rate_limit_event) for 5xx - asymmetric notification tokens go to a scoped KD.',
  },
  {
    id: 'l4-http400-non-retryable',
    fault: 'scripted HTTP 400 invalid_request_error on the first POST - must NOT be retried',
    prompt: 'Say OK.',
    timeoutMs: 30_000,
    buildScripts: () => [
      { kind: 'http400' },
      // Sentinel script: exists PURELY to detect an illegal retry - a second
      // POST would consume it and leak the marker into the stream.
      { kind: 'sse', events: textReply('MUST NEVER BE REQUESTED') },
    ],
    sentinels: ['MUST NEVER BE REQUESTED'],
    invariants: (run) => {
      const f = [];
      if (run.postCount !== 1) f.push(`postCount ${run.postCount} != 1 (an arm RETRIED a 400)`);
      if (streamHas(run, 'MUST NEVER BE REQUESTED')) f.push('retry sentinel leaked into the stream');
      if (run.checks.resultSubtype === 'success') f.push('resultSubtype success after an unrecovered 400');
      return f;
    },
    bptOnly: (run) => {
      // Observed engine contract (seed run 2026-07-05): the transport throws
      // APIStatusError(400), the ENGINE catches it and ends the stream with
      // result/error_during_execution - query() does not throw.
      const f = [];
      if (run.checks.resultSubtype !== 'error_during_execution') {
        f.push(`expected result/error_during_execution, got ${run.checks.resultSubtype}`);
      }
      if (run.error) f.push(`unexpected thrown error: ${run.error}`);
      return f;
    },
    // Observed stable (2026-07-05): official ends result/SUCCESS over the
    // failed session (error as assistant text + iterator throw) - its miss
    // of the non-success invariant is the documented KD-L4-01 quirk.
    officialInvariantKd: 'KD-L4-01',
    notes:
      'The no-retry invariant is the hard arm-neutral decider; the terminal ENCODING per arm ' +
      'is the differential finding -> KD-L4-01.',
  },
  {
    id: 'l4-sse-truncated-text-turn',
    fault: 'text turn stream cut before message_stop (default cutMarker)',
    prompt: 'Say OK.',
    timeoutMs: 45_000,
    buildScripts: () => [
      { kind: 'sse-truncated', events: textReply('PARTIAL TEXT') },
      // Sentinel detects a mid-stream re-request - the central question.
      { kind: 'sse', events: textReply('UNEXPECTED SECOND CALL') },
    ],
    sentinels: ['PARTIAL TEXT', 'UNEXPECTED SECOND CALL'],
    invariants: (run) => {
      const f = [];
      if (run.unscriptedCalls !== 0) f.push(`unscriptedCalls ${run.unscriptedCalls} != 0`);
      if (run.postCount > 2) f.push(`postCount ${run.postCount} > 2 (runaway stream retry)`);
      return f;
    },
    // Spike S4: official does NOT retry, surfaces the error AS ASSISTANT
    // TEXT and ends result/success (profiled quirk -> KD-L4-02). Our engine
    // since E3 (2026-07-05): the truncated turn is SALVAGED - the partial
    // text becomes the answer, the run ends result/success, and the
    // connection error rides result.errors as a non-fatal note (no fabricated
    // assistant message, no thrown error - the spike-S4 throw quirk is
    // deliberately not replicated).
    bptOnly: (run) => {
      // Fault-manifest lock (review major, 2026-07-05; E3 update): a dead
      // cutMarker would also end result/success - the truncation note in
      // result.errors is what distinguishes a REAL injected cut, so silent
      // fault removal still fails LOUD on the BPT arm.
      const f = [];
      if (run.checks.resultSubtype !== 'success') {
        f.push(`expected result/success (E3 salvage), got ${run.checks.resultSubtype}`);
      }
      if (!(run.resultErrors ?? []).some((e) => /stream failed/.test(e))) {
        f.push('fault did not manifest: no truncation note in result.errors (dead cutMarker?)');
      }
      if (!streamHas(run, 'PARTIAL TEXT')) {
        f.push('salvaged partial text missing from the stream');
      }
      return f;
    },
    engineFindingIf: (bpt, off) =>
      off.resultSubtype === 'success' && bpt.resultSubtype !== 'success'
        ? 'mid-stream truncation: our engine ends the session result/error_during_execution where ' +
          'official 2.1.201 degrades to a success-shaped result - suspected our-engine ' +
          'graceful-degradation gap, NOT a KD'
        : null,
    notes:
      'POST count decides "no stream retry" (1) vs "engine re-requested" (2, sentinel visible); ' +
      'terminal shape per arm is the differential payload.',
  },
  {
    id: 'l4-sse-truncated-tool-turn',
    fault:
      'TOOL-USE turn cut before message_stop: complete Write tool_use blocks + ' +
      "message_delta(stop_reason:'tool_use') delivered, terminator missing",
    prompt: 'Write the file.',
    timeoutMs: 45_000,
    options: { allowedTools: ['Write'] }, // auto-approve pattern (never bypassPermissions)
    captureFiles: ['trunc-out.txt'],
    buildScripts: (cwd) => [
      {
        kind: 'sse-truncated',
        events: toolUseReply([
          { name: 'Write', input: { file_path: join(cwd, 'trunc-out.txt'), content: 'TRUNC-WRITE' } },
        ]),
      },
      { kind: 'sse', events: textReply('POST-TRUNC TURN') },
    ],
    sentinels: ['POST-TRUNC TURN'],
    invariants: (run) => {
      const f = [];
      if (run.unscriptedCalls !== 0) f.push(`unscriptedCalls ${run.unscriptedCalls} != 0`);
      if (run.postCount > 2) f.push(`postCount ${run.postCount} > 2 (runaway stream retry)`);
      return f;
    },
    // Highest-information case in the set - behavior unknown on BOTH arms.
    // Three arm-neutral facets: (1) files['trunc-out.txt'] - did the engine
    // execute a tool from a terminator-less turn; (2) postCount - did it
    // re-request to deliver the tool_result (sentinel visible iff yes);
    // (3) toolResults count + terminal subtype.
    bptOnly: (run) => {
      // Fault-manifest lock (review major, 2026-07-05; E3 update): our engine
      // now EXECUTES the salvaged complete tool_use blocks and re-requests to
      // deliver the tool_result, ending result/success - same shape a dead
      // cutMarker would produce, so the truncation note in result.errors is
      // the fault-manifest discriminator (silent fault removal fails LOUD).
      const f = [];
      if (run.checks.resultSubtype !== 'success') {
        f.push(`expected result/success (E3 salvage), got ${run.checks.resultSubtype}`);
      }
      if (run.files['trunc-out.txt'] !== 'TRUNC-WRITE') {
        f.push('salvaged tool_use did not execute (trunc-out.txt missing/wrong)');
      }
      if (!streamHas(run, 'POST-TRUNC TURN')) {
        f.push('no recovery turn - the tool_result was not delivered on a 2nd POST');
      }
      if (!(run.resultErrors ?? []).some((e) => /stream failed/.test(e))) {
        f.push('fault did not manifest: no truncation note in result.errors (dead cutMarker?)');
      }
      return f;
    },
    engineFindingIf: (bpt, off) =>
      (off.toolResults > bpt.toolResults ||
        (off.files['trunc-out.txt'] === 'TRUNC-WRITE' && bpt.files['trunc-out.txt'] !== 'TRUNC-WRITE'))
        ? 'truncated tool turn: our engine drops tool execution/result that official 2.1.201 ' +
          'delivers - suspected our-engine gap, NOT a KD'
        : null,
    notes:
      'Observed (run 1, 2026-07-05): official EXECUTES the terminator-less turn and re-requests ' +
      '(KD-L4-04 + engine finding); the harsher incomplete-message cut therefore warranted the ' +
      'l4-sse-truncated-tool-incomplete follow-up below.',
  },
  {
    id: 'l4-sse-truncated-tool-incomplete',
    fault:
      "TOOL-USE turn cut BEFORE message_delta (cutMarker 'event: message_delta'): complete " +
      "tool_use blocks delivered but stop_reason:'tool_use' never arrives - an incomplete " +
      'message, not just a missing terminator',
    prompt: 'Write the file.',
    timeoutMs: 45_000,
    options: { allowedTools: ['Write'] },
    captureFiles: ['trunc-out.txt'],
    buildScripts: (cwd) => [
      {
        kind: 'sse-truncated',
        cutMarker: 'event: message_delta',
        events: toolUseReply([
          { name: 'Write', input: { file_path: join(cwd, 'trunc-out.txt'), content: 'TRUNC-WRITE' } },
        ]),
      },
      { kind: 'sse', events: textReply('POST-TRUNC TURN') },
    ],
    sentinels: ['POST-TRUNC TURN'],
    invariants: (run) => {
      const f = [];
      if (run.unscriptedCalls !== 0) f.push(`unscriptedCalls ${run.unscriptedCalls} != 0`);
      if (run.postCount > 2) f.push(`postCount ${run.postCount} > 2 (runaway stream retry)`);
      return f;
    },
    // Probes whether KD-L4-04's execution split hinges on stop_reason
    // delivery or on complete tool_use blocks alone.
    bptOnly: (run) => {
      // Fault-manifest lock (review major, 2026-07-05; E3 update): our engine
      // now EXECUTES the salvaged complete tool_use blocks and re-requests to
      // deliver the tool_result, ending result/success - same shape a dead
      // cutMarker would produce, so the truncation note in result.errors is
      // the fault-manifest discriminator (silent fault removal fails LOUD).
      const f = [];
      if (run.checks.resultSubtype !== 'success') {
        f.push(`expected result/success (E3 salvage), got ${run.checks.resultSubtype}`);
      }
      if (run.files['trunc-out.txt'] !== 'TRUNC-WRITE') {
        f.push('salvaged tool_use did not execute (trunc-out.txt missing/wrong)');
      }
      if (!streamHas(run, 'POST-TRUNC TURN')) {
        f.push('no recovery turn - the tool_result was not delivered on a 2nd POST');
      }
      if (!(run.resultErrors ?? []).some((e) => /stream failed/.test(e))) {
        f.push('fault did not manifest: no truncation note in result.errors (dead cutMarker?)');
      }
      return f;
    },
    engineFindingIf: (bpt, off) =>
      (off.toolResults > bpt.toolResults ||
        (off.files['trunc-out.txt'] === 'TRUNC-WRITE' && bpt.files['trunc-out.txt'] !== 'TRUNC-WRITE'))
        ? 'incomplete tool message (no stop_reason): our engine drops tool execution/result that ' +
          'official 2.1.201 delivers - suspected our-engine gap, NOT a KD'
        : null,
    notes:
      'Follow-up mandated by l4-sse-truncated-tool-turn showing official-side execution. ' +
      'Observed (2026-07-05, stable 2x): official executes EVEN WITHOUT stop_reason - complete ' +
      'tool_use blocks alone are actionable to it, so both cut depths share KD-L4-04 and the ' +
      'same engine finding; ours abandons the turn at either depth.',
  },
  {
    id: 'l4-hang-then-client-abort',
    fault:
      'stream hangs after message_start (sse-hang); the caller AbortController fires via the ' +
      'runner timeout - tests clean abort propagation, NOT the idle watchdog (ours defaults to ' +
      '120s, deliberately out of reach)',
    prompt: 'Say OK.',
    // The timeout IS the injected fault: the hang never progresses, so this
    // is a deterministic loud-fail barrier, not a wall-clock assertion.
    timeoutMs: 15_000,
    buildScripts: () => [{ kind: 'sse-hang', events: textReply('NEVER FINISHES') }],
    sentinels: ['NEVER FINISHES'],
    invariants: (run) => {
      const f = [];
      if (run.postCount !== 1) f.push(`postCount ${run.postCount} != 1 (re-request after abort)`);
      if (run.unscriptedCalls !== 0) f.push(`unscriptedCalls ${run.unscriptedCalls} != 0`);
      if (run.checks.resultSubtype === 'success') f.push('success result out of a hung stream');
      return f;
    },
    bptOnly: (run) => {
      // Profiled: caller abort maps to AbortError (mapStreamError
      // callerSignal branch) thrown out of query().
      const f = [];
      if (!run.error || !/abort/i.test(run.error)) {
        f.push(`expected AbortError out of query(), got error=${JSON.stringify(run.error)}`);
      }
      return f;
    },
    notes:
      'Symmetric invariant: exactly one POST, no success. Abort ENCODINGS differ by design ' +
      '(our thrown AbortError vs however claude-code terminates on abort) -> KD-L4-03. Emulator ' +
      'close() destroying the registered hung socket is itself under test: a deadlock here ' +
      'fails the run loudly via the process never exiting.',
  },
  {
    id: 'l4-script-exhausted-400-terminal',
    fault:
      'engine legitimately needs a second turn (tool follow-up) but the queue holds one script - ' +
      "the emulator's built-in exhaustion 400 becomes the terminal fault (also guards the " +
      'exhaustion semantics every L1-L3 runner silently relies on)',
    prompt: 'Read hello.txt.',
    timeoutMs: 60_000,
    fixtureFiles: { 'hello.txt': 'the magic word is LANTERN\n' },
    buildScripts: (cwd) => [
      { kind: 'sse', events: toolUseReply([{ name: 'Read', input: { file_path: join(cwd, 'hello.txt') } }]) },
    ],
    sentinels: [],
    invariants: (run) => {
      const f = [];
      // Same no-retry-on-400 invariant as l4-http400 but at mid-session
      // position: 2+ unscripted calls would mean an arm retried the 400.
      if (run.unscriptedCalls !== 1) f.push(`unscriptedCalls ${run.unscriptedCalls} != 1`);
      if (run.checks.toolResults !== 1) f.push(`toolResults ${run.checks.toolResults} != 1 (tool must run before the fault)`);
      if (run.checks.resultSubtype === 'success') f.push('resultSubtype success after terminal exhaustion 400');
      return f;
    },
    // Same observed official quirk as l4-http400, mid-session: success
    // subtype over the exhaustion 400 (KD-L4-01, one KD covers both positions).
    officialInvariantKd: 'KD-L4-01',
    bptOnly: (run) => {
      // Same observed engine contract as l4-http400: the mid-session 400 is
      // wrapped into result/error_during_execution, query() does not throw.
      const f = [];
      if (run.checks.resultSubtype !== 'error_during_execution') {
        f.push(`expected result/error_during_execution, got ${run.checks.resultSubtype}`);
      }
      if (run.error) f.push(`unexpected thrown error: ${run.error}`);
      return f;
    },
    notes:
      'Mirrors l4-http400 mid-session; a stable encoding split shares KD-L4-01 (one KD covers ' +
      'both 400 positions).',
  },
];
