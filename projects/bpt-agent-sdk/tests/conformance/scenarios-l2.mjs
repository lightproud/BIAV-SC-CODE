/**
 * L2 options-semantics scenarios (conformance suite M2).
 *
 * Where L1 pins the raw stream grammar, L2 pins the OBSERVABLE EFFECT of
 * each Options field: both arms get the same extra options and the same
 * scripted model turns, and the deciders are arm-neutral surfaces only -
 * filesystem side effects in the throwaway cwd, the public SDKMessage
 * stream (init fields, result subtype, permission_denials), the emulator's
 * wire profile (POST count - never content), and host-side callback
 * invocations (canUseTool / hooks run in OUR process for both arms).
 *
 * CLEAN-ROOM NOTE (standing decision "净室观测边界" r2): options whose only
 * effect lives in the REQUEST BODY (systemPrompt text, betas content,
 * thinking params) are NOT dual-arm differentiable under the content-blind
 * emulator and are deliberately absent here - they stay single-arm rows in
 * COMPAT.md. Every scenario below asserts on public/observable surfaces.
 *
 * Scenario contract (consumed by run-l2.mjs, which owns the local driver):
 *   id           - stable row id (s1..s14 mirror the mapping-agent spec)
 *   option       - the Options field(s) under test (report label)
 *   prompt       - user prompt string (identical on both arms)
 *   fixtureFiles - files written into the throwaway cwd before the run
 *   options      - static extra Options passed to BOTH arms
 *   makeOptions({ cwd, host }) - per-run options needing the cwd or the
 *                  host-recorder (canUseTool / hooks callbacks)
 *   buildScripts(cwd, arm)     - shared model-side script; arm is passed
 *                  ONLY for the Agent-vs-Task tool-name split (S13), never
 *                  to change semantics
 *   env          - extra env vars for BOTH arms (e.g. IS_SANDBOX for the
 *                  official CLI's root interlock, orthogonal to the option)
 *   expect       - optional { resultSubtype, resultText, toolResults },
 *                  asserted on both arms (undefined field = skip)
 *   check(run)   - per-scenario semantic assertions -> array of failure
 *                  strings; run = { arm, tokens, checks, messages, host,
 *                  fs, postCount, error }
 *   fsProbe      - file names snapshotted (content or null) BEFORE cleanup
 *   driver       - optional consumer behavior ('interrupt-on-first-assistant')
 *   kind         - 'resume' marks the custom two-query driver (S14)
 *   droppable    - official-arm failure demotes the row to single-arm lock
 *                  (mapping-agent risk notes) instead of counting DIVERGENT
 *   notes        - honest caveats surfaced verbatim in the report
 */

import { join } from 'node:path';
import { textReply, toolUseReply } from './emulator.mjs';

/** First system/init of a run - public-stream piggyback surface. */
export function initOf(messages) {
  return messages.find((m) => m?.type === 'system' && m.subtype === 'init');
}

/** Last result message of a run. */
export function resultOf(messages) {
  return messages.filter((m) => m?.type === 'result').pop();
}

/** result.permission_denials length (public field on both engines). */
function denialCount(messages) {
  const r = resultOf(messages);
  return Array.isArray(r?.permission_denials) ? r.permission_denials.length : 0;
}

export const SCENARIOS_L2 = [
  {
    // maxTurns is the cheapest wire-observable option: the emulator counts
    // POSTs, so an off-by-one in either engine's turn accounting is caught
    // without reading a byte of request content. model/tools piggyback on
    // the same run via system/init (public stream).
    id: 's1-max-turns',
    option: 'maxTurns (+ piggyback: model, tools)',
    prompt: 'Loop until stopped.',
    fixtureFiles: { 'hello.txt': 'fixture alpha\n' },
    options: { maxTurns: 2, model: 'claude-conformance-1', tools: ['Read'] },
    buildScripts: (cwd) => [
      { kind: 'sse', events: toolUseReply([{ name: 'Read', input: { file_path: join(cwd, 'hello.txt') } }]) },
      { kind: 'sse', events: toolUseReply([{ name: 'Read', input: { file_path: join(cwd, 'hello.txt') } }], { id: 'msg_conf_tool2' }) },
      { kind: 'sse', events: textReply('UNREACHED') },
    ],
    expect: { resultSubtype: 'error_max_turns' },
    check(run) {
      const failures = [];
      // Exact equality catches BOTH overrun (3rd script consumed) and
      // underrun (an engine reporting error_max_turns after only 1 POST) -
      // review finding: `> 2` alone missed the underrun half.
      if (run.postCount !== 2) failures.push(`postCount ${run.postCount} != 2 (maxTurns:2 must consume exactly two scripts)`);
      const init = initOf(run.messages);
      if (init?.model !== 'claude-conformance-1') failures.push(`init.model ${init?.model} != claude-conformance-1`);
      const tools = Array.isArray(init?.tools) ? init.tools : [];
      if (!tools.includes('Read')) failures.push('init.tools missing Read');
      // Subset assertion: engines may append built-ins the filter cannot
      // remove, but Write must be filtered out by tools:['Read'] on both.
      if (tools.includes('Write')) failures.push('init.tools still lists Write despite tools:[Read] filter');
      if (run.checks.resultText?.includes('UNREACHED')) failures.push('UNREACHED text leaked past maxTurns');
      return failures;
    },
    notes: 'tools piggyback risk (mapping spec): if the official arm ignores tools:string[], only the Write-filter check fails there and lands in kdCandidates, not the gate.',
  },
  {
    // Bare-name disallow removes the tool definition; the scripted model
    // calls it anyway. The filesystem is the arm-neutral decider; the deny
    // SURFACE (error tool_result body, permission_denied variant) is
    // expected to differ and surfaces via stream compare -> kdCandidates.
    id: 's2-disallowed-bare',
    option: 'disallowedTools (bare name)',
    prompt: 'Write out.txt.',
    fixtureFiles: {},
    // acceptEdits makes the deny rule LOAD-BEARING: without disallowedTools
    // the mode would auto-approve the Write, so fs absence proves the rule
    // (review finding: under default-mode headless fallthrough the deny was
    // vacuous - Write got denied with or without the option under test).
    options: { permissionMode: 'acceptEdits', disallowedTools: ['Write'] },
    buildScripts: (cwd) => [
      { kind: 'sse', events: toolUseReply([{ name: 'Write', input: { file_path: join(cwd, 'out.txt'), content: 'X' } }]) },
      { kind: 'sse', events: textReply('DONE') },
    ],
    expect: { resultSubtype: 'success', resultText: 'DONE' },
    fsProbe: ['out.txt'],
    check(run) {
      const failures = [];
      if (run.fs['out.txt'] !== null) failures.push('out.txt exists despite disallowedTools:[Write]');
      if (!run.tokens.includes('user/tool_result')) failures.push('no user/tool_result token (denied call must still be answered)');
      return failures;
    },
    notes: 'deny surface shape is expected to differ between engines (unknown-tool error vs permission deny) - fs absence + tool_result presence decide; shape delta goes to kdCandidates.',
  },
  {
    // Scoped spec deny: prefix rule grammar must agree between engines. If
    // the official arm EXECUTES rm here, that is a real conformance finding
    // (rule-grammar drift), not a scenario bug - marker.txt is the proof.
    id: 's3-disallowed-scoped',
    option: 'disallowedTools (scoped spec Bash(rm:*)) vs allowedTools:[Bash]',
    prompt: 'Remove marker.txt, then write allowed.txt.',
    fixtureFiles: { 'marker.txt': 'still here\n' },
    // allowedTools:['Bash'] makes the scoped deny LOAD-BEARING and gives the
    // grammar a positive control in the same run: without the deny rule the
    // allow rule would execute `rm` (deny-beats-allow is the documented
    // order); the second, non-matching Bash command MUST pass the allow rule
    // - proving the deny is scoped to the rm:* prefix, not tool-wide.
    // (Review finding: under default-mode headless fallthrough both commands
    // were denied regardless, so the prefix grammar was never exercised.)
    options: { allowedTools: ['Bash'], disallowedTools: ['Bash(rm:*)'] },
    buildScripts: (cwd) => [
      { kind: 'sse', events: toolUseReply([{ name: 'Bash', input: { command: 'rm marker.txt' } }]) },
      { kind: 'sse', events: toolUseReply([{ name: 'Bash', input: { command: `printf ok > ${join(cwd, 'allowed.txt')}` } }], { id: 'msg_conf_tool2' }) },
      { kind: 'sse', events: textReply('DONE') },
    ],
    expect: { resultSubtype: 'success', resultText: 'DONE' },
    fsProbe: ['marker.txt', 'allowed.txt'],
    check(run) {
      const failures = [];
      if (run.fs['marker.txt'] !== 'still here\n') failures.push('marker.txt was deleted or altered despite Bash(rm:*) deny rule');
      if (run.fs['allowed.txt'] !== 'ok') failures.push('allowed.txt missing - non-rm Bash command was blocked, deny rule is not scoped to the rm:* prefix');
      if (!run.tokens.includes('user/tool_result')) failures.push('no user/tool_result token');
      if (denialCount(run.messages) < 1) failures.push('result.permission_denials empty (deny not recorded in public ledger)');
      return failures;
    },
  },
  {
    // Headless prompt fallthrough: allowedTools:['Read'] does not cover
    // Write, permissionMode default has no canUseTool to consult - both
    // engines must auto-deny rather than hang or execute.
    id: 's4-allowed-fallthrough-deny',
    option: 'allowedTools (default-mode prompt fallthrough, no canUseTool)',
    prompt: 'Write w.txt.',
    fixtureFiles: {},
    options: { allowedTools: ['Read'], permissionMode: 'default' },
    buildScripts: (cwd) => [
      { kind: 'sse', events: toolUseReply([{ name: 'Write', input: { file_path: join(cwd, 'w.txt'), content: 'X' } }]) },
      { kind: 'sse', events: textReply('DONE') },
    ],
    expect: { resultSubtype: 'success', resultText: 'DONE' },
    fsProbe: ['w.txt'],
    check(run) {
      const failures = [];
      if (run.fs['w.txt'] !== null) failures.push('w.txt exists - headless fallthrough executed instead of denying');
      if (denialCount(run.messages) < 1) failures.push('result.permission_denials empty');
      return failures;
    },
    notes: 'official headless no-callback path might end the run with an error result instead of success - such a terminal-shape delta lands in kdCandidates (mapping spec risk).',
  },
  {
    // acceptEdits auto-approves file edits: identical bytes on disk is the
    // strongest arm-neutral proof of the approval path.
    id: 's5-accept-edits',
    option: "permissionMode:'acceptEdits'",
    prompt: 'Write e.txt.',
    fixtureFiles: {},
    options: { permissionMode: 'acceptEdits' },
    buildScripts: (cwd) => [
      { kind: 'sse', events: toolUseReply([{ name: 'Write', input: { file_path: join(cwd, 'e.txt'), content: 'ACCEPT-EDITS-OK' } }]) },
      { kind: 'sse', events: textReply('DONE') },
    ],
    expect: { resultSubtype: 'success', resultText: 'DONE', toolResults: 1 },
    fsProbe: ['e.txt'],
    check(run) {
      const failures = [];
      if (run.fs['e.txt'] !== 'ACCEPT-EDITS-OK') failures.push(`e.txt content ${JSON.stringify(run.fs['e.txt'])} != ACCEPT-EDITS-OK`);
      if (denialCount(run.messages) !== 0) failures.push('unexpected permission denial under acceptEdits');
      return failures;
    },
  },
  {
    // Interlock refusal half: bypassPermissions WITHOUT
    // allowDangerouslySkipPermissions must fail closed BEFORE any model
    // call. postCount === 0 is the arm-neutral wire decider; the refusal
    // SHAPE (thrown ConfigurationError vs error result vs process exit)
    // may differ per arm and is recorded, not gated.
    id: 's6-bypass-interlock-refusal',
    option: "permissionMode:'bypassPermissions' without allowDangerouslySkipPermissions",
    prompt: 'Should never reach the model.',
    fixtureFiles: {},
    options: { permissionMode: 'bypassPermissions' },
    // IS_SANDBOX=1 removes the official CLI's SEPARATE root-uid refusal
    // (observed live on s7: exit 1 + 0 POSTs even WITH the interlock, until
    // IS_SANDBOX was set) so whatever remains is pure interlock semantics.
    env: { IS_SANDBOX: '1' },
    buildScripts: () => [{ kind: 'sse', events: textReply('UNREACHED') }],
    check(run) {
      const failures = [];
      if (run.postCount !== 0) failures.push(`postCount ${run.postCount} != 0 (model was called despite missing interlock)`);
      const result = resultOf(run.messages);
      const refused = Boolean(run.error) || (result && result.subtype !== 'success');
      if (!refused) failures.push('no observable refusal (no error thrown and no error result)');
      if (run.checks.resultText?.includes('UNREACHED')) failures.push('UNREACHED text produced');
      return failures;
    },
    notes: 'LIVE FINDING (2026-07-05): official 0.3.199/2.1.201 in a sandbox does NOT enforce the interlock - it proceeds to the model without allowDangerouslySkipPermissions (1 POST, success), while this SDK throws ConfigurationError with 0 POSTs. Deliberately kept gating-on-bpt + reported for official: our interlock is the documented COMPAT behavior; the official gap is a conformance finding, not a scenario bug.',
    // Integrator triage (M2): NOT a KD - a whole-stream refusal-vs-proceed
    // split cannot be honestly token-allowlisted. Stays DIVERGENT + reported
    // as an engine finding (this SDK is deliberately stricter than official).
    engineFinding: 'allowDangerouslySkipPermissions interlock is BPT-only strictness: official 0.3.199/2.1.201 proceeds without the flag (1 POST, success) while this SDK throws ConfigurationError with 0 POSTs. Deliberate safety divergence per COMPAT.md - keeper to decide whether to keep the stricter gate; kept DIVERGENT, never a KD.',
  },
  {
    // Positive half of the S6 interlock: with the flag, the same options
    // execute the write without any prompt route.
    id: 's7-bypass-with-interlock',
    option: 'bypassPermissions + allowDangerouslySkipPermissions:true',
    prompt: 'Write b.txt.',
    fixtureFiles: {},
    options: { permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true },
    env: { IS_SANDBOX: '1' }, // see s6 - official CLI root refusal is orthogonal to the interlock

    buildScripts: (cwd) => [
      { kind: 'sse', events: toolUseReply([{ name: 'Write', input: { file_path: join(cwd, 'b.txt'), content: 'BYPASS' } }]) },
      { kind: 'sse', events: textReply('DONE') },
    ],
    expect: { resultSubtype: 'success', resultText: 'DONE' },
    fsProbe: ['b.txt'],
    check(run) {
      const failures = [];
      if (run.fs['b.txt'] !== 'BYPASS') failures.push(`b.txt content ${JSON.stringify(run.fs['b.txt'])} != BYPASS`);
      if (denialCount(run.messages) !== 0) failures.push('unexpected permission denial under bypassPermissions');
      return failures;
    },
  },
  {
    // canUseTool allow + updatedInput: the callback runs in THIS process
    // for both arms (host-side observable), and the filesystem proves the
    // rewrite was honored by the engine, not just returned.
    id: 's8-canusetool-rewrite',
    option: 'canUseTool (prompt route, updatedInput rewrite)',
    prompt: 'Write original.txt.',
    fixtureFiles: {},
    makeOptions: ({ cwd, host }) => ({
      canUseTool: async (toolName, input) => {
        host.canUseTool.push(toolName);
        return { behavior: 'allow', updatedInput: { ...input, file_path: join(cwd, 'redirected.txt') } };
      },
    }),
    buildScripts: (cwd) => [
      { kind: 'sse', events: toolUseReply([{ name: 'Write', input: { file_path: join(cwd, 'original.txt'), content: 'REWRITE-PAYLOAD' } }]) },
      { kind: 'sse', events: textReply('DONE') },
    ],
    expect: { resultSubtype: 'success', resultText: 'DONE' },
    fsProbe: ['original.txt', 'redirected.txt'],
    check(run) {
      const failures = [];
      if (run.host.canUseTool.length !== 1) failures.push(`canUseTool invoked ${run.host.canUseTool.length} times, expected 1`);
      else if (run.host.canUseTool[0] !== 'Write') failures.push(`canUseTool toolName ${run.host.canUseTool[0]} != Write`);
      if (run.fs['redirected.txt'] !== 'REWRITE-PAYLOAD') failures.push('redirected.txt missing or wrong content (updatedInput not honored)');
      if (run.fs['original.txt'] !== null) failures.push('original.txt exists (engine ignored the rewritten file_path)');
      return failures;
    },
  },
  {
    // canUseTool deny. Deviation from the mapping sketch (Read secret.txt):
    // Read is a safe read-only tool that BOTH engines auto-approve in
    // default mode without consulting canUseTool, so a Read-based deny
    // would never exercise the prompt route. Write actually reaches it.
    id: 's8-canusetool-deny',
    option: 'canUseTool (prompt route, deny)',
    prompt: 'Write denied.txt.',
    fixtureFiles: {},
    makeOptions: ({ host }) => ({
      canUseTool: async (toolName) => {
        host.canUseTool.push(toolName);
        return { behavior: 'deny', message: 'conformance-l2 deny' };
      },
    }),
    buildScripts: (cwd) => [
      { kind: 'sse', events: toolUseReply([{ name: 'Write', input: { file_path: join(cwd, 'denied.txt'), content: 'NOPE' } }]) },
      { kind: 'sse', events: textReply('DONE') },
    ],
    expect: { resultSubtype: 'success', resultText: 'DONE' },
    fsProbe: ['denied.txt'],
    check(run) {
      const failures = [];
      if (run.host.canUseTool.length !== 1) failures.push(`canUseTool invoked ${run.host.canUseTool.length} times, expected 1`);
      if (run.fs['denied.txt'] !== null) failures.push('denied.txt exists despite canUseTool deny');
      if (denialCount(run.messages) < 1) failures.push('result.permission_denials empty after canUseTool deny');
      return failures;
    },
    notes: 'sketch said Read of secret.txt, but Read is auto-approved read-only on both engines and never reaches canUseTool - Write exercises the actual prompt route.',
  },
  {
    // PreToolUse deny hook: enforced pre-execution, run continues. The hook
    // closure is host-side for both arms, so invocation count is a fair
    // cross-arm observable.
    id: 's9-hook-pretooluse-deny',
    option: 'hooks (PreToolUse deny)',
    prompt: 'Write h.txt.',
    fixtureFiles: {},
    makeOptions: ({ host }) => ({
      hooks: {
        PreToolUse: [
          {
            hooks: [
              async () => {
                host.hookCalls.push('PreToolUse');
                return {
                  hookSpecificOutput: {
                    hookEventName: 'PreToolUse',
                    permissionDecision: 'deny',
                    permissionDecisionReason: 'conformance-l2',
                  },
                };
              },
            ],
          },
        ],
      },
    }),
    buildScripts: (cwd) => [
      { kind: 'sse', events: toolUseReply([{ name: 'Write', input: { file_path: join(cwd, 'h.txt'), content: 'X' } }]) },
      { kind: 'sse', events: textReply('DONE') },
    ],
    expect: { resultSubtype: 'success', resultText: 'DONE' },
    fsProbe: ['h.txt'],
    check(run) {
      const failures = [];
      if (run.host.hookCalls.length !== 1) failures.push(`PreToolUse hook invoked ${run.host.hookCalls.length} times, expected 1`);
      if (run.fs['h.txt'] !== null) failures.push('h.txt exists despite PreToolUse deny');
      return failures;
    },
  },
  {
    // interrupt(): triggered on RECEIPT of the first assistant message (not
    // wall clock). The in-flight tool is a 3-second Bash sleep so the
    // interrupt lands with a wide margin before the engine could post turn
    // 2 - postCount === 1 is the wire decider; the terminal shape (abort
    // error vs early result) is recorded and expected to differ per arm.
    id: 's10-interrupt',
    option: 'interrupt() / abortController',
    prompt: 'Sleep then continue.',
    fixtureFiles: {},
    options: { permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true },
    env: { IS_SANDBOX: '1' }, // see s6 - official CLI root refusal is orthogonal to the interlock
    driver: 'interrupt-on-first-assistant',
    buildScripts: () => [
      { kind: 'sse', events: toolUseReply([{ name: 'Bash', input: { command: 'sleep 3' } }]) },
      { kind: 'sse', events: textReply('UNREACHED') },
    ],
    check(run) {
      const failures = [];
      if (run.postCount !== 1) failures.push(`postCount ${run.postCount} != 1 (interrupt did not stop turn 2)`);
      if (run.checks.resultText?.includes('UNREACHED')) failures.push('UNREACHED text produced after interrupt');
      return failures;
    },
    notes: 'Bash sleep 3 (not a fast Read) de-races the official arm: its CLI runs ahead of consumer pull, so the interrupt needs an in-flight window. Terminal shape delta -> kdCandidates.',
  },
  {
    // includePartialMessages: raw stream_event passthrough. Consecutive
    // stream_event runs coalesce under the existing KD-05 mechanism, so the
    // comparison stays granularity-neutral.
    id: 's11-partial-messages',
    option: 'includePartialMessages',
    prompt: 'Say PARTIAL OK.',
    fixtureFiles: {},
    options: { includePartialMessages: true },
    buildScripts: () => [{ kind: 'sse', events: textReply('PARTIAL OK') }],
    expect: { resultSubtype: 'success', resultText: 'PARTIAL OK' },
    check(run) {
      const failures = [];
      if (!run.tokens.includes('stream_event')) failures.push('no stream_event token despite includePartialMessages:true');
      return failures;
    },
  },
  {
    // maxBudgetUsd: the scripted turn reports 2M input tokens on a REAL
    // priced model id, so both cost estimators should trip before turn 2.
    // DROPPABLE (mapping spec): if the official CLI prices the model at $0
    // it never trips - the row then demotes to a single-arm lock (our
    // estimator is already unit-tested).
    id: 's12-max-budget',
    option: 'maxBudgetUsd',
    prompt: 'Spend tokens.',
    fixtureFiles: { 'hello.txt': 'fixture alpha\n' },
    options: { maxBudgetUsd: 0.001 },
    droppable: true,
    // Integrator triage (M2): NOT a KD - this SDK executes the in-flight
    // turn's tool BEFORE tripping the budget (ours-only user/tool_result),
    // official aborts the turn first. Side effects after budget exhaustion
    // are a suspected OUR-engine gap; stays DIVERGENT + reported.
    engineFinding: 'maxBudgetUsd stop ordering: this SDK executes the current turn\'s requested tool and THEN trips the budget (ours-only user/tool_result before result/error_max_budget_usd); official 2.1.201 trips BEFORE executing the tool. Same subtype and 1 POST on both arms, but ours performs tool side effects after the cap is already exceeded - suspected engine gap, kept DIVERGENT, never a KD.',
    buildScripts: (cwd) => {
      const events = toolUseReply([{ name: 'Read', input: { file_path: join(cwd, 'hello.txt') } }]);
      // Priced model + huge usage: ~$6 at sonnet input pricing >> $0.001.
      events[0].message.model = 'claude-sonnet-4-5';
      events[0].message.usage = { input_tokens: 2_000_000, output_tokens: 1 };
      return [
        { kind: 'sse', events },
        { kind: 'sse', events: textReply('UNREACHED') },
      ];
    },
    expect: { resultSubtype: 'error_max_budget_usd' },
    check(run) {
      const failures = [];
      if (run.postCount !== 1) failures.push(`postCount ${run.postCount} != 1 (budget stop must land before turn 2)`);
      if (run.checks.resultText?.includes('UNREACHED')) failures.push('UNREACHED text produced past the budget cap');
      return failures;
    },
  },
  {
    // agents / subagent delegation. The subagent tool is named 'Task' on
    // the official engine and 'Agent' on this SDK (COMPAT: Agent a.k.a.
    // Task) - buildScripts is arm-parametrized on the NAME only; the naming
    // split itself is a standing kdCandidate emitted by the runner.
    // DROPPABLE: official child-request topology may be nondeterministic.
    id: 's13-agents-task',
    option: 'agents / Agent(Task) tool',
    prompt: 'Delegate to the helper.',
    fixtureFiles: {},
    // Both delegation tool names get an explicit allow rule: this SDK's
    // default mode routes the non-readonly Agent tool to the prompt
    // fallthrough (observed live: permission_denied), and the scenario is
    // about `agents` wiring, not the permission gate.
    options: {
      agents: { helper: { description: 'conformance helper', prompt: 'scripted subagent', tools: ['Read'] } },
      allowedTools: ['Agent', 'Task', 'Read'],
    },
    droppable: true,
    buildScripts: (cwd, arm) => [
      {
        kind: 'sse',
        events: toolUseReply([
          {
            name: arm === 'official' ? 'Task' : 'Agent',
            input: { subagent_type: 'helper', description: 'delegated probe', prompt: 'go' },
          },
        ]),
      },
      { kind: 'sse', events: textReply('CHILD DONE', { id: 'msg_conf_child' }) },
      { kind: 'sse', events: textReply('PARENT DONE', { id: 'msg_conf_parent2' }) },
    ],
    expect: { resultSubtype: 'success', resultText: 'PARENT DONE' },
    check(run) {
      const failures = [];
      if (run.postCount !== 3) failures.push(`postCount ${run.postCount} != 3 (parent + child + parent)`);
      if (!run.tokens.includes('user/tool_result')) failures.push('no tool_result for the delegation call');
      return failures;
    },
    kdNote: "KD-11: subagent tool NAME differs (official 'Task' vs this SDK 'Agent') and official 2.1.201 delegation topology adds a child request (4 POSTs vs our 3) - scripts are arm-parametrized on the name only; see the KD-11 entry in normalize.mjs and the COMPAT `agents` row",
  },
  {
    // Cross-query headless resume - custom two-query driver in run-l2.mjs
    // (kind: 'resume'). The official arm gets HOME=mkdtemp so the CLI
    // session store lands inside the sandbox; this SDK uses its JSONL
    // store under the shared cwd. Continuity decider: Q2 init.session_id
    // equals the id captured from Q1's public stream.
    // DROPPABLE: official store discovery is HOME/cwd-hash coupled and may
    // refuse emulator-born sessions.
    id: 's14-resume',
    option: 'resume (cross-query, headless)',
    kind: 'resume',
    droppable: true,
    prompts: ['Say FIRST.', 'Say SECOND.'],
    buildScripts: () => [
      { kind: 'sse', events: textReply('FIRST', { id: 'msg_conf_first' }) },
      { kind: 'sse', events: textReply('SECOND', { id: 'msg_conf_second' }) },
    ],
    checkResume({ q1Text, q2Text, resumedId, q2SessionId, postCount, transcriptBoth }) {
      const failures = [];
      if (!q1Text?.includes('FIRST')) failures.push(`Q1 result ${JSON.stringify(q1Text)} missing FIRST`);
      if (!q2Text?.includes('SECOND')) failures.push(`Q2 result ${JSON.stringify(q2Text)} missing SECOND`);
      if (!resumedId) failures.push('no session_id captured from Q1 public stream');
      else if (q2SessionId !== resumedId) failures.push(`Q2 session_id ${q2SessionId} != resumed ${resumedId} (no continuity)`);
      if (postCount !== 2) failures.push(`total postCount ${postCount} != 2 (exactly one POST per query)`);
      // BPT arm only (null elsewhere): storage-level proof that the resumed
      // transcript actually accumulated both turns - the id-echo decider
      // alone cannot fail on our engine (review finding, 2026-07-05).
      if (transcriptBoth === false) failures.push('resumed transcript does not carry both turns (id adopted without history)');
      return failures;
    },
  },
];
